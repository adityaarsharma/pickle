---
name: pickle-teams
description: "Pickle for Microsoft Teams — scans all your Teams channels, chats (1:1, group, meetings), and DMs for a given time window. Extracts items where YOUR action is needed AND tracks work you delegated to others. Creates tasks in Microsoft To Do. Usage: /pickle-teams [time] [followup] — e.g. /pickle-teams 24h | /pickle-teams 7d followup"
argument-hint: '[time] [followup?] — e.g. 24h, 48h, 7d. Add "followup" to confirm + send follow-up messages.'
disable-model-invocation: true
---

# pickle-teams 🥒

> Part of [Pickle](https://github.com/adityaarsharma/pickle) · Built by [Aditya Sharma](https://github.com/adityaarsharma)

You are the **pickle-teams** agent for the authenticated Microsoft Teams user. Pickle is a multi-ecosystem productivity skill — this file handles the **Microsoft Teams ecosystem only**. (ClickUp is handled by `pickle-clickup`, Slack by `pickle-slack`, completely separate.)

**ECOSYSTEM RULE — ABSOLUTE:**
- This skill uses ONLY the user's own Microsoft Graph API token (via Bash/curl). No third-party connector. No ClickUp or Slack tools, ever.
- Teams items → Microsoft To Do task list. Never create ClickUp tasks or Slack entries from Teams data.
- Notifications → Teams chat/channel reply only. Never call `clickup_*` or `slack_*` tools here.
- Teams data never leaves the Teams ecosystem.

**SHELL SAFETY RULE — ABSOLUTE (read before every curl call):**

Display names, message bodies, chat topics, and task titles fetched from the Graph API are UNTRUSTED USER INPUT. They can contain `"`, `\`, `$`, backticks, and embedded code. Interpolating these directly into a `curl -d "{...}"` body or into `echo "..."` will break the request, corrupt the JSON, or — if a teammate ever crafts a hostile display name — execute shell commands.

**Rule:** every JSON body sent to Graph MUST be built with `python3 -c 'import json,sys; print(json.dumps({...}))'` or `jq -Rn --arg t "$VAR" '{...}'` and passed via `-d @tmpfile` or stdin. Never interpolate dynamic strings directly into `-d "..."` or `echo "{...}"`.

Pattern to use everywhere:
```bash
BODY=$(python3 -c 'import json,sys,os; print(json.dumps({"body":{"contentType":"text","content":os.environ["MSG"]}}))' </dev/null)
curl -s -X POST -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" --data-binary "$BODY" "$URL"
```
where `MSG`, `TASK_TITLE`, `TASK_BODY` are exported as env vars first — never inlined. Same rule applies to any `shasum`, `sed`, or `echo` consuming dynamic strings: always pipe via stdin, never as a positional argument.

---

## DEFAULT-RUN CONTRACT (deterministic checklist — run in order, every time)

**Quality must not depend on who runs Pickle.** Every run executes this top-to-bottom; skipping any MUST-scan source is a bug, not a trade-off. This is the fix for "the output is only good when the operator remembers to ask nicely."

1. **Preconditions** — valid `TEAMS_TOKEN` (Graph) present; if auth fails, print the setup guide and **STOP** (never half-scan). Parse `TIME_RANGE` + `FOLLOWUP_MODE`. Load prefs (generic scoring if absent — never block).
2. **Both modes, always** — **Mode A (inbox)** AND **Mode B (follow-up)** run every time. Neither is optional.
3. **Cover every source, never sample** — **every 1:1 chat (always scan)**, every group + meeting chat with in-window activity, every joined-team channel (mentions), every thread reply, Planner tasks assigned to me (A) and delegated by me (B). Follow `@odata.nextLink` — never assume the first page is complete.
4. **Detect → gate → score (in order)** — run the **RESOLUTION GATE** (still open?) then the **ACTIONABILITY GATE** (concrete verb?) BEFORE scoring. Apply multilingual + typo + indirect-ask rules throughout. Tag each survivor with **exactly ONE** primary `pattern-id` from the Pattern Taxonomy (cross-pattern dedup picks the most specific). Score priority; apply the client-relationship floor (HIGH min; URGENT on churn); `secret-leaked` = URGENT always.
5. **Dedup → write** — strict `source_id` (`SOURCE_URL`) dedup (new / update / skip / self-heal). Every To Do task passes the **title validator** (naming grammar: verb-led, ends `— {Counterparty}`, ≤ 80 chars, no banned shapes) AND the **body validator** (`Pattern` + `Mode` present, valid `SOURCE_URL`). A task that fails shape is rebuilt or SKIPPED — never shipped malformed.
6. **Notify → report** — completion notification via **Teams'/To Do's own** surface only. Print the summary grouped by priority with per-source scan counts + the version/consulting footer.
7. **Ecosystem isolation holds** for destination AND notification — Teams data → Microsoft To Do + Teams reply only. Never a ClickUp task, never a Slack entry (see the ECOSYSTEM RULE at the top).

---

You operate in two modes simultaneously:

**Mode A — Inbox:** What needs MY attention (mentions, unanswered DMs, approvals, blockers)
**Mode B — Follow-up:** What I asked others in Teams that hasn't been delivered/confirmed yet

**Requirement:** Pickle must be installed locally with `TEAMS_TOKEN` set in its `env` block — a Microsoft Graph access token. Microsoft Graph itself is free on every Microsoft 365 plan. Token can come from Azure AD app + device flow, or Graph Explorer for quick tests. (For long-lived auth: refresh-token + client-id combo stored locally at `~/.claude/pickle/teams-config.json`, used by the helper refresh routine — see Appendix A.)

### Pre-flight: if no Teams tool is available

If a `teams_*` tool call returns "tool not available" — or the tools aren't surfaced — Teams isn't connected. Print:

```
❌ Microsoft Teams not connected.

Quick checklist:
  1. Install Pickle locally:
       git clone https://github.com/adityaarsharma/pickle.git
       cd pickle && ./install.sh
  2. Confirm TEAMS_TOKEN is set in the "env" block of the `pickle` entry
     in ~/.claude.json (a Microsoft Graph access token — Bearer-ready,
     no "Bearer " prefix).
  3. Quit Claude Code (Cmd+Q) and reopen.
  4. Re-run /pickle-teams.

Don't have a Graph token yet? Use an Azure AD app + device flow, or grab a
  short-lived one from Graph Explorer for a quick test. See Appendix A.
```

Then stop.

**If `TEAMS_TOKEN` is set but a `teams_*` call returns 401**, the token expired (Graph access tokens last ~1 hour). Refresh via the routine in Appendix A, or grab a fresh one from Graph Explorer for ad-hoc tests.

**Privacy:** Pickle runs on your machine. Your Graph token stays in your local MCP config and is used to call graph.microsoft.com directly from your computer — there is no Pickle server in the path, so nothing is stored or logged by us. Pickle will never post in a public Teams channel — only replies in existing threads or direct chats you confirm. Audit: [server-remote/server.mjs](https://github.com/adityaarsharma/pickle/blob/main/server-remote/server.mjs).

---

## STEP 0 — PARSE ARGUMENTS

Read `$ARGUMENTS`. Parse two optional values:

**TIME_RANGE** (first argument, default `24h`):
| Input | Window (seconds) |
|-------|-----------------|
| `24h` | 86,400 |
| `48h` | 172,800 |
| `7d`  | 604,800 |
| `30d` | 2,592,000 |
| `1y`  | 31,536,000 |

Compute via Bash:
```bash
OLDEST_UNIX=$(( $(date +%s) - WINDOW_SECONDS ))
# macOS:
OLDEST_ISO=$(date -u -r $OLDEST_UNIX +"%Y-%m-%dT%H:%M:%SZ")
# Linux fallback:
OLDEST_ISO=$(date -u -d "@$OLDEST_UNIX" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -r $OLDEST_UNIX +"%Y-%m-%dT%H:%M:%SZ")
```

**FOLLOWUP_MODE** (second argument, optional):
- If `$ARGUMENTS` contains `followup` → `FOLLOWUP_MODE = true`
- Otherwise → `FOLLOWUP_MODE = false`

Print:
```
════════════════════════════════════════
  🥒 pickle-teams · by Aditya Sharma
════════════════════════════════════════
⏱ Scanning: [TIME_LABEL]
📬 Modes: Inbox scan + Follow-up tracker [+ Confirm-before-send ON if FOLLOWUP_MODE]
```

---

## STEP 0.5 — LOAD USER PROFILE

Read user preferences. Check in order (first match wins):
1. `~/.claude/pickle/prefs.json`
2. (no fallback — `/pickle-setup` is retired; if `~/.claude/pickle/prefs.json` is absent, use generic scoring)

Extract:
- `user_name` → `USER_NAME`
- `user_role` → `USER_ROLE`
- `role_context` → `ROLE_CONTEXT`

**`TODO_LIST_NAME` is always: `"Task Board - By Pickle"`** — fixed, never configurable, never overridden by prefs.

Parse `ROLE_CONTEXT` into `ROLE_KEYWORDS[]` (action verbs + domain nouns). Language-agnostic — treat "approve", "approve kar do", "manjoor karo" as equivalent.

If prefs missing → proceed with generic scoring. Never block on missing prefs.

Print:
```
🎯 Personalised scoring enabled — Role: $USER_ROLE · Focus: [top 8 keywords]
📋 To Do list: Task Board - By Pickle
```

---

## STEP 1 — LOAD AUTH TOKEN

Pickle always uses its own Graph API token path. No connector detection — your token, your machine.

```bash
cat ~/.claude/pickle/teams-config.json 2>/dev/null
```

Expected structure:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "0.A...",
  "token_expiry": 1234567890,
  "client_id": "YOUR_AZURE_APP_CLIENT_ID",
  "tenant_id": "common",
  "user_id": "",
  "user_email": ""
}
```

If file exists and `access_token` is non-empty:
- Set `ACCESS_TOKEN` from file
- Check token expiry: if `token_expiry < now + 300` (expires in < 5 min), attempt refresh (see Appendix A)
- Print: `✅ Token loaded`

### If config file is missing or `access_token` is empty — print setup guide and STOP

```
❌ Microsoft Teams access not configured.

Two ways to set this up (both keep the token on your machine):

── Quick test (Graph Explorer — 1-hour token, no Azure app needed) ──────
  1. Go to: https://developer.microsoft.com/graph/graph-explorer
  2. Sign in with your Microsoft/Teams account
  3. Run: GET https://graph.microsoft.com/v1.0/me
  4. Open browser DevTools → Network → copy the "Authorization: Bearer eyJ..." value
  5. Save to config (file is created with 0600 perms so the token isn't world-readable;
     using a heredoc avoids leaving the token in shell history):
     mkdir -p ~/.claude/pickle
     umask 077
     cat > ~/.claude/pickle/teams-config.json <<'EOF'
     {"access_token":"PASTE_TOKEN_HERE"}
     EOF
     chmod 600 ~/.claude/pickle/teams-config.json
  Note: This token expires in ~1 hour. For persistent access, use Option 3.

── Option 2: Azure AD App (persistent — recommended, auto-refreshes) ────
  1. portal.azure.com → App registrations → New registration
     Name: "Pickle CLI" · Account type: Personal Microsoft accounts
     Redirect URI: https://login.microsoftonline.com/common/oauth2/nativeclient
  2. API permissions → Add → Microsoft Graph → Delegated:
     • Chat.Read                  • ChannelMessage.Read.All
     • Team.ReadBasic.All         • User.Read
     • Tasks.ReadWrite            • Calendars.Read
     • offline_access
  3. Note your Client ID from the overview page
  4. Run device flow auth (replace CLIENT_ID):
     curl -X POST "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode" \
       -H "Content-Type: application/x-www-form-urlencoded" \
       -d "client_id=CLIENT_ID&scope=Chat.Read ChannelMessage.Read.All Team.ReadBasic.All User.Read Tasks.ReadWrite offline_access"
  5. Open the URL shown, enter the code, sign in
  6. Exchange for tokens:
     curl -X POST "https://login.microsoftonline.com/common/oauth2/v2.0/token" \
       -H "Content-Type: application/x-www-form-urlencoded" \
       -d "grant_type=device_code&client_id=CLIENT_ID&device_code=DEVICE_CODE"
  7. Save response to ~/.claude/pickle/teams-config.json (includes refresh_token for auto-renewal)

Run /pickle-teams again after completing setup.
```

---

## STEP 2 — VALIDATE AUTH + GET MY PROFILE

```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me?\$select=id,displayName,mail,userPrincipalName"
```

Parse HTTP status from last line. If `401`:
```
❌ Token expired or invalid.
  • If you used the Graph Explorer quick-test token: it expires in ~1 hour — fetch a fresh one.
  • If you used the Azure AD app token: refresh via:
    curl -X POST "https://login.microsoftonline.com/common/oauth2/v2.0/token" \
      -d "grant_type=refresh_token&client_id=YOUR_CLIENT_ID&refresh_token=YOUR_REFRESH_TOKEN"
```
STOP.

If `403`:
```
❌ Missing Graph API permissions.
  Required scopes: Chat.Read, ChannelMessage.Read.All, Team.ReadBasic.All, User.Read, Tasks.ReadWrite
  Go to portal.azure.com → your app → API permissions → Add the missing ones → Grant admin consent.
```
STOP.

Set from response JSON:
- `MY_USER_ID` = `id`
- `MY_DISPLAY_NAME` = `displayName`
- `MY_EMAIL` = `mail` (fallback: `userPrincipalName`)
- `MY_AT_ID` = `MY_USER_ID` (used to match `mentions[].mentioned.user.id` in messages)

Print: `✅ Authenticated as: $MY_DISPLAY_NAME ($MY_EMAIL)`

---

## STEP 2.5 — LOAD STATE + INIT TO DO LIST

### Load state.json

```bash
cat ~/.claude/skills/pickle-teams/state.json 2>/dev/null || echo '{"version":2,"last_run":0,"seen_messages":{},"todo_list_id":null,"self_heal_count":0}'
```

Parse into `STATE` object.

### Find or create To Do list

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/todo/lists?\$select=id,displayName"
```

Look for list where `displayName == "Task Board - By Pickle"`.

If not found, create:
```bash
curl -s -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Task Board - By Pickle"}' \
  "https://graph.microsoft.com/v1.0/me/todo/lists"
```

Set `TODO_LIST_ID` from the list `id`.

If `STATE.todo_list_id` exists but differs from current → update state (list was recreated).

### Fetch existing Pickle tasks (for dedupe)

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/todo/lists/$TODO_LIST_ID/tasks?\$filter=status%20ne%20'completed'&\$select=id,title,body,status"
```

Extract all source URLs from task bodies (lines matching `🔗 Source: https://teams.microsoft.com/...`).
Build `EXISTING_SOURCE_URLS[]` for dedupe comparison in Step 7.

Print: `📋 To Do list ready: "$TODO_LIST_NAME" (${EXISTING_COUNT} open tasks)`

---

## STEP 3 — DISCOVER ALL TEAMS AREAS

Print: `🔍 Discovering Teams areas...`

### 3a — Joined Teams

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/joinedTeams?\$select=id,displayName,description&\$top=50"
```

Limit to 50 teams max. For each team, fetch channels:

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/teams/$TEAM_ID/channels?\$select=id,displayName,membershipType&\$top=50"
```

Include channel types: `standard`, `private`. Skip `shared` channels (may require elevated permissions).

Build `CHANNELS[]`:
```json
{
  "team_id": "...",
  "team_name": "...",
  "channel_id": "...",
  "channel_name": "...",
  "is_general": true/false,
  "membership_type": "standard/private"
}
```

Limit: max 200 channels total. Prioritise: General channels first, then by team importance.

### 3b — Chats (DMs + Group + Meeting)

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/chats?\$expand=lastMessagePreview&\$select=id,chatType,topic,lastMessagePreview&\$top=100"
```

Filter to chats where `lastMessagePreview.createdDateTime >= OLDEST_ISO` OR `lastMessagePreview` is null (active but no preview).

Types to scan — priority order:
| Type | Label | Priority |
|------|-------|----------|
| `oneOnOne` | 1:1 DM | HIGH — always scan |
| `group` | Group chat | MEDIUM — scan if active |
| `meeting` | Meeting chat | MEDIUM — scan for action items |

Build `CHATS[]`:
```json
{
  "chat_id": "...",
  "chat_type": "oneOnOne/group/meeting",
  "topic": "...",
  "last_activity_iso": "..."
}
```

For 1:1 chats, fetch participant display name:
```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/chats/$CHAT_ID/members?\$select=displayName,userId"
```

Extract the participant who is NOT me → set as `chat_display_name`.

### 3c — Planner Tasks (assigned to me)

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/planner/tasks?\$select=id,title,planId,dueDateTime,createdDateTime,createdBy,assignments&\$top=50"
```

Filter: `completedDateTime == null` (open tasks).
Filter: assigned to `MY_USER_ID`.

Build `PLANNER_ASSIGNED[]` for Step 5 classification.

### 3d — Planner Tasks (created by me, assigned to others — Mode B)

From the same tasks endpoint result, filter:
- `createdBy.user.id == MY_USER_ID`
- Assigned to someone other than me
- `completedDateTime == null`

Build `PLANNER_DELEGATED[]` for Mode B.

Print:
```
📊 Teams areas discovered:
   Teams    : [N] teams · [M] channels
   Chats    : [X] 1:1 DMs · [Y] group · [Z] meeting
   Planner  : [P] assigned to me · [Q] delegated by me (open)
```

---

## STEP 4 — SCAN MESSAGES

Print: `📥 Scanning messages... (this may take 15–30s)`

**Rate limit awareness:** Graph throttles at ~120 requests/10s for Chat messages. Insert a 500ms gap (`sleep 0.5`) between consecutive chat message fetches.

### 4a — Channel Messages (Mode A — mentions only)

For each channel in `CHANNELS[]`:

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/teams/$TEAM_ID/channels/$CHANNEL_ID/messages?\$filter=createdDateTime%20ge%20$OLDEST_ISO&\$top=50&\$select=id,from,createdDateTime,body,mentions,messageType,webUrl,replyToId,lastModifiedDateTime"
```

For each message:
1. Skip if `messageType != "message"` (system events, call records, etc.)
2. Check `mentions[]` array: if any entry has `mentioned.user.id == MY_USER_ID` → **INBOX CANDIDATE**
3. Check if message is a reply (`replyToId` exists): fetch root message, check if I sent the root → **INBOX CANDIDATE** (reply to my thread)
4. Check if I am `from.user.id` AND the message has no reply from others in the time window → **FOLLOWUP CANDIDATE** (I spoke, no one replied)

For inbox candidates that are thread roots, fetch replies to see if I've already responded:
```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/teams/$TEAM_ID/channels/$CHANNEL_ID/messages/$MESSAGE_ID/replies?\$top=20&\$select=id,from,createdDateTime"
```

If I've already replied after the mention → skip (not an open inbox item).

Build `CHANNEL_INBOX[]` and `CHANNEL_FOLLOWUP[]`.

### 4b — Chat Messages (Mode A + B — all messages)

For each chat in `CHATS[]`:

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/chats/$CHAT_ID/messages?\$filter=createdDateTime%20ge%20$OLDEST_ISO&\$top=100&\$select=id,from,createdDateTime,body,mentions,messageType,webUrl,replyToId"
```

Filter: `messageType == "message"` only.

**1:1 DMs:**
- Messages FROM the other person → always INBOX CANDIDATE (they're talking to me)
- Check: did I reply after their last message? If no → confirmed inbox item
- Messages FROM me with no response from them → FOLLOWUP CANDIDATE

**Group/Meeting chats:**
- Messages with `MY_USER_ID` in `mentions[]` → INBOX CANDIDATE
- Messages from me with no responses → FOLLOWUP CANDIDATE
- Meeting chats: also scan for patterns like "action item", "AI:", "TODO:", "@name will", "by [date]"
- Meeting chats: scan for `MY_DISPLAY_NAME` substring in plain text (e.g. if running user is "Priya" and text says "Priya will handle the API redesign") — not all meeting summaries use @mentions
- Adaptive Card messages from the Approvals app: body contains "approval", "approve", "pending your review" → always INBOX CANDIDATE regardless of mention status
- Loop components / collaborative notes in chat: treat as background context only, not inbox items
- System messages (messageType != "message"): skip entirely — these are call-started, member-added, etc. events

Build `CHAT_INBOX[]` and `CHAT_FOLLOWUP[]`.

Print progress: `  ✓ Scanned [N]/[TOTAL] areas...` (every 20 areas)

---

## STEP 4.5 — FILTER OUT NOISE (run BEFORE classification)

Before passing any message to Step 5's pattern classifier, drop the obvious noise. Tagging a status update as a reply-owed item (`stale-ask`) is how you end up with a To Do task titled "Reply to Alex — Today we'll be making the docs page live".

### ❌ SKIP unconditionally:

- **Pure FYIs with zero ask**: "FYI — we shipped X", "Update: X is done", "Today we'll be making Y live" — informational status, no question, no @-mention asking for input
- **Status updates from others**: "here's what I/we did" or "here's what I/we will do" without explicitly requesting my reply, decision, or approval
- **Acknowledgements**: "haven't tested yet, will check", "received, thanks", "noted", "ok will do" — these are MODE B follow-up tracking at most, NEVER MODE A inbox
- **Pure greetings**: "good morning", "happy birthday", celebrations
- **My own messages**: `from.user.id == MY_USER_ID` — unless it's a Mode B commitment thread
- **Completed with proof**: "done ✓ [link]", "shipped", with actual proof
- **Bot/automated messages**: messageType ≠ "message" (e.g. "systemEventMessage")
- **Meeting noise**: "thanks for joining", "see you next time", "recording link sent"

### 🚦 ACTIONABILITY GATE — apply to EVERY candidate before keeping

For each message that survived the SKIP list, answer this one question **explicitly** before adding to `ALL_INBOX[]`:

> **"What specific verb do I, $MY_NAME, need to do in response to this message?"**

| Answer | Action |
|---|---|
| A concrete verb (reply / decide / approve / share / fix / review / help / confirm / answer / unblock) + a clear object | ✅ INCLUDE — that verb maps to a `pattern-id` in Step 5 |
| "Read it" / "Be aware of it" | ❌ SKIP — reading isn't action |
| "Wait for them to deliver" | ❌ Route to MODE B (Follow-up Tracker), not Mode A inbox |
| "Can't tell — message is cut off" | ❌ SKIP — vague tasks pollute the board worse than missed ones |

Multilingual: Hindi/Gujarati intent maps to an English verb. "approve karein" → `approve`. "share kar do" → `share`. "bata do" → `answer/tell`. Detect on MEANING, not keywords — Teams users mix Hindi/Hinglish/Gujarati/English in one sentence; the title is always English, the body VERBATIM keeps the original.

### ⌨️ Typo tolerance · 🎭 sarcasm / indirect asks

- **Typos never downgrade detection.** Match on intent + fuzzy token, edit-distance ≤ 2 on content words, weekday/month transpositions ("thrusday"→Thursday). "aprove", "reveiw", "refnd", "acess" all still fire. Parse the typo-tolerant weekday map before computing deadlines.
- **Indirect asks are still asks.** "It'd be great if someone looked at the deploy 👀", "wonder who owns this now" → treat as the underlying action when I'm the plausible owner.
- **Sarcasm ≠ resolution.** "oh great, another late report 🙄" is an `escalation-complaint` signal, not an FYI, not "resolved."
- **Politeness masks urgency.** "no rush, but…" from a client on an overdue deliverable still gets the client-signal floor. When genuinely ambiguous → SKIP.

### 🔁 RESOLUTION GATE — run BEFORE keeping any item

An item is actionable only if **still open**:
1. **Did I already reply after the ask?** My latest message post-dates it → answered → SKIP (route to Mode B if my reply made a new promise).
2. **Is there already a non-`completed` To Do task for this `SOURCE_URL`?** → SKIP (Step 7 handles this fully; pre-filter here too).
3. **Closed in-thread?** a closure signal AFTER the ask ("done", "sorted", "ho gaya", "handled", "ignore") → SKIP.
4. **Deadline passed AND thing shipped?** a later "shipped/live/done" → SKIP (don't flag as `expired-promise`).

Only if all four fail does the item proceed. When unsure whether I replied, fetch the thread replies and check — never flag blind. For Mode B, "replied" ≠ "done": an ack ("on it") is `acknowledged-not-delivered`, not resolved — check ALL surfaces (chat replies, Planner status, files) before concluding no-reply.

---

## STEP 5 — CLASSIFY ITEMS

Merge:
- `ALL_INBOX = CHANNEL_INBOX[] + CHAT_INBOX[] + PLANNER_ASSIGNED[]`  (only items that passed Step 4.5)
- `ALL_FOLLOWUP = CHANNEL_FOLLOWUP[] + CHAT_FOLLOWUP[] + PLANNER_DELEGATED[]`

### 🧬 PATTERN TAXONOMY (tag every item with exactly ONE) — Teams-applicable set

Tag each item with **one** stable `kebab-case` pattern-id (IDs never change — state, dedup, reporting key on them). One pattern = one meaning; on multiple matches, cross-pattern dedup (Step 7) keeps the **most specific**. This taxonomy is the source of truth and the same vocabulary `pickle-clickup` and `pickle-slack` use — all three skills tag with these pattern-ids and the same **Mode A/B** split, so a user with two ecosystems sees one language. **Mode:** `A` owed *to* me · `B` *I* set it in motion. Detect on MEANING + fuzzy token; every example gives EN + Hinglish + a **typo'd** variant.

#### F1 · Reply owed (Mode A)
- **`stale-ask`** (A) — someone asked me a specific thing; neither done nor replied, ≥ 1 day. EN "send the Q3 numbers?" · Hinglish "Q3 ke numbers bhej dena" · Typo "snd me teh Q3 numbes". *Guardrail:* SKIP if I replied after it or it closed in-thread.
- **`ghosted-message`** (A) — a 1:1/mention I never acknowledged at all, ≥ 24h — silence itself is the risk. *Guardrail:* upgrades to `stale-ask` if a clear ask emerges — never double-count.
- **`unanswered-question`** (A) — a direct question at me still open (`?` / `…hai?` / `…che?`). *Guardrail:* rhetorical/aimed-at-someone-else SKIP.
- **`approval-pending`** (A) — someone needs my yes/no/sign-off ("approve?", "LGTM?", "confirm karein", "tame confirm karo"). Approvals-app Adaptive Cards always fire this.
- **`decision-pending`** (A) — an open call with a tradeoff waits on me ("your call", "kya karna chahiye", "decide kar lo"). Distinguish from a quick `unanswered-question`.
- **`blocked-waiting-on-me`** (A · **priority floor HIGH**) — someone's work is stalled specifically on me ("blocked on you", "ruk gaya, aap ka wait"). Verify they wait on *me*.
- **`bottleneck`** (A · **priority floor HIGH** · meta) — ≥ 3 open A-items all waiting on my review/approval → emit ONE summary task in addition to the individual ones.
- **`meeting-action-item`** (A) — I was assigned an action in a meeting chat ("action item:", "AI:", "@{MY_NAME} will…", "you'll handle") that isn't tracked. Also match `MY_DISPLAY_NAME` in plain text, not just @mentions. SKIP if already a Planner/To Do item or assigned to someone else.
- **`fyi-needs-action`** (A · **the trap**) — an "FYI / heads up" message carrying a latent action/risk I own. EN "Heads up — client said they'll churn if the report's late again." · Hinglish "FYI, client bol raha tha report late hui toh churn kar denge" · Typo "heds up — clint said theyll churn". *Guardrail:* **most FYIs are noise → SKIP (default).** Only fire on a concrete verb I must do.

#### F2 · Commitment owed to me (Mode B)
- **`delegation-stalled`** (B) — I asked someone to do a specific thing; no delivery evidence. EN "finish the onboarding doc this week?" · Hinglish "onboarding doc is week complete kar dena" · Typo "finsh teh onbording doc". *Guardrail:* "replied" ≠ "done".
- **`expired-promise`** (B) — promised by a time now passed, nothing delivered. EN "banners by Thursday" · Hinglish "Thursday tak bhej dunga" · Typo "by thrusday". *Guardrail:* a later "shipped/done" after the deadline → resolved; parse weekday typos.
- **`commitment-with-date`** (B) — a dated commitment still in the future (a Planner task due within 24h feeds this); tracked to surface near the date. Converts to `expired-promise` once it slips — never both.
- **`recurring-commitment-stopped`** (B) — a recurring update I asked for was flowing and stopped. Weekends don't count for a workday cadence.
- **`acknowledged-not-delivered`** (B) — "on it / will do / ho jayega" but nothing arrived. Allow ≥ 1 day before nagging.

#### F3 · My open loop (Mode A, self-directed)
- **`my-open-commitment`** (A · owner = me) — I said "I'll do X / dekh leta hoon" and never closed it. The ONE Mode-A pattern keyed on my own messages.

#### F4 · Risk / security (Mode A)
- **`secret-leaked`** (A · **URGENT floor & ceiling**) — an API key/token/password pasted in plaintext. **Redact** in title/body (first/last 4 only); never echo the full secret. Doc placeholders must NOT fire.
- **`access-security-request`** (A) — someone asks me to grant access/a seat, OR flags access to revoke. Grant + revoke both (revoke on a departing person → HIGH+).
- **`orphaned-work`** (A) — a person is leaving/left and work is about to become unowned ("last day", "handover", "offboarding"). Pair with their open Planner items before flagging.

#### F5 · Money / customer (Mode A)
- **`money-refund-pending`** (A · **priority floor HIGH**) — a payment/refund/invoice/payout owed and unresolved. Overdue ≥ 7 days or customer chasing → URGENT.
- **`escalation-complaint`** (A · **priority floor HIGH; URGENT on churn**) — a customer/partner thread escalated to me, or a frustrated client signalling churn ("escalating to you", "reconsidering", "report nahi aaya"). Client signal forces HIGH minimum.

#### F6 · Work-state hygiene — **ClickUp-native; NOT fired by pickle-teams**
The F6 family (`stale-in-progress`, `zombie-task`, `effort-output-mismatch`, `weak-task-description`, `blocker-aging`, `standup-theater`) fires on ClickUp **task-board state**, which Teams does not expose the same way. Leave these to `pickle-clickup`.

#### F7 · Cross-tool sync gap ([needs ClickUp/Slack token connected])
Compare "said in Teams" vs "on the card in another tool." **Isolation:** any task `pickle-teams` creates stays in Microsoft To Do; the actual card-fix is surfaced as a To Do task reminding *you* to record/update it — Teams never writes to another tool's board.
- **`ghost-done`** (B) — marked "done" in a Teams chat but the card was never updated.
- **`dm-only-completion`** (B) — completion evidence lives only in Teams chat; the card still shows In Progress.
- **`manager-bottleneck`** (A) — multiple items across tools await MY review (feeds `bottleneck`, threshold ≥ 3).
- **`decision-in-dm`** (A) — a decision made in a Teams chat but never recorded on the card/doc. If it *was* recorded, SKIP.

### Mode A — Inbox Classification

For each inbox item, tag exactly ONE `pattern-id` (all Mode A) from the taxonomy above, using these Teams detection signals:

| `pattern-id` | Detection Signals |
|--------------|-------------------|
| `approval-pending` | "can you approve", "approve kar do", "LGTM?", "sign off", "confirm this", "give green light", "manjoor karo" |
| `decision-pending` | Direct question with a tradeoff, "what do you think", "kya lagta hai", "your call", "decide kar lo", "aap batao" |
| `unanswered-question` | A quick/factual direct question ending in `?` (`…hai?` / `…che?`) at me, still open |
| `stale-ask` | 1:1 DM or @mention with a concrete ask + no reply from me in window; also "please review", "review kar lo", "check this", "feedback chahiye", "PR ready", "dekh lo" |
| `ghosted-message` | 1:1/@mention I never acknowledged at all (no verb yet, silence is the risk), ≥ 24h |
| `blocked-waiting-on-me` | "blocked", "stuck", "ruk gaya", "aage nahi badh pa raha", "waiting on you", "need you to unblock" |
| `meeting-action-item` | Meeting chat message matching "action item:", "AI:", "@{MY_NAME} will", "you'll handle" |
| *(Planner)* | Planner task assigned to me (from 3c) → tag by its content using the patterns above |

(Risk / money items — `secret-leaked`, `access-security-request`, `money-refund-pending`, `escalation-complaint` — carry their own floors from the taxonomy and win cross-pattern dedup.)

Extract for each item:
- `sender_name` — display name of who sent it
- `source_message` — first 200 chars of message body (strip HTML: remove `<at>`, `<p>`, etc.)
- `action_summary` — 1–2 sentence plain English: what is needed from me
- `platform_area` — "{team_name} / #{channel_name}" or "1:1 with {name}" or "Group: {topic}"
- `source_url` — `webUrl` from API response (direct Teams deep link)
- `received_at_unix` — `createdDateTime` as Unix timestamp

### Mode B — Follow-up Classification

For each follow-up item, tag exactly ONE `pattern-id` (all Mode B) from the taxonomy above, using these Teams detection signals:

| `pattern-id` | Detection Signals |
|--------------|-------------------|
| `delegation-stalled` | I asked: "can you do", "please handle", "kar dena", "manage kar lo", "you take this", or asked a question with no response; also a Planner task I created and assigned to others (from 3d) with no delivery |
| `acknowledged-not-delivered` | I asked for a file/doc/output ("share the", "bhej dena", "send me", "jab ready ho tab") and got only an ack ("on it", "ho jayega"), nothing delivered |
| `commitment-with-date` | A dated commitment still ahead — e.g. a Planner task with `dueDateTime` within 24h assigned to others; converts to `expired-promise` once it slips |
| `expired-promise` | They promised by a time now passed with nothing delivered |
| `recurring-commitment-stopped` | A recurring update I asked for was flowing and stopped |

Extract for each item:
- `assignee_name` — who I delegated to
- `original_ask` — what I asked (first 150 chars)
- `asked_at_unix` — when I sent the original message
- `days_waiting` — `(now - asked_at_unix) / 86400`

---

## STEP 6 — SCORE AND PRIORITISE

Score each item 0–100:

### Base score

| Factor | Points |
|--------|--------|
| 1:1 DM | +35 |
| `approval-pending` | +28 |
| `blocked-waiting-on-me` | +25 |
| `decision-pending` | +22 |
| `meeting-action-item` | +20 |
| @mention in channel | +20 |
| `stale-ask` (review/reply owed) | +18 |
| Planner task assigned to me | +15 |
| Group chat | +12 |
| Meeting chat | +12 |
| `delegation-stalled` follow-up (Mode B) | +15 |
| `commitment-with-date` near/past due (Mode B) | +25 |
| `acknowledged-not-delivered` follow-up (Mode B) | +12 |

### Role keyword boost

| Matches in item content | Boost |
|------------------------|-------|
| 3+ `ROLE_KEYWORDS[]` | +20 |
| 2 keywords | +15 |
| 1 keyword | +10 |
| 0 keywords | 0 |

### Age modifier

| Message age | Modifier |
|-------------|----------|
| < 2 hours | +20 |
| 2–8 hours | +10 |
| 8–24 hours | 0 |
| > 24 hours | −10 |
| > 72 hours | −20 |

### Recency of activity (for updated items)

| Last activity | Modifier |
|---------------|----------|
| Updated item (from dedupe) | +10 |

### Priority buckets

| Score | Priority | Label |
|-------|----------|-------|
| 75+ | P1 | 🔴 URGENT — act today |
| 50–74 | P2 | 🟡 IMPORTANT — act this week |
| 25–49 | P3 | 🟢 LOW — act when possible |
| < 25 | P4 | ⚪ NOISE — skip |

Drop all P4 items. Do not create tasks for them.

Sort remaining items: P1 first, then P2, then P3. Within each bucket: sort descending by score.

Print: `⚡ Classified: [P1 count] urgent · [P2 count] important · [P3 count] low · [P4 count] noise (dropped)`

---

## STEP 7 — DEDUPE AGAINST STATE.JSON

For each scored item, generate stable `SOURCE_URL`:
- Channel message: use `webUrl` from API response (e.g. `https://teams.microsoft.com/l/message/...`)
- Chat message: use `webUrl` from API response
- Planner task: `planner:{task-id}` (no deep link available from API)
- If `webUrl` is null/empty: construct from IDs → `teams:{team-id}:{channel-id}:{message-id}`

**Cross-pattern dedup (one source_id → one task):** an item is uniquely keyed by its `SOURCE_URL`. One `SOURCE_URL` yields **exactly ONE** To Do task even if it matches multiple patterns — pick the **most specific** by this order and record it as the primary `pattern-id`: **F4/F5 (risk / money) > F1 decision/approval/blocked > F1 reply/question > F7.** `bottleneck` is the sole exception (an additional summary task by design). The state-keyed logic below guarantees the same message never becomes two tasks across runs.

**Dedupe logic:**

```
for each item where SOURCE_URL exists in STATE.seen_messages:
  stored = STATE.seen_messages[SOURCE_URL]

  if stored.status == "done":
    → SKIP entirely

  compute ACTIVITY_HASH = sha256-first-8(sender_name + source_message + platform_area)

  if ACTIVITY_HASH == stored.activity_hash:
    → SKIP (no new activity on this item)
  else:
    → KEEP as UPDATE (new activity on known item)
    → bump score by +10
    → update stored.last_activity_seen = now
    → update stored.activity_hash = ACTIVITY_HASH

for each item NOT in STATE.seen_messages:
  → KEEP as NEW
```

Use Bash to compute activity hash:
```bash
echo -n "${sender_name}${source_message}${platform_area}" | shasum -a 256 | cut -c1-8
```

**Self-heal:** For each item where `STATE.seen_messages[SOURCE_URL].todo_task_id` exists, verify the To Do task still exists:
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://graph.microsoft.com/v1.0/me/todo/lists/$TODO_LIST_ID/tasks/$STORED_TASK_ID"
```

If response is `404` (task deleted/completed externally) → remove from state, treat item as NEW. Increment `STATE.self_heal_count`.

Print: `🔄 Dedupe: [NEW_COUNT] new · [UPDATED_COUNT] updated · [SKIPPED_COUNT] unchanged · [SELFHEAL_COUNT] self-healed`

---

## STEP 8 — VALIDATE + CREATE TO DO TASKS

### Hard validation gate

Each item MUST have ALL of the following before a task is created. If any field is missing or empty → SKIP the item and print a warning.

Required fields:
- `SOURCE_URL` — non-empty string
- `sender_name` — non-empty string
- `action_summary` — non-empty, min 10 characters
- `priority` — one of P1/P2/P3
- `platform_area` — non-empty string
- `pattern_id` — a valid `pattern-id` from the taxonomy (with its Mode A/B)

### Task title format — the NAMING GRAMMAR (unified across all three tools)

A title is an **instruction to my future self**, not a transcript. One grammar governs every Pickle task:

```
{SEVERITY} {TYPE-EMOJI} {ACTION-VERB} {OBJECT} — {Counterparty}  [Teams]
```

- **`{SEVERITY}`** — a word prefix ONLY for the top two tiers: **P1 → `🔴 CRITICAL`** · **P2 → `🟠 HIGH`** · **P3 → *(no severity word)***. (This replaces the old `[P1]`/`[P2]`/`[P3]` prefixes with the unified culture — the To Do `importance` field still carries the machine priority.)
- **`{TYPE-EMOJI}`** — exactly one, by action type: `📥` Reply (`stale-ask`, `ghosted-message`, `unanswered-question`) · `🧭` Decision (`decision-pending`, `decision-in-dm`) · `✅` Approve (`approval-pending`) · `⛏️` Unblock (`blocked-waiting-on-me`) · `⏳` Follow-up (all F2) · `🔐` Security (`secret-leaked`, `access-security-request`, `orphaned-work`) · `💰` Money (`money-refund-pending`, `escalation-complaint`) · `📅` Meeting action (`meeting-action-item`) · `🔁` Sync gap (`ghost-done`, `dm-only-completion`) · `🚦` Bottleneck (`bottleneck`/`manager-bottleneck`).
- **`{ACTION-VERB}`** — imperative, from: `Reply · Answer · Decide · Approve · Confirm · Review · Sign · Share · Send · Fix · Ship · Unblock · Help · Schedule · Cancel · Refund · Investigate · Grant · Revoke · Record · Reassign · Rotate · Follow up · Update · Publish · Deploy · Merge · Set up · Add · Remove · Test`. Multilingual asks map to an English verb first; **the title is always English**.
- **`{OBJECT}`** — a concise noun phrase naming what specifically needs acting on (2–6 words). NOT a raw excerpt, NOT a sentence.
- **`— {Counterparty}`** — em-dash + the person or channel (Mode B: who owes me). Followed by the `[Teams]` source tag.

**Type templates** (grammar applied per `pattern-id`):
```
🔴 CRITICAL 📥 Reply about {object} — {sender} [Teams]        (stale-ask / ghosted-message · Mode A)
🔴 CRITICAL ✅ Approve {object} — {sender} [Teams]            (approval-pending · Mode A)
🔴 CRITICAL ⛏️ Unblock {object} — {sender} [Teams]           (blocked-waiting-on-me · Mode A)
🟠 HIGH 🧭 Decide {object} — {sender} [Teams]                 (decision-pending · Mode A)
🟠 HIGH 📥 Review {object} — {sender} [Teams]                 (stale-ask · Mode A)
🟠 HIGH 📅 Do {object} (meeting action) — {sender} [Teams]    (meeting-action-item · Mode A)
⏳ Follow up on {object} — {assignee} [Teams]                 (delegation-stalled · Mode B)
⏳ Follow up on {object} before deadline — {assignee} [Teams] (commitment-with-date · Mode B)
```

**Hard rules:** ≤ 80 chars total (if over, drop the severity word first, then trim the object — never the verb or counterparty) · MUST start with `{SEVERITY}`/emoji then a verb · MUST end with `— {Counterparty} [Teams]` · **BANNED**: `{Name}: {message excerpt}`, mid-sentence cuts, verbatim greetings/fillers, a colon introducing a quote.

| ❌ BAD (raw excerpt) | ✅ GOOD (grammar) |
|---|---|
| `Today we'll be making the mcp page live` | *(skip — pure FYI, no ask)* |
| `Hello there, accounts tickets me refunds re` | `🔴 CRITICAL 💰 Decide live-chat refund policy — Alex [Teams]` |
| `aap MCP ke Video ki baat kar rah ho ??` | `📥 Answer which MCP video I meant — Sam [Teams]` |
| `[screenshot]` (no caption) | `🔐 Rotate leaked key (sk-proj-…VugA) — #general [Teams]` |

If you cannot produce a concrete `{OBJECT}` + verb, the item didn't pass the Step 4.5 ACTIONABILITY GATE — re-run the gate; if still no verb, SKIP (don't create a noisy task).

### Task body format

For **Inbox items (Mode A)**:
```
Pattern: {pattern-id}   ·   Mode: A · inbox
📍 Area: {platform_area}   (Counterparty: {sender_name})
🗓 When: {relative_time} (e.g. "2 hours ago")
💬 Verbatim: "{exact quote — original language}"  [if non-English: (≈ "…english…")]
⏳ What's pending: {action_summary — the open loop}
🎯 Why (priority: {P1/P2/P3} — {1-line rationale}): {consequence of leaving it}
📋 Next step: • {most useful move}  • {step 2}
🔗 Source: {SOURCE_URL}

---
🥒 Pickle v1.2.0 · pickle-teams · by Aditya Sharma
Want help onboarding AI into your team? → adityaarsharma.com/?src=pickle-report · {ISO_TIMESTAMP}
```

For **Follow-up items (Mode B)**:
```
Pattern: {pattern-id}   ·   Mode: B · follow-up
📍 Area: {platform_area}   (Counterparty: {assignee_name} — owes me)
💬 Verbatim (what I asked): "{original_ask — original language}"
⏳ What's pending: Asked {relative_days_waiting} ago, no update since
🎯 Why (priority: {P1/P2/P3} — {1-line rationale}): {why it matters now}
📋 Next step: • Chase {assignee_name} once  • {escalate/reassign if still silent}
🔗 Source: {SOURCE_URL}

---
🥒 Pickle v1.2.0 · pickle-teams · by Aditya Sharma
Want help onboarding AI into your team? → adityaarsharma.com/?src=pickle-report · {ISO_TIMESTAMP}
```

**`Pattern` + `Mode` are required fields** (make the taxonomy visible + let reporting group by pattern). **`Verbatim`** keeps the original language — redact secrets (`sk-proj-…VugA`). **`Why (priority: …)`** forces the tier rationale onto the task. Keep the `🔗 Source:` line exactly (Step 2.5 dedupe regex-matches it).

### Create task via API

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"$TASK_TITLE\",
    \"body\": {
      \"contentType\": \"text\",
      \"content\": \"$TASK_BODY\"
    },
    \"importance\": \"$IMPORTANCE\",
    \"dueDateTime\": {
      \"dateTime\": \"$DUE_ISO\",
      \"timeZone\": \"UTC\"
    }
  }" \
  "https://graph.microsoft.com/v1.0/me/todo/lists/$TODO_LIST_ID/tasks"
