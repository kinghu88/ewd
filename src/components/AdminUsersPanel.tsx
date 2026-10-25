import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Coins,
  History,
  Minus,
  Plus,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  adminApi,
  ApiError,
  type AdminCoinTxn,
  type AdminUser,
  type CoinTxnSource,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const INPUT_CLASS =
  'h-11 w-full rounded-xl border-[1.5px] border-[#dce7f6] bg-[#f8fbff] px-3.5 text-[14.5px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary';

const MAX_CHANGE = 1000000;

const SOURCE_LABEL: Record<CoinTxnSource, string> = {
  redpacket: '红包收入',
  shop_purchase: '商店购买',
  admin_adjust: '管理员调整',
};

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${formatDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  token: string;
  onSessionExpired: () => void;
}

/* ------------------------------- 用户管理面板 ------------------------------- */

export function AdminUsersPanel({ token, onSessionExpired }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [target, setTarget] = useState<AdminUser | null>(null);
  const [direction, setDirection] = useState<'add' | 'deduct'>('add');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [history, setHistory] = useState<{
    user: AdminUser;
    transactions: AdminCoinTxn[];
  } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const handleError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return '管理登录已失效，请重新输入密码';
      }
      return err instanceof ApiError ? err.message : fallback;
    },
    [onSessionExpired],
  );

  const loadUsers = useCallback(
    async (authToken: string, keyword: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await adminApi.users(authToken, keyword);
        setUsers(res.users);
        setTotal(res.total);
      } catch (err) {
        setError(handleError(err, '用户加载失败，请稍后再试'));
      } finally {
        setLoading(false);
      }
    },
    [handleError],
  );

  useEffect(() => {
    void loadUsers(token, '');
  }, [token, loadUsers]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    void loadUsers(token, query);
  };

  const openAdjust = (user: AdminUser) => {
    setTarget(user);
    setDirection('add');
    setAmount('');
    setNote('');
    setFormError(null);
  };

  const amountNum = Number(amount);
  const validAmount = Number.isInteger(amountNum) && amountNum > 0 && amountNum <= MAX_CHANGE;
  const signedChange = direction === 'add' ? amountNum : -amountNum;
  const previewBalance = target ? target.coins + (validAmount ? signedChange : 0) : 0;

  const submitAdjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!target || saving) return;
    setFormError(null);

    if (!validAmount) {
      setFormError(`请输入 1~${MAX_CHANGE} 的整数金币`);
      return;
    }
    if (previewBalance < 0) {
      setFormError(`金币不足：当前 ${target.coins}，不能扣减 ${amountNum}`);
      return;
    }

    setSaving(true);
    try {
      const res = await adminApi.adjustCoins(token, target.id, signedChange, note.trim());
      setTarget(null);
      setNotice(
        `已为「${res.user.username}」${direction === 'add' ? '增加' : '扣减'} ${amountNum} 金币，当前余额 ${res.user.coins}`,
      );
      await loadUsers(token, query);
    } catch (err) {
      setFormError(handleError(err, '调整失败，请稍后再试'));
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async (user: AdminUser) => {
    setHistory({ user, transactions: [] });
    setHistoryLoading(true);
    setError(null);
    try {
      const res = await adminApi.userTransactions(token, user.id);
      setHistory(res);
    } catch (err) {
      setHistory(null);
      setError(handleError(err, '流水加载失败，请稍后再试'));
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form onSubmit={search} className="flex flex-1 items-center gap-2">
          <label className="flex h-11 min-w-[220px] flex-1 items-center gap-2 rounded-xl border-[1.5px] border-[#dce7f6] bg-[#f8fbff] px-3.5 focus-within:border-primary sm:max-w-[360px]">
            <Search className="h-[17px] w-[17px] shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索用户名或用户 ID"
              className="h-full w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/60"
            />
          </label>
          <Button type="submit" variant="outline" size="sm" disabled={loading}>
            搜索
          </Button>
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery('');
                setNotice(null);
                void loadUsers(token, '');
              }}
            >
              清空
            </Button>
          )}
        </form>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setNotice(null);
            void loadUsers(token, query);
          }}
          disabled={loading}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {(error || notice) && (
        <div
          className={cn(
            'mt-3 rounded-xl border px-4 py-2.5 text-[13.5px]',
            error
              ? 'border-[#f6d9c8] bg-[#fdf3ed] text-[#a85a2f]'
              : 'border-[#bfe8d2] bg-[#eefaf4] text-[#18845a]',
          )}
        >
          {error ?? notice}
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-[18px] border-[1.5px] border-[#e3eaf5] bg-card shadow-[0_8px_30px_rgba(70,100,160,.08)]">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="bg-[#f7faff] text-[12.5px] font-bold text-muted-foreground">
              <th className="px-4 py-3">用户</th>
              <th className="px-3 py-3">金币</th>
              <th className="px-3 py-3">通关轮数</th>
              <th className="px-3 py-3">注册时间</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-[#edf2f9] text-[13.5px]">
                <td className="px-4 py-3">
                  <p className="flex items-center gap-1.5 font-extrabold text-foreground">
                    <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                    {user.username}
                  </p>
                  <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
                    ID {user.id}
                  </p>
                </td>
                <td className="whitespace-nowrap px-3 py-3 font-bold text-[#c2610f]">
                  <span className="inline-flex items-center gap-1">
                    <Coins className="h-3.5 w-3.5" />
                    {user.coins}
                  </span>
                </td>
                <td className="px-3 py-3 text-muted-foreground">{user.runs}</td>
                <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                  {formatDate(user.created_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => openAdjust(user)}>
                      <Coins className="h-3.5 w-3.5" />
                      调整金币
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void openHistory(user)}>
                      <History className="h-3.5 w-3.5" />
                      流水
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center text-[14px] text-muted-foreground">
                  {loading
                    ? '正在加载用户…'
                    : query
                      ? `没有找到匹配「${query}」的用户`
                      : '还没有用户注册'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[12.5px] leading-5 text-muted-foreground">
        共 {total} 个用户，列表最多展示最近 100 个，可用用户名或 ID 精确查找。金币调整会写入流水，扣减不能使余额变成负数。
      </p>

      {/* 调整金币弹窗 */}
      <Dialog open={target !== null} onOpenChange={(v) => !v && !saving && setTarget(null)}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>调整金币</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {target && (
              <form id="admin-coin-form" onSubmit={submitAdjust} className="flex flex-col gap-3.5 py-1">
                <div className="rounded-xl bg-[#f7faff] px-4 py-3 text-[13.5px]">
                  <p className="font-extrabold text-foreground">
                    {target.username}
                    <span className="ml-2 font-mono text-[11.5px] font-normal text-muted-foreground">
                      ID {target.id}
                    </span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    当前余额 <span className="font-bold text-[#c2610f]">{target.coins}</span> 金币
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: 'add', label: '增加金币', icon: Plus },
                      { value: 'deduct', label: '扣减金币', icon: Minus },
                    ] as const
                  ).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setDirection(value);
                        setFormError(null);
                      }}
                      className={cn(
                        'flex items-center justify-center gap-1.5 rounded-xl border-[1.5px] py-2.5 text-[14px] font-bold transition-colors',
                        direction === value
                          ? 'border-primary bg-[#eaf2ff] text-[#3f6fd8]'
                          : 'border-[#dce7f6] bg-[#f8fbff] text-muted-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-bold">金币数量 *</span>
                    <input
                      type="number"
                      min={1}
                      max={MAX_CHANGE}
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setFormError(null);
                      }}
                      placeholder="50"
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-bold">调整后余额</span>
                    <div
                      className={cn(
                        'flex h-11 items-center rounded-xl border-[1.5px] px-3.5 text-[14.5px] font-bold',
                        previewBalance < 0
                          ? 'border-[#f0c4b8] bg-[#fdf3ed] text-[#c0392b]'
                          : 'border-[#e3eaf5] bg-[#f7faff] text-[#c2610f]',
                      )}
                    >
                      {previewBalance}
                    </div>
                  </label>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-bold">备注（写入流水，可留空）</span>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={100}
                    placeholder="例如：活动奖励 / 测试补偿"
                    className={INPUT_CLASS}
                  />
                </label>

                {formError && (
                  <p className="rounded-lg bg-[#fdf0ed] px-3 py-2 text-[13.5px] text-[#d1432e]">
                    {formError}
                  </p>
                )}
              </form>
            )}
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button variant="outline" onClick={() => setTarget(null)} disabled={saving}>
              取消
            </Button>
            <Button
              type="submit"
              form="admin-coin-form"
              disabled={saving || !validAmount || previewBalance < 0}
            >
              {saving ? '处理中…' : direction === 'add' ? '确认增加' : '确认扣减'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 金币流水弹窗 */}
      <Dialog open={history !== null} onOpenChange={(v) => !v && setHistory(null)}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>金币流水</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {history && (
              <>
                <p className="py-1 text-[13.5px] text-muted-foreground">
                  {history.user.username}
                  <span className="ml-2 font-mono text-[11.5px]">ID {history.user.id}</span>
                  <span className="ml-3">
                    当前余额 <span className="font-bold text-[#c2610f]">{history.user.coins}</span>
                  </span>
                </p>
                {historyLoading ? (
                  <p className="py-10 text-center text-[13.5px] text-muted-foreground">加载中…</p>
                ) : history.transactions.length === 0 ? (
                  <p className="py-10 text-center text-[13.5px] text-muted-foreground">
                    暂无金币流水
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 py-1">
                    {history.transactions.map((txn) => (
                      <div
                        key={txn.id}
                        className="flex items-start justify-between gap-3 rounded-xl bg-[#f7faff] px-3.5 py-2.5 text-[13px]"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-foreground">{SOURCE_LABEL[txn.source]}</p>
                          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                            {txn.ref || '—'} · {formatDateTime(txn.created_at)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={cn(
                              'font-extrabold',
                              txn.change > 0 ? 'text-[#18a068]' : 'text-[#c0392b]',
                            )}
                          >
                            {txn.change > 0 ? `+${txn.change}` : txn.change}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            余额 {txn.balance_after}
                          </p>
                        </div>
                      </div>
                    ))}
                    <p className="pt-1 text-[11.5px] text-muted-foreground">
                      最多展示最近 20 条流水
                    </p>
                  </div>
                )}
              </>
            )}
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button variant="outline" onClick={() => setHistory(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
