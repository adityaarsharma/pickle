#!/usr/bin/env node
/**
 * @pickle/slack-mcp  v1.7.0
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
 *
 * Lists API: uses slackLists.* endpoints (public since Sep 2025)
 *   Docs: https://docs.slack.dev/reference/methods/slackLists.create
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
const USER_AGENT     = "pickle-slack-mcp/1.1 (+https://github.com/adityaarsharma/pickle)";
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
    // Include response_metadata.messages for better debugging
    const detail = json.response_metadata?.messages?.join("; ") || "";
    throw new McpError(
      ErrorCode.InternalError,
      `Slack ${method} error: ${json.error}${detail ? " — " + detail : ""}`
    );
  }
  return json;
}

// ---------------------------------------------------------------------------
// Column key constants — must match ^Col[A-Z0-9]{2,}$ (Slack Lists API requirement)
// ---------------------------------------------------------------------------

const COL = {
  title:       "ColTL",
  item_type:   "ColIT",
  priority:    "ColPR",
  from_to:     "ColFR",
  channel:     "ColCH",
  source_link: "ColSL",
  due:         "ColDU",
  status:      "ColST",
  quote:       "ColQU",
};

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
    description: "Find or create the Pickle Inbox Slack List. IMPORTANT: slackLists.list API does not exist — you MUST read list_id and col_ids from state.json _list_registry first and pass them as cached_list_id / cached_col_ids. If cached values are present, this tool skips all API calls and returns immediately. Only omit cached values on the very first run when no registry entry exists yet.",
    inputSchema: {
      type: "object",
      properties: {
        name:            { type: "string", description: "List name, e.g. 'Pickle Inbox'" },
        cached_list_id:  { type: "string", description: "list_id from state.json _list_registry — pass this to skip creation and avoid duplicates" },
        cached_col_ids:  { type: "object", description: "col_ids from state.json _list_registry — pass this alongside cached_list_id" },
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
        col_ids:     { type: "object", description: "Map of ColXX key → Slack-generated column ID. Get this from slack_list_find_or_create response, or from state.json _list_registry.col_ids. REQUIRED — without this, item creation will fail." },
        quote:       { type: "string", description: "Full context block (ClickUp-style description): Who sent it → what they said (verbatim if possible) → what action is needed from Aditya → any background/history. 2000 char max. Be specific — no vague summaries." },
      },
      required: ["list_id", "col_ids", "title", "item_type", "priority", "source_link"],
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
    description: "Post a formatted message to the authenticated user's own DM channel (self-DM). LAST RESORT ONLY — prefer slack_reminder_add for completion notifications (reminders fire as real push notifications; self-DMs may not trigger a badge). Use this only if reminder API fails.",
    inputSchema: {
      type: "object",
      properties: {
        text:   { type: "string", description: "Message text (supports Slack mrkdwn)" },
        blocks: { type: "array",  description: "Optional Slack Block Kit blocks for rich formatting" },
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
    name: "slack_list_item_delete",
    description: "Delete (permanently remove) a Slack List item by item ID. Use to archive Done items after 24h. Returns deleted: true on success.",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "The Slack List ID" },
        item_id: { type: "string", description: "The item ID to delete (from slack_list_item_add response)" },
      },
      required: ["list_id", "item_id"],
    },
  },
  {
    name: "slack_list_items_list",
    description: "List all items in a Slack List. Useful for checking which items are Done so they can be deleted after 24h.",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "The Slack List ID" },
        limit:   { type: "number", description: "Max items to return (default 50)" },
      },
      required: ["list_id"],
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
      // Uses slackLists.create (public API since Sep 2025)
      // Docs: https://docs.slack.dev/reference/methods/slackLists.create
      // IMPORTANT: Slack generates its own column IDs (e.g. Col0AUKLBKCH4) regardless of
      // the `key` we pass. We must capture them from list_metadata.schema in the response
      // and store them in the returned object so slack_list_item_add can use them.
      const data = await slackCall("slackLists.create", {
        name: args.name,
        schema: [
          { key: COL.title,       name: "Title",       type: "text",   is_primary_column: true },
          { key: COL.item_type,   name: "Type",        type: "select",
            options: { choices: [
              { value: "Inbox",     label: "Inbox",     color: "blue"   },
              { value: "Follow-up", label: "Follow-up", color: "purple" },
            ]} },
          { key: COL.priority,    name: "Priority",    type: "select",
            options: { choices: [
              { value: "🔴 Urgent", label: "🔴 Urgent", color: "red"    },
              { value: "🟠 High",   label: "🟠 High",   color: "orange" },
              { value: "🟡 Normal", label: "🟡 Normal", color: "yellow" },
              { value: "⚪ Low",    label: "⚪ Low",    color: "blue"   },
            ]} },
          { key: COL.from_to,     name: "From/To",     type: "text" },
          { key: COL.channel,     name: "Channel",     type: "text" },
          { key: COL.source_link, name: "Source Link", type: "link" },
          { key: COL.due,         name: "Due",         type: "date" },
          { key: COL.status,      name: "Status",      type: "select",
            options: { choices: [
              { value: "Open",    label: "Open",    color: "blue"  },
              { value: "Waiting", label: "Waiting", color: "yellow"},
              { value: "Done",    label: "Done",    color: "green" },
            ]} },
          { key: COL.quote,       name: "Quote",       type: "text" },
        ],
      });
      const list_id = data.list_id || data.list?.id || data.id;
      // Build key→real_id map from Slack's response
      const colIds = {};
      for (const col of (data.list_metadata?.schema || [])) colIds[col.key] = col.id;
      return { list_id, name: args.name, col_ids: colIds };
    }

    case "slack_list_find_or_create": {
      // slackLists.list does NOT exist as an API endpoint — do not call it.
      // The correct pattern:
      //   1. CALLER reads state.json _list_registry and passes cached_list_id + cached_col_ids
      //   2. If cached values present → return immediately, zero API calls
      //   3. If no cache (first ever run) → create fresh, return list_id + col_ids for caller to cache

      // Fast path: caller passed cached values from state.json
      if (args.cached_list_id) {
        return {
          list_id:  args.cached_list_id,
          col_ids:  args.cached_col_ids || null,
          name:     args.name,
          existed:  true,
          source:   "state.json _list_registry",
        };
      }

      // Slow path: first run, no cache — create the list
      try {
        const created = await handleTool("slack_list_create", { name: args.name });
        // Caller MUST save created.list_id + created.col_ids to state.json _list_registry
        return { ...created, existed: false };
      } catch (e) {
        return { list_id: null, error: e.message, fallback: "self_dm" };
      }
    }

    case "slack_list_item_add": {
      if (!args.list_id) throw new McpError(ErrorCode.InvalidParams, "list_id required");
      if (!args.col_ids) throw new McpError(ErrorCode.InvalidParams, "col_ids required — pass the col_ids returned by slack_list_find_or_create");
      // Docs: https://docs.slack.dev/reference/methods/slackLists.items.create
      // Field format: { column_id: <slack-generated-id>, rich_text|select|link|date: <array-value> }
      const C   = args.col_ids;
      const rt  = (text) => [{ type: "rich_text", elements: [{ type: "rich_text_section", elements: [{ type: "text", text }] }] }];
      const fields = [
        { column_id: C[COL.title],     rich_text: rt(args.title) },
        { column_id: C[COL.item_type], select:    [args.item_type || "Inbox"] },
        { column_id: C[COL.priority],  select:    [args.priority] },
        { column_id: C[COL.status],    select:    [args.status || "Open"] },
      ];
      if (args.from_to)     fields.push({ column_id: C[COL.from_to],     rich_text: rt(args.from_to) });
      if (args.channel)     fields.push({ column_id: C[COL.channel],     rich_text: rt(args.channel) });
      if (args.source_link) fields.push({ column_id: C[COL.source_link], link:      [{ original_url: args.source_link }] });
      if (args.due)         fields.push({ column_id: C[COL.due],         date:      [args.due] });
      if (args.quote)       fields.push({ column_id: C[COL.quote],       rich_text: rt((args.quote).slice(0, 2000)) });

      const data = await slackCall("slackLists.items.create", {
        list_id: args.list_id,
        initial_fields: fields,
      });
      return { item_id: data.item?.id || data.id, list_id: args.list_id };
    }

    case "slack_list_item_delete": {
      if (!args.list_id) throw new McpError(ErrorCode.InvalidParams, "list_id required");
      if (!args.item_id) throw new McpError(ErrorCode.InvalidParams, "item_id required");
      await slackCall("slackLists.items.delete", { list_id: args.list_id, item_id: args.item_id });
      return { deleted: true, item_id: args.item_id, list_id: args.list_id };
    }

    case "slack_list_items_list": {
      if (!args.list_id) throw new McpError(ErrorCode.InvalidParams, "list_id required");
      const data = await slackCall("slackLists.items.list", {
        list_id: args.list_id,
        limit: args.limit || 50,
      });
      // Normalise response shape variations
      const items = data.items ?? data.results ?? data.list_items ?? [];
      return { items, count: items.length, list_id: args.list_id };
    }

    case "slack_reminder_add": {
      const params = { text: args.text, time: args.time };
      if (args.user_id) params.user = args.user_id;
      const data = await slackCall("reminders.add", params);
      return { reminder_id: data.reminder?.id, text: args.text };
    }

    case "slack_post_self_dm": {
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
  { name: "pickle-slack-mcp", version: "1.7.0" },
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
