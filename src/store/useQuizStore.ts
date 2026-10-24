import { create } from 'zustand';
import type { GateKind, QuizMode, QuizRecord, ViewName, WordItem } from '@/lib/types';
import { addWrongWord } from '@/lib/storage';
import { authApi, rewardsApi, shopApi, tokenStore, type AuthUser } from '@/lib/api';
import {
  DEFAULT_CHALLENGE_REWARD,
  type ChallengeRewardConfig,
} from '@/lib/rewards';
import { buildGrid, isAnswerCorrect, shuffleWords, type GridCell } from '@/lib/words';

/** 闯关模式：每关默认生命数（答错 / 超时扣 1 心） */
export const LEVEL_LIVES = 3;
/** 整年级全部单元闯关：每关初始生命数 */
export const FULL_GRADE_LIVES = 10;

/** 闯关模式的一关：一个单元（title 为单元名，如「上册 1 单元」） */
export interface QuizLevel {
  title: string;
  words: WordItem[];
}

interface Settings {
  /** 打乱单词顺序 */
  shuffle: boolean;
  /** 限时模式 */
  timed: boolean;
  /** 连击 / 判题音效 */
  sound: boolean;
  /** 闯关模式（生命制，全部通关后可拆幸运红包） */
  challenge: boolean;
}

type AuthStatus = 'loading' | 'guest' | 'authed';

interface QuizState {
  view: ViewName;
  settings: Settings;

  /** 登录态：启动校验中 / 未登录（显示登录页）/ 已登录 */
  authStatus: AuthStatus;
  user: AuthUser | null;
  /** 金币余额（服务端权威，购买/红包/道具消耗后同步） */
  coins: number;
  /** 道具背包：sku -> 持有数量（服务端权威） */
  inventory: Record<string, number>;
  /** 服务端金币/通关数变更版本号，驱动首页与奖励弹窗刷新 */
  rewardsTick: number;

  /** 本轮模式：普通默写 / 闯关 */
  mode: QuizMode;
  words: WordItem[];
  sourceLabel: string;
  index: number;
  cells: GridCell[];
  locked: boolean;
  records: QuizRecord[];
  /** 闯关：关卡定义，一关对应一个单元（普通模式为空） */
  levels: QuizLevel[];
  /** 闯关：当前关卡序号（从 0 开始） */
  levelIndex: number;
  /** 闯关：总关卡数 */
  levelCount: number;
  /** 闯关：本轮奖励配置（单元数 / 是否整年级） */
  challengeReward: ChallengeRewardConfig;
  /** 闯关：每关初始生命数（整年级为 10，其余为 3） */
  initialLives: number;
  /** 闯关：本关剩余生命数 */
  lives: number;
  /** 闯关：关卡结算弹层（null = 答题中） */
  gate: GateKind | null;
  /** 当前连续答对数（答错 / 超时清零） */
  combo: number;
  /** 本轮最高连击 */
  maxCombo: number;
  /** 本轮开始时间戳（毫秒） */
  startedAt: number | null;
  /** 本轮结束（进入结果页）时间戳（毫秒） */
  finishedAt: number | null;

  toast: string | null;
  bookOpen: boolean;
  /** 「查看单词」冲锋枪特效播放中（限时模式倒计时在此期间暂停） */
  peekActive: boolean;
  /** 错词本变更版本号，驱动各处角标/列表刷新 */
  bookVersion: number;

  setSetting: (patch: Partial<Settings>) => void;
  /** 启动时用本地 token 恢复登录态 */
  bootstrapAuth: () => Promise<void>;
  /** 登录或注册成功后写入登录态 */
  applyAuth: (token: string, user: AuthUser, coins?: number) => void;
  /** 直接写入金币余额 */
  setCoins: (coins: number) => void;
  /** 直接写入道具背包 */
  setInventory: (inventory: Record<string, number>) => void;
  /** 拉取商店目录并同步金币余额与道具背包（失败静默，不阻断练习） */
  refreshShop: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bumpRewards: () => void;
  showToast: (message: string) => void;
  setBookOpen: (open: boolean) => void;
  /** 标记「查看单词」特效播放状态（联动限时倒计时暂停） */
  setPeekActive: (active: boolean) => void;
  refreshBook: () => void;

