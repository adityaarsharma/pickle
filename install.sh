#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
# Pickle: one-line guided installer
#
# Free · open source · runs on YOUR machine via npx. No account, no Pickle
# key, no telemetry. The only token you provide is your OWN platform token,
# written to your local MCP config and never sent anywhere.
#
#   curl -fsSL https://pickle.adityaarsharma.com/install.sh | bash
#
# It asks which tools you use, points you to where each token lives, and
# writes an `npx pickle-mcp` MCP config for your client. Nothing to clone.
# ════════════════════════════════════════════════════════════════════════
set -euo pipefail

# Read interactive input from the terminal, not stdin, so `curl … | bash`
# (where stdin is the piped script) still prompts you correctly.
if [ ! -t 0 ] && [ ! -r /dev/tty ]; then
  printf '  ! No terminal available for prompts. Run in an interactive shell.\n' >&2
  exit 1
fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

say ""
say "🥒 Pickle: guided install"
say "   Free, open source, on your machine via npx. No account, no key, no telemetry."
say ""

# ── 1. Prerequisites (npx ships with npm/Node; python3 writes the config) ─
command -v node >/dev/null 2>&1 || { warn "Node.js not found. Install Node 20+ from https://nodejs.org, then re-run."; exit 1; }
command -v npx  >/dev/null 2>&1 || { warn "npx not found (comes with Node.js/npm)."; exit 1; }
command -v python3 >/dev/null 2>&1 || { warn "python3 not found. Needed to write your config safely."; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { warn "Node 20+ required (you have $(node -v))."; exit 1; }
ok "Node $(node -v) · npx ready"

# ── 2. Which tools do you use? ───────────────────────────────────────────
say ""
say "Which tools should Pickle audit? (space-separated numbers, e.g. '1' or '1 2')"
say "   1) ClickUp"
say "   2) Slack"
say "   3) Microsoft Teams"
printf "> "
read -r CHOICES </dev/tty
[ -n "${CHOICES// }" ] || { warn "Nothing selected. Exiting."; exit 1; }

# Collect tokens silently (never echoed, never in shell history). Before each
# prompt, print the concrete steps (or direct URL) to generate that token.
declare -A ENVJSON
for c in $CHOICES; do
  case "$c" in
    1) say ""
       say "ClickUp — how to get your API token:"
       say "   1. Open https://app.clickup.com/settings/apps"
       say "   2. Under 'API Token' click Generate (or Copy if you already have one)"
       say "   3. It starts with 'pk_'. Paste it below."
       printf "Paste your ClickUp API token (pk_…): "
       read -rs T </dev/tty; echo; ENVJSON[CLICKUP_API_KEY]="$T"; unset T; ok "ClickUp token captured" ;;
    2) say ""
       say "Slack — how to get a user token:"
       say "   1. Create an app at https://api.slack.com/apps → 'Create New App' → From scratch"
       say "   2. OAuth & Permissions → add User Token Scopes:"
       say "      channels:history, groups:history, im:history, mpim:history, users:read, search:read"
       say "   3. Install to your workspace, then copy the 'User OAuth Token' (starts with 'xoxp-')"
       printf "Paste your Slack user token (xoxp-…): "
       read -rs T </dev/tty; echo; ENVJSON[SLACK_TOKEN]="$T"; unset T; ok "Slack token captured" ;;
    3) say ""
       say "Microsoft Teams — how to get a Graph token:"
       say "   1. Quick test: https://developer.microsoft.com/graph/graph-explorer → sign in → copy the access token"
       say "   2. Durable: register an Azure AD app (device-code flow) with Chat.Read, ChannelMessage.Read.All, Team.ReadBasic.All"
       say "   3. Paste the Bearer-ready access token below."
       printf "Paste your Microsoft Graph token: "
       read -rs T </dev/tty; echo; ENVJSON[TEAMS_TOKEN]="$T"; unset T; ok "Teams token captured" ;;
    *) warn "Ignoring unknown option '$c'." ;;
  esac
done
[ "${#ENVJSON[@]}" -gt 0 ] || { warn "No tokens captured. Exiting."; exit 1; }

# ── 3. Where is your MCP config? ─────────────────────────────────────────
DEFAULT_CFG="$HOME/.claude.json"   # Claude Code (CLI). NOT Claude Desktop.
say ""
say "MCP config file to update [$DEFAULT_CFG]"
say "   Default is Claude Code (the CLI). Other clients live elsewhere — paste that path instead:"
say "   (Claude Desktop: claude_desktop_config.json in its app-support dir · Cursor: .cursor/mcp.json · Codex/Cline/Zed: their MCP config)"
printf "> "
read -r CFG </dev/tty
CFG="${CFG:-$DEFAULT_CFG}"

