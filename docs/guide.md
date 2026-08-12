# Prompt Prism Guide

[← README](../README.md) · [Agent Insights](insights.md) · [Development](development.md)

Prompt Prism is a transparent local HTTP proxy for Agent developers. It exposes the model requests, tool activity, output, and multi-request traces produced by an Agent under development, while forwarding responses immediately and capturing a redacted copy in the background.

## Installation

Prompt Prism requires Node.js 20 or later.

```bash
npm install -g prompt-prism
```

Both `p2` and `prompt-prism` invoke the same CLI.

## Dynamic upstream URLs

Start Prism without an upstream. This dynamic-only mode is ready for generated Proxy URLs:

```bash
# Terminal 1
p2 start
```

Open the Dashboard at [http://127.0.0.1:1028/_pp/](http://127.0.0.1:1028/_pp/), click **Proxy URL**, and enter the provider's Base URL or complete endpoint. Configure the generated URL as the request target used by your Agent's model API client, whether that client is provided by a framework, SDK, environment variable, CLI, or custom HTTP code:

```text
http://127.0.0.1:1028/_proxy/<encoded-upstream>
```

For scripts and automation, `p2 url UPSTREAM_URL_OR_BASE_URL` prints the same URL as the Dashboard generator:

```bash
p2 url https://api.deepseek.com/v1
```

This is an alternative to using the Dashboard button, not a second startup command. One Prism process can route different requests to different providers without restarting.

Dynamic routing applies only to requests containing that prefix and does not change a fixed upstream. The decoded URL is used directly when the dynamic request has no suffix; an explicit request suffix and query are appended when present. Invalid encoded upstream values fail with 400 instead of falling back to another provider.

Official OpenAI and Anthropic JavaScript SDKs are covered by integration tests, but they are examples rather than requirements. Agent frameworks, CLIs, and custom HTTP clients are compatible when they let you configure the request target and preserve its Base URL path prefix while adding an endpoint. If the prefix disappears, use the fixed-upstream compatibility mode below.

## Fixed-upstream compatibility mode

Use a fixed upstream when the Agent's model API client replaces the Base URL instead of preserving its path prefix, or when every request should use one provider. The SDK snippets below are example client configurations:

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

For a third-party Anthropic-compatible command, temporarily override its Base URL:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:1028 your-command
```

### OpenAI-compatible providers

Copy the provider's documented model API Base URL into `--upstream-base-url`:

```bash
p2 start --upstream-base-url https://api.deepseek.com
```

For example, point an OpenAI-compatible SDK used by the Agent at Prism and retain its normal token and model:

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
p2 --version
p2 -v
p2 start [--upstream-base-url URL | --upstream-url URL] [--api-format FORMAT]
         [--port NUMBER] [--data-dir PATH] [--max-storage SIZE]
         [--open | --no-open]
p2 url UPSTREAM_URL_OR_BASE_URL [--proxy-url URL]
```

Defaults:

| Option | Default | Purpose |
| --- | --- | --- |
| `--upstream-base-url` | none (dynamic-only mode) | Provider model API Base URL |
| `--api-format` | `auto` | Detect Anthropic Messages or OpenAI Chat Completions |
| `--port` | `1028` | Local proxy and dashboard port |
| `--data-dir` | `./data` | Local capture directory |
| `--max-storage` | `1GB` | Capture storage cap |
| `--open` | enabled | Open the dashboard after startup |

`--upstream-base-url` enables fixed-upstream compatibility mode. Prism appends the endpoint selected by the incoming protocol:

`p2 url` and the Dashboard Proxy URL generator accept either a provider Base URL or a complete endpoint. A complete endpoint is encoded unchanged; a dynamic request with no suffix is forwarded directly to it. A request suffix is appended to either kind of decoded URL.

If neither `--upstream-base-url` nor `--upstream-url` is supplied, Prism starts in dynamic-only mode. Ordinary unencoded proxy requests return `503` until they use a `/_proxy/<encoded-upstream>` URL or a fixed upstream is configured.

| Provider model API Base URL | Appended endpoint |
| --- | --- |
| `https://api.deepseek.com` | `/chat/completions` |
| `https://api.openai.com/v1` | `/chat/completions` |
| `https://api.anthropic.com` | `/v1/messages` |
| `https://api.stepfun.com/step_plan` | `/v1/messages` |
| `https://generativelanguage.googleapis.com/v1beta/openai` | `/chat/completions` |

Use `--upstream-url` for a complete endpoint, including its final path and optional query. This is an advanced escape hatch for gateways whose endpoint cannot be derived from Base URL semantics. The two upstream options are mutually exclusive.

## Automatic protocol detection

`--api-format` accepts `auto`, `anthropic-messages`, or `openai-chat-completions`. The shorter `anthropic` and `openai` aliases remain supported.

In auto mode, Prism detects every capture independently. It considers the request path, headers, protocol-specific request body, provider response, and finally an explicitly provided upstream URL or known provider Base URL. The first confident signal for that capture wins, so one protocol never locks or influences later captures. Routing uses only signals available before forwarding: the request path, headers, and upstream URL hint. With no fixed upstream, dynamic requests use their decoded Base URL as the per-request hint.

Unknown custom Base URLs are not guessed. A capture with ambiguous traffic is forwarded and stored as Raw-only without affecting later captures. Use an explicit `--api-format` when a client needs a fixed protocol.

OpenAI reports cached prompt tokens as a subset of `prompt_tokens`. Prism normalizes these into mutually exclusive values: Input is `prompt_tokens - cached_tokens`, while Cache read is `cached_tokens`. Raw retains the provider's original usage envelope.

## Dashboard

Open [http://127.0.0.1:1028/_pp/](http://127.0.0.1:1028/_pp/) after starting Prism.

The Requests list initially loads the latest 100 captures, fetches older pages as you scroll, and polls incrementally for new captures. Its virtualized rendering keeps the browser workload bounded even when the data directory contains tens of thousands of captures. New captures are inserted immediately while the list is at the top; while browsing history, use the new-request banner to merge them without losing your scroll position.

The **Proxy URL** action remains available before the first capture. It validates an upstream Base URL, generates a URL for the current Dashboard origin, and copies it without saving or changing server configuration.

- Trace groups explicitly marked requests by `x-prompt-prism-trace-id`, or infers a group from Input Diff ancestry.
- Input Diff compares normalized Messages, System, Tools, and request options.
- Tools shows declared tool definitions and links actual calls to their parameters in Trace.
- Output presents provider-neutral text, reasoning, usage, errors, and tool calls.
- Raw preserves the redacted HTTP request and response.

## Programmatic API

The package exposes its local server API for embedding and integration tests:

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

See the generated TypeScript declarations for `PromptPrismOptions`, instance state, and capture contracts.

`buildDynamicProxyBaseUrl(upstream, proxyOrigin?)` builds the complete URL; `encodeUpstreamUrl(upstream)` returns the encoded upstream value. Embedded servers listening beyond loopback must explicitly set `allowRemoteDynamicUpstream: true` to enable dynamic routing.

The local admin API keeps the legacy array response for `GET /_pp/api/logs` without query parameters. Cursor pagination is available through `GET /_pp/api/logs?limit=100`, with mutually exclusive `before` and `after` cursors; responses include `items`, `total`, both boundary cursors, and `has_older`/`has_newer`. Page size defaults to 100 and is capped at 200. `GET /_pp/api/logs/:id` retrieves one capture summary for dashboard deep links.

## Data and privacy

Captures live under `./data` unless `--data-dir` is provided. API keys, authorization headers, proxy authorization, cookies, and set-cookie headers are replaced with `[REDACTED]` before storage. Request and response bodies remain local because they are required for analysis.

The default cap is 1 GB. When it is exceeded, the oldest capture files and their index entries are removed first. A single capture larger than the configured cap is not written.

Use a dedicated `--data-dir` for sensitive projects, never commit it, and delete it when debugging is complete. Prompt Prism is a local inspection boundary, not a data-loss-prevention system.

Dynamic upstreams can forward API credentials to any URL encoded by the user. They are enabled by default only on loopback listeners; non-loopback listeners return 403 unless the embedding application explicitly opts in. Do not expose an opted-in instance as a public service or paste dynamic URLs from untrusted sources.
