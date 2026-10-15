import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';
import type { FlashKind } from '@/lib/types';
import {
  findEraseTarget,
  findNextEditable,
  type GridCell,
} from '@/lib/words';
import { useQuizStore } from '@/store/useQuizStore';
import { LetterCell } from './LetterCell';

export interface GridHandle {
  /** 聚焦指定格 */
  focus: (index: number) => void;
  /** 聚焦第一个可编辑格 */
  focusFirst: () => void;
  /** 触发"未填完"抖动反馈 */
  shake: () => void;
}

interface FourLineGridProps {
  /** 当前单词（仅用于换词时重置焦点） */
  wordName: string;
  cells: GridCell[];
  locked: boolean;
  flash: FlashKind | null;
}

/**
 * 四线三格书写区：逐格输入、自动跳格、退格回删。
 * 焦点管理通过命令式 handle 暴露给父组件（确认前定位空格、失焦兜底删除等）。
 */
export const FourLineGrid = forwardRef<GridHandle, FourLineGridProps>(
  function FourLineGrid({ wordName, cells, locked, flash }, ref) {
    const setLetter = useQuizStore((s) => s.setLetter);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const [shaking, setShaking] = useState(false);
    const shakeTimer = useRef<ReturnType<typeof setTimeout>>();
    // 删除双发去重（个别安卓浏览器 keydown 后仍补发一次 input 删除事件）
    const lastErase = useRef<{ index: number; time: number }>({ index: -1, time: 0 });

    const focus = useCallback((index: number) => {
      const el = inputRefs.current[index];
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }, []);

    const focusFirst = useCallback(() => {
      const first = cells.findIndex((c) => !c.fixed);
      if (first >= 0) focus(first);
    }, [cells, focus]);

    const shake = useCallback(() => {
      setShaking(false);
      // 先复位再置位，保证连续触发时动画能重启
      requestAnimationFrame(() => setShaking(true));
      clearTimeout(shakeTimer.current);
      shakeTimer.current = setTimeout(() => setShaking(false), 420);
    }, []);

    useImperativeHandle(ref, () => ({ focus, focusFirst, shake }), [
      focus,
      focusFirst,
      shake,
    ]);

    // 换词（不是每次输入）后自动聚焦第一格；触屏不抢焦，避免弹键盘遮挡
    useEffect(() => {
      if (!('ontouchstart' in window)) focusFirst();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wordName]);

    useEffect(() => () => clearTimeout(shakeTimer.current), []);

    const registerRef = useCallback((index: number, el: HTMLInputElement | null) => {
      inputRefs.current[index] = el;
    }, []);

    const handleLetter = useCallback(
      (i: number, ch: string) => {
        setLetter(i, ch);
        if (!ch) return; // Delete 清空当前格：不移动焦点
        const n = findNextEditable(cells, i);
        if (n >= 0) {
          focus(n);
        } else {
          inputRefs.current[i]?.blur(); // 最后一格：收起软键盘，等待确认
        }
      },
      [cells, focus, setLetter],
    );

    const handleErase = useCallback(
      (i: number) => {
        const target = findEraseTarget(cells, i);
        if (target < 0) return;
        const now = Date.now();
        if (target === lastErase.current.index && now - lastErase.current.time < 80) return;
        lastErase.current = { index: target, time: now };
        setLetter(target, '');
        if (target !== i) focus(target);
      },
      [cells, focus, setLetter],
    );

    const handleArrow = useCallback(
      (i: number, dir: -1 | 1) => {
        for (let k = i + dir; k >= 0 && k < cells.length; k += dir) {
          if (!cells[k].fixed) {
            focus(k);
            break;
          }
        }
      },
      [cells, focus],
    );

    return (
      <div className="fl-grid-scroll">
        <div
          className={cn(
            'fl-grid',
            locked && 'locked',
            shaking && 'shake',
            flash === 'ok' && 'flash-ok',
            flash === 'bad' && 'flash-bad',
          )}
        >
          {cells.map((cell, i) => (
            <LetterCell
              key={i}
              index={i}
              value={cell.letter}
              fixed={cell.fixed}
              locked={locked}
              registerRef={registerRef}
              onLetter={handleLetter}
              onErase={handleErase}
              onArrow={handleArrow}
            />
          ))}
        </div>
      </div>
    );
  },
);
