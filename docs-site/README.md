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

Documentation is organized by SOBA Agent versions. Current version: **v0.4.2**.
Version switcher in sidebar allows navigation between versions.

## Content Source

Content lives in `content/docs/` — maintained alongside the main codebase.
