import { useEffect, useRef, useState } from 'react';
import { Coins, Gift, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { drawPacketLayout, type PacketSlot } from '@/lib/rewards';
import { rewardsApi } from '@/lib/api';
import { playPacketMiss, playPacketPick, playPacketWin } from '@/lib/sfx';
import { useQuizStore } from '@/store/useQuizStore';

interface RedPacketDialogProps {
  open: boolean;
  /** 揭晓并结算后关闭（由父组件进入战绩页） */
  onClose: () => void;
}

const PACKET_COUNT = 3;

export function RedPacketDialog({ open, onClose }: RedPacketDialogProps) {
  const soundOn = useQuizStore((s) => s.settings.sound);
  const bumpRewards = useQuizStore((s) => s.bumpRewards);

  /** 本轮红包布局：打开弹窗时预生成，3 个中有且仅有 1 个金币红包 */
  const [layout, setLayout] = useState<PacketSlot[]>(() => drawPacketLayout(PACKET_COUNT));
  /** 已翻开的红包下标集合 */
  const [flipped, setFlipped] = useState<number[]>([]);
  /** 正在上弹（尚未翻转）的红包下标 */
  const [hopping, setHopping] = useState<number | null>(null);
  /** 用户选中的红包下标 */
  const [picked, setPicked] = useState<number | null>(null);
  /** 金币到账请求中 / 失败 */
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState(false);
  /** 整个揭晓流程完成（其余红包也已翻开） */
  const [allRevealed, setAllRevealed] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const grantToken = useRef(0);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // 每次打开重置并重新洗牌（一轮通关只有一次拆红包机会）
  useEffect(() => {
    if (open) {
      setLayout(drawPacketLayout(PACKET_COUNT));
      setFlipped([]);
      setHopping(null);
      setPicked(null);
      setGranting(false);
      setGrantError(false);
      setAllRevealed(false);
      grantToken.current = 0;
    }
    return clearTimers;
  }, [open]);

  /** 把选中红包的金币落库，失败可重试；成语红包不发金币 */
  const claim = async (coins: number | null, token: number) => {
    if (coins === null) return;
    setGranting(true);
    setGrantError(false);
    try {
      await rewardsApi.grant(coins);
      if (token !== grantToken.current) return; // 弹窗已重置 / 关闭
      bumpRewards();
      setGranting(false);
    } catch {
      if (token === grantToken.current) {
        setGranting(false);
        setGrantError(true);
      }
    }
  };

  /** 翻开另外两个红包（展示本轮真实布局：可能正好露出错过的金币） */
  const revealOthers = (token: number, chosen: number) => {
    if (token !== grantToken.current) return;
    const others = Array.from({ length: PACKET_COUNT }, (_, i) => i).filter((i) => i !== chosen);
    others.forEach((i, k) => {
      timers.current.push(
        setTimeout(() => {
          if (token === grantToken.current) setFlipped((prev) => [...prev, i]);
        }, 250 * (k + 1)),
      );
    });
    timers.current.push(
      setTimeout(() => {
        if (token === grantToken.current) setAllRevealed(true);
      }, 250 * (others.length + 2)),
    );
  };

  const handlePick = (index: number) => {
    if (picked !== null || granting) return;
    const token = ++grantToken.current;
    const slot = layout[index];
    const coins = slot.kind === 'coin' ? slot.coins : null;

    setPicked(index);
    setHopping(index);
    if (soundOn) playPacketPick();

    // 上弹 0.5s 后开始翻转；翻转到一半（约 0.3s）时定帧播放结果音
    timers.current.push(
      setTimeout(() => {
        if (token !== grantToken.current) return;
        setHopping(null);
        setFlipped([index]);
      }, 500),
    );
    timers.current.push(
      setTimeout(() => {
        if (token !== grantToken.current) return;
        if (soundOn) {
          if (coins === null) playPacketMiss();
          else playPacketWin();
        }
      }, 850),
    );
    // 结果定格后：金币请求到账（与动画并行），再翻开其余两个红包
    void claim(coins, token);
    timers.current.push(setTimeout(() => revealOthers(token, index), 1500));
  };

  const retryClaim = () => {
    if (picked === null) return;
    const slot = layout[picked];
    if (slot.kind !== 'coin') return;
    void claim(slot.coins, grantToken.current);
  };

  const chosenSlot = picked !== null ? layout[picked] : null;
  const canClose = allRevealed && !granting && !grantError;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && canClose && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-[420px]">
        <DialogHeader className="justify-center">
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-[#e0463c]" />
            幸运红包
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 pb-5 pt-2 text-center">
          <p className="mb-5 text-[13.5px] text-muted-foreground">
            恭喜通关！<b className="text-[#e0463c]">3 个红包中有 1 个藏着金币</b>
            ，选一个点开试试手气
          </p>

          <div className="flex items-start justify-center gap-3 sm:gap-5">
            {layout.map((slot, i) => {
              const isFlipped = flipped.includes(i);
              const isPicked = picked === i;
              return (
                <div className="packet-scene" key={i}>
                  <button
                    type="button"
                    disabled={picked !== null}
                    onClick={() => handlePick(i)}
                    aria-label={`红包 ${i + 1}`}
                    className={[
                      'packet',
                      isFlipped ? 'is-flipped' : '',
                      hopping === i ? 'is-hopping' : '',
                      picked !== null && !isPicked && !isFlipped ? 'is-dimmed' : '',
                    ].join(' ')}
                    style={{ animationDelay: `${i * 0.35}s` }}
                  >
                    {/* 正面：未拆开的红包 */}
                    <span className="packet-face packet-front">
                      <span className="packet-seal">福</span>
                      <span className="packet-front-label">開</span>
                    </span>
                    {/* 背面：金币或鼓励成语 */}
                    <span className="packet-face packet-back">
                      <span className="packet-result">
                        {slot.kind === 'coin' ? (
                          <>
                            <Coins className="h-7 w-7 text-[#e08a1e]" />
                            <span className="packet-result-amount">+{slot.coins}</span>
                            <span className="packet-result-text">金币</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-7 w-7 text-[#aab7c9]" />
                            <span className="packet-result-cheer">{slot.idiom}</span>
                          </>
                        )}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {picked !== null && flipped.includes(picked) && chosenSlot && (
            <div className="prize-card mx-auto mt-5 flex max-w-[320px] items-center gap-3 rounded-2xl border-[1.5px] border-[#f3d8a4] bg-[#fffaf0] px-4 py-2.5 text-left">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[#ffe9bf]">
                {chosenSlot.kind === 'coin' ? (
                  <Coins className="h-6 w-6 text-[#e08a1e]" />
                ) : (
                  <Sparkles className="h-6 w-6 text-[#aab7c9]" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                {chosenSlot.kind === 'coin' ? (
                  <>
                    <p className="text-[15px] font-extrabold text-[#d97706]">
                      +{chosenSlot.coins} 金币
                      {granting ? '（领取中…）' : ''}
                    </p>
                    <p className="text-[12.5px] text-muted-foreground">
                      {grantError ? '领取失败，请重试' : '金币已存入「我的奖励」'}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[15px] font-extrabold text-[#7a869a]">
                      {chosenSlot.idiom}！
                    </p>
                    <p className="text-[12.5px] text-muted-foreground">
                      金币藏在另外的红包里啦，下次一定抽中
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {grantError && (
            <Button variant="outline" size="sm" className="mt-3" onClick={retryClaim}>
              重新领取金币
            </Button>
          )}

          <Button
            className="mt-4 min-w-[180px]"
            size="lg"
            disabled={!canClose}
            onClick={onClose}
          >
            {picked === null
              ? '请先选择一个红包'
              : !allRevealed
                ? '红包揭晓中…'
                : '查看战绩'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
