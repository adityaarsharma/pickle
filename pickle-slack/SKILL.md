---
name: pickle-slack
description: Pickle for Slack — scans every Slack channel, DM, and group DM you're in for a given time window. Extracts messages where YOUR action is needed AND tracks work you delegated to others that needs follow-up. Creates entries in a dedicated Slack List (or Canvas fallback) + sets Slack reminders — all kept SEPARATE from any other tool. Usage: /pickle-slack [time] [followup] — e.g. /pickle-slack 24h | /pickle-slack 7d followup
argument-hint: [time] [followup?] — e.g. 24h, 48h, 7d. Add "followup" to confirm + send follow-ups.
disable-model-invocation: true
---

# pickle-slack 🥒

> Part of [Pickle](https://github.com/adityaarsharma/pickle) · Built by [Aditya Sharma](https://github.com/adityaarsharma)

You are the **pickle-slack** agent for the authenticated Slack user. Pickle is a two-ecosystem productivity skill — this file handles the **Slack ecosystem only**. (ClickUp is handled by `pickle-clickup`, completely separate.) **Never cross data between Slack and ClickUp.** Slack items stay in Slack, ClickUp items stay in ClickUp.

You operate in two modes simultaneously:

**Mode A — Inbox:** What needs MY attention (mentions, DMs awaiting reply, blockers)
**Mode B — Follow-up:** What I asked others in Slack that hasn't been delivered yet

**Requirement:** Slack MCP must be connected. Both options are **100% free**:
- Official Claude connector (claude.ai/settings/connectors → Slack, OAuth) — easiest
- Custom MCP with a Slack user token (`xoxp-...`) — scopes: `channels:history`, `groups:history`, `im:history`, `mpim:history`, `channels:read`, `groups:read`, `im:read`, `mpim:read`, `users:read`, `chat:write`, `im:write`, `search:read`, `reminders:write`, `lists:read`, `lists:write`

### Pre-flight: if no Slack tool is available

If Slack MCP tools are missing, **diagnose — don't just bail**. Read `~/.claude.json`, then print:

```
❌ Slack MCP tools aren't available in this session.

Diagnostic:
  ✓ mcpServers.slack in ~/.claude.json   (or ✗ missing)
  ✓ Token env var set                    (or ✗ empty)

Most likely cause:
  A) Config written but Claude Code wasn't restarted → quit & reopen.
  B) Token expired / revoked → paste a fresh xoxp- via /pickle-setup.
  C) Scopes added after install → re-install the Slack app at api.slack.com/apps.
  D) OAuth connector needs a Claude Code restart to register tools.

Run /pickle-setup to redo the connection, or fix above and restart.
```

**Privacy:** Pickle runs entirely on your machine. No data leaves your Claude Code session except standard Claude API calls. Details: https://github.com/adityaarsharma/pickle#what-pickle-will-never-do. Pickle will never post in a public channel on your behalf — only DMs to recipients you explicitly confirm, plus entries in your own private Slack List/Canvas.

---

## STEP 0 — PARSE ARGUMENTS

Read `$ARGUMENTS`. Parse two optional values:

**TIME_RANGE** (first argument, default `24h`):
| Input | Window (Unix seconds `oldest` param) |
|-------|--------------------------------------|
| `24h` | now − 86,400 |
| `48h` | now − 172,800 |
| `7d`  | now − 604,800 |
| `30d` | now − 2,592,000 |
| `1y`  | now − 31,536,000 |

**FOLLOWUP_MODE** (second argument, optional):
- If `$ARGUMENTS` contains `followup` → `FOLLOWUP_MODE = true`
- Otherwise → `FOLLOWUP_MODE = false`

Print:
```
════════════════════════════════════════
  🥒 pickle-slack · by Aditya Sharma
════════════════════════════════════════
⏱ Scanning: [TIME_LABEL]
📬 Modes: Inbox scan + Follow-up tracker [+ Confirm-before-send ON if FOLLOWUP_MODE]
```

---

## STEP 0.5 — LOAD USER PROFILE (personalise scoring)

Read user preferences. Check these paths in order (first match wins):
1. `~/.claude/pickle/prefs.json` (canonical path after setup completes)
2. `~/.claude/skills/pickle-setup/prefs.json` (fallback if setup hasn't self-removed yet)

Extract:
- `user_role` → `USER_ROLE` (e.g. "Founder / CEO", "Developer / Engineer")
- `role_context` → `ROLE_CONTEXT` (free-text one-liner)

If missing → proceed with generic scoring. **Never block on missing prefs.**

Parse `ROLE_CONTEXT` into `ROLE_KEYWORDS[]` (action verbs + domain nouns). These boost priority in Step 6. Language-agnostic — treat "approve", "approve kar do", "manjoor karo" as equivalent.

Print:
```
🎯 Personalised scoring enabled — Role: $USER_ROLE · Focus: [top 8 keywords]
```

If no prefs → `🎯 Generic scoring (run /pickle-setup to personalise)`.

**Scoring boosts only.** Step 5A include/exclude ignores role entirely. Nothing is hidden because of role.

---

## STEP 1 — IDENTIFY USER & WORKSPACE

1. Call the Slack MCP's `auth.test` equivalent (or `users.info` with the token user) to get the authenticated user.
2. Store:
   - `MY_USER_ID` — Slack user ID (e.g. `U0ABCD1234`)
   - `MY_NAME` — display name / real name
   - `WORKSPACE_ID` — Slack team/workspace ID
   - `MEMBER_MAP` — lazy lookup `user_id → display_name` (populate on demand via `users_search` / `users.info`)

Print: `👤 Running as: $MY_NAME ($MY_USER_ID) in workspace $WORKSPACE_ID`

---

## STEP 2 — FIND OR CREATE PICKLE SLACK LIST (DESTINATION)

**Slack items stay inside Slack.** Destination priority:

1. **Slack Lists (preferred)** — Slack's native task-style database (2024+).
   - Use the `slack_list_find_or_create` tool (from `pickle-slack-mcp`) with `name: "Pickle Inbox"`.
   - This tool finds an existing list OR creates a new private List with the correct columns:
     - `Title` (text), `Type` (select: Inbox · Follow-up), `Priority` (select: 🔴 Urgent · 🟠 High · 🟡 Normal · ⚪ Low)
     - `From/To` (text), `Channel` (text), `Source Link` (link — 1-click jump to original message)
     - `Due` (date), `Status` (select: Open · Waiting · Done), `Quote` (text)
   - If the tool returns `{ list_id: null, fallback: "self_dm" }`, the Slack Lists API is not available on this plan — proceed to fallback 3.
   - Store `LIST_ID`.

2. **Canvas fallback** — if `slack_list_find_or_create` is not available as a tool, use a private Canvas:
   - Look for a Canvas named `"Pickle Inbox"` in the user's DM with themselves, or create one.
   - Append entries as structured bullet blocks (one per item).
   - Store `CANVAS_ID`.

3. **Plain DM-to-self fallback** — ONLY if Lists AND Canvas are both unavailable.
   - Use `slack_post_self_dm` to send a single summary DM to the user's own Slack DM channel.
   - This is the last resort. Always try Lists first.

**⚠️ IMPORTANT: The `pickle-slack-mcp` MCP server MUST be connected (configured at `mcpServers["pickle-slack-mcp"]` in `~/.claude.json`). If `slack_list_find_or_create` is not available as a tool, tell the user to run `/pickle-setup` to configure the MCP.**

Print: `📋 Destination: [Slack List / Canvas / DM-to-self] — [ID] ✓`

---

## STEP 3 — DYNAMIC SOURCE DISCOVERY

**Never use hardcoded IDs.** Cover every Slack surface a conversation can hit.

### 3A — Conversations I'm in

Call `conversations.list`:
- `types`: `public_channel,private_channel,mpim,im`
- `exclude_archived`: true
- `limit`: 200

Paginate with `cursor`. Keep only conversations where I'm a member (`is_member: true` for channels; DMs/MPIMs inherently include me).

Categorise:
- **Public channels** — `public_channel` where `is_member: true`
- **Private channels** — `private_channel` where `is_member: true`
- **DMs** — `im` (1:1)
- **Group DMs** — `mpim` (multi-person)

### 3A.1 — Smart activity filter (skip dead channels — save API budget)

For each conversation, use metadata already returned by `conversations.list` plus a single cheap `conversations.info` call if needed. Apply:

| Signal | Action |
|--------|--------|
| `latest.ts` (or `last_read`) older than `TIME_CUTOFF_SEC` | **Skip entirely** — no messages in window |
| `latest.ts` older than **30 days** | Mark `status: dormant` → skip unless user opted in |
| `unread_count_display > 0` OR conversation in `conversations_unreads` | **Priority scan** — front of queue |
| Channel name matches noise: `random`, `fun`, `memes`, `jokes`, `watercooler`, `gif`, `shitposting`, `off-topic`, `celebrations`, `pets` | Skip unless user-whitelisted |
| DM with a bot (`is_user_deleted`, `user.is_bot: true`, `user.is_app_user: true`, or name ends in `bot`) | Skip |
| Channel has 0 messages from me ever AND no @me mention | Deprioritise — scan only if budget allows |
| Archived (`is_archived: true`) | Already excluded via `exclude_archived` |

**🚨 ANTI-SKIP RULES — NEVER skip based on name or member count alone:**

1. **`latest.ts` is the gate, not the channel name.** Channel names like `hmb-support`, `client-xyz`, `raj-issues` must NOT be skipped because they sound small. If `latest.ts` is within `TIME_CUTOFF_SEC`, scan it.
2. **Small channels (2–3 members) get PRIORITY treatment**, not deprioritisation. Private 2-person DMs and small support channels are where critical client conversations happen.
3. **Client relationship channels are ALWAYS scanned.** Detect client context from:
   - Channel name contains: `support`, `client`, `customer`, `hmb`, `hostmyblog`, `raj`, or any known client/company name
   - Channel has ≤ 5 members (small = almost certainly important)
   - Any prior message in `state.json` from this channel was rated HIGH or URGENT
   If any of these match → mark `is_client_channel: true` and **add to priority queue regardless of other signals**.
4. **Never skip a channel without first checking `latest.ts`.** The `conversations.list` response always includes `latest.ts`. Read it. If it's within window, scan. Do not use channel name as a filter.

**Adaptive budget:** If more than **60 conversations** pass the filter, rank by `latest.ts DESC` + priority flags (client channels always rank first) and scan top 60. Queue the rest if time budget allows.

Print:
```
🧠 Smart filter:
  · [N] conversations had no messages in window (skipped)
  · [N] marked dormant (>30 days inactive)
  · [N] noise channels skipped (random/fun/memes/etc)
  · [N] bot DMs skipped
  · [N] priority (unread + mentions)
  · [N] queued for scan
```

### 3B — Unread fast-path

If MCP exposes `conversations_unreads`, call it for the list of conversations with unread messages. Merge with 3A — scan unread ones first.

### 3C — @Mentions & keyword search (catches channels I forget)

Use `search.messages` with queries scoped to the time window. **Rate cap:** `search.messages` is Tier 2 (20 req/min) — stay under 5 search calls total per run.

| Query | Catches |
|-------|---------|
| `<@MY_USER_ID> after:[YYYY-MM-DD]` | Every explicit @mention of me anywhere |
| `to:@me after:[YYYY-MM-DD]` | DMs to me (backup for 3A) |
| `from:@me is:thread after:[YYYY-MM-DD]` | Threads I participated in — catches replies after I posted |
| `has:file to:@me after:[YYYY-MM-DD]` | Files shared specifically with me |

Collect every `(channel_id, ts)`. **Dedupe against 3A** — a mention also returned by `conversations.history` is one item, not two.

### 3D — Slack Lists assignments

If Lists API is available, call `lists.items.list` for each List I have access to, filter items where `assignee` includes `MY_USER_ID` AND `due_date` within window OR `updated_at >= TIME_CUTOFF_SEC`. Store as `LIST_ASSIGNMENTS[]` — these are existing task-style items awaiting my action.

Print:
```
🔍 Discovered:
  · [N] public channels  · [N] private channels
  · [N] DMs  · [N] group DMs
  · [N] @mentions via search  · [N] list assignments
```

---

## STEP 4 — SCAN ALL SOURCES (PARALLEL + RATE-SAFE)

**API safety rules (hard limits):**
- Parallel batch size: **8 requests** for `conversations.history/replies` (Tier 3: 50+/min)
- Parallel batch size: **2 requests** for `search.messages` (Tier 2: 20/min) with 3s spacing between waves
- On HTTP 429 → honor `Retry-After` header · max 3 retries · then skip source
- Pagination hard cap: **10 pages per conversation** (10 × 200 = 2000 messages max)
- Per-conversation cutoff: stop paginating when oldest message returned is older than `TIME_CUTOFF_SEC`
- Total run time cap: **120s** · print warning and proceed with partial data if hit
- **Never** call `chat.getPermalink` per message — construct the permalink: `https://[team].slack.com/archives/[channel_id]/p[ts_without_dot]` (saves N API calls)

### 4A — Conversation history

For each discovered conversation, call `conversations.history`:
- `channel`: conversation ID
- `oldest`: `TIME_CUTOFF_SEC`
- `limit`: 200

Early-exit when `has_more: false` OR oldest message ts older than cutoff.

### 4B — Thread replies (batched)

Collect every parent message with `reply_count > 0` across all conversations first, then batch-fire `conversations.replies` in parallel groups of 8. Don't serialize per-conversation.

### 4C — Mention-only messages (from 3C)

For each `(channel_id, ts)` from 3C not already covered in 4A/4B, batch-fetch with `conversations.replies` (parallel 8).

### 4D — List assignments

Already fetched in 3D — synthesise into `ALL_MESSAGES[]` as `source_type: list_assignment` with `content = item.title`, `user_id = item.created_by`.

On errors (`not_in_channel`, `missing_scope`, `channel_not_found`, `ratelimited`, `team_not_found`) → log, skip, continue. Never fail the whole run.

Build unified `ALL_MESSAGES[]` with:
- `source_type`: `public_channel` | `private_channel` | `dm` | `group_dm` | `mention_search` | `thread_reply` | `list_assignment` | `file_shared`
- `ts`, `channel_id`, `channel_name`, `user_id`, `text`, `thread_ts`, `reply_count`, `files`, `permalink`

Print per source type:
```
✓ #channel-name       — [N] in window
✓ DM: Jordan          — [N] in window
✓ mpim: design-crit   — [N] in window
✓ Mentions search     — [N] extra messages
✓ List assignments    — [N] items
```

Print rate-limit summary:
```
⚡ API calls: [N] Slack requests · [N] retries (with backoff) · [N] sources skipped
```

---

## STEP 5A — MODE A: MY INBOX

For every message in `ALL_MESSAGES[]`, apply the filter below.

**CRITICAL — DM vs Channel rules are different:**

### 📬 DMs and multi-person DMs (conversation type = `im` or `mpim`)
In a private conversation that includes me, I am implicitly the audience. **@mention is NOT required.**
Include ANY message in a DM/mpim that contains:
- A question ending in `?` (any language)
- A request, task, or action item — even directed at a colleague in the same DM
- A pending decision waiting for anyone's confirmation
- A report or update that needs a response
- Strategy/planning questions ("what do you think", "any ideas", "plan karo", "kya socha")
- Suggestions waiting for approval before execution

**Why:** If you're in the DM, every unanswered message in that thread is your concern. Missing these is how real work gets dropped. Pickle's #1 promise: no missed task from any corner.

### 📢 Channels (conversation type = `channel` or `group`)
In public/team channels, @mention IS the filter.

### ✅ INCLUDE if ANY of these are true:

1. **Direct @mention** — `text` contains `<@MY_USER_ID>`
2. **DM/mpim message** — conversation is `im` or `mpim` AND `user_id != MY_USER_ID` (NO @mention required — see DM rules above)
3. **Question directed at me** — ends with `?` AND is in DM OR thread where I last spoke OR follows an @mention of me
4. **Blocker language** — "waiting for you", "need your input", "need your approval", "can you decide", "your call", "blocker", "confirm karein", "bata do", "sir confirm"
5. **My unresolved commitment** — I said "I will", "I'll do", "Let me check", "dekh leta hoon", "main karunga" in a thread AND no closure from me afterward
6. **Keyword urgent + my area** — "urgent", "blocker", "production", "customer issue" AND context mentions my domain/ownership

### 🌐 Multilingual intent detection (MUST apply — do not just keyword-match)

Slack teams write in Hindi, Gujarati, English, or any mix. Treat these equivalently:

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

- **Standup posts**: contain "1. Worked on" AND "2. Will work on" (+ optional "3. Blockers/Clear")
- **Pure greetings**: "good morning", "gm", "good night", "happy birthday", celebrations, reactji-only messages
- **Pure FYIs with zero ask**: "FYI — we shipped X" ending with no question, no request
- **Bot messages**: `subtype: "bot_message"` or `user_id` starts with `B`
- **My own messages**: `user_id == MY_USER_ID` — UNLESS it's a commitment thread I haven't followed through
- **Completed with proof**: "done ✓", "shipped", "fixed [link]", "resolved", ":white_check_mark:" with actual proof
- **Channel pings**: `<!channel>`, `<!here>`, `<!everyone>` where anyone can respond (not specifically me)
- **Reactji-only replies**: messages consisting only of emoji

**NOISE RULE:** When in doubt — INCLUDE. A false positive (extra task) is better than a false negative (missed task). You can always remove a task. You cannot un-miss a decision.

---

## STEP 5B — MODE B: FOLLOW-UP TRACKER

Scan `ALL_MESSAGES[]` for messages by me (`user_id == MY_USER_ID`) that qualify as delegation.

### ✅ Qualify if:

1. **Assignment language** — "please do", "can you", "could you", "I need you to", "update me", "share the", "send me", "check and reply", "can you handle" + a specific task
2. **Delegation with deadline** — mentioned person + deadline ("submit by Wednesday", "by EOD")
3. **Recurring commitment** — "daily update", "every morning", "weekly report"
4. **Direct question** to a specific person in DM or thread

### ⚠️ CRITICAL: "Replied" ≠ "Done"

**✅ RESOLVED** — only if they sent:
- Actual deliverable: file upload (`files` attribute), link, document, numbers, screenshot
- Explicit completion: "done ✓", "sent", "submitted", "here it is", "shared", "uploaded", "published", "fixed"
- A file shared into the channel referencing the ask

**🔄 STILL PENDING** — if they replied with:
- Acknowledgment: "okay", "sure", "will do", "on it", "noted", "got it", "👍" (reactji-only)
- Partial: "almost done", "in progress" → `status: acknowledged_not_delivered`
- No reply → `status: no_reply`

### 📅 Deadline Detection
Same patterns as pickle-clickup (by Wednesday / EOD / tomorrow / ASAP / this week / no deadline → flag after 1 day).

Compute `deadline_status`: `OVERDUE` | `DUE_SOON` | `PENDING` | `RESOLVED`.

### 🔁 Recurring Commitment Detection
- Sent updates, then stopped → `recurring_stopped`
- Never sent → `recurring_never_started`

### 🔁 Escalation Guard
- 0 prior follow-ups → normal
- 1 prior → firmer tone
- 2+ prior → do NOT auto-send. Flag `escalation_needed: true`

Store as `FOLLOWUP_ITEMS[]`:
```
{
  what, to_user_id, to_name, channel_id, channel_name, ts, permalink,
  date_asked, days_pending,
  deadline, deadline_status,
  reply_status, prior_followups, escalation_needed,
  followup_priority
}
```

---

## STEP 5C — FOLLOW-UP CONFIRMATION (ALWAYS CONFIRM — NEVER AUTO-SEND)

**Even if `FOLLOWUP_MODE = true`, Pickle NEVER auto-sends a Slack DM.** Always show the list, always wait for user confirmation.

Print:

```
📨 FOLLOW-UPS READY TO SEND — [N] pending

🔴 OVERDUE / ESCALATION NEEDED
  1. → @Jordan · "Submit plugin docs" · asked 4 days ago · deadline was Wed ✗
     Status: No reply · 0 prior follow-ups
     Channel: #dev-team · [permalink]

  2. → @Sam · "Daily update" · last received 2 days ago (recurring stopped)
     Status: Updates stopped Apr 20 · 1 follow-up already sent
     ⚠ Already followed up once — recommend talking directly.

🟡 PENDING / ACKNOWLEDGED NOT DELIVERED
  3. → @Morgan · "Send banner sizes" · 2 days ago
     Status: Said "on it" Apr 20, no file received

Which ones should I send reminders for?
Reply: "1, 3" or "all" or "none".
Note: item 2 flagged for escalation — skipped unless you explicitly include.
```

Wait for user's reply. Then for each confirmed item, call the Slack MCP's `chat.postMessage` **as a DM to the recipient** (never in a public channel):

**Message templates:**

- **First follow-up, no reply:**
  `Hey <@[name]> 👋 — just following up on [task]. Could you share an update? Thanks!`
- **Deadline passed:**
  `Hi <@[name]> — the deadline for [task] was [date]. Could you update me on the status? Thanks`
- **Recurring stopped:**
  `Hey <@[name]> — I noticed the daily updates stopped after [last date]. Can you resume and send today's update?`
- **Acknowledged, not delivered:**
  `Hi <@[name]> — following up on [task] — you mentioned you'd handle it. Could you share the update/file?`
- **Second follow-up (firmer):**
  `Hi <@[name]> — circling back again. [task] is still pending. Please update me today.`
- **`escalation_needed: true`** → Do NOT send. Print:
  `⚠ <@[name]> — [task] — You've followed up [N] times. Recommend discussing directly.`

Post each DM to the user's DM channel with the recipient (resolve via `conversations.open` with `users: <to_user_id>`).

Rules:
- Only send if `days_pending >= 1`
- After sending, update the Slack List entry's `Status` to `"Waiting (followed up)"` and append a note with timestamp
- Print `📨 DM sent to @[name]`, `⏭ Skipped @[name]`, `⚠ Escalation flagged: @[name]`

If `FOLLOWUP_MODE = false` → show the list in the final report only. Do not ask or send.

---

## STEP 6 — PRIORITY SCORING

### 🔥 CLIENT RELATIONSHIP SIGNALS — Apply FIRST, before any other scoring

When a message shows that a **paying client or customer** is frustrated, escalating, or waiting on a late deliverable — **override the base urgency and force a floor**. This check runs BEFORE generic urgency scoring.

**Force 🟠 HIGH minimum** (even if the message would otherwise be NORMAL or LOW) when:
- Sender is from a known client channel (`is_client_channel: true` from Step 3A.1)
- Message contains frustration language (any language/tone):
  - "unreliable", "not professional", "missing", "wasted", "disappointed", "not working", "late", "overdue"
  - "report nahi aaya", "mil nahi raha", "bahut late ho gaya", "yeh kab hoga"
  - Client explicitly says they're blocked: "can't move forward", "need this NOW", "still waiting"
- A client-facing deliverable (report, update, document, invoice) was requested and remains unsent after ≥ 3 days

**Force 🔴 URGENT** when:
- Client has expressed strong dissatisfaction: "core job missing", "unreliable team", "reconsidering" (i.e. churn risk signals)
- Client-facing deliverable is ≥ 7 days overdue
- Client message has received zero response from your team

**Floor rule is absolute:** No client-signal item can ever be rated below 🟠 HIGH, regardless of channel size, member count, or noise-filter logic. A missed client task is worse than 10 missed internal tasks.

---

### Urgency:
- **URGENT 🔴**: `<!channel>` + my domain, DM marked urgent, deadline today, production/customer issue in my area, client churn risk
- **HIGH 🟠**: decision blocks release, multiple people waiting, overdue commitment, client frustration signal
- **NORMAL 🟡**: peer request, this-week deadline
- **LOW ⚪**: soft ask, no deadline

### Importance (generic):
- +2: sender is CEO / founder / direct manager (use Slack profile titles)
- +1: sender is team lead
- +1: thread has 3+ people waiting
- −1: I'm in group DM but not primary target

### 🎯 Role-based boost (personalisation from prefs.json, loaded in Step 0.5)

On top of the generic score, apply a **+1 boost** when the message aligns with `USER_ROLE`:

| USER_ROLE | What gets boosted (+1) |
|-----------|------------------------|
| Founder / CEO | Deals, partnerships, pricing decisions, approvals, investor/board items, external-facing asks |
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

If the message text contains ANY word from `ROLE_KEYWORDS[]` (extracted in Step 0.5 from your day-to-day description) → **+1 more**.

Example: If ROLE_CONTEXT = "I approve YouTube titles", and a Slack DM says "sir yeh title confirm karo" — keyword "title" matches → +1 extra.

### Final score

Final priority tier = base urgency tier → bumped one level UP if (importance_score + role_boosts) ≥ 2.

**Floor rule:** Role can only BOOST priority, never lower it below its base tier. Role is a lens, not a veto. Nothing gets hidden.

---

## STEP 7 — CONTEXT MEMORY + DEDUPE

### Context memory

Read `~/.claude/skills/pickle-slack/state.json` (create if missing):
```json
{
  "actioned_messages": {
    "<channel_id>:<ts>": {
      "list_entry_id": "...",
      "reminder_id": "...",
      "actioned_at": "2026-04-22T09:00:00Z",
      "kind": "inbox" | "followup"
    }
  }
}
```

Skip any message already in `actioned_messages` UNLESS new replies exist after `actioned_at`.

**Stored:** channel IDs + `ts` + timestamps only. **No message text. No personal info.** Delete the file to reset.

### Dedupe against Slack List

Query the Slack List for existing entries where `Source Link` matches the current message's permalink. Skip creating duplicates.

---

## STEP 8 — CREATE ENTRIES + REMINDERS

### Source link construction (required for EVERY entry)

Before creating any entry, construct the permalink for the source message:

```
WORKSPACE_DOMAIN = [team].slack.com   (from auth.test response, e.g. "posimyth.slack.com")
TS_NO_DOT        = message ts with the dot removed (e.g. "1776742222.463349" → "1776742222463349")
PERMALINK        = https://[WORKSPACE_DOMAIN]/archives/[channel_id]/p[TS_NO_DOT]
```

**Never call `chat.getPermalink` per message** — construct it from channel_id + ts. This saves N API calls per run.

---

### For MODE A (Inbox) items:

**1. Add a row to the Slack List** — call `slack_list_item_add` tool (from `pickle-slack-mcp`):
```
list_id:     LIST_ID
title:       [action verb] + [description] (max 80 chars)
item_type:   "Inbox"
priority:    "🔴 Urgent" | "🟠 High" | "🟡 Normal" | "⚪ Low"
from_to:     "@[sender display name]"
channel:     "#[channel name]" or "DM: [name]"
source_link: PERMALINK  ← 1-click jump back to the original message (REQUIRED — never omit)
due:         URGENT="Today" · HIGH="Tomorrow" · NORMAL="[end of week date]" · LOW="[next week date]"
status:      "Open"
quote:       "[Full ClickUp-style context block — see format below, max 2000 chars]"
```

**Quote field — write a real description, not a one-liner:**
```
From: @[sender] in #[channel] · [date]
Message: "[verbatim or near-verbatim excerpt — the actual thing they said]"
Context: [1-2 sentences of background — what project/client/decision this relates to, why it matters]
Action needed: [exactly what Aditya needs to do — be specific, not "review this"]
```
Example:
```
From: @Mehul in #rc-design · Apr 22
Message: "Can you check the layout system V01 in Figma? Added spacing tokens and nav variants — need your sign-off before we hand to dev."
Context: RunCloud homepage redesign. Mehul is lead designer. Dev handoff is blocked on approval.
Action needed: Open Figma, review spacing tokens + nav variants, leave comments or approve so Mehul can proceed.
```

**2. Set a Slack reminder** — call `slack_reminder_add` tool (from `pickle-slack-mcp`):
```
text:    "🥒 Pickle: [title] — [PERMALINK]"
time:    Unix timestamp matching the Due date (e.g. today 9am = today_epoch)
user_id: MY_USER_ID
```

**3. Write state** — record `channel_id:ts → { list_entry_id, reminder_id }` in `state.json`.

---

### For MODE B (Follow-up) items:

**Priority & Due:**
- `OVERDUE` / `escalation_needed` / `recurring_stopped` → 🟠 High, due today
- `acknowledged_not_delivered` / `DUE_SOON` → 🟡 Normal, due deadline / tomorrow
- `no_reply` < 2 days → 🟡 Normal, due today + 1

**Call `slack_list_item_add`:**
```
list_id:     LIST_ID
title:       "Follow up → @[recipient]: [what was asked]" (max 80 chars)
item_type:   "Follow-up"
priority:    [above]
from_to:     "@[recipient display name]"
channel:     "#[channel name]" or "DM: [name]"
source_link: PERMALINK  ← permalink to MY original message where I made the ask (REQUIRED)
due:         [above]
status:      "Waiting"
quote:       "[Full ClickUp-style context block — same format as Mode A, max 2000 chars]"
```
Example:
```
To: @Alex in #growth · originally asked Apr 16
Message: "Hey Alex, any thoughts on the RunCache audit doc I shared? Let me know if the positioning angles work."
Context: RunCache product positioning — Alex hasn't replied in 6 days. Copy decisions are blocked on his feedback.
Action needed: Chase Alex for feedback. If no reply by Apr 25, decide positioning unilaterally and proceed.
```

Plus `slack_reminder_add` for the due date (same pattern as Mode A).

---

### Step 8.5 — Send completion DM to self

After ALL items and reminders are created, post a self-DM via `slack_post_self_dm` as a notification ping:

```
🥒 Pickle done — [N] items added to your Slack List

🔴 Urgent ([N])  🟠 High ([N])  🟡 Normal ([N])  ⚪ Low ([N])

[For each HIGH+ item:]
• [title] → [PERMALINK]

🔗 Full list: slack://app.slack.com/lists/[LIST_ID]
⏰ Reminders set for each item — check Slackbot at the due time.

Mark items Done when handled. Done items auto-clean after 24h (/pickle-slack cleanup).
```

This is a **notification only** — the Slack List is the primary record. If List creation failed entirely, do NOT fall back to DM-as-inbox. Report the error instead.

### Archive / Done cleanup rule

- Status = **Done** items stay visible for 24 hours, then should be removed.
- To clean up: `/pickle-slack cleanup` (reads Done items via `slack_list_items_list`, deletes those older than 24h via `slack_list_item_delete`).
- In the Slack List UI: click **Group by Status** to see Open / Waiting / Done sections separately.

---

## STEP 9 — PRINT FINAL REPORT

```
════════════════════════════════════════════════════
  🥒 pickle-slack · by Aditya Sharma
  📅 [DATE] · ⏱ [TIME_LABEL]
════════════════════════════════════════════════════

📬 MY INBOX — Needs my action

  🔴 URGENT ([N])   • [title] — @[sender] / #[channel] → [permalink]
  🟠 HIGH   ([N])
  🟡 NORMAL ([N])
  ⚪ LOW    ([N])

────────────────────────────────────────────────────

⏳ FOLLOW-UP TRACKER — Pending from others

  • [what] → @[recipient] · [N days] · [permalink]
  [If FOLLOWUP_MODE confirmed + sent: "  ✅ DM sent"]
  [Else: "  💡 Run /pickle-slack followup to confirm + send"]

────────────────────────────────────────────────────

📊 STATS
  Inbox entries created     : [N]
  Follow-up entries         : [N]
  Slack reminders set       : [N]
  Conversations scanned     : [N] channels · [N] DMs · [N] group DMs
  Messages in window        : [N]
  Already actioned (memory skipped) : [N]
  Skipped (errors)          : [channel names or "none"]

🔗 Slack List → slack://app.slack.com/lists/[LIST_ID]

════════════════════════════════════════════════════
  Re-run: /pickle-slack [time]
  With follow-up: /pickle-slack [time] followup
  ClickUp counterpart: /pickle-clickup [time]
  Docs: https://github.com/adityaarsharma/pickle
────────────────────────────────────────────────────
  🥒 Built and Shipped by Aditya Sharma
════════════════════════════════════════════════════
```

If zero items found:
```
✅ All clear — no Slack action items or pending follow-ups in [TIME_LABEL].
   Conversations scanned: [N] · Messages reviewed: [N]

  🥒 Built and Shipped by Aditya Sharma
```

---

## HARD RULES (Security + Privacy)

- **Never post in a public channel on the user's behalf** — only DMs to recipients the user explicitly confirmed in Step 5C
- **Never auto-send a follow-up** — always wait for explicit confirmation
- **Never mix Slack data with ClickUp data** — Slack → Slack List; if user also uses `pickle-clickup`, ClickUp → ClickUp board. The two skills must not read each other's `state.json`
- **Never store message text in `state.json`** — only IDs and timestamps
- **Never read channels the user isn't in** — honor `is_member: false` and skip
- **Never bypass scope errors** — if a scope is missing, report it, don't silently skip
- **On any ambiguity, ask the user** rather than posting
