import { cn } from '@/lib/utils';
import { isEnglishLetter, letterClass } from '@/lib/words';

interface LetterCellProps {
  index: number;
  value: string;
  fixed: boolean;
  locked: boolean;
  registerRef: (index: number, el: HTMLInputElement | null) => void;
  /** 写入字母；传空串表示仅清空当前格 */
  onLetter: (index: number, letter: string) => void;
  /** 退格删除（本格空时由 Grid 决定回退目标） */
  onErase: (index: number) => void;
  /** 方向键移动焦点 */
  onArrow: (index: number, dir: -1 | 1) => void;
}

/**
 * 单个四线三格字母单元。
 * 隐形 input 覆盖整格接收键盘/软键盘输入，字母渲染层按占位规则纵向定位。
 */
export function LetterCell({
  index,
  value,
  fixed,
  locked,
  registerRef,
  onLetter,
  onErase,
  onArrow,
}: LetterCellProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (locked) {
      e.preventDefault();
      return;
    }
    // IME 组合中的按键（退格改拼音、回车确认候选词，老浏览器表现为 keyCode 229）交给输入法
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      onErase(index);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      onLetter(index, '');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onArrow(index, -1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onArrow(index, 1);
    }
    // Enter 统一由 Quiz 的 document 级监听处理；普通字母交给 onInput
  };

  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (locked) {
      input.value = '';
      return;
    }
    const native = e.nativeEvent as InputEvent;
    // 组合中（正在拼拼音）忽略且不清空 value，避免干扰输入法；
    // 用原生 isComposing 判断，切输入法丢 compositionend 时也不会卡死首字母
    if (native.isComposing) return;
    // iOS Safari 软键盘删除键不触发 keydown，只发 deleteContentBackward
    if (native.inputType === 'deleteContentBackward') {
      onErase(index);
      return;
    }
    // 取最后一个英文字母，忽略中文 IME 残留与非字母字符
    const ch = Array.from(input.value).filter(isEnglishLetter).pop();
    input.value = '';
    if (!ch) return;
    onLetter(index, ch);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    e.currentTarget.value = '';
  };

  return (
    <div
      className={cn(
        'fl-cell',
        fixed && 'fl-cell-fixed lt-mid',
        !fixed && !value && 'fl-cell-empty',
        value && 'is-filled',
        value && letterClass(value),
      )}
    >
      <span className="fl-ln fl-ln-top" />
      <span className="fl-ln fl-ln-mid" />
      <span className="fl-ln fl-ln-base" />
      <span className="fl-ln fl-ln-bottom" />
      <span className="fl-letter">{value}</span>
      {!fixed && (
        <input
          ref={(el) => registerRef(index, el)}
          className="fl-input"
          type="text"
          inputMode="text"
          maxLength={1}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label={`第${index + 1}个字母`}
          disabled={locked}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onCompositionEnd={handleCompositionEnd}
        />
      )}
    </div>
  );
}
