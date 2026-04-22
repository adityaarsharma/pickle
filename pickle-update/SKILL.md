---
name: pickle-update
description: Update Pickle to the latest version. Auto-detects what you have installed (ClickUp, Slack, or both) and only updates those. Keeps your prefs, tokens, and task history untouched. Usage: /pickle-update. Use whenever the user asks to "update pickle", "upgrade pickle", "get the latest pickle", "pull new pickle", "refresh pickle", or sees a new release on the Pickle GitHub.
argument-hint: (no arguments — just run it)
disable-model-invocation: true
---

# 🥒 pickle-update — One-command updater

> Part of [Pickle](https://github.com/adityaarsharma/pickle) · Built by [Aditya Sharma](https://github.com/adityaarsharma)

You are the **pickle-update** agent. Your only job: pull the latest Pickle from GitHub, refresh whatever's installed on this machine, and tell the user what changed. No prompts, no questions, no preferences touched.

---

## STEP 1 — Announce what's about to happen

Print exactly this:

```
════════════════════════════════════════════════════
  🥒 Pickle — updating to latest
════════════════════════════════════════════════════

I'll pull the latest from github.com/adityaarsharma/pickle and
refresh only the skills you already have. Nothing new gets
installed. Your prefs, tokens, and task history stay untouched.

Takes ~30-60 seconds.
```

---

## STEP 2 — Check if the updater script exists

Run:

```bash
test -x ~/.claude/pickle-mcp/update.sh && echo "local_updater_exists" || echo "need_remote_updater"
```

- If output is `local_updater_exists` → go to Step 3A.
- Otherwise → go to Step 3B.

---

## STEP 3A — Run the local updater

The user installed via the personal-token path, so `~/.claude/pickle-mcp/update.sh` is on disk. Use it:

```bash
bash ~/.claude/pickle-mcp/update.sh
```

Pass the output through to the user. The script self-prints version numbers, progress, and final success.

---

## STEP 3B — Run the universal updater

The user is on the OAuth connector path (no local MCP). Fetch and run the universal updater directly from the repo:

```bash
curl -fsSL https://raw.githubusercontent.com/adityaarsharma/pickle/main/update.sh | bash
```

If `curl` isn't available, fall back to `wget`:

```bash
wget -qO- https://raw.githubusercontent.com/adityaarsharma/pickle/main/update.sh | bash
```

If both fail → tell the user exactly:

```
❌ Couldn't reach GitHub to fetch the updater.

Check your internet connection and try again. If you're behind a
corporate proxy, you can also clone the repo manually:

  git clone https://github.com/adityaarsharma/pickle.git
  cp -R pickle/pickle-clickup ~/.claude/skills/
  cp -R pickle/pickle-setup ~/.claude/skills/
```

---

## STEP 4 — Final message

After the updater finishes successfully, print:

```
════════════════════════════════════════════════════
  ✅ Pickle is on the latest version
════════════════════════════════════════════════════

One last step so Claude Code picks up the new MCP tools:

   1. Fully quit Claude Code  (Cmd+Q on Mac — not just close)
   2. Reopen it
   3. Run /pickle-clickup 24h  (or /pickle-slack 24h)

Skill text changes apply immediately. Only the ClickUp MCP server
code needs the quit+reopen to re-register tools.
```

---

## HARD RULES

- **Never ask the user anything.** This skill is zero-question. If something fails, give a 1-line fix — don't interrogate.
- **Never touch prefs.json or tokens.** The updater script already handles this safely — don't duplicate its logic here.
- **Never suggest a full reinstall** unless the updater returns a non-zero exit AND the error message literally says reinstall is needed.
- **Pass through all updater output verbatim.** The updater is designed to show version numbers and fun facts. Don't summarise or reformat it.
- **This skill is safe to run repeatedly.** If already on latest, the updater says so and exits cleanly.
