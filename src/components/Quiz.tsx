import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookText, Crosshair, Flame, Heart, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { levelRange, useQuizStore, selectCorrectCount } from '@/store/useQuizStore';
import { speakEnglish, stopSpeaking } from '@/lib/speech';
import { playCorrect, playFirstBlood, playWrong } from '@/lib/sfx';
import { FIRST_BLOOD, tierOf, type ComboTier } from '@/lib/combo';
import { ApiError, shopApi } from '@/lib/api';
import { PEEK_SKU } from '@/lib/shop';
import { FourLineGrid, type GridHandle } from './quiz/FourLineGrid';
import { TimerChip } from './quiz/TimerChip';
import { ComboBanner, type ComboAnnounce } from './quiz/ComboBanner';
import { LevelGateDialog } from './challenge/LevelGateDialog';
import { cn } from '@/lib/utils';
import type { FlashKind } from '@/lib/types';

export function Quiz() {
  const words = useQuizStore((s) => s.words);
  const index = useQuizStore((s) => s.index);
  const cells = useQuizStore((s) => s.cells);
  const locked = useQuizStore((s) => s.locked);
  const records = useQuizStore((s) => s.records);
  const sourceLabel = useQuizStore((s) => s.sourceLabel);
  const correctCount = useQuizStore(selectCorrectCount);

  const timed = useQuizStore((s) => s.settings.timed);
  const soundOn = useQuizStore((s) => s.settings.sound);
  const combo = useQuizStore((s) => s.combo);
  const mode = useQuizStore((s) => s.mode);
  const levelIndex = useQuizStore((s) => s.levelIndex);
  const levelCount = useQuizStore((s) => s.levelCount);
  const levels = useQuizStore((s) => s.levels);
  const lives = useQuizStore((s) => s.lives);
  const initialLives = useQuizStore((s) => s.initialLives);
  const challengeReward = useQuizStore((s) => s.challengeReward);
  const setSetting = useQuizStore((s) => s.setSetting);
  const setLetter = useQuizStore((s) => s.setLetter);
  const clearLetters = useQuizStore((s) => s.clearLetters);
  const judge = useQuizStore((s) => s.judge);
  const judgeTimeout = useQuizStore((s) => s.judgeTimeout);
  const skip = useQuizStore((s) => s.skip);
  const advance = useQuizStore((s) => s.advance);
  const goHome = useQuizStore((s) => s.goHome);
  const showToast = useQuizStore((s) => s.showToast);
  const setBookOpen = useQuizStore((s) => s.setBookOpen);
  const inventory = useQuizStore((s) => s.inventory);
  const setCoins = useQuizStore((s) => s.setCoins);
  const setInventory = useQuizStore((s) => s.setInventory);
  const refreshShop = useQuizStore((s) => s.refreshShop);

  const gridRef = useRef<GridHandle>(null);
  const [flash, setFlash] = useState<FlashKind | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [announce, setAnnounce] = useState<ComboAnnounce | null>(null);
  /** 使用道具的二次确认态（防止误点误花金币） */
  const [peekArmed, setPeekArmed] = useState(false);
  /** 「查看单词」打字机揭示动画进行中 */
  const [peeking, setPeeking] = useState(false);
  /** 跳过 / 超时后把正确答案显式"亮"在四线格里的视觉态 */
  const [revealed, setRevealed] = useState(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>();
  const announceTimer = useRef<ReturnType<typeof setTimeout>>();
  const announceKey = useRef(0);
  /** 打字机逐字揭示的定时器队列，换词/卸载时统一清理 */
  const peekTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ===== 焦点持久化守护 =====
  // 任何发生在四线格外部的点击（按钮、音效开关、错词本、播放读音等）都会延迟把焦点还给四线格，
  // 使用户无需再手动点一下格子即可继续输入。弹层打开或确认锁定期间不抢焦；
  // 但在这些状态解除后（例如关闭 Dialog）会补做一次 refocus。
  useEffect(() => {
    const insideGrid = (el: EventTarget | null): boolean => {
      if (!(el instanceof Element)) return false;
      return el.closest('.fl-grid-scroll') !== null;
    };

    const handler = (e: MouseEvent) => {
      // 点击发生在四线格内部，无需处理
      if (insideGrid(e.target)) return;

      const scheduleRefocus = () => {
        // 比 rAF 稍晚：让 click 冒泡、onClick、状态更新等都跑完
        setTimeout(() => {
          const s = useQuizStore.getState();
          if (s.bookOpen || s.locked) return;
          gridRef.current?.refocus();
        }, 0);
      };

      const s = useQuizStore.getState();
      if (s.bookOpen) {
        // Dialog 打开中：点击内部按钮/遮罩/X 都可能关闭它；在关闭后的下一轮事件里补 refocus
        scheduleRefocus();
        return;
      }
      if (s.locked) {
        // 确认后等待换词：advance 会解除锁定并由 FourLineGrid 内部的 wordName 变化重新聚焦第一格，
        // 这里不需要额外 refocus
        return;
      }
      scheduleRefocus();
    };

    // capture 阶段更早捕获，避免业务代码 stopPropagation 截断
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  /** 触发一次连击播报（每次都重启动画） */
  const fireAnnounce = useCallback((tier: ComboTier) => {
    announceKey.current += 1;
    setAnnounce({ key: announceKey.current, tier });
    clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnounce(null), 1300);
  }, []);

  const word = words[index];
  const total = words.length;
  const answered = records.length;
  const accuracy = answered ? Math.round((correctCount / answered) * 100) : 0;
  const isChallenge = mode === 'challenge';

  // 闯关模式：进度条只展示当前关（当前单元）的进度
  const { start: levelStart, end: levelEnd } = levelRange(levels, levelIndex);
  const levelTotal = levelEnd - levelStart;
  const levelAnswered = Math.min(Math.max(records.length - levelStart, 0), levelTotal);
  const progressPercent = isChallenge
    ? (levelAnswered / levelTotal) * 100
    : (answered / total) * 100;

  /** 「查看单词」持有数量（服务端权威） */
  const peekCount = inventory[PEEK_SKU] ?? 0;

  /**
   * 消耗「查看单词」道具：服务端原子扣减成功后，用打字机效果把正确字母逐个写入四线格。
   */
  const usePeekItem = useCallback(async () => {
    if (locked || peeking) return;
    try {
      const res = await shopApi.consumeItem(PEEK_SKU, `${useQuizStore.getState().sourceLabel}｜${word.name}`);
      const current = useQuizStore.getState().inventory;
      setCoins(res.coins);
      setInventory({ ...current, [PEEK_SKU]: res.remaining });
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '道具使用失败，请稍后再试');
      void refreshShop();
      return;
    }
    setPeekArmed(false);

    // 先清空用户已填的字母，让打字机从空白格开始逐字敲入
    const state = useQuizStore.getState();
    const targets: number[] = [];
    state.cells.forEach((cell, i) => {
      if (!cell.fixed) targets.push(i);
    });
    const cleared = state.cells.map((cell) =>
      cell.fixed ? cell : { ...cell, letter: '' },
    );
    useQuizStore.setState({ cells: cleared });

    setPeeking(true);
    // 清掉上一次可能残留的定时器
    peekTimers.current.forEach(clearTimeout);
    peekTimers.current = [];

    const STAGGER_MS = 90;
    targets.forEach((cellIdx, k) => {
      const ch = word.name[k] ?? '';
      const t = setTimeout(() => {
        setLetter(cellIdx, ch);
      }, k * STAGGER_MS);
      peekTimers.current.push(t);
    });

    // 全部填完后退出打字机态
    const done = setTimeout(() => {
      setPeeking(false);
    }, targets.length * STAGGER_MS + 120);
    peekTimers.current.push(done);
  }, [locked, peeking, word, setCoins, setInventory, refreshShop, showToast, setLetter]);

  /** 整词确认：未填完提示并定位；一词一确认，确认后锁定并自动下一词 */
  const confirmWord = useCallback(() => {
    if (locked) return;
    const missing = cells.findIndex((c) => !c.fixed && !c.letter);
    if (missing !== -1) {
      showToast('还有字母未填写，补全后再确认');
      gridRef.current?.shake();
      gridRef.current?.focus(missing);
      return;
    }
    const before = useQuizStore.getState();
    const prevCombo = before.combo;
    const record = judge();
    setFlash(record.correct ? 'ok' : 'bad');

    const { combo: newCombo, settings } = useQuizStore.getState();
    if (record.correct) {
      // 一血：连击从 0 起步（本轮首次答对，或答错 / 超时中断后重新开张）；其后按连击段位播报
      const tier = prevCombo === 0 ? FIRST_BLOOD : tierOf(newCombo);
      if (tier) fireAnnounce(tier);
      if (settings.sound) {
        if (tier === FIRST_BLOOD) playFirstBlood();
        else playCorrect(newCombo);
      }
    } else {
      if (settings.sound) playWrong();
      if (prevCombo >= 2) showToast(`连击中断（${prevCombo} 连击），别灰心！`);
    }

    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      advance();
      setFlash(null);
    }, 900);
  }, [cells, fireAnnounce, judge, locked, advance, showToast]);

  /** 限时模式超时：强制记为未答（错题），红闪 + 亮正确答案后自动进入下一词 */
  const handleTimeout = useCallback(() => {
    const s = useQuizStore.getState();
    if (s.locked) return;
    const current = s.words[s.index];
    if (s.settings.sound) playWrong();
    judgeTimeout();
    setFlash('bad');
    // 把正确字母写进四线格，配合 revealed 样式醒目展示
    if (current) {
      let wi = 0;
      const newCells = s.cells.map((cell) => {
        if (cell.fixed || wi >= current.name.length) return cell;
        const ch = current.name[wi++];
        return { ...cell, letter: ch };
      });
      useQuizStore.setState({ cells: newCells });
      setRevealed(true);
    }
    showToast(`时间到！正确答案是「${current?.name ?? ''}」`);
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      advance();
      setFlash(null);
    }, 1500);
  }, [judgeTimeout, advance, showToast]);

  /** 用户主动跳过：记为错题，红闪 + 亮正确答案后进入下一词 */
  const handleSkip = useCallback(() => {
    const s = useQuizStore.getState();
    if (s.locked) return;
    const current = s.words[s.index];
    if (s.settings.sound) playWrong();
    skip();
    setFlash('bad');
    // 把正确字母写进四线格，配合 revealed 样式醒目展示
    if (current) {
      let wi = 0;
      const newCells = s.cells.map((cell) => {
        if (cell.fixed || wi >= current.name.length) return cell;
        const ch = current.name[wi++];
        return { ...cell, letter: ch };
      });
      useQuizStore.setState({ cells: newCells });
      setRevealed(true);
    }
    showToast(`跳过！正确答案是「${current?.name ?? ''}」`);
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      advance();
      setFlash(null);
    }, 1500);
  }, [skip, advance, showToast]);

  // 全局键盘兜底：Enter 提交、Backspace 删除（最后一格失焦后依然有效）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Backspace') return;
      // 中文输入法组合中的按键交给输入法（Enter 确认候选词、Backspace 改拼音）
      if (e.isComposing || e.keyCode === 229) return;
      if (useQuizStore.getState().bookOpen) return;
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key === 'Enter') {
        if (useQuizStore.getState().locked) return;
        e.preventDefault();
        confirmWord();
        return;
      }
      if (useQuizStore.getState().locked) return;
      const active = document.activeElement;
      if (active && active.classList.contains('fl-input')) return; // 格子内由格子处理
      let last = -1;
      cells.forEach((c, k) => {
        if (!c.fixed && c.letter) last = k;
      });
      if (last < 0) return;
      e.preventDefault();
      setLetter(last, '');
      gridRef.current?.focus(last);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cells, confirmWord, setLetter]);

  // 进入答题页拉取最新道具库存（余额 / 持有数与服务端对账）
  useEffect(() => {
    void refreshShop();
  }, [refreshShop]);

  // 换词：取消道具待确认态、reset revealed 高亮、中止打字机动画
  useEffect(() => {
    setPeekArmed(false);
    setRevealed(false);
    peekTimers.current.forEach(clearTimeout);
    peekTimers.current = [];
    setPeeking(false);
  }, [index]);


  // 离开答题页/换词时停止朗读；卸载时清理跳转 / 播报 / 打字机定时器
  useEffect(() => {
    return () => {
      stopSpeaking();
      clearTimeout(advanceTimer.current);
      clearTimeout(announceTimer.current);
      peekTimers.current.forEach(clearTimeout);
      peekTimers.current = [];
    };
  }, []);

  if (!word) return null;

  const handleSpeak = () => speakEnglish(word.name, setSpeaking);
  const handleBackHome = () => {
    stopSpeaking();
    goHome();
  };

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="outline" size="icon" onClick={handleBackHome} aria-label="返回首页">
          <ArrowLeft className="h-[18px] w-[18px]" />
        </Button>
        <Badge>{sourceLabel}</Badge>
        {isChallenge && (
          <Badge className="border-[#f0c98a] bg-[#fff6e6] text-[#d97706]">
            第 <b className="mx-0.5">{levelIndex + 1}</b> / {levelCount} 关
          </Badge>
        )}
        {isChallenge && levels[levelIndex]?.title && (
          <Badge className="border-[#f0c98a] bg-[#fff6e6] text-[#d97706]">
            {levels[levelIndex]!.title}
          </Badge>
        )}
        <Badge>
          {isChallenge ? (
            <>
              本关{' '}
              <b className="ml-1 text-foreground">{`${Math.min(index - levelStart + 1, levelTotal)} / ${levelTotal}`}</b>
            </>
          ) : (
            <>
              进度 <b className="ml-1 text-foreground">{`${index + 1} / ${total}`}</b>
            </>
          )}
        </Badge>
        <Badge>
          答对 <b className="ml-1 text-foreground">{correctCount}</b>
        </Badge>
        <Badge>
          正确率 <b className="ml-1 text-foreground">{accuracy}%</b>
        </Badge>
        {/* 连击计数：连续答对 2 个起显示，数字随连击跳动 */}
        {combo >= 2 && (
          <span
            key={combo}
            className="combo-chip combo-chip-pop inline-flex items-center gap-1 rounded-full border-[1.5px] border-[#f0c98a] bg-[#fff6e6] px-2.5 py-0.5 text-[13px] font-bold text-[#d97706]"
          >
            <Flame className="h-3.5 w-3.5" />
            {combo} 连击
          </span>
        )}
        {/* 闯关生命：答错 / 超时扣 1 颗；整年级为整轮共享 10 颗 */}
        {isChallenge && (
          <span
            className="inline-flex items-center gap-1"
            aria-label={`剩余 ${lives} 颗心${challengeReward.fullGrade ? '（整轮共用）' : ''}`}
          >
            {Array.from({ length: initialLives }, (_, i) => (
              <Heart
                key={`${i}-${i < lives ? 'on' : 'off'}`}
                className={cn(
                  'h-[18px] w-[18px] transition-all',
                  i < lives
                    ? 'scale-100 fill-[#ef5a6a] text-[#ef5a6a]'
                    : 'scale-90 fill-[#d4dce8] text-[#d4dce8]',
                )}
              />
            ))}
            {challengeReward.fullGrade && (
              <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">整轮</span>
            )}
          </span>
        )}
        <span className="flex-1" />
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSetting({ sound: !soundOn })}
          aria-label={soundOn ? '关闭音效' : '开启音效'}
          title={soundOn ? '关闭音效' : '开启音效'}
        >
          {soundOn ? <Volume2 className="h-[18px] w-[18px]" /> : <VolumeX className="h-[18px] w-[18px]" />}
        </Button>
        <Button variant="outline" size="icon" onClick={() => setBookOpen(true)} aria-label="错词本">
          <BookText className="h-[18px] w-[18px]" />
        </Button>
      </div>

      <Progress className="mt-2.5" value={progressPercent} />

      <div className="mt-4 rounded-[18px] bg-card p-4 text-center shadow-[0_8px_30px_rgba(70,100,160,.12)] sm:p-6">
        {/* 限时模式：醒目倒计时（key 随题号变化，每词自动重置） */}
        {timed && (
          <div className="mb-5 text-left">
            <TimerChip key={index} onExpire={handleTimeout} />
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-center justify-center gap-2.5">
          <span className="text-[22px] font-bold tracking-wide sm:text-[28px]">
            {word.trans.length > 0 ? word.trans.join('、') : '（无释义）'}
          </span>
          <button
            type="button"
            onClick={handleSpeak}
            aria-label="听发音"
            className={`inline-flex h-[42px] w-[42px] items-center justify-center rounded-full transition-transform active:scale-90 ${
              speaking
                ? 'animate-pulse bg-primary text-white'
                : 'bg-[#eaf2ff] text-primary hover:bg-[#dbe8ff]'
            }`}
          >
            <Volume2 className="h-5 w-5" />
          </button>
          <span className="w-full text-[13px] text-muted-foreground">
            根据中文意思，在下面的四线格里写出英文单词
          </span>
        </div>

        <FourLineGrid
          ref={gridRef}
          wordName={word.name}
          cells={cells}
          locked={locked}
          flash={flash}
          revealed={revealed}
          peeking={peeking}
        />

        {/* 「查看单词」道具：二次确认后消耗，打字机逐字揭示答案 */}
        <div className="mt-4 flex min-h-[34px] items-center justify-center">
          {peekArmed ? (
            <span className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-[#f0c98a] bg-[#fff6e6] px-3 py-1.5 text-[13px] font-bold text-[#d97706]">
              确认消耗 1 个「查看单词」？
              <button
                type="button"
                className="rounded-full bg-[#f0991f] px-2.5 py-0.5 text-white transition-transform active:scale-95"
                onClick={() => void usePeekItem()}
              >
                确认
              </button>
              <button
                type="button"
                className="rounded-full border border-[#d8c4a4] px-2.5 py-0.5 text-[#8a7a5e] transition-transform active:scale-95"
                onClick={() => setPeekArmed(false)}
              >
                取消
              </button>
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="rounded-full border-[#c7d6ee] text-[13px] font-bold text-[#4a6488]"
              disabled={locked || peeking || peekCount <= 0}
              title={peekCount <= 0 ? '没有道具了，回首页金币商店兑换' : '不会写？消耗一个查看单词'}
              onClick={() => setPeekArmed(true)}
            >
              <Crosshair className="h-4 w-4 text-[#e08a1e]" />
              查看单词
              <Badge className="border-[#f3d8a4] bg-[#fff3da] px-1.5 text-[#d97706] hover:bg-[#fff3da]">
                {peekCount}
              </Badge>
            </Button>
          )}
        </div>

        <div className="mt-3 flex justify-center gap-3">
          <Button
            variant="outline"
            className="min-w-[110px] flex-1 border-[#f0c98a] bg-[#fff6e6] text-[#a86a1e] hover:border-[#e08a1e] hover:bg-[#fff3da] hover:text-[#a86a1e] sm:flex-none"
            disabled={locked || peeking}
            onClick={handleSkip}
          >
            <ArrowRight className="h-[16px] w-[16px]" />
            跳过
          </Button>
          <Button
            variant="outline"
            className="min-w-[110px] flex-1 sm:flex-none"
            disabled={locked || peeking}
            onClick={() => {
              clearLetters();
              gridRef.current?.focusFirst();
            }}
          >
            清空重填
          </Button>
          <Button
            className="min-w-[110px] flex-1 sm:flex-none"
            disabled={locked || peeking}
            onClick={confirmWord}
          >
            确认 (Enter)
          </Button>
        </div>
        <p className="mt-3 text-center text-[13px] text-muted-foreground">
          不会写就点「跳过」（记错题、闯关扣 1 心、自动展示正确答案）；按 Enter 确认、Backspace 删除
        </p>
      </div>

      <ComboBanner announce={announce} />
      <LevelGateDialog />
    </section>
  );
}
