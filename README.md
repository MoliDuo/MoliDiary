# Moli Diary 日记

加密保存的个人日记：正文只以密文入库，AI 自动生成标题、摘要和标签。

[![ci](https://github.com/MoliDuo/MoliDiary/actions/workflows/ci.yml/badge.svg)](https://github.com/MoliDuo/MoliDiary/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-all%20rights%20reserved-lightgrey)

## 功能

- **可编辑的元数据**: AI 生成标题、摘要和标签；标题可就地改写，标签可增删。手动改过的字段带锁，AI 重新整理时不会覆盖，也可一键交还给 AI。
- **内容加密**: 正文、标题、摘要和标签名在数据库中只存 AES-256-GCM 密文，数据密钥由主密码经 scrypt 派生的密钥包裹。服务器不保存主密码和任何能解密的秘密，拿到数据库、备份或服务器环境变量的人都看不到日记；有主密码和数据库就能解密，不依赖额外的 pepper 或密钥文件。
- **标签**: 标签存在独立表中，可点击筛选时间线，导出按标签过滤同样走 SQL 索引（按标签名的 HMAC 匹配）。
- **回收站**: 删除是软删除，toast 里可直接撤销；设置页的回收站可恢复或彻底删除，30 天后自动清理。
- **写作统计**: 设置页显示总篇数、连续天数、今年篇数和总字数。
- **Markdown**: 支持 GFM（表格、任务列表、删除线）；单次换行保留为换行。编辑器可切换预览，与详情页使用同一渲染器。
- **可安装**: 提供图标与 manifest，可添加到手机主屏幕独立打开。
- **异步 AI 处理**: 元数据由进程内的常驻队列生成，带超时与自动重试；长文按约 30,000 字符分段并在最后汇总。页面仅在存在待处理条目、可见且联网时自适应检查状态（前 15 秒每 3 秒、随后至 60 秒每 10 秒、之后每 30 秒持续检查）。
- **可靠输入**: Web 新建和编辑会自动保存浏览器本地草稿，正式写入失败时正文不会被清除；`Cmd/Ctrl + Enter` 保存。编辑条目时原有的 AI 标题和摘要会保留到新结果生成成功为止。
- **私有访问**: 只有 `admins` 组的管理员能通过 Authelia 进入，进入后还要输入主密码解锁（可在设置里修改）；外部客户端使用设置页生成、可单独撤销的 API 令牌。保留 IP 解锁限流和 nonce CSP。解锁 7 天有效并在活跃时自动续期，不会每周被踢出。
- **即时反馈**: 保存、搜索、删除、重新整理和导航都提供 pending、toast、乐观状态或 skeleton。
- **时间线**: 服务端首屏加 cursor 无限滚动，只向浏览器发送列表所需字段；按月分组并始终标注年份，返回时恢复已加载的页数与滚动位置。
- **搜索**: 支持按正文、标题和摘要搜索，输入后自动触发，高亮命中并显示正文中的命中片段。由于数据库只存密文，匹配在服务端解密后进行。
- **响应式设计**: 适配桌面和移动端。

## 访问方式

部署在 Moli 服务器上，地址 <https://diary.xiangyu.pro>；手机上可以添加到主屏幕独立打开。外部客户端（如 iOS 快捷指令）用 [API](docs/api.md) 写入。

## 登录方式

只用 Authelia 登录（规范 008 的 P2：网关前置校验），应用里没有账号、密码登录页，只允许 `admins` 组，其他人看到“权限不足”（403）。

登录之后还有一步**解锁**：输入主密码打开数据密钥。主密码是内容的加密密钥，服务器不保存它，所以它不能被 Authelia 取代，但它也不再是登录凭据。外部客户端用设置页生成、可单独撤销的 API 令牌，不经过网关（见 [部署](docs/deploy.md) 里的网关规则）。

## 部署

Docker 加 Traefik，推送到 `main` 后 CI 通过自动部署，回滚、迁移数据、备份见 [docs/deploy.md](docs/deploy.md)。架构和关键决定见 [docs/architecture.md](docs/architecture.md)。

## 开发

### 前置要求

- Node.js 24.x
- npm 11
- Postgres 16 及以上（或直接使用 Docker Compose，见下）

线上部署(Traefik 后的 Docker、回滚、数据迁移、备份)见 [docs/deploy.md](docs/deploy.md)。以下是本地开发流程。

### 1. 安装依赖

```bash
nvm use
npm install
```

### 2. 配置环境变量

先启动一个本地 Postgres(`docker compose -f docker-compose.local.yml up -d`),再复制 `.env.example` 并填写相关信息：

```bash
cp .env.example .env.local
```

开发时在 `.env.local` 里设置指向本地 Postgres 的 `DATABASE_URL`；全部变量说明见 [docs/deploy.md](docs/deploy.md#1-名字与用途)。

### 3. 初始化数据库

```bash
npm run db:migrate
```

修改 schema 后，先运行 `npm run db:generate` 并提交生成的迁移，再运行 `npm run db:migrate`。

### 4. 启动开发服务器

```bash
npm run dev
```

### 5. 运行自动化检查

```bash
npm run check
```

该命令顺序执行格式检查、lint、类型检查、迁移一致性检查、死代码检查（knip）和带覆盖率下限的测试，CI 跑的是同一个入口。覆盖率只升不降：提高了就把 `package.json` 里 `test:coverage` 的下限一起调高。测试覆盖网关身份、主密码解锁、解锁限流、会话、草稿、cursor 分页、条目操作、AI 分段处理、安全响应头和交互 pending 状态。

## npm scripts

| 命令                      | 说明                                                     |
| ------------------------- | -------------------------------------------------------- |
| `npm run dev`             | 启动 Next.js 开发服务器                                  |
| `npm run build`           | 生产构建                                                 |
| `npm run start`           | 启动生产服务器                                           |
| `npm run test`            | 运行测试                                                 |
| `npm run test:coverage`   | 运行测试并检查覆盖率下限                                 |
| `npm run lint`            | ESLint 检查                                              |
| `npm run lint:fix`        | 自动修复 ESLint 问题                                     |
| `npm run typecheck`       | TypeScript 类型检查                                      |
| `npm run format`          | Prettier 格式化                                          |
| `npm run format:check`    | Prettier 格式检查                                        |
| `npm run check:dead-code` | 查找没有用到的导出、文件和依赖（knip）                   |
| `npm run db:check`        | 检查迁移文件与结构定义一致（drizzle-kit check）          |
| `npm run check`           | 统一检查入口：上面几项加格式、lint、类型，依次执行       |
| `npm run db:generate`     | Drizzle 生成迁移文件                                     |
| `npm run db:migrate`      | 执行迁移                                                 |
| `npm run build:tools`     | 把 migrate/crypto 脚本打包为独立 `.mjs`（Docker 镜像用） |
| `npm run crypto`          | 内容加密维护：初始化主密码、查看状态、更换密码           |

## 技术栈

- **框架**: Next.js 16 (App Router) + React 19
- **数据库**: Postgres + Drizzle ORM（node-postgres 连接池）
- **样式**: Tailwind CSS + Shadcn/ui
- **AI**: OpenAI 兼容 API（进程内队列异步处理）
- **认证**: Authelia 网关（仅 `admins`）+ 主密码解锁（Web Session）+ 可撤销的 Bearer API 令牌

## 详细文档

- [架构](docs/architecture.md) — 模块、数据流、关键决定
- [API 参考](docs/api.md) — REST API 端点、认证、分页、请求/响应示例
- [部署](docs/deploy.md) — Docker 部署、回滚、迁移数据、备份、凭证轮换
- [内容加密](docs/encryption.md) — 威胁模型、密钥结构、存储格式、离线解密、更换主密码

## 许可

保留所有权利（All rights reserved），见 [LICENSE](LICENSE)。
