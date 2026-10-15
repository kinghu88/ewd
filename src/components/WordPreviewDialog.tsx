import { useState } from 'react';
import { Play, Shuffle, Volume2 } from 'lucide-react';
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
import { speakEnglish } from '@/lib/speech';
import type { WordItem } from '@/lib/types';

interface WordPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 弹窗标题，通常是所选册别/单元说明 */
  title: string;
  /** 按文件顺序合并去重后的全部待默写单词 */
  words: WordItem[];
  /** 是否开启了打乱顺序（仅影响提示文案） */
  shuffled: boolean;
  starting: boolean;
  onStart: () => void;
}

export function WordPreviewDialog({
  open,
  onOpenChange,
  title,
  words,
  shuffled,
  starting,
  onStart,
}: WordPreviewDialogProps) {
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-[17px]">
            单词预览
            <span className="ml-2 align-middle text-[13px] font-normal text-muted-foreground">
              {title} · 共 {words.length} 个
            </span>
          </DialogTitle>
          <DialogXClose />
        </DialogHeader>

        <DialogBody>
          {shuffled && (
            <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-[#fff7e8] px-3 py-2 text-[12.5px] leading-5 text-[#9a6b1f]">
              <Shuffle className="h-3.5 w-3.5 flex-none" />
              已开启打乱顺序，预览按词库原顺序展示，正式默写时随机出题
            </p>
          )}
          <ol>
            {words.map((word, i) => (
              <li
                key={`${word.name.toLowerCase()}-${i}`}
                className="flex items-center gap-2.5 border-b border-dashed border-[#e6edf7] py-2.5 last:border-b-0"
              >
                <span className="w-7 flex-none text-right text-[12.5px] tabular-nums text-[#a8b6cc]">
                  {i + 1}.
                </span>
                <span className="min-w-[92px] font-hand text-xl font-bold">{word.name}</span>
                <span className="flex-1 text-[13.5px] leading-6 text-muted-foreground">
                  {word.trans.join('、')}
                </span>
                <button
                  type="button"
                  aria-label={`朗读 ${word.name}`}
                  onClick={() =>
                    speakEnglish(word.name, (speaking) =>
                      setSpeakingIndex(speaking ? i : null),
                    )
                  }
                  className={`inline-flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full transition-transform active:scale-90 ${
                    speakingIndex === i
                      ? 'animate-pulse bg-primary text-white'
                      : 'bg-[#eaf2ff] text-primary hover:bg-[#dbe8ff]'
                  }`}
                >
                  <Volume2 className="h-[15px] w-[15px]" />
                </button>
              </li>
            ))}
          </ol>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="secondary"
            className="min-w-[110px] flex-1"
            disabled={starting}
            onClick={() => onOpenChange(false)}
          >
            再选选
          </Button>
          <Button className="min-w-[130px] flex-1" disabled={starting} onClick={onStart}>
            <Play className="h-[18px] w-[18px]" />
            {starting ? '加载中…' : `开始默写（${words.length} 个单词）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
