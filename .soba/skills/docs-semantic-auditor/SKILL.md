---
name: docs-semantic-auditor
description: Audits SOBA docs-site semantic coverage against facts extracted from the project code, including permission modes, approval decisions, slash commands, CLI flags, env vars, config keys, trust levels, and direct-shell syntax. Use when checking that docs do not merely avoid fabricated claims, but also mention code-defined user-facing semantics.
---

# Docs Semantic Auditor

Use this project skill when documentation needs a coverage audit against code-defined semantics.

This complements `doc-scout`:

- `doc-scout` validates claims already present in docs.
- `docs-semantic-auditor` extracts facts from code and reports which ones are not represented in docs.

## Workflow

1. Run the semantic coverage script:

```bash
bun run .soba/skills/docs-semantic-auditor/scripts/audit.ts
```

2. For a specific docs root:

```bash
bun run .soba/skills/docs-semantic-auditor/scripts/audit.ts --docs docs-site/content/docs
```

3. For machine-readable output:

```bash
bun run .soba/skills/docs-semantic-auditor/scripts/audit.ts --json
```

4. Review the report:

- `missing` means no literal or known alias was found in docs.
- `covered` means the fact appears somewhere in the scanned docs.
- `ignored` means the fact is intentionally not treated as required public documentation.

5. Update docs only after deciding whether each missing item is actually user-facing. The script is conservative: it
finds coverage candidates, not final editorial truth.

## Output

The script writes:

```text
.soba/skills/docs-semantic-auditor/output/semantic-coverage.json
```

## Current Fact Categories

- `permission-mode`
- `approval-decision`
- `trust-level`
- `slash-command`
- `cli-flag`
- `env-var`
- `config-key`
- `special-syntax`

## Notes

- The script uses `ts-morph` for TypeScript facts where useful and direct source scanning for env vars.
- It scans docs-site `.md` and `.mdx` files by default.
- Keep this skill focused on coverage extraction. Use `doc-scout` afterward to validate edited docs for fabricated claims.
