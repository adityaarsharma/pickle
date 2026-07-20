# Claude Code skills (optional)

The MCP server is the whole product — it works in any MCP client by calling its tools directly. If you use **Claude Code** or **Claude Desktop**, these optional skills add `/pickle-*` slash commands as a convenience layer on top.

## What they are

| Skill | Slash command | Does |
|---|---|---|
| `pickle-clickup` | `/pickle-clickup` | Runs a ClickUp audit and formats the findings |
| `pickle-slack` | `/pickle-slack` | Runs a Slack audit (needs a Slack token) |
| `pickle-teams` | `/pickle-teams` | Runs a Teams audit (needs a Teams token) |

Each skill is one folder in this repo containing a `SKILL.md`. They're just prompt + output formatting — everything they do is also available by asking the MCP directly (*"Pickle, audit my ClickUp"*).

## Install

Copy the skill folders into your Claude skills directory:

```bash
cp -r pickle-clickup pickle-slack pickle-teams ~/.claude/skills/
```

Restart Claude Code. The `/pickle-*` commands appear once the `pickle` MCP server (from the [main install](../README.md#install)) is connected.

## Not using Claude?

Skip this entirely. In Cursor, Codex, Cline, Continue, Zed, or any MCP host, just talk to the MCP:

> *"Pickle, audit my ClickUp from the last 7 days."*

The skills are Claude-specific sugar, not the product.
