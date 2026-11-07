import { useEffect, useRef, useState } from 'react';
import { isEnglishLetter, letterClass } from '@/lib/words';
import { playSniperShot } from '@/lib/sfx';

interface PeekGunEffectProps {
  /** 本词（与四线格格子一一对应） */
  word: string;
  soundOn: boolean;
  /** 全部字母弹出后回调一次，让父组件把答案写进真格（可选） */
  onReveal?: (word: string) => void;
  /** 动画（含淡出）结束通知父组件 */
  onDone: () => void;
}

/** AI 生成的扁平卡通狙击镜动画（2 秒：滑入锁定 → 单发开火 → 冲击波粒子） */
const VIDEO_SRC = `${import.meta.env.BASE_URL}peek-scope.mp4`;
/**
 * CSS-only 兜底特效的字母弹出起始时刻（毫秒）：
 * 0 ~ 500ms    瞄准镜淡入 + overshoot 锁定中心
 * 420ms ~ 560ms  十字准星展开
 * 500ms        开火（冲击波 + 粒子 + 狙击枪声）
 * ~1150ms      所有视觉特效（冲击波 550ms + 粒子 650ms）与枪声全部结束
 * 1250ms       留足缓冲后字母依次弹出 ← 本常量
 * 总时长 ~2.2s 收尾
 */
const FALLBACK_FIRE_MS = 1250;
/** 开火后字母依次弹出的间隔 */
const LETTER_STAGGER_MS = 85;
/** 末个字母弹出后的停留时间 */
const HOLD_AFTER_LAST_MS = 560;
const FADE_MS = 300;
/** 视频加载超时：mount 后超过此时长仍未 canplay，判定为加载失败 */
const VIDEO_LOAD_TIMEOUT_MS = 1500;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/* --------------------- 视频音轨开火时刻检测（模块级缓存） --------------------- */

let fireCache: number | null = null;
let firePromise: Promise<number> | null = null;

/**
 * 解码视频音轨，取 40ms 窗 RMS 能量在 0.75~1.7s 区间内的最高点作为开火时刻。
 * 视频文件缺失时 fetch 会 404，自动 fallback 到静态兜底值。
 */
function detectFireTime(): Promise<number> {
  if (fireCache !== null) return Promise.resolve(fireCache);
  if (!firePromise) firePromise = doDetect();
  return firePromise;
}

async function doDetect(): Promise<number> {
  try {
    const resp = await fetch(VIDEO_SRC);
    if (!resp.ok) throw new Error('video not available');
    const raw = await resp.arrayBuffer();
    const ac = new AudioContext();
    let audio: AudioBuffer;
    try {
      audio = await ac.decodeAudioData(raw);
    } finally {
      void ac.close();
    }
    const sr = audio.sampleRate;
    const data = audio.getChannelData(0);
    const win = Math.floor(sr * 0.04);
    const hop = Math.floor(sr * 0.02);
    let bestT = FALLBACK_FIRE_MS / 1000;
    let bestE = -1;
    for (let start = 0; start + win < data.length; start += hop) {
      const t = (start + win / 2) / sr;
      if (t < 0.3 || t > 1.0) continue;
      let sum = 0;
      for (let i = start; i < start + win; i += 1) sum += data[i] * data[i];
      const e = sum / win;
      if (e > bestE) {
        bestE = e;
        bestT = t;
      }
    }
    fireCache = bestT * 1000;
    return fireCache;
  } catch {
    fireCache = FALLBACK_FIRE_MS;
    return FALLBACK_FIRE_MS;
  }
}

/**
 * 「查看单词」专属特效：第一人称狙击镜从画面边缘平滑滑入、十字准星锁定
 * 四线格区域，短暂停顿后单发开火——AI 视频自带镜筒后坐、白色冲击波、
 * 飞散粒子与狙击枪声；代码只负责把字母在开火瞬间逐个弹出
 * （每个单词不同，不能烤进视频），弹出后凭记忆书写。
 *
 * 克隆层与真实四线格共用同一组 CSS 变量，格子位置天然对齐。
 */
