# Agent Insights

[← README](../README.md) · [Guide](guide.md) · [Development](development.md)

Agent Insights reports operational facts about a captured run: tokens, cache reuse, request timing, input-section stability, tool errors, repeated calls, and tool-result size. It does not ask another model to judge the run.

## Mark an agent run

Give every model request in one run the same `x-prompt-prism-trace-id` header. The value becomes the stable run identifier used by the dashboard and Insights.

## List and inspect runs

```bash
p2 insights list --json
p2 insights report RUN_ID --json
```

Omit `--json` for a concise human-readable view. Reports contain aggregate statistics, fingerprints, section names, and Capture IDs rather than prompt or tool content.

The CLI connects to `http://127.0.0.1:1028` by default. Override it with `--prism-url URL` or `PROMPT_PRISM_URL`; the command-line option takes precedence.

## Compare two runs

After changing the agent and rerunning the same task with a new Trace ID:

```bash
p2 insights compare BEFORE_RUN_ID AFTER_RUN_ID --json
```

The comparison reports before/after values and deltas for token use, cache reuse, model timing, tool calls, errors, repeated calls, and result size. It also lists added, resolved, and persisting findings.

## Retrieve evidence

Content is returned only when it is explicitly requested:

```bash
p2 insights evidence CAPTURE_ID --section system --json
p2 insights evidence CAPTURE_ID --section tools --json
p2 insights evidence CAPTURE_ID --section tool-events --max-bytes 128KB --json
p2 insights evidence CAPTURE_ID --section output --json
```

Evidence responses identify the capture, section, returned bytes, original bytes, and whether the content was truncated.

## Diagnostic rules

The built-in rules flag:

- failed model or tool calls;
- malformed tool arguments;
- repeated identical tool calls;
- rewritten conversation history;
- changing System or Tools sections;
- tool results of at least 16 KiB;
- cache reuse below 50% after at least 1,024 non-initial input tokens.

Every finding includes the measured value, threshold, and Capture/section evidence location.

## Responsibility boundary

Insights does not edit the agent, replay requests, run its tests, or decide whether task quality improved. Combine the agent's own test results with these efficiency and stability measurements.