# ── 4. Merge safely: never clobber other MCP servers, atomic write, 600 ──
# Tokens are passed to python via env, not argv, so they don't hit the
# process list or shell history.
export PICKLE_CFG_PATH="$CFG"
for k in "${!ENVJSON[@]}"; do export "PICKLE_TOK_$k=${ENVJSON[$k]}"; done
PICKLE_ENV_JSON="$(python3 -c '
import json, os
env = {}
for k in ("CLICKUP_API_KEY", "SLACK_TOKEN", "TEAMS_TOKEN"):
    v = os.environ.get("PICKLE_TOK_" + k)
    if v:
        env[k] = v
print(json.dumps(env))
' )"
export PICKLE_ENV_JSON

python3 <<'PY'
import json, os, tempfile

cfg_path = os.environ["PICKLE_CFG_PATH"]
env      = json.loads(os.environ["PICKLE_ENV_JSON"])

data = {}
if os.path.exists(cfg_path):
    try:
        with open(cfg_path) as f:
            data = json.load(f) or {}
    except Exception:
        raise SystemExit(f"  ! {cfg_path} exists but isn't valid JSON. Fix or move it, then re-run.")

servers = data.setdefault("mcpServers", {})
# npx fetches and runs pickle-mcp from npm, nothing to clone, always latest.
servers["pickle"] = {"command": "npx", "args": ["-y", "pickle-mcp"], "env": env}

d = os.path.dirname(cfg_path) or "."
os.makedirs(d, exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=d, prefix=".pickle-cfg-")
try:
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
        f.flush(); os.fsync(f.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, cfg_path)
finally:
    if os.path.exists(tmp):
        os.remove(tmp)
print("  \033[32m✓\033[0m Wrote 'pickle' MCP server to " + cfg_path + " (existing servers untouched)")
PY

# ── 4b. Optional: verify each token with one live API call ───────────────
# Skippable, never fatal. Tokens stay in env (never argv), never echoed —
# we print only ✓/✗ per platform. Runs before we scrub the token env vars.
say ""
printf "Verify your token(s) now with a quick test call? [Y/n] "
read -r DOVERIFY </dev/tty || DOVERIFY=""
case "${DOVERIFY:-Y}" in
  [Nn]*) say "   Skipped verification." ;;
  *)
    python3 <<'PY' || true
import os, json, urllib.request, urllib.error

GREEN, RED, RESET = "\033[32m", "\033[31m", "\033[0m"
def ok(m):   print(f"  {GREEN}✓{RESET} {m}")
def bad(m):  print(f"  {RED}✗{RESET} {m}")

def call(url, headers, method="GET", data=None):
    req = urllib.request.Request(url, headers=headers, method=method, data=data)
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.getcode(), r.read().decode("utf-8", "replace")

ck = os.environ.get("PICKLE_TOK_CLICKUP_API_KEY")
if ck:
    try:
        code, _ = call("https://api.clickup.com/api/v2/user", {"Authorization": ck})
        ok("ClickUp token works") if code == 200 else bad(f"ClickUp token rejected (HTTP {code})")
    except urllib.error.HTTPError as e:
        bad(f"ClickUp token rejected (HTTP {e.code})")
    except Exception:
        bad("ClickUp check failed (network?) — token not verified")

sk = os.environ.get("PICKLE_TOK_SLACK_TOKEN")
if sk:
    try:
        code, body = call("https://slack.com/api/auth.test",
                          {"Authorization": f"Bearer {sk}"}, method="POST", data=b"")
        good = False
        try: good = json.loads(body).get("ok") is True
        except Exception: good = False
        ok("Slack token works") if good else bad("Slack token rejected (auth.test not ok)")
    except Exception:
        bad("Slack check failed (network?) — token not verified")

tk = os.environ.get("PICKLE_TOK_TEAMS_TOKEN")
if tk:
    try:
        code, _ = call("https://graph.microsoft.com/v1.0/me", {"Authorization": f"Bearer {tk}"})
        ok("Microsoft Graph token works") if code == 200 else bad(f"Graph token rejected (HTTP {code})")
    except urllib.error.HTTPError as e:
        bad(f"Graph token rejected (HTTP {e.code})")
    except Exception:
        bad("Graph check failed (network?) — token not verified")
PY
    ;;
esac

# Scrub tokens from the shell env.
for k in "${!ENVJSON[@]}"; do unset "PICKLE_TOK_$k"; ENVJSON[$k]=""; done
unset PICKLE_ENV_JSON

# ── 5. Done ──────────────────────────────────────────────────────────────
say ""
say "🥒 Done. Restart your AI client, then paste this as your first ask:"
say "     \"Pickle, run my morning audit: scan my ClickUp from the last 7 days"
say "      and show me the 3 worst things I missed, worst first.\""
say ""
say "   Your token lives only in $CFG (chmod 600). Nothing was sent anywhere."
say "   Did Pickle catch something? A ⭐ helps the next person find it:"
say "   https://github.com/adityaarsharma/pickle"
say ""
