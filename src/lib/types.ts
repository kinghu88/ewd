/** 词库中的一个单词 */
export interface WordItem {
  /** 英文单词（判题以此为准，不区分大小写） */
  name: string;
  /** 中文释义，多个释义题目中用顿号连接 */
  trans: string[];
}

/** 一道题的判题记录 */
export interface QuizRecord extends WordItem {
  /** 用户实际输入的答案 */
  answer: string;
  correct: boolean;
  /** 限时模式下超时未确认，统一记为未答（错题） */
  timeout?: boolean;
}

/** 错词本条目（localStorage 持久化） */
export interface WrongBookEntry extends WordItem {
  /** 累计答错次数 */
  wrongCount: number;
  /** 最近一次答错的时间戳 */
  lastWrong: number;
}

export type ViewName = 'home' | 'quiz' | 'result';

/** 默写模式：普通默写 / 闯关 */
export type QuizMode = 'normal' | 'challenge';

/** 闯关关卡结算弹层：过关 / 失败（生命用尽） / 全部通关 */
export type GateKind = 'pass' | 'fail' | 'complete';

/** 确认瞬间的对错闪烁反馈 */
export type FlashKind = 'ok' | 'bad';
