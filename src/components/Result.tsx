import { useEffect, useState } from 'react';
import { Check, Clock, Flame, Timer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuizStore, selectCorrectCount } from '@/store/useQuizStore';
import { playAce } from '@/lib/sfx';
import { cn } from '@/lib/utils';

/** 环形进度条周长（r = 54） */
const RING_LENGTH = 2 * Math.PI * 54;

/** 耗时（毫秒）格式化为中文：不足 1 分钟显示秒，否则「X 分 Y 秒」 */
function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} 秒`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min} 分钟` : `${min} 分 ${sec} 秒`;
}

export function Result() {
  const records = useQuizStore((s) => s.records);
  const restart = useQuizStore((s) => s.restart);
  const startQuiz = useQuizStore((s) => s.startQuiz);
  const goHome = useQuizStore((s) => s.goHome);
  const maxCombo = useQuizStore((s) => s.maxCombo);
  const startedAt = useQuizStore((s) => s.startedAt);
  const finishedAt = useQuizStore((s) => s.finishedAt);
  const soundOn = useQuizStore((s) => s.settings.sound);
  const correctCount = useQuizStore(selectCorrectCount);

  const total = records.length;
  const wrongCount = total - correctCount;
  const percent = total ? Math.round((correctCount / total) * 100) : 0;
  const isAce = total > 0 && wrongCount === 0;
  const elapsedMs = startedAt !== null && finishedAt !== null ? finishedAt - startedAt : null;

  const [offset, setOffset] = useState(RING_LENGTH);
  useEffect(() => {
    const raf = requestAnimationFrame(() =>
      setOffset(RING_LENGTH * (1 - percent / 100)),
    );
    return () => cancelAnimationFrame(raf);
  }, [percent]);

  // ACE（全对团灭）：进入结算页播放凯旋音
  useEffect(() => {
    if (isAce && soundOn) playAce();
    // 仅在本轮结果首次呈现时播放
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePracticeWrong = () => {
    const wrong = records
      .filter((r) => !r.correct)
      .map((r) => ({ name: r.name, trans: r.trans }));
    if (wrong.length > 0) startQuiz(wrong, '本轮错题', 'normal');
  };

  return (
    <div className="mt-2 rounded-[18px] bg-card p-5 text-center shadow-[0_8px_30px_rgba(70,100,160,.12)] sm:p-6">
      <h2 className="mb-1 mt-1 text-2xl font-bold">默写完成！</h2>

      {isAce && (
        <div className="ace-banner">
          <div className="ace-en">ACE</div>
          <div className="ace-zh">团灭！本轮全部答对</div>
        </div>
      )}

      <div className="relative mx-auto my-2 h-[150px] w-[150px]">
        <svg width="150" height="150" viewBox="0 0 130 130" className="-rotate-90">
          <circle cx="65" cy="65" r="54" fill="none" strokeWidth="13" className="stroke-[#e7eef8]" />
          <circle
            cx="65"
            cy="65"
            r="54"
            fill="none"
            strokeWidth="13"
            strokeLinecap="round"
            stroke="url(#ringGradient)"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1s ease' }}
          />
          <defs>
            <linearGradient id="ringGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7fb1f8" />
              <stop offset="100%" stopColor="#4a80e0" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <b className="text-4xl">{percent}%</b>
          <span className="text-[13px] text-muted-foreground">总正确率</span>
        </div>
      </div>

      <p className="mb-6 mt-2 text-[15px] text-muted-foreground">
        共 {total} 个单词，答对 {correctCount} 个，答错 {wrongCount} 个
        {maxCombo >= 2 && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border-[1.5px] border-[#f0c98a] bg-[#fff6e6] px-2 py-0.5 text-[12.5px] font-bold text-[#d97706]">
            <Flame className="h-3.5 w-3.5" />
            最高 {maxCombo} 连击
          </span>
        )}
        {elapsedMs !== null && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border-[1.5px] border-[#bcd4f5] bg-[#eef5ff] px-2 py-0.5 text-[12.5px] font-bold text-[#2f6bc0]">
            <Timer className="h-3.5 w-3.5" />
            用时 {formatDuration(elapsedMs)}
          </span>
        )}
      </p>

      <div className="mb-6 flex flex-col gap-2.5 text-left">
        {records.map((r, i) => (
          <div
            key={`${r.name}-${i}`}
            className={cn(
              'flex items-center gap-3 rounded-xl border-[1.5px] px-3.5 py-3',
              r.correct
                ? 'border-[#d3efe1] bg-[#f0faf5]'
                : 'border-[#f6dada] bg-[#fdf3f3]',
            )}
          >
            <span
              className={cn(
                'flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full',
                r.correct ? 'bg-[#d8f2e5] text-success' : 'bg-[#fbe0e1] text-destructive',
              )}
            >
              {r.correct ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {r.trans.length > 0 ? r.trans.join('、') : '（无释义）'}
                </span>
                {r.timeout && (
                  <span className="flex flex-none items-center gap-1 rounded-full bg-[#fbe4d6] px-2 py-0.5 text-[11.5px] font-bold text-[#c2572a]">
                    <Clock className="h-3 w-3" />
                    超时未答
                  </span>
                )}
              </div>
              <div className="mt-0.5 break-all font-hand text-[19px]">
                {r.answer ? (
                  <span className={cn('font-bold', r.correct ? 'text-success' : 'text-destructive')}>
                    {r.answer}
                  </span>
                ) : (
                  <span className="font-bold text-[#b3c0d4]">（未作答）</span>
                )}
                <span className="mx-1 text-[#b3c0d4]">→</span>
                <span className="text-muted-foreground">{r.name}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" className="min-w-[150px] flex-1" onClick={restart}>
          重新开始
        </Button>
        <Button className="min-w-[150px] flex-1" disabled={wrongCount === 0} onClick={handlePracticeWrong}>
          只练错题
        </Button>
        <Button variant="outline" className="min-w-[150px] flex-1" onClick={goHome}>
          返回首页
        </Button>
      </div>
    </div>
  );
}
