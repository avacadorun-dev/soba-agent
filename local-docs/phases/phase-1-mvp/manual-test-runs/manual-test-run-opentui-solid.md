# Manual Test Run: OpenTUI/Solid migration

> **Обновлено 2026-06-13:** Полный smoke test теперь в [`manual-smoke-test.md`](./manual-smoke-test.md) — 41 тест-кейс.
> Этот документ оставлен для истории миграции.

| Case | Steps | Expected | Result |
| --- | --- | --- | --- |
| Launch | Run `soba -i` | Alternate-screen Solid TUI opens with graphite header/sidebar/input/status | |
| Streaming | Send a normal prompt | Markdown response streams and view remains pinned to bottom | |
| Tools | Ask agent to read and edit a file | Tool borders show running/result/completed with duration | |
| Changes | Edit a tracked file | CHANGES panel shows path and green/red numstat | |
| Confirmation | Trigger a dangerous bash command | Input switches to y/N prompt; Enter/N denies, y allows | |
| Scrolling | Use wheel, arrows, PgUp/PgDn, Home/End | Conversation scrolls; End restores sticky bottom | |
| Clipboard | Press Ctrl+Y after a response | Last assistant message is copied through OSC 52 | |
| Cancel | Press Ctrl+C during a tool or turn | Active tool stops, otherwise active turn is cancelled | |
| Exit | Run `/exit` or `/quit` | TUI restores terminal and exits | |

# Input UX regression checks

| Case | Steps | Expected | Result |
| --- | --- | --- | --- |
| Manual compaction | Run `/session`, `/compact`, then `/session` | The second session report shows a smaller `Effective context tokens`; `Historical tokens` remains as an audit metric | |
| Selection copy | Select message text with the mouse, then press Cmd+C or Ctrl+Shift+C | Selected text is copied through OSC 52 and status shows that it was copied | |
| Prompt history | Submit two prompts, then press Up/Down in an empty single-line input | Up navigates older prompts and Down returns toward the empty input | |
| Slash completion | Type `/`, navigate with Up/Down, choose with Tab or Enter | Available commands appear and the selected command is inserted | |
| File completion | Type `@` or `@cli`, navigate and choose a file | Project files appear and the selected relative path is inserted as an `@path` reference | |

# Theme presets

| Case | Command | Expected |
| --- | --- | --- |
| Default calm theme | `soba -i --no-session` | TUI starts with the low-contrast `graphite` palette |
| Startup override | `soba -i --no-session --theme ember` | TUI starts with warm `ember` colors |
| Live switch | Enter `/theme aurora` | The running TUI changes to blue-violet `aurora` colors |
| Light palette | Enter `/theme paper` | The running TUI changes to the light `paper` palette |
| Invalid theme | Enter `/theme laser` | TUI shows usage and keeps the current palette |
