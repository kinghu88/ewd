/**
 * SQLite 数据访问层（better-sqlite3，同步 API）。
 *
 * 表结构：
 * - users             账号（scrypt 密码哈希 + 每人独立的金币 / 通关轮数）
 * - sessions          登录会话（随机 token，30 天有效）
 * - shop_items        商品目录（道具 / 实物礼物，stock=NULL 表示不限量）
 * - inventory         用户道具背包（道具可叠加数量；礼物购买即生成凭证，不入背包）
 * - item_usages       道具使用记录（什么时间、在哪个单词上消耗）
 * - vouchers          实物礼物兑换凭证（一商品一码，状态机 unused/redeemed/void）
 * - coin_transactions 金币收支流水（红包收入 / 商店支出，余额快照可对账）
 *
 * 建表语句全部幂等，服务每次启动自动迁移，旧库可直接升级。
 */
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'ewd.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE,
    salt       TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    coins      INTEGER NOT NULL DEFAULT 0,
    runs       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS shop_items (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,              -- 'prop' 道具 | 'gift' 实物礼物
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_coins INTEGER NOT NULL,           -- 礼物价即人民币价值（金币与人民币 1:1）
    stock       INTEGER,                    -- NULL = 不限量（道具类）
    active      INTEGER NOT NULL DEFAULT 1,
    sort        INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory (
    user_id    INTEGER NOT NULL,
    item_id    TEXT NOT NULL,
    quantity   INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS item_usages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    item_id    TEXT NOT NULL,
    context    TEXT NOT NULL DEFAULT '',    -- 使用场景（如单词名 / 来源）
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_item_usages_user ON item_usages(user_id, item_id);

  CREATE TABLE IF NOT EXISTS vouchers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    user_id     INTEGER NOT NULL,
    item_id     TEXT NOT NULL,
    item_name   TEXT NOT NULL,              -- 商品名快照，后续改名不影响历史凭证
    status      TEXT NOT NULL DEFAULT 'unused', -- unused / redeemed / void
    created_at  INTEGER NOT NULL,
    redeemed_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_vouchers_user ON vouchers(user_id);

  CREATE TABLE IF NOT EXISTS coin_transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    change        INTEGER NOT NULL,         -- 正=收入，负=支出
    balance_after INTEGER NOT NULL,         -- 本笔落账后余额，便于对账
    source        TEXT NOT NULL,            -- redpacket / shop_purchase
    ref           TEXT NOT NULL DEFAULT '', -- 关联对象（如商品 sku）
    created_at    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_coin_txn_user ON coin_transactions(user_id);
`);

/* ------------------------------ 商品目录种子 ------------------------------ */

/**
 * 内置商品。INSERT OR IGNORE 幂等播种：
 * 已存在的 sku 保留运行期库存（被购买扣减后重启不会回补）。
 */
const CATALOG_SEED = [
  {
    id: 'peek_word',
    kind: 'prop',
    name: '查看单词',
    description:
      '默写卡壳时用它看一眼答案：冲锋枪扫过四线格，字母被逐个打出来，看完凭记忆写下来。每次使用消耗 1 个。',
    price_coins: 3,
    stock: null,
    sort: 10,
  },
  {
    id: 'gift_pencil_set',
    kind: 'gift',
    name: '卡通文具套装',
    description: '铅笔×6、橡皮、尺子、笔袋一套，学习好搭档。等值人民币 38 元。',
    price_coins: 38,
    stock: 30,
    sort: 20,
  },
  {
    id: 'gift_thermos_cup',
    kind: 'gift',
    name: '卡通保温杯',
    description: '350ml 便携保温杯，内胆 316 不锈钢。等值人民币 45 元。',
    price_coins: 45,
    stock: 20,
    sort: 21,
  },
  {
    id: 'gift_earbuds',
    kind: 'gift',
    name: '无线蓝牙耳机',
    description: '半入耳式蓝牙耳机，听英语发音更清晰。等值人民币 99 元。',
    price_coins: 99,
    stock: 8,
    sort: 22,
  },
  {
    id: 'gift_rc_car',
    kind: 'gift',
    name: '遥控赛车',
    description: '1:24 电动遥控赛车，多向操控、充电锂电池。等值人民币 128 元。',
    price_coins: 128,
    stock: 5,
    sort: 23,
  },
  {
    id: 'gift_building_blocks',
    kind: 'gift',
    name: '拼装积木礼盒',
    description: '500+ 颗粒城市系列积木，动手又动脑。等值人民币 168 元。',
    price_coins: 168,
    stock: 3,
    sort: 24,
  },
];

const seedItem = db.prepare(
  `INSERT OR IGNORE INTO shop_items (id, kind, name, description, price_coins, stock, active, sort, created_at)
   VALUES (@id, @kind, @name, @description, @price_coins, @stock, 1, @sort, @created_at)`,
);

const seedCatalog = db.transaction((items) => {
  const now = Date.now();
  for (const item of items) seedItem.run({ ...item, created_at: now });
  // 「查看单词」调价 15 → 3：INSERT OR IGNORE 对已存在行不生效，
  // 故对已播种的老库显式同步单价（只改价格，绝不动库存）。
  db.prepare('UPDATE shop_items SET price_coins = 3 WHERE id = ? AND price_coins <> 3').run('peek_word');
});
seedCatalog(CATALOG_SEED);

module.exports = { db };
