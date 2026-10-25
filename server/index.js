/**
 * 英语单词默写 —— 后端服务
 *
 * 职责：
 * 1. 账号注册 / 登录 / 登出 / 会话校验（scrypt 密码哈希，随机 token 会话）
 * 2. 按用户隔离的金币与通关轮数（服务端权威，前端无法越权修改）
 *
 * 开发：Vite dev server 把 /api 代理到本服务（默认 3001 端口）
 * 生产：本服务同时托管 dist/ 静态产物，直接 `node server/index.js` 即可
 */
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const { db } = require('./db');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 单次抽奖合法金币区间（与前端奖池保持一致，服务端做硬校验） */
const MIN_PRIZE = 1;
const MAX_PRIZE = 100;

/* ------------------------------ 管理后台鉴权 ------------------------------ */

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ADMIN_PASSWORD_FILE = path.join(__dirname, 'data', 'admin-password.txt');

/**
 * 管理密码：优先取环境变量 ADMIN_PASSWORD；
 * 未配置时自动生成并持久化到 server/data/admin-password.txt（该目录已被 git 忽略）。
 */
function resolveAdminPassword() {
  const fromEnv = String(process.env.ADMIN_PASSWORD ?? '').trim();
  if (fromEnv) return fromEnv;
  try {
    if (fs.existsSync(ADMIN_PASSWORD_FILE)) {
      const saved = fs.readFileSync(ADMIN_PASSWORD_FILE, 'utf8').trim();
      if (saved) return saved;
    }
    const generated = crypto.randomBytes(9).toString('base64url');
    fs.mkdirSync(path.dirname(ADMIN_PASSWORD_FILE), { recursive: true });
    fs.writeFileSync(ADMIN_PASSWORD_FILE, `${generated}\n`, { mode: 0o600 });
    console.log(`[admin] 已生成管理密码：${generated}`);
    console.log('[admin] 密码已保存到 server/data/admin-password.txt，可通过 /admin 进入后台');
    return generated;
  } catch (err) {
    console.error('[admin] 管理密码初始化失败，管理后台不可用', err);
    return '';
  }
}

const ADMIN_PASSWORD = resolveAdminPassword();
/** 管理端登录会话（进程内，服务重启后需重新登录） */
const adminSessions = new Map();

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** 管理端鉴权：x-admin-token 来自 /api/admin/login，与普通用户会话完全隔离 */
function adminRequired(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ message: '服务端未配置管理密码，管理后台不可用' });
  }
  const header = req.headers['x-admin-token'];
  const token = typeof header === 'string' ? header : null;
  const expiresAt = token ? adminSessions.get(token) : undefined;
  if (!token || !expiresAt || expiresAt < Date.now()) {
    if (token) adminSessions.delete(token);
    return res.status(401).json({ message: '管理登录已失效，请重新登录' });
  }
  next();
}


const app = express();
app.use(cors());
app.use(express.json());

/* ------------------------------ 密码与会话 ------------------------------ */

function hashPassword(password, saltHex) {
  return crypto.scryptSync(password, saltHex, 64).toString('hex');
}

function createSession(userId) {
  const token = crypto.randomBytes(48).toString('hex');
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
  ).run(token, userId, Date.now() + SESSION_TTL_MS);
  return token;
}

/** Bearer token 鉴权中间件 */
function authRequired(req, res, next) {
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7)
    : null;
  if (!token) return res.status(401).json({ message: '未登录' });

  const session = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
    .get(token);
  if (!session || session.expires_at < Date.now()) {
    return res.status(401).json({ message: '登录已过期，请重新登录' });
  }
  const user = db
    .prepare('SELECT id, username, coins, runs FROM users WHERE id = ?')
    .get(session.user_id);
  if (!user) return res.status(401).json({ message: '用户不存在' });

  req.token = token;
  req.user = user;
  next();
}

function publicUser(user) {
  return { id: user.id, username: user.username };
}

/* -------------------------------- 账号接口 -------------------------------- */

