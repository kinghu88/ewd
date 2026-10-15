import type { WordItem, WrongBookEntry } from './types';
import { tokenStore } from './api';

/**
 * 错词本 localStorage 键名：按登录用户隔离（同浏览器多账号互不串数据）。
 * 未登录时使用 anonymous 后缀（正常流程下应用需先登录）。
 */
function getBookKey(): string {
  const user = tokenStore.getUser();
  return user ? `ewd_wrong_book_v1_u${user.id}` : 'ewd_wrong_book_v1_anonymous';
}

type WrongBookMap = Record<string, WrongBookEntry>;

export function loadBook(): WrongBookMap {
  try {
    const raw = localStorage.getItem(getBookKey());
    return raw ? (JSON.parse(raw) as WrongBookMap) : {};
  } catch {
    return {};
  }
}

/** 写入失败（如浏览器禁用存储）时返回 false，由调用方提示 */
export function saveBook(book: WrongBookMap): boolean {
  try {
    localStorage.setItem(getBookKey(), JSON.stringify(book));
    return true;
  } catch {
    return false;
  }
}

/** 答错的单词入错词本：按词去重并累计错误次数 */
export function addWrongWord(word: WordItem): boolean {
  const book = loadBook();
  const key = word.name.toLowerCase();
  const old = book[key];
  book[key] = {
    name: word.name,
    trans: word.trans,
    wrongCount: (old?.wrongCount ?? 0) + 1,
    lastWrong: Date.now(),
  };
  return saveBook(book);
}

export function removeWrongWord(name: string): void {
  const book = loadBook();
  delete book[name.toLowerCase()];
  saveBook(book);
}

export function clearBook(): void {
  saveBook({});
}

/** 错词本列表，按最近答错时间倒序 */
export function getBookEntries(): WrongBookEntry[] {
  return Object.values(loadBook()).sort((a, b) => b.lastWrong - a.lastWrong);
}

export function getBookCount(): number {
  return Object.keys(loadBook()).length;
}