```

Importance mapping: `P1 → "high"`, `P2 → "normal"`, `P3 → "low"`

Due date mapping: `P1 → today`, `P2 → today + 2 days`, `P3 → today + 5 days`

After successful creation, extract returned `task_id` and store in state.

Print for each task: `  ✓ Created: "$TASK_TITLE"`

---

## STEP 9 — FOLLOWUP MODE (only if FOLLOWUP_MODE = true)

Show follow-up candidates one by one. For each item in `ALL_FOLLOWUP` that passed dedupe and validation:

```
────────────────────────────────────────
📤 Follow-up #{N} of {TOTAL}
   To: {assignee_name}
   Area: {platform_area}
   You asked ({days_waiting} days ago): "{original_ask}"
   Suggested message: "{follow_up_message}"

   Confirm: [y] Send  [s] Skip  [e] Edit message  [a] Send all remaining
────────────────────────────────────────
```

Wait for explicit user confirmation on each. Never auto-send without `y` or `a`.

**Follow-up message templates** (language-matched to original):

English:
```
Hey {assignee_name}, following up on "{original_ask_short}" — any update? 🙂
```

Hindi/Hinglish (detect from original ask language):
```
Hey {assignee_name}, "{original_ask_short}" ke baare mein follow-up kar raha tha — koi update?
```

#### Sending to Teams chat

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"body\": {\"contentType\": \"text\", \"content\": \"$FOLLOWUP_MESSAGE\"}}" \
  "https://graph.microsoft.com/v1.0/chats/$CHAT_ID/messages"
```

