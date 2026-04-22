<div align="center">

# make-my-clickup

**Scan every ClickUp channel. Extract what needs you. Create tasks. Track follow-ups.**
**One command. Every morning.**

[![Version](https://img.shields.io/badge/version-1.5-blue?style=flat-square)](https://github.com/adityaarsharma/make-my-clickup)
[![Claude Code](https://img.shields.io/badge/runs%20in-Claude%20Code-orange?style=flat-square)](https://claude.ai/download)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Built by](https://img.shields.io/badge/built%20by-Aditya%20Sharma-purple?style=flat-square)](https://x.com/adityaarsharma)

</div>

---

## The Problem

Every morning you open ClickUp and face this:

```
300+ messages across 20 channels, DMs, group chats
    ├── Standups you don't need to read
    ├── Greetings and birthday wishes
    ├── FYIs and announcements
    ├── Completed updates from yesterday
    └── Buried somewhere in all of this...
            → The 10 things that actually need YOU
```

You skim everything manually. Miss things. Start the day reactive. People are waiting on your decision — you don't know who. You asked someone to do something 3 days ago — no update — you forgot to follow up.

---

## The Solution

```
/make-my-clickup
```

One command in Claude Code. It scans everything. Extracts only what needs your action. Creates prioritised tasks with full context. Tracks what you're waiting on from others.

```
/make-my-clickup              ← last 24 hours (default)
/make-my-clickup 7d           ← last 7 days
/make-my-clickup followup     ← scan + confirm follow-up reminders to send
/make-my-clickup 3d followup  ← combine both
```

---

## What It Does

### 📬 Inbox Scan
Reads every channel, DM, and group chat you follow. Flags messages where:

| Included ✅ | Skipped ❌ |
|------------|-----------|
| You're @mentioned and a reply is expected | Daily standups (1. Worked on… 2. Will work on…) |
| Someone is blocked waiting on your decision | Greetings, birthday wishes |
| You made a commitment that's still open | FYI-only announcements |
| A partner or release needs your response | Messages you already replied to |
| An urgent issue is in your domain | Mass @channel pings |

---

### ⏳ Follow-up Tracker

Smarter than just "did they reply?" — it understands what kind of reply they gave:

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
What did they say?  Flag as pending (no reply)
    │
    ├── "done ✓" / file / link sent   →  ✅ Resolved
    ├── "okay" / "will do" / "noted"  →  🔄 Acknowledged — not delivered yet
    └── deadline passed, nothing sent →  🔴 Overdue
```

Also detects:
- **Recurring patterns** — "give me daily updates" — flags if updates stopped
- **Deadline extraction** — "submit by Wednesday" — flags if Wednesday passed with nothing received
- **Escalation guard** — if you've followed up 2+ times, stops and tells you to talk directly

---

### 📋 Personal Task Board

Every action item lands in **your personal private space** — never in shared team spaces.

Each task has:
- 🔗 Direct link to the source message
- 💬 Exact quote from the conversation
- 🎯 Why it needs your action
- 📋 Step-by-step how to handle it
- 📅 Smart due date (not everything set to today)

---

## Priority System

| Priority | Triggered when |
|----------|---------------|
| 🔴 **Urgent** | CEO/founder flagged it · team blocked NOW · production issue · deadline today |
| 🟠 **High** | Multiple people waiting · release impact · overdue commitment · partner deal |
| 🟡 **Normal** | Peer request · this-week deadline · acknowledged but not delivered |
| ⚪ **Low** | Soft acknowledgement · no deadline · informational |

**Smart due dates** — based on urgency, not always today:

```
🔴 Urgent  →  Due today
🟠 High    →  Due tomorrow
🟡 Normal  →  Due end of this week
⚪ Low     →  Due next week
```

---

## Follow-up Confirmation Flow

When you run with `followup`, it never sends blindly. It shows you everything first:

```
📨 FOLLOW-UPS READY TO SEND

🔴 OVERDUE / ESCALATION NEEDED
  1. → Jordan · "Submit plugin docs" · 4 days ago · deadline was Wednesday ✗
     No reply received · 0 prior follow-ups sent

  2. → Sam · "Daily update" · last received 2 days ago (recurring stopped)
     ⚠ Already followed up once — recommend talking directly

🟡 PENDING / ACKNOWLEDGED NOT DELIVERED
  3. → Morgan · "Send banner sizes" · said "on it" · no file received yet

Which ones should I send reminders for?
Reply: "1, 3" or "all" or "none"
```

You confirm → it sends → it logs what was sent on the task.

---

## Sample Output

```
════════════════════════════════════════════════════
  make-my-clickup · by Aditya Sharma
  📅 15 Jan 2025 · ⏱ last 24 hours
════════════════════════════════════════════════════

📬 MY INBOX — Needs my action

  🔴 URGENT (1)
  • Submit plugin zip to marketplace — Alex / general

  🟠 HIGH (3)
  • Decide community platform for launch — Alex / DM
  • Clarify banner sizes before deadline — Morgan / design-team
  • Write product release announcement — self-commitment

  🟡 NORMAL (4)
  • Confirm affiliate account setup — Morgan / DM
  • Check blog cleanup task status — content-team
  • Follow up dev team on v6.4 marketing — devs-marketing
  • Review SEO gap analysis PDF — Jordan / DM

────────────────────────────────────────────────────

⏳ FOLLOW-UP TRACKER — Pending from others

  • Plugin setup docs → Jordan · 1 day · no reply
  • Pricing page update → Sam · 5 hours · said "will do", no delivery

────────────────────────────────────────────────────

📊 STATS
  Inbox tasks    : 8 created
  Follow-up tasks: 2 created
  Channels scanned: 11 channels · 9 DMs · 6 group DMs
  Messages reviewed: 284 · 47 in window · 10 actioned

🔗 Task board → https://app.clickup.com/your-workspace/

════════════════════════════════════════════════════
  Built and Shipped by Aditya Sharma
════════════════════════════════════════════════════
```

---

## Requirements

| | Requirement | Notes |
|--|-------------|-------|
| ✅ | **Claude Code** | [Download here](https://claude.ai/download) |
| ✅ | **ClickUp account** | Any plan — Free, Unlimited, Business |
| ✅ | **ClickUp API token** | Generated in ClickUp in 30 seconds — guide below |
| ✅ | **Node.js** | [nodejs.org](https://nodejs.org) — LTS version |

---

## Install

No terminal. No scripts. Paste this into Claude Code:

```
Install the make-my-clickup skill from https://github.com/adityaarsharma/make-my-clickup
Clone or download it into ~/.claude/skills/make-my-clickup/
```

Claude Code downloads and places the skill automatically.

**Restart Claude Code** → type `/make-my-clickup` → appears in autocomplete ✅

---

## Connect ClickUp

### Step 1 — Generate your API token (30 seconds)

```
ClickUp
  └── 👤 Your avatar  (bottom-left)
        └── ⚙️  Settings
              └── 🔧 Apps
                    └── 🔑 API Token → [ Generate ]
                                            │
                                            ▼
                               Copy  pk_xxxxxxxxxxxxxxxx
```

📖 Full visual guide: [docs/api-setup.md](docs/api-setup.md)

---

### Step 2 — Connect via Claude Code

Paste this into Claude Code:

```
Run the make-my-clickup setup:
1. Ask me for my ClickUp API token (starts with pk_)
2. Add it to ~/.claude.json under mcpServers using @taazkareem/clickup-mcp-server
3. Verify the connection works by listing my ClickUp workspaces
```

```
Claude asks for your pk_ token
          │
          ▼
You paste it
          │
          ▼
Claude writes ~/.claude.json automatically
          │
          ▼
Claude tests the connection
          │
          ▼
✅ Restart Claude Code once → you're live
```

---

### Step 3 — Verify

```
What spaces do I have in ClickUp?
```

If Claude lists your spaces → connected ✅

---

### Step 4 — Run

```
/make-my-clickup
```

---

## For Teams

Each teammate runs the same setup with their **own** ClickUp API token on their own machine:

```
Teammate A          Teammate B          Teammate C
pk_aaaaaa           pk_bbbbbb           pk_cccccc
    │                   │                   │
    ▼                   ▼                   ▼
Their inbox         Their inbox         Their inbox
Their tasks         Their tasks         Their tasks
Their board         Their board         Their board

No shared accounts. No overlap. Fully isolated.
```

---

## Customisation

**Task board** — auto-detects lists named `My Task Board`, `[Name]'s Task Board`, `Task Board`, `Daily Inbox`. Always created in your **personal private space**.

**Filters** — edit `SKILL.md` directly. All logic is plain English — no code to write.

**Priority rules** — adjust what counts as Urgent, High, Normal in Step 6.

**Team use** — each person installs on their own machine. Runs as their account. No interference.

📖 Full guide: [docs/customization.md](docs/customization.md)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Skill not in autocomplete | Restart Claude Code · check `~/.claude/skills/make-my-clickup/SKILL.md` exists |
| ClickUp not connecting | Make sure you copied the full `pk_` token · restart Claude Code |
| `npx: command not found` | Install Node.js from [nodejs.org](https://nodejs.org) |
| No action items found | Try a wider window: `/make-my-clickup 7d` |
| Wrong tasks being created | Edit skip rules in SKILL.md Step 5A |
| Follow-ups not detecting | ClickUp MCP needs full read access to channels and DMs |

---

## Contributing

PRs welcome. Open an issue for bugs or feature requests.

Built for the POSIMYTH team. Open-sourced for everyone.

---

<div align="center">

**Built and Shipped by [Aditya Sharma](https://github.com/adityaarsharma)**
POSIMYTH Innovation · [x.com/adityaarsharma](https://x.com/adityaarsharma)

MIT License — free to use, modify, and share

</div>
