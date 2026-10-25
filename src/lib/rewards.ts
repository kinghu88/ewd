/* ------------------------------------------------------------------ */
/* 通关幸运红包（金币余额与通关轮数由服务端按用户存储）                    */
/*                                                                      */
/* 规则：                                                                */
/*   · 1 个单元：3 个红包中有且仅有 1 个藏有金币（位置随机），另外 2 个是   */
/*     鼓励成语，金币按权重抽取。                                          */
/*   · 2~3 个单元：仍是 1 个金币红包，金币数额按 ×2 加成。                  */
/*   · 4 个单元以上：3 个红包中有 2 个藏有金币，单包按阶梯倍率加成，        */
/*     点任意红包即全部拆开、金币一次性到账。                              */
/*   · 整年级全部单元：3 个红包全部藏有金币，其中 1 个保底至少 10 金币。    */
/*   · 所有单个红包封顶 100 金币（与服务端硬校验一致）。                    */
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
 * 多单元奖励阶梯：单元数越多，金币红包个数与单包倍率同步提升。
 * 4 个单元起金币红包变为 2 个（3 选 2 有金币），合计收益随单元数递增，
 * 且始终低于整年级专属奖励（3 个金币红包 + 1 个保底 10）。
 */
export interface UnitRewardTier {
  /** 该档位覆盖的最大单元数（含） */
  maxUnits: number;
  /** 本轮金币红包个数（含金币的红包数量） */
  coinPackets: number;
  /** 单个金币红包的金币倍率 */
  multiplier: number;
}

export const UNIT_REWARD_TIERS: UnitRewardTier[] = [
  { maxUnits: 1, coinPackets: 1, multiplier: 1 },
  { maxUnits: 3, coinPackets: 1, multiplier: 2 },
  { maxUnits: 6, coinPackets: 2, multiplier: 1.5 },
  { maxUnits: 9, coinPackets: 2, multiplier: 2 },
  { maxUnits: Number.POSITIVE_INFINITY, coinPackets: 2, multiplier: 2.4 },
];

/** 超过该单元数后，3 个红包中有 2 个含金币 */
export const SECOND_COIN_PACKET_THRESHOLD = 3;

/** 按已选单元数取奖励档位（少于 1 个按 1 个处理） */
export function getUnitRewardTier(unitCount: number): UnitRewardTier {
  const units = Math.max(1, Math.floor(unitCount) || 1);
  return UNIT_REWARD_TIERS.find((tier) => units <= tier.maxUnits) ?? UNIT_REWARD_TIERS[UNIT_REWARD_TIERS.length - 1]!;
}

/**
 * 多单元奖励加成：基础金币 × 阶梯倍率，单个红包封顶 100。
 * 例如 7 个单元（×2）抽到 7 金币，实得 14 金币。
 */
export function scaleCoinByMultiplier(baseCoins: number, multiplier: number): number {
  return Math.min(PACKET_MAX_COINS, Math.round(baseCoins * multiplier));
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
 * - 4 个单元以上：count 个红包中有 2 个金币红包（各按阶梯倍率加成），其余为鼓励成语；
 * - 1~3 个单元：count 个红包中有且仅有 1 个金币红包（数额按档位加成），
 *   另外 count-1 个为互不重复的鼓励成语。
 * 金币位置随机，多金币红包时点开任意一个即可全部领取。
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

  const tier = getUnitRewardTier(reward.unitCount);
  const coinCount = Math.min(tier.coinPackets, count);
  const coinIndices = new Set(
    Array.from({ length: count }, (_, i) => i)
      .sort(() => Math.random() - 0.5)
      .slice(0, coinCount),
  );
  const idioms = drawIdioms(count - coinCount);
  const slots: PacketSlot[] = [];
  let idiomCursor = 0;
  for (let i = 0; i < count; i += 1) {
    if (coinIndices.has(i)) {
      slots.push({
        kind: 'coin',
        coins: scaleCoinByMultiplier(drawCoinAmount(), tier.multiplier),
      });
    } else {
      slots.push({ kind: 'cheer', idiom: idioms[idiomCursor]! });
      idiomCursor += 1;
    }
  }
  return slots;
}