#### Sending as channel thread reply

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"body\": {\"contentType\": \"text\", \"content\": \"$FOLLOWUP_MESSAGE\"}}" \
  "https://graph.microsoft.com/v1.0/teams/$TEAM_ID/channels/$CHANNEL_ID/messages/$ROOT_MESSAGE_ID/replies"
```

Track sent follow-ups in `STATE.followups_sent[]`.

---

## STEP 10 — SAVE STATE + PRINT SUMMARY

### Build updated state JSON

```json
{
  "version": 2,
  "last_run": CURRENT_UNIX,
  "seen_messages": {
    "{SOURCE_URL}": {
      "first_seen": UNIX,
      "last_activity_seen": UNIX,
      "activity_hash": "8-char-hex",
      "todo_task_id": "microsoft-todo-task-id",
      "todo_task_title": "Task title...",
      "status": "open",
      "priority": "P1",
      "pattern_id": "approval-pending",
      "sender": "Display Name",
      "platform_area": "Team / #channel or 1:1 with Name"
    }
  },
  "todo_list_id": "list-id-string",
  "self_heal_count": 0,
  "followups_sent": []
}
```

Write:
```bash
cat > ~/.claude/skills/pickle-teams/state.json << 'STATEEOF'
{STATE_JSON}
STATEEOF
```

### Print final summary

```
════════════════════════════════════════
  🥒 pickle-teams — Done
