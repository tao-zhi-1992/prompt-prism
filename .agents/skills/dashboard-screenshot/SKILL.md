---
name: dashboard-screenshot
description: Regenerate the Prompt Prism Dashboard product screenshot with isolated mock captures, verify the Proxy URL presentation, and smoke-test the English and Chinese landing pages. Use when updating docs/dashboard.png or checking that the published product image matches the current Dashboard.
---

# Dashboard Screenshot

Use this skill when the Dashboard product image needs to be regenerated. It produces the repository's standard `docs/dashboard.png` asset at 2400×1260 while keeping the Dashboard at a 1200×630 CSS viewport with a 2× device scale factor.

## Workflow

Run from the repository root:

```bash
pnpm exec node .agents/skills/dashboard-screenshot/scripts/capture-dashboard.mjs
```

The script performs these steps in order:

1. Build the current Prompt Prism and Dashboard artifacts with `pnpm --filter prompt-prism build:all`.
2. Create an isolated temporary mock Anthropic upstream and temporary capture directory. It sends three real `POST /v1/messages` requests through Prompt Prism, including the `agent.checkout` trace, tool use/result data, messages, and token usage.
3. Start the compiled Prompt Prism server on loopback and load the compiled Dashboard with Chromium in dark mode.
4. Assert that the current version, Requests list, Trace content, and closed `Proxy URL` button are visible. The candidate screenshot is written to a temporary directory first.
5. Serve the landing pages with the candidate image and check both English and Chinese pages for HTTP 200, image dimensions, required alt text, and no horizontal overflow.
6. Atomically replace `docs/dashboard.png` only after every check succeeds. A failed run leaves the existing product image untouched.

## Invariants

- The output is a PNG of exactly 2400×1260; do not change the landing page's 1200×630 display dimensions for this workflow.
- Keep the dark theme, the full Dashboard shell, Requests, Trace/Tools content, and the top-right `Proxy URL` button visible. Do not open its dialog.
- Use only temporary mock data. Never use the repository's `data/` directory, real provider endpoints, API keys, credentials, or user captures.
- Inspect the resulting image visually after the script completes. Look for readable primary regions, no modal overlay, no secrets, and no temporary URLs.
- This skill updates only `docs/dashboard.png`; landing page HTML is validated but not rewritten.

## Failure handling

If build, mock traffic, browser assertions, landing smoke checks, or PNG validation fails, fix the underlying issue and rerun the script. Do not manually copy a partial screenshot into `docs/dashboard.png`.
