<p align="center">
  <img src="packages/prompt-prism/assets/logo-mark.png" alt="Prompt Prism logo" width="160">
</p>

<h1 align="center">Prompt Prism</h1>

<p align="center"><strong>See exactly what your agent sends to the model.</strong></p>

<p align="center">
  A zero-runtime-dependency local debugging proxy for Agent developers inspecting model requests, prompt changes, tool use, and multi-request traces.
</p>

<p align="center">
  <a href="https://tao-zhi-1992.github.io/prompt-prism/">Website</a> ·
  <a href="docs/guide.md">Guide</a> ·
  <a href="docs/insights.md">Agent Insights</a> ·
  <a href="docs/development.md">Development</a> ·
  <a href="docs/releasing.md">Releasing</a>
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> · English
</p>

![Prompt Prism dashboard showing an agent trace](docs/dashboard.png)

While you build and run an Agent, Prompt Prism sits between it and the model provider. Responses—including SSE streams—are forwarded immediately, while a redacted copy is captured locally for inspection.

```text
Agent developer  ──builds and runs──►  your agent
                                          │
                                          ▼
model provider  ◄──  http://127.0.0.1:1028
                              │
                              └──► Trace + Input Diff + Tools + Output + Raw
```

## Quick start

Requires Node.js 20 or later.

```bash
npm install -g prompt-prism
p2 start
```

Open [http://127.0.0.1:1028/_pp/](http://127.0.0.1:1028/_pp/) (it opens automatically unless `--no-open` is used), click **Proxy URL**, and enter your provider's Base URL. Configure your Agent's model API client to use the generated URL—through its framework settings, SDK `baseURL`, environment variable, CLI option, or custom HTTP client—and keep using the provider's normal API key.

The generated URL looks like `http://127.0.0.1:1028/_proxy/<encoded-upstream>`. It selects the upstream for that request, so one Prism instance can connect to different providers without restarting.

The following SDK configurations are examples of connecting an Agent; Prompt Prism does not require either SDK.

### Anthropic SDK example

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'http://127.0.0.1:1028/_proxy/<encoded-upstream>'
});
```

### OpenAI-compatible SDK example

```js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://127.0.0.1:1028/_proxy/<encoded-upstream>'
});
```

For scripts, `p2 url https://api.deepseek.com/v1` prints the same kind of URL as the Dashboard generator. It is an alternative to clicking **Proxy URL**, not an extra startup step.

If the Agent's model API client replaces the Base URL instead of preserving its path prefix, use the fixed `--upstream-base-url` compatibility mode described in the Guide.

## What you can inspect

- **Trace** — follow model, reasoning, tool call, and tool result events across captures.
- **Input Diff** — find the first inserted or removed message and understand cache-prefix changes.
- **Tools** — inspect declared schemas, parsed parameters, and the tools actually called.
- **Output** — read normalized text, reasoning, usage, errors, and tool arguments.
- **Raw** — fall back to the original redacted HTTP exchange for unsupported formats.
- **Agent Insights** — compare trace-level token use, cache reuse, timing, and tool behavior from the CLI.

## Compatibility

| Protocol | JSON | SSE | Tools | Normalized dashboard |
| --- | --- | --- | --- | --- |
| Anthropic Messages | Yes | Yes | Yes | Yes |
| OpenAI Chat Completions | Yes | Yes | Yes | Yes |
| Other HTTP traffic | Forwarded | Forwarded | Raw only | Raw only |

OpenAI Responses, Realtime, Embeddings, Images, and Audio endpoints are not normalized in this release. They are still forwarded and captured in Raw.

Dynamic Proxy URLs are integration-tested with the official OpenAI and Anthropic JavaScript SDKs. Agent frameworks, CLIs, and custom HTTP clients can use the same route when they support a configurable request target and preserve its path prefix; otherwise, use `--upstream-base-url`. Non-Agent model traffic is also forwarded and remains available in Raw.

## Documentation

- [Guide](docs/guide.md) — provider setup, CLI options, protocol detection, embedding, and local data.
- [Agent Insights](docs/insights.md) — inspect and compare agent runs from the shell.
- [Development](docs/development.md) — run the demo, work on the monorepo, and understand Input Diff matching.
- [Releasing](docs/releasing.md) — prepare, verify, and publish a release manually.

## Data and privacy

Captures stay on your machine under `./data` by default. API keys, authorization headers, and cookies are replaced with `[REDACTED]`; request and response bodies remain local because they are required for analysis. The default storage cap is 1 GB and the oldest captures are evicted first.

See the [Guide](docs/guide.md#data-and-privacy) before using Prompt Prism with sensitive projects.

## License

[MIT](LICENSE)