  /**
   * 开始一轮默写。
   * @param levels 闯关模式下的关卡定义（一关一个单元）；未传时整份词表按一关处理
   * @param reward 闯关奖励配置（单元数量 / 是否整年级全部单元）
   */
  startQuiz: (
    words: WordItem[],
    sourceLabel: string,
    mode?: QuizMode,
    levels?: QuizLevel[],
    reward?: ChallengeRewardConfig,
  ) => void;
  setLetter: (i: number, letter: string) => void;
  clearLetters: () => void;
  /** 整词判题并锁定，返回本题记录 */
  judge: () => QuizRecord;
  /** 限时模式超时：无论已填内容如何，强制记为未答（错题）并锁定 */
  judgeTimeout: () => void;
  /** 进入下一词，或结束本轮进入结果页 */
  next: () => void;
  /**
   * 判题闪烁结束后推进：
   * 普通模式等同 next；闯关模式按剩余生命 / 关卡边界决定下一词、过关、失败或通关
   */
  advance: () => void;
  /** 闯关：进入下一关（生命重置） */
  nextLevel: () => void;
  /** 闯关：重新挑战当前关（本关记录与生命重置） */
  retryLevel: () => void;
  /** 闯关：红包揭晓结束后进入本轮战绩页 */
  finishRun: () => void;
  restart: () => void;
  goHome: () => void;
}

