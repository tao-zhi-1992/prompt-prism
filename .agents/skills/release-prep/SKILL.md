---
name: release-prep
description: Prepare the next Prompt Prism release by deriving the next SemVer from Conventional Commits, regenerating the Dashboard product image, updating the package version and CHANGELOG.md, running all release gates, and opening a reviewable Release PR against main. Use when a feature branch is ready for release preparation or when the user asks to update release notes, refresh the product screenshot, create a release PR, or prepare a versioned merge.
---

# Release Preparation

Use this skill from the repository root when the current feature branch is ready to become a release PR. It prepares files and opens the PR; it does not merge the PR, publish npm, create a GitHub Release, or create a tag locally.

## Safety checks

Before changing anything:

1. Confirm the repository is `/Users/taozhi/Desktop/github/prompt-debug` (or the current checkout containing this skill), the current branch is not `main`, and the worktree is clean. Stop and ask the user to commit or stash unrelated work if any check fails.
2. Fetch tags and `origin/main`, then verify GitHub CLI authentication before creating the PR:

   ```bash
   git fetch --tags origin main
   gh auth status
   ```

   Do not continue if either command fails.
   Run the bundled preflight check before creating any release branch:

   ```bash
   node .agents/skills/release-prep/scripts/release-info.mjs preflight
   ```

   A retry on an existing `release-prep/v<version>` branch is allowed when its release commit and metadata are already present.
3. Fetch the latest `origin/main` and `vMAJOR.MINOR.PATCH` tags. The planner compares commits unique to the current branch against `origin/main`, using the latest tag only as the version baseline; this avoids counting commits that were already merged to `main` under different merge hashes. Run the bundled read-only planner:

   ```bash
   node .agents/skills/release-prep/scripts/release-info.mjs plan
   ```

   The planner derives the version from commits unique to the current branch. A `BREAKING CHANGE` footer or `!` after the Conventional Commit type raises major, `feat` raises minor, and `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, and `revert` raise patch. If there are no current-branch commits beyond `origin/main`, stop instead of creating an empty release. If a matching release commit, package version, and changelog entry already exist, it reports the prepared version so a failed PR push can be retried safely.

4. Use the planner's version and release branch name. Do not ask the user to choose a version unless the repository history cannot be parsed safely.

## Prepare the release branch

Create or reuse `release-prep/v<version>` from the current feature branch. Never overwrite a branch containing unrelated commits. If the branch already exists, verify it points to the same prepared history before continuing.

Regenerate the product image using the existing screenshot skill. Read `.agents/skills/dashboard-screenshot/SKILL.md` and run its script; it must leave the old image untouched if any mock, browser, landing-page, or dimension check fails:

```bash
node .agents/skills/dashboard-screenshot/scripts/capture-dashboard.mjs
```

Update only the release metadata after the screenshot succeeds:

- Set `packages/prompt-prism/package.json` to the derived version.
- Add a new top `CHANGELOG.md` entry using the existing format, the current `YYYY-MM-DD` date, a compare link from the latest tag, and grouped Conventional Commit subjects. Preserve all existing entries.
- Keep the release entry and package version identical. Do not edit the lockfile for this workspace package unless its package version is represented there.

Use the planner to validate the staged result before committing:

```bash
node .agents/skills/release-prep/scripts/release-info.mjs validate --version <version>
```

## Release gates and PR

Run every gate from a clean dependency install/build state:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm test:coverage
pnpm typecheck:e2e
pnpm test:e2e
pnpm --dir packages/prompt-prism pack --dry-run
git diff --check
```

Inspect the diff for accidental captures, credentials, temporary URLs, generated coverage, or unrelated source changes. Stage only the screenshot, package version, changelog, and any explicitly intended release metadata. Create one English Conventional Commit:

```text
chore(release): prepare v<version>
```

Push the release branch and open or update one PR targeting `main`:

```bash
git push --set-upstream origin release-prep/v<version>
gh pr create --base main --head release-prep/v<version> \
  --title "chore(release): prepare v<version>" \
  --body-file <generated-release-notes>
```

If a PR for the same head and base already exists, update its body or report it instead of opening a duplicate. Include the derived version, commit range, changelog summary, screenshot update, all gate commands, and the fact that merging to `main` will let GitHub Actions create `v<version>`.

Stop after the PR is ready. The PR remains subject to normal review and branch protection.

## After the PR is merged

`.github/workflows/release-tag.yml` runs after the `CI` workflow completes for a push to `main`. It verifies that CI succeeded, the package version changed from the previous commit, and `CHANGELOG.md` contains the same version. It then creates and pushes an annotated `v<version>` tag. Re-running the workflow is safe when that tag already exists.

The workflow does not publish npm or create a GitHub Release. Follow `docs/releasing.md` (or its Chinese counterpart) for the manual publish step after the tag exists.

## Failure handling

- Never force-push, reset, delete branches, resolve merge conflicts automatically, or merge the PR.
- If screenshot generation or any gate fails, leave the existing screenshot and release metadata unchanged when possible, report the failing command, and fix the cause before retrying.
- If `gh pr create` fails, keep the release branch and commit so the operation can be retried without regenerating a different version.
- If the derived version is lower than the package version or latest tag, stop and report the inconsistent repository state.
