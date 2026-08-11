<p align="center">
  <a href="./README.md">English</a> · 简体中文
</p>

<p align="center">
  <img src="packages/prompt-prism/assets/logo-mark.png" alt="Prompt Prism 标志" width="160">
</p>

<h1 align="center">Prompt Prism</h1>

<p align="center"><strong>精确查看你的模型到底接收了什么。</strong></p>

<p align="center">
  一个零运行时依赖的本地代理，用于调试模型请求、提示词变更、工具调用和多请求智能体轨迹。
</p>

<p align="center">
  <a href="https://tao-zhi-1992.github.io/prompt-prism/">网站</a> ·
  <a href="docs/guide.md">使用指南</a> ·
  <a href="docs/insights.md">智能体洞察</a> ·
  <a href="docs/development.md">开发指南</a>
</p>

![Prompt Prism 仪表盘，显示智能体轨迹](docs/dashboard.png)

Prompt Prism 位于你的应用程序和模型提供商之间。响应（包括 SSE 流）会被立即转发，同时一份经过脱敏处理的副本会在本地保存，供你检查。

```text
你的应用  ──►  http://127.0.0.1:1028  ──►  模型提供商
                       │
                       └──► 轨迹 + 输入差异 + 工具 + 输出 + 原始数据
```

## 快速开始

需要 Node.js 20 或更高版本。

```bash
npm install -g prompt-prism
p2 start --upstream-base-url https://api.anthropic.com
```

将你的 SDK 指向 `http://127.0.0.1:1028`，保留原来的 API key，然后打开 [http://127.0.0.1:1028/_pp/](http://127.0.0.1:1028/_pp/)。除非使用了 `--no-open`，仪表盘会自动打开。

### Anthropic

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'http://127.0.0.1:1028'
});
```

### OpenAI 兼容

使用提供商文档中的 Base URL 启动 Prism：

```bash
p2 start --upstream-base-url https://api.deepseek.com
```

```js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://127.0.0.1:1028/v1'
});
```

## 你可以检查什么

- **轨迹（Trace）** — 跨捕获跟踪模型、推理、工具调用和工具结果事件。
- **输入差异（Input Diff）** — 找出第一条新增或删除的消息，理解缓存前缀的变化。
- **工具（Tools）** — 检查声明的 schema、解析后的参数以及实际调用的工具。
- **输出（Output）** — 阅读规范化后的文本、推理、用量、错误和工具参数。
- **原始数据（Raw）** — 对于不支持的格式，回退到原始脱敏后的 HTTP 交换内容。
- **智能体洞察（Agent Insights）** — 在命令行中比较轨迹级别的 token 用量、缓存复用、耗时和工具行为。

## 兼容性

| 协议 | JSON | SSE | 工具 | 规范化仪表盘 |
| --- | --- | --- | --- | --- |
| Anthropic Messages | 是 | 是 | 是 | 是 |
| OpenAI Chat Completions | 是 | 是 | 是 | 是 |
| 其他 HTTP 流量 | 转发 | 转发 | 仅原始数据 | 仅原始数据 |

OpenAI Responses、Realtime、Embeddings、Images 和 Audio 端点在本版本中不做规范化处理。它们仍会被转发并在原始数据中捕获。

## 文档

- [使用指南](docs/guide.md) — 提供商配置、CLI 选项、协议检测、嵌入式使用和本地数据。
- [智能体洞察](docs/insights.md) — 在命令行中检查和比较智能体运行。
- [开发指南](docs/development.md) — 运行演示、在 monorepo 中开发并理解 Input Diff 匹配。

## 编程接口

```js
import {
  createPromptPrism,
  parseUpstreamBaseUrl,
  parseUpstreamUrl,
  startPromptPrism
} from 'prompt-prism';
```

## 数据与隐私

默认情况下，捕获内容保存在你本机的 `./data` 目录下。API key、授权头和 cookie 会被替换为 `[REDACTED]`；请求和响应体保留在本地，因为分析时需要它们。默认存储上限为 1 GB，最早的捕获内容会被优先清理。

在敏感项目中使用 Prompt Prism 之前，请先阅读[使用指南](docs/guide.md#data-and-privacy)。

## 许可证

[MIT](LICENSE)
