# 🥒 Pickle

> **In a pickle? Pickle sorts it.**
>
> Every morning, 200+ messages across ClickUp and Slack. Half are noise. A few are decisions waiting on you. Pickle reads everything, keeps the few that matter, and drops them in your personal task board — ranked by what YOU actually do.

Built by [Aditya Sharma](https://github.com/adityaarsharma). MIT licensed. Free forever. **v2.7.0**

---

## The problem

You wake up. Open ClickUp. Open Slack. 47 unread threads. You scan, skim, miss the one DM where a teammate's been waiting 2 days for your approval. By 11am, someone pings: *"any update on the thing I sent Monday?"*

The problem isn't you. Your attention is spread across channels, DMs, task comments, and threaded replies — and no single view tells you *"here's what needs you right now."*

## What Pickle does

**Mode A — Inbox** 📥 — Every message that needs your action:
- DMs and group DMs you're in (questions, approvals, decisions)
- Channel messages where you're @mentioned
- Task comments on tasks you own or watch
- Docs where someone tagged you
- Reminders others set for you

**Mode B — Follow-up Tracker** 🔁 — Every thread where someone owes YOU something:
- You asked → they said "will do" → 3 days of silence
- You asked for a file → they replied "sure" but never sent it
- You set a recurring ask → updates stopped after Tuesday

Pickle creates prioritised tasks in your private "Task Board - By Pickle", ranked by urgency and by what your role actually cares about. You go from 47 threads to 7 tasks.

## What makes Pickle different

### 🎯 Scored by YOUR role, not a generic rule
Pickle asks your role and one line about what you do day-to-day on first run. A manager sees approvals and blockers ranked higher; a team member sees their assigned tasks and pending replies. Role only reorders — it never filters anything out.

### 📬 Catches DMs that others miss
In a private DM or group DM that includes you, every unanswered question is yours — even if it's technically addressed to someone else in the thread. That's how work actually flows. Pickle knows this.

### 🌐 Reads intent, not just keywords
Teams write in whatever language is natural — and Pickle reads the *meaning*, not the exact phrase. "Can you confirm?", "please approve", and any local-language equivalent all register the same way.

### 🔔 Notifies you the moment a scan finishes
Each skill fires its own notification when done — ClickUp skills create a deadline task in your board, Slack skill sends a Slackbot reminder. No Business plan required. Nothing sent to any group or channel.

### 🚫 Never auto-sends
Every follow-up message is drafted, shown to you, and only sent after you say so. If you've already nudged someone twice, Pickle refuses to send a third — it suggests you talk to them directly.

### 🔒 Runs on your machine
No Pickle server exists. Your chat data never leaves your laptop.

### 💰 Free forever
Both supported paths are 100% free. No trial, no paid tier, no credit card.

---

## Two versions of Pickle

### 🧑‍💼 Pickle Manager
For team leads and managers.

| Command | What it does | Notification |
|---------|-------------|-------------|
| `/pickle-clickup [window]` | ClickUp inbox — what needs your action | ClickUp 🔔 task |
| `/pickle-slack [window]` | Slack inbox — same, from Slack | Slackbot reminder |
| `/pickle-clickup-team-report [channel] [window]` | Team performance pulse — commitment vs execution | ClickUp 🔔 task |
| `/pickle-update` | Update Pickle to the latest version | — |

### 👤 Pickle Team Member
For individual contributors.

| Command | What it does | Notification |
|---------|-------------|-------------|
| `/pickle-clickup [window]` | ClickUp inbox — what needs your action | ClickUp 🔔 task |
| `/pickle-slack [window]` | Slack inbox — if your team uses Slack | Slackbot reminder |
| `/pickle-update` | Update Pickle to the latest version | — |

**The only difference:** Managers get `/pickle-clickup-team-report`. Team members don't.

Both versions use the same private "Task Board - By Pickle". Each ecosystem stays completely isolated — ClickUp data never crosses into Slack and vice versa.

---

## Install

### 🧑‍💼 For managers and team leads

Run in your terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/adityaarsharma/pickle/main/install-manager.sh | bash
```

Installs: `/pickle-clickup` · `/pickle-slack` · `/pickle-clickup-team-report` · `/pickle-update`

Takes about 3 minutes. Connect ClickUp and/or Slack after install, then restart Claude Code. You're live.

### 👤 For team members

Run in your terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/adityaarsharma/pickle/main/install-team.sh | bash
```

Installs: `/pickle-clickup` · `/pickle-slack` · `/pickle-update`  
(No team report — that's managers only.)

Takes about 2 minutes. Connects ClickUp and optionally Slack.

> **Repo:** [github.com/adityaarsharma/pickle](https://github.com/adityaarsharma/pickle)

---

## Daily usage

**For managers:**
```
/pickle-clickup            # scan ClickUp last 24 hours
/pickle-clickup 7d         # last week
/pickle-clickup 24h followup   # scan + draft follow-up reminders

/pickle-slack              # same for Slack
/pickle-slack 7d

/pickle-clickup-team-report marketing-hq        # team pulse
/pickle-clickup-team-report engineering-hq 14d  # two-week view
```

**For team members:**
```
/pickle-clickup        # scan ClickUp inbox
/pickle-clickup 7d     # past week

/pickle-slack          # scan Slack inbox (if installed)
```

ClickUp data and Slack data stay completely separate — never mixed.

---

## Pickle Manager — Team Performance Reports

```
/pickle-clickup-team-report marketing-hq        # weekly report for the marketing team
/pickle-clickup-team-report engineering-hq 14d  # 2-week view for engineering
/pickle-clickup-team-report design-hq 7d        # design team pulse
```

Pickle Manager scans what your team said they'd do (ClickUp chat) vs what they actually tracked (task cards, time logs, comments). Per person: delivery rate, time efficiency, update compliance, channel presence. Posts a smart, non-offensive report back to the department channel. Flags underperformers to you directly.

**What it analyses:**
- 📋 Commitments made in chat → matched to real task completion
- 🕐 Time tracked vs estimated (per-task efficiency)
- 🧟 Zombie tasks — assigned but untouched for 5+ days
- 💬 Task documentation quality (descriptions, progress comments)
- 👻 Ghost mode — team members silent for 40%+ of the window
- 📉 Trends over time — is someone consistently slipping, or improving?

**Truly Done standard:** A task only counts as complete when ALL THREE are true — status closed + description filled + time tracked.

> **Scope:** ClickUp only. Requires ClickUp MCP connected.

---

## Update

```
/pickle-update
```

Auto-detects what you have, pulls the latest, tells you to Cmd+Q and reopen Claude Code. Your tokens, role, and task history stay untouched.

---

## How Pickle connects to ClickUp / Slack

Two free paths per ecosystem.

### 🔵 ClickUp

| Path | Best for | Setup |
|------|---------|-------|
| **Official Claude Connector** (recommended) | Personal Claude accounts | claude.ai → Settings → Connectors → ClickUp → Connect. 2 clicks. |
| **Pickle's own MCP** (personal token) | Shared Claude accounts | Paste your ClickUp API token. Free, MIT-licensed MCP runs locally. |

**Getting your ClickUp API token:**
1. Open [app.clickup.com/settings/apps](https://app.clickup.com/settings/apps)
2. Under "API Token" → click **Generate**
3. Copy the `pk_…` token and paste when prompted. Stays in `~/.claude.json` — never uploaded.

### 💬 Slack

| Path | Best for | Setup |
|------|---------|-------|
| **Official Claude Connector** (recommended) | Personal Claude accounts | claude.ai → Settings → Connectors → Slack → Connect. 2 clicks. |
| **Your own Slack App + User OAuth token** | Shared accounts or locked workspaces | Create a free Slack app, add scopes, paste the `xoxp-` token. |

**Getting your Slack User OAuth token:**
1. Open [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch
2. Name it "Pickle", pick your workspace
3. Left sidebar → **OAuth & Permissions** → **User Token Scopes**:
   ```
   channels:history   groups:history   im:history      mpim:history
   channels:read      groups:read      im:read         mpim:read
   users:read         chat:write       search:read     reminders:write
   lists:read         lists:write
   ```
4. **Install to Workspace** → copy the `xoxp-…` token → paste when prompted.

---

## Every surface covered

| Source | ClickUp | Slack |
|--------|---------|-------|
| Channels | ✅ | ✅ |
| Direct messages | ✅ | ✅ |
| Group DMs | ✅ | ✅ (mpim) |
| Task comments | ✅ | — |
| Threaded replies | ✅ | ✅ |
| Task descriptions / mentions | ✅ | — |
| Docs / canvas mentions | ✅ | — |
| Reminders | ✅ | ✅ |

---

## What Pickle will never do

- ❌ Auto-send any message without your confirmation
- ❌ Post in public channels or group DMs on your behalf
- ❌ Hide a message because your role "doesn't care" about it
- ❌ Send a third follow-up to someone you've already nudged twice
- ❌ Upload your chat data anywhere — it all stays on your machine

---

## Uninstall

```bash
rm -rf \
  ~/.claude/skills/pickle-clickup \
  ~/.claude/skills/pickle-slack \
  ~/.claude/skills/pickle-clickup-team-report \
  ~/.claude/skills/pickle-update \
  ~/.claude/pickle-mcp \
  ~/.claude/pickle
```

Then remove the `mcpServers.clickup` and/or `mcpServers.slack` blocks from `~/.claude.json`.

---

## Credits

Built by [Aditya Sharma](https://github.com/adityaarsharma). MIT licensed. Contributions welcome.
