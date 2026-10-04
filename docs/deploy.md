# 部署

Moli Diary 部署在 Moli 服务器上的 Docker 里,经 Traefik 和 Cloudflare Tunnel 对外,地址 <https://diary.xiangyu.pro>。推送到 `main` 后,`CI` 通过,`deploy` 工作流自动构建镜像并部署(Moli 规范 005,和 Cashier 一样)。

进程内有 AI 任务队列和定时清理,**只能运行一个实例**。

## 1. 名字与用途

只写名字,不写值。

**GitHub(组织级密钥,本仓库只读取)**:`DEPLOY_SSH_KEY`、`DEPLOY_TAILSCALE_CLIENT_ID`、`DEPLOY_TAILSCALE_CLIENT_SECRET`、`DEPLOY_SERVER`、`DEPLOY_SERVER_USER`,用途见规范 005 的 5.3.4。

**服务器上 `/data/apps/diary/.env`(权限 600,不进仓库)**,模板是 [deploy/env.example](../deploy/env.example):

| 变量                                                  | 必须 | 说明                                                                                                                             |
| ----------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                                   | 是   | Postgres 的密码,只用字母和数字(会拼进 `DATABASE_URL`)。`openssl rand -hex 24`                                                    |
| `DATABASE_URL`                                        | 是   | `postgresql://diary:<密码>@postgres:5432/moli-diary-db`                                                                          |
| `AI_API_KEY`                                          | 是   | OpenAI 兼容服务的 Key                                                                                                            |
| `AI_BASE_URL` / `AI_MODEL`                            | 否   | 默认 `https://api.openai.com/v1` / `gpt-4o-mini`                                                                                 |
| `TRUST_PROXY`                                         | 否   | 在 Traefik 和 Tunnel 后面设为 `true`。解锁限流取 `X-Forwarded-For` 里**从右往左数的第一个公网地址**;不设则所有失败共用一个限流桶 |
| `AI_CONCURRENCY` / `AI_TIMEOUT_MS` / `AI_MAX_RETRIES` | 否   | AI 并发数(2)、单次请求超时(120000)、失败重试次数(3)                                                                              |
| `DATABASE_POOL_MAX` / `DATABASE_STATEMENT_TIMEOUT_MS` | 否   | 连接池大小(10)、语句超时(30000)                                                                                                  |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP_DAYS`          | 否   | 每日备份的间隔(24)和保留天数(14)                                                                                                 |

主密码不在环境变量里,而是以加密钥匙槽的形式存在数据库中,见 [encryption.md](encryption.md)。

## 2. 首次部署

以下步骤由管理员在服务器上做;应用仓库本身不能替自己登记。

1. 建应用目录,放入 [deploy/](../deploy) 里的文件:

   ```bash
   mkdir -p /data/apps/diary/backups && cd /data/apps/diary
   # 从仓库复制 docker-compose.yml、backup.sh、migrate.cmd、pre-deploy.sh,并 chmod +x pre-deploy.sh
   cp env.example .env && chmod 600 .env   # 把占位值换成真实值
   echo APP_TAG=init > .tag
   ```

2. 先把数据库起来(应用镜像此时还不存在,不要启动 `diary`):

   ```bash
   docker compose --env-file .tag up -d --wait postgres
   ```

3. 如果有旧数据,**现在**按第 8 节恢复进来;全新部署则跳过。
4. 在 `/data/apps/deploy/apps` 里加一行 `diary`,登记这个应用。
5. 公开域名:`diary.xiangyu.pro` 需要在 Tunnel 里加(和 `cashier.xiangyu.pro` 同样的方式)。**新增公开域名需要用户确认**(规范 005 的 5.2.2)。Traefik 的通配证书已覆盖这个域名。
6. 触发部署(见第 3 节)。第一次部署会先执行 `pre-deploy.sh` 备份数据库,再迁移,再启动。
7. 全新数据库设置主密码(至少 12 位,存进密码管理器);**从旧库迁来的不要做这一步**:

   ```bash
   docker compose --env-file .tag exec diary node tools/crypto.mjs init
   ```

8. 管理员在 Authelia 里为这个域名加访问规则（不在本仓库里改），见下面“网关规则”。
9. 登录并解锁后在 **设置 → API 令牌** 里为每个外部客户端(如 iOS 快捷指令)生成令牌。
10. 启动每日备份:`docker compose --env-file .tag up -d backup`(`up -d` 本来也会带上)。并把 `backups/` 同步到服务器之外(规范 005 的 5.7.4)。

## 3. 日常部署

- **触发**:合并或推送到 `main`。`CI` 通过后,`deploy` 自动运行;`CI` 失败就不会部署。
- **确认成功**:GitHub Actions 里 `deploy` 变绿。服务器的部署脚本最后会请求 `/healthz`,核对 `version` 等于刚部署的提交,不一致就回滚并让 `deploy` 失败。
- **看版本**:

  ```bash
  curl -s https://diary.xiangyu.pro/healthz
  ```

  期望 `{"ok":true,"version":"<40 位提交哈希>"}`。

迁移只加不删:新增表和列,要删的东西先停用,下一个版本再迁移删除。这样回滚到上一个版本时,旧代码仍能使用新结构。

**重启会丢排队中的 AI 任务。** 部署时容器收到 SIGTERM,会给进行中的任务最多 20 秒完成;没做完的在下次启动时被标记为 `failed`,在界面里重新整理即可。

## 4. 回滚

部署失败时脚本自动回到上一个版本。要手动回到服务器上已有的旧镜像(保留最近 5 个):

```bash
printf '%s %s rollback\n' diary <40 位提交哈希> | /data/apps/deploy/deploy-app
```

数据库不做反向迁移。迁移前的备份在 `/data/apps/diary/backups/diary-predeploy-*.dump`(最近 5 份),只有迁移本身损坏了数据时才用它恢复:

```bash
cd /data/apps/diary
docker compose --env-file .tag exec -T postgres pg_restore -U diary -d moli-diary-db --clean --if-exists --no-owner < backups/<文件名>.dump
```

### 网关规则(由管理员在 Authelia 配置,规范 008 的 8.6)

应用不自己登录,靠 Traefik 上的 `authelia@file` 中间件。Authelia 的 `access_control` 里需要这两条,**按顺序、先匹配的生效**,其余路径默认拒绝:

```yaml
- domain: diary.xiangyu.pro
  resources: ['^/healthz$', '^/api/entries(/.*)?$']
  policy: bypass # 部署脚本和外部客户端(快捷指令)没有人在场,用 API 令牌认证(规范 008 的 8.8)
