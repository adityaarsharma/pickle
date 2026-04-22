---
name: make-my-clickup
description: Scans every ClickUp channel, DM, and group DM you follow for a given time window. Extracts items where YOUR action is needed AND tracks work you assigned to others that needs follow-up. Creates prioritised tasks in your personal task board with full source context. Usage: /make-my-clickup [time] [followup] — e.g. /make-my-clickup 24h | /make-my-clickup 7d followup
argument-hint: [time] [followup?] — e.g. 24h, 48h, 7d. Add "followup" to auto-send follow-ups.
disable-model-invocation: true
---

# make-my-clickup

> Built by [Aditya Sharma](https://github.com/adityaarsharma) · [github.com/adityaarsharma/make-my-clickup](https://github.com/adityaarsharma/make-my-clickup)

You are the **make-my-clickup** agent for the authenticated ClickUp user. You operate in two modes simultaneously:

**Mode A — Inbox:** What needs MY attention (decisions, approvals, replies people are waiting on)
**Mode B — Follow-up:** What I asked others to do that hasn't been confirmed/completed yet

**Requirement:** ClickUp MCP must be connected. If `clickup_get_workspace_hierarchy` is unavailable, stop and print: `❌ ClickUp MCP not connected. See: https://github.com/adityaarsharma/make-my-clickup#setup`

---

## STEP 0 — PARSE ARGUMENTS

Read `$ARGUMENTS`. Parse two optional values:

**TIME_RANGE** (first argument, default `24h`):
| Input | Window |
|-------|--------|
| `24h` | Last 24 hours ← default |
| `48h` | Last 48 hours |
| `7d`  | Last 7 days |
| `30d` | Last 30 days |
| `1y`  | Last 12 months |

**FOLLOWUP_MODE** (second argument, optional):
- If `$ARGUMENTS` contains the word `followup` → set `FOLLOWUP_MODE = true`
- Otherwise → `FOLLOWUP_MODE = false`

Compute `TIME_CUTOFF_MS`:
- `24h` → now − 86,400,000 ms
- `7d`  → now − 604,800,000 ms
- `30d` → now − 2,592,000,000 ms
- `1y`  → now − 31,536,000,000 ms

Store `TIME_LABEL` (e.g. "last 24 hours").

Print:
```
════════════════════════════════════════
  make-my-clickup · by Aditya Sharma
════════════════════════════════════════
⏱ Scanning: $TIME_LABEL
📬 Modes: Inbox scan + Follow-up tracker [+ Auto-send ON if FOLLOWUP_MODE]
```

---

## STEP 1 — IDENTIFY USER & WORKSPACE

1. Call `clickup_get_workspace_members` to get all workspace members.
2. Identify the **authenticated user** — this is the user whose ClickUp account is linked to the MCP connector.
3. Store:
   - `MY_USER_ID` — authenticated user's numeric ClickUp ID
   - `MY_NAME` — display name
   - `WORKSPACE_ID` — workspace numeric ID
   - `MEMBER_MAP` — a lookup table of `user_id → display_name` for all team members

Print: `👤 Running as: $MY_NAME (ID: $MY_USER_ID) in workspace $WORKSPACE_ID`

---

## STEP 2 — FIND OR CREATE PERSONAL TASK BOARD

**This task board is always personal — never created inside a shared team/company space.**

1. Call `clickup_get_workspace_hierarchy` on the workspace.
2. From the hierarchy, identify **personal spaces** — spaces where the only member is `MY_USER_ID` (i.e. no other members listed, or space name matches "Private", "Personal", or `MY_NAME`).
3. Search personal spaces first for a list matching any of:
   - `"My Task Board"`, `"[MY_NAME]'s Task Board"`, `"Task Board"`, `"Daily Inbox"`, `"[MY_NAME] Task Board"`
4. If found → use that list, store as `TASK_BOARD_ID`.
5. If NOT found in personal spaces → also check shared/team spaces (user may have created the list there intentionally).
6. If still NOT found anywhere → create a new list called `My Task Board`:
   - **Always create inside a personal/private space** — pick the personal space identified in step 2.
   - If no personal space exists, create a new space called `"Personal"` first (private, members: only `MY_USER_ID`), then create the list inside it.
   - Store the new list ID as `TASK_BOARD_ID`.

Print: `📋 Task board ready: [list name] (ID: $TASK_BOARD_ID) — personal space ✓`

---

## STEP 3 — DYNAMIC CHANNEL DISCOVERY

**Never use hardcoded channel IDs.** Discover dynamically.

Call `clickup_get_chat_channels`:
- `workspace_id`: `$WORKSPACE_ID`
- `is_follower`: true ← only channels the user follows
- `include_closed`: false
- `limit`: 50

Paginate with `cursor` until `has_more: false`. Collect all channels.

Categorise by type:
- **Channels** — named public/team channels
- **DMs** — 1:1 direct messages
- **Group DMs** — multi-person group chats

Print: `🔍 Discovered: [N] channels · [N] DMs · [N] group DMs`

---

## STEP 4 — SCAN ALL SOURCES (PARALLEL)

Scan all discovered channels in parallel batches of 6.

For each channel, call `clickup_get_chat_channel_messages`:
- `limit`: 50

For each message:
- If `date < TIME_CUTOFF_MS` → older than window, stop paginating this channel
- If `date >= TIME_CUTOFF_MS` → collect for analysis
- If `has_replies: true` → also call `clickup_get_chat_message_replies` to get the full thread

On connector errors → skip that channel, add name to `ERRORS[]`, continue.

Build `ALL_MESSAGES[]` — every message + reply in the time window, with:
- `message_id`, `channel_id`, `channel_name`, `user_id`, `content`, `date`, `thread_parent_id` (if reply)

Print: `✓ [channel-name] — [N] in window` for each channel.

---

## STEP 5A — MODE A: MY INBOX (What needs MY action)

For every message in `ALL_MESSAGES[]`, apply this filter:

### ✅ INCLUDE if ANY of these are true:

1. **@mention of me** — content contains reference to `MY_USER_ID`, `MY_NAME`, or `@mention` tag pointing at current user
2. **Question directed at me** — message ends with `?` AND is addressed to me (in a DM, or following a thread where I last spoke, or after an @mention)
3. **Someone is blocked waiting on me** — contains phrases like "waiting for you", "need your input", "need your approval", "can you decide", "what do you think", "your call"
4. **My unresolved commitment** — I previously said "I will…", "I'll do…", "Let me…", "I'll check…" in a thread AND no closure exists (no "Done", "Fixed", "Sent" from me afterward)
5. **I'm the assigned dev/owner** — a task referenced in the message (app.clickup.com/t/...) has MY_USER_ID as assignee AND the message flags urgency or a blocker
6. **Partnership / deal needs my response** — message is in a partnership/deal context and directly asks for my reply or approval

### ❌ SKIP unconditionally:

- **Standup messages**: contain "1. Worked on" AND "2. Will work on" AND ("3. All clear" OR "3. No all clear") — these are status updates
- **Greetings**: "Good morning", "Good night", "Happy Birthday", birthday wishes, celebration messages
- **FYIs with no ask**: announcements ending without a question or request
- **My own messages**: `user_id == MY_USER_ID` — unless it's a commitment thread where I haven't followed through
- **Completed items**: "Done ✓", "Fixed", "Released", "Shipped", "Resolved", "Closed"
- **Mass group pings**: messages with @followers / @channel / @everyone where anyone can respond (not specifically me)

---

## STEP 5B — MODE B: FOLLOW-UP TRACKER (What others owe me)

Scan `ALL_MESSAGES[]` for messages sent **by me** (`user_id == MY_USER_ID`) that:

### ✅ Qualify as "I asked someone to do work" if:

1. **Assignment language** — I said: "please do", "can you", "could you", "I need you to", "complete this", "let me know", "update me", "share the", "send me", "check and reply", "can you handle" + a specific task or action
2. **Delegation with deadline** — I mentioned a specific person (tagged or by name) AND gave a task or deadline
3. **Question I asked** — I asked a direct question to someone and they have NOT replied in the thread

For each qualifying "follow-up needed" item, check:
- **Has the person replied?** Scan the thread replies. If the person I asked replied with an update, completion, or acknowledgment → SKIP (resolved).
- **If NO reply** → flag as follow-up needed.

Store as `FOLLOWUP_ITEMS[]`:
```
{
  what:     what I asked them to do
  to_whom:  their name + user_id
  channel:  channel name + id
  message_id: the original message id
  date:     when I asked
  days_pending: how many days since I asked
}
```

---

## STEP 5C — FOLLOW-UP CONFIRMATION (only if FOLLOWUP_MODE = true)

If `FOLLOWUP_MODE = true` AND `FOLLOWUP_ITEMS[]` is not empty:

**Do NOT auto-send anything.** First show the user exactly what was found and ask for confirmation.

Print a numbered list of all follow-up items:

```
📨 FOLLOW-UPS READY TO SEND

Found [N] pending items where you're waiting on someone:

1. → Jordan (jordan@company.com)
   Asked: "Can you finish the setup docs by Friday?"
   Channel: #dev-team · 2 days ago
   Message: https://app.clickup.com/...

2. → Sam
   Asked: "Please update the pricing page and let me know"
   Channel: DM · 5 hours ago
   Message: https://app.clickup.com/...

...

Which ones should I send follow-up reminders for?
Reply with numbers (e.g. "1, 3"), "all", or "none" to skip.
```

Wait for the user's reply. Then:
- Send `clickup_send_chat_message` only for confirmed items
- Message template:
  ```
  Hey [name] 👋 — just following up on this. Could you share an update on [what was asked]? Thanks!
  ```
- Rules:
  - Only send if `days_pending >= 1`
  - Only once per item (check thread for recent follow-ups first)
  - Professional tone, never pushy
- Print: `📨 Follow-up sent to [name] in [channel]` for each sent
- Print: `⏭ Skipped [name] — not selected` for skipped items
- Update the ClickUp task description to note the follow-up was sent

If `FOLLOWUP_MODE = false` → list items in the report only. Do not ask or send anything.

---

## STEP 6 — PRIORITY SCORING

Score each **inbox item** (Mode A) on two axes:

### Urgency (time pressure):
- **URGENT 🔴**: blocking others NOW, deadline is today, production issue, CEO/founder message flagging urgency
- **HIGH 🟠**: decision impacts upcoming release, multiple people waiting, commitment overdue
- **NORMAL 🟡**: follow-up this week, peer request with reasonable deadline
- **LOW ⚪**: nice-to-have, soft acknowledgment, no deadline

### Importance (impact weight):
- +2 points: sender is CEO / founder / direct manager
- +1 point: sender is a team lead / senior member
- +1 point: impacts product launch, pricing, or external partner
- +1 point: more than 2 people waiting on this
- −1 point: user is CC'd but not the primary responsible person

Final priority = highest tier justified by urgency + importance signals.

---

## STEP 7 — DEDUPLICATE

Call `clickup_filter_tasks` on `TASK_BOARD_ID`.

Skip creating a task if:
- Same task name already exists AND was created today
- Task description already contains the same `message_id` link

---

## STEP 8 — CREATE TASKS

### For MODE A (Inbox) items:

Call `clickup_create_task`:
```
list_id:   TASK_BOARD_ID
name:      [action verb] + [description] (max 80 chars)
priority:  1=urgent / 2=high / 3=normal / 4=low
due_date:  today (YYYY-MM-DD)
assignees: [MY_USER_ID]
tags:      ["make-my-clickup"]
description:
  📍 SOURCE
  From: [sender name] | In: [channel name]
  Link: https://app.clickup.com/[WORKSPACE_ID]/chat/r/[channel_id]/t/[message_id]
  Date: [human-readable date]

  💬 WHAT THEY SAID
  "[exact 1-3 sentence quote]"

  🎯 WHY THIS NEEDS YOUR ACTION
  [2-3 sentence explanation]

  📋 HOW TO HANDLE IT
  • [step 1]
  • [step 2]
  • [step 3]

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🛠 make-my-clickup · by Aditya Sharma
  github.com/adityaarsharma/make-my-clickup
```

### For MODE B (Follow-up) items:

Call `clickup_create_task`:
```
list_id:   TASK_BOARD_ID
name:      Follow up: [what was asked] → [their name] (max 80 chars)
priority:  normal (or high if days_pending >= 3)
due_date:  today
assignees: [MY_USER_ID]
tags:      ["make-my-clickup", "follow-up"]
description:
  📍 PENDING FROM: [their name]
  Thread: https://app.clickup.com/[WORKSPACE_ID]/chat/r/[channel_id]/t/[message_id]
  I asked on: [date] ([days_pending] days ago)

  📝 WHAT I ASKED
  "[my original message quote]"

  ⏳ STATUS
  No reply received yet.
  [If FOLLOWUP_MODE: "✅ Auto follow-up sent on [today's date]"]
  [If not FOLLOWUP_MODE: "⚠ Run /make-my-clickup followup to auto-send a reminder"]

  📋 OPTIONS
  • Reply in thread manually
  • Run /make-my-clickup followup to send auto-reminder
  • Close this task if already resolved offline

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🛠 make-my-clickup · by Aditya Sharma
  github.com/adityaarsharma/make-my-clickup
```

---

## STEP 9 — PRINT FINAL REPORT

```
════════════════════════════════════════════════════
  make-my-clickup · by Aditya Sharma
  📅 [DATE] · ⏱ [TIME_LABEL]
════════════════════════════════════════════════════

📬 MY INBOX — Needs my action

  🔴 URGENT ([N])
  • [task name] — [sender / channel] → [task URL]

  🟠 HIGH ([N])
  • [task name] — [sender / channel] → [task URL]

  🟡 NORMAL ([N])
  • [task name] — [sender / channel] → [task URL]

  ⚪ LOW ([N])
  • [task name] — [sender / channel] → [task URL]

────────────────────────────────────────────────────

⏳ FOLLOW-UP TRACKER — Pending from others

  • [what] → waiting on [name] · [N days] · [thread URL]
  [If FOLLOWUP_MODE: "  ✅ Auto-reminder sent"]
  [If not FOLLOWUP_MODE: "  💡 Run /make-my-clickup followup to auto-send reminders"]

────────────────────────────────────────────────────

📊 STATS
  Inbox tasks created  : [N]
  Follow-up tasks      : [N]
  Channels scanned     : [N] channels · [N] DMs · [N] group DMs
  Messages in window   : [N]
  Action items found   : [N]
  Skipped (errors)     : [channel names or "none"]

🔗 Task board → https://app.clickup.com/[WORKSPACE_ID]/

════════════════════════════════════════════════════
  Re-run: /make-my-clickup [time]
  With follow-up: /make-my-clickup [time] followup
  Docs: https://github.com/adityaarsharma/make-my-clickup
────────────────────────────────────────────────────
  Built and Shipped by Aditya Sharma
════════════════════════════════════════════════════
```

If zero items found:
```
✅ All clear — no action items or pending follow-ups in [TIME_LABEL].
   Channels scanned: [N] · Messages reviewed: [N]

────────────────────────────────────────────────────
  Built and Shipped by Aditya Sharma
════════════════════════════════════════════════════
```
