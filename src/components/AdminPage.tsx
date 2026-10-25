import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Coins,
  LockKeyhole,
  LogOut,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Store,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AdminUsersPanel } from '@/components/AdminUsersPanel';
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
  type AdminShopItem,
  type AdminShopItemInput,
  type ShopItemKind,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const TOKEN_KEY = 'ewd_admin_token';

const INPUT_CLASS =
  'h-11 w-full rounded-xl border-[1.5px] border-[#dce7f6] bg-[#f8fbff] px-3.5 text-[14.5px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary';

interface Draft {
  id: string;
  kind: ShopItemKind;
  name: string;
  description: string;
  price_coins: string;
  stock: string;
  sort: string;
  active: boolean;
}

interface EditorState {
  mode: 'create' | 'edit';
  originalId: string | null;
  draft: Draft;
}

const EMPTY_DRAFT: Draft = {
  id: '',
  kind: 'prop',
  name: '',
  description: '',
  price_coins: '',
  stock: '',
  sort: '100',
  active: true,
};

function toDraft(item: AdminShopItem): Draft {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    description: item.description,
    price_coins: String(item.price_coins),
    stock: item.stock === null ? '' : String(item.stock),
    sort: String(item.sort),
    active: item.active === 1,
  };
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* --------------------------------- 页面 --------------------------------- */

