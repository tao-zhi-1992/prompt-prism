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
pnpm test          # 运行 plugins、core、dashboard 和 example 测试
```

## 仓库结构

- `packages/prompt-prism/` 包含 CLI、代理、捕获存储、适配器和生产资源。
- `packages/dashboard/` 包含 React/Vite 仪表盘外壳。
- `packages/plugins/` 包含每个详情 tab 的仪表盘面板、服务器 hook、样式和测试。
- `packages/ui/` 包含共享 UI 原语。
- `example/` 包含 Pi 驱动的 Coding Agent 演示。

内置插件会编译进仪表盘和 `packages/prompt-prism/dist/internal/plugins.js`。生产仪表盘 bundle 生成于 `packages/prompt-prism/public/dashboard/`，并从 `/_pp/` 提供。

## Agent 演示

演示为每个浏览器会话提供一个小型 TypeScript REST 服务的隔离副本。一个任务产生模型 → 工具 → 模型流量，让轨迹、缓存前缀和 Input Diff 在 Prism 中清晰可见。

```text
browser chat → Demo Agent (:3000) → Prompt Prism (:1028) → model provider
```

启动 Prompt Prism，复制环境模板，设置提供商凭证和模型：

```bash
# 终端 1
p2 start --upstream-base-url https://api.stepfun.com/step_plan

# 终端 2
cp example/.env.example example/.env
pnpm demo
```

打开 [http://127.0.0.1:3000/](http://127.0.0.1:3000/)，让 Agent 调查失败的分页测试，并批准每次工具调用。

必需变量：

- `DEMO_MODEL_PROVIDER_TOKEN`：演示后端通过 Prism 发送的提供商凭证。
- `DEMO_AGENT_MODEL`：演示 Agent 选择的模型。

可选变量：

- `DEMO_BASE_URL`：默认为 `http://127.0.0.1:1028`；不要包含 `/v1`。
- `DEMO_API_FORMAT`：默认为 `auto`，使用演示的 Anthropic 客户端配合按捕获记录进行的代理检测；用 `anthropic-messages` 或 `openai-chat-completions` 覆盖客户端协议。
- `DEMO_PORT`：默认为 `3000`。

会话保存在内存中。生成的工作区保留在 `example/.workspaces/` 下，可通过**重置工作区**重建。

演示只有在浏览器批准后才授予完整 Bash 访问权限。它的工作区是便利边界，不是系统沙箱；只批准你信任的命令。

## Input Diff 匹配原理

捕获记录按 API 格式、单向 SHA-256 派生的 API token 哈希、上游主机和模型分组。Prompt Prism 只有在至少一个完整主输入项从头匹配时，才为捕获记录选择父记录。

候选排序依据：

1. 相等的完整项最多；
2. 序列化字符前缀最长；
3. 请求最新。

两个适配器都先显示 Messages，然后是 System、Tools 和请求选项。OpenAI 的 system 和 developer 消息归入 System，并保持原有顺序。

token 估算仅作诊断，不是计费数据，因为 tokenization 取决于模型。实际缓存用量始终来自提供商响应。