app.post('/api/auth/register', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (username.length < 2 || username.length > 20) {
    return res.status(400).json({ message: '用户名需为 2~20 个字符' });
  }
  if (password.length < 6 || password.length > 64) {
    return res.status(400).json({ message: '密码至少 6 位' });
  }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ message: '用户名已被占用' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const info = db
    .prepare(
      `INSERT INTO users (username, salt, password_hash, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(username, salt, hashPassword(password, salt), Date.now());

  const user = { id: info.lastInsertRowid, username };
  const token = createSession(user.id);
  res.json({ token, user, rewards: { coins: 0, runs: 0 } });
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // 用户不存在与密码错误返回相同提示，避免泄露用户名是否注册
  if (!row) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }
  const expected = Buffer.from(row.password_hash, 'hex');
  const actual = Buffer.from(hashPassword(password, row.salt), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  const token = createSession(row.id);
  res.json({
    token,
    user: publicUser(row),
    rewards: { coins: row.coins, runs: row.runs },
  });
});

app.post('/api/auth/logout', authRequired, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({
    user: publicUser(req.user),
    rewards: { coins: req.user.coins, runs: req.user.runs },
  });
});

/* -------------------------------- 奖励接口 -------------------------------- */

app.get('/api/rewards', authRequired, (req, res) => {
  res.json({ coins: req.user.coins, runs: req.user.runs });
});

/**
 * 红包到账：支持单包 `coins`（1~100 整数）或整年级多包 `packets`（每包 1~100 整数）。
 * 多包在同一个事务里原子累加并逐包记流水，避免部分到账。
 */
app.post('/api/rewards/grant', authRequired, (req, res) => {
  const rawPackets = req.body?.packets;
  const packets = Array.isArray(rawPackets)
    ? rawPackets.map(Number)
    : [Number(req.body?.coins)];
  if (packets.length < 1 || packets.length > 3) {
    return res.status(400).json({ message: '一次最多领取 3 个红包' });
  }
  if (!packets.every((n) => Number.isInteger(n) && n >= MIN_PRIZE && n <= MAX_PRIZE)) {
    return res.status(400).json({ message: `金币数额必须是 ${MIN_PRIZE}~${MAX_PRIZE} 的整数` });
  }
  const total = packets.reduce((sum, n) => sum + n, 0);
  const row = db
    .transaction(() => {
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(total, req.user.id);
      const updated = db.prepare('SELECT coins, runs FROM users WHERE id = ?').get(req.user.id);
      const insert = db.prepare(
        `INSERT INTO coin_transactions (user_id, change, balance_after, source, ref, created_at)
         VALUES (?, ?, ?, 'redpacket', 'redpacket', ?)`,
      );
      let balance = updated.coins - total;
      for (const coins of packets) {
        balance += coins;
        insert.run(req.user.id, coins, balance, Date.now());
      }
      return updated;
    })();
  res.json({ ...row, granted: packets });
});

/** 闯完全部小关：通关轮数 +1 */
app.post('/api/runs', authRequired, (req, res) => {
  db.prepare('UPDATE users SET runs = runs + 1 WHERE id = ?').run(req.user.id);
  const row = db.prepare('SELECT runs FROM users WHERE id = ?').get(req.user.id);
  res.json(row);
});

/* -------------------------------- 商店接口 -------------------------------- */

/** 购买失败业务异常：在事务内抛出以回滚扣库存 / 扣款 */
class PurchaseError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

/** 兑换券码：EWD- 前缀 + 8 位无歧义字符（去除 I/O/0/1） */
const VOUCHER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateVoucherCode() {
  for (;;) {
    const bytes = crypto.randomBytes(8);
    let body = '';
    for (const b of bytes) body += VOUCHER_ALPHABET[b % VOUCHER_ALPHABET.length];
    const code = `EWD-${body}`;
    const exists = db.prepare('SELECT 1 FROM vouchers WHERE code = ?').get(code);
    if (!exists) return code;
  }
}

/** 商品目录（含当前用户持有数与累计使用次数），仅返回在售商品 */
app.get('/api/shop/catalog', authRequired, (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.id, i.kind, i.name, i.description, i.price_coins, i.stock, i.sort,
              COALESCE(inv.quantity, 0) AS owned,
              (SELECT COUNT(*) FROM item_usages u
                WHERE u.user_id = ? AND u.item_id = i.id) AS used_count
         FROM shop_items i
         LEFT JOIN inventory inv ON inv.item_id = i.id AND inv.user_id = ?
        WHERE i.active = 1
        ORDER BY i.sort ASC, i.price_coins ASC`,
    )
    .all(req.user.id, req.user.id);
  res.json({ items: rows, coins: req.user.coins });
});

