import { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
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
import { useQuizStore } from '@/store/useQuizStore';
import {
  clearBook,
  getBookEntries,
  removeWrongWord,
} from '@/lib/storage';
import { speakEnglish } from '@/lib/speech';
import type { WrongBookEntry } from '@/lib/types';

export function WrongBookModal() {
  const open = useQuizStore((s) => s.bookOpen);
  const setOpen = useQuizStore((s) => s.setBookOpen);
  const startQuiz = useQuizStore((s) => s.startQuiz);
  const bookVersion = useQuizStore((s) => s.bookVersion);
  const refreshBook = useQuizStore((s) => s.refreshBook);

  const [entries, setEntries] = useState<WrongBookEntry[]>([]);
  const [speakingWord, setSpeakingWord] = useState<string | null>(null);

  useEffect(() => {
    if (open) setEntries(getBookEntries());
  }, [open, bookVersion]);

  const handleRemove = (name: string) => {
    removeWrongWord(name);
    refreshBook();
  };

  const handleClear = () => {
    if (entries.length === 0) return;
    if (window.confirm('确定清空全部错词吗？')) {
      clearBook();
      refreshBook();
    }
  };

  const handlePractice = () => {
    if (entries.length === 0) return;
    const words = entries.map((e) => ({ name: e.name, trans: e.trans }));
    setOpen(false);
    startQuiz(words, '错词本', 'normal');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>错词本</DialogTitle>
          <DialogXClose />
        </DialogHeader>

        <DialogBody>
          {entries.length === 0 ? (
            <div className="py-9 text-center text-[14.5px] text-muted-foreground">
              还没有错词，继续加油！
            </div>
          ) : (
            entries.map((item) => (
              <div
                key={item.name.toLowerCase()}
                className="flex items-center gap-2.5 border-b border-dashed border-[#e6edf7] py-2.5 last:border-b-0"
              >
                <span className="min-w-[92px] font-hand text-xl font-bold">{item.name}</span>
                <span className="flex-1 text-[13.5px] text-muted-foreground">
                  {item.trans.join('、')}
                </span>
                <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs text-destructive">
                  错 {item.wrongCount} 次
                </span>
                <button
                  type="button"
                  aria-label={`朗读 ${item.name}`}
                  onClick={() =>
                    speakEnglish(item.name, (speaking) =>
                      setSpeakingWord(speaking ? item.name : null),
                    )
                  }
                  className={`inline-flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full transition-transform active:scale-90 ${
                    speakingWord === item.name
                      ? 'animate-pulse bg-primary text-white'
                      : 'bg-[#eaf2ff] text-primary hover:bg-[#dbe8ff]'
                  }`}
                >
                  <Volume2 className="h-[15px] w-[15px]" />
                </button>
                <button
                  type="button"
                  aria-label={`移除 ${item.name}`}
                  onClick={() => handleRemove(item.name)}
                  className="px-2 py-1 text-lg leading-none text-[#b6c2d6] hover:text-destructive"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" className="min-w-[130px] flex-1" onClick={handleClear}>
            清空错词本
          </Button>
          <Button className="min-w-[130px] flex-1" disabled={entries.length === 0} onClick={handlePractice}>
            练习错词
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
