# make-my-clickup

**Your ClickUp inbox, cleared. Every morning. One command.**

> Built and Shipped by [Aditya Sharma](https://x.com/adityaarsharma) · POSIMYTH Innovation

---

## The Problem

Every morning you open ClickUp and face this:

- 300+ messages across 20 channels, DMs, and group chats
- You don't know what actually needs **your** action vs what's just noise
- Standups, greetings, FYIs, and completed updates buried alongside real blockers
- People waiting on your decision — you don't know who
- You asked someone to do something 3 days ago — still no update — you forgot to follow up

You end up skimming everything manually, missing things, and starting your day reactive instead of focused.

---

## The Solution

`make-my-clickup` is a **Claude Code skill** that runs entirely inside Claude — no scripts, no setup, no API keys beyond connecting ClickUp once.

Type one command. It scans every channel, DM, and group chat you follow. Extracts only what needs **your** attention. Creates prioritised tasks in your personal board. And tracks everything you're waiting on from others — including flagging if a deadline passed or a recurring update stopped.

```
/make-my-clickup          ← last 24 hours (default)
/make-my-clickup 7d       ← last 7 days
/make-my-clickup followup ← scan + confirm which follow-ups to send
/make-my-clickup 3d followup
```

---

## What It Does

### 📬 Inbox Scan
Scans every channel, DM, and group DM you follow. Flags only messages where:
- You're @mentioned and a reply is expected
- Someone is blocked waiting on your decision or approval
- You made a commitment that's still open
- A partner, deal, or release needs your response
- An urgent issue is in your domain

Skips: standups, greetings, FYIs, completed items, mass @channel pings where anyone can reply.

### ⏳ Follow-up Tracker
Scans messages **you sent** to find work you delegated that hasn't been delivered. Smarter than just "did they reply?" — it distinguishes:

| Their reply | Status |
|------------|--------|
| "done ✓", "sent", "submitted", file/link received | ✅ Resolved |
| "okay", "will do", "on it", "noted" | 🔄 Acknowledged — not delivered yet |
| No reply | ❌ No response |
| Asked for daily updates, updates stopped | 🔁 Recurring stopped |
| Deadline passed, nothing received | 🔴 Overdue |
| You've followed up 2+ times | ⚠ Escalation needed |

### 📋 Personal Task Board
All action items land in **your personal private space** — never in a shared team space. Each task includes:
- Direct link to the source message
- Exact quote from the conversation
- Why it needs your action
- Step-by-step how to handle it
- Priority (🔴 Urgent / 🟠 High / 🟡 Normal / ⚪ Low)
- Smart due date based on urgency, not just "today"

### 🔍 100% Dynamic
No hardcoded channel IDs. Discovers every channel you follow in your workspace dynamically — works for any team, any workspace size, any plan.

---

## How Tasks Are Prioritised

| Priority | When |
|----------|------|
| 🔴 Urgent | CEO/founder flagged it, team blocked NOW, production issue, deadline today |
| 🟠 High | Multiple people waiting, release impact, overdue commitment, partner deal |
| 🟡 Normal | Peer request, this-week follow-up, acknowledged but not delivered |
| ⚪ Low | Soft acknowledgement, no deadline, informational |

Sender weight applied: messages from leadership score higher than peer pings.

**Smart due dates** — not everything set to today:
- URGENT → today
- HIGH → tomorrow
- NORMAL → end of this week
- LOW → next week

---

## Follow-up Intelligence

When you run `/make-my-clickup followup`, it finds everything pending and shows you a grouped confirmation list before sending anything:

```
📨 FOLLOW-UPS READY TO SEND

🔴 OVERDUE / ESCALATION NEEDED
  1. → Jordan · "Submit plugin docs" · 4 days ago · deadline was Wednesday ✗
     Status: No reply received

  2. → Sam · "Daily update" · last received 2 days ago (recurring stopped)
     ⚠ You've already followed up once. Recommend: talk directly.

🟡 PENDING / ACKNOWLEDGED NOT DELIVERED
  3. → Morgan · "Send banner sizes" · said "on it" but no file received

Which ones should I send reminders for?
Reply with numbers (e.g. "1, 3"), "all", or "none".
```

You confirm. It sends. It records what was sent in the ClickUp task.

---

## Requirements

| Requirement | Details |
|-------------|---------|
| **Claude Code** | Required — [get it here](https://claude.ai/download) |
| **ClickUp MCP** | Connect once at [claude.ai/settings/connectors](https://claude.ai/settings/connectors) |
| **ClickUp account** | Any plan (Free, Unlimited, Business) |
| **OS** | Mac, Linux, or Windows — install happens inside Claude Code |

---

## Install — Claude Code Only

No terminal. No scripts. Just paste this into Claude Code:

```
Install the make-my-clickup skill from https://github.com/adityaarsharma/make-my-clickup
Clone or download it into ~/.claude/skills/make-my-clickup/
```

Claude Code will handle the download and placement automatically.

Then **restart Claude Code** — type `/make-my-clickup` and it appears in autocomplete.

---

## Setup: Connect ClickUp MCP

The skill runs entirely through the ClickUp MCP connector. Set it up once.

### Step 1 — Open Claude AI Connectors

Go to [claude.ai/settings/connectors](https://claude.ai/settings/connectors)

Must be signed into the same Claude account you use with Claude Code.

### Step 2 — Add ClickUp

Click **"Add connector"** → search **ClickUp** → click **Connect**.

You'll be redirected to ClickUp's OAuth page. Log in and grant access to your workspace.

### Step 3 — Verify It's Working

In Claude Code, type:
```
What spaces do I have in ClickUp?
```
If Claude lists your spaces, the connector is live.

### Step 4 — Run

```
/make-my-clickup
```

> Full MCP setup guide: [docs/clickup-mcp-setup.md](docs/clickup-mcp-setup.md)

---

## Usage

```
/make-my-clickup              ← last 24 hours (default)
/make-my-clickup 48h          ← last 48 hours
/make-my-clickup 7d           ← last 7 days
/make-my-clickup 30d          ← last month
/make-my-clickup followup     ← scan + confirm follow-ups to send
/make-my-clickup 7d followup  ← 7-day scan + follow-ups
```

### Run as a Daily Routine

In Claude Code → **Routines** → **New Routine**:
- Name: `Morning ClickUp`
- Schedule: `Daily 8:00 AM`
- Prompt: `/make-my-clickup 24h`

---

## What Gets Filtered Out

The skill is strict about noise. It skips:

- **Daily standups** — "1. Worked on… 2. Will work on… 3. All clear" formats
- **Greetings** — Good morning, Happy Birthday, celebrations
- **FYI-only messages** — announcements with no ask
- **Your own messages** — unless they contain an unresolved commitment
- **Completed items** — Done ✓, Fixed, Released, Shipped
- **Mass @channel pings** — where anyone can respond (not specifically you)
- **Messages you already replied to** — no double-flagging

---

## Customisation

### Task board name
Auto-detects lists named: `My Task Board`, `[Name]'s Task Board`, `Task Board`, `Daily Inbox`, or `[Name] Task Board`. Always created in your **personal private space** — not a shared team space.

### Filters, priority rules, task format
Edit `SKILL.md` directly — all logic is plain English. No code.

### Team use
Each team member installs on their own machine. The skill runs as **their** ClickUp account. Tasks land in their own board, filtered to their own mentions and commitments. No interference between team members.

> Full customisation guide: [docs/customization.md](docs/customization.md)

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
  • Decide community platform for product launch — Alex / DM
  • Clarify banner sizes before print deadline — Morgan / design-team
  • Write product release announcement — self-commitment / Alex DM

  🟡 NORMAL (4)
  • Confirm affiliate account for creator partner — Morgan / DM
  • Check blog content cleanup task status — content-team
  • Follow up dev team on v6.4 release marketing — devs-marketing
  • Review SEO gap analysis PDF — Jordan / DM

────────────────────────────────────────────────────

⏳ FOLLOW-UP TRACKER — Pending from others

  • Plugin setup docs → waiting on Jordan · 1 day
  • Pricing page update → waiting on Sam · 5 hours (said "will do", no delivery)

────────────────────────────────────────────────────

📊 STATS
  Inbox tasks created  : 8
  Follow-up tasks      : 2
  Channels scanned     : 11 channels · 9 DMs · 6 group DMs
  Messages in window   : 284 scanned · 47 in range · 10 actioned

🔗 Task board → https://app.clickup.com/your-workspace/

════════════════════════════════════════════════════
  Re-run: /make-my-clickup [time]
  With follow-up: /make-my-clickup [time] followup
  Docs: https://github.com/adityaarsharma/make-my-clickup
────────────────────────────────────────────────────
  Built and Shipped by Aditya Sharma
════════════════════════════════════════════════════
```

---

## Troubleshooting

**"ClickUp MCP not connected"**
→ Go to [claude.ai/settings/connectors](https://claude.ai/settings/connectors) and connect ClickUp.

**Skill not showing in autocomplete**
→ Restart Claude Code. Check that `~/.claude/skills/make-my-clickup/SKILL.md` exists.

**"No action items found" but I know there are some**
→ Try a longer window: `/make-my-clickup 7d`
→ If specific messages are missed, the filter may be too strict — edit SKILL.md Step 5A skip rules.

**Tasks created for messages I didn't want**
→ Open SKILL.md → Step 5A → add patterns to the SKIP list.

**Follow-ups not detecting correctly**
→ The skill needs to see the thread replies. Make sure your ClickUp MCP connector has full read access to channels and DMs.

---

## Contributing

PRs welcome. Open an issue for bugs or feature requests.

Built for the POSIMYTH team. Open-sourced for everyone.

---

## License

MIT — free to use, modify, and share.

---

*Built and Shipped by [Aditya Sharma](https://github.com/adityaarsharma) · POSIMYTH Innovation*
