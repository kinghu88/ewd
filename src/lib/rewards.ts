/* ------------------------------------------------------------------ */
/* 通关幸运红包（金币余额与通关轮数由服务端按用户存储）                    */
/*                                                                      */
/* 规则：每轮 3 个红包中有且仅有 1 个藏有金币（位置随机，能否选中看运气）， */
/* 另外 2 个是鼓励成语；金币红包内的数额按权重抽取：                       */
/*   · 1/2/3/5 金币：常见（合计 94%，基本都落在这个区间）                 */
/*   · 7/10/20 金币：较小概率（合计约 6%，约 20 轮能遇到一次）            */
/*   · 50/100 金币：极小概率，各为万分之一                                */
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

/** 从金币档位中按权重抽一个数额 */
export function drawCoinAmount(): number {
  let roll = Math.random() * PACKET_COIN_WEIGHT_SUM;
  for (const tier of PACKET_COIN_TIERS) {
    roll -= tier.weight;
    if (roll < 0) return tier.coins;
  }
  return PACKET_COIN_TIERS[PACKET_COIN_TIERS.length - 1]!.coins;
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
 * 生成一轮红包布局：count 个红包中有且仅有 1 个金币红包（位置随机），
 * 其余为互不重复的鼓励成语。布局在弹窗打开时就确定，用户能否选中金币
 * 完全取决于点击的位置（运气）。
 */
export function drawPacketLayout(count = 3): PacketSlot[] {
  const coinIndex = Math.floor(Math.random() * count);
  const idioms = drawIdioms(count - 1);
  const slots: PacketSlot[] = [];
  let idiomCursor = 0;
  for (let i = 0; i < count; i += 1) {
    if (i === coinIndex) {
      slots.push({ kind: 'coin', coins: drawCoinAmount() });
    } else {
      slots.push({ kind: 'cheer', idiom: idioms[idiomCursor]! });
      idiomCursor += 1;
    }
  }
  return slots;
}
