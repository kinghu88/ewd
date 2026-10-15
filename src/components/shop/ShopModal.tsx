import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BadgeCheck,
  Check,
  Coins,
  Copy,
  Eye,
  Package,
  ShoppingBag,
  Store,
  Ticket,
} from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogXClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { shopApi, ApiError, type ShopItem, type ShopVoucher } from '@/lib/api';
import { useQuizStore } from '@/store/useQuizStore';
import { iconForSku, tileForSku } from '@/lib/shop';
import { cn } from '@/lib/utils';

interface ShopModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TabId = 'props' | 'gifts' | 'vouchers';

/** 待兑换凭证数量（用于标签角标） */
function countUnused(vouchers: ShopVoucher[]): number {
  return vouchers.filter((v) => v.status === 'unused').length;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ------------------------------- 兑换凭证卡片 ------------------------------- */

function VoucherCard({ voucher, highlight, onCopied }: {
  voucher: ShopVoucher;
  highlight: boolean;
  onCopied: (code: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(voucher.code);
    } catch {
      // 非安全上下文（http 内网 IP 等）下剪贴板可能不可用，降级为选中态提示手动复制
    }
    setCopied(true);
    onCopied(voucher.code);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className={cn(
        'shop-voucher relative overflow-hidden rounded-2xl border-[1.5px] bg-white transition-shadow',
        highlight
          ? 'border-[#f0a020] shadow-[0_10px_28px_rgba(240,160,32,.28)]'
          : 'border-[#e3c9a0] shadow-[0_4px_14px_rgba(160,120,60,.10)]',
      )}
    >
      {/* 左侧票根 */}
      <div className="flex items-stretch">
        <div className="flex w-[86px] flex-none flex-col items-center justify-center gap-1 bg-[#e0651f] py-4 text-white">
          <Ticket className="h-6 w-6" />
          <span className="text-[11.5px] font-bold tracking-wide">兑换券</span>
        </div>
        <div className="min-w-0 flex-1 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[15.5px] font-extrabold text-foreground">
              {voucher.item_name}
            </p>
            <span className="flex-none rounded-full bg-[#e7f7ef] px-2 py-0.5 text-[11.5px] font-bold text-[#18a068]">
              {voucher.status === 'unused' ? '待兑换' : voucher.status === 'redeemed' ? '已兑换' : '已失效'}
            </span>
          </div>
          <button
            type="button"
            onClick={copyCode}
            className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-[#d8b57e] bg-[#fffaf0] px-2.5 py-1.5 text-left transition-colors hover:bg-[#fff3da]"
            aria-label="复制兑换码"
          >
            <code className="select-all text-[15px] font-extrabold tracking-[0.12em] text-[#b45309]">
              {voucher.code}
            </code>
            {copied ? (
              <Check className="h-4 w-4 flex-none text-[#18a068]" />
            ) : (
              <Copy className="h-4 w-4 flex-none text-[#c08a3e]" />
            )}
          </button>
          <p className="mt-1.5 text-[11.5px] leading-4 text-muted-foreground">
            {formatDate(voucher.created_at)} 生成 · 凭码向老师 / 家长领取实物，一券一兑
          </p>
        </div>
      </div>
      {/* 票根撕齿 */}
      <div className="shop-voucher-perfs pointer-events-none absolute inset-y-0 left-[86px] w-0" aria-hidden />
    </div>
  );
}

/* --------------------------------- 商品卡片 --------------------------------- */

function ItemCard({ item, busy, justBought, onBuy }: {
  item: ShopItem;
  busy: boolean;
  justBought: boolean;
  onBuy: (item: ShopItem) => void;
}) {
  const coins = useQuizStore((s) => s.coins);
  const Icon = iconForSku(item.id, item.kind);
  const soldOut = item.stock !== null && item.stock <= 0;
  const affordable = coins >= item.price_coins;
  const disabled = busy || soldOut || !affordable;

  const buttonText = soldOut
    ? '已兑完'
    : !affordable
      ? '金币不足'
      : justBought
        ? '已加入背包'
        : '立即兑换';

  return (
    <div className="flex flex-col rounded-2xl border-[1.5px] border-[#e3eaf5] bg-white p-4 shadow-[0_4px_14px_rgba(70,100,160,.07)]">
      <div className="flex items-start gap-3">
        <span
          className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl text-white shadow-sm"
          style={{ background: tileForSku(item.id) }}
        >
          <Icon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15.5px] font-extrabold">
            {item.name}
            {item.kind === 'prop' && item.owned > 0 && (
              <span className="rounded-full bg-[#eaf2ff] px-1.5 py-0.5 text-[11px] font-bold text-primary">
                持有 {item.owned}
              </span>
            )}
          </p>
          {/* 常驻价格行：道具标金币单价，礼物标金币价 + 1:1 人民币价值；按钮禁用时价格依然可见 */}
          <p className="mt-1 flex flex-wrap items-center gap-x-1 text-[12.5px] font-extrabold leading-5 text-[#c2610f]">
            <Coins className="h-3.5 w-3.5 flex-none text-[#e08a1e]" />
            <span className="whitespace-nowrap">{item.price_coins} 金币</span>
            <span className="whitespace-nowrap font-bold text-[#a8906a]">
              {item.kind === 'gift' ? `（等值人民币 ${item.price_coins} 元）` : '/ 个'}
            </span>
          </p>
        </div>
      </div>

      <p className="mt-2.5 min-h-[54px] text-[12.5px] leading-5 text-muted-foreground">
        {item.description}
      </p>

      {item.kind === 'gift' && (
        <p className="mb-2 text-[12px] font-bold text-muted-foreground">
          {soldOut ? (
            <span className="text-[#d64545]">库存：已兑完</span>
          ) : item.stock !== null && item.stock <= 8 ? (
            <span className="text-[#d97706]">仅剩 {item.stock} 件，先到先得</span>
          ) : item.stock !== null ? (
            <span>库存 {item.stock} 件</span>
          ) : null}
        </p>
      )}
      {item.kind === 'prop' && (
        <p className="mb-2 text-[12px] text-muted-foreground">
          累计使用 <b className="text-foreground">{item.used_count}</b> 次
        </p>
      )}

      <Button
        size="sm"
        className={cn('mt-auto w-full', justBought && 'border-[#9bd8b8] bg-[#e7f7ef] text-[#18a068] hover:bg-[#e7f7ef]')}
        variant={justBought ? 'outline' : 'default'}
        disabled={disabled}
        onClick={() => onBuy(item)}
      >
        {justBought ? (
          <BadgeCheck className="h-4 w-4" />
        ) : (
          !soldOut && !justBought && <Coins className="h-4 w-4 text-[#ffd68a]" />
        )}
        {buttonText}
      </Button>
    </div>
  );
}

/* --------------------------------- 商店弹窗 --------------------------------- */

export function ShopModal({ open, onOpenChange }: ShopModalProps) {
  const coins = useQuizStore((s) => s.coins);
  const refreshShop = useQuizStore((s) => s.refreshShop);

  const [tab, setTab] = useState<TabId>('props');
  const [items, setItems] = useState<ShopItem[]>([]);
  const [vouchers, setVouchers] = useState<ShopVoucher[]>([]);
  const [loading, setLoading] = useState(false);
  const [busySku, setBusySku] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 道具兑换成功的短暂反馈 */
  const [justBought, setJustBought] = useState<string | null>(null);
  /** 高价值礼物的二次确认 */
  const [confirmItem, setConfirmItem] = useState<ShopItem | null>(null);
  const [newVoucherId, setNewVoucherId] = useState<number | null>(null);
  const vouchersLoaded = useRef(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await shopApi.catalog();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '商店加载失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadVouchers = useCallback(async () => {
    try {
      const res = await shopApi.vouchers();
      setVouchers(res.vouchers);
      vouchersLoaded.current = true;
    } catch {
      /* 凭证加载失败保留空列表，可通过切走再切回重试 */
      vouchersLoaded.current = false;
    }
  }, []);

  // 每次打开：重置状态并加载目录；切到兑换券页时懒加载凭证
  useEffect(() => {
    if (!open) return;
    setTab('props');
    setConfirmItem(null);
    setError(null);
    setJustBought(null);
    setNewVoucherId(null);
    vouchersLoaded.current = false;
    void loadCatalog();
  }, [open, loadCatalog]);

  useEffect(() => {
    if (open && tab === 'vouchers' && !vouchersLoaded.current) void loadVouchers();
  }, [open, tab, loadVouchers]);

  const handleBuy = async (item: ShopItem) => {
    if (busySku) return;
    if (item.kind === 'gift') {
      // 实物礼物为 1:1 真实价值，必须二次确认后再扣款
      setConfirmItem(item);
      return;
    }
    await doPurchase(item);
  };

  const doPurchase = async (item: ShopItem) => {
    setBusySku(item.id);
    setError(null);
    try {
      const res = await shopApi.purchase(item.id, 1);
      await refreshShop();
      await loadCatalog();
      if (res.vouchers.length > 0) {
        // 礼物兑换成功：跳到凭证页并高亮新券
        setConfirmItem(null);
        setNewVoucherId(null);
        setTab('vouchers');
        const fresh = await shopApi.vouchers();
        setVouchers(fresh.vouchers);
        vouchersLoaded.current = true;
        const newest = fresh.vouchers.find((v) => res.vouchers.includes(v.code));
        setNewVoucherId(newest?.id ?? fresh.vouchers[0]?.id ?? null);
      } else {
        // 道具入包：卡片短暂成功反馈
        setJustBought(item.id);
        setTimeout(() => setJustBought((cur) => (cur === item.id ? null : cur)), 1600);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '兑换失败，请稍后再试');
      // 余额 / 库存以服务端为准，失败后回拉一次
      void refreshShop();
    } finally {
      setBusySku(null);
    }
  };

  const props = items.filter((i) => i.kind === 'prop');
  const gifts = items.filter((i) => i.kind === 'gift');
  const unusedVouchers = countUnused(vouchers);

  const TABS: Array<{ id: TabId; label: string; icon: typeof Package; badge?: number }> = [
    { id: 'props', label: '道具', icon: Eye },
    { id: 'gifts', label: '实物礼物', icon: ShoppingBag },
    { id: 'vouchers', label: '我的兑换券', icon: Ticket, badge: unusedVouchers },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5 text-[#e08a1e]" />
            金币商店
          </DialogTitle>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border-[1.5px] border-[#f3d8a4] bg-[#fffaf0] px-3 py-1 text-[14px] font-extrabold text-[#d97706]">
              <Coins className="h-4 w-4" />
              {coins}
            </span>
            <DialogXClose />
          </div>
        </DialogHeader>

        <div className="flex gap-1 border-b px-4 pt-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative flex items-center gap-1.5 rounded-t-lg px-3.5 py-2.5 text-[14px] font-bold transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                {!!t.badge && t.badge > 0 && (
                  <span className="rounded-full bg-[#e63946] px-1.5 text-[10.5px] font-extrabold leading-4 text-white">
                    {t.badge}
                  </span>
                )}
                {active && <span className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>

        <DialogBody className="px-4 py-4">
          {loading && items.length === 0 ? (
            <div className="py-14 text-center text-[14px] text-muted-foreground">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-[3px] border-[#dce7f6] border-t-primary" />
              正在加载商品…
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-3 rounded-xl border border-[#f6d9c8] bg-[#fdf3ed] px-3.5 py-2.5 text-[13px] text-[#a85a2f]">
                  {error}
                </div>
              )}

              {tab === 'props' && (
                <>
                  <p className="mb-3 text-[12.5px] leading-5 text-muted-foreground">
                    道具在默写练习中使用：遇到不会的单词消耗「查看单词」，冲锋枪会把字母逐个打在四线格上，看完凭记忆写出来。
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {props.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        busy={busySku === item.id}
                        justBought={justBought === item.id}
                        onBuy={handleBuy}
                      />
                    ))}
                  </div>
                </>
              )}

              {tab === 'gifts' && (
                <>
                  <div className="mb-3 rounded-xl border border-[#f3d8a4] bg-[#fffaf0] px-3.5 py-2.5 text-[12.5px] leading-5 text-[#9a6414]">
                    实物礼物按 <b>金币与人民币 1:1 等值兑换</b>，兑换成功立即生成专属兑换凭证，
                    凭券向老师 / 家长领取实物；礼物数量有限，兑完即止。
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {gifts.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        busy={busySku === item.id}
                        justBought={false}
                        onBuy={handleBuy}
                      />
                    ))}
                  </div>
                </>
              )}

              {tab === 'vouchers' && (
                <div className="space-y-3">
                  {vouchers.length === 0 ? (
                    <div className="py-14 text-center">
                      <Ticket className="mx-auto mb-3 h-10 w-10 text-[#c3cede]" />
                      <p className="text-[14px] font-bold text-muted-foreground">还没有兑换券</p>
                      <p className="mt-1 text-[12.5px] text-muted-foreground">
                        去「实物礼物」页挑选礼物，兑换后凭证会出现在这里
                      </p>
                    </div>
                  ) : (
                    vouchers.map((v) => (
                      <VoucherCard
                        key={v.id}
                        voucher={v}
                        highlight={v.id === newVoucherId}
                        onCopied={() => undefined}
                      />
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </DialogBody>
      </DialogContent>

      {/* 高价值礼物二次确认（Portal 在 Dialog 内层级渲染） */}
      {confirmItem && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(30,42,66,.5)] px-6"
          onClick={() => !busySku && setConfirmItem(null)}
        >
          <div
            className="w-full max-w-[380px] rounded-2xl bg-white p-5 shadow-[0_24px_60px_rgba(30,42,66,.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[16.5px] font-extrabold">确认兑换礼物</p>
            <p className="mt-2.5 text-[13.5px] leading-6 text-muted-foreground">
              将花费 <b className="text-[#d97706]">{confirmItem.price_coins} 金币</b>
              （等值人民币 {confirmItem.price_coins} 元）兑换
              【{confirmItem.name}】，成功后生成兑换凭证，
              <b className="text-[#d64545]">金币不予退回</b>，确认继续？
            </p>
            <div className="mt-4 flex gap-2.5">
              <Button
                variant="outline"
                className="flex-1"
                disabled={busySku !== null}
                onClick={() => setConfirmItem(null)}
              >
                再想想
              </Button>
              <Button
                className="flex-1"
                disabled={busySku !== null || coins < confirmItem.price_coins}
                onClick={() => void doPurchase(confirmItem)}
              >
                {busySku === confirmItem.id ? '兑换中…' : '确认兑换'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
