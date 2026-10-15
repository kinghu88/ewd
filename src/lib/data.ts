import type { WordItem } from './types';
import { validateWords } from './words';

/* ------------------------------------------------------------------ */
/* 学段与词库文件命名约定                                                 */
/* ------------------------------------------------------------------
 * 小学 primary（沿用旧约定，旧文件完全兼容）
 *   一年级上册 1 单元 -> grade1a-u1.json
 *   一年级下册 3 单元 -> grade1b-u3.json
 *   旧版整年级文件    -> grade1.json
 * 初中 junior（初一 ~ 初三）
 *   初一上册 1 单元   -> junior1a-u1.json
 *   初三下册 2 单元   -> junior3b-u2.json
 *   整年级文件        -> junior1.json
 * 高中 senior（高一 ~ 高三）
 *   高二上册 1 单元   -> senior2a-u1.json
 * 大学 college（按考试分类，不分上 / 下册）
 *   四级 1 单元       -> cet4-u1.json
 *   六级整套词库      -> cet6.json
 * ------------------------------------------------------------------ */

export type CategoryKey = 'primary' | 'junior' | 'senior' | 'college';

/** 单元分组：a = 上册，b = 下册，single = 不分册（大学考试） */
export type GroupKey = 'a' | 'b' | 'single';

export interface UnitRef {
  group: GroupKey;
  unit: number;
}

export interface UnitInfo {
  /** 单元序号 */
  unit: number;
  /** 该单元单词数 */
  count: number;
}

export interface UnitGroup {
  key: GroupKey;
  /** 分组标题：上册 / 下册；不分册时为空串 */
  label: string;
  units: UnitInfo[];
}

export interface StageUnits {
  /** 可用单元分组（按上册 → 下册 → 不分册顺序） */
  groups: UnitGroup[];
  /** 旧版整体文件 base.json 是否存在 */
  legacy: boolean;
}

/** 学段下的一个可选层级：中小学为年级，大学为考试 */
export interface LevelMeta {
  /** 文件名主体：grade1 / junior1 / senior1 / cet4 */
  base: string;
  /** 显示名：一年级 / 初一 / 高一 / 四级 CET-4 */
  label: string;
  /** 是否分上 / 下册（大学考试不分册） */
  volumes: boolean;
}

export interface CategoryMeta {
  key: CategoryKey;
  label: string;
  description: string;
  /** 该学段下可选的年级或考试 */
  levels: LevelMeta[];
}

const JUNIOR_LABELS = ['初一', '初二', '初三'] as const;
const SENIOR_LABELS = ['高一', '高二', '高三'] as const;

export const CATEGORIES: CategoryMeta[] = [
  {
    key: 'primary',
    label: '小学',
    description: '一年级 ~ 六年级',
    levels: [1, 2, 3, 4, 5, 6].map((n) => ({
      base: `grade${n}`,
      label: `${n} 年级`,
      volumes: true,
    })),
  },
  {
    key: 'junior',
    label: '初中',
    description: '初一 ~ 初三',
    levels: [1, 2, 3].map((n) => ({
      base: `junior${n}`,
      label: JUNIOR_LABELS[n - 1],
      volumes: true,
    })),
  },
  {
    key: 'senior',
    label: '高中',
    description: '高一 ~ 高三',
    levels: [1, 2, 3].map((n) => ({
      base: `senior${n}`,
      label: SENIOR_LABELS[n - 1],
      volumes: true,
    })),
  },
  {
    key: 'college',
    label: '大学',
    description: '四级 / 六级 / 考研 / 雅思 / 托福',
    levels: [
      { base: 'cet4', label: '四级 CET-4', volumes: false },
      { base: 'cet6', label: '六级 CET-6', volumes: false },
      { base: 'kaoyan', label: '考研', volumes: false },
      { base: 'ielts', label: '雅思 IELTS', volumes: false },
      { base: 'toefl', label: '托福 TOEFL', volumes: false },
    ],
  },
];

/** 探测单元的上限（教材单册通常 6~8 单元，留足余量） */
const MAX_PROBE_UNITS = 12;

const VOLUME_GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'a', label: '上册' },
  { key: 'b', label: '下册' },
];
const SINGLE_GROUP: { key: GroupKey; label: string } = { key: 'single', label: '' };

function fileUrl(fileName: string): string {
  return `${import.meta.env.BASE_URL}${fileName}`;
}

