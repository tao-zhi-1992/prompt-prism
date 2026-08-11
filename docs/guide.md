# Prompt Prism Guide

[← README](../README.md) · [Agent Insights](insights.md) · [Development](development.md)

Prompt Prism is a transparent local HTTP proxy for model APIs. It forwards responses immediately, captures a redacted copy in the background, and serves the inspection dashboard at `/_pp/`.

## Installation

Prompt Prism requires Node.js 20 or later.

```bash
npm install -g prompt-prism
```

Both `p2` and `prompt-prism` invoke the same CLI.

## Anthropic Messages

Start Prism with the provider Base URL:

```bash
p2 start --upstream-base-url https://api.anthropic.com
```

Point the Anthropic SDK at Prism while keeping the provider API key:

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'http://127.0.0.1:1028'
});
```

For a third-party Anthropic-compatible command, temporarily override its Base URL:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:1028 your-command
```

## OpenAI-compatible providers

Copy the provider's documented SDK `base_url` into `--upstream-base-url`:

```bash
p2 start --upstream-base-url https://api.deepseek.com
```

Point an OpenAI-compatible SDK at Prism and retain its normal token and model:

```js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://127.0.0.1:1028/v1'
});
```

OpenAI Chat Completions JSON and SSE responses, function tool calls/results, system and developer messages, and common `reasoning_content` and cached-token extensions are normalized. Responses, Realtime, Embeddings, Images, and Audio endpoints are forwarded and captured as Raw-only traffic.

## CLI reference

```text
p2 start [--upstream-base-url URL | --upstream-url URL] [--api-format FORMAT]
         [--port NUMBER] [--data-dir PATH] [--max-storage SIZE]
         [--open | --no-open]
```

Defaults:

| Option | Default | Purpose |
| --- | --- | --- |
| `--upstream-base-url` | `https://api.anthropic.com` | Provider SDK Base URL |
| `--api-format` | `auto` | Detect Anthropic Messages or OpenAI Chat Completions |
| `--port` | `1028` | Local proxy and dashboard port |
| `--data-dir` | `./data` | Local capture directory |
| `--max-storage` | `1GB` | Capture storage cap |
| `--open` | enabled | Open the dashboard after startup |

`--upstream-base-url` is recommended. Prism appends the endpoint selected by the incoming protocol:

| Provider SDK Base URL | Appended endpoint |
| --- | --- |
| `https://api.deepseek.com` | `/chat/completions` |
| `https://api.openai.com/v1` | `/chat/completions` |
| `https://api.anthropic.com` | `/v1/messages` |
| `https://api.stepfun.com/step_plan` | `/v1/messages` |
| `https://generativelanguage.googleapis.com/v1beta/openai` | `/chat/completions` |

Use `--upstream-url` for a complete endpoint, including its final path and optional query. This is an advanced escape hatch for gateways whose endpoint cannot be derived from Base URL semantics. The two upstream options are mutually exclusive.

## Automatic protocol detection

`--api-format` accepts `auto`, `anthropic-messages`, or `openai-chat-completions`. The shorter `anthropic` and `openai` aliases remain supported.

In auto mode, Prism detects every capture independently. It considers the request path, headers, protocol-specific request body, provider response, and finally an explicitly provided upstream URL or known provider Base URL. The first confident signal for that capture wins, so one protocol never locks or influences later captures. Routing uses only signals available before forwarding: the request path, headers, and upstream URL hint. The implicit default Anthropic upstream is used only for forwarding and is not a format hint.

Unknown custom Base URLs are not guessed. A capture with ambiguous traffic is forwarded and stored as Raw-only without affecting later captures. Use an explicit `--api-format` when a client needs a fixed protocol.

OpenAI reports cached prompt tokens as a subset of `prompt_tokens`. Prism normalizes these into mutually exclusive values: Input is `prompt_tokens - cached_tokens`, while Cache read is `cached_tokens`. Raw retains the provider's original usage envelope.

## Dashboard

Open [http://127.0.0.1:1028/_pp/](http://127.0.0.1:1028/_pp/) after starting Prism.

- Trace groups explicitly marked requests by `x-prompt-prism-trace-id`, or infers a group from Input Diff ancestry.
- Input Diff compares normalized Messages, System, Tools, and request options.
- Tools shows declared tool definitions and links actual calls to their parameters in Trace.
- Output presents provider-neutral text, reasoning, usage, errors, and tool calls.
- Raw preserves the redacted HTTP request and response.

## Programmatic API

The package exposes its local server API for embedding and integration tests:

```js
import {
  createPromptPrism,
  parseUpstreamBaseUrl,
  parseUpstreamUrl,
  startPromptPrism
} from 'prompt-prism';
```

See the generated TypeScript declarations for `PromptPrismOptions`, instance state, and capture contracts.

## Data and privacy

Captures live under `./data` unless `--data-dir` is provided. API keys, authorization headers, proxy authorization, cookies, and set-cookie headers are replaced with `[REDACTED]` before storage. Request and response bodies remain local because they are required for analysis.

The default cap is 1 GB. When it is exceeded, the oldest capture files and their index entries are removed first. A single capture larger than the configured cap is not written.

Use a dedicated `--data-dir` for sensitive projects, never commit it, and delete it when debugging is complete. Prompt Prism is a local inspection boundary, not a data-loss-prevention system.