/**
 * 购买商品（单笔事务）：
 * - 道具：不限量，购买后入背包（数量叠加）；
 * - 礼物：校验并原子扣减库存，按件生成兑换凭证；
 * - 金币原子扣减（余额不足整笔回滚，库存也随之回滚）；
 * - 无论收支都写金币流水。
 */
app.post('/api/shop/purchase', authRequired, (req, res) => {
  const itemId = String(req.body?.itemId ?? '').trim();
  const qty = Math.trunc(Number(req.body?.qty ?? 1));
  if (!itemId) return res.status(400).json({ message: '缺少商品信息' });
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
    return res.status(400).json({ message: '购买数量必须是 1~10 的整数' });
  }

  const item = db
    .prepare('SELECT id, kind, name, price_coins, stock, active FROM shop_items WHERE id = ?')
    .get(itemId);
  if (!item || !item.active) return res.status(404).json({ message: '商品不存在或已下架' });
  const cost = item.price_coins * qty;
  if (!Number.isInteger(cost) || cost <= 0) {
    return res.status(400).json({ message: '商品价格异常' });
  }

  try {
    const result = db.transaction(() => {
      // 礼物先锁库存
      if (item.kind === 'gift') {
        const stockRow = db
          .prepare('UPDATE shop_items SET stock = stock - ? WHERE id = ? AND stock >= ?')
          .run(qty, item.id, qty);
        if (stockRow.changes === 0) throw new PurchaseError('该礼物库存不足，已被兑完啦');
      }

      // 金币原子扣款（余额不足则回滚，库存恢复）
      const payRow = db
        .prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?')
        .run(cost, req.user.id, cost);
      if (payRow.changes === 0) throw new PurchaseError('金币不足，再去通关赚一点吧');

      const now = Date.now();
      const { coins } = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id);

      let vouchers = [];
      if (item.kind === 'prop') {
        db.prepare(
          `INSERT INTO inventory (user_id, item_id, quantity, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, item_id) DO UPDATE
             SET quantity = quantity + excluded.quantity,
                 updated_at = excluded.updated_at`,
        ).run(req.user.id, item.id, qty, now);
      } else {
        const insertVoucher = db.prepare(
          `INSERT INTO vouchers (code, user_id, item_id, item_name, status, created_at)
           VALUES (?, ?, ?, ?, 'unused', ?)`,
        );
        for (let k = 0; k < qty; k += 1) {
          const code = generateVoucherCode();
          insertVoucher.run(code, req.user.id, item.id, item.name, now);
          vouchers.push(code);
        }
      }

      db.prepare(
        `INSERT INTO coin_transactions (user_id, change, balance_after, source, ref, created_at)
         VALUES (?, ?, ?, 'shop_purchase', ?, ?)`,
      ).run(req.user.id, -cost, coins, item.id, now);

      return { coins, vouchers };
    })();
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof PurchaseError) {
      return res.status(err.status).json({ message: err.message });
    }
    throw err;
  }
});

