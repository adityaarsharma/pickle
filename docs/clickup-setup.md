# ClickUp Setup

> Part of [Pickle](https://github.com/adityaarsharma/pickle) · Built by [Aditya Sharma](https://github.com/adityaarsharma)

Two ways to connect ClickUp. Pick one.

---

## Option A — Official Claude connector (easiest)

Best for: solo users, fastest path (2 clicks).

```
  claude.ai
      │
      ▼
  Settings → Connectors
      │
      ▼
  Find "ClickUp" → Connect
      │
      ▼
  Sign in to ClickUp, approve
      │
      ▼
  ✅ Done — restart Claude Code once
```

**Heads-up for teams sharing a Claude account:** everyone on that account will see the same ClickUp connector (i.e. the same user's inbox). If that's not what you want, use **Option B**.

---

## Option B — Your own ClickUp API token (full isolation)

Best for: teams sharing Claude seats · personal + work ClickUp accounts · maximum control.

### Step 1 — Generate your API token (30 seconds)

**Fastest path — open this URL while logged in:**

👉 **[app.clickup.com/settings/apps](https://app.clickup.com/settings/apps)**

That's the page. Find the **API Token** section → click **Generate** (or **Regenerate**). Copy the token — starts with `pk_`.

**Manual path (if the link above doesn't work for you):**

**1 →** Open [app.clickup.com](https://app.clickup.com)
**2 →** Click your avatar — **top-right corner**
**3 →** Click **Settings**
**4 →** In the left sidebar, click **Apps** *(in some ClickUp versions this is labelled **Integrations** — same page)*
**5 →** Find the **API Token** section → click **Generate**
**6 →** Copy the token — starts with `pk_`

> ⚠️ Keep this private. It has full access to your ClickUp account.

---

### Step 2 — Connect to Claude Code

Paste into Claude Code:

```
Run the pickle-clickup setup:
1. Ask me for my ClickUp API token (starts with pk_)
2. Add it to ~/.claude.json under mcpServers using @taazkareem/clickup-mcp-server
3. Verify the connection by listing my ClickUp workspaces
```

```
You paste prompt
       │
       ▼
Claude asks for your pk_ token
       │
       ▼
You paste your token
       │
       ▼
Claude writes ~/.claude.json automatically
       │
       ▼
Claude tests the connection
       │
       ▼
✅ Connected — restart Claude Code once
       │
       ▼
/pickle-clickup  ←── you're live
```

---

### Step 3 — Verify

```
What ClickUp spaces do I have?
```

If Claude lists your spaces → connected ✅.

---

### Step 4 — Run

```
/pickle-clickup
```

---

## For teams

Same pattern — each teammate generates their own `pk_` on their own machine:

```
Teammate A          Teammate B          Teammate C
pk_aaaaaa           pk_bbbbbb           pk_cccccc
    │                   │                   │
    ▼                   ▼                   ▼
Their inbox         Their inbox         Their inbox
Their Pickle board  Their Pickle board  Their Pickle board
```

No shared accounts. No overlap. Full isolation.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `npx: command not found` | Install Node.js from [nodejs.org](https://nodejs.org) (LTS) |
| Token not accepted | Copy the full `pk_` token · restart Claude Code |
| ClickUp not showing after setup | Fully quit and reopen Claude Code |
| Wrong ClickUp account connected | Replace token in `~/.claude.json` → restart |
| "My Tasks" view empty | Task board only populates on first run of `/pickle-clickup` |

---

*Back to [main README](../README.md)*