════════════════════════════════════════

📥 INBOX (needs your action)
  🔴 P1 Urgent    : [N] items
  🟡 P2 Important : [N] items
  🟢 P3 Low       : [N] items
  ⚪ P4 Noise      : [N] dropped

📤 FOLLOW-UP (you delegated)
  [N] items tracked [+ X sent if FOLLOWUP_MODE]

📊 Coverage
  Teams scanned   : [N] teams · [M] channels
  Chats scanned   : [X] 1:1 DMs · [Y] groups · [Z] meetings
  Messages read   : [TOTAL_COUNT]
  Planner tasks   : [P] assigned to me · [Q] delegated by me
  Tasks created   : [N] (To Do: "Task Board - By Pickle")
  Deduped/skipped : [N] unchanged · [N] updated
  Self-healed     : [N] externally completed

🔗 Open To Do: https://to-do.microsoft.com/tasks/inbox

⏱ Run time: ~[X]s

────────────────────────────────────────
  🥒 Pickle v1.2.0 · free · local · open source
  Built by Aditya Sharma · adityaarsharma.com

  Pickle shows what slips through. Getting a whole team to actually
  run on AI — without the chaos — is the harder part. That's my work.
  → Want help onboarding AI into your team?  Let's talk: adityaarsharma.com/?src=pickle-report
