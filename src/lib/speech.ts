/**
 * Web Speech API 朗读封装 —— Chromium 音质修复最终版。
 *
 * 根因回顾（macOS 上 Chromium）：
 *   Chrome 自己捆绑了一个 "Google US English" voice，声音机械沙哑。
 *   macOS 同时提供了更好的系统 voice：Alex、Samantha、Daniel、Serena 等。
 *   关键区分属性：voice.localService === true 是系统原生音（优质），
 *                voice.localService === false 是浏览器捆绑音（沙哑）。
 *
 * 策略：
 *   1. 优先挑选 localService=true 的 en-US voice（macOS 原生音）并显式赋值
 *   2. 没有 localService 音时才退而求其次挑一个（罕见场景）
 *   3. 给 voice 赋值加 600ms watchdog：onstart 没触发就说明 Chrome 静默拒绝了这个 voice，
 *      自动降级为"不设 voice 让浏览器自己选"
 *   4. 调完 pitch 显式设为 1、rate 0.92，避开 Chrome 低语速合成劣化区间
 */

let speakToken = 0;

function safeCancel(synth: SpeechSynthesis) {
  try {
    if (synth.speaking || synth.pending) {
      synth.cancel();
    }
    if (synth.paused) synth.resume();
  } catch {
    /* 忽略 */
  }
}

/** 过滤 + 评分 en-US voice。localService=true 是决定性加分项。 */
function rankVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices
    .filter((v) => {
      const lang = (v.lang || '').toLowerCase();
      return lang === 'en-us'; // 严格 en-US，其他英语一律排除
    })
    .map((v) => {
      const name = (v.name || '').toLowerCase();
      let score = 0;

      // ★ 决定性信号：本地服务 vs 浏览器捆绑
      if (v.localService) score += 100;
      if (!v.localService) score -= 100; // Google 捆绑音直接负分

      // 默认 voice 稍微加一点权重
      if (v.default) score += 10;

      // macOS 原生知名好 voice 的加分
      const KNOWN_GOOD = /\b(alex|samantha|daniel|serena|ava|karen|victoria|monica|tessa|veena|tom|fred)\b/i;
      if (KNOWN_GOOD.test(v.name)) score += 40;

      // 名字里出现 "google" / "compact" / "lite" 继续减
      if (/google/.test(name)) score -= 50;
      if (/compact|lite/.test(name)) score -= 20;

      return { v, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.v);
}

/** 打印当前浏览器可用的 en-US voice 到 console —— 方便诊断 */
function logVoices(voices: SpeechSynthesisVoice[]) {
  const enUs = voices.filter((v) => (v.lang || '').toLowerCase() === 'en-us');
  // eslint-disable-next-line no-console
  console.groupCollapsed('[speech] en-US voices (' + enUs.length + ')');
  for (const v of enUs) {
    // eslint-disable-next-line no-console
    console.log(
      (v.localService ? '🟢' : '🔴'),
      (v.default ? '[DEFAULT]' : '         '),
      v.name,
      '| localService=' + v.localService,
      '| default=' + v.default,
    );
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}

// 模块加载时打印一次
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  const v0 = window.speechSynthesis.getVoices();
  if (v0.length > 0) {
    logVoices(v0);
  } else {
    const onChanged = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) {
        logVoices(v);
        window.speechSynthesis.removeEventListener('voiceschanged', onChanged);
      }
    };
    window.speechSynthesis.addEventListener('voiceschanged', onChanged);
  }
}

export function speakEnglish(
  text: string,
  onChange?: (speaking: boolean) => void,
): void {
  const synth = window.speechSynthesis;
  if (!synth) {
    onChange?.(false);
    return;
  }

  const token = ++speakToken;

  /**
   * 实际 speak 执行。
   * @param assignedVoice 是否显式给 utter.voice 赋值
   * @param voice 被赋值的 voice 对象（assignedVoice=true 时生效）
   */
  const doSpeak = (assignedVoice: boolean, voice?: SpeechSynthesisVoice) => {
    if (token !== speakToken) return;

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = 0.92;  // 避开 0.85~0.9 区间（Chrome 低语速合成劣化）
    utter.pitch = 1;     // 显式默认
    utter.volume = 1;    // 拉满

    if (assignedVoice && voice) {
      utter.voice = voice;
    }

    let started = false;
    utter.onstart = () => {
      if (token === speakToken) {
        started = true;
        onChange?.(true);
      }
    };
    const done = () => {
      if (token === speakToken) onChange?.(false);
    };
    utter.onend = done;
    utter.onerror = (e) => {
      // eslint-disable-next-line no-console
      console.warn('[speech] onerror:', e?.error, 'voice:', assignedVoice ? voice?.name : '(unset)');
      done();
    };

    // Watchdog：650ms 内 onstart 没触发 → Chrome 静默拒绝了这个 voice
    // 降级为"不设 voice 让浏览器自己选"
    const watchdog = setTimeout(() => {
      if (token === speakToken && !started) {
        // eslint-disable-next-line no-console
        console.warn('[speech] onstart timeout, fallback: no voice set');
        doSpeak(false);
      }
    }, 650);

    safeCancel(synth);
    setTimeout(() => {
      if (token !== speakToken) {
        clearTimeout(watchdog);
        return;
      }
      clearTimeout(watchdog);
      safeCancel(synth);
      synth.speak(utter);
    }, 30);
  };

  // 挑出最高分的 voice
  const ranked = rankVoices(synth.getVoices());
  const best = ranked[0];

  if (best) {
    // eslint-disable-next-line no-console
    console.log('[speech] speak → voice:', best.name, '| localService=' + best.localService);
    doSpeak(true, best);
  } else {
    // 没找到 en-US voice，只能让浏览器自己选
    doSpeak(false);
  }
}

/** 离开答题页等场景主动停止朗读 */
export function stopSpeaking(): void {
  speakToken++;
  if ('speechSynthesis' in window) {
    safeCancel(window.speechSynthesis);
  }
}
