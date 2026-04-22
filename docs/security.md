# Security & Privacy

> Part of [Pickle](https://github.com/adityaarsharma/pickle) · Built by [Aditya Sharma](https://github.com/adityaarsharma)

Pickle reads your Slack and ClickUp messages. That's sensitive. Here's exactly what happens — and what doesn't.

---

## TL;DR

- **Fully local.** Runs inside your own Claude Code, on your machine.
- **No Pickle server.** There is no backend. There is no SaaS. No one receives your data.
- **No telemetry.** No analytics, no usage tracking, no "anonymous metrics".
- **Tokens stay on your disk.** In `~/.claude.json`. Never transmitted to anyone except ClickUp/Slack themselves.
- **Slack and ClickUp are never mixed.** Two separate skills, two separate state files. Data does not cross.
- **No auto-sending.** Pickle always asks before sending a follow-up DM.

---

## The data flow

```
  Your Slack / ClickUp
          │
          ▼
  MCP server (runs on YOUR machine via npx / official connector)
          │
          ▼
  Claude Code (your desktop app, your Anthropic account)
          │
          ▼
  Tasks written back into YOUR Slack List / ClickUp task board
          │
          ▼
  Tiny state file: ~/.claude/skills/pickle-*/state.json (IDs only, your machine only)
```

Nothing hits any Pickle-owned infrastructure — **there isn't any**.

---

## What leaves your machine

Only what Claude Code already sends to Anthropic during normal operation — i.e. the prompts and tool results required for Claude to decide what to do. This is governed by Anthropic's privacy policy, not Pickle's.

Pickle itself sends **nothing** anywhere.

---

## What stays on your machine

| Thing | Stored at | Contents |
|-------|-----------|----------|
| ClickUp API token | `~/.claude.json` | `pk_xxxxxxxxxxxx` |
| Slack token | `~/.claude.json` | `xoxp-...` or `xoxb-...` |
| ClickUp state | `~/.claude/skills/pickle-clickup/state.json` | message IDs + task IDs + timestamps |
| Slack state | `~/.claude/skills/pickle-slack/state.json` | `channel_id:ts` + list entry IDs + timestamps |

### What's in `state.json`

```json
{
  "actioned_messages": {
    "2a4f8b12-...": {
      "task_id": "abc123",
      "actioned_at": "2026-04-22T09:00:00Z",
      "kind": "inbox"
    }
  }
}
```

**IDs and timestamps. Nothing else.**

- ❌ No message text
- ❌ No sender names
- ❌ No channel names
- ❌ No personal info
- ❌ No email addresses
- ❌ No content of any kind

Delete the file any time to reset memory — nothing breaks.

---

## Tokens — how to rotate / revoke

**ClickUp**
1. ClickUp → Avatar → Settings → Apps → API Token → **Regenerate**
2. Old token stops working immediately. Paste the new one into `~/.claude.json` and restart Claude Code.

**Slack**
- **User token (`xoxp`)** — Slack → Apps → your Pickle app → OAuth → **Rotate** / **Revoke**
- **Bot token (`xoxb`)** — same place; rotating breaks every client until updated

**Always keep tokens out of screenshots, commits, and shared documents.** Pickle will never print your token back at you.

---

## Team sharing

**Problem:** If your whole team shares one Claude account, the ClickUp/Slack MCP connector is tied to that account — so everyone sees everyone's inbox. This defeats the point.

**Fix:** Each teammate uses their own ClickUp API token + Slack user token on their own machine. The token lives in *their* `~/.claude.json`. Full isolation:

```
  Teammate A              Teammate B              Teammate C
  pk_aaaa / xoxp-aaa      pk_bbbb / xoxp-bbb      pk_cccc / xoxp-ccc
       │                        │                        │
       ▼                        ▼                        ▼
  Their inbox              Their inbox              Their inbox
  Their Pickle board       Their Pickle board       Their Pickle board
```

No shared state. No overlap.

---

## Slack-specific safety rules

Pickle will **never**:
- Post in a public Slack channel on your behalf
- DM anyone without you explicitly confirming the exact recipient + message
- React / emoji-react as you
- Mark messages read/unread for you (beyond what reading the history costs)
- Join channels on your behalf — it only reads channels you're already a member of

Pickle **will**:
- Read `conversations.history` on channels/DMs you're in
- Write entries into your own private Slack List (or DM-to-self as fallback)
- Set Slack reminders on your own account
- Send DMs **only to the recipients you explicitly select** in the Step 5C confirmation prompt

---

## ClickUp-specific safety rules

Pickle will **never**:
- Create tasks in shared team/company spaces — always in your personal/private space
- Modify tasks that Pickle didn't create
- Change list permissions or share documents
- Delete anything (tasks, lists, spaces, messages)

Pickle **will**:
- Read `clickup_get_chat_channels` and `clickup_get_chat_channel_messages` for channels you follow
- Create/update tasks in your personal `My Task Board` list
- Update tasks it previously created (to record follow-ups sent)

---

## No auto-send — ever

Even with `followup` mode on:

1. Pickle shows you the grouped list of every follow-up it *wants* to send
2. You reply with specific numbers (`1, 3`), `all`, or `none`
3. Only then does Pickle send — and only to the ones you confirmed
4. Items flagged `escalation_needed` (2+ prior follow-ups) are skipped even if you said `all`

---

## Open source

Pickle is MIT licensed. The full source is in this repo. Read the `SKILL.md` files — every rule in this document is enforced by those plain-English instructions to Claude.

If you want to verify Pickle does what it claims: read `pickle-clickup/SKILL.md` and `pickle-slack/SKILL.md` end to end. They're the entire product.

---

*Back to [main README](../README.md)*