/** 我的兑换凭证（按生成时间倒序） */
app.get('/api/shop/vouchers', authRequired, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, code, item_id, item_name, status, created_at, redeemed_at
         FROM vouchers WHERE user_id = ? ORDER BY id DESC`,
    )
    .all(req.user.id);
  res.json({ vouchers: rows });
});

/**
 * 消耗一个道具（当前仅「查看单词」）。
 * 原子扣背包，记使用次数与使用场景（单词 / 来源），余额随响应返回便于前端对账。
 */
app.post('/api/items/consume', authRequired, (req, res) => {
  const itemId = String(req.body?.itemId ?? '').trim();
  const context = String(req.body?.context ?? '').slice(0, 120);
  if (!itemId) return res.status(400).json({ message: '缺少道具信息' });

  const item = db
    .prepare('SELECT id, kind, active FROM shop_items WHERE id = ?')
    .get(itemId);
  if (!item || !item.active || item.kind !== 'prop') {
    return res.status(404).json({ message: '道具不存在或不可用' });
  }

  try {
    const result = db.transaction(() => {
      const row = db
        .prepare(
          `UPDATE inventory SET quantity = quantity - 1, updated_at = ?
            WHERE user_id = ? AND item_id = ? AND quantity >= 1`,
        )
        .run(Date.now(), req.user.id, itemId);
      if (row.changes === 0) throw new PurchaseError('道具数量不足，先去商店兑换吧');
      db.prepare(
        'INSERT INTO item_usages (user_id, item_id, context, created_at) VALUES (?, ?, ?, ?)',
      ).run(req.user.id, itemId, context, Date.now());
      const remaining = db
        .prepare('SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?')
        .get(req.user.id, itemId)?.quantity ?? 0;
      const { coins } = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id);
      return { remaining, coins };
    })();
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof PurchaseError) {
      return res.status(err.status).json({ message: err.message });
    }
    throw err;
  }
});

/* ------------------------------- 管理后台接口 ------------------------------- */

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ message: '服务端未配置管理密码，管理后台不可用' });
  }
  const password = String(req.body?.password ?? '');
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ message: '管理密码错误' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
  res.json({ token, expiresIn: ADMIN_SESSION_TTL_MS });
});

/** 商品字段校验：create 时 current=null；编辑时以库内值为默认，支持只传 active 等局部字段 */
function parseShopItem(body, current = null) {
  const kind = body.kind === undefined ? current?.kind : String(body.kind);
  if (kind !== 'prop' && kind !== 'gift') {
    return { error: '商品类型必须是 prop（道具）或 gift（实物礼物）' };
  }

  const name = String(body.name === undefined ? (current?.name ?? '') : body.name).trim();
  if (name.length < 1 || name.length > 40) {
    return { error: '商品名称需为 1~40 个字符' };
  }

  const description = String(
    body.description === undefined ? (current?.description ?? '') : body.description,
  ).trim();
  if (description.length > 300) {
    return { error: '商品描述最多 300 个字符' };
  }

  const priceCoins = Number(
    body.price_coins === undefined ? current?.price_coins : body.price_coins,
  );
  if (!Number.isInteger(priceCoins) || priceCoins < 1 || priceCoins > 1000000) {
    return { error: '价格需为 1~1000000 的金币整数' };
  }

  let stock = null;
  if (kind === 'gift') {
    const rawStock = body.stock === undefined ? current?.stock : body.stock;
    if (rawStock === null || rawStock === undefined || rawStock === '') {
      return { error: '实物礼物必须填写库存件数' };
    }
    stock = Number(rawStock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) {
      return { error: '库存需为 0~1000000 的整数（0 表示已兑完）' };
    }
  }

  const sort = Number(body.sort === undefined ? (current?.sort ?? 100) : body.sort);
  if (!Number.isInteger(sort) || sort < 0 || sort > 100000) {
    return { error: '排序需为 0~100000 的整数' };
  }

  const active = body.active === undefined ? (current?.active ?? 1) : body.active ? 1 : 0;

  return { value: { kind, name, description, priceCoins, stock, sort, active } };
}

const ADMIN_ITEM_COLUMNS =
  'id, kind, name, description, price_coins, stock, active, sort, created_at';

function getAdminItem(id) {
  return db.prepare(`SELECT ${ADMIN_ITEM_COLUMNS} FROM shop_items WHERE id = ?`).get(id);
}

/** 商品列表：包含已下架商品，供后台管理 */
app.get('/api/admin/shop/items', adminRequired, (_req, res) => {
  const items = db
    .prepare(`SELECT ${ADMIN_ITEM_COLUMNS} FROM shop_items ORDER BY sort ASC, created_at DESC`)
    .all();
  res.json({ items });
});

/** 新增商品：SKU 可自定义（小写字母/数字/-/_），留空自动生成 */
app.post('/api/admin/shop/items', adminRequired, (req, res) => {
  const body = req.body ?? {};
  const parsed = parseShopItem(body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const requestedId = String(body.id ?? '').trim();
  const id = requestedId || `custom_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) {
    return res.status(400).json({ message: 'SKU 只能使用小写字母、数字、- 和 _，长度 2~40' });
  }
  if (getAdminItem(id)) {
    return res.status(409).json({ message: '该 SKU 已存在，请换一个' });
  }

  const v = parsed.value;
  db.prepare(
    `INSERT INTO shop_items (id, kind, name, description, price_coins, stock, active, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, v.kind, v.name, v.description, v.priceCoins, v.stock, v.active, v.sort, Date.now());

  res.status(201).json({ item: getAdminItem(id) });
});

/** 编辑商品 / 上架下架：支持局部字段更新，商品一旦创建不可修改 SKU */
app.patch('/api/admin/shop/items/:id', adminRequired, (req, res) => {
  const current = getAdminItem(req.params.id);
  if (!current) return res.status(404).json({ message: '商品不存在' });

  const parsed = parseShopItem(req.body ?? {}, current);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const v = parsed.value;
  db.prepare(
    `UPDATE shop_items
        SET kind = ?, name = ?, description = ?, price_coins = ?, stock = ?, active = ?, sort = ?
      WHERE id = ?`,
  ).run(v.kind, v.name, v.description, v.priceCoins, v.stock, v.active, v.sort, current.id);

  res.json({ item: getAdminItem(current.id) });
});

/* ------------------------------- 用户管理 ------------------------------- */

const ADMIN_USER_COLUMNS = 'id, username, coins, runs, created_at';
const ADMIN_COIN_CHANGE_MAX = 1000000;

/** LIKE 查询转义，避免用户输入的 % _ 被当成通配符 */
function escapeLike(input) {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 用户列表：按用户名 / ID 模糊搜索，含金币与通关轮数 */
app.get('/api/admin/users', adminRequired, (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const users = q
    ? db
        .prepare(
          `SELECT ${ADMIN_USER_COLUMNS} FROM users
            WHERE username LIKE ? ESCAPE '\\' OR CAST(id AS TEXT) = ?
            ORDER BY id DESC LIMIT ?`,
        )
        .all(`%${escapeLike(q)}%`, q, limit)
    : db.prepare(`SELECT ${ADMIN_USER_COLUMNS} FROM users ORDER BY id DESC LIMIT ?`).all(limit);
  const total = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  res.json({ users, total });
});

/** 调整用户金币：正数增加、负数扣减，扣成负数会被拒绝，落账写流水 */
app.post('/api/admin/users/:id/coins', adminRequired, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(404).json({ message: '用户不存在' });
  }

  const change = Number(req.body?.change);
  if (!Number.isInteger(change) || change === 0) {
    return res.status(400).json({ message: '调整数量必须是非 0 整数（正数增加，负数扣减）' });
  }
  if (Math.abs(change) > ADMIN_COIN_CHANGE_MAX) {
    return res.status(400).json({ message: `单次调整绝对值不能超过 ${ADMIN_COIN_CHANGE_MAX} 金币` });
  }
  const note = String(req.body?.note ?? '').trim().slice(0, 100);

  const result = db.transaction(() => {
    const user = db.prepare(`SELECT ${ADMIN_USER_COLUMNS} FROM users WHERE id = ?`).get(userId);
    if (!user) return { notFound: true };

    const balance = user.coins + change;
    if (balance < 0) {
      return { message: `金币不足：当前 ${user.coins}，无法扣减 ${-change}` };
    }

    db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(balance, userId);
    db.prepare(
      `INSERT INTO coin_transactions (user_id, change, balance_after, source, ref, created_at)
       VALUES (?, ?, ?, 'admin_adjust', ?, ?)`,
    ).run(userId, change, balance, note, Date.now());

    return { user: { ...user, coins: balance } };
  })();

  if (result.notFound) return res.status(404).json({ message: '用户不存在' });
  if (result.message) return res.status(409).json({ message: result.message });
  res.json({ user: result.user });
});

/** 用户最近金币流水，便于后台对账 */
app.get('/api/admin/users/:id/transactions', adminRequired, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(404).json({ message: '用户不存在' });
  }
  const user = db.prepare(`SELECT ${ADMIN_USER_COLUMNS} FROM users WHERE id = ?`).get(userId);
  if (!user) return res.status(404).json({ message: '用户不存在' });

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const transactions = db
    .prepare(
      `SELECT id, change, balance_after, source, ref, created_at
         FROM coin_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(userId, limit);
  res.json({ user, transactions });
});

/* ------------------------------ 生产静态托管 ------------------------------ */

const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError) {
    return res.status(400).json({ message: '请求体不是合法 JSON' });
  }
  console.error(err);
  res.status(500).json({ message: '服务器开小差了' });
});

app.listen(PORT, () => {
  console.log(`[ewd] server listening on http://localhost:${PORT}`);
});
