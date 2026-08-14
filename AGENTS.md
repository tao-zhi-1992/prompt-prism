# Repository Guidelines

## Git Commits

- Write commit subjects and bodies in English.
- Follow Conventional Commits: `type(scope?): summary`.
- Keep subjects concise, imperative, and without a trailing period.

## Test Layout

- Keep single-module unit tests and component tests next to the implementation as `src/**/*.test.ts` or `src/**/*.test.tsx`.
- Use `test/unit` for cross-module unit tests, `test/integration` for real-process, HTTP, CLI, or cross-package tests, and `test/fixtures` for protocol fixtures or large stable test data.
- Keep shared test-environment setup in the package-level `test/setup.ts`; do not place setup files under `src`.
- Keep package registries, default compositions, and public assembly tests in the package-level `test/` directory.
- Keep plugin behavior tests with their plugin, Dashboard shell tests with Dashboard, Core runtime tests with Core, and public CLI/API tests with `prompt-prism`.
- Do not move tests solely for visual uniformity when their current location matches these ownership boundaries.

## Dashboard UI Style

- Keep the visual language restrained and consistent with the existing green palette: low-saturation green accents, thin borders, layered dark/light surfaces, and compact spacing.
- Reuse the theme variables (`--accent`, `--accent-strong`, `--green-bg`, `--line`, `--line-strong`, and `--surface-*`) instead of introducing unrelated colors.
- Prefer square, bordered labels and controls with compact `DM Mono` typography. Avoid pill-shaped badges and excessive rounded corners unless the component has a clear semantic reason.
- Keep HTTP status colors, Trace colors, and selection colors distinct from the shared green UI accent so they remain readable and meaningful.
