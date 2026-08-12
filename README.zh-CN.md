<p align="center">
  <img src="packages/prompt-prism/assets/logo-mark.png" alt="Prompt Prism 标志" width="160">
</p>

<h1 align="center">Prompt Prism</h1>

<p align="center"><strong>精确查看你的模型接收了什么。</strong></p>

<p align="center">
  一个零运行时依赖的本地代理，用于调试模型请求、提示词变更、工具调用和多请求 Agent 轨迹。
</p>

<p align="center">
  <a href="https://tao-zhi-1992.github.io/prompt-prism/">网站</a> ·
  <a href="docs/guide.zh-CN.md">使用指南</a> ·
  <a href="docs/insights.zh-CN.md">Agent Insights</a> ·
  <a href="docs/development.zh-CN.md">开发指南</a> ·
  <a href="docs/releasing.zh-CN.md">发布</a>
</p>

<p align="center">
  <a href="./README.md">English</a> · 简体中文
</p>

![Prompt Prism 仪表盘，显示 Agent 轨迹](docs/dashboard.png)

Prompt Prism 位于你的应用和模型提供商之间。响应（包括 SSE 流）会被立即转发，同时一份脱敏副本在本地保存，供你检查。

```text
你的应用  ──►  http://127.0.0.1:1028  ──►  模型提供商
                       │
                       └──► 轨迹 + Input Diff + Tools + Output + Raw
```

## 快速开始

需要 Node.js 20 或更高版本。

```bash
npm install -g prompt-prism
p2 start
```

打开 [http://127.0.0.1:1028/_pp/](http://127.0.0.1:1028/_pp/)（除非使用 `--no-open`，仪表盘会自动打开），点击 **代理地址**，输入提供商 Base URL，然后将生成的地址复制到 SDK 的 `baseURL`。继续使用提供商原有的 API key。

生成的地址形如 `http://127.0.0.1:1028/_proxy/<encoded-upstream>`。它只对当前请求选择上游，因此一个 Prism 实例无需重启就能连接不同的提供商。

### Anthropic

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'http://127.0.0.1:1028/_proxy/<encoded-upstream>'
});
```

### OpenAI 兼容

```js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://127.0.0.1:1028/_proxy/<encoded-upstream>'
});
```

对于脚本，可以运行 `p2 url https://api.deepseek.com/v1`，它会输出与仪表盘生成器相同类型的地址。这是点击 **代理地址** 的替代方式，不是额外的启动步骤。

如果 SDK 会替换 Base URL 而不是保留其中的路径前缀，请使用指南中介绍的固定 `--upstream-base-url` 兼容模式。

## 你可以检查什么

- **Trace** — 跨捕获记录跟踪模型、推理、工具调用和工具结果事件。
- **Input Diff** — 定位第一条新增或删除的消息，理解缓存前缀的变化。
- **Tools** — 检查声明的 schema、解析后的参数，以及实际被调用的工具。
- **Output** — 阅读规范化后的文本、推理、用量、错误和工具参数。
- **Raw** — 对不支持的格式，回退到原始脱敏后的 HTTP 交换内容。
- **Agent Insights** — 在 CLI 中比较运行级别的 token 用量、缓存复用、耗时和工具行为。

## 兼容性

| 协议 | JSON | SSE | 工具 | 规范化仪表盘 |
| --- | --- | --- | --- | --- |
| Anthropic Messages | 是 | 是 | 是 | 是 |
| OpenAI Chat Completions | 是 | 是 | 是 | 是 |
| 其他 HTTP 流量 | 转发 | 转发 | 仅 Raw | 仅 Raw |

OpenAI Responses、Realtime、Embeddings、Images 和 Audio 端点在本版本中不做规范化。它们仍会被转发并在 Raw 中捕获。

动态代理地址已通过 OpenAI 和 Anthropic 官方 JavaScript SDK 的集成测试。部分第三方客户端会替换而不是追加 Base URL 路径；客户端无法保留生成的路径前缀时，请使用 `--upstream-base-url`。

## 文档

- [使用指南](docs/guide.zh-CN.md) — 提供商配置、CLI 选项、协议检测、嵌入式使用和本地数据。
- [Agent Insights](docs/insights.zh-CN.md) — 在 shell 中检查并比较 Agent 运行。
- [开发指南](docs/development.zh-CN.md) — 运行演示、在 monorepo 中开发、理解 Input Diff 匹配。
- [发布](docs/releasing.zh-CN.md) — 手动准备、验证并发布新版本。

## 编程接口

```js
import {
  buildDynamicProxyBaseUrl,
  createPromptPrism,
  decodeUpstreamUrl,
  encodeUpstreamUrl,
  parseUpstreamBaseUrl,
  parseUpstreamUrl,
  startPromptPrism
} from 'prompt-prism';
```

## 数据与隐私

捕获记录默认保存在你本机的 `./data` 目录下。API key、授权头和 cookie 会在存储前被替换为 `[REDACTED]`；请求和响应体保留在本地，因为分析时需要它们。默认存储上限为 1 GB，最早捕获的记录会被优先清理。

在敏感项目中使用 Prompt Prism 之前，请先阅读[使用指南](docs/guide.zh-CN.md#数据与隐私)。

## 许可证

[MIT](LICENSE)
