# 部署指南

Limen 自托管运行：一个 Next.js 进程 + 一个 Postgres。推荐用仓库自带的 Docker Compose，前面接一个终止 HTTPS 的反向代理。

## 用 Docker Compose 部署

### 1. 准备配置

```bash
cp .env.example .env
```

编辑 `.env`：

| 变量                | 必须        | 说明                                                                                  |
| ------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | 是          | 内置 Postgres 的密码，只用字母和数字（会拼进 `DATABASE_URL`）。`openssl rand -hex 24` |
| `AI_API_KEY`        | 是          | OpenAI 兼容服务的 Key                                                                 |
| `AI_BASE_URL`       | 否          | 默认 `https://api.openai.com/v1`                                                      |
| `AI_MODEL`          | 否          | 默认 `gpt-4o-mini`                                                                    |
| `TRUST_PROXY`       | 否          | 前面有会覆盖 `X-Forwarded-For` 的反向代理时设为 `true`，见下文                        |
| `APP_PORT`          | 否          | 宿主机端口，默认 `3000`，只绑定 `127.0.0.1`                                           |
| `DOMAIN`            | 用 Caddy 时 | Caddy 服务的域名                                                                      |

主密码不放在环境变量里，而是以加密钥匙槽的形式存在数据库中，见 [encryption.md](encryption.md)。

### 2. 启动

```bash
mkdir -p backups
docker compose up -d --build
```

容器启动时先自动执行数据库迁移，再启动服务；迁移失败容器会直接退出，而不是带着不匹配的 schema 运行。

### 3. 设置主密码（仅全新数据库）

```bash
docker compose exec app node tools/crypto.mjs init
```

至少 12 位，存进密码管理器。**从旧库迁移来的数据不要执行这一步**（见下文）。

### 4. HTTPS

会话 cookie 带 `Secure` 和 `__Host-` 前缀，浏览器只会在 HTTPS 下保存它，所以必须通过 HTTPS 访问。两种做法：

- **自带 Caddy**：在 `.env` 里设置 `DOMAIN` 和 `TRUST_PROXY=true`，然后
  ```bash
  docker compose --profile proxy up -d
  ```
  Caddy 会自动申请证书，并替换客户端自带的 `X-Forwarded-For`。需要放行 80/443。
- **自己的代理或隧道**（Nginx、Cloudflare Tunnel 等）：反向代理到 `127.0.0.1:APP_PORT`。只有确认代理会**覆盖**而不是追加 `X-Forwarded-For` 时才设 `TRUST_PROXY=true`，否则任何人都能伪造来源 IP 来绕过登录限流；不确定就保持 `false`，此时所有登录失败共用一个限流桶。

### 5. 日常

```bash
docker compose logs -f app          # 日志
docker compose up -d --build        # 更新代码后重建，迁移自动执行
docker compose exec app node tools/crypto.mjs status
```

登录后在 **设置 → API 令牌** 里为每个外部客户端（如 iOS 快捷指令）生成令牌。

## 不用 Docker 运行

需要 Node 24 和 Postgres 16 及以上（推荐与 Compose 一致的 18）（迁移用到 `pg_input_is_valid`）。

```bash
npm ci
export DATABASE_URL=postgresql://limen:密码@127.0.0.1:5432/limen   # 以及 AI_*、TRUST_PROXY
npm run db:migrate
npm run crypto -- init       # 仅全新数据库
npm run build && npm run start
```

用 systemd 或 pm2 守护 `npm run start`。进程里有 AI 任务队列和定时清理，**只能运行一个实例**。

## 数据库迁移

迁移文件在 `drizzle/`。修改 schema 后：

```bash
npm run db:generate   # 生成迁移文件，提交到版本控制
npm run db:migrate    # 本地执行；容器启动时会自动执行
```

## 从 Neon 迁移现有数据

日记在库里是密文，迁移时原样搬运，不需要主密码，**也不要对新库执行 `crypto init`**（有密文却没有钥匙槽时它会拒绝，但原则上不要碰）。

1. 在 Vercel 侧停止写入（暂停项目或停掉 iOS 快捷指令），并记下 Neon 里各表行数。
2. 只启动数据库：`docker compose up -d postgres`。新库保持为空，**不要先跑迁移**。
3. 导出并恢复（Neon 连接串放在 shell 变量里，不要写进文件）：
   ```bash
   export NEON_URL='postgresql://…?sslmode=require'
   docker run --rm postgres:18 pg_dump "$NEON_URL" --format=custom --no-owner --no-privileges \
     --schema=public --schema=drizzle > neon.dump
   docker compose exec -T postgres pg_restore -U limen -d limen --no-owner --no-privileges < neon.dump
   ```
   `drizzle` schema 里是迁移记录，带过去后启动时的迁移就是空操作。恢复时会提示一条 `schema "public" already exists`，这是正常的，其余应无报错。
