import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookText, Crosshair, Flame, Heart, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { levelRange, LEVEL_LIVES, useQuizStore, selectCorrectCount } from '@/store/useQuizStore';
import { speakEnglish, stopSpeaking } from '@/lib/speech';
import { playCorrect, playFirstBlood, playWrong } from '@/lib/sfx';
import { FIRST_BLOOD, tierOf, type ComboTier } from '@/lib/combo';
import { ApiError, shopApi } from '@/lib/api';
import { PEEK_SKU } from '@/lib/shop';
import { FourLineGrid, type GridHandle } from './quiz/FourLineGrid';
import { TimerChip } from './quiz/TimerChip';
import { ComboBanner, type ComboAnnounce } from './quiz/ComboBanner';
import { PeekGunEffect } from './quiz/PeekGunEffect';
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
  const setSetting = useQuizStore((s) => s.setSetting);
  const setLetter = useQuizStore((s) => s.setLetter);
  const clearLetters = useQuizStore((s) => s.clearLetters);
  const judge = useQuizStore((s) => s.judge);
  const judgeTimeout = useQuizStore((s) => s.judgeTimeout);
  const advance = useQuizStore((s) => s.advance);
  const goHome = useQuizStore((s) => s.goHome);
  const showToast = useQuizStore((s) => s.showToast);
  const setBookOpen = useQuizStore((s) => s.setBookOpen);
  const inventory = useQuizStore((s) => s.inventory);
  const setCoins = useQuizStore((s) => s.setCoins);
  const setInventory = useQuizStore((s) => s.setInventory);
  const refreshShop = useQuizStore((s) => s.refreshShop);
  const setPeekActive = useQuizStore((s) => s.setPeekActive);

  const gridRef = useRef<GridHandle>(null);
  const [flash, setFlash] = useState<FlashKind | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [announce, setAnnounce] = useState<ComboAnnounce | null>(null);
  /** 「查看单词」冲锋枪特效正在播放的单词；null=未使用 */
  const [peekingWord, setPeekingWord] = useState<string | null>(null);
  /** 使用道具的二次确认态（防止误点误花金币） */
  const [peekArmed, setPeekArmed] = useState(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>();
  const announceTimer = useRef<ReturnType<typeof setTimeout>>();
  const announceKey = useRef(0);

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
   * 消耗「查看单词」道具：服务端原子扣减并记使用次数成功后才播放冲锋枪特效。
   * 特效只做视觉揭示，不写入格子，淡出后由用户凭记忆书写。
   */
  const usePeekItem = useCallback(async () => {
    if (locked || peekingWord) return;
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
    setPeekingWord(word.name);
  }, [locked, peekingWord, word, setCoins, setInventory, refreshShop, showToast]);

  /** 整词确认：未填完提示并定位；一词一确认，确认后锁定并自动下一词 */
  const confirmWord = useCallback(() => {
    if (locked || peekingWord) return;
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
  }, [cells, fireAnnounce, judge, locked, peekingWord, advance, showToast]);

  /** 限时模式超时：强制记为未答（错题），红闪后自动进入下一词 */
  const handleTimeout = useCallback(() => {
    const s = useQuizStore.getState();
    if (s.locked) return;
    const current = s.words[s.index];
    if (s.settings.sound) playWrong();
    judgeTimeout();
    setFlash('bad');
    showToast(`时间到！正确答案是「${current?.name ?? ''}」`);
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      advance();
      setFlash(null);
    }, 1300);
  }, [judgeTimeout, advance, showToast]);

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

  // 换词：取消道具待确认态；异常换词（如限时超时打断特效）时收起特效层
  useEffect(() => {
    setPeekArmed(false);
    setPeekingWord(null);
  }, [index]);

  // 特效播放状态同步到 store：限时模式倒计时在此期间冻结，卸载时确保复位
  useEffect(() => {
    setPeekActive(peekingWord !== null);
    return () => setPeekActive(false);
  }, [peekingWord, setPeekActive]);

  // 离开答题页/换词时停止朗读；卸载时清理跳转 / 播报定时器
  useEffect(() => {
    return () => {
      stopSpeaking();
      clearTimeout(advanceTimer.current);
      clearTimeout(announceTimer.current);
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
        {/* 闯关三颗心：答错 / 超时扣 1 颗 */}
        {isChallenge && (
          <span className="inline-flex items-center gap-1" aria-label={`剩余 ${lives} 颗心`}>
            {Array.from({ length: LEVEL_LIVES }, (_, i) => (
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

        <div className="peek-stage">
          <FourLineGrid
            ref={gridRef}
            wordName={word.name}
            cells={cells}
            locked={locked}
            flash={flash}
          />
          {peekingWord === word.name && (
            <PeekGunEffect
              key={word.name}
              word={word.name}
              soundOn={soundOn}
              onDone={() => setPeekingWord(null)}
            />
          )}
        </div>

        {/* 「查看单词」道具：二次确认后消耗，冲锋枪把字母打在四线格上 */}
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
              disabled={locked || peekingWord !== null || peekCount <= 0}
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
            className="min-w-[130px] flex-1 sm:flex-none"
            disabled={locked || peekingWord !== null}
            onClick={() => {
              clearLetters();
              gridRef.current?.focusFirst();
            }}
          >
            清空重填
          </Button>
          <Button
            className="min-w-[130px] flex-1 sm:flex-none"
            disabled={locked || peekingWord !== null}
            onClick={confirmWord}
          >
            确认 (Enter)
          </Button>
        </div>
        <p className="mt-3 text-center text-[13px] text-muted-foreground">
          输入字母后自动跳到下一格；按退格键可删除字母；确认前可点击任意格子修改，确认后无法更改
        </p>
      </div>

      <ComboBanner announce={announce} />
      <LevelGateDialog />
    </section>
  );
}
