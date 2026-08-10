<p align="center">
  <img src="packages/prompt-prism/assets/logo-mark.png" alt="Prompt Prism logo" width="260">
</p>

# Prompt Prism

**Inspect exactly what your model receives.**

Prompt Prism is a zero-runtime-dependency local proxy for model APIs. It forwards responses immediately—including SSE streams—while capturing a redacted copy in the background, showing input changes, structured model output, and multi-request Agent traces. Built-in adapters support Anthropic Messages and OpenAI-compatible Chat Completions.

![Prompt Prism dashboard showing captured requests and an Input Diff](docs/dashboard.png)

```text
your app  ──►  http://127.0.0.1:1028  ──►  model provider
                       │
                       └──► capture + Input Diff + Output + Trace + dashboard
```

## Quick start

Requires Node.js 20 or later.

```bash
npm install -g prompt-prism
pp start --upstream-base-url https://api.anthropic.com
```

Then set the Anthropic SDK base URL to `http://127.0.0.1:1028`. Keep using your normal API key; authentication headers are forwarded but never stored in plaintext.

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'http://127.0.0.1:1028'
});
```

Open [http://127.0.0.1:1028/_pp/](http://127.0.0.1:1028/_pp/) to inspect captures. `pp start` opens it automatically.

The longer `prompt-prism` command is also installed as an alias for `pp`.

For an OpenAI-compatible provider, copy the `base_url` shown in its documentation. Prism recognizes the protocol from the client request:

```bash
pp start --upstream-base-url https://api.deepseek.com
```

Then point an OpenAI-compatible SDK at Prism while keeping its normal token and model configuration:

```js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://127.0.0.1:1028/v1'
});
```

The OpenAI adapter supports Chat Completions JSON and SSE responses, function tool calls/results, system and developer messages, and common `reasoning_content` and cached-token extensions. Responses API, Realtime, Embeddings, Images, and Audio endpoints are not parsed in this release; unrecognized traffic is still forwarded and captured in Raw.

## Programmatic API

The package also exposes the local server API for embedding and integration tests:

```js
import { createPromptPrism, parseUpstreamBaseUrl, parseUpstreamUrl, startPromptPrism } from 'prompt-prism';
```

## Agent demo

The repository includes a Pi-powered Coding Agent for exercising Prompt Prism. Each browser session gets an isolated copy of a small TypeScript REST service. A single task naturally creates model → tool → model traffic, making cache prefixes and diffs visible in Prism.

```text
browser chat → Demo Agent (:3000) → Prompt Prism (:1028) → model provider
```

Start Prompt Prism with the provider Base URL, then copy the environment template and fill in the credential and model name:

```bash
# Terminal 1
pp start --upstream-base-url https://api.stepfun.com/step_plan

# Terminal 2
cp example/.env.example example/.env
pnpm demo
```

Then open the Agent chat at [http://127.0.0.1:3000/](http://127.0.0.1:3000/). Ask it to investigate the failing pagination test and approve each requested tool call. Sessions are in memory; their generated workspaces are retained under `example/.workspaces/` for inspection and are recreated by **Reset workspace**.

Required variables (see [example/.env.example](example/.env.example)):

- `DEMO_MODEL_PROVIDER_TOKEN`: provider credential sent through Prism by the Demo backend.
- `DEMO_AGENT_MODEL`: model selected by the Demo Agent.

`DEMO_BASE_URL` is optional and defaults to `http://127.0.0.1:1028`; do not include `/v1`. It identifies Prism, not the real model provider. `DEMO_API_FORMAT` defaults to `auto`: the Demo queries Prism and selects the matching Pi protocol. Use `anthropic-messages` or `openai-chat-completions` only as an explicit override. `DEMO_PORT` is also optional and defaults to `3000`.

The Demo intentionally uses complete Bash access after an explicit browser approval. Its workspace is a convenience boundary, not a system sandbox: approve commands only when you trust them.

To exercise an OpenAI-compatible Agent flow, use the provider's documented Base URL. The Demo discovers the format from Prism:

```bash
# Terminal 1
pp start --upstream-base-url https://api.deepseek.com

# example/.env
DEMO_BASE_URL=http://127.0.0.1:1028
DEMO_API_FORMAT=auto
DEMO_MODEL_PROVIDER_TOKEN=replace-with-your-token
DEMO_AGENT_MODEL=your-model-name

# Terminal 2
pnpm demo
```

