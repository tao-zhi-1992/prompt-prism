# Prompt Prism 使用指南

[← README](../README.zh-CN.md) · [Agent Insights](insights.zh-CN.md) · [开发指南](development.zh-CN.md)

Prompt Prism 是一个面向 Agent 开发者的透明本地 HTTP 代理。它展示开发中 Agent 产生的模型请求、工具活动、输出和多请求轨迹，同时立即转发响应，并在后台保存一份脱敏副本。

## 安装

Prompt Prism 需要 Node.js 20 或更高版本。

```bash
npm install -g prompt-prism
```

`p2` 和 `prompt-prism` 调用的是同一个 CLI。

## 动态上游地址

不带 upstream 启动 Prism。此时是等待生成代理地址的仅动态模式：

```bash
# 终端 1
p2 start
```

打开仪表盘 [http://127.0.0.1:1028/_pp/](http://127.0.0.1:1028/_pp/)，点击 **代理地址**，输入提供商 Base URL 或完整 endpoint。将生成的地址配置为 Agent 模型 API 客户端使用的请求目标；这个客户端可以来自 framework、SDK、环境变量、CLI 或自建 HTTP 代码：

```text
http://127.0.0.1:1028/_proxy/<encoded-upstream>
```

对于脚本和自动化任务，`p2 url UPSTREAM_URL_OR_BASE_URL` 会输出与仪表盘生成器相同的地址：

```bash
p2 url https://api.deepseek.com/v1
```

这是仪表盘按钮的替代方式，不是第二个启动命令。一个 Prism 实例无需重启就能把不同请求转发到不同提供商。

动态路由只作用于带该前缀的请求，不修改固定上游。动态请求没有后缀时直接使用解码后的 URL；明确提供请求后缀和 query 时才会追加。无效的 encoded upstream 值返回 400，不会回退到其他提供商。

OpenAI 和 Anthropic 官方 JavaScript SDK 已纳入集成测试，但它们只是示例，并非使用要求。Agent framework、CLI 和自建 HTTP 客户端只要允许配置请求目标，并在追加 endpoint 时保留 Base URL 路径前缀，就可以兼容；如果前缀消失，请使用下面的固定上游兼容模式。

## 固定上游兼容模式

如果 Agent 的模型 API 客户端会替换 Base URL 而不是保留路径前缀，或者所有请求都应该使用同一个提供商，请使用固定 upstream。下面的 SDK 片段只是客户端配置示例：

### Anthropic Messages

```bash
p2 start --upstream-base-url https://api.anthropic.com
```

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'http://127.0.0.1:1028'
});
```

对于第三方 Anthropic 兼容命令，可临时覆盖其 Base URL：

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:1028 your-command
```

### OpenAI 兼容提供商

把提供商文档中的模型 API Base URL 复制到 `--upstream-base-url`：

```bash
p2 start --upstream-base-url https://api.deepseek.com
```

例如，将 Agent 使用的 OpenAI 兼容 SDK 指向 Prism，并保留其正常 token 和模型：

```js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://127.0.0.1:1028/v1'
});
```

OpenAI Chat Completions 的 JSON 和 SSE 响应、函数工具调用/结果、system 和 developer 消息，以及常见的 `reasoning_content` 和缓存 token 扩展都会被规范化。Responses、Realtime、Embeddings、Images 和 Audio 端点会照常转发，并以 Raw-only 方式捕获。

## CLI 参考

```text
p2 --version
p2 -v
p2 start [--upstream-base-url URL | --upstream-url URL] [--api-format FORMAT]
         [--port NUMBER] [--data-dir PATH] [--max-storage SIZE]
         [--open | --no-open]
p2 url UPSTREAM_URL_OR_BASE_URL [--proxy-url URL]
```

默认值：

| 选项 | 默认值 | 用途 |
| --- | --- | --- |
| `--upstream-base-url` | 无（仅动态模式） | 提供商模型 API Base URL |
| `--api-format` | `auto` | 检测 Anthropic Messages 或 OpenAI Chat Completions |
| `--port` | `1028` | 本地代理和仪表盘端口 |
| `--data-dir` | `./data` | 本地捕获目录 |
| `--max-storage` | `1GB` | 捕获存储上限 |
| `--open` | 启用 | 启动后打开仪表盘 |

`--upstream-base-url` 启用固定上游兼容模式。Prism 会追加由传入协议选定的端点：

`p2 url` 和仪表盘的代理地址生成器同时接受提供商 Base URL 或完整 endpoint。完整 endpoint 会原样编码；动态请求没有后缀时直接转发到该地址。无论输入哪种 URL，只有请求带后缀时才会追加该后缀。

