/**
 * 商店前端展示元数据。
 * 商品的价格 / 库存 / 名称以服务端目录为准，这里只维护图标与配色等纯展示信息；
 * 未知 sku（如服务端新增商品）统一回退通用礼物图标，不影响购买闭环。
 */
import type { LucideIcon } from 'lucide-react';
import { Blocks, Car, Coffee, Eye, Gift, Headphones, PencilRuler } from 'lucide-react';

export const PEEK_SKU = 'peek_word';

/** sku -> 图标（未知 sku 用 Gift / Eye 兜底） */
export const ITEM_ICON: Record<string, LucideIcon> = {
  peek_word: Eye,
  gift_pencil_set: PencilRuler,
  gift_thermos_cup: Coffee,
  gift_earbuds: Headphones,
  gift_rc_car: Car,
  gift_building_blocks: Blocks,
};

/** sku -> 图标底板渐变色 */
export const ITEM_TILE: Record<string, string> = {
  peek_word: 'linear-gradient(135deg,#8fb8ff,#4a7bf6)',
  gift_pencil_set: 'linear-gradient(135deg,#ffd68a,#f0991f)',
  gift_thermos_cup: 'linear-gradient(135deg,#9fe3c6,#18a068)',
  gift_earbuds: 'linear-gradient(135deg,#c9b2ff,#7a5af0)',
  gift_rc_car: 'linear-gradient(135deg,#ff9a9a,#e63946)',
  gift_building_blocks: 'linear-gradient(135deg,#ffc98f,#e0651f)',
};

export function iconForSku(sku: string, kind: 'prop' | 'gift'): LucideIcon {
  return ITEM_ICON[sku] ?? (kind === 'prop' ? Eye : Gift);
}

export function tileForSku(sku: string): string {
  return ITEM_TILE[sku] ?? 'linear-gradient(135deg,#9fb6d8,#5f7693)';
}
