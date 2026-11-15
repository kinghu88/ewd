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
  /** 把焦点还给最近激活的格子；不可用时退化为 focusFirst */
  refocus: () => void;
}

interface FourLineGridProps {
  /** 当前单词（仅用于换词时重置焦点） */
  wordName: string;
  cells: GridCell[];
  locked: boolean;
  flash: FlashKind | null;
  /** 跳过/超时后，正确答案已写入 cells，需要醒目高亮展示 */
  revealed?: boolean;
}

/**
 * 四线三格书写区：逐格输入、自动跳格、退格回删。
 * 焦点管理通过命令式 handle 暴露给父组件（确认前定位空格、失焦兜底删除等）。
 */
export const FourLineGrid = forwardRef<GridHandle, FourLineGridProps>(
  function FourLineGrid({ wordName, cells, locked, flash, revealed }, ref) {
    const setLetter = useQuizStore((s) => s.setLetter);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const [shaking, setShaking] = useState(false);
    const shakeTimer = useRef<ReturnType<typeof setTimeout>>();
    // 删除双发去重（个别安卓浏览器 keydown 后仍补发一次 input 删除事件）
    const lastErase = useRef<{ index: number; time: number }>({ index: -1, time: 0 });
    /** 最近一次被用户聚焦的格子索引；用于外部操作后把焦点还给它 */
    const activeIndex = useRef(-1);

    const focus = useCallback((index: number) => {
      const el = inputRefs.current[index];
      if (el) {
        el.focus();
        activeIndex.current = index;
        el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }, []);

    const focusFirst = useCallback(() => {
      const first = cells.findIndex((c) => !c.fixed);
      if (first >= 0) focus(first);
    }, [cells, focus]);

    /** 外部调用：把焦点还给最近激活的可编辑格；被锁定或索引失效时退化为 focusFirst */
    const refocus = useCallback(() => {
      if (locked) return; // 锁定期间（确认后等待换词）不抢焦
      const idx = activeIndex.current;
      if (idx >= 0 && idx < cells.length && !cells[idx].fixed) {
        const el = inputRefs.current[idx];
        if (el && !el.disabled) {
          el.focus();
          return;
        }
      }
      focusFirst();
    }, [cells, locked, focusFirst]);

    /** 子 cell 汇报用户聚焦事件（只记录，不主动 focus） */
    const handleCellFocus = useCallback((i: number) => {
      activeIndex.current = i;
    }, []);

    const shake = useCallback(() => {
      setShaking(false);
      // 先复位再置位，保证连续触发时动画能重启
      requestAnimationFrame(() => setShaking(true));
      clearTimeout(shakeTimer.current);
      shakeTimer.current = setTimeout(() => setShaking(false), 420);
    }, []);

    useImperativeHandle(ref, () => ({ focus, focusFirst, shake, refocus }), [
      focus,
      focusFirst,
      shake,
      refocus,
    ]);

    // 换词：重置 activeIndex 并自动聚焦第一格；触屏不抢焦，避免弹键盘遮挡
    useEffect(() => {
      activeIndex.current = -1;
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
        }
        // 最后一格：保持焦点停在原位，等用户 Enter 或点确认；
        // 由全局 refocus 机制统一处理外部点击后的焦点回归
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
      <div className={cn('fl-grid-scroll', revealed && 'revealed')}>
        <div
          className={cn(
            'fl-grid',
            locked && 'locked',
            shaking && 'shake',
            flash === 'ok' && 'flash-ok',
            flash === 'bad' && 'flash-bad',
            revealed && 'revealed',
          )}
        >
          {cells.map((cell, i) => (
            <LetterCell
              key={i}
              index={i}
              value={cell.letter}
              fixed={cell.fixed}
              locked={locked}
              revealed={revealed && !cell.fixed && !!cell.letter}
              registerRef={registerRef}
              onLetter={handleLetter}
              onErase={handleErase}
              onArrow={handleArrow}
              onFocusCell={handleCellFocus}
            />
          ))}
        </div>
      </div>
    );
  },
);
