# Customisation Guide

> Part of [make-my-clickup](https://github.com/adityaarsharma/make-my-clickup) by Aditya Sharma

The skill is plain Markdown — everything is editable. Open `~/.claude/skills/make-my-clickup/SKILL.md` in any text editor.

---

## Change the default time window

In `SKILL.md`, find **STEP 0 — PARSE ARGUMENTS**.

Change the default from `24h` to any value:
```
If empty, default to `7d`.
```

---

## Change your task board name

The skill looks for lists named:
- `My Task Board`
- `[MY_NAME]'s Task Board`
- `Task Board`
- `Daily Inbox`
- `[MY_NAME] Task Board`

**Where does it create the task board?**
Always in your **personal/private space** — never inside a shared company or team space. It identifies personal spaces by finding spaces where only you are a member. If none exist, it creates a new private space called `Personal` first.

If you already have a list with one of the names above inside a personal space, it will use that automatically.

To use a custom name, add it to the list in **STEP 2**:
```
Search personal spaces for a list named "My Task Board" or "[MY_NAME]'s Task Board"
or "Task Board" or "Daily Inbox" or "[MY_NAME] Task Board" or "YOUR CUSTOM NAME HERE".
```

---

## Add custom skip rules

In **STEP 5A**, under `❌ SKIP unconditionally`, add your own patterns:

```
- Messages from bots (user_id is "-1" or username contains "bot")
- Messages in channels named "random" or "fun"
- Messages containing only links with no surrounding text
```

---

## Add custom include rules

In **STEP 5A**, under `✅ INCLUDE if ANY of these are true`, add your own:

```
7. **Invoice / payment mentions** — message contains "invoice", "payment", "pay" AND my name or company
8. **Legal / contract** — message contains "contract", "sign", "agreement" AND directed at me
```

---

## Adjust priority scoring

In **STEP 6**, the priority tiers are plain English — edit them:

```markdown
### 🔴 URGENT
- Sender is CEO / founder / direct manager AND language is time-sensitive
- Team is currently blocked and cannot proceed without user
- Production issue / security bug AND user is responsible
- Deadline is today or tomorrow
- [ADD YOUR OWN]: Any message from a VIP client
```

---

## Change task format

In **STEP 8**, the task description template is editable. Add your own fields:

```markdown
description:
  📍 SOURCE
  From: [who] | In: [channel]
  Link: [message URL]

  💬 WHAT THEY SAID
  "[quote]"

  🎯 ACTION NEEDED
  [context]

  📋 STEPS
  • [step 1]
  • [step 2]

  🏷 Project: [infer project from channel name]   ← add this
  💰 Revenue impact: [high/medium/low]             ← add this
```

---

## Disable follow-up auto-send by default

In **STEP 5C**, change:
```
If FOLLOWUP_MODE = true
```
to require explicit confirmation before sending each message — or disable it entirely and always just create tasks.

---

## Run on a schedule

Set up a daily routine in Claude Code:

1. Open Claude Code
2. Go to **Routines** → **New Routine**
3. Name: `Morning ClickUp`
4. Schedule: `Daily 8:00 AM`
5. Prompt: `/make-my-clickup 24h`

Or weekly review:
- Schedule: `Every Monday 9:00 AM`
- Prompt: `/make-my-clickup 7d`

---

*Back to [main README](../README.md)*
