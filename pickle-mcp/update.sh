#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
#  🥒  Pickle Updater
#  Usage:  bash ~/.claude/pickle-mcp/update.sh
#
#  Auto-detects what you have installed (ClickUp, Slack, or both)
#  and only updates those — never installs stuff you didn't pick.
# ══════════════════════════════════════════════════════════════
set -e

PICKLE_MCP_DIR="$HOME/.claude/pickle-mcp"
SKILLS_DIR="$HOME/.claude/skills"
REPO_URL="https://github.com/adityaarsharma/pickle.git"

# ── Detect what's installed ─────────────────────────────────────
HAS_CLICKUP_SKILL=0
HAS_SLACK_SKILL=0
HAS_SETUP_SKILL=0
HAS_UPDATE_SKILL=0
HAS_CLICKUP_MCP=0

[ -f "$SKILLS_DIR/pickle-clickup/SKILL.md" ] && HAS_CLICKUP_SKILL=1
[ -f "$SKILLS_DIR/pickle-slack/SKILL.md" ]   && HAS_SLACK_SKILL=1
[ -f "$SKILLS_DIR/pickle-setup/SKILL.md" ]   && HAS_SETUP_SKILL=1
[ -f "$SKILLS_DIR/pickle-update/SKILL.md" ]  && HAS_UPDATE_SKILL=1
[ -f "$PICKLE_MCP_DIR/clickup/server.mjs" ]  && HAS_CLICKUP_MCP=1

if [ "$HAS_CLICKUP_SKILL" -eq 0 ] && [ "$HAS_SLACK_SKILL" -eq 0 ] && [ "$HAS_SETUP_SKILL" -eq 0 ] && [ "$HAS_UPDATE_SKILL" -eq 0 ]; then
  echo ""
  echo "❌ Pickle isn't installed. Run this first:"
  echo "   /pickle-setup"
  echo ""
  exit 1
fi

# ── Announce the plan ────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "  🥒  Pickle Updater — checking what you have"
echo "════════════════════════════════════════════════════"
echo ""
echo "Detected on this machine:"
[ "$HAS_CLICKUP_SKILL" -eq 1 ] && echo "   ✓ pickle-clickup (ClickUp inbox scanner)"
[ "$HAS_SLACK_SKILL"   -eq 1 ] && echo "   ✓ pickle-slack (Slack inbox scanner)"
[ "$HAS_UPDATE_SKILL"  -eq 1 ] && echo "   ✓ pickle-update (one-command updater)"
[ "$HAS_CLICKUP_MCP"   -eq 1 ] && echo "   ✓ pickle-mcp/clickup (free MCP server)"
[ "$HAS_SETUP_SKILL"   -eq 1 ] && echo "   ✓ pickle-setup (onboarding wizard)"
echo ""
echo "Will update ONLY those. Nothing else gets installed."
echo ""

# ── Long ETA note so the user doesn't stare at a blank screen ──
echo "⏱  This takes ~45–90 seconds total:"
echo "    · ~15s  cloning latest from GitHub"
if [ "$HAS_CLICKUP_MCP" -eq 1 ]; then
  echo "    · ~30s  npm install for the ClickUp MCP (if deps changed)"
fi
echo "    · ~5s   copying updated skill files"
echo "    · ~5s   final safety checks"
echo ""
echo "While we wait, a few things worth knowing about Pickle:"
echo ""
echo "   🥒 Pickle scans every corner — channels, DMs, group DMs,"
echo "      task comments, threaded comments, task descriptions,"
echo "      reminders, and Docs you're mentioned in. No corner missed."
echo ""
echo "   🥒 In DMs and group DMs, @mention is NOT required."
echo "      Every pending question/decision in a DM that includes"
echo "      you is caught — because you're implicitly the audience."
echo ""
echo "   🥒 Multilingual — Hindi, Gujarati, English, and any mix."
echo "      'aap bolo toh karunga', 'yeh karo', 'tame shu vicharcho'"
echo "      all recognized as pending tasks just like English."
echo ""
echo "   🥒 Scan window is honest — ask for 24h, Pickle looks at"
echo "      the last 24 hours of activity. No surprise behavior."
echo ""
echo "   🥒 Your data never leaves your machine. Pickle has no"
echo "      server. No phone-home. No telemetry. Only the ClickUp/"
echo "      Slack APIs are called — directly, from here."
echo ""

