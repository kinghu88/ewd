/**
 * Web Speech API 朗读封装。
 * 快速连点时用 token 标记本轮朗读链，旧链自然退出，
 * 避免无条件 cancel() 造成的不发声/状态异常。
 */
let speakToken = 0;

export function speakEnglish(
  text: string,
  onChange?: (speaking: boolean) => void,
): void {
  if (!('speechSynthesis' in window)) {
    onChange?.(false);
    return;
  }
  const token = ++speakToken;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = 0.85;
  utter.onend = () => {
    if (token === speakToken) onChange?.(false);
  };
  utter.onerror = () => {
    if (token === speakToken) onChange?.(false);
  };
  onChange?.(true);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

/** 离开答题页等场景主动停止朗读 */
export function stopSpeaking(): void {
  speakToken++;
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
