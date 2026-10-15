/**
 * 连击（连续答对）播报段位，灵感来自 MOBA 多杀播报。
 * combo = 当前连续答对数；答错或超时清零。
 */
export type ComboTierId = 'first' | 'double' | 'triple' | 'quadra' | 'penta' | 'legendary';

export interface ComboTier {
  id: ComboTierId;
  /** 英文大字 */
  en: string;
  /** 中文副标题 */
  zh: string;
  /** 横幅配色（CSS 颜色值） */
  color: string;
}

export const COMBO_TIERS: Record<Exclude<ComboTierId, 'first'>, ComboTier> = {
  double: { id: 'double', en: 'DOUBLE KILL', zh: '双杀！连续答对 2 个', color: '#f5a524' },
  triple: { id: 'triple', en: 'TRIPLE KILL', zh: '三杀！连续答对 3 个', color: '#fb8500' },
  quadra: { id: 'quadra', en: 'QUADRA KILL', zh: '四杀！连续答对 4 个', color: '#a855f7' },
  penta: { id: 'penta', en: 'PENTA KILL', zh: '五杀！连续答对 5 个', color: '#e63946' },
  legendary: { id: 'legendary', en: 'LEGENDARY', zh: '超神！连续答对 6 个以上', color: '#ffd23f' },
};

export const FIRST_BLOOD: ComboTier = {
  id: 'first',
  en: 'FIRST BLOOD',
  zh: '一血！连击开张',
  color: '#38bdf8',
};

/** 依据当前连击数返回播报段位；连击从 0 起步（首答 / 中断后重新开张）由调用方判断一血 */
export function tierOf(combo: number): ComboTier | null {
  if (combo >= 6) return COMBO_TIERS.legendary;
  if (combo === 5) return COMBO_TIERS.penta;
  if (combo === 4) return COMBO_TIERS.quadra;
  if (combo === 3) return COMBO_TIERS.triple;
  if (combo === 2) return COMBO_TIERS.double;
  return null;
}
