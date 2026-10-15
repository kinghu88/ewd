import { useEffect, useState } from 'react';
import { Coins, Sparkles, Trophy } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogXClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { rewardsApi, type ServerRewards } from '@/lib/api';

interface RewardsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RewardsModal({ open, onOpenChange }: RewardsModalProps) {
  const [rewards, setRewards] = useState<ServerRewards>({ coins: 0, runs: 0 });

  useEffect(() => {
    if (!open) return;
    rewardsApi
      .get()
      .then(setRewards)
      .catch(() => undefined);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-[#e08a1e]" />
            我的奖励
          </DialogTitle>
          <DialogXClose />
        </DialogHeader>

        <DialogBody>
          <div className="flex gap-3">
            <div className="flex flex-1 items-center gap-3 rounded-2xl border-[1.5px] border-[#f3d8a4] bg-[#fffaf0] px-4 py-3.5">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ffe9bf]">
                <Coins className="h-6 w-6 text-[#e08a1e]" />
              </span>
              <div>
                <p className="text-[22px] font-extrabold leading-none text-[#d97706]">
                  {rewards.coins}
                </p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">金币</p>
              </div>
            </div>
            <div className="flex flex-1 items-center gap-3 rounded-2xl border-[1.5px] border-[#dce7f6] bg-[#f8fbff] px-4 py-3.5">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eaf2ff]">
                <Trophy className="h-6 w-6 text-primary" />
              </span>
              <div>
                <p className="text-[22px] font-extrabold leading-none text-primary">
                  {rewards.runs}
                </p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">累计通关轮数</p>
              </div>
            </div>
          </div>

          <h3 className="mb-2.5 mt-5 flex items-center gap-1.5 text-[14.5px] font-bold">
            <Sparkles className="h-4 w-4 text-[#e08a1e]" />
            通关红包概率
          </h3>
          <p className="text-[12.5px] leading-5 text-muted-foreground">
            每轮 3 个红包中有且仅有 <b className="text-[#9a6414]">1 个藏着金币</b>，另外 2
            个是鼓励成语；金币数额随机，数额越大越稀有，最高 100 金币。
          </p>
        </DialogBody>

        <DialogFooter>
          <Button className="min-w-[130px] flex-1" onClick={() => onOpenChange(false)}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