/** grade1 + 上册 + 1 单元 -> grade1a-u1.json；cet4 + 1 单元 -> cet4-u1.json */
export function unitFileName(base: string, group: GroupKey, unit: number): string {
  return group === 'single' ? `${base}-u${unit}.json` : `${base}${group}-u${unit}.json`;
}

/** 旧版整体词库文件名：grade1.json / junior1.json / cet4.json */
export function levelFileName(base: string): string {
  return `${base}.json`;
}

async function loadJson(fileName: string): Promise<WordItem[] | null> {
  const resp = await fetch(fileUrl(fileName));
  if (!resp.ok) return null;
  const words = validateWords(await resp.json());
  return words.length > 0 ? words : null;
}

/**
 * 文件名 -> 词库 Promise 缓存。
 * 探测时已加载过的文件，开始默写时直接复用，不重复请求。
 */
const wordCache = new Map<string, Promise<WordItem[] | null>>();

function fetchCached(fileName: string): Promise<WordItem[] | null> {
  let task = wordCache.get(fileName);
  if (!task) {
    task = loadJson(fileName).catch(() => null);
    wordCache.set(fileName, task);
  }
  return task;
}

/**
 * 探测某个年级 / 考试有哪些单元词库可用。
 * 中小学并发探测 basea/b-u1..uN.json；大学考试探测 base-u1..uN.json；
 * 同时探测旧版整体文件 base.json 作为兜底。
 */
export async function probeStage(level: LevelMeta): Promise<StageUnits> {
  const groupDefs = level.volumes ? VOLUME_GROUPS : [SINGLE_GROUP];
  const groups = await Promise.all(
    groupDefs.map(async ({ key, label }) => {
      const results = await Promise.all(
        Array.from({ length: MAX_PROBE_UNITS }, (_, i) => i + 1).map(async (unit) => {
          const words = await fetchCached(unitFileName(level.base, key, unit));
          return words ? { unit, count: words.length } : null;
        }),
      );
      return {
        key,
        label,
        units: results.filter((u): u is UnitInfo => u !== null),
      } satisfies UnitGroup;
    }),
  );
  const legacy = (await fetchCached(levelFileName(level.base))) !== null;
  return { groups, legacy };
}

/**
 * 按单元分组取词：返回顺序与 refs 一致（上册 → 下册、单元号升序）。
 * 同名单词（忽略大小写/首尾空格）跨单元只保留第一次出现，因此各分组边界清晰、
 * 拼起来与「合并单词」完全一致，方便闯关模式下一个单元就是一关。
 * 空文件 / 加载失败的单元自动跳过；全部无效时抛错。
 */
export async function fetchUnitWordGroups(
  base: string,
  refs: UnitRef[],
): Promise<WordItem[][]> {
  const groups = await Promise.all(
    refs.map((ref) => fetchCached(unitFileName(base, ref.group, ref.unit))),
  );
  const seen = new Set<string>();
  const result: WordItem[][] = [];
  for (const words of groups) {
    if (!words) continue;
    const group: WordItem[] = [];
    for (const w of words) {
      const key = w.name.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        group.push(w);
      }
    }
    if (group.length > 0) result.push(group);
  }
  if (result.length === 0) {
    throw new Error('所选单元没有有效单词');
  }
  return result;
}

/**
 * 合并所选单元的单词。
 * 按分组先后顺序（上册 → 下册）拼接，同名单词（忽略大小写/首尾空格）只保留第一次出现。
 * @throws 所选文件全部缺失或没有有效单词时抛错
 */
export async function fetchUnitWords(base: string, refs: UnitRef[]): Promise<WordItem[]> {
  const groups = await fetchUnitWordGroups(base, refs);
  return groups.flat();
}

/** 读取旧版整体词库（base.json），文件不存在或无效时抛错 */
export async function fetchLevelWords(base: string): Promise<WordItem[]> {
  const words = await fetchCached(levelFileName(base));
  if (!words) {
    throw new Error(`${levelFileName(base)} 不可用`);
  }
  return words;
}

/** 读取用户手动导入的本地 JSON 文件（解决 file:// 下 fetch 被拦截的问题） */
export function readJsonFile(file: File): Promise<WordItem[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(validateWords(JSON.parse(String(reader.result))));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('JSON 解析失败'));
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}
