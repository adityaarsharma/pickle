<div align="center">

# 🥒 Pickle

### *In a pickle? Pickle sorts it.*

**Scan every channel, DM, and group chat. Extract what needs YOU. Track what you're waiting on. One command.**

[![Version](https://img.shields.io/badge/version-2.0-blue?style=flat-square)](https://github.com/adityaarsharma/pickle)
[![Claude Code](https://img.shields.io/badge/runs%20in-Claude%20Code-orange?style=flat-square)](https://claude.ai/download)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Built by](https://img.shields.io/badge/built%20by-Aditya%20Sharma-purple?style=flat-square)](https://x.com/adityaarsharma)

**Two skills, two ecosystems, zero mixing.**
`/pickle-clickup`  ·  `/pickle-slack`

</div>

---

## The Problem

Every morning you open ClickUp. Then Slack. Then your head spins:

```
600+ messages across 30 channels, DMs, group chats
    ├── Standups you don't need to read
    ├── Greetings, GIFs, birthday wishes
    ├── FYIs and announcements
    ├── Completed updates from yesterday
    └── Buried somewhere in all of this...
            → The 15 things that actually need YOU
            → And the 8 things YOU asked people to do days ago
```

You skim it manually. Miss things. Start the day reactive. People are waiting on your decision — you don't know who. You asked someone something 3 days ago — no update — you forgot to follow up.

---

## The Fix — Pickle

```
/pickle-clickup             ← scan ClickUp, last 24h (default)
/pickle-clickup 7d
/pickle-clickup followup    ← confirm + send follow-up reminders

/pickle-slack               ← scan Slack, last 24h (default)
/pickle-slack 7d
/pickle-slack followup      ← confirm + send follow-up DMs
```

One command per ecosystem. **Slack and ClickUp never mix** — each has its own skill, its own task board, its own state. Targeting two ecosystems cleanly, without turning your inbox into a blender.

---

## What it does (for both)

### 📬 Inbox Scan
Reads every channel, DM, and group chat you're in. Flags messages where:

| Included ✅ | Skipped ❌ |
|------------|-----------|
| You're @mentioned and a reply is expected | Daily standups (1. Worked on… 2. Will work on…) |
| Someone is blocked waiting on your decision | Greetings, birthday wishes, GIFs, reactji-only |
| You made a commitment that's still open | FYI-only announcements |
| A partner/release/customer needs your response | Messages you already replied to |
| An urgent issue is in your domain | Mass @channel / @here pings |

### ⏳ Follow-up Tracker

Smarter than "did they reply?" — it knows the difference between *replied* and *delivered*:

```
You asked someone to do something
            │
            ▼
    Did they respond?
            │
    ┌───────┴────────┐
   YES              NO
    │                │
    ▼                ▼
What did they say?  → Flag as no_reply
    │
    ├── "done ✓" / file sent / link      →  ✅ Resolved
    ├── "okay" / "will do" / "noted"     →  🔄 Acknowledged — not delivered
    └── deadline passed, nothing sent    →  🔴 Overdue
```

Also detects:
- **Recurring patterns** — "give me daily updates" — flags if they stopped
- **Deadline extraction** — "submit by Wednesday" — flags if Wednesday passed
- **Escalation guard** — after 2+ follow-ups, stops and tells you to talk directly

### 🧠 Context Memory

```
Monday:     Pickle creates task "Reply to Alex"
Tuesday:    Alex still hasn't replied → Pickle sees message_id already actioned → SKIPS duplicate
Wednesday:  Alex finally replies → new event → Pickle surfaces the reply
```

Stored locally in `~/.claude/skills/pickle-*/state.json`. **IDs + timestamps only. No message text.** Delete the file to reset.

### 🔒 Always Confirm — Never Auto-Send
Pickle *never* sends a follow-up without showing you the exact list and waiting for you to pick which ones. Even with `followup` mode on.

```
📨 FOLLOW-UPS READY TO SEND

🔴 OVERDUE / ESCALATION NEEDED
  1. → Jordan · "Submit plugin docs" · 4 days ago · deadline was Wed ✗
  2. → Sam · "Daily update" · stopped 2 days ago
     ⚠ Already followed up once — recommend talking directly

🟡 PENDING / ACKNOWLEDGED NOT DELIVERED
  3. → Morgan · "Send banner sizes" · said "on it" · no file received

Which ones? Reply "1, 3" or "all" or "none".
```

You confirm → Pickle sends → logs what was sent. Items flagged for escalation are skipped even if you said "all".

---

## Where tasks land

### ClickUp — `/pickle-clickup`
Every item lands in your **personal private space** (never shared team spaces). A list called `My Task Board`, auto-assigned to you — so they automatically appear in your ClickUp **"My Tasks"** view + Home widget.

### Slack — `/pickle-slack`
Every item lands in a private **Slack List** called `Pickle Inbox` — using Slack's native task-database feature. Slack also sets a **reminder** for each item based on priority. If Lists aren't available in your workspace, Pickle falls back to a Canvas, then to DM-to-self.

Each entry has:
- 🔗 Direct link to the source message
- 💬 Exact quote from the conversation
- 🎯 Why it needs your action
- 📋 Step-by-step how to handle it
- 📅 Smart due date (not everything set to today)

---

## Priority System

| Priority | Triggered when | Due date |
|----------|---------------|----------|
| 🔴 **Urgent** | CEO/founder flagged · team blocked NOW · production issue · deadline today | Today |
| 🟠 **High** | Multiple people waiting · release impact · overdue commitment · partner deal | Tomorrow |
| 🟡 **Normal** | Peer request · this-week deadline · acknowledged but not delivered | End of this week |
| ⚪ **Low** | Soft acknowledgement · no deadline · informational | Next week |

---

## Install

**No terminal. No scripts. Paste this into Claude Code:**

```
Install Pickle from https://github.com/adityaarsharma/pickle

Clone the repo into ~/.claude/skills-src/pickle/
Then:
  1. Copy the pickle-clickup/ folder into ~/.claude/skills/pickle-clickup/
  2. Copy the pickle-slack/ folder into ~/.claude/skills/pickle-slack/

Tell me what's next after installation.
```

Claude Code handles the rest. **Restart Claude Code** → `/pickle-clickup` and `/pickle-slack` appear in autocomplete ✅.

You can install one or both — they're independent.

---

## Connect

### ClickUp

Two options — pick whichever fits:

```
  Option A                        Option B
  Official Claude connector       Your own API token
  (2 clicks, OAuth)               (full isolation)
       │                                │
       ▼                                ▼
  claude.ai →                     app.clickup.com →
  Settings →                      Avatar → Settings →
  Connectors →                    Apps →
  ClickUp → Connect               API Token → Generate
                                       │
                                       ▼
                                  Paste pk_xxx into
                                  Claude Code setup prompt
```

📖 Full guide: [docs/clickup-setup.md](docs/clickup-setup.md)

### Slack

Same pattern:

```
  Option A                        Option B
  Official Claude connector       Your own Slack app + user token
  (2 clicks, OAuth)               (full isolation, xoxp-...)
       │                                │
       ▼                                ▼
  claude.ai →                     api.slack.com/apps →
  Settings →                      Create App → add scopes →
  Connectors →                    Install to workspace →
  Slack → Connect                 Copy User OAuth Token
```

📖 Full guide: [docs/slack-setup.md](docs/slack-setup.md)

**⚠ Teams sharing one Claude account → use Option B on both.** OAuth connectors are tied to the Claude account, so one shared account = one shared inbox = mixed data. Personal tokens = full isolation per teammate.

---

## Run

```
/pickle-clickup              ← ClickUp, last 24h
/pickle-clickup 7d           ← ClickUp, last 7 days
/pickle-clickup followup     ← confirm + send follow-ups

/pickle-slack                ← Slack, last 24h
/pickle-slack 7d             ← Slack, last 7 days
/pickle-slack followup       ← confirm + send follow-up DMs
```

---

## Sample Output

### ClickUp
[See examples/clickup-output.md](examples/clickup-output.md)

### Slack
[See examples/slack-output.md](examples/slack-output.md)

---

## Security & Privacy

**Fully local. No Pickle server. No telemetry. Tokens stay on your disk.**

- Pickle runs inside your own Claude Code
- Slack data and ClickUp data are **never mixed**
- `state.json` stores only IDs and timestamps — **never message text**
- Follow-up DMs require explicit confirmation every time
- Pickle never posts in public channels on your behalf

📖 Full security doc: [docs/security.md](docs/security.md)

---

## For Teams

Each teammate installs Pickle on their own machine with their **own** tokens:

```
Teammate A                  Teammate B                  Teammate C
pk_aaaa / xoxp-aaa          pk_bbbb / xoxp-bbb          pk_cccc / xoxp-ccc
    │                           │                           │
    ▼                           ▼                           ▼
Their inboxes               Their inboxes               Their inboxes
Their ClickUp board         Their ClickUp board         Their ClickUp board
Their Slack List            Their Slack List            Their Slack List

No shared accounts. No overlap. Fully isolated.
```

---

## Customisation

All logic is plain English. Edit `SKILL.md` directly — no code.

- Skip/include rules → STEP 5A
- Priority rules → STEP 6
- Task format → STEP 8
- Default time window → STEP 0
- Custom list/board name → STEP 2

📖 Full guide: [docs/customisation.md](docs/customisation.md)

---

## Requirements

| | Requirement | Notes |
|--|-------------|-------|
| ✅ | **Claude Code** | [Download here](https://claude.ai/download) |
| ✅ | **ClickUp account** (for `/pickle-clickup`) | Any plan |
| ✅ | **Slack workspace** (for `/pickle-slack`) | You must be a member of the channels you want scanned |
| ✅ | **Node.js** | [nodejs.org](https://nodejs.org) — LTS |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Skills not in autocomplete | Restart Claude Code · confirm `~/.claude/skills/pickle-clickup/SKILL.md` + `~/.claude/skills/pickle-slack/SKILL.md` exist |
| ClickUp not connecting | Check `pk_` token is full · see [docs/clickup-setup.md](docs/clickup-setup.md) |
| Slack not connecting | Verify all required scopes added · re-install the Slack app · see [docs/slack-setup.md](docs/slack-setup.md) |
| `missing_scope` on Slack | Add the scope at api.slack.com/apps → re-install |
| No items found | Try a wider window: `/pickle-clickup 7d` |
| Wrong items surfacing | Edit skip/include rules in `SKILL.md` Step 5A |
| Pickle skipping too much | Delete `~/.claude/skills/pickle-*/state.json` to reset memory |
| Can't see DMs (Slack) | Confirm `im:history` scope added |

---

## Roadmap

- ✅ v1.x — make-my-clickup (ClickUp only)
- ✅ v2.0 — Pickle: ClickUp + Slack, dual-path auth, context memory, escalation guard
- 🔜 v2.1 — Meeting prep mode (`/pickle-clickup prep jordan`)
- 🔜 v2.2 — Weekly review format
- 🔜 v2.3 — Scheduled runs via Claude Code Routines (template commands shipped)

---

## Contributing

PRs welcome. Open an issue for bugs or feature requests.

**MIT licensed.** Pickle is free. Will stay free.

---

<div align="center">

**Built and Shipped by [Aditya Sharma](https://github.com/adityaarsharma)**
[x.com/adityaarsharma](https://x.com/adityaarsharma)

*In a pickle? Pickle sorts it.* 🥒

</div>
