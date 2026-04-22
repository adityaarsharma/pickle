#!/usr/bin/env node
/**
 * @pickle/slack-mcp  v1.0.0
 *
 * Free, open-source Slack MCP server — part of the Pickle project.
 * Pure Node.js ESM · no build step · no TypeScript compilation.
 *
 * License: MIT
 * Repo:    https://github.com/adityaarsharma/pickle
 *
 * Covers the Slack API surfaces Pickle needs:
 *   Auth · Lists (create, add items) · Reminders · Messages
 *
 * Zero telemetry. No phone-home. Only talks to https://slack.com/api.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

const XOXP_TOKEN     = process.env.SLACK_MCP_XOXP_TOKEN || process.env.SLACK_TOKEN;
const API_BASE       = "https://slack.com/api";
const USER_AGENT     = "pickle-slack-mcp/1.0 (+https://github.com/adityaarsharma/pickle)";
const TIMEOUT_MS     = 20_000;

if (!XOXP_TOKEN) {
  process.stderr.write("[pickle-slack-mcp] ERROR: SLACK_MCP_XOXP_TOKEN not set.\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Slack Web API helper
// ---------------------------------------------------------------------------

async function slackCall(method, params = {}) {
  const url  = `${API_BASE}/${method}`;
  const body = JSON.stringify(params);

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method:  "POST",
      signal:  ctrl.signal,
      headers: {
        "Authorization": `Bearer ${XOXP_TOKEN}`,
        "Content-Type":  "application/json; charset=utf-8",
        "User-Agent":    USER_AGENT,
      },
      body,
    });
  } finally {
    clearTimeout(tid);
  }

  const json = await res.json();
  if (!json.ok) {
    throw new McpError(ErrorCode.InternalError, `Slack ${method} error: ${json.error}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "slack_auth_test",
    description: "Test the Slack token and return the authenticated user ID, name, and workspace.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "slack_list_create",
    description: "Create a new private Slack List named 'Pickle Inbox' for task tracking. Returns the list ID.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "List name, e.g. 'Pickle Inbox'" },
      },
      required: ["name"],
    },
  },
  {
    name: "slack_list_find_or_create",
    description: "Find an existing Slack List by name, or create it if it doesn't exist. Returns list_id.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "List name to find or create" },
      },
      required: ["name"],
    },
  },
  {
    name: "slack_list_item_add",
    description: "Add a prioritised task item to a Slack List. Pass all task fields.",
    inputSchema: {
      type: "object",
      properties: {
        list_id:     { type: "string", description: "The Slack List ID" },
        title:       { type: "string", description: "Short action title (max 80 chars)" },
        item_type:   { type: "string", enum: ["Inbox", "Follow-up"], description: "Inbox or Follow-up" },
        priority:    { type: "string", enum: ["🔴 Urgent", "🟠 High", "🟡 Normal", "⚪ Low"] },
        from_to:     { type: "string", description: "Sender name (Inbox) or recipient name (Follow-up)" },
        channel:     { type: "string", description: "Channel or DM name, e.g. #growth" },
        source_link: { type: "string", description: "Direct permalink to the original Slack message — 1-click jump back" },
        due:         { type: "string", description: "Due date string, e.g. 'Today', 'Tomorrow', '2026-04-23'" },
        status:      { type: "string", enum: ["Open", "Waiting", "Done"], default: "Open" },
        quote:       { type: "string", description: "Exact 1–3 sentence quote from source message" },
      },
      required: ["list_id", "title", "item_type", "priority", "source_link"],
    },
  },
  {
    name: "slack_reminder_add",
    description: "Set a Slack reminder for yourself at a given time. Returns reminder ID.",
    inputSchema: {
      type: "object",
      properties: {
        text:    { type: "string", description: "Reminder text, e.g. '🥒 Pickle: Review Figma Draft 2 — [link]'" },
        time:    { type: "string", description: "When to remind — Unix timestamp (string) or natural language like 'in 2 hours', 'tomorrow at 9am'" },
        user_id: { type: "string", description: "Slack user ID to remind (use MY_USER_ID for self-reminders)" },
      },
      required: ["text", "time"],
    },
  },
  {
    name: "slack_post_self_dm",
    description: "Post a formatted message to the authenticated user's own DM channel (self-DM). Used as fallback when Lists API is unavailable.",
    inputSchema: {
      type: "object",
      properties: {
        text:         { type: "string", description: "Message text (supports Slack mrkdwn)" },
        blocks:       { type: "array",  description: "Optional Slack Block Kit blocks for rich formatting" },
      },
      required: ["text"],
    },
  },
  {
    name: "slack_open_dm",
    description: "Open or find a DM channel with a user. Returns the channel ID.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "Slack user ID to open DM with" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "slack_post_message",
    description: "Post a message to any channel or DM. Use for follow-up DMs to teammates (always confirm with user first).",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        text:       { type: "string" },
        blocks:     { type: "array" },
      },
      required: ["channel_id", "text"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleTool(name, args) {
  switch (name) {

    case "slack_auth_test": {
      const data = await slackCall("auth.test", {});
      return { user_id: data.user_id, user: data.user, team: data.team, team_id: data.team_id };
    }

    case "slack_list_create": {
      // Slack Lists API — POST lists.create
      // Columns: Title(text), Type(select), Priority(select), From/To(text),
      //          Channel(text), Source Link(link), Due(date), Status(select), Quote(text)
      const data = await slackCall("lists.create", {
        name: args.name,
        schema: {
          columns: [
            { name: "Title",       type: "text" },
            { name: "Type",        type: "select",  options: [{ value: "Inbox" }, { value: "Follow-up" }] },
            { name: "Priority",    type: "select",  options: [
              { value: "🔴 Urgent" }, { value: "🟠 High" },
              { value: "🟡 Normal" }, { value: "⚪ Low" }
            ]},
            { name: "From/To",     type: "text" },
            { name: "Channel",     type: "text" },
            { name: "Source Link", type: "link" },
            { name: "Due",         type: "date" },
            { name: "Status",      type: "select",  options: [
              { value: "Open" }, { value: "Waiting" }, { value: "Done" }
            ]},
            { name: "Quote",       type: "text" },
          ],
        },
      });
      return { list_id: data.list?.id || data.id, name: args.name };
    }

    case "slack_list_find_or_create": {
      // Try to find existing list first
      try {
        const lists = await slackCall("lists.list", {});
        const existing = (lists.lists || []).find(l => l.name === args.name);
        if (existing) return { list_id: existing.id, name: existing.name, existed: true };
      } catch (_) { /* Lists API might 404 on some plans — fall through to create */ }

      // Create fresh
      try {
        const created = await handleTool("slack_list_create", { name: args.name });
        return { ...created, existed: false };
      } catch (e) {
        // Lists unavailable on this plan/token — signal fallback
        return { list_id: null, error: e.message, fallback: "self_dm" };
      }
    }

    case "slack_list_item_add": {
      if (!args.list_id) throw new McpError(ErrorCode.InvalidParams, "list_id required");
      const data = await slackCall("lists.items.create", {
        list_id: args.list_id,
        values: {
          "Title":       { text: { value: args.title } },
          "Type":        { select: { value: args.item_type || "Inbox" } },
          "Priority":    { select: { value: args.priority } },
          "From/To":     { text:   { value: args.from_to   || "" } },
          "Channel":     { text:   { value: args.channel   || "" } },
          "Source Link": { link:   { url: args.source_link, label: "→ Jump to message" } },
          "Due":         { date:   { value: args.due       || "" } },
          "Status":      { select: { value: args.status    || "Open" } },
          "Quote":       { text:   { value: (args.quote    || "").slice(0, 500) } },
        },
      });
      return { item_id: data.item?.id || data.id, list_id: args.list_id };
    }

    case "slack_reminder_add": {
      const params = { text: args.text, time: args.time };
      if (args.user_id) params.user = args.user_id;
      const data = await slackCall("reminders.add", params);
      return { reminder_id: data.reminder?.id, text: args.text };
    }

    case "slack_post_self_dm": {
      // Open DM with self first
      const auth = await slackCall("auth.test", {});
      const dm   = await slackCall("conversations.open", { users: auth.user_id });
      const channel_id = dm.channel.id;

      const payload = { channel: channel_id, text: args.text };
      if (args.blocks) payload.blocks = args.blocks;

      const msg = await slackCall("chat.postMessage", payload);
      return { ts: msg.ts, channel_id };
    }

    case "slack_open_dm": {
      const data = await slackCall("conversations.open", { users: args.user_id });
      return { channel_id: data.channel.id };
    }

    case "slack_post_message": {
      const payload = { channel: args.channel_id, text: args.text };
      if (args.blocks) payload.blocks = args.blocks;
      const data = await slackCall("chat.postMessage", payload);
      return { ts: data.ts, channel_id: args.channel_id };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "pickle-slack-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const result = await handleTool(name, args ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, err.message);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[pickle-slack-mcp] Ready.\n");
