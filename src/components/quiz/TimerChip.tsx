import { useCountdown } from '@/hooks/useCountdown';
import { useQuizStore } from '@/store/useQuizStore';
import { cn } from '@/lib/utils';

/** 每词限时秒数（如需调整改这里即可） */
const SECONDS_PER_WORD = 30;
/** 进入橙色预警的剩余秒数 */
const WARN_AT = 10;
/** 进入红色紧急状态的剩余秒数 */
const DANGER_AT = 5;

const RING_R = 21;
const RING_LENGTH = 2 * Math.PI * RING_R;

interface TimerChipProps {
  /** 倒计时归零：记为未答并自动进入下一词（由 Quiz 提供） */
  onExpire: () => void;
}

type Phase = 'normal' | 'warn' | 'danger' | 'timeup';

const PHASE_STYLE: Record<Phase, { box: string; ring: string; num: string; bar: string }> = {
  normal: {
    box: 'border-[#cfe0f7] bg-[#f4f9ff]',
    ring: 'stroke-primary',
    num: 'text-primary',
    bar: 'bg-primary',
  },
  warn: {
    box: 'border-[#f0d19a] bg-[#fff8ec]',
    ring: 'stroke-[#f0991f]',
    num: 'text-[#d97706]',
    bar: 'bg-[#f0991f]',
  },
  danger: {
    box: 'border-[#f0a9a9] bg-[#fff0f0]',
    ring: 'stroke-destructive',
    num: 'text-destructive',
    bar: 'bg-destructive',
  },
  timeup: {
    box: 'border-destructive bg-[#ffeaea]',
    ring: 'stroke-destructive',
    num: 'text-destructive',
    bar: 'bg-destructive',
  },
};

/**
 * 每词倒计时（限时模式）。
 * 父组件用 key={index} 挂载，换词自动重置。
 * 紧迫感分三档：蓝（常态）→ 橙（≤10s）→ 红（≤5s，屏幕边缘红光+心跳）；
 * 归零显示全屏「时间到」，由父组件自动判错并跳下一词。
 */
export function TimerChip({ onExpire }: TimerChipProps) {
  const timed = useQuizStore((s) => s.settings.timed);
  const locked = useQuizStore((s) => s.locked);
  const bookOpen = useQuizStore((s) => s.bookOpen);
  const peekActive = useQuizStore((s) => s.peekActive);
  // 错词本打开 / 「查看单词」特效期间暂停；确认锁定后停止（归零瞬间由 onExpire 锁定）
  const { left, ratio } = useCountdown(SECONDS_PER_WORD, timed && !locked && !bookOpen && !peekActive, onExpire);

  if (!timed) return null;

  const phase: Phase = left === 0 ? 'timeup' : left <= DANGER_AT ? 'danger' : left <= WARN_AT ? 'warn' : 'normal';
  const style = PHASE_STYLE[phase];
  const urgent = phase === 'danger';

  return (
    <div className="relative">
      {/* 最后 5 秒：屏幕四周红色呼吸光晕，制造紧迫感 */}
      {urgent && <div className="tmr-vignette" aria-hidden />}
      {/* 归零：全屏红场 + 时间到 */}
      {phase === 'timeup' && (
        <div className="tmr-timeup" aria-hidden>
          <span>时间到</span>
        </div>
      )}

      <div
        className={cn(
          'flex items-center gap-3.5 rounded-2xl border-[1.5px] px-4 py-2.5 transition-colors duration-200',
          style.box,
        )}
      >
        {/* 环形倒计时 + 中央大数字 */}
        <div className={cn('relative h-[52px] w-[52px] flex-none', urgent && 'tmr-heartbeat')}>
          <svg width="52" height="52" viewBox="0 0 52 52" className="-rotate-90">
            <circle cx="26" cy="26" r={RING_R} fill="none" strokeWidth="5" className="stroke-[#e7eef8]" />
            <circle
              cx="26"
              cy="26"
              r={RING_R}
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH * (1 - ratio)}
              className={style.ring}
              style={{ transition: 'stroke-dashoffset .2s linear, stroke .2s' }}
            />
          </svg>
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center text-[20px] font-extrabold tabular-nums',
              style.num,
            )}
          >
            {left}
          </div>
        </div>

        <div className="min-w-0 text-left leading-tight">
          <div className="text-[15.5px] font-bold">
            {phase === 'timeup' ? '本题超时，记为未答' : <>剩余时间 {left} 秒</>}
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            超时未确认将自动判错，并进入下一词
          </div>
        </div>
      </div>

      {/* 时间流逝进度条 */}
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#e7eef8]">
        <div
          className={cn('h-full rounded-full', style.bar)}
          style={{ width: `${Math.max(0, ratio) * 100}%`, transition: 'width .2s linear, background-color .2s' }}
        />
      </div>
    </div>
  );
}
