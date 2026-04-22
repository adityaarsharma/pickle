<div align="center">

# 🥒 Pickle

### *In a pickle? Pickle sorts it.*

**Every morning, 600 messages. 15 actually need you. Pickle finds them.**
**100% free. Runs locally. No server, no subscription, no license keys.**

[![Version](https://img.shields.io/badge/version-1.0-blue?style=flat-square)](https://github.com/adityaarsharma/pickle)
[![Claude Code](https://img.shields.io/badge/runs%20in-Claude%20Code-orange?style=flat-square)](https://claude.ai/download)
[![Built by](https://img.shields.io/badge/built%20by-Aditya%20Sharma-purple?style=flat-square)](https://x.com/adityaarsharma)

`/pickle-clickup`  ·  `/pickle-slack`
**Two ecosystems. Never mixed. One command each.**

</div>

---

## The 7-minute problem

It's 9am. You open Slack. Then ClickUp. Then your head spins.

> 600+ messages across 30 channels, DMs, task comments, group chats.
> You skim. You miss things. Someone is blocked on a decision you didn't see.
> You followed up on something 3 days ago — no reply — you forgot to chase it.
> You start the day reactive, not in control.

You already know the feeling. Pickle is the fix.

---

## The 30-second answer

One command. Pickle scans everything, ignores the noise, hands you a clean list of what needs YOU and what people owe YOU. Tasks land in your own private board. Nothing auto-sends. Nothing leaves your machine.

```
  /pickle-clickup              → scan ClickUp, last 24h
  /pickle-clickup followup     → confirm + send reminders

  /pickle-slack                → scan Slack, last 24h
  /pickle-slack followup       → confirm + send DM reminders
```

That's it. No dashboards. No subscriptions. No "sign up with Google."

---

## What Pickle actually does

**📬 It reads everything — then ignores 95% of it.**
Channels, DMs, group chats, task comments, replies in threads. A smart filter strips out standups, greetings, GIFs, FYIs, dead channels, bot noise. You're left with:

- Messages where you're @mentioned and a reply is expected
- People blocked on your decision
- Commitments you made that are still open
- Urgent issues in your domain
- Things you asked others to do — that never got delivered

**⏳ It knows the difference between *replied* and *delivered*.**
Someone says "on it" but never sends the file? Pickle flags it. Deadline passed with nothing shipped? Pickle flags it. You followed up twice already? Pickle stops and tells you to talk directly.

**🧠 It remembers — privately.**
Monday it catches "Reply to Alex". Tuesday Alex still hasn't replied — Pickle skips the duplicate. Wednesday Alex finally answers — Pickle surfaces the new reply. All stored locally. IDs + timestamps only. No message text ever saved.

**🔒 It never auto-sends.**
Even in `followup` mode, Pickle shows you the list and waits for you to pick `1, 3` or `all` or `none`. Items flagged for escalation are skipped even if you say "all."

---

## Where the tasks land

Pickle writes into your own workspace — not some third-party dashboard:

- **ClickUp** → a private list called `My Task Board` in your personal space, auto-assigned to you. Appears in **My Tasks** + Home widget.
- **Slack** → a native Slack List called `Pickle Inbox` with a reminder set per priority. Falls back to Canvas, then DM-to-self.

Every entry has: direct link to the source message, exact quote, why it needs you, how to handle it, a smart due date (not everything dumped onto today).

---

## Install — one line

Paste this into Claude Code:

```
Install Pickle from https://github.com/adityaarsharma/pickle — clone the repo,
then copy every folder inside (pickle-setup, pickle-clickup, pickle-slack,
pickle-mcp) into ~/.claude/skills/. Then run /pickle-setup.
```

Claude Code does the copy. The wizard handles everything else — asks your name, asks Slack/ClickUp/both, walks you through connecting, verifies, asks your preferences, runs one restart only when actually needed, and tells you exactly what to run next. ~3 minutes.

**100% free.** Pickle ships its own open-source ClickUp MCP (`pickle-mcp/clickup/`) — no paid dependencies, no license keys, no rate limits. Slack uses the official free OAuth connector or your own free Slack app — your choice.

---

## Why Pickle (and not the other 40 inbox tools)

Most inbox tools are SaaS. You sign up. You hand over OAuth to some server you don't control. You pay monthly. You trust a vendor with every message.

Pickle is the opposite:

- **Runs inside Claude Code on your machine.** No Pickle server exists. There's nothing to sign up for.
- **Your tokens stay on your disk.** In `~/.claude.json`. Never transmitted anywhere except Slack / ClickUp themselves.
- **Slack and ClickUp never mix.** Two separate skills, two separate state files, two separate task boards. Targeting two ecosystems cleanly.
- **No telemetry. No tracking. No analytics.** There's no one to send it to.
- **Every rule is plain English.** Open `SKILL.md`, read the logic, change it. No code.

If you share a Claude account with your team, each teammate uses their own API token. Full isolation per person — no overlap, no shared inbox.

---

## Priority — so not everything screams "today"

| 🔴 Urgent | 🟠 High | 🟡 Normal | ⚪ Low |
|:-:|:-:|:-:|:-:|
| Blocked now · founder flagged · prod issue | Multiple people waiting · release impact · overdue | Peer request · this-week deadline | Soft ack · no deadline · informational |
| Due **today** | Due **tomorrow** | Due **end of week** | Due **next week** |

---

## A real sample

```
🔴 OVERDUE / ESCALATION NEEDED
  1. → Jordan · "Submit plugin docs" · 4 days ago · deadline was Wed ✗
  2. → Sam · "Daily update" · stopped 2 days ago
     ⚠ Already followed up once — recommend talking directly

🟡 PENDING / ACKNOWLEDGED NOT DELIVERED
  3. → Morgan · "Send banner sizes" · said "on it" · no file received

Which ones? Reply "1, 3" or "all" or "none".
```

You confirm. Pickle sends. Logs what went out. Done.

Full samples: [ClickUp output](examples/clickup-output.md) · [Slack output](examples/slack-output.md)

---

## Security & privacy

Pickle never leaves your machine. No server. No telemetry. Tokens stay in `~/.claude.json`. State file stores IDs + timestamps only — never message text. Delete it any time to reset.

📖 Full doc: [docs/security.md](docs/security.md)

---

## Customise anything

Every rule is plain English inside `SKILL.md`. Skip/include rules, priority logic, task format, default window, board names — edit the file, save, done. No code.

📖 Full guide: [docs/customisation.md](docs/customisation.md)

---

## Requirements

- **Claude Code** — [claude.ai/download](https://claude.ai/download)
- **ClickUp account** (for `/pickle-clickup`) — any plan
- **Slack workspace** (for `/pickle-slack`) — you must be a member of the channels you want scanned
- **Node.js LTS** — [nodejs.org](https://nodejs.org)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Skills not in autocomplete | Restart Claude Code |
| Connection failing | Re-run `/pickle-setup` — it walks you through fixes |
| No items found | Try a wider window: `/pickle-clickup 7d` |
| Wrong items surfacing | Edit skip/include rules in `SKILL.md` Step 5A |
| Pickle skipping too much | `rm ~/.claude/skills/pickle-*/state.json` to reset memory |

---

## Contributing

PRs welcome. Bugs, feature requests → open an issue. Pickle runs entirely on your own machine — no hosted server, no telemetry, no lock-in.

---

<div align="center">

**Built and shipped by [Aditya Sharma](https://github.com/adityaarsharma)**
[x.com/adityaarsharma](https://x.com/adityaarsharma)

*In a pickle? Pickle sorts it.* 🥒

</div>