如果没有提供 `--upstream-base-url` 或 `--upstream-url`，Prism 会以仅动态模式启动。普通未编码的代理请求会返回 `503`，直到请求使用 `/_proxy/<encoded-upstream>` 地址，或启动时配置固定上游。

| 提供商模型 API Base URL | 追加的端点 |
| --- | --- |
| `https://api.deepseek.com` | `/chat/completions` |
| `https://api.openai.com/v1` | `/chat/completions` |
| `https://api.anthropic.com` | `/v1/messages` |
| `https://api.stepfun.com/step_plan` | `/v1/messages` |
| `https://generativelanguage.googleapis.com/v1beta/openai` | `/chat/completions` |

`--upstream-url` 用于完整的端点，包括最终路径和可选 query。这是高级兜底通道，适用于端点无法从 Base URL 语义推导出的网关。两个上游选项互斥。

## 自动协议检测

`--api-format` 接受 `auto`、`anthropic-messages` 或 `openai-chat-completions`。更短的 `anthropic` 和 `openai` 别名仍然支持。

在 auto 模式下，Prism 独立检测每条捕获记录：依次考虑请求路径、头部、协议专属请求体、提供商响应，最后是显式提供的上游 URL 或已知提供商 Base URL。每条捕获记录以第一个可信信号为准，因此一种协议不会锁定或影响后续捕获。路由只使用转发前可用的信号：请求路径、头部和上游 URL 提示。没有固定上游时，动态请求使用其解码出的 Base URL 作为当前请求的提示。

未知的自定义 Base URL 不会被猜测。流量模糊的捕获记录照常转发，仅以 Raw 存储，不影响后续捕获。客户端需要固定协议时，请显式使用 `--api-format`。

OpenAI 将缓存提示 token 报告为 `prompt_tokens` 的子集。Prism 将其规范化为互斥值：Input 为 `prompt_tokens - cached_tokens`，Cache read 为 `cached_tokens`。Raw 保留提供商原始的 usage 结构。

## 仪表盘

启动 Prism 后打开 [http://127.0.0.1:1028/_pp/](http://127.0.0.1:1028/_pp/)。

请求列表初始加载最近 100 条捕获记录，滚动时获取更早的分页，并增量轮询新捕获。虚拟化渲染让浏览器负载保持有界，即使数据目录包含数万条捕获记录。列表位于顶部时新捕获立即插入；浏览历史时，使用新请求提示条合并，不丢失滚动位置。

第一条 capture 出现前，详情栏仍会显示 **代理地址** 操作。它会验证上游 Base URL，按照当前仪表盘 origin 生成并复制地址，不保存或修改服务端配置。

- Trace 按显式的 `x-prompt-prism-trace-id` 请求头分组，或从 Input Diff 祖先推断分组。
- Input Diff 比较规范化后的 Messages、System、Tools 和请求选项。
- Tools 展示声明的工具定义，并把实际调用链接到 Trace 中的参数。
- Output 呈现提供商无关的文本、推理、用量、错误和工具调用。
- Raw 保留脱敏后的 HTTP 请求和响应。

## 编程接口

包对外暴露本地服务器 API，供嵌入式使用和集成测试：

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

详见生成的 TypeScript 声明：`PromptPrismOptions`、实例状态和捕获记录契约。

`buildDynamicProxyBaseUrl(upstream, proxyOrigin?)` 构造完整地址；`encodeUpstreamUrl(upstream)` 返回编码后的上游值。嵌入式服务器监听 loopback 以外的地址时，必须显式设置 `allowRemoteDynamicUpstream: true` 才能启用动态路由。

本地管理 API 对无查询参数的 `GET /_pp/api/logs` 保留旧版数组响应。`GET /_pp/api/logs?limit=100` 提供游标分页，`before` 和 `after` 游标互斥；响应包含 `items`、`total`、两个边界游标以及 `has_older`/`has_newer`。页大小默认为 100，上限 200。`GET /_pp/api/logs/:id` 获取单条捕获记录摘要，用于仪表盘深链。

## 数据与隐私

除非指定 `--data-dir`，捕获记录存放在 `./data` 下。API key、授权头、代理授权、cookie 和 set-cookie 头在存储前会替换为 `[REDACTED]`。请求和响应体保留在本地，因为分析时需要它们。

默认上限为 1 GB。超过后，最早捕获的文件及其索引条目先被移除。单条捕获超过配置上限时不写入。

敏感项目请使用专用 `--data-dir`，切勿提交到版本库，调试完成后删除。Prompt Prism 是本地检查边界，不是防数据丢失系统。

动态上游可以把 API 凭证转发到用户编码的任意 URL，因此默认只在 loopback 监听地址启用。非 loopback 监听会返回 403，除非嵌入应用显式选择开启。不要将开启该能力的实例暴露为公共服务，也不要粘贴来自不可信来源的动态地址。
