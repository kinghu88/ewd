/**
 * 游戏音效。
 *
 * 击杀播报（First Blood / Double~Penta Kill / Legendary / ACE）使用
 * 真实语音切片（public/sfx/*.mp3，源自英雄联盟 5 杀声效，按静音间隔切段）；
 * 普通答对的轻提示与答错音仍由 Web Audio API 实时合成，零延迟。
 *
 * - Audio 元素在首次用户手势（点击/按键）后预加载并静音解锁，
 *   浏览器自动播放策略不会拦截；
 * - 调用方负责按设置决定是否播放，本模块只负责发声。
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;

/* ----------------------------- 合成音效层 ----------------------------- */

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined' || !window.AudioContext) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  return ctx;
}

interface ToneOptions {
  /** 相对开始时刻的偏移（秒） */
  at?: number;
  /** 时长（秒） */
  dur?: number;
  type?: OscillatorType;
  /** 0~1 音量峰值 */
  gain?: number;
}

function tone(ac: AudioContext, freq: number, opts: ToneOptions = {}): void {
  const { at = 0, dur = 0.12, type = 'triangle', gain = 0.5 } = opts;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  // 快速起音 + 指数衰减，避免爆音
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** 音名 -> 频率（十二平均律，A4=440） */
function f(note: string): number {
  const TABLE: Record<string, number> = {
    C4: 261.63, D4: 293.66, E4: 329.66, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.78,
    C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98,
  };
  return TABLE[note] ?? 880;
}

/* ----------------------------- 语音播报层 ----------------------------- */

const VOICE_NAMES = [
  'first-blood',
  'double-kill',
  'triple-kill',
  'quadra-kill',
  'penta-kill',
  'legendary',
  'ace',
] as const;
type VoiceName = (typeof VOICE_NAMES)[number];

/** 连击数 -> 段位语音（与 lib/combo.ts 的 tierOf 对齐） */
const VOICE_BY_COMBO: Partial<Record<number, VoiceName>> = {
  2: 'double-kill',
  3: 'triple-kill',
  4: 'quadra-kill',
  5: 'penta-kill',
};

const VOICE_VOLUME = 0.9;
const voiceEls = new Map<VoiceName, HTMLAudioElement>();

function buildVoices(): void {
  if (typeof window === 'undefined' || voiceEls.size > 0) return;
  for (const name of VOICE_NAMES) {
    const a = new Audio(`${import.meta.env.BASE_URL}sfx/${name}.mp3`);
    a.preload = 'auto';
    a.volume = VOICE_VOLUME;
    voiceEls.set(name, a);
  }
}

/** 停掉所有播报（被答错/更高段位打断时调用，避免语音叠在一起） */
function stopVoices(): void {
  voiceEls.forEach((a) => {
    a.pause();
    a.currentTime = 0;
  });
}

/** 同一条语音的最小触发间隔（毫秒），过滤 StrictMode 双 effect 等重复调用 */
const REPEAT_GUARD_MS = 300;
const lastPlayedAt = new Map<VoiceName, number>();

function playVoice(name: VoiceName): void {
  unlock();
  const el = voiceEls.get(name);
  if (!el) return;
  // StrictMode 开发模式下 effect 会双触发；真实场景间隔远超此值
  const now = performance.now();
  if (now - (lastPlayedAt.get(name) ?? -Infinity) < REPEAT_GUARD_MS) return;
  lastPlayedAt.set(name, now);
  // 新播报覆盖旧播报（与游戏内行为一致）
  voiceEls.forEach((a) => {
    if (a !== el) {
      a.pause();
      a.currentTime = 0;
    }
  });
  el.currentTime = 0;
  el.volume = VOICE_VOLUME;
  void el.play().catch(() => {
    /* 音频未就绪或被浏览器拦截时静默降级 */
  });
}

/**
 * 用户首次交互时解锁音频。
 * 首次播放本身就发生在真实手势调用栈内（点击确认 / 回车），
 * HTMLAudio 直接允许播放，无需静音预热；此处只做预加载与
 * AudioContext 解锁（合成的答对/答错音需要）。
 */
function unlock(): void {
  if (unlocked) return;
  unlocked = true;

  buildVoices();

  const ac = ensureContext();
  if (ac) {
    const resume = () => void ac.resume();
    resume();
    document.addEventListener('pointerdown', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }
}

/* ------------------------------- 对外接口 ------------------------------- */

/** 答对：连击 2+ 为真实击杀播报；连击 1 的一血由 playFirstBlood 承担，此处合成音仅作兜底 */
export function playCorrect(combo: number): void {
  if (combo >= 2) {
    playVoice(VOICE_BY_COMBO[combo] ?? 'legendary');
    return;
  }
  unlock();
  const ac = ensureContext();
  if (!ac) return;
  // 兜底：未走一血分支的单次答对，清脆一声
  tone(ac, f('E6'), { dur: 0.14, gain: 0.4 });
}

/** 答错 / 超时：低沉下行音，并掐断尚未播完的击杀播报 */
export function playWrong(): void {
  unlock();
  stopVoices();
  const ac = ensureContext();
  if (!ac) return;
  tone(ac, 220, { dur: 0.18, type: 'sawtooth', gain: 0.22 });
  tone(ac, 155.56, { at: 0.13, dur: 0.26, type: 'sawtooth', gain: 0.22 });
}

/** 一血 */
export function playFirstBlood(): void {
  playVoice('first-blood');
}

/** ACE（全对团灭） */
export function playAce(): void {
  playVoice('ace');
}

/* ------------------------------- 幸运红包 ------------------------------- */

/** 选中红包：短促「叮」一声，配合翻转动画的起手 */
export function playPacketPick(): void {
  unlock();
  const ac = ensureContext();
  if (!ac) return;
  tone(ac, f('G5'), { dur: 0.1, type: 'sine', gain: 0.32 });
  tone(ac, f('C6'), { at: 0.06, dur: 0.14, type: 'sine', gain: 0.26 });
}

/** 翻出金币：明亮上行琶音（C5 → C6） */
export function playPacketWin(): void {
  unlock();
  const ac = ensureContext();
  if (!ac) return;
  const notes: Array<[string, number]> = [
    ['C5', 0],
    ['E5', 0.09],
    ['G5', 0.18],
    ['C6', 0.27],
  ];
  notes.forEach(([note, at]) => tone(ac, f(note), { at, dur: 0.32, gain: 0.38 }));
}

/** 翻到鼓励成语（未抽中金币）：轻柔下行两音（安慰感，不做刺耳判错音） */
export function playPacketMiss(): void {
  unlock();
  const ac = ensureContext();
  if (!ac) return;
  tone(ac, f('E4'), { dur: 0.22, type: 'sine', gain: 0.26 });
  tone(ac, f('A4'), { at: 0.16, dur: 0.34, type: 'sine', gain: 0.22 });
}

/* ------------------------------- 查看单词（冲锋枪） ------------------------------- */

/** 缓存的短白噪声 buffer，供枪声 / 上膛声反复取用 */
let noiseBuffer: AudioBuffer | null = null;

function getNoise(ac: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(ac.sampleRate * 0.22);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

/**
 * 单发狙击枪：极短的高频噪声「啪」做枪口爆裂感，
 * 叠加一记快速下坠的低频「砰」与长尾，干净有力，约 0.5 秒。
 * 仅在狙击镜视频带声音播放被浏览器拦截时作为兜底。
 */
export function playSniperShot(): void {
  unlock();
  const ac = ensureContext();
  if (!ac || !master) return;
  const t0 = ac.currentTime;

  // 高频爆裂：高通白噪声，80ms 内快速衰减
  const src = ac.createBufferSource();
  src.buffer = getNoise(ac);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1000;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.55, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
  src.connect(hp);
  hp.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + 0.12);

  // 低频「砰」：110Hz 快速下坠到 38Hz，带长尾
  const osc = ac.createOscillator();
  const og = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(110, t0);
  osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.42);
  og.gain.setValueAtTime(0.0001, t0);
  og.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
  osc.connect(og);
  og.connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.55);
}
