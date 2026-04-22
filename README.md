# make-my-clickup

**Your ClickUp inbox, cleared. Every morning. One command.**

> Built by [Aditya Sharma](https://x.com/adityaarsharma) · POSIMYTH Innovation

`make-my-clickup` is a Claude Code skill that scans every ClickUp channel, DM, and group chat you follow — extracts **only what needs your attention** — creates prioritised tasks in your personal task board, and tracks work you assigned to others so nothing falls through.

```
/make-my-clickup          ← last 24 hours (default)
/make-my-clickup 7d       ← last 7 days
/make-my-clickup followup ← scan + auto-send follow-ups
/make-my-clickup 3d followup
```

---

## What it does

### 📬 Inbox Mode
Scans all channels, DMs, and group DMs you follow. Finds messages where:
- You're @mentioned and a reply is needed
- Someone is blocked waiting on you
- You made a commitment that's still open
- A partner/deal needs your response
- An urgent issue is in your domain

Skips: standups, greetings, FYIs, birthday messages, completed items.

### ⏳ Follow-up Mode
Finds messages where **you** assigned work to someone else — and checks if they replied. If not → creates a "Pending from [name]" task. Add `followup` to auto-send a reminder in the original thread.

### 📋 Task Board
All action items land in your personal task board with:
- Source link → direct to the message
- Exact quote from the conversation
- Why it needs your action
- Step-by-step how to handle it
- Priority (🔴 Urgent / 🟠 High / 🟡 Normal / ⚪ Low)

### 🔍 100% Dynamic
No hardcoded channel IDs. Discovers every channel you follow in your ClickUp workspace dynamically — works for any team, any workspace size.

---

## Requirements

| Requirement | Details |
|-------------|---------|
| **Claude Code** | Any version — [install here](https://code.claude.com) |
| **ClickUp MCP** | Connect at [claude.ai/settings/connectors](https://claude.ai/settings/connectors) |
| **ClickUp account** | Any plan (Free, Unlimited, Business) |
| **OS** | Mac, Linux, or Windows |

> **This skill works inside Claude Code only.** It uses the ClickUp MCP connector — no API keys, no scripts, no separate setup beyond connecting ClickUp once.

---

## Install

### Mac / Linux (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/adityaarsharma/make-my-clickup/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/adityaarsharma/make-my-clickup/main/install.ps1 | iex
```

### Manual (any OS)

```bash
git clone https://github.com/adityaarsharma/make-my-clickup.git ~/.claude/skills/make-my-clickup
```

Or without git:
1. Download the ZIP from GitHub → **Code → Download ZIP**
2. Extract the folder
3. Move it to `~/.claude/skills/make-my-clickup/` (Mac/Linux) or `%USERPROFILE%\.claude\skills\make-my-clickup\` (Windows)

After install, **restart Claude Code** and type `/make-my-clickup` to verify it appears in autocomplete.

---

## Setup: Connect ClickUp MCP

The skill needs ClickUp's MCP connector. Set it up once — it works forever.

### Step 1 — Open Claude AI connectors

Go to [claude.ai/settings/connectors](https://claude.ai/settings/connectors)

### Step 2 — Add ClickUp

Click **"Add connector"** → search for **ClickUp** → click **Connect**.

You'll be redirected to ClickUp's OAuth page. Log in and grant access.

### Step 3 — Verify

Open Claude Code and type:
```
What's in my ClickUp workspace?
```
If Claude can list your spaces and tasks, the connector is working.

### Step 4 — Run the skill

```
/make-my-clickup
```

> **Full MCP setup guide:** [docs/clickup-mcp-setup.md](docs/clickup-mcp-setup.md)

---

## Usage

### Basic scan (last 24 hours)
```
/make-my-clickup
```

### Custom time window
```
/make-my-clickup 48h     ← last 48 hours
/make-my-clickup 7d      ← last 7 days
/make-my-clickup 30d     ← last month
```

### Follow-up mode (auto-sends reminders)
```
/make-my-clickup followup
/make-my-clickup 7d followup
```
With `followup`, the skill sends a gentle reminder in the original thread for any work you assigned that hasn't been acknowledged. It won't send the same follow-up twice.

### Set as a daily routine (Claude Code)
In Claude Code → **Routines** → **New Routine**:
- Name: `Morning ClickUp`
- Schedule: `Daily 8:00 AM`
- Prompt: `/make-my-clickup 24h`

---

## How tasks are prioritised

| Priority | When |
|----------|------|
| 🔴 Urgent | CEO/founder flagged it, team blocked NOW, production issue, deadline today |
| 🟠 High | Multiple people waiting, release impact, overdue commitment, partner deal |
| 🟡 Normal | Peer request, task assigned to you, this-week follow-up |
| ⚪ Low | Soft acknowledgement, no deadline, informational |

Sender weight is applied: messages from leadership score higher than peer pings.

---

## What gets filtered out

The skill is strict about noise. It skips:

- **Daily standups** — "1. Worked on… 2. Will work on… 3. All clear" formats
- **Greetings** — Good morning, Happy Birthday, celebrations
- **FYI-only messages** — announcements with no ask
- **Your own messages** — unless they're unresolved commitments
- **Completed items** — Done ✓, Fixed, Released, Shipped
- **Mass @channel pings** — where anyone can respond (not specifically you)

---

## Output example

```
════════════════════════════════════════════════════
  make-my-clickup · by Aditya Sharma
  📅 22 Apr 2026 · ⏱ last 24 hours
════════════════════════════════════════════════════

📬 MY INBOX — Needs my action

  🔴 URGENT (1)
  • Build Orbit zip and submit to WordPress.org — Sagar / general

  🟠 HIGH (3)
  • Decide SproutOS community platform — Sagar / DM
  • Clarify image sizes for Rishita — Chaitali / office-team
  • Write Orbit release announcement — self-commitment / Sagar DM

  🟡 NORMAL (4)
  • Confirm Bengali YouTuber affiliate — Chaitali / DM
  • Check POSIMYTH Space blog cleanup — seo-content-marketing
  • Follow up Ananda + Yash on Orbit setup — seo-content-marketing
  • TPAE 6.4.13 release — marketing coverage needed

────────────────────────────────────────────────────

⏳ FOLLOW-UP TRACKER — Pending from others

  • Orbit setup → waiting on Ananda · 1 day · [thread]
  • Pricing page revert → waiting on Yash · 0 days · [thread]

────────────────────────────────────────────────────

📊 STATS
  Inbox tasks    : 8 created
  Follow-up tasks: 2 created
  Channels scanned: 11 channels · 9 DMs · 6 group DMs
  Messages in window: 284 · 47 in range · 10 actioned

🔗 Task board → https://app.clickup.com/9016694417/
════════════════════════════════════════════════════
```

---

## Customisation

### Change your task board name

The skill auto-detects lists named: `My Task Board`, `[Name]'s Task Board`, `Task Board`, `Daily Inbox`, or `[Name] Task Board`. Create any list with one of these names and it'll be used automatically.

### Adjust filters

Edit `SKILL.md` directly — the filter logic is in Step 5A and 5B. The format is plain English, easy to tweak.

### Team use

Each team member installs the skill on their own machine. The skill runs as **their** ClickUp account — tasks land in their own task board, filtered to their own mentions and commitments.

> **Full customisation guide:** [docs/customization.md](docs/customization.md)

---

## Troubleshooting

**"ClickUp MCP not connected"**
→ Go to [claude.ai/settings/connectors](https://claude.ai/settings/connectors) and connect ClickUp.

**Skill not showing in autocomplete**
→ Restart Claude Code. Check that `~/.claude/skills/make-my-clickup/SKILL.md` exists.

**"No action items found" but I know there are some**
→ The time window may be too short. Try `/make-my-clickup 7d`.
→ If specific messages are missed, the filter may be too strict — open an issue with an example.

**Tasks created for messages I didn't want**
→ The filter is configurable. Open `SKILL.md` and edit the SKIP rules in Step 5A.

---

## Contributing

PRs welcome. Open an issue for bugs or feature requests.

Built for the POSIMYTH team. Open-sourced for everyone.

---

## License

MIT — free to use, modify, and share.

---

*Made by [Aditya Sharma](https://github.com/adityaarsharma) · POSIMYTH Innovation*