export function PeekGunEffect({ word, soundOn, onReveal, onDone }: PeekGunEffectProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const chars = Array.from(word);
  const letterIndexes = chars
    .map((ch, i) => ({ ch, i }))
    .filter(({ ch }) => isEnglishLetter(ch));

  const [revealed, setRevealed] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [reduced] = useState(prefersReducedMotion);
  /**
   * 视频加载失败 → 切换到 CSS-only 狙击镜兜底特效。
   * 原因：peek-scope.mp4 不存在 / 浏览器解码失败 / 自动播放策略拦截后静音也无法启动。
   * Safari 对无效 src 的 <video> 元素渲染异常（整段不显示），Chrome 则可能显示灰色底但无镜筒动画。
   */
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    // 降低动态偏好：不播视频/特效，字母一次性显现，立即收尾
    if (reduced) {
      setRevealed(letterIndexes.length);
      onReveal?.(word);
      if (soundOn) playSniperShot();
      const t = setTimeout(() => {
        setLeaving(true);
        setTimeout(onDone, FADE_MS);
      }, 750);
      return () => clearTimeout(t);
    }

    let alive = true;
    let rafId = 0;
    let fadeRaf = 0;
    let doneTimer: ReturnType<typeof setTimeout> | undefined;

    /** 开火时刻（毫秒）；音轨分析完成前先用兜底值 */
    let fireMs = FALLBACK_FIRE_MS;
    /** 视频带声音播放被浏览器拦截 / 视频文件不可用时，Web Audio 合成狙击枪声兜底 */
    let synthFallback = false;
    /** 兜底枪声只补一次 */
    let synthPlayed = false;
    /** onReveal 只调一次 */
    let revealNotified = false;
    const mountAt = performance.now();
    /** 视频自然播放结束的墙钟时刻（结束后用墙钟续完停留） */
    let endedAt = 0;
    let shown = 0;
    /** 视频加载是否就绪（canplaythrough 触发后置 true） */
    let videoReady = false;
    /** 视频加载超时定时器 */
    let loadTimeout: ReturnType<typeof setTimeout> | undefined;
    /** 视频加载成功回调（在 if 块内声明但 cleanup 也要访问，因此提到外层作用域） */
    let onReady: (() => void) | null = null;

    const video = videoRef.current;
    if (video) {
      video.loop = false;
      video.muted = !soundOn;

      // 视频加载成功 → 清除超时定时器
      onReady = () => {
        videoReady = true;
        if (loadTimeout) {
          clearTimeout(loadTimeout);
          loadTimeout = undefined;
        }
      };
      video.addEventListener('canplaythrough', onReady, { once: true });
      video.addEventListener('loadedmetadata', onReady, { once: true });

      // 慢放测试钩子：<html data-peek-slow="0.12">，字母计时跟随播放头因此一并变慢
      const slowRate = Number(document.documentElement.dataset.peekSlow);
      if (Number.isFinite(slowRate) && slowRate > 0 && slowRate < 1) {
        video.playbackRate = slowRate;
      }

      // 视频带声音播放可能被浏览器自动播放策略拦截（Safari 尤其严格）。
      // play() reject → 静音重试 + 标记 synthFallback；
      // play() resolve 但视频永远不启动（Chrome 对无效 src 的静默失败）→
      //   下方 tick 里的超时检测会强制设 synthFallback = true。
      video.play()
        .catch(() => {
          video.muted = true;
          synthFallback = true;
          return video.play().catch(() => {
            synthFallback = true;
          });
        });

      // 超时兜底：mount 后 VIDEO_LOAD_TIMEOUT_MS 仍未 ready，
      // 判定为视频文件缺失或浏览器解码失败，切到 CSS-only 特效 + 强制合成枪声。
      loadTimeout = setTimeout(() => {
        if (!alive || videoReady) return;
        setUseFallback(true);
        synthFallback = true;
      }, VIDEO_LOAD_TIMEOUT_MS);
    }
    void detectFireTime().then((ms) => {
      fireMs = ms;
    });

    /** 淡出：视觉与视频音量同步收下去，避免枪声在结束时硬切 */
    const beginLeave = () => {
      if (!alive) return;
      setLeaving(true);
      if (video && !video.muted && video.volume > 0) {
        const t0 = performance.now();
        const tick = () => {
          if (!alive) return;
          const p = Math.min(1, (performance.now() - t0) / FADE_MS);
          video.volume = 1 - p;
          if (p < 1) fadeRaf = requestAnimationFrame(tick);
        };
        fadeRaf = requestAnimationFrame(tick);
      }
      doneTimer = setTimeout(() => alive && onDone(), FADE_MS);
    };

    /**
     * 每帧读取视频播放头：字母揭示与收尾全部跟随视频时间轴，
     * 与镜筒动作/枪声天然同步（视频卡顿或变速也不会错位）。
     * 播放头尚未起步时（解码/自动播放中）给 250ms 启动宽限后再走墙钟，
     * 墙钟从 0 起算，避免慢放场景下提前揭示字母。
     */
    const tick = () => {
      if (!alive) return;
      const now = performance.now();

      // 超时兜底（保险）：如果视频"play() resolve 但永远不播放"（Chrome 对无效 src 的静默行为），
      // 在播放头 1s 内始终不动的情况下强制启用合成枪声 + CSS-only 特效。
      if (video && !synthFallback && !videoReady && now - mountAt > 1000) {
        synthFallback = true;
        setUseFallback(true);
      }

      let t: number;
      if (video && video.ended) {
        if (!endedAt) endedAt = now;
        t = (Number.isFinite(video.duration) ? video.duration * 1000 : 2000) + (now - endedAt);
      } else if (video && video.currentTime > 0.05 && videoReady) {
        t = video.currentTime * 1000;
      } else {
        t = Math.max(0, now - mountAt - 250);
      }

      const n = letterIndexes.length;
      const should = Math.max(0, Math.min(n, Math.floor((t - fireMs) / LETTER_STAGGER_MS) + 1));
      if (should > shown) {
        if (!synthPlayed && synthFallback && soundOn) {
          playSniperShot();
          synthPlayed = true;
        }
        shown = should;
        setRevealed(shown);
        // 所有字母都弹完时通知父组件把答案写进真格
        if (shown === n && !revealNotified) {
          revealNotified = true;
          onReveal?.(word);
        }
      }

      const endAt = fireMs + n * LETTER_STAGGER_MS + HOLD_AFTER_LAST_MS;
      if (t >= endAt) {
        beginLeave();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      if (fadeRaf) cancelAnimationFrame(fadeRaf);
      if (doneTimer) clearTimeout(doneTimer);
      if (loadTimeout) clearTimeout(loadTimeout);
      if (video && onReady) {
        video.pause();
        video.removeEventListener('canplaythrough', onReady);
        video.removeEventListener('loadedmetadata', onReady);
      } else if (video) {
        video.pause();
      }
    };
    // 单词与音效开关在一次特效生命周期内不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`peek-overlay${leaving ? ' is-leaving' : ''}`}
      aria-hidden
    >
      {/* AI 生成视频：第一人称狙击镜，纯色浅灰底铺满格子区 */}
      {!reduced && !useFallback && (
        <video
          ref={videoRef}
          className="peek-scope-video"
          src={VIDEO_SRC}
          playsInline
          preload="auto"
          muted={!soundOn}
        />
      )}

      {/* CSS-only 狙击镜兜底：视频文件缺失 / 浏览器解码失败时启用
          圆形镜筒滑入 + 十字准星 + 开火冲击波 + 飞散粒子 */}
      {!reduced && useFallback && <PeekScopeFallback />}

      {/* 克隆四线格：开火瞬间字母逐个弹入，尺寸与真格一致 */}
      <div className="peek-grid-scroll">
        <div className="peek-grid">
          {chars.map((ch, i) => {
            const letterNo = letterIndexes.findIndex((t) => t.i === i);
            const isShot = letterNo >= 0 && letterNo < revealed;
            return (
              <span key={i} className="peek-cell">
                {isShot && (
                  <>
                    <span className={`fl-letter peek-letter ${letterClass(ch)}`}>{ch}</span>
                    <span className="peek-spark">
                      <i />
                      <i />
                      <i />
                      <i />
                      <b />
                    </span>
                  </>
                )}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* -------------------- CSS-only 狙击镜兜底 -------------------- */

/**
 * 当 peek-scope.mp4 文件缺失 / 浏览器解码失败时，
 * 用 Web Animations API 驱动的扁平卡通狙击镜接管视觉层：
 * 瞄准镜淡入 → 十字准星展开 → 开火（冲击波 + 粒子）。
 * 整个特效 ~2s 完成，开火时刻 = 500ms。
 */

function PeekScopeFallback() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const crossXRef = useRef<HTMLSpanElement>(null);
  const crossYRef = useRef<HTMLSpanElement>(null);
  const irisRef = useRef<HTMLSpanElement>(null);
  const blastRef = useRef<HTMLSpanElement>(null);
  const p1Ref = useRef<HTMLSpanElement>(null);
  const p2Ref = useRef<HTMLSpanElement>(null);
  const p3Ref = useRef<HTMLSpanElement>(null);
  const p4Ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // 1. 瞄准镜主体 —— 淡入 + overshoot 锁定（500ms）
    const body = bodyRef.current;
    if (body) {
      body.animate(
        [
          { transform: 'translate(0, 0) scale(0.88)', opacity: 0, offset: 0 },
          { transform: 'translate(0, 0) scale(1.04)', opacity: 1, offset: 0.72 },
          { transform: 'translate(0, 0) scale(0.97)', opacity: 1, offset: 0.88 },
          { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 1 },
        ],
        { duration: 500, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
      );
    }

    // 2. 外圈光环 —— 锁定后微抖动（500ms 起 + 300ms）
    const ring = ringRef.current;
    if (ring) {
      ring.animate(
        [
          { transform: 'scale(1)', offset: 0 },
          { transform: 'scale(1)', offset: 0.8 },
          { transform: 'scale(0.99)', offset: 0.9 },
          { transform: 'scale(1.01)', offset: 0.96 },
          { transform: 'scale(1)', offset: 1 },
        ],
        { duration: 800, easing: 'ease-out', fill: 'both' },
      );
    }

    // 3. 十字准星 —— 锁定收尾瞬间出现（420ms）
    const crossOpt: KeyframeAnimationOptions = {
      duration: 140,
      delay: 420,
      easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.3)',
      fill: 'both',
    };
    crossXRef.current?.animate(
      [
        { transform: 'scaleX(0)', opacity: 0, offset: 0 },
        { transform: 'scaleX(1)', opacity: 1, offset: 1 },
      ],
      crossOpt,
    );
    crossYRef.current?.animate(
      [
        { transform: 'scaleY(0)', opacity: 0, offset: 0 },
        { transform: 'scaleY(1)', opacity: 1, offset: 1 },
      ],
      crossOpt,
    );

    // 4. 中央遮光片 —— 500ms 开火瞬间闪光
    const iris = irisRef.current;
    if (iris) {
      iris.animate(
        [
          { width: '8px', height: '8px', margin: '-4px 0 0 -4px', background: '#232c3f', offset: 0 },
          { width: '8px', height: '8px', margin: '-4px 0 0 -4px', background: '#232c3f', offset: 0.78 },
          { width: '18px', height: '18px', margin: '-9px 0 0 -9px', background: '#ffd666', boxShadow: '0 0 20px rgba(255, 200, 80, 0.85)', offset: 0.85 },
          { width: '8px', height: '8px', margin: '-4px 0 0 -4px', background: '#232c3f', offset: 1 },
        ],
        { duration: 700, delay: 0, easing: 'ease-out', fill: 'both' },
      );
    }

    // 5. 冲击波 —— 500ms 后开始扩散
    const blast = blastRef.current;
    if (blast) {
      blast.animate(
        [
          { opacity: 0, transform: 'scale(0.15)', offset: 0 },
          { opacity: 1, transform: 'scale(1.1)', offset: 0.25 },
          { opacity: 0, transform: 'scale(2.2)', offset: 1 },
        ],
        { duration: 550, delay: 500, easing: 'ease-out', fill: 'both' },
      );
    }

    // 6. 四向粒子飞散 —— 500ms 后开始
    const particleAngles = [
      { dx: -60, dy: -50 },
      { dx: 55, dy: -55 },
      { dx: -50, dy: 60 },
      { dx: 60, dy: 50 },
    ];
    const particleRefs = [p1Ref, p2Ref, p3Ref, p4Ref];
    particleRefs.forEach((ref, i) => {
      const el = ref.current;
      if (!el) return;
      const { dx, dy } = particleAngles[i];
      el.animate(
        [
          { opacity: 1, transform: 'translate(0, 0) scale(1)', offset: 0 },
          { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.4)`, offset: 1 },
        ],
        { duration: 650, delay: 500 + i * 5, easing: 'ease-out', fill: 'both' },
      );
    });
  }, []);

  return (
    <div className="peek-fallback">
      <div className="peek-scope-body" ref={bodyRef}>
        <span className="peek-scope-ring" ref={ringRef} />
        <span className="peek-scope-inner" />
        <span className="peek-crosshair-x" ref={crossXRef} />
        <span className="peek-crosshair-y" ref={crossYRef} />
        <span className="peek-scope-iris" ref={irisRef} />
      </div>
      <span className="peek-blast-wave" ref={blastRef} />
      <span className="peek-blast-particle" ref={p1Ref} />
      <span className="peek-blast-particle peek-blast-particle--2" ref={p2Ref} />
      <span className="peek-blast-particle peek-blast-particle--3" ref={p3Ref} />
      <span className="peek-blast-particle peek-blast-particle--4" ref={p4Ref} />
    </div>
  );
}
