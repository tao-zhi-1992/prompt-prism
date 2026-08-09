<p align="center">
  <img src="packages/prompt-prism/assets/logo-mark.png" alt="Prompt Prism logo" width="260">
</p>

# Prompt Prism

**Inspect exactly what your model receives.**

Prompt Prism is a zero-runtime-dependency local proxy for model APIs. It forwards responses immediately—including SSE streams—while capturing a redacted copy in the background, showing input changes, structured model output, and multi-request Agent traces. Anthropic Messages is the first built-in API format; the adapter registry is designed for additional formats.

![Prompt Prism dashboard showing captured requests and an Input Diff](docs/dashboard.png)

```text
your app  ──►  http://127.0.0.1:8787  ──►  api.anthropic.com
                       │
                       └──► capture + Input Diff + Output + Trace + dashboard
```

## Quick start

Requires Node.js 20 or later.

```bash
npm install -g prompt-prism
pp start --upstream-url https://provider.example.com/v1/messages --api-format anthropic
```

Then set the Anthropic SDK base URL to `http://127.0.0.1:8787`. Keep using your normal API key; authentication headers are forwarded but never stored in plaintext.

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'http://127.0.0.1:8787'
});
```

Open [http://127.0.0.1:8787/_pp/](http://127.0.0.1:8787/_pp/) to inspect captures. `pp start` opens it automatically.

The longer `prompt-prism` command is also installed as an alias for `pp`.

## Programmatic API

The package also exposes the local server API for embedding and integration tests:

```js
import { createPromptPrism, parseUpstreamUrl, startPromptPrism } from 'prompt-prism';
```

## Agent demo

The repository includes a Pi-powered Coding Agent for exercising Prompt Prism. Each browser session gets an isolated copy of a small TypeScript REST service. A single task naturally creates model → tool → model traffic, making cache prefixes and diffs visible in Prism.

```text
browser chat → Demo Agent (:3000) → Prompt Prism (:8787) → model provider
```

Start Prompt Prism with the complete provider endpoint, then copy the environment template and fill in the credential and model name:

```bash
# Terminal 1
pp start --upstream-url https://api.stepfun.com/step_plan/v1/messages

# Terminal 2
cp example/.env.example example/.env
pnpm demo
```

Then open the Agent chat at [http://127.0.0.1:3000/](http://127.0.0.1:3000/). Ask it to investigate the failing pagination test and approve each requested tool call. Sessions are in memory; their generated workspaces are retained under `example/.workspaces/` for inspection and are recreated by **Reset workspace**.

Required variables (see [example/.env.example](example/.env.example)):

- `DEMO_MODEL_PROVIDER_TOKEN`: provider credential sent through Prism by the Demo backend.
- `DEMO_AGENT_MODEL`: model selected by the Demo Agent.

`DEMO_BASE_URL` is optional and defaults to `http://127.0.0.1:8787`; do not include `/v1`. Demo appends `/v1/messages`. It identifies Prism, not the real model provider. `DEMO_PORT` is also optional and defaults to `3000`.

The Demo intentionally uses complete Bash access after an explicit browser approval. Its workspace is a convenience boundary, not a system sandbox: approve commands only when you trust them.

For any third-party Anthropic-compatible program, temporarily point its Base URL at Prism:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 your-command
```

## CLI

```text
pp start [--upstream-url URL] [--api-format FORMAT] [--port NUMBER] [--data-dir PATH]
         [--max-storage 1GB] [--open | --no-open]
```

`--upstream-url` is the complete upstream HTTP or HTTPS endpoint, including its final path and optional query string. Prism always sends model traffic to this exact endpoint; it does not append, remove, or rewrite `/v1/messages` based on the client request path.

`--api-format` selects the request/response adapter used for capture analysis. It currently defaults to and accepts `anthropic`; additional adapters can provide their own ordered Input Diff sections without changing the Dashboard.

For example:

```text
Demo → http://127.0.0.1:8787/v1/messages
     → https://api.stepfun.com/step_plan/v1/messages
```

For local development, use pnpm 10.28.0 or later:

```bash
pnpm install
pnpm --filter prompt-prism link --global
pnpm start
pnpm test
```

The Dashboard is built with React, TypeScript, Vite, and Base UI. Its page shell lives in `packages/dashboard/`. Built-in detail plugins live in `packages/plugins/`, with each plugin's Dashboard panel, server hooks, styles, and tests maintained together. Input Diff, Output, Trace, and Raw are registered through the same internal contracts; they are compiled into the Dashboard and into `packages/prompt-prism/dist/internal/plugins.js`. The production Dashboard bundle is generated in `packages/prompt-prism/public/dashboard/` and served under `/_pp/`.

```bash
pnpm dashboard:dev # Vite development server
pnpm build         # type-check and create the production bundle
```

## How Input Diff matching works

Captures are grouped by API format, a one-way SHA-256-derived API-token hash, upstream host, and model. Prompt Prism only selects a parent when at least one complete primary input item matches from the beginning. It prefers the most equal items, then the longest serialized character prefix, then the newest request. The Input Diff adapter supplies ordered sections: Anthropic currently shows Messages first, followed by System, Tools, and Request options.

The token estimate is diagnostic, not billing data: tokenization is model-dependent. The actual cache usage always comes from the provider response.

## Data and privacy

Captures live under `./data` by default. API keys, authorization headers, and cookies are replaced with `[REDACTED]`. Request and response bodies are stored locally because they are required for analysis. The default cap is 1 GB; the oldest capture files and index entries are evicted first.

Use a separate `--data-dir` for sensitive projects, do not commit it, and delete it when the debugging session is finished.

## License

MIT
