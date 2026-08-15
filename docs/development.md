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
pnpm test          # run all unit and integration tests
pnpm test:unit     # run unit/component tests
pnpm test:integration # run proxy, CLI, protocol, and example integration tests
pnpm test:coverage # run package gates, Core proxy coverage, and changed-line coverage gates
pnpm typecheck:e2e # type-check Playwright tests
pnpm test:e2e      # build Prism and run Chromium Dashboard tests
```

The test suite has three layers: Node unit/integration tests exercise adapters, storage, proxy forwarding, CLI behavior, protocol compatibility, and the example Agent; Vitest/jsdom tests exercise Dashboard, plugin, and shared UI components; Playwright tests exercise the compiled Dashboard against a real local Prompt Prism server. Coverage runs Core with the proxy integration suite (90% statements, functions, and lines; 75% branches), then applies package regression floors and a 90% minimum to changed executable lines. Type-only contract files are excluded from executable coverage.

CI runs the unit/integration suite on Node.js 20, 22, and 24. Coverage and Chromium E2E run once on Node.js 24, with their reports uploaded as workflow artifacts.

## Repository structure

- `packages/contracts/` contains provider-neutral server and capture/Trace contracts.
- `packages/core/` contains the proxy, capture store, log feed, adapters, and Trace service.
- `packages/builtins/` assembles the default server plugins and Dashboard tabs.
- `packages/dashboard-kit/` contains Dashboard contracts, i18n, registry helpers, and display-only Trace utilities.
- `packages/dashboard/` contains the React/Vite Dashboard shell.
- `packages/plugins/` contains detail tabs and their server/dashboard implementations.
- `packages/ui/` contains shared visual primitives.
- `packages/prompt-prism/` contains the public CLI/API and release packaging.
- `example/` contains the Pi-powered Coding Agent demo.

`pnpm build:all` bundles the default server runtime under `packages/prompt-prism/dist/` and the production Dashboard under `packages/prompt-prism/public/dashboard/`, which is served from `/_pp/`.

## Agent demo

The demo gives each browser session an isolated copy of a small TypeScript REST service. A task creates model → tool → model traffic, making traces, cache prefixes, and input diffs visible in Prism.

```text
browser chat → Demo Agent (:3000) → Prompt Prism (:1028) → model provider
```

Start Prompt Prism without a fixed upstream, generate a Proxy URL for the provider used by the demo Agent, and put that URL in the demo's model API configuration:

```bash
# Terminal 1
p2 start
p2 url https://api.anthropic.com

# Terminal 2
cp example/.env.example example/.env
# Use the URL printed by `p2 url` for this run.
DEMO_BASE_URL="$(p2 url https://api.anthropic.com)" pnpm demo
```

Open [http://127.0.0.1:3000/](http://127.0.0.1:3000/), ask the agent to investigate the failing pagination test, and approve each tool call.

Required variables:

- `DEMO_MODEL_PROVIDER_TOKEN`: provider credential sent through Prism by the demo backend.
- `DEMO_AGENT_MODEL`: model selected by the demo agent.

Optional variables:

- `DEMO_BASE_URL`: defaults to the local Prism origin `http://127.0.0.1:1028`; when Prism has no fixed upstream, set it to the generated Proxy URL from `p2 url`. Do not append an API endpoint yourself.
- `DEMO_API_FORMAT`: defaults to `auto`; use `anthropic-messages` or `openai-chat-completions` to select the Demo Agent protocol explicitly.
- `DEMO_PORT`: defaults to `3000`.

## Protocol fixtures

Adapter compatibility fixtures live in `packages/core/test/fixtures/protocols`. They are small, offline copies of public API shapes with source URLs and revision metadata in `sources.json`; they intentionally do not vendor the full provider specifications. Update fixtures manually when a supported protocol changes, then run the adapter and integration suites.

To compare the tracked OpenAI fixture revision with an official OpenAPI commit, run `pnpm check:openai-openapi -- <commit>`. This is a manual, networked maintenance command and is never run by CI. Realtime, Batch, Assistants, and managed-agent-specific protocols remain Raw captures.

Sessions are in memory. Generated workspaces are retained under `example/.workspaces/` and recreated by **Reset workspace**.

The demo grants complete Bash access only after browser approval. Its workspace is a convenience boundary, not a system sandbox; approve commands only when you trust them.

## Trace relationships and Input Diff

The Core Trace service owns Trace grouping and parent relationships. An `x-prompt-prism-trace-id` header explicitly groups captures, while `x-prompt-prism-parent-capture-id` explicitly names a parent. Without those headers, Prompt Prism uses normalized, provider-neutral signals: a unique tool-result reference, continuation of the previous conversation and model output, or a unique input prefix.

Heuristic candidates must use the same adapter, upstream host, and non-anonymous request identity, and must be within the recent inference window. Ambiguous candidates remain independent instead of being guessed. Relationships are reconciled when captures finish out of order, so a late capture can update an existing Trace badge.

Input Diff is a consumer of the Core relationship. It is calculated when the Input Diff tab is opened, using the parent returned by the Trace service; it does not discover parents itself. A capture without a parent is shown as a baseline or unavailable result.

The adapters expose Messages first, followed by System, Tools, and request options. OpenAI system and developer messages are grouped into System while preserving their order.

The token estimate is diagnostic rather than billing data because tokenization depends on the model. Actual cache usage always comes from the provider response.
