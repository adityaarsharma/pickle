# Security & Privacy

> Part of [Pickle](https://github.com/adityaarsharma/pickle) · Built by [Aditya Sharma](https://github.com/adityaarsharma)

Pickle reads your ClickUp, Slack, and Microsoft Teams messages. That's sensitive. Here's exactly what happens — and what doesn't. This page is deliberately precise about what is *guaranteed by the code* versus what is *good default behaviour*, because the difference matters.

---

## TL;DR

- **Fully local.** Pickle is an MCP server that runs on your machine, launched by your own MCP host (Claude Code, Claude Desktop, Cursor, Codex, Cline, Zed, …).
- **No Pickle server.** There is no backend, no SaaS, no account. No one but you and the platform APIs receives your data.
- **No telemetry.** No analytics, no usage tracking, no "anonymous metrics", no phone-home.
- **Your token stays in your local MCP config.** In the `env` block (`CLICKUP_API_KEY` / `SLACK_TOKEN` / `TEAMS_TOKEN`). It is sent only to the platform it belongs to — ClickUp, Slack, or Microsoft Graph.
- **Ecosystems are never mixed.** ClickUp, Slack, and Teams are separate tool families with separate state. Data does not cross between them.
- **The audit is read-only by design.** The scan only reads. Write/delete tools exist and run *only when you explicitly ask*. If you want that guaranteed at the server layer, set `PICKLE_READONLY=1` (see [Read-only enforcement](#read-only-enforcement)).

---

## The data flow

```
  Your ClickUp / Slack / Teams
          │
          ▼
  Pickle MCP server (runs on YOUR machine over stdio, launched by your MCP host)
          │  reads with YOUR token, held in your local MCP config's env block
          ▼
  Your MCP host / AI client (your app, your model account)
          │  the reasoning runs in YOUR model — Pickle only fetches + structures
          ▼
  A ranked report of what slipped through — shown to you
```

Nothing hits any Pickle-owned infrastructure — **there isn't any**. Pickle talks only to the platform APIs (`api.clickup.com`, `slack.com`, `graph.microsoft.com`), and only to those, using your own token. (This is enforced in code by an outbound host allow-list; see [`server-remote/server.mjs`](../server-remote/server.mjs).)

---

## What leaves your machine

Two things, both of which you already do without Pickle:

1. **Platform API calls** — Pickle calls ClickUp / Slack / Microsoft Graph directly, with your token, to read the data it audits. That's the job.
2. **Whatever your MCP host normally sends to its model provider** — the prompts and tool results your AI client needs to reason. That's governed by *your host's* privacy policy (e.g. Anthropic's, OpenAI's), not Pickle's.

Pickle itself sends **nothing** to any Pickle-owned endpoint, because none exists.

---

## What stays on your machine

| Thing | Stored at | Contents |
|-------|-----------|----------|
| ClickUp API token | Your MCP config `env` (e.g. `~/.claude.json`) | `pk_xxxxxxxxxxxx` |
| Slack token | Your MCP config `env` | `xoxp-…` |
| Teams / Graph token | Your MCP config `env` | Graph access token |

Pickle's MCP server keeps no database and writes no persistent log of your content. If you also use the optional `pickle-clickup` / `pickle-slack` / `pickle-teams` skills, they keep a tiny per-skill state file (`~/.claude/skills/pickle-*/state.json`) holding **only IDs and timestamps** — no message text, no names, no channel names, no content of any kind. Delete it any time to reset; nothing breaks.

---

## Tokens — how to rotate / revoke

**ClickUp**
1. ClickUp → Avatar → Settings → Apps → API Token → **Regenerate**
2. The old token stops working immediately. Paste the new one into your MCP config `env` and restart your MCP host.

**Slack**
- **User token (`xoxp-…`)** — Slack → your Pickle app → OAuth & Permissions → **Reinstall** to rotate, or revoke the token there.

**Microsoft Teams / Graph**
- Graph Explorer tokens are short-lived and expire on their own. For an Azure AD app, rotate/revoke in the app registration.

**Always keep tokens out of screenshots, commits, and shared documents.** Pickle never prints your token back at you.

---

## Team sharing

**Problem:** If your whole team shares one AI-client account, a shared connector would let everyone see everyone's inbox. That defeats the point.

**Fix:** Each teammate runs Pickle on their own machine with their own token in their own local MCP config. Full isolation — no shared state, no overlap:

```
  Teammate A              Teammate B              Teammate C
  their own tokens        their own tokens        their own tokens
       │                        │                        │
       ▼                        ▼                        ▼
  Their workspace          Their workspace          Their workspace
```

---

## What the audit reads vs. what the server can also do

Be precise here, because an earlier version of this page overstated the guarantees.

**During a normal audit, Pickle only reads.** The scan tools fetch tasks, comments, chat messages, channel/DM history, and reminders — they do not modify anything. That is the product's whole design: tell you what slipped through, don't touch it.

**However, the MCP server also exposes write and delete tools** — because "remind me about XYZ-184", "add a comment", or "create a task from this" are legitimate things you may ask for. These include, on ClickUp: `clickup_create_task`, `clickup_update_task`, `clickup_delete_task`, `clickup_create_task_comment`, `clickup_delete_comment`, `clickup_send_chat_message`, `clickup_delete_chat_message`, `clickup_react_to_chat_message`, `clickup_create_reminder`, and similar.

These tools run **only when something explicitly invokes them.** In normal use that means *you asked*. But be honest with yourself about the trust model:

- The read-only-ness of an audit is a matter of *which tools get called*, not a wall the server puts up by default.
- Any MCP host — including ones that don't load Pickle's skills, and including a mis-prompted model — can in principle call a write/delete tool if it decides to. There is no prompt-level "never" that a model in an arbitrary host is forced to obey.
- So do not treat prompt guidance as a hard guarantee. If you need one, use the flag below.

### <a id="read-only-enforcement"></a>Read-only enforcement (`PICKLE_READONLY=1`)

For the cautious — or anyone connecting a full-scope `pk_` token — set `PICKLE_READONLY=1` in the same `env` block as your token:

```json
{
  "mcpServers": {
    "pickle": {
      "command": "npx",
      "args": ["-y", "pickle-mcp"],
      "env": {
        "CLICKUP_API_KEY": "pk_your_own_token",
        "PICKLE_READONLY": "1"
      }
    }
  }
}
```

With it set, **every mutating tool is hard-blocked at the server**, regardless of what any model or host asks. Create/update/delete/send/react calls are refused before any API request is made; only read/audit tools run. This is a code-level guarantee, not a prompt.

Leave it unset if you want to be able to say "remind me about this" and have Pickle act on it.

---

## Minimise the blast radius: scope your token

The strongest safety control is the token you hand Pickle. Prefer the narrowest access that still lets the audit work:

- Give Pickle a token for an account/workspace whose scope you're comfortable with.
- Slack user-token scopes only need read: `channels:history`, `groups:history`, `im:history`, `mpim:history`, `users:read`, `search:read`.
- Combine a narrow token with `PICKLE_READONLY=1` for defence in depth.

---

## Open source — verify, don't trust

Pickle's source is in this repo. The claims on this page are meant to be checkable against the code, not taken on faith:

- **No phone-home / outbound allow-list** — see the host allow-list in [`server-remote/server.mjs`](../server-remote/server.mjs); Pickle refuses to call any host other than ClickUp, Slack, and Graph.
- **Token never logged or echoed** — grep the source; tokens are used only in `Authorization` headers to the platform.
- **`PICKLE_READONLY` behaviour** — read where the mutating tools check the flag before executing.

If Pickle ever does something this page doesn't describe, that's a bug — please open an issue. Questions: **hello@adityaarsharma.com**.

---

*Back to [main README](../README.md)*
