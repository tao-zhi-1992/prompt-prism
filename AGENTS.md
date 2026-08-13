# Repository Guidelines

## Git Commits

- Write commit subjects and bodies in English.
- Follow Conventional Commits: `type(scope?): summary`.
- Keep subjects concise, imperative, and without a trailing period.

## Dashboard UI Style

- Keep the visual language restrained and consistent with the existing green palette: low-saturation green accents, thin borders, layered dark/light surfaces, and compact spacing.
- Reuse the theme variables (`--accent`, `--accent-strong`, `--green-bg`, `--line`, `--line-strong`, and `--surface-*`) instead of introducing unrelated colors.
- Prefer square, bordered labels and controls with compact `DM Mono` typography. Avoid pill-shaped badges and excessive rounded corners unless the component has a clear semantic reason.
- Keep HTTP status colors, Trace colors, and selection colors distinct from the shared green UI accent so they remain readable and meaningful.