/** 当前关在全局单词列表中的起止下标（words 即各关 words 顺序拼接） */
export function levelRange(levels: QuizLevel[], levelIndex: number): { start: number; end: number } {
  let start = 0;
  for (let i = 0; i < levelIndex; i += 1) start += levels[i]?.words.length ?? 0;
  return { start, end: start + (levels[levelIndex]?.words.length ?? 0) };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** 按当前单词重建格子模型 */
function cellsOf(word: WordItem): GridCell[] {
  return buildGrid(word.name);
}

export const useQuizStore = create<QuizState>((set, get) => ({
  view: 'home',
  settings: { shuffle: false, timed: false, sound: true, challenge: false },

  authStatus: 'loading',
  user: null,
  coins: 0,
  inventory: {},
  rewardsTick: 0,

  bootstrapAuth: async () => {
    if (!tokenStore.get()) {
      set({ authStatus: 'guest', user: null });
      return;
    }
    try {
      const { user, rewards } = await authApi.me();
      set({ authStatus: 'authed', user, coins: rewards.coins });
      void get().refreshShop();
    } catch {
      tokenStore.clear();
      set({ authStatus: 'guest', user: null });
    }
  },

  applyAuth: (token, user, coins = 0) => {
    tokenStore.set(token, user);
    set({ authStatus: 'authed', user, coins, inventory: {}, rewardsTick: get().rewardsTick + 1 });
    void get().refreshShop();
  },

  setCoins: (coins) => set({ coins }),

  setInventory: (inventory) => set({ inventory }),

  refreshShop: async () => {
    try {
      const { items, coins } = await shopApi.catalog();
      const inventory: Record<string, number> = {};
      for (const item of items) {
        if (item.kind === 'prop' && item.owned > 0) inventory[item.id] = item.owned;
      }
      set({ coins, inventory });
    } catch {
      /* 网络异常时保留现有余额展示，不阻断答题 */
    }
  },

  login: async (username, password) => {
    const { token, user, rewards } = await authApi.login(username, password);
    get().applyAuth(token, user, rewards.coins);
  },

  register: async (username, password) => {
    const { token, user, rewards } = await authApi.register(username, password);
    get().applyAuth(token, user, rewards.coins);
  },

  logout: async () => {
    await authApi.logout();
    tokenStore.clear();
    set({
      authStatus: 'guest',
      user: null,
      coins: 0,
      inventory: {},
      view: 'home',
      gate: null,
      bookOpen: false,
      peekActive: false,
    });
  },

  bumpRewards: () => set((s) => ({ rewardsTick: s.rewardsTick + 1 })),

  mode: 'normal',
  words: [],
  sourceLabel: '',
  index: 0,
  cells: [],
  locked: false,
  records: [],
  levels: [],
  levelIndex: 0,
  levelCount: 1,
  challengeReward: DEFAULT_CHALLENGE_REWARD,
  initialLives: LEVEL_LIVES,
  lives: LEVEL_LIVES,
  gate: null,
  combo: 0,
  maxCombo: 0,
  startedAt: null,
  finishedAt: null,

  toast: null,
  bookOpen: false,
  peekActive: false,
  bookVersion: 0,

  setSetting: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  showToast: (message) => {
    set({ toast: message });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 2200);
  },

  setBookOpen: (open) => set({ bookOpen: open }),
  setPeekActive: (active) => set({ peekActive: active }),
  refreshBook: () => set((s) => ({ bookVersion: s.bookVersion + 1 })),

  startQuiz: (words, sourceLabel, mode, levelsArg, rewardArg) => {
    const { shuffle, challenge } = get().settings;
    const useMode: QuizMode = mode ?? (challenge ? 'challenge' : 'normal');

    let list: WordItem[];
    let levels: QuizLevel[] = [];
    if (useMode === 'challenge') {
      // 一关 = 一个单元；打乱只在各关内部进行，单元（关卡）顺序保持不变。
      // 未提供关卡定义（自定义词库 / 旧版整本词库）时整份词表作为一关。
      const defs =
        levelsArg && levelsArg.length > 0
          ? levelsArg
          : [{ title: '', words: words.slice() }];
      levels = defs.map((lv) => ({
        title: lv.title,
        words: shuffle ? shuffleWords(lv.words) : lv.words.slice(),
      }));
      list = levels.flatMap((lv) => lv.words);
    } else {
      list = shuffle ? shuffleWords(words) : words.slice();
    }

    // 闯关奖励配置：单元数决定金币加成；整年级全部单元使用专属奖励与 10 颗心
    const challengeReward: ChallengeRewardConfig =
      useMode === 'challenge'
        ? {
            unitCount: Math.max(1, Math.floor(rewardArg?.unitCount ?? levels.length) || 1),
            fullGrade: rewardArg?.fullGrade ?? false,
          }
        : DEFAULT_CHALLENGE_REWARD;
    const initialLives = challengeReward.fullGrade ? FULL_GRADE_LIVES : LEVEL_LIVES;

    set({
      mode: useMode,
      words: list,
      sourceLabel,
      index: 0,
      cells: cellsOf(list[0]!),
      locked: false,
      records: [],
      levels,
      levelIndex: 0,
      levelCount: Math.max(1, levels.length),
      challengeReward,
      initialLives,
      lives: initialLives,
      gate: null,
      combo: 0,
      maxCombo: 0,
      startedAt: Date.now(),
      finishedAt: null,
      view: 'quiz',
    });
  },

  setLetter: (i, letter) =>
    set((s) => {
      const target = s.cells[i];
      if (!target || target.fixed) return {};
      const cells = s.cells.slice();
      cells[i] = { ...target, letter };
      return { cells };
    }),

  clearLetters: () =>
    set((s) => ({
      cells: s.cells.map((c) => (c.fixed ? c : { ...c, letter: '' })),
    })),

  judge: () => {
    const s = get();
    const word = s.words[s.index]!;
    const answer = s.cells.map((c) => c.letter).join('');
    const correct = isAnswerCorrect(answer, word.name);
    const record: QuizRecord = { ...word, answer, correct };
    if (!correct) {
      addWrongWord(word);
    }
    const combo = correct ? s.combo + 1 : 0;
    set({
      locked: true,
      records: [...s.records, record],
      combo,
      maxCombo: Math.max(s.maxCombo, combo),
      lives: !correct && s.mode === 'challenge' ? Math.max(0, s.lives - 1) : s.lives,
      bookVersion: correct ? s.bookVersion : s.bookVersion + 1,
    });
    return record;
  },

  judgeTimeout: () => {
    const s = get();
    if (s.locked) return; // 与手动确认竞速时，只结算一次
    const word = s.words[s.index]!;
    const answer = s.cells.map((c) => c.letter).join('');
    const record: QuizRecord = { ...word, answer, correct: false, timeout: true };
    addWrongWord(word);
    set({
      locked: true,
      records: [...s.records, record],
      combo: 0,
      lives: s.mode === 'challenge' ? Math.max(0, s.lives - 1) : s.lives,
      bookVersion: s.bookVersion + 1,
    });
  },

  next: () => {
    const s = get();
    if (s.index + 1 < s.words.length) {
      const index = s.index + 1;
      set({ index, cells: cellsOf(s.words[index]!), locked: false });
    } else {
      set({ view: 'result', locked: false, finishedAt: Date.now() });
    }
  },

  advance: () => {
    const s = get();
    if (s.mode !== 'challenge') {
      s.next();
      return;
    }
    // 生命用尽：立即判本关失败（即使刚答完最后一个词，失败优先）
    if (s.lives <= 0) {
      set({ gate: 'fail' });
      return;
    }
    const { end } = levelRange(s.levels, s.levelIndex);
    if (s.index + 1 < end) {
      const index = s.index + 1;
      set({ index, cells: cellsOf(s.words[index]!), locked: false });
      return;
    }
    // 本关全部答完且仍有剩余生命
    if (s.levelIndex + 1 >= s.levelCount) {
      void rewardsApi.recordRun();
      set({ gate: 'complete' });
    } else {
      set({ gate: 'pass' });
    }
  },

  nextLevel: () => {
    const s = get();
    const levelIndex = s.levelIndex + 1;
    const index = levelRange(s.levels, levelIndex).start;
    set({
      gate: null,
      levelIndex,
      index,
      cells: cellsOf(s.words[index]!),
      locked: false,
      // 整年级闯关：10 颗心整轮共用，过关后不清空；其余模式每关恢复 3 颗心
      lives: s.challengeReward.fullGrade ? s.lives : s.initialLives,
    });
  },

  retryLevel: () => {
    const s = get();
    // 整年级闯关：任一小关卡失败即整轮结束，不允许重试本关
    if (s.challengeReward.fullGrade) return;
    const index = levelRange(s.levels, s.levelIndex).start;
    set({
      gate: null,
      index,
      cells: cellsOf(s.words[index]!),
      locked: false,
      lives: s.initialLives,
      combo: 0,
      // 丢弃本次失败尝试的答题记录，之前已通过关卡的记录保留
      records: s.records.slice(0, index),
    });
  },

  finishRun: () => {
    set({ gate: null, view: 'result', locked: false, finishedAt: Date.now() });
  },

  restart: () => {
    const s = get();
    // 闯关模式带上关卡（单元）定义与奖励配置，重玩时仍是「一个单元一关」、奖励规则不变
    get().startQuiz(
      s.words,
      s.sourceLabel,
      s.mode,
      s.levels.length > 0 ? s.levels : undefined,
      s.mode === 'challenge' ? s.challengeReward : undefined,
    );
  },

  goHome: () => set({ view: 'home', locked: false, gate: null }),
}));

/* ----------------------------- 选择器 ----------------------------- */

export function selectCorrectCount(s: QuizState): number {
  return s.records.reduce((n, r) => (r.correct ? n + 1 : n), 0);
}
