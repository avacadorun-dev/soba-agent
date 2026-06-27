# Manual Test Run: Queue and Permissions

| # | Scenario | Expected result | Result |
|---|---|---|---|
| 1 | Start a long task, then submit two more messages | Both messages appear under `QUEUE` and run FIFO | ☐ |
| 2 | Run `/queue edit <id> updated text` | Sidebar shows updated text | ☐ |
| 3 | Run `/queue cancel <id>` | Selected message disappears and never runs | ☐ |
| 4 | Approve a dangerous command with `s` and repeat it | The repeated exact command does not ask again | ☐ |
| 5 | Approve repo access with `r`, then run `rm -rf node_modules` | Repo-scoped command runs without another prompt | ☐ |
| 6 | With repo access enabled, run `curl https://example.com` | External operation still asks for approval | ☐ |
| 7 | Run `/permissions clear` | Mode returns to `ask`; session approvals are removed | ☐ |
