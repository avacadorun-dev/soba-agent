# Contributing

## Local pre-commit hook

SOBA uses a Bun-only local pre-commit hook. It does not require Husky, lint-staged, ESLint, or Prettier.

Install it once per clone:

```bash
git config core.hooksPath .hooks
chmod +x .hooks/pre-commit
```

The hook runs:

```bash
bun run lint
bunx tsc --noEmit
bun test
```

Before release-level commits, also run:

```bash
bun run build
bun run scripts/generate-changelog.ts --next-tag vX.Y.Z
bun run scripts/generate-changelog.ts --next-tag vX.Y.Z --check
```

If the hook fails, fix the reported issue and retry the commit. Do not add ESLint, Prettier, Husky, or npm-only hook tooling to bypass the gate.