For any third-party Anthropic-compatible program, temporarily point its Base URL at Prism:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:1028 your-command
```

## CLI

```text
pp start [--upstream-base-url URL | --upstream-url URL] [--api-format FORMAT]
         [--port NUMBER] [--data-dir PATH] [--max-storage 1GB] [--open | --no-open]
```

`--upstream-base-url` is recommended. Copy the provider's SDK `base_url`; Prism appends the endpoint selected by the incoming protocol:

```text
Provider SDK base_url                                  Final endpoint
https://api.deepseek.com                               /chat/completions
https://api.openai.com/v1                              /chat/completions
https://api.anthropic.com                              /v1/messages
https://api.stepfun.com/step_plan                      /v1/messages
https://generativelanguage.googleapis.com/v1beta/openai /chat/completions
```

`--upstream-url` is the advanced escape hatch for a complete HTTP endpoint, including its final path and optional query. Use it for custom gateways whose endpoint cannot be derived from standard Base URL semantics. The two upstream options are mutually exclusive.

`--api-format` defaults to `auto`. Prism recognizes Anthropic Messages and OpenAI Chat Completions from well-known provider Base URLs, the endpoint, request path, headers, and protocol-specific body structure, then locks that protocol for the process. Canonical overrides are `anthropic-messages` and `openai-chat-completions`; `anthropic` and `openai` remain short aliases. Unknown custom Base URLs are not guessed: ambiguous traffic is forwarded and stored as Raw-only until the protocol can be resolved, while the Demo requires an explicit override if it cannot resolve the format before its first request.

OpenAI reports cached prompt tokens as a subset of `prompt_tokens`. Prism normalizes these into mutually exclusive values: Input is `prompt_tokens - cached_tokens`, and Cache read is `cached_tokens`. This keeps Trace and Insights totals comparable with Anthropic; Raw retains the provider's original usage envelope.

For example:

```text
Demo → http://127.0.0.1:1028/v1/messages
     → https://api.stepfun.com/step_plan/v1/messages
```

## Agent Insights

Coding agents can query a running Prism process from the shell. Insights reports operational facts—tokens, cache reuse, request timing, input-section stability, tool errors, repeated calls, and tool-result size—without asking another model to judge the run.

Give every model request in one Agent run the same `x-prompt-prism-trace-id`, then inspect it:

```bash
pp insights list --json
pp insights report RUN_ID --json
```

After changing the Agent and rerunning the same task with a new Trace ID, compare the two runs:

```bash
pp insights compare BEFORE_RUN_ID AFTER_RUN_ID --json
```

Reports contain statistics, fingerprints, section names, and Capture IDs rather than prompt or tool content. Retrieve specific evidence explicitly when it is needed:

```bash
pp insights evidence CAPTURE_ID --section system --json
pp insights evidence CAPTURE_ID --section tools --json
pp insights evidence CAPTURE_ID --section tool-events --max-bytes 128KB --json
pp insights evidence CAPTURE_ID --section output --json
```

The CLI connects to `http://127.0.0.1:1028` by default. Override it with `--prism-url URL` or `PROMPT_PRISM_URL`; the command-line option takes precedence. Omit `--json` for a concise human-readable summary. Prism does not edit the Agent, replay requests, run tests, or decide whether task quality improved—the developing Agent combines its own test results with these efficiency measurements.

The first diagnostic rules flag failed model/tool calls, malformed tool arguments, repeated identical tool calls, rewritten history, changing System/Tools sections, tool results of at least 16 KiB, and cache reuse below 50% after at least 1,024 non-initial input tokens. Findings include the measured value, threshold, and Capture/section evidence location.

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

Captures are grouped by API format, a one-way SHA-256-derived API-token hash, upstream host, and model. Prompt Prism only selects a parent when at least one complete primary input item matches from the beginning. It prefers the most equal items, then the longest serialized character prefix, then the newest request. Both adapters show Messages first, followed by System, Tools, and Request options; OpenAI system and developer messages are grouped into System while preserving their order.

The token estimate is diagnostic, not billing data: tokenization is model-dependent. The actual cache usage always comes from the provider response.

## Data and privacy

Captures live under `./data` by default. API keys, authorization headers, and cookies are replaced with `[REDACTED]`. Request and response bodies are stored locally because they are required for analysis. The default cap is 1 GB; the oldest capture files and index entries are evicted first.

Use a separate `--data-dir` for sensitive projects, do not commit it, and delete it when the debugging session is finished.

## License

MIT
