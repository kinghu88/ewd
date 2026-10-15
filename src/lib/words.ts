import type { WordItem } from './types';

/* ------------------------------------------------------------------ */
/* 词库校验与加载                                                      */
/* ------------------------------------------------------------------ */

/**
 * 校验并清洗外部 JSON 数据。
 * 兼容 trans 为数组或字符串；剔除缺 name 的脏数据。
 * @throws 数据不是数组或没有有效单词时抛错
 */
export function validateWords(data: unknown): WordItem[] {
  if (!Array.isArray(data)) {
    throw new Error('词库数据必须是 JSON 数组');
  }
  const words: WordItem[] = data
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
    .map((w) => {
      const rawName = w['name'];
      const rawTrans = w['trans'];
      const trans = Array.isArray(rawTrans)
        ? rawTrans.filter((t): t is string => typeof t === 'string' && t.length > 0)
        : typeof rawTrans === 'string' && rawTrans.trim()
          ? [rawTrans.trim()]
          : [];
      return { name: typeof rawName === 'string' ? rawName.trim() : '', trans };
    })
    .filter((w) => w.name.length > 0);

  if (words.length === 0) {
    throw new Error('词库中没有有效单词');
  }
  return words;
}

/** Fisher-Yates 洗牌：返回打乱后的新数组，不改动原数组 */
export function shuffleWords(list: WordItem[]): WordItem[] {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ------------------------------------------------------------------ */
/* 四线格                                                              */
/* ------------------------------------------------------------------ */

const ENGLISH_LETTER_RE = /[a-zA-Z]/;
export function isEnglishLetter(ch: string): boolean {
  return ENGLISH_LETTER_RE.test(ch);
}

export type LetterPlacement = 'lt-mid' | 'lt-asc' | 'lt-desc' | 'lt-full';

const MID_LETTERS = new Set('acemnorsuvwxz'); // 只占中格
const ASC_LETTERS = new Set('bdhklt'); // 上中格
const DESC_LETTERS = new Set('gpqy'); // 中下格

/** 依据字母决定四线格纵向占位：f/j 跨三格，i 点在上格归上中格 */
export function letterClass(ch: string): LetterPlacement {
  const c = ch.toLowerCase();
  if (c === 'f' || c === 'j') return 'lt-full';
  if (c === 'i' || ASC_LETTERS.has(c)) return 'lt-asc';
  if (DESC_LETTERS.has(c)) return 'lt-desc';
  if (MID_LETTERS.has(c)) return 'lt-mid';
  return 'lt-mid';
}

/** 一个书写格 */
export interface GridCell {
  /** 格内当前内容（非字母格为预填字符） */
  letter: string;
  /** 非字母格（连字符等），预填且不可编辑 */
  fixed: boolean;
}

/** 按单词构建格子模型：非字母字符作为预填固定格 */
export function buildGrid(wordName: string): GridCell[] {
  return Array.from(wordName).map((ch) => ({
    letter: isEnglishLetter(ch) ? '' : ch,
    fixed: !isEnglishLetter(ch),
  }));
}

export function findNextEditable(cells: GridCell[], i: number): number {
  for (let k = i + 1; k < cells.length; k++) {
    if (!cells[k].fixed) return k;
  }
  return -1;
}

/**
 * 退格删除目标：本格可编辑且有字时删本格；
 * 否则向左找到最近一个有字格。无目标返回 -1。
 */
export function findEraseTarget(cells: GridCell[], i: number): number {
  const cur = cells[i];
  if (cur && !cur.fixed && cur.letter) return i;
  for (let k = i - 1; k >= 0; k--) {
    if (!cells[k].fixed && cells[k].letter) return k;
  }
  return -1;
}

/** 忽略大小写的单词比对 */
export function isAnswerCorrect(answer: string, target: string): boolean {
  return answer.trim().toLowerCase() === target.trim().toLowerCase();
}
