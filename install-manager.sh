#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
#  🥒  Pickle — Manager Install
#  Installs: pickle-clickup · pickle-slack · pickle-clickup-team-report · pickle-update
#
#  Usage (paste into Claude Code terminal):
#    curl -fsSL https://raw.githubusercontent.com/adityaarsharma/pickle/main/install-manager.sh | bash
# ══════════════════════════════════════════════════════════════
set -e

SKILLS_DIR="$HOME/.claude/skills"
PICKLE_MCP_DIR="$HOME/.claude/pickle-mcp"
REPO_URL="https://github.com/adityaarsharma/pickle.git"

echo ""
echo "════════════════════════════════════════════════════"
echo "  🥒  Pickle — Manager Install"
echo "════════════════════════════════════════════════════"
echo ""
echo "Installing:"
echo "   /pickle-clickup              — your ClickUp inbox scanner"
echo "   /pickle-slack                — your Slack inbox scanner"
echo "   /pickle-clickup-team-report  — team performance reports"
echo "   /pickle-update               — one-command updater"
echo ""
echo "ClickUp and Slack are independent — connect either or both."
echo "Takes about 2–3 minutes."
echo ""

# ── Clone latest ────────────────────────────────────────────────
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "⏳ [1/3] Fetching latest from GitHub ..."

LATEST_TAG=""
LATEST_TAG=$(git ls-remote --tags --sort="-v:refname" "$REPO_URL" 2>/dev/null \
  | grep -oE 'refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$' \
  | head -1 \
  | sed 's|refs/tags/||' || echo "")

if [ -n "$LATEST_TAG" ]; then
  git clone --depth 1 --branch "$LATEST_TAG" --quiet "$REPO_URL" "$TMPDIR" 2>/dev/null \
    || git clone --depth 1 --quiet "$REPO_URL" "$TMPDIR"
else
  LATEST_TAG="main"
  git clone --depth 1 --quiet "$REPO_URL" "$TMPDIR"
fi
echo "   ✓ Fetched $LATEST_TAG"

# ── Install skills ──────────────────────────────────────────────
echo ""
echo "⏳ [2/3] Installing skill files ..."
mkdir -p "$SKILLS_DIR"

for skill in pickle-clickup pickle-slack pickle-report pickle-update; do
  if [ -d "$TMPDIR/$skill" ]; then
    rm -rf "$SKILLS_DIR/$skill"
    cp -R "$TMPDIR/$skill" "$SKILLS_DIR/$skill"
    # Display the skill's command name from frontmatter
    CMD=$(grep "^name:" "$SKILLS_DIR/$skill/SKILL.md" 2>/dev/null | head -1 | sed 's/name: *//' || echo "$skill")
    echo "   ✓ /$CMD"
  fi
done

# ── Install ClickUp MCP (optional path) ─────────────────────────
echo ""
echo "⏳ [3/3] Setting up ClickUp MCP (personal token path) ..."
if command -v node >/dev/null 2>&1; then
  mkdir -p "$PICKLE_MCP_DIR/clickup"
  if [ -f "$TMPDIR/pickle-mcp/clickup/server.mjs" ]; then
    cp "$TMPDIR/pickle-mcp/clickup/server.mjs" "$PICKLE_MCP_DIR/clickup/server.mjs"
    [ -f "$TMPDIR/pickle-mcp/clickup/package.json" ] && cp "$TMPDIR/pickle-mcp/clickup/package.json" "$PICKLE_MCP_DIR/clickup/package.json"
    (cd "$PICKLE_MCP_DIR/clickup" && npm install --silent 2>/dev/null)
    echo "   ✓ ClickUp MCP server ready (personal token path)"
  fi
  # Copy update.sh
  [ -f "$TMPDIR/update.sh" ] && cp "$TMPDIR/update.sh" "$PICKLE_MCP_DIR/update.sh" && chmod +x "$PICKLE_MCP_DIR/update.sh"
else
  echo "   ℹ Node.js not found — skipping MCP server (use OAuth connector instead)"
  echo "     OAuth path: claude.ai → Settings → Connectors → ClickUp → Connect"
fi

# ── Remove deprecated tools ─────────────────────────────────────
for deprecated in pickle-setup pickle-me; do
  [ -d "$SKILLS_DIR/$deprecated" ] && rm -rf "$SKILLS_DIR/$deprecated" && echo "   ✓ Removed deprecated: $deprecated"
done

# ── Write version ───────────────────────────────────────────────
mkdir -p "$PICKLE_MCP_DIR"
echo "$LATEST_TAG" > "$PICKLE_MCP_DIR/.pickle_version"

# ── Done ────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅  Pickle Manager installed — $LATEST_TAG"
echo "════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo ""
echo "  1. Connect ClickUp (pick ONE):"
echo "     A) OAuth (recommended): claude.ai → Settings → Connectors → ClickUp"
echo "     B) Personal token: already set up above (if Node.js found)"
echo ""
echo "  2. Connect Slack (optional, pick ONE):"
echo "     A) OAuth: claude.ai → Settings → Connectors → Slack"
echo "     B) Personal token: api.slack.com/apps → create app → paste xoxp- token"
echo ""
echo "  3. Fully quit Claude Code (Cmd+Q) and reopen"
echo ""
echo "  4. Run: /pickle-clickup 24h"
echo ""
echo "Your commands:"
echo "   /pickle-clickup                — ClickUp inbox"
echo "   /pickle-slack                  — Slack inbox"
echo "   /pickle-clickup-team-report    — team performance report"
echo "   /pickle-update                 — update Pickle"
echo ""
echo "Docs: https://github.com/adityaarsharma/pickle"
echo ""
