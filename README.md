# Meeting AI Kit / 智能妙记

AI 会议纪要视觉报告生成器。当前版本面向业务人员使用，主链路是：

```text
邮箱注册/登录
  -> 新建会议
  -> 录音转写 或 粘贴/上传材料
  -> 结束会议后生成 AI 纪要
  -> 自动生成会议总结长图
  -> Review 页编辑 Markdown 正文
  -> 下载 Word/PNG 或发布到语雀
```

## 当前产品形态

- 多用户 Web 应用，账号通过邮箱验证码注册、登录和找回密码。
- 数据按用户隔离，用户只能看到自己的会议、转写、纪要和个人配置。
- 新建会议只需要填写会议名称、参会人员，并选择输入方式。
- 输入方式支持两类：
  - 录音转写：浏览器麦克风采集音频，转发豆包/火山 ASR，实时显示转写文本。
  - 粘贴/上传：支持粘贴文本，上传 `md`、`doc`、`docx`、`pdf` 文件，确认提取内容后生成纪要。
- 会议结束后才允许生成纪要，避免录音未收尾时提前生成。
- Review 页默认展示可读的 Markdown 纪要和总结长图；结构化 JSON 只在后台使用。
- 编辑纪要后需要保存并刷新，系统会同步结构化数据并重新生成长图。
- 发布目标为语雀。飞书 CLI 相关代码仍作为历史适配器保留，但不再是当前主流程。

## 技术栈

```text
apps/web                 Next.js + React + Tailwind CSS
apps/api                 Fastify + Prisma + Playwright + Nodemailer
packages/shared          共享类型和 Zod Schema
packages/asr-adapter     豆包/火山 ASR WebSocket 适配边界
packages/llm-adapter     OpenAI-compatible 模型网关适配
packages/visual-renderer React 长图模板
packages/feishu-cli-adapter 历史飞书 CLI 白名单适配器
prisma/schema.prisma     PostgreSQL 数据模型
storage/                 本地录音、长图、导出文件
```

## 本地开发要求

- Node.js 22+
- pnpm 10+，通过 Corepack 启用
- Docker，用于本地启动 PostgreSQL
- Playwright Chromium，用于长图截图

```bash
corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm install
pnpm exec playwright install chromium
```

## 本地启动

当前仓库提供 `docker run` 兜底脚本管理 PostgreSQL：

```bash
pnpm db:start
pnpm db:push
pnpm dev:api
pnpm dev:web
```

默认地址：

- Web: http://localhost:3000
- API: http://localhost:4000
- Health: http://localhost:4000/health

停止本地数据库：

```bash
pnpm db:stop
```

## 配置说明

配置入口在 `/settings`。配置按当前登录用户保存。

- 账号：展示当前邮箱账号和登录状态。
- 模型网关：维护可用模型配置列表，只能开启一个默认模型。会议默认使用默认模型，Review 页可切换已保存模型重新生成。
- 豆包/火山 ASR：配置 App ID、Access Token、Secret Key、Resource ID、替换词 ID。默认协议为 16k PCM、200ms 分包、WebSocket 流式识别。
- 语雀：配置 Token，测试通过后读取可用知识库列表，发布时选择目标知识库。
- 个人热词：不限数量，主要用于纪要生成 Prompt，帮助模型识别人名、系统名和专业术语。ASR 的替换词 ID 仍通过 ASR 配置单独传给豆包/火山。

模型网关当前按 OpenAI Chat Completions 形态接入，生产推荐至少设置：

```env
LLM_PROVIDER="model_gateway"
LLM_BASE_URL="<your-openai-compatible-chat-completions-url>"
LLM_MODEL="deepseek-v4-pro"
LLM_MAX_TOKENS=12000
LLM_TIMEOUT_MS=240000
LLM_RETRY_COUNT=1
```

## 主要页面

- `/` 登录后进入会议列表，未登录跳转登录页。
- `/login` 邮箱登录、注册、忘记密码。
- `/dashboard` 会议列表和归档入口。
- `/meetings/new` 新建会议，选择录音或上传/粘贴材料。
- `/meetings/[id]/live` 录音转写、暂停、结束会议、查看实时转写。
- `/meetings/[id]/review` 纪要查看、编辑、下载、发布语雀。
- `/render/meetings/[id]/visual` 长图 HTML 渲染页，供 Playwright 截图。
- `/settings` 个人配置中心。

## 关键接口

- `GET /health`
- `POST /api/auth/email/send-code`
- `POST /api/auth/email/register`
- `POST /api/auth/email/login`
- `POST /api/auth/email/reset-password`
- `GET/POST/PATCH /api/meetings`
- `POST /api/meetings/:id/start`
- `POST /api/meetings/:id/stop`
- `WS /api/meetings/:id/asr`
- `GET/POST/PATCH /api/meetings/:id/transcript-segments`
- `POST /api/meetings/:id/recordings`
- `POST /api/meetings/:id/recordings/merge`
- `POST /api/meetings/:id/generate-minutes`
- `PATCH /api/meetings/:id/minutes`
- `POST /api/meetings/:id/minutes/sync-structured-json`
- `POST /api/meetings/:id/render-visual`
- `POST /api/meetings/:id/publish-yuque`
- `GET/PATCH /api/config/models`
- `GET/PATCH /api/config/asr`
- `GET/PATCH /api/config/yuque`
- `GET/PATCH /api/config/hotwords`

## 录音文件规则

- 录音过程中会把浏览器录音按片段上传到 `storage/recordings/<meetingId>/`。
- 结束或停止录音后，后端会尽量把片段合并为 `完整录音.webm`。
- Review 页优先播放完整录音；没有完整录音时播放最近的录音片段。
- 生产环境如果需要把录音推送到语雀并长期可访问，建议接入 NAS/OSS 或对象存储公开地址。本地 `/storage` 链接只适合单机内网或演示环境。

## 长图与 Word

- 纪要生成成功后会自动触发总结长图生成。
- 长图宽度固定 1080px，Review 页按固定高度预览，点击可放大滚动查看。
- 空白模块不会输出到长图和正文。
- Word 导出使用会议报告模板，包含会议基本信息、总结长图和 Markdown 正文。

## 验证命令

```bash
pnpm typecheck
pnpm prisma:validate
pnpm test:smoke
```

`pnpm test:smoke` 需要 API 和数据库已启动，会创建测试会议、写入粘贴转写并生成一份纪要。

## 生产注意事项

- 生产必须配置 `AUTH_SESSION_SECRET`、`EMAIL_CODE_SECRET`，并关闭 `EMAIL_CODE_DEV_RETURN`。
- 生产建议使用 HTTPS，并设置 `AUTH_COOKIE_SECURE=true`。
- Playwright 需要安装 Chromium 和中文字体，否则长图可能生成失败或中文显示异常。
- 语雀发布如果勾选录音，长录音可能很大。当前实现会优先使用完整录音或录音链接，正式部署应使用对象存储承载大文件。
- PostgreSQL 只存业务数据，不建议存录音、PNG、Word 等二进制文件。