# ── Fetch latest ─────────────────────────────────────────────────
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "⏳ [1/4] Cloning latest from github.com/adityaarsharma/pickle ..."
if ! git clone --depth 1 --quiet "$REPO_URL" "$TMPDIR" 2>/dev/null; then
  echo ""
  echo "❌ Could not reach GitHub. Check your internet, then retry."
  exit 1
fi
echo "   ✓ Fetched."

# ── Update ClickUp MCP server (if installed) ─────────────────────
if [ "$HAS_CLICKUP_MCP" -eq 1 ]; then
  if [ -f "$TMPDIR/pickle-mcp/clickup/server.mjs" ]; then
    OLD_VER=$(grep -m1 "@pickle/clickup-mcp" "$PICKLE_MCP_DIR/clickup/server.mjs" 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
    cp "$TMPDIR/pickle-mcp/clickup/server.mjs" "$PICKLE_MCP_DIR/clickup/server.mjs"
    # Update package.json too (for deps)
    [ -f "$TMPDIR/pickle-mcp/clickup/package.json" ] && cp "$TMPDIR/pickle-mcp/clickup/package.json" "$PICKLE_MCP_DIR/clickup/package.json"
    NEW_VER=$(grep -m1 "@pickle/clickup-mcp" "$PICKLE_MCP_DIR/clickup/server.mjs" 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")

    echo ""
    echo "⏳ [2/4] Installing MCP deps (if changed, ~30s) ..."
    (cd "$PICKLE_MCP_DIR/clickup" && npm install --silent 2>/dev/null)
    echo "   ✓ ClickUp MCP server: $OLD_VER → $NEW_VER"
  fi
else
  echo ""
  echo "⏭  [2/4] Skipping MCP server (not installed — you're on OAuth connector)."
fi

# ── Update skills (only the ones user has) ──────────────────────
echo ""
echo "⏳ [3/4] Updating skill files ..."
for skill in pickle-setup pickle-update pickle-clickup pickle-slack; do
  if [ -d "$SKILLS_DIR/$skill" ] && [ -d "$TMPDIR/$skill" ]; then
    cp -R "$TMPDIR/$skill/." "$SKILLS_DIR/$skill/"
    echo "   ✓ $skill"
  elif [ -d "$SKILLS_DIR/$skill" ]; then
    echo "   ⚠ $skill: no updates available in remote repo"
  fi
done

# ── Copy the updater itself ─────────────────────────────────────
if [ -f "$TMPDIR/pickle-mcp/update.sh" ]; then
  cp "$TMPDIR/pickle-mcp/update.sh" "$PICKLE_MCP_DIR/update.sh"
  chmod +x "$PICKLE_MCP_DIR/update.sh"
fi

# ── Final sanity check ──────────────────────────────────────────
echo ""
echo "⏳ [4/4] Verifying install ..."
[ "$HAS_CLICKUP_SKILL" -eq 1 ] && [ ! -f "$SKILLS_DIR/pickle-clickup/SKILL.md" ] && echo "   ✗ pickle-clickup SKILL.md missing — reinstall needed"
[ "$HAS_SLACK_SKILL"   -eq 1 ] && [ ! -f "$SKILLS_DIR/pickle-slack/SKILL.md" ]   && echo "   ✗ pickle-slack SKILL.md missing — reinstall needed"
[ "$HAS_CLICKUP_MCP"   -eq 1 ] && [ ! -f "$PICKLE_MCP_DIR/clickup/server.mjs" ]  && echo "   ✗ ClickUp MCP server.mjs missing — reinstall needed"
echo "   ✓ All files in place."

# ── Done ────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅  Pickle updated successfully"
echo "════════════════════════════════════════════════════"
echo ""
echo "One last step to load the changes:"
echo ""
echo "   1. Fully quit Claude Code (Cmd+Q on Mac — not just close window)"
echo "   2. Reopen it"
echo "   3. Type /pic  — the updated skills appear in autocomplete"
echo ""
echo "(Skill text changes apply immediately. MCP server changes — only"
echo " the ClickUp one — need the quit+reopen to re-register tools.)"
echo ""
