# SOBA Agent Documentation

Documentation site for **SOBA Agent** — a next-generation CLI coding agent with proactive context management,
self-modifying architecture, and hybrid visual layer.

Built with [Fumadocs](https://fumadocs.dev) on TanStack Start.

## Themes

Two color themes based on SOBA Agent's semantic tokens:

| Theme | Mode | Accent | Description |
|---|---|---|---|
| **Graphite** | Dark | `#0F1115` bg, `#AEB8C5` primary | Subdued dark with steel-blue accent |
| **Paper** | Light | `#F5F0E7` bg, `#435A70` primary | Warm paper, calm blue accent |

Click the theme toggle in the header to switch between Graphite and Paper.

## Languages

- 🇬🇧 English (`/en`)
- 🇷🇺 Russian (`/ru`)
- 🇨🇳 Chinese (`/zh`)

## Development

```bash
bun install
bun run dev        # Start dev server on port 3000
bun run build      # Production build
bun run start      # Preview production build
```

## Deployment

Public docs are deployed with GitHub Pages. See [DEPLOYMENT.md](./DEPLOYMENT.md).

## Structure

```
content/docs/       # MDX documentation (i18n suffixes: .ru.mdx, .zh.mdx)
src/
├── lib/            # i18n, source loader, layout config
├── routes/         # TanStack Start routes ($lang/...)
├── styles/         # Graphite & Paper CSS themes
└── components/     # Version switcher, language switcher
```

## Versioning

Documentation is organized by SOBA Agent versions. Rendered app surfaces read the current version from the root
`package.json` through `src/lib/version.ts`. Version switcher in sidebar allows navigation between versions.

Latest documentation keeps the stable `/docs/...` URLs. Frozen minor-version snapshots live under `/docs/vX.Y/...`.
Before a minor release, refresh the current snapshot from the repository root:

```bash
bun run docs:version:snapshot vX.Y
bun run docs:version:check vX.Y
```

## Content Source

Content lives in `content/docs/` — maintained alongside the main codebase.

## Changelog

The changelog pages are generated from git tags and commit subjects. Run these commands from the repository root:

```bash
bun run docs:changelog
bun run docs:changelog:check
```

Before creating a release tag, render the future version section into the release commit:

```bash
bun run scripts/generate-changelog.ts --next-tag vX.Y.Z
bun run scripts/generate-changelog.ts --next-tag vX.Y.Z --check
```

CI and the release workflow run the check variant. GitHub release notes are generated with
`bun run scripts/generate-changelog.ts --release-notes "$RELEASE_TAG"`.
