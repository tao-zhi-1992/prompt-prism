# Development

[← README](../README.md) · [Guide](guide.md) · [Agent Insights](insights.md)

## Local setup

Use pnpm 10.28.0 or later:

```bash
pnpm install
pnpm --filter prompt-prism link --global
pnpm start
pnpm test
```

Useful commands:

```bash
pnpm dashboard:dev # Vite dashboard development server
pnpm build         # type-check and build all production artifacts
pnpm test          # run plugins, core, dashboard, and example tests
```

## Repository structure

- `packages/prompt-prism/` contains the CLI, proxy, capture store, adapters, and production assets.
- `packages/dashboard/` contains the React/Vite dashboard shell.
- `packages/plugins/` contains each detail tab's dashboard panel, server hook, styles, and tests.
- `packages/ui/` contains shared UI primitives.
- `example/` contains the Pi-powered Coding Agent demo.

Built-in plugins are compiled into the dashboard and `packages/prompt-prism/dist/internal/plugins.js`. The production dashboard bundle is generated under `packages/prompt-prism/public/dashboard/` and served from `/_pp/`.

## Agent demo

The demo gives each browser session an isolated copy of a small TypeScript REST service. A task creates model → tool → model traffic, making traces, cache prefixes, and input diffs visible in Prism.

```text
browser chat → Demo Agent (:3000) → Prompt Prism (:1028) → model provider
```

Start Prompt Prism, copy the environment template, and set a provider credential and model:

```bash
# Terminal 1
pp start --upstream-base-url https://api.stepfun.com/step_plan

# Terminal 2
cp example/.env.example example/.env
pnpm demo
```

Open [http://127.0.0.1:3000/](http://127.0.0.1:3000/), ask the agent to investigate the failing pagination test, and approve each tool call.

Required variables:

- `DEMO_MODEL_PROVIDER_TOKEN`: provider credential sent through Prism by the demo backend.
- `DEMO_AGENT_MODEL`: model selected by the demo agent.

Optional variables:

- `DEMO_BASE_URL`: defaults to `http://127.0.0.1:1028`; do not include `/v1`.
- `DEMO_API_FORMAT`: defaults to `auto`; use `anthropic-messages` or `openai-chat-completions` only as an override.
- `DEMO_PORT`: defaults to `3000`.

Sessions are in memory. Generated workspaces are retained under `example/.workspaces/` and recreated by **Reset workspace**.

The demo grants complete Bash access only after browser approval. Its workspace is a convenience boundary, not a system sandbox; approve commands only when you trust them.

## How Input Diff matching works

Captures are grouped by API format, a one-way SHA-256-derived API-token hash, upstream host, and model. Prompt Prism selects a parent only when at least one complete primary input item matches from the beginning.

Candidates are ranked by:

1. the greatest number of equal complete items;
2. the longest serialized character prefix;
3. the newest request.

Both adapters show Messages first, followed by System, Tools, and request options. OpenAI system and developer messages are grouped into System while preserving their order.

The token estimate is diagnostic rather than billing data because tokenization depends on the model. Actual cache usage always comes from the provider response.
