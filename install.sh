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
command -v node >/dev/null 2>&1 || { warn "Node.js not found. Install Node 18+ from https://nodejs.org, then re-run."; exit 1; }
command -v npx  >/dev/null 2>&1 || { warn "npx not found (comes with Node.js/npm)."; exit 1; }
command -v python3 >/dev/null 2>&1 || { warn "python3 not found. Needed to write your config safely."; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { warn "Node 18+ required (you have $(node -v))."; exit 1; }
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

# Collect tokens silently (never echoed, never in shell history).
declare -A ENVJSON
for c in $CHOICES; do
  case "$c" in
    1) printf "Paste your ClickUp API token (pk_… from ClickUp → Settings → Apps): "
       read -rs T </dev/tty; echo; ENVJSON[CLICKUP_API_KEY]="$T"; unset T; ok "ClickUp token captured" ;;
    2) printf "Paste your Slack user token (xoxp-…, create a Slack app, add history+read scopes): "
       read -rs T </dev/tty; echo; ENVJSON[SLACK_TOKEN]="$T"; unset T; ok "Slack token captured" ;;
    3) printf "Paste your Microsoft Graph token (Bearer-ready, from Azure AD app or Graph Explorer): "
       read -rs T </dev/tty; echo; ENVJSON[TEAMS_TOKEN]="$T"; unset T; ok "Teams token captured" ;;
    *) warn "Ignoring unknown option '$c'." ;;
  esac
done
[ "${#ENVJSON[@]}" -gt 0 ] || { warn "No tokens captured. Exiting."; exit 1; }

# ── 3. Where is your MCP config? ─────────────────────────────────────────
DEFAULT_CFG="$HOME/.claude.json"   # Claude Code / Claude Desktop
say ""
say "MCP config file to update [$DEFAULT_CFG]"
say "   (Cursor: .cursor/mcp.json · Codex/Cline/Zed: their MCP config. Paste that path, or press Enter for the default)"
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
