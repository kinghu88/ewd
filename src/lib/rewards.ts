/* ------------------------------------------------------------------ */
/* 通关幸运红包（金币余额与通关轮数由服务端按用户存储）                    */
/*                                                                      */
/* 规则：                                                                */
/*   · 单单元 / 多单元：3 个红包中有且仅有 1 个藏有金币（位置随机，        */
/*     能否选中看运气），另外 2 个是鼓励成语；金币红包内的数额按权重抽取，  */
/*     多选单元时按单元数线性加成（单个红包封顶 100 金币）。               */
/*   · 整年级全部单元：3 个红包全部藏有金币，其中 1 个保底至少 10 金币，   */
/*     另外 2 个随机，单个红包封顶 100 金币。                              */
/* ------------------------------------------------------------------ */

export interface CoinTier {
  /** 金币数额（1~100 整数，与服务端校验一致） */
  coins: number;
  /** 「金币红包内」抽中该数额的权重（合计 10000，即万分比） */
  weight: number;
}

/** 金币红包的数额档位；权重总量 10000，50/100 各为万分之一 */
export const PACKET_COIN_TIERS: CoinTier[] = [
  { coins: 1, weight: 2800 },
  { coins: 2, weight: 2500 },
  { coins: 3, weight: 2200 },
  { coins: 5, weight: 1900 },
  { coins: 7, weight: 350 },
  { coins: 10, weight: 180 },
  { coins: 20, weight: 68 },
  { coins: 50, weight: 1 },
  { coins: 100, weight: 1 },
];

export const PACKET_COIN_WEIGHT_SUM = PACKET_COIN_TIERS.reduce((s, t) => s + t.weight, 0);

/** 每轮红包个数 */
export const PACKET_COUNT = 3;
/** 单个红包的金币上限（与服务端硬校验一致） */
export const PACKET_MAX_COINS = 100;
/** 整年级通关时保底红包的最低金币数 */
export const FULL_GRADE_MIN_GUARANTEED_COINS = 10;

/** 本轮闯关的单元选择：用于决定金币加成与整年级专属奖励 */
export interface ChallengeRewardConfig {
  /** 本次选择的单元数量（>=1） */
  unitCount: number;
  /** 是否选择了整个年级的全部单元 */
  fullGrade: boolean;
}

/** 默认按单单元奖励处理 */
export const DEFAULT_CHALLENGE_REWARD: ChallengeRewardConfig = {
  unitCount: 1,
  fullGrade: false,
};

/** 没抽到金币时展示的鼓励成语池 */
export const PACKET_ENCOURAGEMENTS: string[] = [
  '再接再厉',
  '勇往直前',
  '锲而不舍',
  '持之以恒',
  '厚积薄发',
  '功不唐捐',
  '稳扎稳打',
  '水到渠成',
  '乘风破浪',
  '奋起直追',
  '越挫越勇',
  '行稳致远',
  '笃行不怠',
  '未来可期',
  '前程似锦',
  '鹏程万里',
  '大有可为',
  '金石可镂',
];

/** 一个红包翻开后的内容 */
export type PacketSlot =
  | { kind: 'coin'; coins: number }
  | { kind: 'cheer'; idiom: string };

/** 从金币档位中按权重抽一个数额（可用 minCoins 限定最低档位） */
export function drawCoinAmount(minCoins = 1): number {
  const tiers =
    minCoins > 1 ? PACKET_COIN_TIERS.filter((t) => t.coins >= minCoins) : PACKET_COIN_TIERS;
  const weightSum = tiers.reduce((s, t) => s + t.weight, 0);
  let roll = Math.random() * weightSum;
  for (const tier of tiers) {
    roll -= tier.weight;
    if (roll < 0) return tier.coins;
  }
  return tiers[tiers.length - 1]!.coins;
}

/**
 * 多单元奖励加成：基础金币 × 单元数，单个红包封顶 100。
 * 例如选 3 个单元时抽到 7 金币，实得 21 金币；抽到 50 金币则封顶 100。
 */
export function scaleCoinForUnits(baseCoins: number, unitCount: number): number {
  const units = Math.max(1, Math.floor(unitCount) || 1);
  return Math.min(PACKET_MAX_COINS, Math.round(baseCoins * units));
}

/** 从成语池中不放回地随机取 count 个（互不重复） */
export function drawIdioms(count: number): string[] {
  const pool = [...PACKET_ENCOURAGEMENTS];
  const picked: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked;
}

/**
 * 生成一轮红包布局：
 * - 整年级全部单元：count 个红包全部为金币，其中随机 1 个保底至少 10 金币；
 * - 其余情况：count 个红包中有且仅有 1 个金币红包（位置随机），金币按所选单元数加成，
 *   另外 count-1 个为互不重复的鼓励成语。
 * 布局在弹窗打开时就确定，用户能否选中金币完全取决于点击的位置（运气）。
 */
export function drawPacketLayout(
  reward: ChallengeRewardConfig = DEFAULT_CHALLENGE_REWARD,
  count = PACKET_COUNT,
): PacketSlot[] {
  if (reward.fullGrade) {
    const guaranteedIndex = Math.floor(Math.random() * count);
    return Array.from({ length: count }, (_, i) => ({
      kind: 'coin' as const,
      coins:
        i === guaranteedIndex
          ? drawCoinAmount(FULL_GRADE_MIN_GUARANTEED_COINS)
          : drawCoinAmount(),
    }));
  }

  const coinIndex = Math.floor(Math.random() * count);
  const idioms = drawIdioms(count - 1);
  const coins = scaleCoinForUnits(drawCoinAmount(), reward.unitCount);
  const slots: PacketSlot[] = [];
  let idiomCursor = 0;
  for (let i = 0; i < count; i += 1) {
    if (i === coinIndex) {
      slots.push({ kind: 'coin', coins });
    } else {
      slots.push({ kind: 'cheer', idiom: idioms[idiomCursor]! });
      idiomCursor += 1;
    }
  }
  return slots;
}