export function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '');
  const [view, setView] = useState<'shop' | 'users'>('shop');
  const [password, setPassword] = useState('');
  const [items, setItems] = useState<AdminShopItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
    setItems([]);
  }, []);

  const loadItems = useCallback(
    async (authToken: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await adminApi.items(authToken);
        setItems(res.items);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          setError('管理登录已失效，请重新输入密码');
        } else {
          setError(err instanceof ApiError ? err.message : '商品加载失败，请稍后再试');
        }
      } finally {
        setLoading(false);
      }
    },
    [clearSession],
  );

  useEffect(() => {
    if (token) void loadItems(token);
  }, [token, loadItems]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (loading || !password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.login(password);
      sessionStorage.setItem(TOKEN_KEY, res.token);
      setToken(res.token);
      setPassword('');
      setNotice('登录成功');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setFormError(null);
    setEditor({ mode: 'create', originalId: null, draft: { ...EMPTY_DRAFT } });
  };

  const openEdit = (item: AdminShopItem) => {
    setFormError(null);
    setEditor({ mode: 'edit', originalId: item.id, draft: toDraft(item) });
  };

  const patchDraft = (patch: Partial<Draft>) => {
    setEditor((cur) => (cur ? { ...cur, draft: { ...cur.draft, ...patch } } : cur));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editor || !token || saving) return;
    setFormError(null);

    const d = editor.draft;
    const name = d.name.trim();
    const price = Number(d.price_coins);
    const sort = Number(d.sort);
    if (!name) {
      setFormError('请输入商品名称');
      return;
    }
    if (!Number.isInteger(price) || price < 1) {
      setFormError('价格需为大于 0 的整数');
      return;
    }
    if (!Number.isInteger(sort) || sort < 0) {
      setFormError('排序需为 0 或正整数');
      return;
    }
    let stock: number | null = null;
    if (d.kind === 'gift') {
      stock = Number(d.stock);
      if (d.stock.trim() === '' || !Number.isInteger(stock) || stock < 0) {
        setFormError('实物礼物必须填写不小于 0 的库存件数');
        return;
      }
    }

    const input: AdminShopItemInput = {
      kind: d.kind,
      name,
      description: d.description.trim(),
      price_coins: price,
      stock,
      sort,
      active: d.active,
    };

    setSaving(true);
    try {
      if (editor.mode === 'create') {
        await adminApi.create(token, {
          ...input,
          id: d.id.trim() || undefined,
        });
        setNotice('商品已添加');
      } else if (editor.originalId) {
        await adminApi.update(token, editor.originalId, input);
        setNotice('商品已保存');
      }
      setEditor(null);
      await loadItems(token);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : '保存失败，请稍后再试');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: AdminShopItem) => {
    if (!token || busyId) return;
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      await adminApi.update(token, item.id, { active: item.active !== 1 });
      setNotice(item.active === 1 ? `「${item.name}」已下架` : `「${item.name}」已上架`);
      await loadItems(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败，请稍后再试');
    } finally {
      setBusyId(null);
    }
  };

  /* -------------------------------- 登录页 -------------------------------- */

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px] rounded-[18px] bg-card p-6 shadow-[0_8px_30px_rgba(70,100,160,.12)] sm:p-8">
          <div className="pb-5 text-center">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff3da] text-[#d97706]">
              <Store className="h-7 w-7" />
            </span>
            <h1 className="text-[23px] font-bold">管理后台</h1>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground">
              管理金币商店商品，以及用户金币与流水
            </p>
          </div>
          <form onSubmit={handleLogin} className="flex flex-col gap-3.5">
            <label className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-[#dce7f6] bg-[#f8fbff] px-3.5 focus-within:border-primary">
              <LockKeyhole className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="管理密码"
                autoComplete="current-password"
                className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70"
              />
            </label>
            {error && (
              <p className="rounded-lg bg-[#fdf0ed] px-3 py-2 text-[13.5px] text-[#d1432e]">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="mt-1 w-full" disabled={loading || !password}>
              {loading ? '登录中…' : '进入后台'}
            </Button>
          </form>
          <p className="mt-4 text-center text-[12.5px] leading-5 text-muted-foreground">
            管理密码可在服务端启动日志查看
            <br />
            或查看 server/data/admin-password.txt
            <br />
            也可通过环境变量 ADMIN_PASSWORD 指定
          </p>
          <p className="mt-3 text-center text-[12px] text-muted-foreground">
            <a href="/" className="underline-offset-2 hover:text-primary hover:underline">
              返回默写首页
            </a>
          </p>
        </div>
      </div>
    );
  }

  /* -------------------------------- 管理页 -------------------------------- */

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1040px] px-4 pb-12 pt-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-card px-5 py-4 shadow-[0_8px_30px_rgba(70,100,160,.12)]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fff3da] text-[#d97706]">
            <Store className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[20px] font-bold leading-tight">管理后台</h1>
            <p className="text-[12.5px] text-muted-foreground">
              {view === 'shop'
                ? `共 ${items.length} 个商品 · 上架 ${items.filter((i) => i.active === 1).length} 个`
                : '管理用户、调整金币并查看流水'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === 'shop' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadItems(token)}
                disabled={loading}
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                刷新
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                新增商品
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearSession();
              setNotice(null);
            }}
          >
            <LogOut className="h-4 w-4" />
            退出
          </Button>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-[#f1f5fb] p-1 sm:w-[320px]">
        {(
          [
            { value: 'shop', label: '商品管理', icon: Store },
            { value: 'users', label: '用户管理', icon: Users },
          ] as const
        ).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setView(value);
              setError(null);
              setNotice(null);
            }}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg py-2 text-[14px] font-bold transition-all',
              view === value ? 'bg-white text-[#4a7bf6] shadow-sm' : 'text-muted-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {view === 'users' ? (
        <AdminUsersPanel
          token={token}
          onSessionExpired={() => {
            clearSession();
            setError('管理登录已失效，请重新输入密码');
          }}
        />
      ) : (
        <>
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
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="bg-[#f7faff] text-[12.5px] font-bold text-muted-foreground">
              <th className="px-4 py-3">商品</th>
              <th className="px-3 py-3">类型</th>
              <th className="px-3 py-3">价格</th>
              <th className="px-3 py-3">库存</th>
              <th className="px-3 py-3">排序</th>
              <th className="px-3 py-3">状态</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-[#edf2f9] align-top text-[13.5px]">
                <td className="max-w-[360px] px-4 py-3">
                  <p className="font-extrabold text-foreground">{item.name}</p>
                  <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">{item.id}</p>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                    {item.description || '（无描述）'}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    创建于 {formatDate(item.created_at)}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold',
                      item.kind === 'prop'
                        ? 'bg-[#eaf2ff] text-[#3f6fd8]'
                        : 'bg-[#fff3da] text-[#b36b00]',
                    )}
                  >
                    <Package className="h-3 w-3" />
                    {item.kind === 'prop' ? '道具' : '实物礼物'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 font-bold text-[#c2610f]">
                  <span className="inline-flex items-center gap-1">
                    <Coins className="h-3.5 w-3.5" />
                    {item.price_coins}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                  {item.kind === 'prop' ? '不限量' : item.stock === null ? '—' : `${item.stock} 件`}
                </td>
                <td className="px-3 py-3 text-muted-foreground">{item.sort}</td>
                <td className="px-3 py-3">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11.5px] font-bold',
                      item.active === 1
                        ? 'bg-[#e7f7ef] text-[#18a068]'
                        : 'bg-[#eef1f6] text-[#7a869a]',
                    )}
                  >
                    {item.active === 1 ? '在售' : '已下架'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(item)}>
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </Button>
                    <Button
                      variant={item.active === 1 ? 'ghost' : 'secondary'}
                      size="sm"
                      disabled={busyId === item.id}
                      onClick={() => void toggleActive(item)}
                    >
                      {busyId === item.id ? '处理中…' : item.active === 1 ? '下架' : '上架'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-[14px] text-muted-foreground">
                  {loading ? '正在加载商品…' : '还没有商品，点右上角「新增商品」开始添加'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[12.5px] leading-5 text-muted-foreground">
        下架的商品不会出现在学员的金币商店中，已购买的库存 / 兑换券不受影响；SKU 创建后不可修改。
      </p>

      {/* 新增 / 编辑弹窗 */}
      <Dialog open={editor !== null} onOpenChange={(v) => !v && !saving && setEditor(null)}>
        <DialogContent className="max-h-[90vh] max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{editor?.mode === 'edit' ? '编辑商品' : '新增商品'}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {editor && (
              <form id="admin-item-form" onSubmit={save} className="flex flex-col gap-3.5 py-1">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-bold">商品名称 *</span>
                    <input
                      value={editor.draft.name}
                      onChange={(e) => patchDraft({ name: e.target.value })}
                      maxLength={40}
                      placeholder="例如：查看单词"
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-bold">类型 *</span>
                    <select
                      value={editor.draft.kind}
                      onChange={(e) =>
                        patchDraft({ kind: e.target.value === 'gift' ? 'gift' : 'prop' })
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="prop">道具</option>
                      <option value="gift">实物礼物</option>
                    </select>
                  </label>
                </div>

                {editor.mode === 'create' && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-bold">SKU（可留空自动生成）</span>
                    <input
                      value={editor.draft.id}
                      onChange={(e) => patchDraft({ id: e.target.value })}
                      maxLength={40}
                      placeholder="小写字母 / 数字 / - / _"
                      className={INPUT_CLASS}
                    />
                  </label>
                )}

                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-bold">商品描述</span>
                  <textarea
                    value={editor.draft.description}
                    onChange={(e) => patchDraft({ description: e.target.value })}
                    maxLength={300}
                    rows={4}
                    placeholder="展示给学员的说明文案"
                    className="w-full rounded-xl border-[1.5px] border-[#dce7f6] bg-[#f8fbff] px-3.5 py-3 text-[14px] leading-6 outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-bold">价格（金币）*</span>
                    <input
                      type="number"
                      min={1}
                      value={editor.draft.price_coins}
                      onChange={(e) => patchDraft({ price_coins: e.target.value })}
                      placeholder="3"
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-bold">
                      {editor.draft.kind === 'gift' ? '库存（件）*' : '库存'}
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={editor.draft.stock}
                      onChange={(e) => patchDraft({ stock: e.target.value })}
                      disabled={editor.draft.kind === 'prop'}
                      placeholder={editor.draft.kind === 'prop' ? '道具不限量' : '30'}
                      className={cn(INPUT_CLASS, 'disabled:opacity-60')}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-bold">排序</span>
                    <input
                      type="number"
                      min={0}
                      value={editor.draft.sort}
                      onChange={(e) => patchDraft({ sort: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </label>
                </div>

                <label className="flex cursor-pointer select-none items-center gap-2.5 rounded-xl bg-[#f8fbff] px-3.5 py-3 text-[14px]">
                  <input
                    type="checkbox"
                    checked={editor.draft.active}
                    onChange={(e) => patchDraft({ active: e.target.checked })}
                    className="h-4 w-4 accent-[#4a7bf6]"
                  />
                  立即上架（取消勾选则保存为下架）
                </label>

                {formError && (
                  <p className="rounded-lg bg-[#fdf0ed] px-3 py-2 text-[13.5px] text-[#d1432e]">
                    {formError}
                  </p>
                )}
                {editor.mode === 'edit' && (
                  <p className="text-[12px] text-muted-foreground">
                    SKU：<span className="font-mono">{editor.originalId}</span>（创建后不可修改）
                  </p>
                )}
              </form>
            )}
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" form="admin-item-form" disabled={saving}>
              {saving ? '保存中…' : editor?.mode === 'edit' ? '保存修改' : '添加商品'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  );
}
