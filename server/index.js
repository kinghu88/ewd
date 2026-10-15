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

/** 抽奖到账：金币数必须是 1~100 的整数，原子自增并记流水 */
app.post('/api/rewards/grant', authRequired, (req, res) => {
  const coins = Number(req.body?.coins);
  if (!Number.isInteger(coins) || coins < MIN_PRIZE || coins > MAX_PRIZE) {
    return res.status(400).json({ message: `金币数额必须是 ${MIN_PRIZE}~${MAX_PRIZE} 的整数` });
  }
  const row = db
    .transaction(() => {
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(coins, req.user.id);
      const updated = db.prepare('SELECT coins, runs FROM users WHERE id = ?').get(req.user.id);
      db.prepare(
        `INSERT INTO coin_transactions (user_id, change, balance_after, source, ref, created_at)
         VALUES (?, ?, ?, 'redpacket', 'redpacket', ?)`,
      ).run(req.user.id, coins, updated.coins, Date.now());
      return updated;
    })();
  res.json(row);
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
