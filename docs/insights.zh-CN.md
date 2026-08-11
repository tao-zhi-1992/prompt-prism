# Agent Insights

[← README](../README.zh-CN.md) · [使用指南](guide.zh-CN.md) · [开发指南](development.zh-CN.md)

Agent Insights 报告一次捕获运行的操作事实：token、缓存复用、请求耗时、输入区块稳定性、工具错误、重复调用和工具结果大小。它不会让另一个模型来评判这次运行。

## 标记一次 Agent 运行

给一次运行中的每个模型请求相同的 `x-prompt-prism-trace-id` 请求头。该值会成为仪表盘和 Insights 使用的稳定运行标识。

## 列出并检查运行

```bash
p2 insights list --json
p2 insights report RUN_ID --json
```

省略 `--json` 可得到简洁的人类可读视图。报告包含汇总统计、指纹、区块名称和 Capture ID，不含 prompt 或工具内容。

CLI 默认连接 `http://127.0.0.1:1028`。可用 `--prism-url URL` 或 `PROMPT_PRISM_URL` 覆盖；命令行选项优先。

## 比较两次运行

修改 Agent 后，用新的 Trace ID 重跑同一任务：

```bash
p2 insights compare BEFORE_RUN_ID AFTER_RUN_ID --json
```

比较报告给出 token 用量、缓存复用、模型耗时、工具调用、错误、重复调用和结果大小的前后值及差值，并列出新增、已解决和持续存在的发现项。

## 获取证据

只有显式请求时才返回内容：

```bash
p2 insights evidence CAPTURE_ID --section system --json
p2 insights evidence CAPTURE_ID --section tools --json
p2 insights evidence CAPTURE_ID --section tool-events --max-bytes 128KB --json
p2 insights evidence CAPTURE_ID --section output --json
```

证据响应标明捕获记录、区块、返回字节数、原始字节数，以及内容是否被截断。

## 诊断规则

内置规则会标记：

- 失败的模型或工具调用；
- 格式错误的工具参数；
- 重复的相同工具调用；
- 被重写的对话历史；
- 变化的 System 或 Tools 区块；
- 不小于 16 KiB 的工具结果；
- 非初始输入 token 达到 1,024 之后缓存复用低于 50%。

每条发现项都包含测量值、阈值，以及 Capture/区块的证据位置。

## 职责边界

Insights 不修改 Agent、不重放请求、不运行其测试，也不判断任务质量是否提升。请结合 Agent 自身的测试结果，再参考这些效率和稳定性度量做判断。
