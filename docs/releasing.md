# Releasing Prompt Prism

Prompt Prism releases are prepared and published manually. Merging into `main` runs CI, but it does not change the package version, create a tag or GitHub release, or publish to npm.

## Prepare a release

1. Merge the intended changes into `main` and check out the updated branch.
2. Choose the next semantic version and update `packages/prompt-prism/package.json`.
3. Add the matching version, date, and release notes to `CHANGELOG.md`.
4. Run the complete checks and inspect the package contents:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm --dir packages/prompt-prism pack --dry-run
```

5. Commit the version and changelog together using `chore(release): release <version>`, then merge or push that commit to `main`.

Do not update the version during ordinary feature development. The version change belongs only to the release preparation commit.

## Publish

From a clean, up-to-date `main` checkout at the release commit:

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

Authenticate with npm and GitHub before running these commands. Create the tag and GitHub release only after npm publishing succeeds, so a failed publish does not leave a release tag behind.

Conventional Commits remain required for repository history, but they no longer trigger or calculate releases automatically.
