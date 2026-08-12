# 发布 Prompt Prism

Prompt Prism 采用手动准备和发布流程。合并到 `main` 会运行 CI，但不会自动修改包版本、创建 tag 或 GitHub Release，也不会发布到 npm。

## 准备发布

1. 将本次发布所需的改动合并到 `main`，并拉取最新分支。
2. 确定下一个语义化版本，更新 `packages/prompt-prism/package.json`。
3. 在 `CHANGELOG.md` 中添加对应版本、日期和发布说明。
4. 运行完整检查并核对包内容：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm --dir packages/prompt-prism pack --dry-run
```

5. 使用 `chore(release): release <version>` 将版本号和变更日志一起提交，然后把该提交合并或推送到 `main`。

普通功能开发期间不要修改版本号；版本变更只属于正式的发布准备提交。

## 发布

在干净且已同步到发布提交的 `main` 工作区执行：

```bash
test "$(node -p "require('./packages/prompt-prism/package.json').version")" = "<version>"
pnpm test
cd packages/prompt-prism
npm publish --access public
cd ../..
git tag -a "v<version>" -m "v<version>"
git push origin "v<version>"
gh release create "v<version>" --title "v<version>" --generate-notes
```

执行前需要分别登录 npm 和 GitHub。只有 npm 发布成功后才创建 tag 和 GitHub Release，避免发布失败时留下已经存在的版本 tag。

仓库仍要求使用 Conventional Commits，但提交类型不再自动触发发布或计算版本号。
