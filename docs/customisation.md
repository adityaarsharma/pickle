# Customisation Guide

> Part of [Pickle](https://github.com/adityaarsharma/pickle) · Built by [Aditya Sharma](https://github.com/adityaarsharma)

Pickle is plain Markdown — everything is editable. Open either:
- `~/.claude/skills/pickle-clickup/SKILL.md`
- `~/.claude/skills/pickle-slack/SKILL.md`

in any text editor. Changes take effect on the next `/pickle-clickup` or `/pickle-slack` run.

---

## Change the default time window

In either `SKILL.md`, find **STEP 0 — PARSE ARGUMENTS** and change:
```
If empty, default to `24h`.
```
to e.g. `7d`.

---

## Change your task-board / list name

### ClickUp
The skill looks for lists named:
- `My Task Board`
- `[MY_NAME]'s Task Board`
- `Task Board`
- `Daily Inbox`
- `[MY_NAME] Task Board`
- `Pickle`

**Where does it create the task board?**
Always in your **personal/private space** — never a shared company/team space. It finds personal spaces by either (a) spaces where only you are a member, or (b) spaces named "Private", "Personal", or matching your name. If none exist, it creates a new private space called `Personal` first.

Add a custom name in **STEP 2** of `pickle-clickup/SKILL.md`.

### Slack
The skill looks for a Slack List named:
- `Pickle Inbox`
- `My Pickle`

If Lists aren't available in your workspace, it falls back to a private Canvas called `Pickle Inbox`, then to DM-to-self as last resort.

---

## Add custom skip / include rules

In **STEP 5A**:
- `❌ SKIP unconditionally` — add patterns you want filtered out
- `✅ INCLUDE if ANY of these are true` — add patterns that should always surface

Example additions:
```
- Messages from bots (user starts with "B" or subtype is "bot_message")
- Messages in channels named "random" or "fun"
- Invoice / payment mentions containing my name
```

---

## Adjust priority scoring

In **STEP 6**, edit the urgency + importance rules directly:

```markdown
### 🔴 URGENT
- Sender is CEO / founder / direct manager AND language is time-sensitive
- Team is currently blocked
- Production issue AND I'm responsible
- Deadline today/tomorrow
- [ADD YOUR OWN]: VIP customer mention
```

---

## Change task / list entry format

In **STEP 8**, the description templates are editable. Add fields you care about:
```
🏷 Project: [infer from channel name]
💰 Revenue impact: [high/medium/low]
🎯 OKR link: [relevant OKR]
```

---

## Confirm-before-send is mandatory

The `followup` mode never auto-sends. That's a hard rule baked into **STEP 5C**. If you edit it to auto-send, you're on your own — Pickle's design is "always confirm".

---

## Reset memory

If Pickle starts skipping too much (memory got out of sync with reality):
```
rm ~/.claude/skills/pickle-clickup/state.json
rm ~/.claude/skills/pickle-slack/state.json
```
Next run rebuilds from scratch. Nothing else breaks.

---

## Run on a schedule

Claude Code Routines:

**Morning ClickUp scan**
- Schedule: `Daily 8:00 AM`
- Prompt: `/pickle-clickup 24h`

**Morning Slack scan**
- Schedule: `Daily 8:15 AM`
- Prompt: `/pickle-slack 24h`

**Weekly review**
- Schedule: `Every Monday 9:00 AM`
- Prompt: `/pickle-clickup 7d` then `/pickle-slack 7d`

---

*Back to [main README](../README.md)*
