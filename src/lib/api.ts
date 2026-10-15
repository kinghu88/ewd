/**
 * 后端 API 客户端。
 *
 * 登录态：token 存 localStorage（开发期同源 /api，经 Vite 代理到 3001 端口；
 * 生产由 Node 服务同源托管）。金币、通关轮数以服务端为准，天然按用户隔离。
 */

const TOKEN_KEY = 'ewd_token';
const USER_KEY = 'ewd_user';

export interface AuthUser {
  id: number;
  username: string;
}

export interface ServerRewards {
  coins: number;
  runs: number;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const tokenStore = {
  get(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  set(token: string, user: AuthUser): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  getUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let resp: Response;
  try {
    resp = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError('无法连接服务器，请确认后端服务已启动', 0);
  }

  let payload: unknown = null;
  try {
    payload = await resp.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!resp.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `请求失败（${resp.status}）`;
    throw new ApiError(message, resp.status);
  }
  return payload as T;
}

export const authApi = {
  register(username: string, password: string) {
    return request<{ token: string; user: AuthUser; rewards: ServerRewards }>(
      '/api/auth/register',
      { method: 'POST', body: JSON.stringify({ username, password }) },
    );
  },
  login(username: string, password: string) {
    return request<{ token: string; user: AuthUser; rewards: ServerRewards }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ username, password }) },
    );
  },
  logout() {
    return request('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  },
  me() {
    return request<{ user: AuthUser; rewards: ServerRewards }>('/api/auth/me');
  },
};

/* -------------------------------- 商店系统 -------------------------------- */

export type ShopItemKind = 'prop' | 'gift';

/** 商品目录项（owned=当前用户持有数，used_count=该道具累计使用次数） */
export interface ShopItem {
  id: string;
  kind: ShopItemKind;
  name: string;
  description: string;
  /** 礼物价格即人民币价值（金币与人民币 1:1） */
  price_coins: number;
  /** null 表示道具不限量；礼物为剩余件数 */
  stock: number | null;
  sort: number;
  owned: number;
  used_count: number;
}

/** 实物礼物兑换凭证 */
export interface ShopVoucher {
  id: number;
  code: string;
  item_id: string;
  item_name: string;
  status: 'unused' | 'redeemed' | 'void';
  created_at: number;
  redeemed_at: number | null;
}

export interface PurchaseResult {
  ok: boolean;
  coins: number;
  /** 礼物购买后生成的兑换券码列表（道具购买为空数组） */
  vouchers: string[];
}

export interface ConsumeItemResult {
  ok: boolean;
  /** 消耗后该道具剩余数量 */
  remaining: number;
  coins: number;
}

/** 「查看单词」道具 sku */
export const PEEK_WORD_ITEM_ID = 'peek_word';

export const shopApi = {
  /** 商品目录 + 当前金币余额 */
  catalog() {
    return request<{ items: ShopItem[]; coins: number }>('/api/shop/catalog');
  },
  /** 购买：道具入背包、礼物生成兑换券；服务端事务保证原子性 */
  purchase(itemId: string, qty = 1) {
    return request<PurchaseResult>('/api/shop/purchase', {
      method: 'POST',
      body: JSON.stringify({ itemId, qty }),
    });
  },
  /** 当前用户的全部兑换凭证 */
  vouchers() {
    return request<{ vouchers: ShopVoucher[] }>('/api/shop/vouchers');
  },
  /** 消耗一个道具（原子扣库存 + 使用记录），context 记录使用场景 */
  consumeItem(itemId: string, context?: string) {
    return request<ConsumeItemResult>('/api/items/consume', {
      method: 'POST',
      body: JSON.stringify({ itemId, context }),
    });
  },
};

export const rewardsApi = {
  get() {
    return request<ServerRewards>('/api/rewards');
  },
  /** 红包金币到账（服务端校验 1~100 整数） */
  grant(coins: number) {
    return request<ServerRewards>('/api/rewards/grant', {
      method: 'POST',
      body: JSON.stringify({ coins }),
    });
  },
  /** 闯完全部小关：通关轮数 +1，失败静默（不阻断答题流程） */
  async recordRun(): Promise<void> {
    try {
      await request('/api/runs', { method: 'POST' });
    } catch {
      /* 网络异常时不影响答题，下次通关仍可正常累计 */
    }
  },
};
