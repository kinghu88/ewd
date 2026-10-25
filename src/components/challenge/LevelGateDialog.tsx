import { useState } from 'react';
import { ArrowRight, CheckCircle2, Heart, HeartCrack, Home, Trophy } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getUnitRewardTier, SECOND_COIN_PACKET_THRESHOLD } from '@/lib/rewards';
import { useQuizStore } from '@/store/useQuizStore';
import { RedPacketDialog } from './RedPacketDialog';

/** 闯关结算弹层：过关 / 失败 / 全部通关（通关后进入幸运红包） */
export function LevelGateDialog() {
  const gate = useQuizStore((s) => s.gate);
  const levelIndex = useQuizStore((s) => s.levelIndex);
  const levelCount = useQuizStore((s) => s.levelCount);
  const levels = useQuizStore((s) => s.levels);
  const currentLevelTitle = levels[levelIndex]?.title ?? '';
  const nextLevelTitle = levels[levelIndex + 1]?.title ?? '';
  const lives = useQuizStore((s) => s.lives);
  const initialLives = useQuizStore((s) => s.initialLives);
  const challengeReward = useQuizStore((s) => s.challengeReward);
  const nextLevel = useQuizStore((s) => s.nextLevel);
  const retryLevel = useQuizStore((s) => s.retryLevel);
  const finishRun = useQuizStore((s) => s.finishRun);
  const goHome = useQuizStore((s) => s.goHome);

  const [packetOpen, setPacketOpen] = useState(false);

  return (
    <>
      <Dialog
        open={gate !== null && !packetOpen}
        onOpenChange={(v) => {
          // 结算弹层不允许点击遮罩关闭，必须做出选择
          if (!v) return;
        }}
      >
        <DialogContent className="max-w-[380px]">
          <DialogBody className="pb-6 pt-8 text-center">
            {gate === 'pass' && (
              <>
                <span className="gate-pop mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#e3f6ec]">
                  <CheckCircle2 className="h-11 w-11 text-success" />
                </span>
                <h2 className="mt-4 text-[22px] font-extrabold">
                  第 {levelIndex + 1} 关{currentLevelTitle ? ` · ${currentLevelTitle}` : ''} 通过！
                </h2>
                <p className="mt-2 flex flex-wrap items-center justify-center gap-1 text-[14px] text-muted-foreground">
                  还剩
                  {Array.from({ length: initialLives }, (_, i) => (
                    <Heart
                      key={i}
                      className={`h-[18px] w-[18px] ${i < lives ? 'fill-[#ef5a6a] text-[#ef5a6a]' : 'text-[#d4dce8]'}`}
                    />
                  ))}
                  {challengeReward.fullGrade ? '，整轮生命继续保留，继续冲下一关' : '，继续冲下一关'}
                </p>
                <Button size="lg" className="mt-6 w-full" onClick={nextLevel}>
                  {nextLevelTitle
                    ? `进入下一关：${nextLevelTitle}`
                    : `进入第 ${levelIndex + 2} 关`}
                  <ArrowRight className="h-[18px] w-[18px]" />
                </Button>
              </>
            )}

            {gate === 'fail' && (
              <>
                <span className="gate-pop mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#fde8ea]">
                  <HeartCrack className="h-11 w-11 text-destructive" />
                </span>
                <h2 className="mt-4 text-[22px] font-extrabold">
                  {challengeReward.fullGrade
                    ? '整年级挑战失败'
                    : `第 ${levelIndex + 1} 关${currentLevelTitle ? ` · ${currentLevelTitle}` : ''} 挑战失败`}
                </h2>
                <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                  {challengeReward.fullGrade ? (
                    <>
                      整轮 {initialLives} 颗心已全部用完，本次闯关结束。
                      <br />
                      整年级模式下小关卡失败不可重试，答错的单词已收入错词本
                    </>
                  ) : (
                    <>
                      {initialLives} 颗心都用完了，别灰心！
                      <br />
                      本关答错的单词已收入错词本，再来一次一定能过
                    </>
                  )}
                </p>
                {challengeReward.fullGrade ? (
                  <div className="mt-6 flex gap-3">
                    <Button variant="outline" size="lg" className="flex-1" onClick={goHome}>
                      <Home className="h-[18px] w-[18px]" />
                      返回首页
                    </Button>
                    <Button size="lg" className="flex-[1.4]" onClick={finishRun}>
                      查看战绩
                    </Button>
                  </div>
                ) : (
                  <div className="mt-6 flex gap-3">
                    <Button variant="outline" size="lg" className="flex-1" onClick={goHome}>
                      <Home className="h-[18px] w-[18px]" />
                      返回首页
                    </Button>
                    <Button size="lg" className="flex-[1.4]" onClick={retryLevel}>
                      重新挑战本关
                    </Button>
                  </div>
                )}
              </>
            )}

            {gate === 'complete' && (
              <>
                <span className="gate-pop mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#fff0d4]">
                  <Trophy className="h-11 w-11 text-[#e08a1e]" />
                </span>
                <h2 className="mt-4 text-[22px] font-extrabold">恭喜全部通关！</h2>
                <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                  你已闯过全部 {levelCount} 关
                  <br />
                  {challengeReward.fullGrade ? (
                    <>
                      <b className="text-[#e08a1e]">整年级奖励：3 个红包全部有金币</b>
                      <br />
                      其中 1 个至少 10 金币，单个红包最高 100 金币
                    </>
                  ) : challengeReward.unitCount > SECOND_COIN_PACKET_THRESHOLD ? (
                    <>
                      已选 <b className="text-[#e08a1e]">{challengeReward.unitCount} 个单元</b>，
                      3 个红包中有 <b className="text-[#e08a1e]">2 个藏着金币</b>
                      <br />
                      单包 ×{getUnitRewardTier(challengeReward.unitCount).multiplier}
                      （最高 100 金币），点任意红包全部拆开
                    </>
                  ) : challengeReward.unitCount > 1 ? (
                    <>
                      已选 <b className="text-[#e08a1e]">{challengeReward.unitCount} 个单元</b>，
                      金币红包 ×{getUnitRewardTier(challengeReward.unitCount).multiplier} 加成
                      <br />
                      3 个红包中藏着 1 份金币，单个红包最高 100 金币
                    </>
                  ) : (
                    <>
                      3 个红包中藏着 <b className="text-[#e08a1e]">1 份金币</b>
                      ，试试手气，最高 100 金币
                    </>
                  )}
                </p>
                <Button size="lg" className="mt-6 w-full" onClick={() => setPacketOpen(true)}>
                  <Trophy className="h-[18px] w-[18px]" />
                  立即拆红包
                </Button>
                <button
                  type="button"
                  onClick={goHome}
                  className="mt-3 text-[13px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                >
                  返回首页（放弃本次红包）
                </button>
              </>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <RedPacketDialog
        open={gate === 'complete' && packetOpen}
        reward={challengeReward}
        onClose={() => {
          setPacketOpen(false);
          finishRun();
        }}
      />
    </>
  );
}
