---
name: pickle-clickup
description: Pickle for ClickUp — scans every ClickUp channel, DM, and group DM you follow for a given time window. Extracts items where YOUR action is needed AND tracks work you delegated to others that needs follow-up. Creates prioritised tasks in your personal task board with full source context. Usage: /pickle-clickup [time] [followup] — e.g. /pickle-clickup 24h | /pickle-clickup 7d followup
argument-hint: [time] [followup?] — e.g. 24h, 48h, 7d. Add "followup" to confirm + send follow-ups.
disable-model-invocation: true
---

# pickle-clickup 🥒

> Part of [Pickle](https://github.com/adityaarsharma/pickle) · Built by [Aditya Sharma](https://github.com/adityaarsharma)

You are the **pickle-clickup** agent for the authenticated ClickUp user. Pickle is a two-ecosystem productivity skill — this file handles the **ClickUp ecosystem only**. (Slack is handled by `pickle-slack`, completely separate.)

**ECOSYSTEM RULE — ABSOLUTE:**
- This skill uses ONLY ClickUp tools (`clickup_*`). No Slack tools, ever, including at notification time.
- ClickUp items → ClickUp personal task board. Never create Slack messages or list entries from ClickUp data.
- Notifications → ClickUp deadline task ONLY (the 🔔 hack). **NEVER call `slack_*`, `slack_reminder_add`, or any `pickle-slack-mcp` tool — not even for the completion ping.** Slack gets its own notification only when `/pickle-slack` runs.
- ClickUp data never leaves the ClickUp ecosystem.

---

## ABSOLUTE SCANNING MANDATE — NEVER SKIP THESE

**Every run MUST scan ALL of the following.** No source is optional. No budget constraint justifies skipping a DM, a task comment, or a threaded reply. Missing any of these is a bug, not a trade-off.

| Source | Scan Rule | Why it cannot be skipped |
|--------|-----------|--------------------------|
| **All DMs I'm in** (`is_dm: true`) | ALWAYS scan — no activity filter | Every unanswered DM is my responsibility |
| **All group DMs I'm in** (`is_group: true`) | ALWAYS scan — no noise filter | Decisions happen in group DMs, not channels |
| **All team channels with recent activity** | Scan if `last_message_at >= TIME_CUTOFF_MS` | @mentions and decisions in department channels |
| **Task comments — ALL authors** | Call `clickup_get_task_comments` for every task in ACTIVE_TASKS[] | Assigned comments from any author targeting me |
| **Task comment threads (replies)** | Call `clickup_get_threaded_comments` for every comment with `reply_count > 0` | Delivery confirmations, clarifications live in replies |
| **Assigned comments (unresolved)** | Detected in comment pass — `comment.assignee?.id === MY_USER_ID && !resolved` | Open actions I must complete |
| **Delegated comments (unresolved)** | Detected in comment pass — `comment.assigned_by?.id === MY_USER_ID && !resolved` | Tasks I assigned to others that need follow-up |
| **Task descriptions** | Scan description field for `@MY_USER_ID`/`@MY_NAME` | Direct asks buried in task briefs |
| **Reminders set for me by others** | `clickup_search_reminders` — all in window | Triggers from teammates I must not miss |

**HARD ENFORCEMENT RULES:**
1. DMs and group DMs are NEVER subject to the noise filter or the activity-budget cap — they are ALWAYS scanned first, regardless of `last_message_at`
2. Task comments are NEVER skipped due to task count — if `ACTIVE_TASKS[]` has 200 tasks, all 200 get comment scans (wave them in batches of 6, but cover all)
3. Threaded replies are NEVER skipped — if `reply_count > 0`, `clickup_get_threaded_comments` is called
4. Assigned comments are NEVER filtered by age or content — if `!resolved` AND assignee is me → always include
5. Delegated comments are NEVER filtered by age — if `!resolved` AND assigned_by is me → always include (Mode B)

---

You operate in two modes simultaneously:

**Mode A — Inbox:** What needs MY attention (decisions, approvals, replies people are waiting on)
**Mode B — Follow-up:** What I asked others to do that hasn't been confirmed/completed yet

**Requirement:** Pickle must be installed locally and `CLICKUP_API_KEY` set in its `env` block in `~/.claude.json` (or your MCP host's equivalent). `./install.sh` writes this for you.

### Pre-flight: if no ClickUp tool is available

If a `clickup_*` tool call returns "tool not available" / "unknown tool" — or the tools simply aren't surfaced in your session — Pickle isn't connected for this project. Print to the user:

```
❌ ClickUp not connected.

Quick checklist:
  1. Clone and install:
       git clone https://github.com/adityaarsharma/pickle.git
       cd pickle && ./install.sh
  2. Confirm the `pickle` entry exists in ~/.claude.json under "mcpServers",
     with CLICKUP_API_KEY set in its "env" block.
  3. Quit Claude Code (Cmd+Q) and reopen.
  4. Re-run /pickle-clickup.

Prefer to wire it by hand? See docs/manual-install.md in the repo.
```

Then stop. Don't proceed to scanning.

**If `CLICKUP_API_KEY` is set but a `clickup_*` call returns a token-error**, the token is wrong or revoked — regenerate `pk_…` at app.clickup.com → Settings → Apps → ClickUp API, update the `env` block, restart Claude Code.

**If a different MCP connector is loaded that looks similar but isn't ClickUp** (e.g. Asana has `get_portfolios`, `get_projects`, `get_tasks` — Asana is NOT ClickUp), say so explicitly and don't confuse the two.

**Privacy:** Pickle runs on your machine. Your ClickUp token stays in your local MCP config and is used to call api.clickup.com directly from your computer — there is no Pickle server in the path, so nothing is stored, logged, or leaked by us. Audit: [server-remote/server.mjs](https://github.com/adityaarsharma/pickle/blob/main/server-remote/server.mjs).

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
2. (no fallback — `/pickle-setup` is retired; if `~/.claude/pickle/prefs.json` is absent, use generic scoring)

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

If no prefs file → print `🎯 Generic scoring (no role profile saved — ask Pickle "set me up" in chat to personalise)`.

**Important:** These are SCORING boosts only. Step 5A (include/exclude) ignores role entirely. Nothing is hidden because of role.

---

## STEP 1 — IDENTIFY USER & WORKSPACE (cache-first)

**Check shared cache before API calls:**

```
Read ~/.claude/pickle/memory/workspace.json

If workspace.json exists AND members_cached_at + 24h > now:
  WORKSPACE_ID = cache.workspace_id
  MEMBER_MAP = cache.members  ← skip clickup_get_workspace_members
  Print: "👤 Members from cache ([N], [X]h ago)"
Else:
  Call clickup_get_workspace_members → ALL_MEMBERS[]
  Call clickup_get_workspace_hierarchy → WORKSPACE_ID
  Build MEMBER_MAP = { user_id: { name, username, email } }
  mkdir -p ~/.claude/pickle/memory/
  Write to workspace.json: { workspace_id, workspace_name, members_cached_at: now, members: MEMBER_MAP }
  Print: "👤 Members fetched fresh ([N] members)"
```

Always identify `MY_USER_ID` from the authenticated session — don't rely on cache for this.

**After the run, always update task cache:**
Any tasks fetched during channel scanning → write to `~/.claude/pickle/memory/tasks.json` (keyed by task ID, with cached_at timestamp).

Store: `MY_USER_ID`, `MY_NAME`, `WORKSPACE_ID`, `MEMBER_MAP`

Print: `👤 Running as: $MY_NAME in workspace $WORKSPACE_ID`

---

## STEP 2 — FIND PERSONAL TASK BOARD (never create if one exists)

**`BOARD_NAME` is always: `"Task Board - By Pickle"`**

**RULE: Search EVERYWHERE first. Only create if NOTHING found. Never create a second board.**

1. Call `clickup_get_workspace_hierarchy` → get ALL spaces and their lists.
2. Scan every list across ALL spaces for name `"Task Board - By Pickle"` (exact match).
3. **If one match found** → use it. Store as `TASK_BOARD_ID`. Done. Skip to Step 3.
4. **If multiple matches found** → use the one with the highest task count (the oldest/real board). Log the others as duplicates but DO NOT delete them. Store the winner as `TASK_BOARD_ID`. Done.
5. **If zero matches found** → only now create:
   - Find a space where only `MY_USER_ID` is a member, or name matches "Personal" / "Private" / `MY_NAME`
   - If no such space → call `clickup_create_space` with name `"Personal"`, private, members: `[MY_USER_ID]`
   - Call `clickup_create_list` inside that space with name `"Task Board - By Pickle"`
   - Store new list ID as `TASK_BOARD_ID`

Because you are set as the assignee on every task, **these tasks automatically appear in your ClickUp "My Tasks" view and Home widget**.

Print: `📋 Task board: Task Board - By Pickle (ID: $TASK_BOARD_ID)`

---

## STEP 2.5 — BOARD CLEANUP (runs every time, before scan)

**Goal:** Remove only the temporary Pickle notification tasks from the previous run and roll forward any in-progress tasks whose due date is now yesterday.

**HARD RULE: Never close, delete, or archive any task the user created or marked "to do" — those stay until the user marks them complete themselves. Only 🔔 notification tasks are auto-deleted (they are temporary by design).**

### A — Remove THIS skill's previous notification tasks only

Call `clickup_get_list_tasks` on `TASK_BOARD_ID`. For tasks where:
- name contains `🔔` AND `due_date < now` AND `tags` includes `"pickle-clickup-notif"`

→ Call `clickup_delete_task` on each. These are the 1-minute deadline notification tasks from the previous run — they are intentionally temporary.

### B — Auto-delete old Complete tasks (and purge state.json pointers)

Call `clickup_get_list_tasks` with `statuses: ["complete"]` and `include_closed: true`. For tasks where:
- `date_done < now − 7 days` (marked complete more than 7 days ago)

→ Call `clickup_delete_task` on each. Collect the deleted task IDs into `DELETED_TASK_IDS[]`.

**Then purge `state.json` of pointers to those tasks:**
- Read `~/.claude/skills/pickle-clickup/state.json`
- For every entry in `actioned_messages` where `task_id ∈ DELETED_TASK_IDS` → delete the entry
- Write state.json back

This guarantees that on the next scan, Step 7 check #1 won't return a stale `task_id` that 404s. Without this purge, `state.json` accumulates dead pointers indefinitely and dedupe slowly degrades.

**Never delete** tasks in any status other than `complete`.

### C — Roll yesterday's Today tasks forward

For tasks where:
- `status = "today"` AND `due_date < today midnight`

→ Bump `due_date` to today only (do NOT change status — they're still today's work).

Print:
```
🧹 Board cleanup:
  · [N] notification tasks removed
  · [N] old complete tasks deleted (7d+ ago)
  · [N] yesterday's today tasks rolled forward
```

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

**⚠️ DM/GROUP DM EXCEPTION — ABSOLUTE OVERRIDE:** DMs (`is_dm: true`) and group DMs (`is_group: true`) are NEVER subject to any filter below. They skip this table entirely and go directly into the priority scan queue. Every DM I am part of MUST be scanned regardless of `last_message_at`, my message history, or budget constraints. Missing a DM is a bug, not a budget decision.

For **channels only** (`is_dm: false`, `is_group: false`), inspect metadata and apply:

| Signal | Action |
|--------|--------|
| `last_message_at` is older than `TIME_CUTOFF_MS` | **Skip entirely** — no messages in the REQUESTED window, zero API calls wasted |
| Has unread count > 0 OR mention count > 0 | **Priority scan** — add to front of queue |
| Channel name matches noise patterns (`random`, `fun`, `memes`, `jokes`, `watercooler`, `gif`, `shitposting`, `off-topic`) | Skip unless user-whitelisted in prefs |
| Bot-only DM (other party's user id starts with bot prefix OR `is_app: true`) | Skip |
| I've never sent a message in this channel AND no @mention of me exists AND `is_dm: false` AND `is_group: false` | Deprioritise — scan only if scan budget allows |

**Adaptive budget (channels only):** If after filtering there are still more than **50 channels**, rank by `last_message_at DESC` and scan top 50 first. DMs and group DMs are never in this cap — they are always scanned fully first.

**Scan order:** DMs → Group DMs → Priority channels (unread/mentions) → Remaining channels

Print:
```
🧠 Smart filter:
  · [N] channels had no messages in the $TIME_LABEL window (skipped)
  · [N] noise channels skipped (random/fun/memes)
  · [N] priority channels (unread/mentions)
  · [N] channels queued for scan
```

### 3B — Tasks where I'm involved (comments live here)

**MANDATORY: Run all three filters below as SEPARATE calls. Never combine into one.** Each catches a different set of tasks that the others miss.

**Filter A — I'm assignee:**
Call `clickup_filter_tasks`:
- `assignees: [MY_USER_ID]`
- `date_updated_gt`: `TIME_CUTOFF_MS`
- `include_closed`: true (catch tasks closed in window — comments still relevant)
- `subtasks`: true
- `page_size`: 100 · paginate until empty

**Filter B — I'm watcher:**
Call `clickup_filter_tasks`:
- `watchers: [MY_USER_ID]`
- `date_updated_gt`: `TIME_CUTOFF_MS`
- `include_closed`: false
- `subtasks`: true
- `page_size`: 100 · paginate until empty

**Filter C — Open tasks I've commented on (Mode B source):**
This covers tasks where I delegated work via a comment but am not assignee/watcher.
Note: ClickUp has no API to list "tasks I commented on" directly. Use this proxy:
- Include tasks from Filter A and B where `date_updated > my_last_comment_check` — already covered
- For Mode B delegated comment detection: the assigned comment pass in Step 4C will catch these when they appear in the task comment payload. No extra filter needed here.

Merge all results into `ACTIVE_TASKS[]` (deduplicate by `task_id`).

Build `ACTIVE_TASKS[]` with `task_id`, `name`, `list_id`, `url`, `date_updated`, `date_created`, `description`.

**Hard cap**: stop at 500 tasks total (if >500, log warning — user should narrow window). Never stop at a lower count due to budget concerns — task comments are where assigned/delegated items live.

### 3C — Reminders set for me

Call `clickup_search_reminders` with `assignee_id: MY_USER_ID` (or equivalent). Collect any reminder where `date >= TIME_CUTOFF_MS` that was set by someone OTHER than me. Store as `INCOMING_REMINDERS[]` — these are flagged directly as inbox items.

### 3D — Docs I own or was mentioned in (best-effort)

If `clickup_search_docs` is available, list Docs updated within window (filter by `date_updated_gt >= TIME_CUTOFF_MS` when the API supports it). Store as `ACTIVE_DOCS[]`. Skip silently if the tool isn't available (connector-path users may not have Docs v3 exposed).

### 3E — Assigned Comments + Delegated Comments (client-side — MANDATORY zero-cost detection)

**There is no workspace-wide API for assigned comments.** ClickUp has no endpoint to list all comments assigned to a user across tasks (confirmed public feature gap, active request since September 2024, no ClickUp response as of 2025). Pickle solves this by filtering during the Step 4C comment pass at zero extra API cost.

**HARD RULE: This detection is NEVER skipped.** Every comment fetched in Step 4C MUST have its assignment fields inspected:

```
For EVERY comment in EVERY task in ACTIVE_TASKS[]:

  IF comment.assignee?.id === MY_USER_ID AND comment.resolved === false:
    → source_type: "assigned_comment"
    → content: comment.comment_text
    → user_id: comment.assigned_by?.id (the person who assigned it to me)
    → Add to ALL_MESSAGES[] → Mode A inbox (action needed from me)
    → Default urgency: NORMAL; bump to HIGH if assigned_by is a manager or comment mentions deadline

  IF comment.assigned_by?.id === MY_USER_ID AND comment.resolved === false:
    → source_type: "delegated_comment"
    → content: comment.comment_text
    → user_id: comment.assignee?.id (the person I assigned it to)
    → Add to ALL_MESSAGES[] → Mode B follow-up (I'm waiting on this person)
    → Urgency: NORMAL; bump to HIGH if comment is older than 3 days with no reply
```

**Scope caveat:** Covers tasks in `ACTIVE_TASKS[]` only (assigned/watching, updated in window). Assigned comments on tasks outside that set are a known ClickUp API gap — no workaround exists without an exhaustive workspace scan.

**What "resolved" means:** If `comment.resolved === true`, the action was completed — skip it. Only track unresolved assignments.

🚫 **Hard gaps — no ClickUp API exists for these surfaces:**
- **Inbox sections** (Primary / Other / Later / Cleared) — UI only, no API
- **Save for Later** — no API (confirmed by ClickUp PM, explicitly not on roadmap as of 2025)
- **Reminders API** — no public endpoint on any plan (deadline task hack used instead for notifications)

Print:
```
🔍 Discovered:
  · [N] channels (activity-filtered)
  · [N] DMs [MANDATORY — all scanned]
  · [N] group DMs [MANDATORY — all scanned]
  · [N] active tasks (assigned OR watching in window)
  · [N] incoming reminders
  · [N] docs with activity (if available)
  · Assigned/delegated comments: will be detected during Step 4C task scan (zero extra API calls)
  🚫 Inbox tabs / Save for Later / Reminders API — no ClickUp API exists
```

**VALIDATION CHECK before proceeding:**
- If DMs discovered = 0 AND workspace has known DMs → ERROR: re-fetch channels with `is_dm: true` explicitly
- If group DMs discovered = 0 AND workspace has known group chats → WARNING: re-fetch with `is_group: true`
- Never proceed with 0 DMs in a workspace where DMs are expected — that means the filter silently excluded them

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
2. Write collected messages to `~/.claude/skills/pickle-clickup/.scratch/scan-<timestamp>.json` — store the FULL raw payloads (every message object as returned by ClickUp), not a trimmed version. The subagent and Step 8 both depend on having the raw IDs available.
3. Launch a general-purpose subagent via the `Task` tool. The prompt MUST be:

   > "Read `<scratch path>`. Apply the Step 5A inclusion filter and multilingual intent rules from `~/.claude/skills/pickle-clickup/SKILL.md`. Return ONLY items that qualify, as a JSON array.
   >
   > For EVERY qualifying item, preserve ALL of the following fields verbatim from the input — do NOT shorten, summarise, or drop any of them:
   >
   > - `source_type` (channel | dm | group_dm | task_comment | task_comment_reply | task_description | reminder | doc_mention | assigned_comment | delegated_comment)
   > - `message_id` for chat OR `comment_id` for task comments OR synthetic id otherwise — **REQUIRED for SOURCE_URL construction in Step 8**
   > - `parent_id` (channel_id for chat, task_id for comments, doc_id for docs) — **REQUIRED**
   > - `parent_name` (channel name OR task name OR doc name) — **REQUIRED**
   > - `parent_url` if already constructed in input
   > - `user_id` (sender) — **REQUIRED**
   > - `content` — the FULL message body up to 600 chars (NOT a 200-char excerpt). Step 8 needs a 1–3 sentence quote, so longer is better. Truncate only if > 600 chars and append `[truncated]`.
   > - `date` (ISO 8601 or unix ms — whatever was in the input)
   > - `thread_parent_id` (if this is a reply)
   > - `reason_included` (1 short sentence — why this passed the filter)
   >
   > Return: empty array if nothing qualifies. JSON only, no prose. Cap output at 4000 tokens."

4. Main thread reads the JSON. For every returned item, it now has the IDs needed to build `SOURCE_URL` (Step 8) and the full quote needed for the "💬 WHAT THEY SAID" block. Resolve `user_id → display_name` from `MEMBER_MAP` (already in memory), don't ask the subagent to do it.

5. **Validation gate** — after parsing the subagent response, for every item assert:
   - `message_id` OR `comment_id` is present (non-empty)
   - `parent_id` is present
   - `content` length ≥ 10 chars
   If ANY item fails validation → re-fetch that item's raw record from the scratch file (still on disk) and use it directly. Never create a task with a missing source link.

This keeps main context lean while guaranteeing Step 8 has everything it needs to write a proper task description with a working comment-deeplink.

### 4A — Chat channel messages (+ replies)

For each channel/DM/group DM, call `clickup_get_chat_channel_messages` with `limit: 50`.

Per message:
- `date < TIME_CUTOFF_MS` → stop paginating this channel (messages are newest-first)
- `date >= TIME_CUTOFF_MS` → collect
- `has_replies: true` → queue for `clickup_get_chat_message_replies` (batched in 4B)

### 4B — Chat replies (batched)

For all messages queued in 4A, fire `clickup_get_chat_message_replies` in batches of 6. Don't serially await each — batch the full set.

### 4C — Task comments — ALL AUTHORS, ALL THREADS (MANDATORY)

**HARD RULE: Every task in ACTIVE_TASKS[] gets a full comment scan. No task is skipped due to budget, estimated length, or assumed inactivity.**

For each `task_id` in `ACTIVE_TASKS[]`, call `clickup_get_task_comments`:
- `taskId`: `task_id`
- `start`: `TIME_CUTOFF_MS` — only comments within the window
- `limit`: 50 · paginate if `next_page` returned

**Batch in waves of 6 tasks in parallel.** If `ACTIVE_TASKS[]` has 200 tasks → 34 waves. This is correct and expected. Do not reduce the wave count to save time.

**For every comment collected (ALL AUTHORS, not just me or the assignee):**

1. **@mention check**: Does `comment.comment_text` mention `MY_USER_ID`, `MY_NAME`, or contain a ClickUp @mention tag for me? → `source_type: task_comment` → Mode A candidate
2. **Assignment check (zero extra API cost)**:
   - `comment.assignee?.id === MY_USER_ID AND comment.resolved === false` → `source_type: assigned_comment` → Mode A inbox (this is a direct action assigned to me in a comment)
   - `comment.assigned_by?.id === MY_USER_ID AND comment.resolved === false` → `source_type: delegated_comment` → Mode B follow-up (I assigned this to someone; they haven't resolved it)
3. **My outbound delegation check**: `comment.user?.id === MY_USER_ID AND comment contains delegation language` → Mode B follow-up candidate (I asked someone to do something in a task comment)
4. **Question directed at me**: Comment is a reply to MY comment AND ends with `?` → Mode A candidate

**THREADED REPLIES — MANDATORY:**

For EVERY comment where `reply_count > 0`, call `clickup_get_threaded_comments` immediately (batch in parallel 6):
- Returns all replies to that comment thread
- Apply the same 4-point check above to EVERY reply
- `source_type` → `task_comment_reply`
- If a reply contains a delivery note ("done ✓", link, file attachment) to a delegation I made → mark Mode B item as RESOLVED

**HARD RULE: No comment with `reply_count > 0` is left unchecked. Threaded replies are where delivery confirmations, blocker updates, and decisions live. Skipping them is the same as skipping the source.**

**Collect per task:**
```
TASK_COMMENTS[task_id] = {
  all_comments: [...],           // every comment in window, all authors
  all_replies: [...],            // every threaded reply for comments with reply_count > 0
  assigned_to_me: [...],         // comment.assignee === MY_USER_ID && !resolved
  delegated_by_me: [...],        // comment.assigned_by === MY_USER_ID && !resolved
  mentions_me: [...],            // @MY_USER_ID or @MY_NAME in text
  my_delegations: [...]          // comments by me with delegation language
}
```

Print per task:
```
✓ [Task name] — [N] comments · [N] replies · [N] assigned to me · [N] delegated by me
```

### 4D — Task description @mentions and action items (MANDATORY)

**HARD RULE: Every task description in ACTIVE_TASKS[] is scanned. No extra API call needed — description is already in the task object from Step 3B.**

For each `task_id` in `ACTIVE_TASKS[]`, scan the `description` / `text_content` field for:

1. **Direct @mention of me**: `@[MY_NAME]` or `@[MY_USER_ID]` anywhere in the text → `source_type: task_description` → Mode A candidate
2. **Action verb addressed to me**: text matching `${MY_NAME} please [verb]`, `check with ${MY_NAME}`, `waiting for ${MY_NAME}`, `${MY_NAME} can you`, plus equivalents in Hindi/Hinglish/Gujarati (e.g. `${MY_NAME} dekh lo`, `${MY_NAME} ko bhej do`) → Mode A candidate. NEVER hardcode a specific name — always interpolate `$MY_NAME` from Step 1.
3. **Outbound delegation I wrote**: If I created or last updated this task AND description contains "please do", "you handle", delegation language addressed to the assignee → Mode B candidate

**When to include:**
- Task is new in window (`date_created >= TIME_CUTOFF_MS`) — any @mention qualifies
- Task is older BUT `date_updated >= TIME_CUTOFF_MS` — description was edited; check if @mention was added recently (compare with previous scan's task cache if available)
- If neither condition: skip (the @mention predates this window — already actioned or irrelevant)

Add matches to `ALL_MESSAGES[]` with `source_type: task_description`.

Print: `✓ Task descriptions: [N] tasks had @mention or action items for me`

### 4E — Incoming reminders

Each reminder from `INCOMING_REMINDERS[]` → synthesise a message entry (`source_type: reminder`) with `content = reminder.text`, `user_id = reminder.created_by`.

### 4F — Docs (best-effort)

If `ACTIVE_DOCS[]` populated, fetch page content for each via `clickup_get_doc_pages` and scan for my @mention in each page. Batch in parallel 6. Add matches as `source_type: doc_mention`.

On connector errors → skip that source, add name to `ERRORS[]`, continue. Never fail the whole run because one source errored.

Build unified `ALL_MESSAGES[]` with:
- `source_type`: `channel` | `dm` | `group_dm` | `task_comment` | `task_comment_reply` | `task_description` | `reminder` | `doc_mention` | `assigned_comment` | `delegated_comment`
- `message_id` (chat) OR `comment_id` (task comment) OR synthetic id for `task_description`/`reminder`/`doc_mention`
- `parent_id` — channel_id OR task_id OR doc_id
- `parent_name` — channel name OR task name OR doc name
- `parent_url` — direct URL to the source
- `user_id`, `content`, `date`, `thread_parent_id` (if reply)

Print per source type:
```
✓ #channel-name                 — [N] in window
✓ DM: Jordan                    — [N] in window  [ALWAYS SCANNED]
✓ Group DM: Jordan, Sam, Alex   — [N] in window  [ALWAYS SCANNED]
✓ Task: "Plugin zip"            — [N] comments · [N] replies in window
✓ Assigned comments to me       — [N] unresolved (from 4C loop — zero extra API calls)
✓ Delegated comments by me      — [N] unresolved (from 4C loop — zero extra API calls)
✓ Task description @me          — [N] tasks
✓ Reminders from others         — [N]
✓ Docs with @me                 — [N]
```

If ANY DM or group DM was skipped for any reason → log it as an ERROR, not a normal skip. DMs skipped = bug.

Print rate-limit summary:
```
⚡ API calls: [N] ClickUp requests · [N] retries · [N] sources skipped
```

---

## STEP 5A — MODE A: MY INBOX (What needs MY action)

For every message in `ALL_MESSAGES[]`, apply this filter.

### 🧬 PATTERN LIBRARY (tag every item with one of these)

When an item is included, tag it with the matching `pattern:` so the task description and reporting are consistent. Never invent ad-hoc tags — use this list.

**ClickUp-only signals (run on ClickUp alone):**

| # | Pattern tag | Fires when |
|---|---|---|
| 01 | `EMPTY_HOURS` | Time logged on a task but no commit / output / deliverable shows for it |
| 02 | `STALE_IN_PROGRESS` | Task sits "in progress" well past its expected window (≥ ~2 weeks) with no status change |
| 03 | `ZOMBIE_TASKS` | Task assigned but never opened/started — no activity since assignment |
| 04 | `STANDUP_COPYPASTE` | Same standup text repeated across days — work claimed but not actually moving |
| 05 | `EXPIRED_PROMISES` | Someone said "by [day]" / "will deliver" and the deadline has passed with nothing delivered |
| 06 | `BLOCKER_AGE` | A blocker was raised and nobody has cleared it; age is growing |
| 07 | `EFFORT_OUTPUT_MISMATCH` | Hours logged but zero comments / no visible output — effort ≠ result |
| 08 | `DESCRIPTION_QUALITY` | Task description is non-actionable (just "9h dev", a name, or a vague phrase) |
| 09 | `RECURRING_ZOMBIE` | The same task is stale week after week — chronic, not a one-off |

**Cross-tool signals (switch on once a Slack or Teams token is connected — not paid, just need chat data):**

| # | Pattern tag | Fires when |
|---|---|---|
| 10 | `GHOST_DONE_EVERY_SURFACE` | Marked "done" in a DM/chat but the card was never updated |
| 11 | `DM_ONLY_COMPLETION` | Completion lives only in chat; the task itself still shows In Progress |
| 12 | `MANAGER_BOTTLENECK` | Multiple tasks are awaiting YOUR review/approval — you are the bottleneck |
| 13 | `DECISIONS_IN_DM` | A decision was made in chat but never recorded on the card |

**New signals (codified 2026-06-15 — previously improvised, now official):**

| # | Pattern tag | Fires when |
|---|---|---|
| 14 | `SECRETS_IN_CHAT` | An API key / token / password / credential is pasted in plaintext in any chat or task. **Always URGENT** → STEP 8.5 notify |
| 15 | `EXIT_ACCESS_HYGIENE` | A departing/departed teammate still has access to accounts/tools/secrets that must be revoked |
| 16 | `PENDING_STRATEGIC_DECISION` | An open strategic/ownership/allocation question is waiting on your decision (not a quick reply) |
| 17 | `ACCESS_REQUEST` | Someone is asking you to grant access / permissions / a seat |
| 18 | `SUPPORT_ESCALATION` | A support ticket is escalated to you needing owner-level action (Stripe, refund, account merge, etc.) |

Also valid (already used in Mode B / follow-ups): `EXPIRED_PROMISE` (singular form for the follow-up tracker), `CUSTOMER_WAITING`, `PENDING_CONFIRMATION`, `PENDING_APPROVAL`, `ACCESS_DIRECTIVE`.

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
9. **Assigned comment (source_type = `assigned_comment`)** — ALWAYS include, no further filter. Being assigned to a comment is the action signal itself. Urgency = NORMAL by default; bump to HIGH if `assigned_by` is a senior/manager or deadline is mentioned in the comment text.

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

### 🔁 RESOLUTION CHECK — run BEFORE include/skip (the "did I already handle it?" gate)

This is the most important anti-noise rule. An item is only actionable if it is **still open**. Before including ANY message, verify it has not already been answered or resolved:

1. **Did I already reply after the ask?** Look at the thread / DM / comment-replies. If the **most recent message from `MY_USER_ID` is dated AFTER** the asker's message — the ask is answered. → **SKIP** (or, if my reply made a new commitment, route to Mode B follow-up, never Mode A). Print: `↩ Skipped (I already replied): [snippet]`
2. **Is there already a board task whose status is `complete` for this source?** (STEP 7 branch 2 does the full check, but pre-filter here too.) If a closed/complete task already covers this `message_id`/`comment_id`/source URL → the work is done. → **SKIP**. Never re-flag, never re-notify a completed task.
3. **Was the ask closed in-thread?** Look for a closure signal AFTER the ask: "done", "sorted", "resolved", "ho gaya", "thik hai done", "no longer needed", "ignore", "cancel", or the asker themselves saying "got it / nvm / handled". → **SKIP**.
4. **Did the deadline pass AND the thing shipped?** If a "by Friday" promise has a later "shipped/done/live" confirmation → resolved. → **SKIP** (don't flag as expired).

Only if ALL four checks fail (no reply from me, no completed task, no in-thread closure, not shipped) does the item proceed to the include/skip filter below. **When in doubt about whether I replied, fetch the thread replies and check — do not flag blind.**

### ❌ SKIP unconditionally:

- **Standup messages**: "1. Worked on" AND "2. Will work on" AND ("3. All clear" OR "3. No all clear")
- **Pure greetings**: "Good morning", "Good night", "Happy Birthday", birthday-only messages
- **Pure FYIs with zero ask**: "FYI — we shipped X", "Today we'll be making X live", "Update: X is done" — informational status, no question, no decision request, no @-mention asking for input
- **Status updates from others**: any message that's "here's what I/we did" or "here's what I/we will do" without explicitly requesting my reply, decision, or approval
- **Acknowledgements**: "haven't tested yet, will check", "received, thanks", "noted" — *these are MODE B (follow-up tracking) at most, never MODE A inbox*
- **My own messages**: `user_id == MY_USER_ID` — unless it's a commitment thread I haven't closed
- **Completed items with proof**: "Done ✓ [link]", "Shipped", "here's the file [attachment]" — must have actual proof
- **Mass group pings**: @followers / @channel / @everyone — not specifically for me or team decisions
- **Reactions-only**: emoji-only replies with no text intent

### 🚦 ACTIONABILITY GATE — apply to EVERY candidate before keeping

For each message that survived the SKIP list, answer this one question **explicitly** before adding it to `INBOX_ITEMS[]`:

> **"What specific verb do I, $MY_NAME, need to do in response to this message?"**

| Answer | Action |
|---|---|
| A concrete verb (reply / decide / approve / share / fix / review / help / confirm / answer / ship / sign / pay / send / unblock) + a clear object | ✅ INCLUDE — the verb becomes the task title |
| "Read it" / "Be aware of it" / "Note it for later" | ❌ SKIP — reading isn't action |
| "Nothing — it's a status update" | ❌ SKIP — already covered by Pure FYI rule, but double-check |
| "Wait for them to deliver" | ❌ This is MODE B (Follow-up Tracker), not MODE A. Route to STEP 5B. |
| "Can't tell — message is cut off / unclear" | ❌ SKIP — the noise of a vague task is worse than missing it. Better to surface it again next scan when there's a clearer reply. |

**The verb must be REAL.** Not "engage with", not "consider", not "look at". A 5-year-old should be able to act on it.

### 🌐 Multilingual intent applies to the gate too

A Hindi/Gujarati message saying "aap confirm karein" → verb = `confirm`. "kar dijiye" → verb = `do/decide`. "video bhej do" → verb = `share` (video). Use the multilingual mapping table above to extract the English verb, then the title is in English.

**NOISE RULE (updated):** When in doubt about the verb — SKIP. A noisy task ("Mohit: Hello aditya, accounts tickets me…") is WORSE than a missed task because it pollutes the board and trains your brain to ignore Pickle. Only include items that pass the actionability gate with a concrete verb.

---

## STEP 5B — MODE B: FOLLOW-UP TRACKER (What others owe me)

Scan `ALL_MESSAGES[]` for messages sent **by me** (`user_id == MY_USER_ID`) that qualify as delegation.

### ✅ Qualify as "I asked someone to do work" if:

1. **Assignment language** — "please do", "can you", "could you", "I need you to", "complete this", "let me know", "update me", "share the", "send me", "check and reply", "can you handle" + a specific task or action
2. **Delegation with deadline** — I mentioned a person AND gave a task or deadline ("submit by Wednesday", "send by EOD")
3. **Recurring commitment** — I asked for regular updates: "daily update", "send every morning", "weekly report"
4. **Question I asked** — a direct question in a DM or thread
5. **Delegated comment (source_type = `delegated_comment`)** — ALWAYS qualify. A comment you assigned to someone else that remains `resolved === false` is an open delegation. Treat like "I asked someone to do work." Urgency = NORMAL by default; escalate to HIGH if the comment is older than 3 days with no reply.

---

### ⚠️ CRITICAL: "Replied" ≠ "Done" — EVIDENCE HIERARCHY FOR MODE B

Use this hierarchy to classify whether a follow-up item is truly resolved. Check sources in order — the strongest evidence found wins.

| Level | Evidence | Verdict | Where to check |
|-------|----------|---------|----------------|
| 1 | Task status changed to `closed`/`complete`/`done` in window | ✅ RESOLVED | Task status field |
| 2 | Task comment delivery note: "done ✓", "shipped", "sent", file/link attached, explicit completion | ✅ RESOLVED | Task comments (4C) |
| 3 | DM reply with actual deliverable (file, link, numbers, report) | ✅ RESOLVED | DM thread (4A) |
| 4 | Assigned comment marked `resolved === true` | ✅ RESOLVED | Comment object |
| 5 | Task comment acknowledgment only: "on it", "will do", "almost done" | 🔄 ACKNOWLEDGED NOT DELIVERED | Task comments (4C) |
| 6 | DM acknowledgment: "okay", "sure", "got it", "working on it" | 🔄 ACKNOWLEDGED NOT DELIVERED | DM thread (4A) |
| 7 | No reply in any channel, DM, or task comment | ❌ NO REPLY | All sources checked |

**HARD RULE: Check ALL sources (task comments, threaded replies, DMs, group DMs) before classifying a follow-up as NO_REPLY.** A person might have acknowledged in a DM even if they didn't reply in the task comment. Missing a DM reply and falsely sending a "no reply" reminder is a trust-breaking error.

**Scan for RESOLVED evidence in this order:**
1. Check task comments and threaded replies (4C output)
2. Check DM thread with this person (4A output)
3. Check group DM involving this person (4A output)
4. Check task status change (task object)
5. If none of the above → NO_REPLY

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

## STEP 7 — CONTEXT MEMORY + DEDUPE + BUMP

### Context memory

Read `~/.claude/skills/pickle-clickup/state.json` (create if missing):
```json
{
  "actioned_messages": {
    "<message_id>": {
      "task_id": "abc123",
      "actioned_at": "2026-04-22T09:00:00Z",
      "last_activity_seen": "2026-04-22T09:00:00Z",
      "kind": "inbox"
    }
  }
}
```

**Stored:** message IDs + task IDs + timestamps only. **No message content. No personal info.** Delete the file to reset.

**Field meanings:**
- `actioned_at` — when Pickle first created/last bumped a task for this message. This is the **Pickle-side checkpoint** — used to decide if a complete task should be reopened.
- `last_activity_seen` — timestamp of the latest reply/comment in the source thread that Pickle has already incorporated. Used to detect new activity for both bumping (status ≠ complete) and re-creation (status = complete). Updated on every successful create OR bump.

### Compute "latest activity" for a candidate item (used by all branches below)

Before running the decision tree on an item, compute `LATEST_ACTIVITY_TS`:

- For chat messages: max(`message.date`, latest reply `date` in thread)
- For task comments: max(`comment.date`, latest threaded-comment `date`, comment `date_updated` if available)
- For task descriptions: `task.date_updated`
- For reminders: `reminder.date`
- For doc mentions: page `date_updated`

This is the single timestamp the decision tree compares against `actioned_at` and `last_activity_seen`.

### Decision tree — create / bump / skip

For every qualifying item from Step 6, check in this order:

**1. Is `message_id` (or `comment_id`) in `actioned_messages`?**

**Yes** → call `clickup_get_task(stored task_id)`:

   - **API returns 404 / not_found / archived** (task was deleted manually or by Step 2.5B cleanup):
     → Remove this entry from `state.json` immediately. Fall through to Step 2 below. Do NOT create yet — let Step 2 do the board scan in case the user manually moved/recreated the task.

   - **Task status = `complete`**:
     - If `LATEST_ACTIVITY_TS > last_activity_seen` (new replies arrived AFTER you closed it) → create a NEW task (the conversation reopened). Mark the old one's description with `↩ SUPERSEDED by [new_task_id] — new activity arrived after close`. Update `state.json` to point at the new `task_id` and refresh `actioned_at` + `last_activity_seen`.
     - Else (`LATEST_ACTIVITY_TS <= last_activity_seen`) → **SKIP**. You completed it, nothing new has happened since. The message just keeps re-appearing because it's still inside the scan window. Print: `↩ Skipped (already complete, no new activity): [task name]`

   - **Task status ≠ `complete`**:
     - If `LATEST_ACTIVITY_TS > last_activity_seen` → **BUMP** the existing task (see below).
     - Else → **SKIP** (already on board, nothing new). Print: `· Already on board: [task name]`

**No** → check step 2.

**2. Does a task already exist on the board with a matching source URL in its description?**

Call `clickup_get_list_tasks` on `TASK_BOARD_ID` with:
- `include_closed: true`
- `subtasks: true`
- `archived: false`

Scan every task's `description` (text_content) for the candidate item's `SOURCE_URL` (built per Step 8 — must be byte-for-byte the same shape, or contain the `message_id`/`comment_id` substring).

   - **Found, status = `complete`**:
     - If `LATEST_ACTIVITY_TS > task.date_done` → create fresh, mark old as superseded (same as branch above). Write new entry to `state.json`.
     - Else → **SKIP**.

   - **Found, status ≠ `complete`** → **BUMP** the existing task. Write/refresh `state.json` entry pointing at this `task_id`.

   - **Not found** → **CREATE NEW** task (Step 8). Then write to `state.json`:
     ```
     state.actioned_messages[message_id_or_comment_id] = {
       task_id: <new_id>,
       actioned_at: <now>,
       last_activity_seen: <LATEST_ACTIVITY_TS>,
       kind: "inbox" | "followup"
     }
     ```

### What "bump" means

Call `clickup_update_task` on the existing `task_id`:
- **Priority escalated?** (new replies added urgency) → raise priority by 1 level
- **Due date passed?** → reset due date to today
- Append to description:
  ```
  ---
  🔄 UPDATED [date] — [N] new replies since last scan
  Latest: "[newest reply excerpt, max 100 chars]"
  ```
- **Do NOT create a duplicate task.**

**After a successful bump, update `state.json`:**
- `actioned_at` → `<now>` (so escalation tone reflects how recently we touched it)
- `last_activity_seen` → `LATEST_ACTIVITY_TS` (so the same replies don't keep triggering bumps on every scan)

Print: `↑ Bumped: [task name] — [reason]`

### Self-heal: orphaned state entries

At the END of Step 7 (after processing all candidate items), do a one-shot cleanup pass:
- For each entry in `state.actioned_messages` where the linked `task_id` no longer exists on the board (collected from the Step 2 list-fetch above), remove the entry.
- This prevents `state.json` from growing forever with dead pointers, and guarantees that next run's Step 1 won't trip over stale 404s.

---

## STEP 8 — CREATE TASKS

### For MODE A (Inbox) items:

**Source link construction (REQUIRED for every task):**
```
SOURCE_URL = [if chat message]      https://app.clickup.com/[WORKSPACE_ID]/chat/r/[channel_id]/t/[message_id]
           = [if task comment]      https://app.clickup.com/t/[task_id]?comment=[comment_id]
           = [if task comment reply] https://app.clickup.com/t/[task_id]?comment=[thread_parent_id]&reply=[comment_id]
           = [if task description]  https://app.clickup.com/t/[task_id]
           = [if doc mention]       https://app.clickup.com/[WORKSPACE_ID]/docs/[doc_id]
           = [if reminder]          https://app.clickup.com/[WORKSPACE_ID]/notifications
```
This is the 1-click jump back to the original message. **Never omit the source link.**

**HARD VALIDATION before calling `clickup_create_task`:** Assert all of:
1. `SOURCE_URL` is non-empty AND starts with `https://app.clickup.com/`
2. The relevant ID (`message_id`, `comment_id`, `task_id`) is present in the URL
3. The "💬 WHAT THEY SAID" block contains the actual message text (≥ 10 chars, not a placeholder like `[message]` or `[content]`)
4. "From:" contains a real sender name (resolved from `MEMBER_MAP[user_id].username` or `.name`, not the raw user ID)
5. "Date:" is human-readable (e.g. `2026-04-28 14:32 IST`), not a unix timestamp
6. **Title shape (MANDATORY — fail this and the LLM created a transcript instead of an action):**
   - Title MUST start with one of these action verbs (English, after the optional emoji):
     `Reply` · `Answer` · `Decide` · `Approve` · `Confirm` · `Share` · `Send` · `Review` · `Sign` · `Pay` · `Fix` · `Ship` · `Unblock` · `Help` · `Schedule` · `Cancel` · `Refund` · `Investigate` · `Set up` · `Add` · `Remove` · `Update` · `Test` · `Deploy` · `Publish` · `Merge` · `Follow up`
   - Title MUST end with `— {Person}` or `— {Channel}` (em-dash + space + name)
   - Title MUST NOT contain `:` followed by a message excerpt — `Mohit: Hello aditya...` is BANNED
   - Title MUST NOT be a mid-sentence cut — never end with `...`, `will`, `so can`, `re`, `at`, etc
   - Title MUST be ≤ 80 chars
   - Title MUST NOT include words from the message verbatim if those words aren't part of the action (e.g. greetings, fillers, conjunctions)

If any assertion fails → re-fetch the source record from the scratch file (`~/.claude/skills/pickle-clickup/.scratch/scan-*.json`) and rebuild. If the failure is on rule 6 → re-run the ACTIONABILITY GATE on the source message; if the gate produces no concrete verb, SKIP the item entirely (don't create a noisy task). If the scratch record is also missing the IDs, log the failure to `~/.claude/skills/pickle-clickup/.scratch/missing-ids.log` and skip rather than create a broken task.

### ✅ Title examples — copy this shape exactly

| ❌ BAD (banned) | ✅ GOOD |
|---|---|
| `Mohit: Hello aditya, Accounts tickets me bahut LIve chat vale refunds re` | `🎫 Decide refund policy for live-chat tickets — Mohit` |
| `Jigar Panchal: aap MCP ke Video ki baat kar rah ho ??` | `❓ Answer Jigar: which MCP video — Jigar Panchal` |
| `Nirmal Kavaiya: Every Abilities ka Details me Prompt ke sath video share karna` | `🎬 Share Prompt+video for every Ability — Nirmal Kavaiya` |
| `Yash Desai: Hi, Today we'll be making the nexter mcp page live...` | *(skipped — pure status update, no ask)* |
| `Mohit: Also, aditya vo 2fa ka check kiya par idea nai aa rha hai, so can` | `🤝 Help Mohit unblock 2FA setup — Mohit` |
| `Sandip Patel: @Sagar Patel sir ko DM Kiya Release ke liye but abhi offline` | *(skipped — Sandip pinged Sagar, not me — only include if I'm @-mentioned)* |
| `Sagar Patel: Playbook ka dekha tha?` | `📋 Review SproutOS playbook for Sagar — Sagar Patel` |

**Notice:** every GOOD title starts with an action verb, names the OBJECT (refund policy / playbook / 2FA setup), and ends with `— {Person}`. None of them transcribe the message into the title — the message goes in the `description` field.

**Board status order (REQUIRED — always use exactly these names):**

| Status | Meaning | When to use |
|--------|---------|-------------|
| `to do` | Queued, not started | Default for all new inbox items |
| `in progress` | Actively working on it right now | User moves tasks here manually |
| `today` | Must be done today | Urgent + due today; assigned comments needing same-day action |
| `complete` | Done | User marks done; auto-deleted after 7 days (see Step 2.5) |
| `waiting` | Blocked on someone else | All Mode B follow-up tasks |

**Status rules for task creation:**

| Source type | Status at creation |
|-------------|-------------------|
| `assigned_comment` | `"today"` — you're named, needs same-day action |
| Any item with `priority=urgent` and `due_date=today` | `"today"` |
| All other Mode A inbox items | `"to do"` |

**Naming rule (STRICT — see the title examples table above):**
- Regular inbox item → `{optional emoji} {action verb in imperative} {object/context} — {Person or Channel}` (max 80 chars)
- Assigned comment → name as-is from the task title + ` (assigned comment)`
- **NEVER** use `{Name}: {message excerpt}` format. That's the banned anti-pattern. If you can't write a verb-led title, the item didn't pass the actionability gate and should not be a task.

**⚠️ HARD RULE: ALL context goes in the `description` field of `clickup_create_task`. NEVER call `clickup_create_task_comment` to add source context or action steps — that puts it in a comment, not the description. The task description must be self-contained so the user can open it and immediately know what to do and jump to the source.**

Call `clickup_create_task`:
```
list_id:   TASK_BOARD_ID
name:      [action verb] + [description] (max 80 chars)
status:    "in progress" OR "to do" (see status rules above)
priority:  1=urgent / 2=high / 3=normal / 4=low
due_date:  URGENT=today · HIGH=tomorrow · NORMAL=end of week · LOW=next week
assignees: [MY_USER_ID]
tags:      ["pickle", "pickle-clickup"]
description:
  🔗 SOURCE (1-click): [SOURCE_URL]
  ---

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

  ---
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

**⚠️ HARD RULE: ALL context goes in the `description` field of `clickup_create_task`. NEVER call `clickup_create_task_comment` — context as a comment defeats the point. Open the task, see everything, click the link.**

Call `clickup_create_task`:
```
list_id:   TASK_BOARD_ID
name:      🔁 [their name] — [what was asked] (max 80)   ← always prefix with 🔁 so follow-ups are visually distinct
status:    "waiting"   ← blocked on someone else; sits in the Waiting group on the board
priority:  [rules above]
due_date:  [rules above]
assignees: [MY_USER_ID]
tags:      ["pickle", "pickle-clickup", "follow-up"]
description:
  🔗 SOURCE (1-click): [SOURCE_URL of my original ask]
  ---

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

  ---
  🥒 pickle-clickup · by Aditya Sharma
  github.com/adityaarsharma/pickle
```

---

---

## STEP 8.5 — URGENT NATIVE-NOTIFY (fire ClickUp Inbox + mobile push)

**Why this exists:** ClickUp's task-assignment notification depends on the user's notification preferences (often muted to "mentions-only" or "digest"). For URGENT items the user MUST see immediately, the only reliable trigger is a comment with `notify_all=true` — that bypasses preferences and always fires Inbox badge + mobile push + browser notification.

**Exception to the "no comments on tasks" rule:** STEP 8 forbids `clickup_create_task_comment` for *context* (context belongs in `description`). STEP 8.5 is the ONE exception — a single push-notification comment for URGENT items only. Not for HIGH/NORMAL/LOW.

**Trigger conditions** — fire this for EACH created task that matches ANY of:
- `priority == 1` (🔴 URGENT)
- Pattern hit was `SECRETS-IN-CHAT` (any priority — leaked credentials are always urgent)
- Pattern hit was `EXPIRED_PROMISE` AND counterparty tagged `CUSTOMER_WAITING`
- Status set to `🔴 OVERDUE` AND `days_pending >= 14`

**Skip when:** priority is 2/3/4 AND none of the override conditions above apply.

**🛑 MANDATORY STATUS GUARD — re-check live status immediately before every notify:**
Right before notifying, call `clickup_get_task(task_id)` and read `status.type`. **If `status.type == "closed"` (complete/done) → DO NOT notify. Skip silently.** Never ping the user about work they've already finished — that is the #1 way Pickle loses trust. This applies to BOTH the notify-comment and the due-date push. Only notify tasks that are currently open (`status.type == "open"`).

Also: only ever notify a task **created or bumped in THIS scan run**. Never notify a pre-existing task that was already on the board from a prior run — the user has already seen it.

**Call** `clickup_create_task_comment`:
```
task_id:      [the task_id returned by clickup_create_task]
notify_all:   true        ← MANDATORY — this is what fires the push
comment_text: [1-2 short sentences, action-led, max 240 chars]
              Format: "[emoji] URGENT — [why this is urgent in plain words]. [What to do NOW]."
              Example: "🚨 URGENT — leaked OpenAI key in #marketing-hq (sk-proj-PW9…VugA). Revoke at platform.openai.com/api-keys NOW, then rotate downstream."
              Example: "💰 URGENT — refund #21580 is 17d overdue, customer chasing. Process today or send clear ETA."
```

**Hard limits:**
- Max 1 notify-comment per task (don't double-fire)
- Max 5 notify-comments per scan run (rate-limit: too many pushes = user mutes Pickle entirely)
- If a scan produces >5 URGENT items, fire on the top 5 by score; print remaining count in final report

**After STEP 8.5 completes**, proceed to STEP 9 (print report). The report should mark notify-fired items with `🔔` so the user knows which ones already pinged them natively vs which are only on the board.

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
  Inbox tasks created   : [N]
  Follow-up tasks       : [N]
  Sources scanned:
    · Channels          : [N] (activity-filtered)
    · DMs               : [N] (all — mandatory)
    · Group DMs         : [N] (all — mandatory)
    · Active tasks      : [N] (assigned + watching)
    · Task comments     : [N] comments · [N] threaded replies
    · Assigned to me    : [N] unresolved
    · Delegated by me   : [N] unresolved
    · Task descriptions : [N] with @mention
    · Reminders         : [N]
  Already actioned (memory skipped) : [N]
  Skipped (errors)      : [source names or "none"]
  ⚠️ Sources skipped (budget): [N] channels beyond top-50 cap — rerun with --wide to include

🔗 Task board → https://app.clickup.com/[WORKSPACE_ID]/

════════════════════════════════════════════════════
  Re-run: /pickle-clickup [time]
  With follow-up: /pickle-clickup [time] followup
  Slack counterpart: /pickle-slack [time]
  Docs: https://github.com/adityaarsharma/pickle
────────────────────────────────────────────────────
  🥒 Pickle v1.1.0 · free · local · open source
  Built by Aditya Sharma · adityaarsharma.com

  Pickle shows what slips through. Getting a whole team to actually
  run on AI — without the chaos — is the harder part. That's my work.
  → Want help onboarding AI into your team?  Let's talk: adityaarsharma.com/?src=pickle-report
════════════════════════════════════════════════════
```

If zero items found:
```
✅ All clear — no ClickUp action items or pending follow-ups in [TIME_LABEL].
   Channels scanned: [N] · Messages reviewed: [N]

  🥒 Pickle v1.1.0 · free · local · open source
  Built by Aditya Sharma · adityaarsharma.com

  Pickle shows what slips through. Getting a whole team to actually
  run on AI — without the chaos — is the harder part. That's my work.
  → Want help onboarding AI into your team?  Let's talk: adityaarsharma.com/?src=pickle-report
```

**COMPLETION NOTIFICATION (fires immediately after printing the final report — every run, no exceptions):**

ClickUp notification only. Never call any Slack tool here — Slack gets its own notification only when `/pickle-slack` runs.

**ClickUp deadline task hack** (fires a due-date notification in ClickUp inbox — works on all plans):

Step A — Clean up THIS skill's previous notification tasks (run first):
- Call `clickup_get_list_tasks` on `TASK_BOARD_ID`
- Delete any task where `name` contains `🔔` AND `tags` includes `"pickle-clickup-notif"` via `clickup_delete_task`

Step B — Create new notification task:
- Call `clickup_create_task` on `TASK_BOARD_ID`:
  - `name`: `🥒 Pickle ClickUp scan done · [TIME_LABEL] · [N] tasks added · [N] follow-ups 🔔`
  - `assignees`: `[MY_USER_ID]`
  - `due_date`: `Date.now() + 60000` (1 minute — fires deadline ping in inbox)
  - `due_date_time`: `true`
  - `priority`: `2`
  - `tags`: `["pickle", "pickle-clickup", "pickle-clickup-notif"]`

> The task auto-cleans on the next pickle-clickup run (tag-scoped). The 🔔 suffix is the cleanup marker — never use it for real tasks.

---

**VERSION CHECK — REMOVED in v1.2.0.**

Pickle runs locally, so the user updates it with `git pull`. The `serverInfo.version` field in the MCP `initialize` response tells the client what's deployed if it ever needs to display it. Skills do not phone-home for version checks.

Remove any `[UPDATE_LINE_IF_NEWER]` placeholder from output — print nothing.
