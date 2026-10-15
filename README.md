# 英语单词默写（English Word Dictation）

一款游戏化的英语单词默写练习 Web 应用：在「四线三格」中逐字母拼写单词，支持整词确认判题、发音朗读、错词本、限时挑战、三心闯关，并通过连击播报、幸运红包、金币商店等机制提升练习动力。面向小学到大学（四六级 / 考研 / 雅思 / 托福）全学段词库。

## 功能特性

- **四线三格拼写**：字母逐格填写，整词确认后统一判题（忽略大小写与首尾空格），对错即时闪烁反馈
- **发音朗读**：基于 Web Speech API 的英文朗读（en-US），可反复点击听音
- **两种练习模式**
  - 普通默写：可选打乱顺序、限时模式
  - 闯关模式：一个单元为一关，三颗生命（答错 / 超时扣心），过关弹层结算，全部通关累计通关轮数
- **连击播报**：MOBA 风格的 FIRST BLOOD / DOUBLE KILL … LEGENDARY 连击横幅与专属音效
- **错词本**：答错的单词自动收录（localStorage 持久化），可针对错词重新练习
- **幸运红包**：每轮通关后三选一抽金币（1~100 金币加权概率），服务端校验到账
- **金币商店**
  - 道具：如「查看单词」（冲锋枪扫过四线格逐个打出字母的特效），扣背包库存使用
  - 实物礼物：原子扣库存，购买后生成 `EWD-XXXXXXXX` 兑换券码
- **账号体系**：注册 / 登录 / 登出，scrypt 密码哈希 + 随机 token 会话（30 天有效），金币与通关轮数服务端权威存储，按用户隔离
- **词库自动探测**：按「学段 / 年级（考试）/ 上下册 / 单元」组织 JSON 文件，启动时自动探测可用单元，也支持手动导入本地 JSON

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18、TypeScript 5（strict mode）、Vite 5 |
| 样式 / UI | Tailwind CSS 3、Radix UI 原语（shadcn/ui 风格组件）、lucide-react 图标 |
| 状态管理 | Zustand |
| 后端 | Node.js、Express 5 |
| 数据库 | SQLite（better-sqlite3，WAL 模式，启动自动建表 / 幂等迁移） |
| 其他 | Web Speech API（朗读）、localStorage（token / 错词本） |

## 目录结构

```
ewd/
├── public/                 # 静态资源与词库 JSON
│   ├── grade1.json         # 旧版整年级词库（兼容）
│   ├── grade1a-u1.json     # 一年级上册 1 单元词库
│   ├── sfx/                # 连击 / 一血等音效
│   └── peek-scope.mp4      # 「查看单词」冲锋枪特效
├── server/
│   ├── index.js            # Express 服务：鉴权 / 奖励 / 商店接口 + 生产静态托管
│   ├── db.js               # SQLite 表结构与商品目录种子
│   └── data/ewd.db         # 运行后自动生成（已 gitignore）
├── src/
│   ├── components/         # 页面与组件（Home / Quiz / Result / 商店 / 闯关弹层等）
│   ├── hooks/              # 自定义 hooks（倒计时等）
│   ├── lib/                # api 客户端、词库加载、判题、奖励、音效、朗读、类型
│   ├── store/              # Zustand 全局状态
│   ├── App.tsx
│   └── main.tsx
├── vite.config.ts          # 开发期 /api 代理到 http://localhost:3001
└── package.json
```

## 快速开始

### 环境要求

- Node.js 20 LTS 及以上（better-sqlite3 为原生模块，安装时需要匹配的 Node 版本）
- npm

### 安装依赖

前后端依赖统一在根目录安装：

```bash
npm install
```

### 开发模式

需要同时启动**后端服务**和 **Vite 开发服务器**（两个终端）：

```bash
# 终端 1：后端接口服务，默认 http://localhost:3001
npm run server

# 终端 2：前端开发服务器，默认 http://localhost:5173
npm run dev
```

打开 Vite 输出的地址（默认 http://localhost:5173）即可使用。开发环境下 `/api` 请求会自动代理到 `http://localhost:3001`（见 [vite.config.ts](vite.config.ts)）。

### 生产构建与部署

```bash
# 类型检查 + 构建，产物输出到 dist/
npm run build

# 启动单一服务：同时提供 API 与 dist/ 静态资源托管
npm start
```

生产模式直接访问 http://localhost:3001 即可，无需额外的静态服务器。可用 `PORT` 环境变量修改端口：

```bash
PORT=8080 npm start
```

> 首次启动服务时会自动创建 `server/data/ewd.db` 并幂等播种内置商品目录，无需手动初始化数据库。

## npm scripts

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器（5173） |
| `npm run server` | 启动 Express 后端服务（3001） |
| `npm start` | 同 `npm run server`（生产环境托管 dist/） |
| `npm run build` | TypeScript 类型检查 + 生产构建到 `dist/` |
| `npm run preview` | 本地预览构建产物 |

## 词库说明

词库为放置在 [public/](public/) 下的 JSON 文件，格式为单词数组：

```json
[
  { "name": "sport", "trans": ["体育运动"] },
  { "name": "player", "trans": ["运动员", "选手", "球员"] }
]
```

文件命名约定（应用启动时自动探测，无需注册）：

| 学段 | 单元文件示例 | 整年级 / 整册兜底 |
| --- | --- | --- |
| 小学 | `grade1a-u1.json`（一年级上册 1 单元）、`grade1b-u3.json`（下册） | `grade1.json` |
| 初中 | `junior1a-u1.json`（初一上册 1 单元） | `junior1.json` |
| 高中 | `senior2a-u1.json`（高二上册 1 单元） | `senior2.json` |
| 大学考试 | `cet4-u1.json`（四级 1 单元，不分上下册） | `cet4.json` / `cet6.json` / `kaoyan.json` / `ielts.json` / `toefl.json` |

- `a` = 上册，`b` = 下册；大学考试不分册，文件名不带 `a/b`
- 每个年级最多探测 12 个单元；缺失文件自动跳过
- 跨单元的同名单词（忽略大小写 / 首尾空格）只保留第一次出现
- 也可以在页面中手动导入本地 JSON 文件进行练习

## 后端接口概览

所有接口以 `/api` 开头，除注册 / 登录外均需 `Authorization: Bearer <token>` 头：

- `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
- `GET /api/rewards` · `POST /api/rewards/grant`（红包金币，1~100 整数硬校验）· `POST /api/runs`（通关轮数 +1）
- `GET /api/shop/catalog` · `POST /api/shop/purchase`（事务保证扣款 / 扣库存原子性）· `GET /api/shop/vouchers`
- `POST /api/items/consume`（消耗道具，记录使用场景）

数据库表：`users`、`sessions`、`shop_items`、`inventory`、`item_usages`、`vouchers`、`coin_transactions`（金币收支流水，含余额快照可对账），建表语句见 [server/db.js](server/db.js)。
