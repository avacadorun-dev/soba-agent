# Direct Shell Shortcuts

Interactive TUI input supports notebook-style shell commands:

- `!<command>` executes the command directly in the repository and shows stdout/stderr.
- `!!<command>` executes the command directly but hides stdout/stderr.

Direct shell commands are not sent to the model and do not consume model tokens. Because the user
explicitly authored the command, they bypass agent approval prompts.

When the agent or another direct command is active, shell shortcuts enter the same FIFO queue as
user messages. The queue preserves whether output should be visible. `/queue edit` changes the
command text without changing its `!` or `!!` mode.

`Ctrl+C` stops an active direct shell process. Queued work continues afterward.
