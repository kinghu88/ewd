import { useEffect, useRef, useState } from 'react';
import { isEnglishLetter, letterClass } from '@/lib/words';
import { playSniperShot } from '@/lib/sfx';

interface PeekGunEffectProps {
  /** 本词（与四线格格子一一对应） */
  word: string;
  soundOn: boolean;
  /** 动画（含淡出）结束通知父组件 */
  onDone: () => void;
}

/** AI 生成的扁平卡通狙击镜动画（2 秒：滑入锁定 → 单发开火 → 冲击波粒子） */
const VIDEO_SRC = `${import.meta.env.BASE_URL}peek-scope.mp4`;
/** 无法解码音轨时的开火时刻（毫秒，成片实测约 1.17s） */
const FALLBACK_FIRE_MS = 1170;
/** 开火后字母依次弹出的间隔 */
const LETTER_STAGGER_MS = 85;
/** 末个字母弹出后的停留时间 */
const HOLD_AFTER_LAST_MS = 560;
const FADE_MS = 300;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/* --------------------- 视频音轨开火时刻检测（模块级缓存） --------------------- */

let fireCache: number | null = null;
let firePromise: Promise<number> | null = null;

/**
 * 解码视频音轨，取 40ms 窗 RMS 能量在 0.75~1.7s 区间内的最高点作为开火时刻。
 * 字母弹出直接挂在真实的那声「砰」上，避免换素材后时序漂移。
 */
function detectFireTime(): Promise<number> {
  if (fireCache !== null) return Promise.resolve(fireCache);
  if (!firePromise) firePromise = doDetect();
  return firePromise;
}

async function doDetect(): Promise<number> {
  try {
    const resp = await fetch(VIDEO_SRC);
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
      if (t < 0.75 || t > 1.7) continue;
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
export function PeekGunEffect({ word, soundOn, onDone }: PeekGunEffectProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const chars = Array.from(word);
  const letterIndexes = chars
    .map((ch, i) => ({ ch, i }))
    .filter(({ ch }) => isEnglishLetter(ch));

  const [revealed, setRevealed] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [reduced] = useState(prefersReducedMotion);

  useEffect(() => {
    // 降低动态偏好：不播视频，字母一次性显现，立即收尾
    if (reduced) {
      setRevealed(letterIndexes.length);
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

    /** 开火时刻（毫秒，视频时间轴）；音轨分析完成前先用兜底值 */
    let fireMs = FALLBACK_FIRE_MS;
    /** 视频带声音播放被浏览器拦截时，静音播放 + Web Audio 合成狙击枪声兜底 */
    let synthFallback = false;
    /** 兜底枪声只补一次 */
    let synthPlayed = false;
    const mountAt = performance.now();
    /** 视频自然播放结束的墙钟时刻（结束后用墙钟续完停留） */
    let endedAt = 0;
    let shown = 0;

    const video = videoRef.current;
    if (video) {
      video.loop = false;
      video.muted = !soundOn;
      // 慢放测试钩子：<html data-peek-slow="0.12">，字母计时跟随播放头因此一并变慢
      const slowRate = Number(document.documentElement.dataset.peekSlow);
      if (Number.isFinite(slowRate) && slowRate > 0 && slowRate < 1) {
        video.playbackRate = slowRate;
      }
      video.play()
        .catch(() => {
          video.muted = true;
          synthFallback = true;
          return video.play().catch(() => {
            /* 极端情况下视频无法播放，仍由墙钟兜底揭示字母 */
            synthFallback = true;
          });
        });
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
      let t: number;
      if (video && video.ended) {
        if (!endedAt) endedAt = now;
        t = (Number.isFinite(video.duration) ? video.duration * 1000 : 2000) + (now - endedAt);
      } else if (video && video.currentTime > 0.05) {
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
      if (video) video.pause();
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
      {!reduced && (
        <video
          ref={videoRef}
          className="peek-scope-video"
          src={VIDEO_SRC}
          playsInline
          preload="auto"
          muted={!soundOn}
        />
      )}
      {/* 遮挡成片右下角水印的柔色补丁（与浅灰背景一致） */}
      <span className="peek-wm-cover" />

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
