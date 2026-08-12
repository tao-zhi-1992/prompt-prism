# Releasing Prompt Prism

Prompt Prism uses [Release Please](https://github.com/googleapis/release-please) to turn Conventional Commits merged into `main` into release pull requests. Merging a generated release pull request creates the GitHub release, tag, package version, and changelog entry, then publishes `prompt-prism` to npm.

## One-time repository setup

1. In GitHub, set **Settings → Actions → General → Workflow permissions** to **Read and write permissions**.
2. On npm, configure `prompt-prism` to trust this GitHub workflow. In the package's **Publishing access** settings, add a GitHub Actions trusted publisher with:
   - Repository: `tao-zhi-1992/prompt-prism`
   - Workflow: `release-please.yml`
   - Environment: leave empty
3. Ensure the npm package is public and that GitHub Actions is allowed to publish it.

The same trusted publisher can be configured from an authenticated npm CLI:

```bash
npm trust github prompt-prism \
  --repo tao-zhi-1992/prompt-prism \
  --file release-please.yml \
  --allow-publish
```

Trusted publishing uses GitHub Actions OIDC, so the workflow does not need an `NPM_TOKEN` secret. Do not add one unless npm's trusted-publishing setup requires a temporary fallback.

## Normal release flow

1. Merge changes into `dev` using Conventional Commit messages, for example `feat(proxy): add dynamic upstream URLs` or `fix(dashboard): keep selection stable`.
2. Merge `dev` into `main` when the release is ready. CI runs tests on both branches.
3. Release Please opens or updates a release pull request with the calculated version and generated `CHANGELOG.md` entry.
4. Review and merge that release pull request. The same workflow creates the GitHub release and publishes the nested `packages/prompt-prism` package to npm.

The initial automated release starts from version `0.1.2`; earlier history is deliberately excluded from generated release notes.

## Version rules

- `fix:` produces a patch release.
- `feat:` produces a minor release.
- A breaking-change footer or `!` produces a major release.
- `docs:`, `test:`, `chore:`, and `refactor:` do not release by themselves unless explicitly configured otherwise.