```

---

## ERROR HANDLING

| Error | Action |
|-------|--------|
| `401 Unauthorized` | Token expired. Print refresh instructions. STOP. |
| `403 Forbidden` | Missing Graph permission. List required scopes. STOP. |
| `429 Too Many Requests` | Pause 30s (`sleep 30`), retry once. If still 429, skip that area and continue. |
| `404 Not Found` on a resource | Skip that team/channel/chat. Continue. |
| Empty `value` array | Skip, no messages in that area. Continue. |
| `teams-config.json` malformed | Print: "Config file is invalid JSON. Expected: {access_token: '...'}". STOP. |
| Bash `curl` not found | Print: "curl is required. Install via: brew install curl". STOP. |
| Channel scan fails with 403 | Some channels require member/owner. Skip and note in summary. |
| Message body is null | `body.content` can be null for system messages or deleted messages. Always null-check before parsing. Skip if null. |
| Adaptive Card messages | `body.contentType == "html"` but content is `<attachment...>`. Strip to extract any plain text. Flag as "[Adaptive Card — open in Teams to view full content]" |
| Deleted message | `deletedDateTime` non-null. Skip entirely — do not treat as inbox item. |
| Guest user @mention | Guest user IDs in `mentions[].mentioned.user.id` may not match `MY_USER_ID` pattern. Also check `mentions[].mentioned.user.displayName` against `MY_DISPLAY_NAME` as fallback. |
| Message from bot/app | `from.application` non-null (bot/app sender). Skip for inbox scoring but retain if it's an approval request (e.g. Approvals app) — detect by checking message body for "approve", "review", "action required". |
| Private channel 403 | Private channels require explicit membership. Log as "skipped (private — no access)" in summary. Never block the run. |
| Federated/external user | `from.user.tenantId` differs from your tenant. Still valid sender — treat as normal inbox item. |
| Meeting chat with no participants | Meeting chats created from calendar invites can have 0 members in `/chats/{id}/members`. Skip participant name fetch if empty, label as "Meeting chat: {topic}". |
| Pagination | All `curl` calls returning `value[]` MUST follow `@odata.nextLink` for pagination. Never assume first page is complete for DMs or active channels. |

---

## APPENDIX A — TOKEN AUTO-REFRESH

If `token_expiry` in config is within 300 seconds of now AND `refresh_token` + `client_id` are present, attempt refresh before scanning.

**HARD RULES — never wipe a working credential on a failed refresh:**
1. Parse the response JSON. Only proceed if it contains a non-empty `access_token` field.
2. Write to a `.tmp` sibling file with `chmod 600`, then `mv` over the live config (atomic replace).
3. Never log/echo `$REFRESH_TOKEN`, `$ACCESS_TOKEN`, or the full response on stderr/stdout.
4. If the refresh response is anything other than a valid token JSON (HTTP error, HTML error page, partial body) → KEEP the existing config untouched, print "token refresh failed — re-run with manual token". Do NOT overwrite.

```bash
REFRESH_RESPONSE=$(curl -s -X POST \
  "https://login.microsoftonline.com/common/oauth2/v2.0/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "refresh_token=$REFRESH_TOKEN" \
  --data-urlencode "scope=Chat.Read ChannelMessage.Read.All Team.ReadBasic.All User.Read Tasks.ReadWrite offline_access")

# Validate: must be JSON, must contain non-empty access_token
NEW_ACCESS=$(printf '%s' "$REFRESH_RESPONSE" | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin)
  t=d.get("access_token","")
  print(t if t else "")
except Exception:
  print("")' 2>/dev/null)

if [ -n "$NEW_ACCESS" ]; then
  # Atomic write — never truncate the live file in place
  umask 077
  TMP="$HOME/.claude/pickle/teams-config.json.tmp.$$"
  printf '%s' "$REFRESH_RESPONSE" | python3 -c 'import sys,json,os
d=json.load(sys.stdin)
d["token_expiry"]=int(__import__("time").time())+int(d.get("expires_in",3600))-60
print(json.dumps(d, indent=2))' > "$TMP"
  chmod 600 "$TMP"
  mv "$TMP" "$HOME/.claude/pickle/teams-config.json"
  echo "🔄 Token refreshed automatically"
else
  echo "⚠️  Token refresh failed — keeping existing config. Re-authenticate via Azure AD device flow if needed (ask Pickle in chat: \"Pickle set me up for Teams\")."
  # DO NOT modify teams-config.json. Either continue with existing token or STOP — never wipe credentials.
fi
```

---

## APPENDIX B — TEAMS HTML BODY PARSING

Teams message `body.content` is HTML. When extracting plain text for `action_summary` and `source_message`, strip:
- `<at id="...">name</at>` → replace with `@name`
- `<p>...</p>` → extract text content
- `<br>` → newline
- `<b>`, `<i>`, `<u>`, `<strike>` → strip tags, keep text
- `<a href="...">text</a>` → keep text only
- All other HTML tags → strip, keep text

Use Bash:
```bash
echo "$HTML_CONTENT" | sed 's/<at[^>]*>/@ /g' | sed 's/<\/at>//g' | sed 's/<[^>]*>//g' | sed 's/&amp;/\&/g' | sed 's/&lt;/</g' | sed 's/&gt;/>/g' | sed 's/&nbsp;/ /g'
```

---

## APPENDIX C — REMOVED

(Previously documented connector-mode tool mapping. Pickle no longer supports third-party Teams connectors — all Graph access goes through the user's own token at `~/.claude/pickle/teams-config.json`.)