4. `docker compose up -d --build`，然后核对：
   - 各表行数与 Neon 一致；
   - `docker compose exec app node tools/crypto.mjs status` 能看到密码槽；
   - 用原主密码登录，打开几篇旧日记、搜索一次、导出一份，确认能解密；
   - 用旧的 API 令牌调用一次 API。
5. 域名或隧道切到新机器。Neon 和 Vercel 项目保留一两周作回滚，之后下线，并在 Neon 控制台删除或轮换凭据。
6. 删除本地的 `neon.dump`（里面是密文，但没必要留着）。

## 备份

`backup` 服务默认每 24 小时用 `pg_dump` 写一份到 `./backups/limen-<时间>.dump`，保留最近 14 天（`BACKUP_INTERVAL_HOURS`、`BACKUP_KEEP_DAYS`）。备份里是密文：**主密码丢了，备份也解不开**。建议再把 `./backups` 同步到另一台机器。

恢复到一个空库：

```bash
docker compose exec -T postgres pg_restore -U limen -d limen --clean --if-exists --no-owner < backups/limen-xxxx.dump
```

设置页的导出得到的是解密后的 Markdown 或 JSON，可作为另一份、可读的备份。恢复一次试试，别等需要时才发现不可用。

## 运行时说明

- **AI 后台任务**：由进程内的队列执行，没有时间上限；并发数 `AI_CONCURRENCY`（默认 2），单次请求超时 `AI_TIMEOUT_MS`（默认 120000），失败自动重试 `AI_MAX_RETRIES` 次（默认 3）。任务期间进程在内存里持有发起请求时的数据密钥，见 [encryption.md](encryption.md)。
- **重启**：队列在内存里，重启会丢失排队中的任务。启动时仍是 `pending` 的条目会被标记为 `failed`，在界面里重新整理即可。
- **定时清理**：启动时以及此后每小时清理过期会话、登录记录和超过 30 天的回收站条目。
- **连接池**：`DATABASE_POOL_MAX`（默认 10）、`DATABASE_STATEMENT_TIMEOUT_MS`（默认 30000）。

## 凭证轮换

- **主密码**：在 **设置 → 主密码** 里修改。其他设备会被退出，API 令牌不受影响。详见 [encryption.md](encryption.md#更换主密码)。
- **API 令牌**：在 **设置 → API 令牌** 里生成新令牌、更新客户端，再撤销旧令牌。
- **让所有设备退出**：`docker compose exec app node tools/crypto.mjs revoke-sessions`。

## 部署验证

1. **登录**: 使用主密码登录 Web 界面
2. **创建条目**: 在 Web 界面或通过 API 创建新条目
3. **搜索**: 搜索创建的条目
4. **AI 回写**: 等待 AI 处理完成，确认条目生成标题、摘要和标签
5. **删除条目**: 删除条目确认
6. **退出登录**: 退出后会话应失效
7. **API 令牌**: 用设置页生成的令牌调用 API，撤销后应返回 `401`
8. **重启**: `docker compose restart app` 后仍保持登录，服务正常

```bash
# 创建条目
curl -X POST https://你的域名/api/entries \
  -H "Authorization: Bearer <API 令牌>" \
  -H "Content-Type: application/json" \
  -d '{"content":"测试条目内容","createdAt":"2026-07-24"}'

# 列条目
curl "https://你的域名/api/entries?limit=5" -H "Authorization: Bearer <API 令牌>"
```

## 安全注意事项

- 本应用为**单用户设计**，API 无用户层级权限控制
- 主密码只应存放在密码管理器中；服务器上没有它的副本，一旦遗忘，日记就无法解密
- 主密码也是加密密钥：数据库泄露后，攻击者可以离线暴力猜测它，因此必须足够长、足够随机
- API 令牌能读写全部日记，只放在受信任的客户端中；每个客户端单独一个，不用就撤销
- 登录限流按 IP 的 SHA-256 记录，拿到数据库的人可以反推出最近 7 天尝试登录的 IP
- 应用只绑定 `127.0.0.1`，不要把 Postgres 端口映射到公网
- 部署后应验证安全响应头和 nonce CSP 是否正常工作
