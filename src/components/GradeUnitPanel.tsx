import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, FileQuestion, Layers, Play, Shuffle, Swords } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { FULL_GRADE_LIVES, useQuizStore } from '@/store/useQuizStore';
import { SECOND_COIN_PACKET_THRESHOLD } from '@/lib/rewards';
import { cn } from '@/lib/utils';
import {
  fetchLevelWords,
  fetchUnitWordGroups,
  fetchUnitWords,
  levelFileName,
  probeStage,
  unitFileName,
  type GroupKey,
  type LevelMeta,
  type StageUnits,
  type UnitRef,
} from '@/lib/data';
import type { QuizLevel } from '@/store/useQuizStore';
import type { WordItem } from '@/lib/types';
import { WordPreviewDialog } from './WordPreviewDialog';

interface GradeUnitPanelProps {
  /** 当前选择的年级（中小学）或考试（大学） */
  level: LevelMeta;
  onBack: () => void;
}

type Phase = 'loading' | 'ready' | 'legacy' | 'error';
type Selection = Record<GroupKey, number[]>;

const EMPTY_SELECTION: Selection = { a: [], b: [], single: [] };

/** 生成默写来源说明，如「一年级 · 上册 1、3、5 单元」「四级 CET-4 · 全部单元」 */
function buildSourceLabel(
  level: LevelMeta,
  selection: Selection,
  stage: StageUnits,
  isAll: boolean,
): string {
  if (isAll) return `${level.label} · 全部单元`;
  const parts = stage.groups.flatMap((group) => {
    const picked = selection[group.key];
    if (picked.length === 0) return [];
    if (group.key === 'single') {
      return picked.length === group.units.length ? ['全部单元'] : [`${picked.join('、')} 单元`];
    }
    if (picked.length === group.units.length) {
      return [`${group.label}全册`];
    }
    return [`${group.label} ${picked.join('、')} 单元`];
  });
  return `${level.label} · ${parts.join('、')}`;
}

/** 面板内的出题顺序开关，与首页共用同一份 settings，状态双向同步 */
function ShuffleToggle() {
  const shuffle = useQuizStore((s) => s.settings.shuffle);
  const challenge = useQuizStore((s) => s.settings.challenge);
  const setSetting = useQuizStore((s) => s.setSetting);
  return (
    <label className="flex cursor-pointer select-none items-center justify-center gap-2.5 text-[14.5px] text-muted-foreground">
      <Switch
        checked={shuffle}
        onCheckedChange={(v) => setSetting({ shuffle: v })}
        aria-label="打乱单词顺序"
      />
      <Shuffle className="h-4 w-4" />
      {challenge
        ? '打乱单词顺序（每个单元即每关内部随机出题）'
        : '打乱单词顺序（所选单元合并后随机出题）'}
    </label>
  );
}

/** 面板内的闯关模式开关，与首页共用同一份 settings */
function ChallengeToggle() {
  const challenge = useQuizStore((s) => s.settings.challenge);
  const setSetting = useQuizStore((s) => s.setSetting);
  return (
    <label className="flex cursor-pointer select-none items-center justify-center gap-2.5 text-[14.5px] text-muted-foreground">
      <Switch
        checked={challenge}
        onCheckedChange={(v) => setSetting({ challenge: v })}
        aria-label="闯关模式"
      />
      <Swords className="h-4 w-4 text-[#e08a1e]" />
      闯关模式（一个单元为一关；普通挑战每关 3 颗心，整年级整轮共 10 颗心）
    </label>
  );
}

