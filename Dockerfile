# ============================================================
# 英语单词默写 —— 单容器多阶段构建
# Express 后端 + Vite 前端，一个 image 同时服务
# 数据持久化通过 host volume 挂载 /app/server/data
# ============================================================

# -------- 阶段 1：编译 + 构建 --------
# 根目录 package.json 同时装前端依赖和 better-sqlite3（需源码编译）
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:22-bookworm-slim-linuxarm64 AS builder

LABEL maintainer="ewd" description="English Word Dictation — build stage"

# better-sqlite3 v13 没有 Node 22.23.1 + linux/arm64 预编译包，
# builder 阶段装编译工具来源码编译（runner 阶段不需要这些）
# 同时把 apt 源切到阿里云（国内加速）
RUN sed -i 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g; s|http://deb.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
      /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依赖安装层缓存（先拷锁文件，后拷源码）
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com \
 && npm install --no-audit --no-fund \
 && rm -rf ~/.npm

# 前端源码 + 配置文件
COPY src ./src
COPY public ./public
COPY server ./server
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY tailwind.config.js ./
COPY postcss.config.js ./

# 构建前端（tsc 类型检查 + vite 产物 → dist/）
RUN npm run build \
 && npm prune --omit=dev   # 删掉 devDependencies，只留运行时依赖（含已编译的 better-sqlite3）


# -------- 阶段 2：运行 --------
# 纯运行时，不装任何编译工具
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:22-bookworm-slim-linuxarm64 AS runner

LABEL maintainer="ewd" \
      description="English Word Dictation — Express + Vite, single container"

# 运行时只需要 ca-certificates（https）和 curl（健康检查）
# 同样切阿里云源加速
RUN sed -i 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g; s|http://deb.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
      /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
 && rm -rf /var/lib/apt/lists/*

# 非 root 用户运行（安全底线）
RUN groupadd -r app && useradd -r -g app -d /app -s /usr/sbin/nologin app

WORKDIR /app

# 从 builder 直接拿编译好的 node_modules（含 better-sqlite3 的 .node 二进制）
COPY --from=builder /app/node_modules ./node_modules

# 后端源码（Express 静态托管 + /api）+ 数据库目录
COPY --from=builder /app/server ./server
RUN mkdir -p /app/server/data \
 && chown -R app:app /app/server

# 前端构建产物（dist/）+ 词库 JSON（public/）+ 根 package.json（scripts）
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./

# 运行用户 & 环境
USER app
ENV NODE_ENV=production \
    PORT=3001 \
    ADMIN_PASSWORD=
EXPOSE 3001

# 健康检查：返回 401 也 OK（没登录），超时/5xx 才算挂
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/auth/me \
      || exit 1

# 数据库 + admin 密码持久化
VOLUME ["/app/server/data"]

CMD ["node", "server/index.js"]
