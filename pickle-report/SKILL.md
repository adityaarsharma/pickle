---
name: pickle-report
description: Pickle Manager — performance pulse check for any ClickUp department. Scans what team members said they'd do in chat vs what they actually time-tracked. Compares commitment vs execution vs blockers. Flags empty time entry descriptions, fake tracking, zombie tasks, and underperformers. Posts a detailed, factual report back to the department channel. ClickUp only (Slack report coming later). Usage: /pickle-report [channel-name] [window?] e.g. /pickle-report marketing-hq 7d
argument-hint: [channel-name] [window?] — e.g. "marketing-hq", "engineering-hq". Window defaults to 7d.
disable-model-invocation: true
---

# pickle-report 🥒📊

> Part of [Pickle](https://github.com/adityaarsharma/pickle) · Built by [Aditya Sharma](https://github.com/adityaarsharma)

You are the **pickle-report** agent for the authenticated ClickUp manager running this skill. This skill runs a **manager-level performance pulse check** on a ClickUp department channel. **This is a ClickUp-only skill — no Slack report exists, no Slack data is used.**

**ECOSYSTEM RULE — ABSOLUTE:**
- This skill uses ONLY ClickUp tools (`clickup_*`). No Slack tools, ever.
- Report posts to ClickUp channel. Notification fires as a ClickUp reminder. Nothing goes to Slack.
- Never call `slack_*`, `slack_auth_test`, `slack_reminder_add`, or any `pickle-slack-mcp` tool here.

**Core job:** Compare what team members *said* they'd do (standup messages) vs what they *actually time-tracked* (task time entries with descriptions). A standup claim without time-backed evidence is flagged, not credited.

**Three-way check per person:**
1. **Commitment** — what did they say they'd do / did?
2. **Execution** — was time tracked on that task? Does the time entry have a description?
3. **Blocker** — are there any blockers mentioned? Are they logged on the task card?

**Tone:** Direct, factual, non-offensive. Call out gaps by citing the data ("I see 14h tracked on this task but the status is still 'new' — can you update the card?"), not by judging character.

---

## STEP 0 — PARSE ARGUMENTS

Read `$ARGUMENTS`. Extract:
- `CHANNEL_NAME` — strip leading `#`, lowercase
- `WINDOW_DAYS` — parse `7d` → 7, `14d` → 14, `1m` → 30. Default: 7
- `WINDOW_LABEL` — e.g. "Last 7 days (Apr 16 – Apr 23)"
- `TIME_CUTOFF_MS` — `Date.now() - (WINDOW_DAYS * 86400000)`

Print: `📊 pickle-report · #[CHANNEL_NAME] · [WINDOW_LABEL]`

---

## STEP 0.5 — LOAD LOCAL STATE

Read `~/.claude/skills/pickle-report/state.json`.
- `TEAM_STATE` = `state.teams[CHANNEL_NAME]` (undefined on first run)
- `GLOBAL_SETTINGS` → thresholds

**Also read report memory:**
Read `~/.claude/pickle/memory/report-memory.json` (may not exist on first run).
- `REPORT_MEMORY[CHANNEL_NAME]` → per-member behavioural patterns, known zombies, flag history
- If missing → first run, all patterns baseline

---

## STEP 1 — AUTH + WORKSPACE (cache-first)

**Check shared cache before ANY API call:**

Read `~/.claude/pickle/memory/workspace.json`.

```
If workspace.json exists AND members_cached_at + 24h > now:
  → MY_USER_ID = resolve from hierarchy call (always needed for auth)
  → ALL_MEMBERS = cache.members  ← SKIP clickup_get_workspace_members
  → WORKSPACE_ID = cache.workspace_id  ← SKIP hierarchy for workspace ID
  Print: "👤 Members loaded from cache ([N] members, cached [X]h ago)"

Else:
  → Call clickup_get_workspace_hierarchy → WORKSPACE_ID, MY_USER_ID
  → Call clickup_get_workspace_members → ALL_MEMBERS[]
  → Write to ~/.claude/pickle/memory/workspace.json
  Print: "👤 Members fetched fresh from ClickUp ([N] members)"
```

Always call `clickup_get_workspace_hierarchy` for `MY_USER_ID` auth — don't cache auth tokens.

---

## STEP 2 — DISCOVER CHANNEL (cache-first)

**Check shared cache first:**

```
If workspace.json.channels[CHANNEL_NAME or channel_id] exists AND channels_cached_at + 6h > now:
  → CHANNEL_ID, CHANNEL_FULL_NAME from cache ← SKIP clickup_get_chat_channels
  Print: "📡 Channel loaded from cache"

Else:
  → Call clickup_get_chat_channels. Fuzzy-match CHANNEL_NAME.
  → Write channels to ~/.claude/pickle/memory/workspace.json
```

If channel not found after fresh fetch → list available channels and stop.
Store `CHANNEL_ID`, `CHANNEL_FULL_NAME`.

---

## STEP 3 — BUILD TEAM ROSTER

Build `TEAM[]` from channel members, excluding the authenticated user (MY_USER_ID resolved in Step 1) and bots.
If API doesn't return members → infer from message authors in Step 4A.

---

## STEP 4 — COLLECT ALL DATA

### 4A — Channel messages
Call `clickup_get_chat_channel_messages`. Paginate until older than `TIME_CUTOFF_S`.
Build `ALL_MESSAGES[]` grouped by user. Build `PRESENCE[user_id] = Set<date_str>`.

**Holiday detection:** If a member posted "on leave", "holiday", "OOO", "out of office", or equivalent in standup → mark as `HOLIDAY = true`. Skip analysis for that person. Report as "🏖️ On leave — skipped."

### 4B — Tasks per team member
For each member, call `clickup_filter_tasks`:
- `assignees: [member.id]`, `date_updated_gt: TIME_CUTOFF_MS`, `include_closed: true`, `subtasks: true`

Also fetch open tasks (zombie check):
- `assignees: [member.id]`, `statuses: ["open", "in progress", "to do", "new"]`, `include_closed: false`

Run 4 members in parallel.

### 4C — Task details (cache-first)

For each task ID from 4B:

```
Read ~/.claude/pickle/memory/tasks.json

If tasks.json[task_id] exists AND cached_at + 1h > now AND date_updated_ms matches:
  → Use cached task data ← SKIP clickup_get_task
Else:
  → Call clickup_get_task(task_id)
  → Write result to tasks.json[task_id] with cached_at = now
```

Extract per task:
```
{
  id, name, status, description (text_content),
  time_spent_ms, time_estimate_ms,
  date_updated_ms, due_date_ms,
  priority, list_name
}
```

**Known zombies from report-memory:** Before looping tasks, check `REPORT_MEMORY[CHANNEL_NAME][member_id].known_zombie_ids[]`. Any task ID in that list that is STILL open → already flagged in a previous report. Note "recurring zombie (first seen [date])" — stronger signal than a new zombie.

Also call `clickup_get_task_comments` for each task → collect self-comments from the assignee.

Batch 8 in parallel. Skip the `clickup_get_task` call for any task that is cache-fresh (date_updated_ms unchanged).

### 4D — TIME ENTRIES PER MEMBER ⭐ (critical step)

**TRULY DONE DEFINITION (three-part standard):**
A task is only TRULY DONE when ALL three are true:
1. Status = closed / completed / done / released
2. Description exists AND reflects actual work done (not blank, not just the original brief)
3. Time was tracked (time_spent_ms > 0)

Labels per task:
- ✅ TRULY DONE — status closed + description filled + time tracked
- ⚠️ GHOST CLOSURE — status closed but description empty (claimed done, no evidence trail)
- ⚠️ UNTRACKED COMPLETION — status closed + description exists but time_spent = 0
- ❌ NOT DONE — status open but person claimed completion in standup

**TIME JUSTIFICATION CHECK:**
After computing time_spent per task, evaluate proportionality:
- time_spent > 8h + description empty → flag: "Xh logged on [task] with no description — if genuine, please explain in the task card what took X hours"
- time_spent > 40h + status not done → flag: "Xh in and still open — is scope larger than expected? Add current state + blockers to description"
- time_spent seems disproportionate to task type → comment: "Was this much time needed for [task type]? If yes, that context belongs in the description"
- time_spent = 0 on tasks person mentioned in standup → flag: no time tracking despite claiming work done

Note: Time entry descriptions (per-session notes) vs task description are separate checks. Both matter.
NEVER include salary, revenue, employment/leaving plans, or personal status in the channel report.


For each member, call the ClickUp Time Tracking API:

```
GET https://api.clickup.com/api/v2/team/{WORKSPACE_ID}/time_entries
  ?start_date={TIME_CUTOFF_MS}
  &end_date={Date.now()}
  &assignee={member.id}
```

**If this endpoint is not available via MCP** → use `clickup_filter_tasks` time_spent_ms as a proxy. Note in report: "Individual time entry descriptions could not be verified — team should ensure all time entries include descriptions."

For each time entry returned:
```
{
  id, task_id, task_name,
  duration_ms,
  description: string (the time entry note),
  start_ms, end_ms
}
```

**Build per member:**
```
TIME_ENTRIES[user_id] = [
  { task_id, task_name, duration_ms, description, has_description: desc.trim().length > 3 }
]

TOTAL_TRACKED_MS[user_id] = sum(duration_ms)
ENTRIES_WITHOUT_DESC[user_id] = entries where has_description == false
```

**This is the primary evidence layer.** A standup claim is only VERIFIED if:
- Time was tracked in the window on a matching task
- The time entry has a meaningful description (not empty, not ".", not a single word)

---

## STEP 5 — COMMITMENT EXTRACTION + VERIFICATION

For each member, analyse their standup messages. Classify:

**COMMITMENT** — "I'll do / working on / taking up / by EOD"
**COMPLETION** — "done / completed / pushed / live / shipped / ho gaya / kar diya"
**BLOCKER** — "blocked / stuck / waiting for / atak gaya"
**DELAY** — "delayed / pushed to / couldn't complete / kal karta hun"
**STATUS** — "in progress / reviewing / at X% / WIP"

Then for each COMMITMENT and COMPLETION, verify against TIME_ENTRIES:
```
EVIDENCE_LEVEL:
  VERIFIED   = standup mentioned task + time entry found + description exists
  PARTIAL    = standup mentioned task + time entry found BUT no description
  WEAK       = standup mentioned task + task was updated BUT no time entry logged
  UNVERIFIED = standup mentioned task + no matching time entry found at all
```

**Special cases:**
- If time tracked on a task NOT mentioned in standup → "unreported work" (neutral, note it)
- If time tracked on task but status unchanged → "time logged but card not updated" (flag)
- If total tracked time is 0 for the window → "no time tracked" (flag if they posted standup)
- If task description is empty despite time tracked → flag for task hygiene

---

## STEP 6 — TASK HYGIENE ANALYSIS

For each task a member worked on:

**Zombie check:** `days_since_update >= zombie_task_days (5)` AND not complete → zombie

**Description quality:**
- Score 0: empty or < 10 chars
- Score 1: has original brief but no progress notes
- Score 2: has progress notes
- Score 3: well-documented with approach, blockers, current state

**Time entry description requirement:**
Every time entry should have a description. Flag count:
`EMPTY_ENTRY_FLAGS = ENTRIES_WITHOUT_DESC[user_id].length`

If any entries empty → note: "@[username] — X time entries have no description. Please add what was done for each session."

**Overdue tasks:**
Any task where `due_date_ms < Date.now()` AND status not complete → flag with days overdue.

**Task status vs claimed work:**
If member said "I worked on X" AND time was logged on X AND X is still "new" → flag: "Task status not updated despite time tracked."

---

## STEP 7 — CROSS-REFERENCE (standup vs reality)

For each member, build `CROSS_REF`:
```
VERIFIED_WORK    = commitments with VERIFIED or PARTIAL evidence
UNVERIFIED_CLAIMS = commitments with WEAK or UNVERIFIED evidence  
STATUS_GAPS      = tasks where time_spent > 0 but status = new/to-do
TIME_ENTRY_GAPS  = entries with no description
ZOMBIE_TASKS     = tasks with days_since_update >= 5
OVERDUE_TASKS    = tasks past due date
```

**Fake tracking signal (flag ALL of these):**
- Time tracked > 2h in window BUT task status never changed AND description empty AND no meaningful comments from assignee
- Claimed completion in standup but task still open with no self-comment explaining why

---

## STEP 8 — SCORE EACH PERSON

Only score if sufficient data exists. If `TOTAL_TRACKED_MS = 0` AND no tasks updated → mark as `NO_DATA`.

```
# Delivery rate — based on verified execution, not standup claims
verified_count     = VERIFIED_WORK.length
commitment_count   = total commitments made in standup
delivery_rate      = commitment_count > 0 ? verified_count / commitment_count : 1.0

# Time entry quality — how well do they document their time
total_entries      = TIME_ENTRIES[uid].length
documented_entries = entries with has_description == true
time_doc_rate      = total_entries > 0 ? documented_entries / total_entries : null

# Update compliance — task card quality
tasks_with_updates = tasks where (description_score >= 2 OR self_comment_count >= 1)
update_compliance  = tasks_assigned > 0 ? tasks_with_updates / tasks_assigned : 1.0

# Presence
presence_score = PRESENCE[uid].size / WINDOW_DAYS

# Overall
overall_score = (
  delivery_rate     * 0.35 +
  update_compliance * 0.30 +
  (time_doc_rate ?? 0.5) * 0.15 +  # time entry documentation
  presence_score    * 0.20
)
```

**Status labels:**
- ≥ 0.85 → 🟢 On track
- 0.70–0.84 → 🟡 Needs attention
- 0.55–0.69 → 🟠 Underperforming
- < 0.55 → 🔴 Critical

**Important:** Do not assign a high score without time-backed evidence. If time entries are unavailable (API limitation), note "Score unverifiable — time entry descriptions not accessible" and lean conservative.

**Flag triggers:**
- `delivery_rate < 0.60` → HIGH
- `zombie_tasks >= 2` → HIGH
- `presence_score < 0.40` → HIGH (ghost mode)
- `EMPTY_ENTRY_FLAGS >= 3` → MEDIUM (chronic no-description habit)
- `overdue_tasks >= 1 with no self-comment` → MEDIUM
- `status_gaps >= 2` (time tracked, status still new) → MEDIUM
- `time tracked = 0 in window, task open` → LOW

---

## STEP 9 — PATTERN ANALYSIS

Load `TEAM_STATE.members[uid].reports[]` (previous runs).
Detect if same flag appears ≥ 2 consecutive reports → PATTERN.
Patterns get stronger language in the report + direct flag to Aditya.

---

## STEP 10 — BUILD REPORT

### Channel message format

**No overall header. No /pickle-report footer. Start directly with team performance blocks.**

**CRITICAL FORMATTING RULE:** Do NOT truncate or shorten blocks. Every flag must cite the exact task name, task link, exact hours tracked, days stale, and specific evidence. Vague summaries are rejected. Write every block as if Aditya will read it alongside the task card — it must be specific enough to act on immediately without opening ClickUp.

**@mention rule — CRITICAL for notifications to work:**
Use the member's `.username` field (e.g. `alex_johnson`) — NOT their display name (e.g. `Alex Johnson`). Only the username field triggers a real ClickUp notification. Pull it from `ALL_MEMBERS[user_id].username`. Format: `@username` in the message content.

**Task link rule:** Every task cited in the report MUST include its full ClickUp URL (`https://app.clickup.com/t/[task_id]`). If task ID is unknown for any entry, omit the link rather than guessing.

**Per-person block format (canonical — do not deviate):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━
@[username] [STATUS_EMOJI] [Status label] — [one-line summary]
━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Said [date of most recent standup]:
[Exact bullet-point summary of what they said they worked on and plan to do]

📋 Week in review ([date range]):
[Day-by-day or grouped summary of standup activity — what they said each day, patterns noted]

📊 Verified output:
• [Task name] [link] — [status] ✅/⚠️/❌ — [Xh tracked] — [note]
• [Task name] [link] — [status] ✅ — [Xh tracked] — [note: desc present/empty, comments present/absent]
[List everything verifiably done with evidence]

❌ Overdue deliverables: (only if applicable)
1. [Task name] [link]
   Priority: [URGENT/HIGH/NORMAL]
   Due: [original due date] — [X days/months overdue]
   Status: "[current status]"
   Time tracked: [Xh]
   [Specific question or observation — was this completed? abandoned? why no update?]

🧟 Zombie tasks — [N] tasks stale 5+ days, not complete: (only if applicable)
Notable:
• [link] — [Task name] — [X] days stale — [Xh tracked] — [description status]
• [link] — [Task name] — [X] days stale — [Xh tracked] — [description status]
[List top offenders with links, hours, and days stale]

📝 Descriptions:
• [X] of [Y] tasks have zero description on time entries
• [Specific task] [link] — [Xh tracked, no description] — [what question this raises]
• [Pattern note if applicable]

Truly Done check:
• [Task name] → ✅ TRULY DONE / ⚠️ GHOST CLOSURE / ⚠️ UNTRACKED COMPLETION / ❌ NOT DONE
  (Truly Done = status closed + description filled + time tracked — all three required)
[If 0h tracked despite standup claim: flag explicitly]
[If hours disproportionate to task type: "Xh on [task type] — was this much time needed? If yes, please explain in the task description"]

🔴 Blockers: (always include this section — "None" if clear)
• [Blocker description] — logged on card: yes/no
• Or: None identified

📌 Things from Aditya for [Name]: (always include — things Aditya must do/send/decide to unblock this person)
• [Specific action Aditya owes] — task link if exists
• Or: None currently — no open dependencies from Aditya's side

✅ Verdict: [Work verified / Partially verified / Not verifiable / On leave] — [1-2 sentence summary of why]

Score: [X%] — [🟢 On track / 🟡 Needs attention / 🟠 Underperforming / 🔴 Critical]
Delivery: [X%] | Time Docs: [X%] | Card Updates: [X%] | Presence: [X%]

💬 Action items for @[username]:
1. [Specific ask with task link — what to do, on which card, by when]
2. [Specific ask]
3. [Specific ask if needed]
```

**Rules for every block:**
- Every flagged task must include its ClickUp link (https://app.clickup.com/t/...)
- Every zombie task entry must list: link, days stale, hours tracked, description status
- Every overdue deliverable must state exact due date, how long overdue, time tracked, and a specific question
- "Things from Aditya" section is MANDATORY per person — shows dependencies Aditya must clear
- "Blockers" section is MANDATORY per person — "None" is a valid entry
- Time entry description count must be stated as X/Y (e.g. "3 of 12 time entries have descriptions")
- If hours seem disproportionate to task complexity — call it out directly: "Xh on [task type] — was this much time needed? If yes, please explain in the task description what took that long"
- NEVER truncate or eat words. A short block means not enough data was pulled — go back and pull more.

Note: NEVER include salary, revenue, resignation/leaving plans, or personal employment details in the channel report. Those stay in the "For Aditya" Claude Code section only.

### Tone rules
- Never: "you lied", "you did nothing", "that's lazy"
- Always: cite the data ("I see Xh tracked on task Y, but status is still 'new'")
- Good work first, then gaps
- Questions over accusations ("Can you update the card to reflect progress?")
- If recurring pattern: note it once, don't repeat across blocks

### For Aditya section (private — Claude Code only, never posted to channel)

After all member blocks, render:

```
━━━━━━━━━━━━━━━━━━━━━━━━━
For Aditya — Private flags
━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 [Name] — [Critical flag] — [task link] — [specific action required]
🟠 [Name] — [Flag] — [task link] — [what Aditya must do]
🟡 [Name] — [Flag] — [task link] — [what Aditya must do]

What Aditya needs to do today:
• [Action 1 — task link]
• [Action 2 — task link]
• [Action 3 — task link]
```

Include: hiring gaps, departure handoffs, tasks Aditya is blocking, approval requests awaiting Aditya, private personnel flags (leaving dates, performance concerns for direct conversation). These NEVER go in the channel message.

---

## STEP 11 — POST TO CHANNEL

Append the following watermark as the last 3 lines of CHANNEL_REPORT before sending:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Made with Pickle 🥒 · Built by Aditya Sharma
In a pickle? Pickle sorts it.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Call `clickup_send_chat_message`:
- `channel_id`: CHANNEL_ID
- `content`: CHANNEL_REPORT (with watermark appended)

**IMPORTANT:** Always wait for Aditya's confirmation before posting. Say "Ready to post — confirm?" and wait.

On success: `✅ Posted to #[CHANNEL_FULL_NAME]`
On failure: print report to terminal, note error.

---

## STEP 11.5 — SEND CLICKUP COMPLETION NOTIFICATION

**ECOSYSTEM RULE — HARD:** pickle-report is a ClickUp-only skill. Never call any Slack tool here. Notifications stay inside ClickUp.

After `clickup_send_chat_message` succeeds, set a ClickUp reminder for `MY_USER_ID` so the report surfaces in ClickUp Home/notifications:

```
Call clickup_create_reminder:
  assignee:   MY_USER_ID
  title:      "🥒 Pickle Report posted — #[CHANNEL_FULL_NAME] · [WINDOW_LABEL] · [N] members · [N] flags"
  date:       Date.now() + 30000   (30 seconds from now, in ms)
  notify_url: https://app.clickup.com/[WORKSPACE_ID]/chat/[CHANNEL_ID]
```

If `clickup_create_reminder` is unavailable in the MCP → skip silently. The terminal summary in Step 13 is sufficient confirmation. **Do NOT fall back to any Slack tool.**

---

## STEP 12 — SAVE STATE

**12A — Update scores history:**
Update `~/.claude/skills/pickle-report/state.json` with current run scores, flags, and patterns.
Rolling 12-report history per member. Recalculate `avg_delivery_rate_3r`, `trend`, `recurring_flags` after each write.

**12B — Update report memory (shared cache):**
Write to `~/.claude/pickle/memory/report-memory.json`:

```json
{
  "[CHANNEL_NAME]": {
    "[user_id]": {
      "commitment_patterns": {
        "words": [top 10 most-used commitment/completion words this run],
        "avg_commitments_per_window": [rolling average],
        "typical_tasks": [top 5 task name keywords this person works on]
      },
      "known_flags": {
        "[task_id]": {
          "task_name": "...",
          "first_flagged": "YYYY-MM-DD",
          "flag_count": N,
          "flag_type": "overdue|zombie|ghost_closure|time_justification",
          "resolved_at": null
        }
      },
      "known_zombie_ids": ["task_id_1", "task_id_2"],
      "last_seen_score": 0.00,
      "score_history": [last 6 scores],
      "flag_history": [last 10 flags with dates]
    }
  }
}
```

**Resolution tracking:** If a task that was previously flagged is now TRULY DONE → set `resolved_at = today` in its known_flags entry. This shows improvement over time.

**Prune entries older than 90 days** from flag_history to keep the file lean.

---

## STEP 13 — PRINT LOCAL SUMMARY

Print table:
```
Name             | Score | Delivery | Time Docs | Updates | Presence
─────────────────┼───────┼──────────┼───────────┼─────────┼─────────
[name]           | 87%   | 100%     | 80%       | 75%     | 100%
```

Then: FLAGS RAISED, PATTERNS, GAPS summary, and path to state.json.

---

## ERROR HANDLING

| Scenario | Action |
|----------|--------|
| Time entries API not in MCP | Use task time_spent as proxy. Note limitation in report. Flag to add endpoint. |
| Channel not found | List available, suggest closest, stop |
| Member has no data at all | "No data in window — check if active in this channel" + flag |
| Rate limit | Wait 2s, retry once |
| Post fails | Print to terminal + note |
| state.json write fails | Warn, continue |

---

## TOOL REQUIREMENTS

**Required (ClickUp MCP):**
- `clickup_get_workspace_hierarchy`
- `clickup_get_workspace_members`
- `clickup_get_chat_channels`
- `clickup_get_chat_channel_messages`
- `clickup_filter_tasks`
- `clickup_get_task`
- `clickup_get_task_comments`
- `clickup_send_chat_message`

**Needed but not yet in MCP — add to roadmap:**
- ClickUp Time Tracking API: `GET /api/v2/team/{team_id}/time_entries?start_date=&end_date=&assignee=`
  - Returns individual time entries with `description`, `duration`, `task_id` per session
  - This is the PRIMARY data source for verifying actual work done
  - Without this, time entry description checks are impossible
  - **Priority: HIGH** — add this tool to pickle-mcp or request in ClickUp MCP

---

## FIRST RUN NOTES

- No pattern history → note "Baseline run"
- Every score and flag is independently meaningful
- State created fresh for this channel
