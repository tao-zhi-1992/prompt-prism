# 开发指南（Development）

[← README](../README.zh-CN.md) · [使用指南](guide.zh-CN.md) · [Agent Insights](insights.zh-CN.md)

## 本地环境

使用 pnpm 10.28.0 或更高版本：

```bash
pnpm install
pnpm --filter prompt-prism link --global
pnpm start
pnpm test
```

常用命令：

```bash
pnpm dashboard:dev # Vite 仪表盘开发服务器
pnpm build         # 类型检查并构建所有生产产物
pnpm test          # 运行全部 unit 和 integration 测试
pnpm test:unit     # 运行单元/组件测试
pnpm test:integration # 运行代理、CLI、协议和 example 集成测试
pnpm test:coverage # 运行包级门禁、Core 代理覆盖率和变更行 coverage 门禁
pnpm typecheck:e2e # 类型检查 Playwright 测试
pnpm test:e2e      # 构建 Prism 并运行 Chromium 仪表盘测试
```

测试套件分为三层：Node unit/integration 测试适配器、存储、代理转发、CLI 行为、协议兼容性和 example Agent；Vitest/jsdom 测试仪表盘、插件和共享 UI 组件；Playwright 测试针对真实本地 Prompt Prism 服务运行编译后的仪表盘。Coverage 会让 Core 覆盖率同时运行代理集成测试，并要求语句、函数和行达到 90%、分支达到 75%；随后执行包级回归底线，以及包括核心代理和存储代码在内的变更可执行代码行至少 90% 的门禁。仅包含类型的 contracts 文件不计入可执行覆盖率。

CI 会在 Node.js 20、22 和 24 上运行 unit/integration 测试；coverage 和 Chromium E2E 只在 Node.js 24 上运行一次，并将报告上传为 workflow artifact。

## 仓库结构

- `packages/contracts/` 包含与提供商无关的服务端、Capture 和 Trace 契约。
- `packages/core/` 包含代理、Capture 存储、Log Feed、适配器和 Trace service。
- `packages/builtins/` 负责组装默认服务端插件和 Dashboard tabs。
- `packages/dashboard-kit/` 包含 Dashboard 契约、i18n、registry 工具和展示层 Trace 工具。
- `packages/dashboard/` 包含 React/Vite 仪表盘外壳。
- `packages/plugins/` 包含详情 tab 及其 server/dashboard 实现。
- `packages/ui/` 包含共享 UI 原语。
- `packages/prompt-prism/` 包含公开 CLI/API 和发布打包逻辑。
- `example/` 包含 Pi 驱动的 Coding Agent 演示。

`pnpm build:all` 会把默认服务端运行时构建到 `packages/prompt-prism/dist/`，把生产仪表盘 bundle 生成到 `packages/prompt-prism/public/dashboard/`，并从 `/_pp/` 提供。

## Agent 演示

演示为每个浏览器会话提供一个小型 TypeScript REST 服务的隔离副本。一个任务产生模型 → 工具 → 模型流量，让轨迹、缓存前缀和 Input Diff 在 Prism 中清晰可见。

```text
browser chat → Demo Agent (:3000) → Prompt Prism (:1028) → model provider
```

不配置固定 upstream 启动 Prompt Prism，为演示 Agent 使用的提供商生成代理地址，并把它填入演示 Agent 的模型 API 配置：

```bash
# 终端 1
p2 start
p2 url https://api.anthropic.com

# 终端 2
cp example/.env.example example/.env
# 本次运行直接使用 `p2 url` 输出的地址。
DEMO_BASE_URL="$(p2 url https://api.anthropic.com)" pnpm demo
```

打开 [http://127.0.0.1:3000/](http://127.0.0.1:3000/)，让 Agent 调查失败的分页测试，并批准每次工具调用。

必需变量：

- `DEMO_MODEL_PROVIDER_TOKEN`：演示后端通过 Prism 发送的提供商凭证。
- `DEMO_AGENT_MODEL`：演示 Agent 选择的模型。

可选变量：

- `DEMO_BASE_URL`：默认是本地 Prism 地址 `http://127.0.0.1:1028`；Prism 未配置固定 upstream 时，请改为 `p2 url` 生成的代理地址。不要自行追加 API endpoint。
- `DEMO_API_FORMAT`：默认为 `auto`；可用 `anthropic-messages` 或 `openai-chat-completions` 显式选择演示 Agent 协议。
- `DEMO_PORT`：默认为 `3000`。

## 协议 Fixture

Adapter 兼容性 fixture 位于 `packages/core/test/fixtures/protocols`。它们是公开 API 形态的精简、离线副本；`sources.json` 记录来源 URL 和 revision，不会 vendor 完整的 provider 规范。支持的协议变更时，手动更新 fixture 后运行 adapter 与集成测试。

用 `pnpm check:openai-openapi -- <commit>` 可把当前 fixture 对照官方 OpenAI OpenAPI commit。该命令仅用于人工维护，会访问网络，CI 不会运行它。Realtime、Batch、Assistants 和 managed-agent 专用协议仍作为 Raw capture 保存。

会话保存在内存中。生成的工作区保留在 `example/.workspaces/` 下，可通过**重置工作区**重建。

演示只有在浏览器批准后才授予完整 Bash 访问权限。它的工作区是便利边界，不是系统沙箱；只批准你信任的命令。

## Trace 关系与 Input Diff

Core 的 Trace service 负责 Trace 分组和父子关系。`x-prompt-prism-trace-id` 请求头会直接将捕获记录归入同一 Trace，`x-prompt-prism-parent-capture-id` 请求头会直接指定父记录。没有这些请求头时，Prompt Prism 只使用与提供商无关的标准化信号：唯一的 tool result 引用、前序对话及模型输出的延续，或唯一的输入前缀。

启发式候选必须使用相同适配器、上游主机和非匿名请求身份，并处于最近的推断时间窗口内。候选有歧义时保持独立，不强行猜测。请求乱序完成时会重新检查关系，因此较晚完成的请求也可能补全已有 Trace badge。

Input Diff 是 Core 关系的消费者。只有打开 Input Diff tab 时才计算，并使用 Trace service 返回的 parent；它不会自行寻找父记录。没有 parent 的捕获记录会显示 baseline 或 unavailable。

各适配器都先显示 Messages，然后是 System、Tools 和请求选项。OpenAI 的 system 和 developer 消息归入 System，并保持原有顺序。

token 估算仅作诊断，不是计费数据，因为 tokenization 取决于模型。实际缓存用量始终来自提供商响应。
