import { useEffect, useRef, useState } from 'react';

export interface CountdownState {
  /** 剩余整秒（向上取整；显示与结算共用同一时间源） */
  left: number;
  /** 剩余比例 0~1，用于进度环 / 进度条 */
  ratio: number;
}

/**
 * 每词倒计时（限时模式，默认不开启）。
 *
 * - 时间戳驱动：deadline = now + remaining，切后台、掉帧、定时器节流都不会漂移；
 * - 支持暂停：active 变 false 时冻结剩余时间，恢复后接着跑（如打开错词本期间不计时）；
 * - 父组件用 key={index} 重挂载，实现换词后重新倒计时；
 * - onExpire 每轮至多触发一次。
 */
export function useCountdown(
  duration: number,
  active: boolean,
  onExpire?: () => void,
): CountdownState {
  const totalMs = duration * 1000;
  const remainingRef = useRef(totalMs);
  const deadlineRef = useRef(0);
  const expiredRef = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  const [state, setState] = useState<CountdownState>({ left: duration, ratio: 1 });

  useEffect(() => {
    if (!active) return;
    // 恢复计时：用冻结的剩余时间重设截止时刻
    deadlineRef.current = Date.now() + remainingRef.current;

    const tick = () => {
      const remainingMs = Math.max(0, deadlineRef.current - Date.now());
      remainingRef.current = remainingMs;
      const left = Math.ceil(remainingMs / 1000);
      setState({ left, ratio: remainingMs / totalMs });
      if (remainingMs <= 0) {
        clearInterval(timer);
        if (!expiredRef.current) {
          expiredRef.current = true;
          expireRef.current?.();
        }
      }
    };

    const timer = setInterval(tick, 200);
    tick();
    return () => {
      clearInterval(timer);
      // 暂停瞬间冻结剩余时间，避免停表期间白白流失
      remainingRef.current = Math.max(0, deadlineRef.current - Date.now());
    };
  }, [active, totalMs]);

  return state;
}
