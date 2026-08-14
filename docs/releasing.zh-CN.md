# 发布 Prompt Prism

Prompt Prism 使用经过审核的 Release PR。`release-prep` Skill 会根据 Conventional Commits 自动计算下一个版本，重新生成 Dashboard 截图，更新包版本和 `CHANGELOG.md`，运行完整检查，并从 `release-prep/v<version>` 向 `main` 创建 PR。

在干净的功能分支运行：

```text
Use $release-prep to prepare the next release PR.
```

PR 仍需人工 review，并遵守分支保护规则。PR 合并后，`Create release tag` workflow 会检查包版本确实变化且 changelog 存在对应条目，然后创建并推送 `v<version>` annotated tag。该 workflow 可安全重复运行；普通合并或版本元数据不匹配不会创建 tag。

普通功能开发期间不要修改版本号；版本变更只属于发布准备 PR。

## 发布

Release PR 合并且 `v<version>` tag 已存在后，在干净且已同步到 `main` 的工作区执行：

```bash
test "$(node -p "require('./packages/prompt-prism/package.json').version")" = "<version>"
pnpm test
cd packages/prompt-prism
npm publish --access public
cd ../..
gh release create "v<version>" --title "v<version>" --generate-notes
```

`prepack` 会从发布 manifest 中移除仅供 workspace 使用的私有依赖，`postpack` 会恢复仓库中的 manifest，因此可以直接使用 `npm publish`。发布前可运行 `npm pack --dry-run` 检查 tarball。

执行前需要分别登录 npm 和 GitHub。tag 已由合并后的 workflow 自动创建，不要在本地重复创建。GitHub Release 和 npm 发布仍然手动执行。

Skill 使用 Conventional Commits 计算下一个版本，但普通提交不会自动触发发布。

CLI 更新检查只读取公开的 npm 版本元数据。它先访问官方 npm registry，在无法直连时回退到 `registry.npmmirror.com`，不会发布、安装或修改 npm registry 配置。