export function GradeUnitPanel({ level, onBack }: GradeUnitPanelProps) {
  const startQuiz = useQuizStore((s) => s.startQuiz);
  const shuffle = useQuizStore((s) => s.settings.shuffle);
  const challenge = useQuizStore((s) => s.settings.challenge);

  const [phase, setPhase] = useState<Phase>('loading');
  const [stage, setStage] = useState<StageUnits | null>(null);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 单词预览弹窗 */
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewWords, setPreviewWords] = useState<WordItem[]>([]);
  const [previewTitle, setPreviewTitle] = useState('');

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);
    setSelection(EMPTY_SELECTION);
    probeStage(level)
      .then((res) => {
        if (cancelled) return;
        setStage(res);
        if (res.groups.some((g) => g.units.length > 0)) {
          setPhase('ready');
        } else if (res.legacy) {
          setPhase('legacy');
        } else {
          setPhase('error');
        }
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [level]);

  const totalAvailable = useMemo(
    () => (stage ? stage.groups.reduce((sum, g) => sum + g.units.length, 0) : 0),
    [stage],
  );
  const totalSelected = selection.a.length + selection.b.length + selection.single.length;

  const wordCountOf = (group: GroupKey, unit: number): number =>
    stage?.groups.find((g) => g.key === group)?.units.find((u) => u.unit === unit)?.count ?? 0;

  const totalWords = useMemo(
    () =>
      stage
        ? stage.groups.reduce(
            (sum, group) =>
              sum + selection[group.key].reduce((n, unit) => n + wordCountOf(group.key, unit), 0),
            0,
          )
        : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, stage],
  );

  const isAllPicked = totalAvailable > 0 && totalSelected === totalAvailable;

  const toggleUnit = (group: GroupKey, unit: number) => {
    setSelection((prev) => {
      const list = prev[group];
      const next = list.includes(unit)
        ? list.filter((u) => u !== unit)
        : [...list, unit].sort((x, y) => x - y);
      return { ...prev, [group]: next };
    });
  };

  const pickGroup = (group: GroupKey, all: boolean) => {
    setSelection((prev) => ({
      ...prev,
      [group]: all && stage ? (stage.groups.find((g) => g.key === group)?.units.map((u) => u.unit) ?? []) : [],
    }));
  };

  const pickAll = () => {
    if (!stage) return;
    const next = { ...EMPTY_SELECTION };
    for (const g of stage.groups) {
      next[g.key] = g.units.map((u) => u.unit);
    }
    setSelection(next);
  };

  /** 当前勾选的分组/单元引用（按上册→下册、单元号升序） */
  const selectedRefs: UnitRef[] = useMemo(
    () =>
      stage
        ? stage.groups.flatMap((g) =>
            selection[g.key].map((unit) => ({ group: g.key, unit })),
          )
        : [],
    [selection, stage],
  );

  /** 加载已勾选单元的全部单词（探测时已缓存，不会重复请求） */
  const loadSelectedWords = async (): Promise<{ words: WordItem[]; title: string }> => {
    if (phase === 'legacy') {
      const words = await fetchLevelWords(level.base);
      return { words, title: `${level.label}词库` };
    }
    if (!stage) throw new Error('stage not ready');
    const words = await fetchUnitWords(level.base, selectedRefs);
    return { words, title: buildSourceLabel(level, selection, stage, isAllPicked) };
  };

  /** 默写开始前预览全部单词 */
  const handlePreview = async () => {
    if (starting || previewLoading) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const { words, title } = await loadSelectedWords();
      setPreviewWords(words);
      setPreviewTitle(title);
      setPreviewOpen(true);
    } catch {
      setError('所选词库加载失败，请重试，或返回首页使用「导入 JSON 文件」');
    } finally {
      setPreviewLoading(false);
    }
  };

  /** 单元名：上册/下册分组带册别名，不分册（大学）只显示「N 单元」 */
  const unitTitle = (ref: UnitRef): string => {
    const groupLabel = stage?.groups.find((g) => g.key === ref.group)?.label ?? '';
    return groupLabel ? `${groupLabel} ${ref.unit} 单元` : `${ref.unit} 单元`;
  };

  const handleStart = async () => {
    if (!stage || totalSelected === 0) return;
    setStarting(true);
    setError(null);
    try {
      // 按单元分组取词：闯关模式一个单元就是一关；普通模式合并成整份词表
      const groups = await fetchUnitWordGroups(level.base, selectedRefs);
      const title = buildSourceLabel(level, selection, stage, isAllPicked);
      if (challenge) {
        // 分组与 selectedRefs 顺序一致（探测阶段已确认这些文件有效）
        const levels: QuizLevel[] = selectedRefs
          .map((ref, i) => ({ title: unitTitle(ref), words: groups[i] ?? [] }))
          .filter((lv) => lv.words.length > 0);
        startQuiz(groups.flat(), title, 'challenge', levels, {
          unitCount: Math.max(1, totalSelected),
          fullGrade: isAllPicked,
        });
      } else {
        startQuiz(groups.flat(), title);
      }
    } catch {
      setError('所选词库加载失败，请重试，或返回首页使用「导入 JSON 文件」');
      setStarting(false);
    }
  };

  const handleLegacyStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const { words, title } = await loadSelectedWords();
      startQuiz(words, title);
    } catch {
      setError('词库加载失败，请返回首页使用「导入 JSON 文件」');
      setStarting(false);
    }
  };

  const titleSuffix = level.volumes ? '选择册别和单元' : '选择单元';

  return (
    <div className="rounded-[18px] bg-card p-5 shadow-[0_8px_30px_rgba(70,100,160,.12)] sm:p-6">
      <div className="flex items-center gap-3 pb-2">
        <Button variant="ghost" size="sm" className="h-9 w-9 rounded-full p-0" onClick={onBack}>
          <ArrowLeft className="h-[18px] w-[18px]" />
        </Button>
        <h2 className="text-[20px] font-bold sm:text-[22px]">
          {level.label} · {titleSuffix}
        </h2>
      </div>

      {phase === 'loading' && (
        <div className="py-16 text-center text-[15px] text-muted-foreground">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-[3px] border-[#dce7f6] border-t-primary" />
          正在扫描{level.label}词库…
        </div>
      )}

      {phase === 'error' && (
        <div className="py-6">
          <div className="rounded-xl border border-[#f6d9c8] bg-[#fdf3ed] p-4 text-[14px] leading-7 text-[#a85a2f]">
            <p className="flex items-center gap-2 font-bold">
              <FileQuestion className="h-[18px] w-[18px]" />
              没有找到{level.label}的单元词库
            </p>
            <p className="mt-2">
              请把词库 JSON 放到站点目录（开发时放在 public 目录），命名规则：
            </p>
            <ul className="ml-5 mt-1 list-disc">
              {level.volumes ? (
                <>
                  <li>
                    {level.label}上册 1 单元 →{' '}
                    <code className="rounded bg-[#f7e6db] px-1.5 py-0.5 text-[13px]">
                      {unitFileName(level.base, 'a', 1)}
                    </code>
                  </li>
                  <li>
                    {level.label}下册 3 单元 →{' '}
                    <code className="rounded bg-[#f7e6db] px-1.5 py-0.5 text-[13px]">
                      {unitFileName(level.base, 'b', 3)}
                    </code>
                  </li>
                </>
              ) : (
                <li>
                  {level.label} 1 单元 →{' '}
                  <code className="rounded bg-[#f7e6db] px-1.5 py-0.5 text-[13px]">
                    {unitFileName(level.base, 'single', 1)}
                  </code>
                </li>
              )}
            </ul>
            <p className="mt-2">
              也可以放一个完整词库文件{' '}
              <code className="rounded bg-[#f7e6db] px-1.5 py-0.5 text-[13px]">
                {levelFileName(level.base)}
              </code>
              ，或返回首页直接「导入 JSON 文件」开始练习。
            </p>
          </div>
          <Button variant="outline" className="mt-4" onClick={onBack}>
            返回重新选择
          </Button>
        </div>
      )}

      {phase === 'legacy' && (
        <div className="py-6">
          <p className="text-[14.5px] leading-7 text-muted-foreground">
            未找到分单元词库，但找到了完整词库文件{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-[13px]">
              {levelFileName(level.base)}
            </code>
            ，可以直接练习{level.label}的全部单词。
          </p>
          <div className="mt-4 flex flex-col items-center gap-3">
            <ShuffleToggle />
            <ChallengeToggle />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Button size="lg" variant="secondary" disabled={previewLoading || starting} onClick={handlePreview}>
              <Eye className="h-[18px] w-[18px]" />
              {previewLoading ? '加载中…' : '预览单词'}
            </Button>
            <Button size="lg" disabled={starting} onClick={handleLegacyStart}>
              <Play className="h-[18px] w-[18px]" />
              {starting ? '加载中…' : '开始默写'}
            </Button>
          </div>
        </div>
      )}

      {phase === 'ready' && stage && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={isAllPicked ? 'default' : 'outline'}
              className="h-9 rounded-full"
              onClick={pickAll}
            >
              <Layers className="h-4 w-4" />
              全选全部单元
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 rounded-full text-muted-foreground"
              disabled={totalSelected === 0}
              onClick={() => setSelection(EMPTY_SELECTION)}
            >
              清空选择
            </Button>
            <span className="ml-auto text-[13px] text-muted-foreground">
              单元可多选，已选 <span className="font-bold text-primary">{totalSelected}</span> 个 ·
              共 <span className="font-bold text-primary">{totalWords}</span> 个单词
            </span>
          </div>

          {challenge && totalSelected > 0 && (
            <p className="mt-3 rounded-xl border border-[#f0c98a] bg-[#fff6e6] px-3.5 py-2 text-[13px] leading-6 text-[#a86a1e]">
              {isAllPicked ? (
                <>
                  <b>整年级专属奖励：</b>3 个红包全部含金币，其中 1 个至少 10 金币（单包最高 100）
                  · 整轮共 <b>{FULL_GRADE_LIVES} 颗心</b>，小关卡失败不可重试
                </>
              ) : totalSelected > SECOND_COIN_PACKET_THRESHOLD ? (
                <>
                  <b>多单元奖励：</b>3 个红包中有 2 个含金币，单包按阶梯倍率加成（最高 100 金币），
                  点任意红包全部拆开
                </>
              ) : totalSelected > 1 ? (
                <>
                  <b>多单元加成：</b>已选 {totalSelected} 个单元，金币红包 ×2 提升（单包最高 100 金币）
                </>
              ) : (
                <>通关后可拆 3 个红包，其中 1 个藏着金币</>
              )}
            </p>
          )}

          <div className="mt-4 space-y-5">
            {stage.groups.map((group) => {
              const list = group.units;
              if (list.length === 0) return null;
              const pickedCount = selection[group.key].length;
              const allPicked = pickedCount === list.length;
              return (
                <section key={group.key}>
                  {group.label && (
                    <div className="mb-2.5 flex items-center gap-3">
                      <h3 className="rounded-lg bg-[#eaf2ff] px-2.5 py-1 text-[14px] font-bold text-primary">
                        {group.label}
                      </h3>
                      <button
                        type="button"
                        onClick={() => pickGroup(group.key, !allPicked)}
                        className="text-[13px] font-medium text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                      >
                        {allPicked ? '清空本册' : `全选${group.label}`}
                      </button>
                      <span className="text-[12.5px] text-muted-foreground">
                        {pickedCount > 0 ? `已选 ${pickedCount} / ${list.length} 单元` : `共 ${list.length} 个单元`}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                    {list.map(({ unit, count }) => {
                      const active = selection[group.key].includes(unit);
                      return (
                        <button
                          key={unit}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleUnit(group.key, unit)}
                          className={cn(
                            'rounded-[13px] border-[1.5px] py-3 text-[15px] font-bold transition-all',
                            active
                              ? 'border-primary bg-primary text-white shadow-[0_5px_14px_rgba(74,123,246,.28)]'
                              : 'border-[#dce7f6] bg-[#f8fbff] text-primary hover:-translate-y-0.5 hover:border-primary hover:bg-[#eaf2ff]',
                          )}
                        >
                          {unit} 单元
                          <span
                            className={cn(
                              'mt-0.5 block text-[11.5px] font-normal',
                              active ? 'text-white/80' : 'text-muted-foreground',
                            )}
                          >
                            {count} 个单词
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-[#f6d9c8] bg-[#fdf3ed] p-3 text-[13.5px] text-[#a85a2f]">
              {error}
            </div>
          )}

          <div className="mt-5 flex flex-col items-center gap-3">
            <ShuffleToggle />
            <ChallengeToggle />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button
              size="lg"
              variant="secondary"
              disabled={totalSelected === 0 || previewLoading || starting}
              onClick={handlePreview}
            >
              <Eye className="h-[18px] w-[18px]" />
              {previewLoading ? '加载中…' : '预览单词'}
            </Button>
            <Button
              size="lg"
              disabled={totalSelected === 0 || starting}
              onClick={handleStart}
            >
              <Play className="h-[18px] w-[18px]" />
              {starting
                ? '加载中…'
                : totalSelected === 0
                  ? '请先选择单元'
                  : challenge
                    ? `开始闯关（${totalSelected} 关 · ${totalWords} 个单词）`
                    : `开始默写（${totalWords} 个单词）`}
            </Button>
          </div>
        </>
      )}

      <WordPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={previewTitle}
        words={previewWords}
        shuffled={shuffle}
        starting={starting}
        onStart={phase === 'legacy' ? handleLegacyStart : handleStart}
      />
    </div>
  );
}
