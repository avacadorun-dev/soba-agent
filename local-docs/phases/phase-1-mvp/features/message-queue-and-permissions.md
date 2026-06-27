# Message Queue and Permission Scopes

## User message queue

While an agent turn or direct shell command is active, new work is added to a typed FIFO queue instead of being
discarded. The queue preserves normal model messages, `!` shell commands, and silent `!!` shell commands.
Queued work is visible in the sidebar and starts automatically after the active item finishes.

Commands:

- `/queue` — show queued messages and their IDs
- `/queue edit <id> <message>` — replace queued message text
- `/queue cancel <id>` — remove one queued message
- `/queue cancel all` — clear the queue

Slash commands are executed immediately and are never sent to the model as queued user text.

## Permission scopes

Dangerous operations offer four decisions:

- `y` / `yes` — approve this operation once
- `s` / `session` — approve this exact operation for the current process session
- `r` / `repo` — enable full access inside the current repository
- `n` or any other input — deny

`repo` access is conservative because the bash tool is not an operating-system sandbox. Network,
privilege escalation, absolute paths, home-directory access, device writes, and parent-directory
traversal continue to require explicit approval.

Commands:

- `/permissions` — show the current mode
- `/permissions ask` — ask for dangerous operations
- `/permissions repo` — enable repo-scoped access
- `/permissions clear` — clear session approvals and return to `ask`
