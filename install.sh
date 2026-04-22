#!/usr/bin/env bash
# ============================================================
# make-my-clickup — Mac / Linux Installer
# Built by Aditya Sharma · github.com/adityaarsharma/make-my-clickup
# ============================================================

set -e

SKILL_NAME="make-my-clickup"
REPO="adityaarsharma/make-my-clickup"
INSTALL_DIR="$HOME/.claude/skills/$SKILL_NAME"
BRANCH="main"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  make-my-clickup · by Aditya Sharma${NC}"
echo -e "${BLUE}  Installer for Mac / Linux${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# Check Claude Code is installed
if ! command -v claude &> /dev/null; then
    echo -e "${RED}❌ Claude Code not found.${NC}"
    echo "   Install it first: https://code.claude.com"
    exit 1
fi

echo -e "${GREEN}✓ Claude Code found${NC}"

# Check if already installed
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}⚠  Skill already installed at $INSTALL_DIR${NC}"
    read -p "   Update to latest version? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping update."
        exit 0
    fi
    echo "Updating..."
    rm -rf "$INSTALL_DIR"
fi

# Create skills directory if needed
mkdir -p "$HOME/.claude/skills"

# Download
echo "📥 Downloading skill from GitHub..."

if command -v git &> /dev/null; then
    git clone --depth 1 --branch "$BRANCH" \
        "https://github.com/$REPO.git" \
        "$INSTALL_DIR" 2>/dev/null
else
    # Fallback: curl + unzip
    TMP=$(mktemp -d)
    curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.zip" \
        -o "$TMP/skill.zip"
    unzip -q "$TMP/skill.zip" -d "$TMP"
    mv "$TMP/$SKILL_NAME-$BRANCH" "$INSTALL_DIR"
    rm -rf "$TMP"
fi

echo -e "${GREEN}✓ Skill installed to: $INSTALL_DIR${NC}"
echo ""

# Verify SKILL.md exists
if [ ! -f "$INSTALL_DIR/SKILL.md" ]; then
    echo -e "${RED}❌ SKILL.md not found. Installation may be corrupt.${NC}"
    exit 1
fi

echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Installation complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "Next steps:"
echo ""
echo "  1️⃣  Connect ClickUp MCP (if not already):"
echo "      → https://claude.ai/settings/connectors"
echo "      → Add ClickUp connector"
echo ""
echo "  2️⃣  Open Claude Code and run:"
echo "      /make-my-clickup"
echo ""
echo "  3️⃣  With custom time window:"
echo "      /make-my-clickup 7d"
echo ""
echo "  4️⃣  With auto follow-up:"
echo "      /make-my-clickup 24h followup"
echo ""
echo "  📖 Full guide: https://github.com/$REPO#readme"
echo ""
