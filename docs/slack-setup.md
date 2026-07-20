# Slack Setup

> Part of [Pickle](https://github.com/adityaarsharma/pickle) · Built by [Aditya Sharma](https://github.com/adityaarsharma)

Two ways to connect Slack. Pick one.

---

## Option A — Official Claude connector (easiest)

Best for: solo users, fastest path.

```
  claude.ai
      │
      ▼
  Settings → Connectors
      │
      ▼
  Find "Slack" → Connect
      │
      ▼
  Sign in to your Slack workspace, approve scopes
      │
      ▼
  ✅ Done — restart Claude Code once
```

**Heads-up for teams sharing a Claude account:** everyone on that account will see the same Slack connector's data. If that's not what you want, use **Option B** (each person their own token).

---

## Option B — Your own Slack token (full isolation)

Best for: teams sharing Claude seats · multiple Slack workspaces · maximum privacy.

### Step 1 — Create a Slack app

```
  api.slack.com/apps
      │
      ▼
  Create New App → From scratch
      │
      ▼
  Name:       Pickle (or anything you like — only you see this)
  Workspace:  [your Slack workspace]
      │
      ▼
  OAuth & Permissions (left sidebar)
```

### Step 2 — Add User Token Scopes

Pickle needs to read your messages *as you* (not as a bot) so it can see DMs. Add these **User Token Scopes**:

```
  channels:history      ← read public channels you're in
  groups:history        ← read private channels you're in
  im:history            ← read your DMs
  mpim:history          ← read your group DMs
  channels:read
  groups:read
  im:read
  mpim:read
  users:read            ← look up names
  chat:write            ← send DMs (with your confirmation)
  search:read           ← find mentions + DMs efficiently
  reminders:write       ← set Slack reminders
  lists:read            ← read Slack Lists (if your workspace has Lists enabled)
  lists:write           ← write entries to Slack Lists
```

### Step 3 — Install the app to your workspace

```
  OAuth & Permissions → "Install to Workspace"
      │
      ▼
  Slack asks you to approve
      │
      ▼
  Copy the "User OAuth Token"  →  xoxp-1234567890-...
```

> ⚠️ Keep this private — it has the same access as your Slack account. Treat it like a password.

### Step 4 — Connect to Claude Code

Paste into Claude Code:

```
Run the pickle-slack setup:
1. Ask me for my Slack User OAuth Token (starts with xoxp-)
2. Add it to ~/.claude.json under mcpServers using a Slack MCP server
   (for example: @modelcontextprotocol/server-slack or korotovsky/slack-mcp-server)
3. Verify the connection by listing channels I have access to
```

Claude writes the config automatically. Restart Claude Code once.

---

## Step 5 — Verify

```
What Slack channels am I in?
```

If Claude lists your channels → connected ✅.

---

## Step 6 — Run

```
/pickle-slack
```

---

## For teams

Same pattern as ClickUp — each teammate creates their own Slack app + token on their own machine:

```
  Teammate A         Teammate B         Teammate C
  xoxp-aaa           xoxp-bbb           xoxp-ccc
      │                  │                  │
      ▼                  ▼                  ▼
  Their inbox        Their inbox        Their inbox
  Their Pickle List  Their Pickle List  Their Pickle List
```

No shared state. No overlap.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `missing_scope` errors | Re-install the app after adding the missing scope |
| Pickle can't see DMs | Confirm `im:history` scope is added AND you re-installed |
| Pickle can't see a private channel | You must be a member of that channel |
| Slack Lists not found | Your workspace may not have Lists enabled — Pickle falls back to Canvas or DM-to-self automatically |
| Reminders not setting | Check `reminders:write` scope |
| Wrong workspace | You have multiple Slack workspaces — use Option B and create an app per workspace, swap tokens in `~/.claude.json` |

---

*Back to [main README](../README.md)*
