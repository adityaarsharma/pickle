# @pickle/clickup-mcp

A **free, open-source, MIT-licensed** ClickUp MCP server for the [Pickle](https://github.com/adityaarsharma/pickle) project.

Built as a drop-in replacement for `@taazkareem/clickup-mcp-server` after it moved to a paid model. Pickle needs a forever-free alternative, and this is it.

- Pure Node.js (ESM). **No build step**, no TypeScript compilation.
- Only two dependencies: `@modelcontextprotocol/sdk` and `zod`.
- Stdio transport, works with Claude Code, Claude Desktop, and any MCP-compatible client.
- Zero telemetry. Only talks to `https://api.clickup.com`.
- Exponential backoff on HTTP 429 (respects `Retry-After`), 30 s timeout per request.

## Requirements

- **Node.js 18+** (uses the native `fetch()` API)
- A ClickUp **personal API token** — the one that starts with `pk_`. Grab it from ClickUp → Settings → Apps → API Token.

## Install

Clone the Pickle repo (or copy just this folder) and install the two deps:

```bash
git clone https://github.com/adityaarsharma/pickle.git
cd pickle/pickle-mcp/clickup
npm install
```

That's it. No build. No compile. Ready to run.

## Wire it up in Claude Code

Add an entry to your `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "clickup": {
      "command": "node",
      "args": ["/Users/you/pickle/pickle-mcp/clickup/server.mjs"],
      "env": {
        "CLICKUP_API_KEY": "pk_xxx",
        "CLICKUP_TEAM_ID": "9016694417"
      }
    }
  }
}
```

Adjust the path in `args[0]` to point at wherever you cloned this repo. Restart Claude Code once and the `clickup_*` tools will be available.

### Claude Desktop

Same config shape, in `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

## Environment variables

| Var                | Required | Description                                                                                   |
| ------------------ | -------- | --------------------------------------------------------------------------------------------- |
| `CLICKUP_API_KEY`  | **yes**  | Your ClickUp personal token (`pk_xxx`). No `Bearer` prefix — ClickUp uses the raw token.      |
| `CLICKUP_TEAM_ID`  | no       | Default workspace/team ID. If omitted, the server fetches `/api/v2/team` and uses the first.  |

## Tools exposed

All tool names match the names referenced by the `pickle-clickup` skill, so Pickle works end-to-end without any rewiring.

| Tool                                 | Endpoint                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `clickup_get_workspace_hierarchy`    | `GET /api/v2/team` + spaces / folders / lists                                        |
| `clickup_get_workspace_members`      | Derived from `GET /api/v2/team`                                                      |
| `clickup_find_member_by_name`        | Client-side filter over workspace members                                            |
| `clickup_resolve_assignees`          | Client-side resolution of names/emails to user IDs                                   |
| `clickup_get_chat_channels`          | `GET /api/v3/workspaces/{team_id}/chat/channels`                                     |
| `clickup_get_chat_channel_messages`  | `GET /api/v3/workspaces/{team_id}/chat/channels/{channel_id}/messages`               |
| `clickup_get_chat_message_replies`   | `GET /api/v3/.../messages/{message_id}/replies`                                      |
| `clickup_send_chat_message`          | `POST /api/v3/.../messages`                                                          |
| `clickup_filter_tasks`               | `GET /api/v2/team/{team_id}/task` (pagination via `page`, 0-indexed)                 |
| `clickup_get_task`                   | `GET /api/v2/task/{task_id}`                                                         |
| `clickup_get_task_comments`          | `GET /api/v2/task/{task_id}/comment`                                                 |
| `clickup_get_threaded_comments`      | `GET /api/v2/comment/{comment_id}/reply`                                             |
| `clickup_create_task_comment`        | `POST /api/v2/task/{task_id}/comment`                                                |
| `clickup_search_reminders`           | `GET /api/v2/team/{team_id}/reminder`                                                |
| `clickup_create_task`                | `POST /api/v2/list/{list_id}/task`                                                   |
| `clickup_update_task`                | `PUT /api/v2/task/{task_id}`                                                         |
| `clickup_create_list`                | `POST /api/v2/folder/{folder_id}/list` or `POST /api/v2/space/{space_id}/list`       |

## Design notes

- **Stateless.** The server does not write anything to disk. Team IDs are cached in memory only.
- **Structured output.** Every tool returns compact JSON (no pretty-printing) inside a single MCP text content block.
- **Rate limits.** On `HTTP 429` the server honours the `Retry-After` header (numeric seconds or HTTP date), capped at 60 s per retry, up to 5 retries with exponential backoff + jitter.
- **Timeouts.** Every request aborts after 30 seconds via `AbortController`.
- **Validation.** Every tool's input is validated with `zod` before it hits the wire; invalid args return an `InvalidParams` MCP error.

## Troubleshooting

- **`FATAL: CLICKUP_API_KEY env var is required`** — set it in the `env` block of your MCP config. It must not be empty.
- **`HTTP 401`** — your token is wrong or revoked. Generate a fresh one in ClickUp → Settings → Apps.
- **Tools not visible in Claude Code** — confirm the absolute path in `args[0]` points at `server.mjs`, then fully quit and reopen Claude Code.
- **`HTTP 429` loops** — the server already handles these. If you see the underlying error surface to the LLM, you exhausted all 5 retries; wait a minute and try again.

## License

MIT. Forever free. No phone-home, no license gating, no paid tier.

Built for [Pickle](https://github.com/adityaarsharma/pickle) by [Aditya Sharma](https://github.com/adityaarsharma).
