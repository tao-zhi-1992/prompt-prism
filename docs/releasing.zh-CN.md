# 发布 Prompt Prism

Prompt Prism 使用 [Release Please](https://github.com/googleapis/release-please) 将合并到 `main` 的 Conventional Commit 自动整理为发布 PR。合并该 PR 后会创建 GitHub Release 和 tag、更新包版本和变更日志，并将 `prompt-prism` 发布到 npm。

## 一次性仓库配置

1. 在 GitHub 的 **Settings → Actions → General → Workflow permissions** 中选择 **Read and write permissions**。
2. 在 npm 的 `prompt-prism` 包 **Publishing access** 设置中添加 GitHub Actions trusted publisher：
   - Repository：`tao-zhi-1992/prompt-prism`
   - Workflow：`release-please.yml`
   - Environment：留空
3. 确认 npm 包为公开包，并允许 GitHub Actions 发布。

也可以使用已登录且有权限的 npm CLI 完成同一配置：

```bash
npm trust github prompt-prism \
  --repo tao-zhi-1992/prompt-prism \
  --file release-please.yml \
  --allow-publish
```

Trusted Publishing 使用 GitHub Actions OIDC，因此 workflow 不需要 `NPM_TOKEN` secret。除非 npm 的 trusted publishing 配置需要临时兜底，否则不要添加该 secret。

## 日常发布流程

1. 用 Conventional Commit 消息将变更合入 `dev`，例如 `feat(proxy): add dynamic upstream URLs` 或 `fix(dashboard): keep selection stable`。
2. 准备发布时，将 `dev` 合入 `main`。两个分支都会运行 CI。
3. Release Please 会创建或更新发布 PR，写入计算出的版本和自动生成的 `CHANGELOG.md` 条目。
4. 审核并合并该发布 PR。同一个 workflow 会创建 GitHub Release，并发布嵌套在 `packages/prompt-prism` 的 npm 包。

第一份自动化发布从 `0.1.2` 开始；更早的提交历史会有意排除在自动生成的发布说明之外。

## 版本规则

- `fix:` 产生补丁版本。
- `feat:` 产生次版本。
- 带有 breaking-change footer 或 `!` 的提交产生主版本。
- `docs:`、`test:`、`chore:` 和 `refactor:` 默认不会单独触发发布，除非后续专门配置。
