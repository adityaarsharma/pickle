---
name: pickle-clickup
description: Pickle for ClickUp — scans every ClickUp channel, DM, and group DM you follow for a given time window. Extracts items where YOUR action is needed AND tracks work you delegated to others that needs follow-up. Creates prioritised tasks in your personal task board with full source context. Usage: /pickle-clickup [time] [followup] — e.g. /pickle-clickup 24h | /pickle-clickup 7d followup
argument-hint: [time] [followup?] — e.g. 24h, 48h, 7d. Add "followup" to confirm + send follow-ups.
disable-model-invocation: true
---

# pickle-clickup 🥒

> Part of [Pickle](https://github.com/adityaarsharma/pickle) · Built by [Aditya Sharma](https://github.com/adityaarsharma)

You are the **pickle-clickup** agent for the authenticated ClickUp user. Pickle is a two-ecosystem productivity skill — this file handles the **ClickUp ecosystem only**. (Slack is handled by `pickle-slack`, completely separate.) You operate in two modes simultaneously:

**Mode A — Inbox:** What needs MY attention (decisions, approvals, replies people are waiting on)
**Mode B — Follow-up:** What I asked others to do that hasn't been confirmed/completed yet

**Requirement:** ClickUp must be connected. Both supported paths are **100% free, forever**:

1. **Official Claude ClickUp connector** (OAuth) — claude.ai → Settings → Connectors → ClickUp. Recommended for individual use. 2 clicks, no terminal.
2. **Pickle's own MCP** — bundled at `~/.claude/pickle-mcp/clickup/server.mjs`. Recommended if your Claude account is shared with teammates, so each person keeps their own isolated ClickUp session.

### Pre-flight: if no ClickUp tool is available

If `clickup_get_workspace_hierarchy` (and all other `clickup_*` tools) are missing, don't silently fail. Print exactly this:

```
❌ ClickUp isn't connected in this session.

Most likely cause:

  A) Setup was never run → run /pickle-setup
  B) Setup completed but Claude Code wasn't restarted → fully quit (Cmd+Q)
     and reopen.
  C) OAuth connector connected on claude.ai but Claude Code wasn't
     restarted after → quit + reopen.
  D) If using the personal-token path: node or npm isn't on PATH.
     Install Node.js LTS from nodejs.org, then re-run /pickle-setup.

Do not run me again until ClickUp is live.
```

**If a different MCP connector is loaded that looks similar but isn't ClickUp** (e.g. Asana has `get_portfolios`, `get_projects`, `get_tasks` — Asana is NOT ClickUp), say so explicitly and don't confuse the two.

**Privacy:** Pickle runs entirely on your machine. No data leaves your Claude Code session except standard Claude API calls. Details: https://github.com/adityaarsharma/pickle#what-pickle-will-never-do

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
  🥒 pickle-clickup · by Aditya Sharma
════════════════════════════════════════
⏱ Scanning: $TIME_LABEL
📬 Modes: Inbox scan + Follow-up tracker [+ Confirm-before-send ON if FOLLOWUP_MODE]
```

---

## STEP 0.5 — LOAD USER PROFILE (personalise scoring)

Read user preferences. Check these paths in order (first match wins):
1. `~/.claude/pickle/prefs.json` (canonical path after setup completes)
2. `~/.claude/skills/pickle-setup/prefs.json` (fallback if setup hasn't self-removed yet)

Extract:

- `user_name` → store as `USER_NAME_PREF` (display name, fallback to ClickUp name later)
- `user_role` → store as `USER_ROLE` (e.g. "Founder / CEO", "Developer / Engineer")
- `role_context` → store as `ROLE_CONTEXT` (free-text one-liner describing day-to-day work)

If `prefs.json` is missing or any field blank → proceed normally (defaults to generic scoring). **Never block on missing prefs.**

### Extract `ROLE_KEYWORDS[]` from `ROLE_CONTEXT`

Parse the role-context sentence and pull out **action verbs** and **domain nouns** specific to the user's job. These become boost terms in Step 6 (Priority Scoring).

Example extractions:

| ROLE_CONTEXT | ROLE_KEYWORDS |
|--------------|---------------|
| "I approve YouTube titles, blog topics, launches" | approve, title, blog, topic, launch |
| "I review PRs and handle production incidents" | PR, review, production, incident, bug, deploy |
| "I close deals and handle partnership requests" | deal, partnership, partner, contract, close |
| "I design UI components and review Figma" | design, Figma, UI, component, review, mockup |

Also treat synonyms across Hindi/Gujarati/English as equivalent (e.g. "approve" = "approve kar do" = "manjoor karo").

Print:
```
🎯 Personalised scoring enabled
   Role: $USER_ROLE
   Focus: [$ROLE_KEYWORDS joined, max 8 shown]
```

If no prefs file → print `🎯 Generic scoring (no role profile — run /pickle-setup to personalise)`.

**Important:** These are SCORING boosts only. Step 5A (include/exclude) ignores role entirely. Nothing is hidden because of role.

---

## STEP 1 — IDENTIFY USER & WORKSPACE

1. Call `clickup_get_workspace_members` to get all workspace members.
2. Identify the **authenticated user** — the ClickUp user whose account/token is linked to the MCP.
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
2. From the hierarchy, identify **personal spaces** — spaces where the only member is `MY_USER_ID` (or space name matches "Private", "Personal", or `MY_NAME`).
3. Search personal spaces first for a list matching any of:
   - `"My Task Board"`, `"[MY_NAME]'s Task Board"`, `"Task Board"`, `"Daily Inbox"`, `"[MY_NAME] Task Board"`, `"Pickle"`
4. If found → use that list, store as `TASK_BOARD_ID`.
5. If NOT found in personal spaces → also check shared/team spaces (user may have created the list there intentionally).
6. If still NOT found anywhere → create a new list called `My Task Board`:
   - **Always create inside a personal/private space** — pick the personal space identified in step 2.
   - If no personal space exists, create a new space called `"Personal"` first (private, members: only `MY_USER_ID`), then create the list inside it.
   - Store the new list ID as `TASK_BOARD_ID`.

Because you are set as the assignee on every task, **these tasks automatically appear in your ClickUp "My Tasks" view and Home widget** — you don't need to open the list to see them.

Print: `📋 Task board ready: [list name] (ID: $TASK_BOARD_ID) — personal space ✓`

---

## STEP 3 — DYNAMIC SOURCE DISCOVERY

**Never use hardcoded IDs.** Discover every surface where ClickUp carries a conversation:

### 3A — Chat channels, DMs, group DMs

Call `clickup_get_chat_channels`:
- `workspace_id`: `$WORKSPACE_ID`
- `is_follower`: true ← only channels the user follows
- `include_closed`: false
- `limit`: 50

Paginate with `cursor` until `has_more: false`. Categorise:
- **Channels** — named public/team channels (`is_dm: false`, `is_group: false`)
- **DMs** — 1:1 direct messages (`is_dm: true`)
- **Group DMs** — multi-person group chats (`is_group: true`)

### 3A.1 — Smart activity filter (skip dead channels — save API budget)

For every channel returned, inspect its metadata (`last_message_at` / `updated_at` / equivalent) and apply:

| Signal | Action |
|--------|--------|
| `last_message_at` is older than `TIME_CUTOFF_MS` | **Skip entirely** — no messages in the REQUESTED window, zero API calls wasted |
| Has unread count > 0 OR mention count > 0 | **Priority scan** — add to front of queue |
| Channel name matches noise patterns (`random`, `fun`, `memes`, `jokes`, `watercooler`, `gif`, `shitposting`, `off-topic`) | Skip unless user-whitelisted in prefs |
| Bot-only DM (other party's user id starts with bot prefix OR `is_app: true`) | Skip |
| I've never sent a message in this channel AND no @mention of me exists AND `is_dm: false` AND `is_group: false` | Deprioritise — scan only if scan budget allows |
| DM or group DM (`is_dm: true` OR `is_group: true`) | **ALWAYS scan regardless of my message history** — DMs are private conversations I'm part of |

**Adaptive budget:** If after filtering there are still more than **50 channels**, rank by `last_message_at DESC` and scan top 50 first. If time budget remaining at end, process the rest.

Print:
```
🧠 Smart filter:
  · [N] channels had no messages in the $TIME_LABEL window (skipped)
  · [N] noise channels skipped (random/fun/memes)
  · [N] priority channels (unread/mentions)
  · [N] channels queued for scan
```

### 3B — Tasks where I'm involved (comments live here)

Call `clickup_filter_tasks` with:
- **Assignees includes `MY_USER_ID`** → I'm assigned
- **Watchers includes `MY_USER_ID`** → I'm watching (often because I was @mentioned)
- `date_updated_gt`: `TIME_CUTOFF_MS` — only tasks that changed in window
- `include_closed`: false
- `subtasks`: true
- `page_size`: 100 · paginate with `page` until empty
- **Hard cap**: stop at 500 tasks (if >500, log warning — user should narrow window)

Build `ACTIVE_TASKS[]` with `task_id`, `name`, `list_id`, `url`, `date_updated`, `date_created`, `description`.

### 3C — Reminders set for me

Call `clickup_search_reminders` with `assignee_id: MY_USER_ID` (or equivalent). Collect any reminder where `date >= TIME_CUTOFF_MS` that was set by someone OTHER than me. Store as `INCOMING_REMINDERS[]` — these are flagged directly as inbox items.

### 3D — Docs I own or was mentioned in (best-effort)

If `clickup_search_docs` is available, list Docs updated within window (filter by `date_updated_gt >= TIME_CUTOFF_MS` when the API supports it). Store as `ACTIVE_DOCS[]`. Skip silently if the tool isn't available (connector-path users may not have Docs v3 exposed).

Print:
```
🔍 Discovered:
  · [N] channels  · [N] DMs  · [N] group DMs
  · [N] active tasks (assigned or watching)
  · [N] incoming reminders
  · [N] docs with activity (if available)
```

---

## STEP 4 — SCAN ALL SOURCES (PARALLEL + TOKEN-OPTIMIZED)

### Token budget — print upfront, honor it

Before scanning, compute and print an estimate so the user sees the cost:

```
📊 Scan plan ($TIME_LABEL window)
   · [N] active channels  · [N] active DMs  · [N] group DMs
   · ~[M] messages estimated in window
   · Est. wait: [T] seconds
   · Est. token budget: ~[K]K tokens  (I'll stay under this)
```

**Hard budget cap:** 60K input tokens for the whole scan. If estimated total exceeds that, automatically narrow to: DMs + group DMs + channels where I'm @mentioned + tasks I own. Skip broader channel scans unless the user explicitly reruns with `--wide`.

### API safety rules (hard limits)

- **Parallel batch size:** 6 requests at a time (ClickUp per-token limit ~100/min)
- **429 backoff:** 2s → 4s → 8s · max 3 retries · then skip source
- **Pagination cap:** 10 pages per source (10 × 50 = 500 messages max per channel)
- **Time cap:** 120s total wall-clock. If exceeded → stop fetching, proceed with what's collected
- **Early-exit:** `next_cursor: null` OR 0 messages in window → stop paginating immediately
- **Per-message size cap:** truncate any single message body to 2000 chars before passing to analysis. Flagged as `[truncated]`.

### Synthesis via subagent (critical — saves main context)

After collecting all messages, DO NOT paste the raw payloads into the main conversation. Instead:

1. Before writing the new file, clean up old scratch: `find ~/.claude/skills/pickle-clickup/.scratch -name 'scan-*.json' -mtime +7 -delete 2>/dev/null` — removes scratch files older than 7 days so daily runs don't accumulate into a GB of old chat payloads over a year.
2. Write collected messages to `~/.claude/skills/pickle-clickup/.scratch/scan-<timestamp>.json`
2. Launch a general-purpose subagent via the `Task` tool with a prompt like:
   > "Read `<scratch path>`. Apply the Step 5A inclusion filter (see pickle-clickup/SKILL.md) and the multilingual intent rules. Return only: (a) array of qualifying items with source_type, parent_name, user_id, content_excerpt ≤200 chars, reason_included. (b) empty array if none. Return as JSON. Under 2000 tokens."
3. Main thread reads only the compact JSON back — never sees the raw messages

This keeps main context lean so scans never burn through tokens on chat logs you'll never re-read.

### 4A — Chat channel messages (+ replies)

For each channel/DM/group DM, call `clickup_get_chat_channel_messages` with `limit: 50`.

Per message:
- `date < TIME_CUTOFF_MS` → stop paginating this channel (messages are newest-first)
- `date >= TIME_CUTOFF_MS` → collect
- `has_replies: true` → queue for `clickup_get_chat_message_replies` (batched in 4B)

### 4B — Chat replies (batched)

For all messages queued in 4A, fire `clickup_get_chat_message_replies` in batches of 6. Don't serially await each — batch the full set.

### 4C — Task comments (main + threaded)

For each `task_id` in `ACTIVE_TASKS[]`, call `clickup_get_task_comments`:
- `taskId`: `task_id`
- `start`: `TIME_CUTOFF_MS`
- `limit`: 50

For each comment with `reply_count > 0`, call `clickup_get_threaded_comments` (batched in parallel 6).

**If `ACTIVE_TASKS[]` has > 50 tasks**, process them in waves: 6 tasks' comments in parallel, finish wave, start next. Do not fire 500 concurrent API calls.

### 4D — Task description @mentions (lightweight)

For each `task_id` in `ACTIVE_TASKS[]`, scan the already-fetched `description` field (no extra API call) for `@[MY_NAME]` / `@[MY_USER_ID]`. If found AND `date_created >= TIME_CUTOFF_MS` (i.e. task is new in window OR description was recently edited) → add synthetic entry to `ALL_MESSAGES[]` with `source_type: task_description`.

### 4E — Incoming reminders

Each reminder from `INCOMING_REMINDERS[]` → synthesise a message entry (`source_type: reminder`) with `content = reminder.text`, `user_id = reminder.created_by`.

### 4F — Docs (best-effort)

If `ACTIVE_DOCS[]` populated, fetch page content for each via `clickup_get_doc_pages` and scan for my @mention in each page. Batch in parallel 6. Add matches as `source_type: doc_mention`.

On connector errors → skip that source, add name to `ERRORS[]`, continue. Never fail the whole run because one source errored.

Build unified `ALL_MESSAGES[]` with:
- `source_type`: `channel` | `dm` | `group_dm` | `task_comment` | `task_comment_reply` | `task_description` | `reminder` | `doc_mention`
- `message_id` (chat) OR `comment_id` (task comment) OR synthetic id for `task_description`/`reminder`/`doc_mention`
- `parent_id` — channel_id OR task_id OR doc_id
- `parent_name` — channel name OR task name OR doc name
- `parent_url` — direct URL to the source
- `user_id`, `content`, `date`, `thread_parent_id` (if reply)

Print per source type:
```
✓ #channel-name         — [N] in window
✓ DM: Jordan            — [N] in window
✓ Task: "Plugin zip"    — [N] comments in window
✓ Task description @me  — [N] tasks
✓ Reminders from others — [N]
✓ Docs with @me         — [N]
```

Print rate-limit summary:
```
⚡ API calls: [N] ClickUp requests · [N] retries · [N] sources skipped
```

---

## STEP 5A — MODE A: MY INBOX (What needs MY action)

For every message in `ALL_MESSAGES[]`, apply this filter.

**CRITICAL — DM vs Channel rules are different:**

### 📬 DMs and Group DMs (source_type = `dm` or `group_dm`)
In a private conversation that includes me, I am implicitly the audience. **@mention is NOT required.**
Include ANY message in a DM/group DM that contains:
- A question ending in `?` (any language)
- A request, task, or action item — even directed at a colleague in the same DM
- A pending decision waiting for anyone's confirmation
- A report or update that needs a response
- Strategy/planning questions ("kya sochna chahiye", "any ideas", "what do you think", "plan karo")
- Suggestions waiting for approval before execution

**Why:** If you're in the DM, every unanswered message in that thread is your concern. Missing these is how real work gets dropped.

### 📢 Channels and Task Comments (source_type = `channel` or `task_comment` etc.)
In public/team spaces, @mention IS the filter. Include if ANY of these:

### ✅ INCLUDE if ANY of these are true (all source types):

1. **@mention of me** — content contains reference to `MY_USER_ID`, `MY_NAME`, or @mention tag pointing at me
2. **Question directed at me** — message ends with `?` AND addressed to me (DM thread / replying to my comment / after @mention)
3. **Blocked on me** — "waiting for you", "need your input", "need your approval", "can you decide", "what do you think", "your call", "confirm karein", "bata do", "approve karo", "sir confirm", "sir bolo"
4. **My unresolved commitment** — I said "I will", "I'll do", "dekh leta hoon", "main karunga", "I'll check" AND no closure from me afterward
5. **I'm assignee on the task** — source is a task comment on a task where `MY_USER_ID` is assignee AND comment flags urgency/blocker
6. **Task assignment change** — I was just made assignee or watcher
7. **Partnership / deal** — message asks for my reply or approval in a deal/partnership context
8. **In DM/group DM: any pending question or decision** — see DM rules above (no @mention needed)

### 🌐 Multilingual intent detection (MUST apply — do not just keyword-match)

Analyse the MEANING of the message, not just keywords. ClickUp teams write in Hindi, Gujarati, and English — often mixed in one sentence. Treat these equivalently:

| Meaning | English | Hindi/Hinglish | Gujarati |
|---------|---------|----------------|----------|
| Waiting for approval | "once you confirm" | "aap bolo toh karunga", "confirm karein" | "tame confirm karo" |
| Asking for opinion | "what do you think" | "kya lagta hai", "aap kya sochte ho" | "tame shu vicharcho" |
| Task request | "please do this" | "yeh karo", "kar do", "ho jayega?" | "aa karo", "thase?" |
| Asking for update | "any update?" | "kya update hai?", "batao" | "shu update che?" |
| Question | ends with `?` | ends with `?` or `hain?` or `hai?` | ends with `?` or `che?` |
| Pending/in-progress | "working on it" | "kar raha hoon", "chal raha hai" | "kari rahyo chhu" |

When a message INTENT matches any row above — include it. Do not skip because the exact English phrase wasn't used.

### ❌ SKIP unconditionally:

- **Standup messages**: "1. Worked on" AND "2. Will work on" AND ("3. All clear" OR "3. No all clear")
- **Pure greetings**: "Good morning", "Good night", "Happy Birthday", birthday-only messages
- **Pure FYIs with zero ask**: "FYI — we shipped X" ending with no question and no request
- **My own messages**: `user_id == MY_USER_ID` — unless it's a commitment thread I haven't closed
- **Completed items with proof**: "Done ✓ [link]", "Shipped", "here's the file [attachment]" — must have actual proof
- **Mass group pings**: @followers / @channel / @everyone — not specifically for me or team decisions
- **Reactions-only**: emoji-only replies with no text intent

**NOISE RULE:** When in doubt — INCLUDE. A false positive (extra task) is better than a false negative (missed task). You can always remove a task. You cannot un-miss a decision.

---

## STEP 5B — MODE B: FOLLOW-UP TRACKER (What others owe me)

Scan `ALL_MESSAGES[]` for messages sent **by me** (`user_id == MY_USER_ID`) that qualify as delegation.

### ✅ Qualify as "I asked someone to do work" if:

1. **Assignment language** — "please do", "can you", "could you", "I need you to", "complete this", "let me know", "update me", "share the", "send me", "check and reply", "can you handle" + a specific task or action
2. **Delegation with deadline** — I mentioned a person AND gave a task or deadline ("submit by Wednesday", "send by EOD")
3. **Recurring commitment** — I asked for regular updates: "daily update", "send every morning", "weekly report"
4. **Question I asked** — a direct question in a DM or thread

---

### ⚠️ CRITICAL: "Replied" ≠ "Done"

Scan the thread replies. Classify the person's reply:

**✅ RESOLVED — mark done ONLY if they sent:**
- Actual deliverable: file, link, document, report, numbers, screenshot
- Explicit completion: "done ✓", "sent", "submitted", "completed", "here it is", "shared", "uploaded", "published", "fixed"

**🔄 STILL PENDING — do NOT mark done if they replied with:**
- Acknowledgment only: "okay", "sure", "will do", "on it", "noted", "got it", "I'll do it", "working on it"
- Partial: "almost done", "in progress", "finishing up" → `status: acknowledged_not_delivered`
- No reply at all → `status: no_reply`

---

### 📅 Deadline Detection

| Pattern | Extracted deadline |
|---------|-------------------|
| "by Wednesday", "before Friday", "due Thursday" | That weekday |
| "by EOD", "by end of day" | Today 6pm |
| "by tomorrow" | Tomorrow |
| "ASAP", "urgent", "immediately" | Today |
| "this week" | Friday |
| "before the [meeting/call/launch]" | Infer from context |
| No deadline mentioned | Flag after 1 day no reply |

Compute `deadline_status`: `OVERDUE` | `DUE_SOON` | `PENDING` | `RESOLVED`.

---

### 🔁 Recurring Commitment Detection

If I asked for recurring updates ("daily", "every morning", "weekly"):
- Count updates sent in the expected period
- Sent before but stopped → `status: recurring_stopped`
- Never sent any → `status: recurring_never_started`
- Expected cadence: "daily" = 1/day, "weekly" = 1/week

Flag the specific gap (e.g. "Missing update for Apr 21, Apr 22").

---

### 🔁 Repeat Follow-up Detection (Escalation Guard)

Prior follow-ups in the same thread:
- 0 prior → normal remind
- 1 prior → firmer tone: "Hi [name], circling back again..."
- 2+ prior → do NOT auto-send. Flag `escalation_needed: true`: "You've followed up twice. Consider escalating or discussing directly."

---

Store as `FOLLOWUP_ITEMS[]`:
```
{
  what, to_whom, channel, message_id, date_asked, days_pending,
  deadline, deadline_status,
  reply_status: no_reply | acknowledged_not_delivered | recurring_stopped | recurring_never_started | resolved,
  prior_followups, escalation_needed,
  followup_priority: HIGH | NORMAL | LOW
}
```

---

## STEP 5C — FOLLOW-UP CONFIRMATION (ALWAYS CONFIRM — NEVER AUTO-SEND)

**Even if `FOLLOWUP_MODE = true`, Pickle NEVER auto-sends anything.** Always show the list, always wait for explicit user confirmation.

Print a numbered list grouped by urgency:

```
📨 FOLLOW-UPS READY TO SEND — [N] pending

🔴 OVERDUE / ESCALATION NEEDED
  1. → Jordan · "Submit plugin docs" · asked 4 days ago · deadline was Wednesday ✗
     Status: No reply received · 0 prior follow-ups sent
     Channel: #dev-team · https://app.clickup.com/...

  2. → Sam · "Daily update" · last update 2 days ago (recurring stopped)
     Status: Was sending updates, stopped Apr 20 · 1 follow-up already sent
     ⚠ You've already followed up once. Recommend: talk directly.
     Channel: DM · https://app.clickup.com/...

🟡 PENDING / ACKNOWLEDGED NOT DELIVERED
  3. → Morgan · "Send banner sizes" · asked 2 days ago
     Status: Said "on it" Apr 20 but no file received

Which ones should I send reminders for?
Reply: "1, 3" or "all" or "none".
Note: item 2 is flagged for escalation — I'll skip it unless you explicitly include it.
```

Wait for the user's reply. Then for each confirmed item:

**Message templates by situation:**

- **First follow-up, no reply:**
  `Hey [name] 👋 — just following up on [task]. Could you share an update? Thanks!`
- **First follow-up, deadline passed:**
  `Hi [name] — the deadline for [task] was [date]. Could you update me on the status? Thanks`
- **Recurring stopped:**
  `Hey [name] — I noticed the daily updates stopped after [last date]. Can you resume and send today's update? Thanks!`
- **Acknowledged but no delivery:**
  `Hi [name] — following up on [task] — you mentioned you'd handle it. Could you share the update/file? Thanks`
- **Second follow-up (firmer):**
  `Hi [name] — circling back on this again. [task] is still pending. Please update me today. Thanks`
- **`escalation_needed: true`** → Do NOT send even if user said "all". Print:
  `⚠ [name] — [task] — You've already followed up [N] times. Recommend discussing directly.`

Rules:
- Only send if `days_pending >= 1`
- Update the ClickUp task description to record the follow-up sent + timestamp
- Print `📨 Sent to [name] — [template type]`, `⏭ Skipped [name]`, `⚠ Escalation flagged: [name]`

If `FOLLOWUP_MODE = false` → show the grouped list in the final report only. Do not ask or send.

---

## STEP 6 — PRIORITY SCORING

### 🔥 CLIENT RELATIONSHIP SIGNALS — Apply FIRST, before any other scoring

When a message involves a **paying client or customer** who is frustrated, escalating, or waiting on a late deliverable — **override the base urgency and force a floor**. This check runs BEFORE all other scoring.

**Force 🟠 HIGH minimum** (even if the message would otherwise be NORMAL or LOW) when:
- Message is in a channel/DM identified as a client relationship (client name in channel, ≤5 members, or prior HIGH/URGENT items from same source)
- Message contains frustration or urgency language (any language):
  - "unreliable", "not professional", "missing", "wasted", "disappointed", "late", "overdue"
  - "report nahi aaya", "mil nahi raha", "bahut late ho gaya"
  - Client says they're blocked: "can't move forward", "need this NOW", "still waiting"
- A client-facing deliverable (report, update, document, invoice) has been requested and is ≥ 3 days overdue with no response

**Force 🔴 URGENT** when:
- Client expresses strong dissatisfaction: "core job missing", "unreliable", "reconsidering" (churn risk signal)
- Client-facing deliverable is ≥ 7 days overdue
- Client message has received zero response from the team

**Floor rule is absolute:** No client-signal item can be rated below 🟠 HIGH, regardless of channel size, message count, or scoring logic. A missed client task is worse than 10 missed internal tasks.

---

### Urgency:
- **URGENT 🔴**: blocking others NOW, deadline today, production issue, CEO/founder urgency, client churn risk
- **HIGH 🟠**: decision impacts upcoming release, multiple people waiting, commitment overdue, client frustration signal
- **NORMAL 🟡**: follow-up this week, peer request with reasonable deadline
- **LOW ⚪**: nice-to-have, soft acknowledgment, no deadline

### Importance (generic):
- +2: sender is CEO / founder / direct manager
- +1: sender is team lead / senior member
- +1: impacts product launch, pricing, or external partner
- +1: more than 2 people waiting
- −1: user is CC'd but not primary

### 🎯 Role-based boost (personalisation from prefs.json)

On top of the generic score, apply a **+1 boost** when the message aligns with `USER_ROLE` AND contains any `ROLE_KEYWORDS[]`:

| USER_ROLE | What gets boosted (+1) |
|-----------|------------------------|
| Founder / CEO | Deals, partnerships, pricing decisions, approvals, external-facing messages, investor/board items, financial commitments |
| Manager / Team Lead | Team blockers, hiring/performance asks, cross-team coordination, escalations from reports |
| Developer / Engineer | PR reviews, production incidents, bug escalations, deploy blockers, spec clarifications |
| Designer / UX | Design reviews, Figma feedback, component decisions, brand approvals |
| Marketing / Content | Copy approvals, launch timing, title/headline changes, campaign decisions, content reviews |
| Sales / BD | Deal updates, partner requests, contract asks, quote approvals, intro requests |
| Customer Success | Escalations, refund asks, churn risks, complaint threads, renewals |
| QA / Testing | Release blockers, bug verifications, test plan approvals |
| Product Manager | Spec questions, prioritisation calls, roadmap decisions, scope changes |
| Operations / Finance / HR | Policy questions, approvals, compliance items, hiring/payroll |

### 🎯 Role-context match (+1 extra)

If the message text contains ANY word from `ROLE_KEYWORDS[]` (extracted from your day-to-day description) → **+1 more**.

Example: If ROLE_CONTEXT = "I approve YouTube titles", and a DM says "sir yeh title confirm karo" — the keyword "title" matches → +1 extra.

### Final score

Final priority tier = base urgency tier → bumped one level UP if (importance_score + role_boosts) ≥ 2, OR if the message crosses multiple boost conditions.

**Floor rule:** Role can only BOOST priority, never lower it below its base tier. Role is a lens, not a veto.

---

## STEP 7 — CONTEXT MEMORY + DEDUPE

### Context memory

Read `~/.claude/skills/pickle-clickup/state.json` (create if missing):
```json
{
  "actioned_messages": {
    "<message_id>": {
      "task_id": "abc123",
      "actioned_at": "2026-04-22T09:00:00Z",
      "kind": "inbox"
    }
  }
}
```

**Skip any message whose `message_id` is in `actioned_messages` UNLESS** the message got new replies after `actioned_at` (treat as new event).

**Stored:** message IDs + task IDs + timestamps only. **No message content. No personal info.** Delete the file to reset.

### Local dedupe

Call `clickup_filter_tasks` on `TASK_BOARD_ID`. Skip creating if same task name exists and was created today, or description already contains the same `message_id` link.

---

## STEP 8 — CREATE TASKS

### For MODE A (Inbox) items:

**Source link construction (REQUIRED for every task):**
```
SOURCE_URL = [if chat message]  https://app.clickup.com/[WORKSPACE_ID]/chat/r/[channel_id]/t/[message_id]
           = [if task comment]  https://app.clickup.com/t/[task_id]?comment=[comment_id]
           = [if doc mention]   https://app.clickup.com/[WORKSPACE_ID]/docs/[doc_id]
```
This is the 1-click jump back to the original message. **Never omit the source link.**

Call `clickup_create_task`:
```
list_id:   TASK_BOARD_ID
name:      [action verb] + [description] (max 80 chars)
priority:  1=urgent / 2=high / 3=normal / 4=low
due_date:  URGENT=today · HIGH=tomorrow · NORMAL=end of week · LOW=next week
assignees: [MY_USER_ID]
tags:      ["pickle", "pickle-clickup"]
description:
  🔗 SOURCE (1-click): [SOURCE_URL]
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  📍 CONTEXT
  From: [sender] | In: [channel name OR task name]
  Type: [chat channel / DM / group DM / task comment / task comment reply]
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
  🥒 pickle-clickup · by Aditya Sharma
  github.com/adityaarsharma/pickle
```

After creating, write the `message_id → task_id` entry into `state.json`.

### For MODE B (Follow-up) items:

**Priority:**
- `OVERDUE` / `escalation_needed` / `recurring_stopped` → `high`
- `acknowledged_not_delivered` / `DUE_SOON` → `normal`
- `no_reply` < 2 days → `normal`

**Due date:**
- `OVERDUE` → today · `DUE_SOON` → deadline date · `PENDING` → today + 1 day · `recurring_stopped` → today

**Source link (REQUIRED):** Use the URL of MY original message (the ask), not their reply.

Call `clickup_create_task`:
```
list_id:   TASK_BOARD_ID
name:      [emoji] Follow up → [their name]: [what was asked] (max 80)
priority:  [rules above]
due_date:  [rules above]
assignees: [MY_USER_ID]
tags:      ["pickle", "pickle-clickup", "follow-up"]
description:
  🔗 SOURCE (1-click): [SOURCE_URL of my original ask]
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  📍 WAITING ON: [their name]
  Asked on: [date] ([days_pending] days ago)

  📝 WHAT I ASKED
  "[my original message quote]"

  ⏳ STATUS: [one of]
  ❌ No reply received
  🔁 Recurring stopped
  💬 Acknowledged but not delivered
  🔴 OVERDUE
  ⚠ Escalation needed

  📅 DEADLINE: [deadline or "none given"]

  📋 OPTIONS
  • Reply in the thread directly
  • Run /pickle-clickup [time] followup to confirm + send a reminder
  • Mark task complete if resolved offline

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🥒 pickle-clickup · by Aditya Sharma
  github.com/adityaarsharma/pickle
```

---

## STEP 9 — PRINT FINAL REPORT

```
════════════════════════════════════════════════════
  🥒 pickle-clickup · by Aditya Sharma
  📅 [DATE] · ⏱ [TIME_LABEL]
════════════════════════════════════════════════════

📬 MY INBOX — Needs my action

  🔴 URGENT ([N])   • [task name] — [sender / channel] → [URL]
  🟠 HIGH   ([N])
  🟡 NORMAL ([N])
  ⚪ LOW    ([N])

────────────────────────────────────────────────────

⏳ FOLLOW-UP TRACKER — Pending from others

  • [what] → waiting on [name] · [N days] · [thread URL]
  [If FOLLOWUP_MODE confirmed + sent: "  ✅ Reminder sent"]
  [Else: "  💡 Run /pickle-clickup followup to confirm + send"]

────────────────────────────────────────────────────

📊 STATS
  Inbox tasks created  : [N]
  Follow-up tasks      : [N]
  Sources scanned      : [N] channels · [N] DMs · [N] group DMs · [N] active tasks
  Messages in window   : [N] chat messages · [N] task comments
  Already actioned (memory skipped) : [N]
  Skipped (errors)     : [channel names or "none"]

🔗 Task board → https://app.clickup.com/[WORKSPACE_ID]/

════════════════════════════════════════════════════
  Re-run: /pickle-clickup [time]
  With follow-up: /pickle-clickup [time] followup
  Slack counterpart: /pickle-slack [time]
  Docs: https://github.com/adityaarsharma/pickle
────────────────────────────────────────────────────
  🥒 Built and Shipped by Aditya Sharma
════════════════════════════════════════════════════
```

If zero items found:
```
✅ All clear — no ClickUp action items or pending follow-ups in [TIME_LABEL].
   Channels scanned: [N] · Messages reviewed: [N]

  🥒 Built and Shipped by Aditya Sharma
```
