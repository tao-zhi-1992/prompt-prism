# Releasing Prompt Prism

Prompt Prism uses a reviewed Release PR. The release-prep Skill derives the next version from Conventional Commits, refreshes the Dashboard screenshot, updates the package version and `CHANGELOG.md`, runs the full checks, and opens a PR from `release-prep/v<version>` to `main`.

Run the Skill from a clean feature branch:

```text
Use $release-prep to prepare the next release PR.
```

The PR remains subject to review and branch protection. After it is merged, the `Create release tag` workflow checks that the package version changed and that the matching changelog entry exists, then creates and pushes the annotated `v<version>` tag. The workflow is idempotent and does not create a tag for ordinary merges or mismatched release metadata.

Do not update the version during ordinary feature development. The version change belongs only to the release-preparation PR.

## Publish

After the Release PR has been merged and the `v<version>` tag exists, publish from a clean, up-to-date `main` checkout:

```bash
test "$(node -p "require('./packages/prompt-prism/package.json').version")" = "<version>"
pnpm test
pnpm test:package
cd packages/prompt-prism
npm publish --access public
cd ../..
gh release create "v<version>" --title "v<version>" --generate-notes
```

`pnpm test:package` creates the npm tarball, verifies that its runtime manifest has no workspace dependencies, installs it in an isolated temporary directory, and runs `p2 --version`. The `prepublishOnly` guard also rejects any runtime workspace dependency before npm sends package metadata to the registry.

Authenticate with npm and GitHub before running these commands. The tag already exists because it was created after the Release PR merge; create the GitHub Release after npm publishing succeeds if you want a failed publish to leave no GitHub Release behind.

The tag is created automatically after the PR merge; do not recreate it locally. GitHub Release creation and npm publishing remain manual. Conventional Commits are used by the Skill to calculate the next version, but ordinary commits do not trigger a release.

The CLI update check reads public npm version metadata only. It tries the official npm registry first and falls back to `registry.npmmirror.com` for networks that cannot reach npm directly. It does not publish, install, or change npm registry configuration.
