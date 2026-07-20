# Manual install

Prefer to configure Pickle by hand instead of running `./install.sh`? Here's the whole thing.

## 1. Clone + install dependencies

```bash
git clone https://github.com/adityaarsharma/pickle.git
cd pickle/server-remote
npm install
```

## 2. Get your own platform token

Pickle never issues a key. The only token you provide is your **own** access to the tool you want to audit:

| Tool | Token | Where |
|---|---|---|
| ClickUp | `pk_…` | ClickUp → Settings → Apps → API Token |
| Slack | `xoxp-…` | A Slack user token with `search:read`, `channels:history`, `im:history` |
| Microsoft Teams | Graph access token | Azure AD app (device flow) or Graph Explorer for a quick test |

You only need a token for the tool(s) you actually use. ClickUp alone is a fine start.

## 3. Add Pickle to your MCP client

Add this to your client's MCP config, pointing at the absolute path of `server.mjs` and putting **your** token in `env`:

```jsonc
{
  "mcpServers": {
    "pickle": {
      "command": "node",
      "args": ["/absolute/path/to/pickle/server-remote/server.mjs"],
      "env": {
        "CLICKUP_API_KEY": "pk_your_own_token",
        "SLACK_TOKEN": "xoxp_optional",
        "TEAMS_TOKEN": "optional"
      }
    }
  }
}
```

Config file locations:

- **Claude Code / Claude Desktop** — `~/.claude.json` (or `claude_desktop_config.json`)
- **Cursor** — `.cursor/mcp.json`
- **Codex / Cline / Continue / Zed** — that client's MCP settings

## 4. Restart your client and run

> *"Pickle, audit my ClickUp from the last 7 days — what did I miss?"*

Your token stays in that config file, on your disk. Pickle sends it to no one — it calls only ClickUp/Slack/Teams on your behalf.

## Notes

- Node 18+ required.
- The server binds `127.0.0.1` only — nothing is exposed to your network.
- No account, no telemetry, no phone-home. Read [`server-remote/server.mjs`](../server-remote/server.mjs) to confirm.
