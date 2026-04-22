# ClickUp MCP Setup Guide

> Part of [make-my-clickup](https://github.com/adityaarsharma/make-my-clickup) by Aditya Sharma

This skill runs entirely inside Claude Code using the ClickUp MCP connector. No API keys. No manual token setup. Just connect once and it works.

---

## What is MCP?

MCP (Model Context Protocol) is how Claude Code connects to external services. When you connect ClickUp via MCP, Claude can read your channels, tasks, and DMs — and create tasks — on your behalf.

---

## Setup Steps

### Step 1 — Open Claude AI Settings

Go to: **[claude.ai/settings/connectors](https://claude.ai/settings/connectors)**

You must be signed in to your Claude account (the same one you use with Claude Code).

### Step 2 — Add ClickUp Connector

1. Click **"Add connector"** or **"Browse connectors"**
2. Search for **ClickUp**
3. Click **Connect**

### Step 3 — Authorise in ClickUp

You'll be redirected to ClickUp's OAuth page:
1. Log in to your ClickUp account (if not already)
2. Select which workspace to grant access to
3. Click **Authorise**

You'll be redirected back to Claude. The connector status should show **Connected**.

### Step 4 — Verify in Claude Code

Open Claude Code and run:
```
What spaces do I have in ClickUp?
```

If Claude lists your spaces and folders, the connector is working correctly.

---

## For Teams

Each team member needs to:
1. Connect their **own** ClickUp account to their Claude account
2. Install the skill on their own machine

The skill runs as the authenticated user — tasks are created in their workspace, filtered to their mentions and commitments. Two people can use the same skill without interfering.

---

## Troubleshooting

**"ClickUp MCP not connected" error in the skill**
→ The connector isn't set up yet. Follow steps above.

**Connector shows "Connected" but skill can't see channels**
→ Re-authorise the connector: go to connectors settings → disconnect ClickUp → reconnect.

**Only seeing some workspaces**
→ During OAuth, make sure you select the correct workspace. If you have multiple workspaces, you may need to connect multiple times or select "All workspaces".

**Changes to ClickUp not reflected**
→ The MCP connector fetches live data each time — there's no cache. If you don't see new channels, they may not be in the workspace you connected.

---

*Back to [main README](../README.md)*