- domain: diary.xiangyu.pro
  subject: 'group:admins'
  policy: two_factor # 其余所有路径:仅管理员 + 双因素
```

`/api/dashboard/*` 和 `/api/export` 是浏览器页面用的接口,**不要放行**,它们靠网关身份加解锁 cookie 认证。应用只在 `Remote-Groups` 含 `admins` 时才放行;本地开发(`NODE_ENV` 不是 `production`)没有网关,不检查身份。

## 5. 上线后的验证

1. `https://diary.xiangyu.pro/healthz` 返回 200,`version` 是刚部署的提交。
2. 打开 <https://diary.xiangyu.pro>,先在 Authelia 登录(`admins` 组、双因素),再用主密码解锁。非管理员账号应看到“权限不足”(403)。
3. 新建一篇日记,等 AI 生成标题、摘要和标签。
4. 搜索它;在设置里点“锁定”后解锁会话应失效,再进来要重新输入主密码。
5. 用 API 令牌调用一次(撤销后应返回 `401`):

   ```bash
   curl -X POST https://diary.xiangyu.pro/api/entries \
     -H "Authorization: Bearer <API 令牌>" -H "Content-Type: application/json" \
     -d '{"content":"测试条目内容"}'
   ```

6. `docker restart diary` 后仍保持解锁。

## 6. 常见故障

| 现象                                 | 原因和处置                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `deploy` 报"没有登记"                | 应用还没登记到允许列表(第 2 节第 4 步)。                                                                 |
| `deploy` 报"缺少 docker-compose.yml" | 应用目录没建好(第 2 节第 1 步)。                                                                         |
| 迁移失败,部署回滚                    | 看部署日志里的迁移输出;数据库在失败时保持原样。修好迁移后重新推送。                                      |
| `/healthz` 返回 503                  | 数据库连不上:看 `docker logs diary-postgres`,核对 `.env` 里 `DATABASE_URL` 和 `POSTGRES_PASSWORD` 一致。 |
| 解锁后又回到解锁页                   | 会话 cookie 要求 HTTPS:确认访问的是 `https://`,并且经过 Traefik 的 `websecure`。                         |
| 解锁一直提示尝试过多                 | 没设 `TRUST_PROXY=true`,所有失败共用一个桶;或来源 IP 被判成同一个地址。                                  |
| 条目一直是"处理中"后变成失败         | 看 `docker logs diary` 里的 AI 报错(Key、地址、超时);修好后在界面里重新整理。                            |

## 7. 本地开发

```bash
docker compose -f docker-compose.local.yml up -d   # 一个匹配 .env.example 的 Postgres
cp .env.example .env.local
npm ci && npm run db:migrate
npm run crypto -- init                              # 设置开发用的主密码
npm run dev
```

修改 schema 后:`npm run db:generate` 生成迁移并提交,`npm run db:migrate` 在本地执行。线上的迁移由部署脚本自动执行,不手工做。

## 8. 从 Neon 迁移现有数据

日记在库里是密文,迁移时原样搬运,不需要主密码,**也不要对新库执行 `crypto init`**。Neon 是 PostgreSQL 18,所以本地也用 18(客户端 17 连不上 18,也不该把 18 的备份还原到 17)。

1. 在 Vercel 侧停止写入(暂停项目,并停掉 iOS 快捷指令),记下 Neon 里各表行数。
2. 按第 2 节第 1、2 步,只启动新库,**不要先跑迁移**。
3. 导出并恢复(Neon 连接串放在 shell 变量里,不要写进文件):

   ```bash
   export NEON_URL='postgresql://…?sslmode=require'
   docker run --rm postgres:18 pg_dump "$NEON_URL" --format=custom --no-owner --no-privileges \
     --schema=public --schema=drizzle > neon.dump
   cd /data/apps/diary
   docker compose --env-file .tag exec -T postgres pg_restore -U diary -d moli-diary-db --no-owner --no-privileges < neon.dump
   ```

   `drizzle` schema 里是迁移记录,带过去后部署时的迁移就是空操作。恢复时会提示一条 `schema "public" already exists`,这是正常的,其余应无报错。

4. 完成第 2 节第 4–6 步触发部署,然后核对:
   - 各表行数与 Neon 一致;
   - `docker compose --env-file .tag exec diary node tools/crypto.mjs status` 能看到密码槽;
   - 用原主密码解锁,打开几篇旧日记、搜索一次、导出一份,确认能解密;
   - 用旧的 API 令牌调用一次 API。

5. 把域名切到新服务。Neon 和 Vercel 项目保留一两周作回滚,之后下线,并在 Neon 控制台删除或轮换凭据。
6. 删除 `neon.dump`(里面是密文,但没必要留着)。

## 9. 备份

两类:

- **部署前备份**:`pre-deploy.sh` 在每次迁移前导出一份,保留最近 5 份(`diary-predeploy-*.dump`)。
- **每日备份**:`backup` 服务默认每 24 小时一份,保留 14 天(`diary-daily-*.dump`)。

备份里是密文:**主密码丢了,备份也解不开**。至少再把一份放到服务器之外,并做恢复演练(恢复到临时库,核对行数):

```bash
docker run --rm -d --name diary-restore-test -e POSTGRES_PASSWORD=x postgres:18
# 等它起来后:
docker exec -i diary-restore-test pg_restore -U postgres -d postgres --no-owner < backups/diary-daily-xxxx.dump
```

设置页的导出得到的是解密后的 Markdown 或 JSON,可作为另一份、可读的备份。

## 10. 凭证轮换

- **主密码**:在 **设置 → 主密码** 里修改。其他设备会被退出,API 令牌不受影响。详见 [encryption.md](encryption.md#更换主密码)。
- **API 令牌**:在 **设置 → API 令牌** 里生成新令牌、更新客户端,再撤销旧令牌。
- **让所有设备锁定**:`docker compose --env-file .tag exec diary node tools/crypto.mjs revoke-sessions`。

## 11. 安全注意事项

- 本应用为**单用户设计**,API 无用户层级权限控制。
- 主密码只应存放在密码管理器中;服务器上没有它的副本,一旦遗忘,日记就无法解密。
- 主密码也是加密密钥:数据库泄露后,攻击者可以离线暴力猜测它,因此必须足够长、足够随机。
- API 令牌能读写全部日记,只放在受信任的客户端中;每个客户端单独一个,不用就撤销。
- 解锁限流按 IP 的 SHA-256 记录,拿到数据库的人可以反推出最近 7 天尝试解锁的 IP。
- 容器不发布端口到宿主机,Postgres 只在应用自己的内部网络里。
- Traefik 的 `security-headers` 中间件也会加 HSTS;应用自己的 nonce CSP 和其他安全头不受影响。
