# CLAUDE.md — Pickle contributor rules

> Rules for any agent (Claude or otherwise) editing this repo. Read before changing anything.

## 1. Pickle is ONE product, and it is FREE + LOCAL

Pickle is a single free, open-source (MIT) tool built by Aditya Sharma. It's an **MCP server you run on your own machine.** There is **no paid tier, no hosted server, no account, no key issuance, no telemetry.**

- ✅ "Free, open source, runs on your machine, no account, no telemetry" — all true, keep it accurate.
- ❌ Never reintroduce a Pro tier, a hosted signup, a `pickle_free_` key, Brevo/email capture, an admin panel, or usage tracking into `server-remote/`. Those were removed on purpose.
- ❌ Never write "free forever" (say "free · no paid tier") or "your data never leaves your machine" (false — Pickle reads ClickUp/Slack/Teams; say "no middleman — only your tools, with your token").

## 2. Privacy claims must be literally true

The honest, verifiable claim: Pickle runs locally and talks **only** to the platform APIs (ClickUp / Slack / Microsoft Graph) using the user's **own** token, which lives in their local MCP config. Nothing is sent to any Pickle server — there is no Pickle server.

- ✅ Allowed: "no account", "no telemetry", "no phone-home", "no middleman", "your token stays in your local config", "read the code to verify".
- ❌ Banned: "your data never leaves your machine" (it goes to the tools you audit — that's the job).

If you add a network call to anything other than the user's own platform APIs, that's a bug — remove it.

## 3. The only token is the user's OWN platform token

Pickle issues nothing. The user supplies their own `CLICKUP_API_KEY` (`pk_…`), `SLACK_TOKEN` (`xoxp-…`), or `TEAMS_TOKEN` (Graph). These live in the local MCP config `env` block and are used to call the platform on the user's behalf. Never persist, log, or echo them.

## 4. Token handling in shell (installer + skills)

1. Never echo a token. Read with `read -rs`. Pass to helpers via env, never argv (keeps it out of the process list + shell history).
2. Atomic writes for any file containing a token: tempfile + fsync + `os.replace`, then `chmod 600`. Never truncate-in-place — a crash would wipe the user's other MCP servers.
3. Build JSON with `python3`/`jq`, never string-interpolate a name/title/token into `-d "{...}"` (a display name can contain `"`, `$`, backticks — that's RCE).

## 5. No hardcoded personal / company / infra identifiers

Banned in committed files: real names in detection patterns, any real company/product/employer names, server IPs, internal channel names, private hostnames. Use generic examples (`marketing-hq`, `acme-corp`). "Built by Aditya Sharma" credit lines are fine and wanted.

## 6. Skill name = directory name = slash command

`pickle-clickup` / `pickle-slack` / `pickle-teams` — three skills, one per platform. Directory name === frontmatter `name` === slash command. Rename one, rename all three plus every reference.

## 7. Pickle is LLM-agnostic

The MCP server is the product; it runs in any MCP host. Public copy (README, package.json, topics) must never make it sound Claude-only. Topics should include `mcp`, `mcp-server`, `model-context-protocol`, plus non-Claude hosts (`cursor`, `codex`, `cline`, `zed`). The `SKILL.md` files may mention Claude Code — that's their runtime.

## 8. Test before you push

```bash
node --check server-remote/server.mjs
# boot smoke test:
PORT=8788 CLICKUP_API_KEY=pk_dummy node server-remote/server.mjs &
sleep 2; curl -fs http://127.0.0.1:8788/health && echo OK; kill %1
# no secrets / no reintroduced hosted cruft:
grep -rEn "pickle_free_|BREVO|ADMIN_PASSWORD|/api/signup|sendZepto|Pro tier|free forever" . \
  --include=*.mjs --include=*.md --include=*.json | grep -v node_modules
# (should return nothing)
```

## 9. When in doubt

The product is a free, local, no-account, no-telemetry tool that helps a team catch what falls through the cracks. If a change would make that untrue — or make a claim you can't verify in the code — stop.
