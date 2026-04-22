#!/usr/bin/env node
/**
 * @pickle/clickup-mcp  v2.3.0
 *
 * Free, open-source ClickUp MCP server — part of the Pickle project.
 * Pure Node.js ESM · no build step · no TypeScript compilation.
 *
 * License: MIT
 * Repo:    https://github.com/adityaarsharma/pickle
 *
 * Covers the ClickUp API surfaces Pickle needs (v2 + v3):
 *   Workspace · Spaces · Lists · Tasks · Subtasks
 *   Comments (task, list, threaded) · Custom Fields
 *   Chat (channels, DMs, group DMs, messages, replies, reactions)
 *   Docs (v3) · Reminders · Members · Watchers
 *
 * Zero telemetry. No phone-home. Only talks to https://api.clickup.com.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Accept either env var name silently — no setup friction.
const CLICKUP_API_KEY    = process.env.CLICKUP_API_KEY || process.env.CLICKUP_API_TOKEN;
const CLICKUP_TEAM_ID_ENV = process.env.CLICKUP_TEAM_ID || "";
const API_BASE           = "https://api.clickup.com";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES        = 5;
const USER_AGENT         = "pickle-clickup-mcp/2.3 (+https://github.com/adityaarsharma/pickle)";

if (!CLICKUP_API_KEY) {
  process.stderr.write(
    "[pickle-clickup-mcp] FATAL: ClickUp API key not found in env.\n" +
      "Add it to ~/.claude.json under mcpServers.clickup.env:\n" +
      '  "env": { "CLICKUP_API_KEY": "pk_xxx" }\n'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP client — retries, backoff, 30s timeout
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt) {
  return 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
}

async function safeReadText(res) {
  try { return await res.text(); } catch { return ""; }
}

/**
 * Build URL; arrays → repeated query keys (ClickUp v2 style).
 */
function buildUrl(path, query) {
  const url = new URL(path, API_BASE);
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v === undefined || v === null) continue;
          url.searchParams.append(key, String(v));
        }
      } else if (typeof value === "boolean") {
        url.searchParams.append(key, value ? "true" : "false");
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }
  return url.toString();
}

async function clickupFetch(method, path, { query, body } = {}) {
  const url = buildUrl(path, query);
  const headers = {
    Authorization: CLICKUP_API_KEY,
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller  = new AbortController();
    const th = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(th);
      lastErr = err;
      if (attempt < MAX_RETRIES) { await sleep(backoffMs(attempt)); continue; }
      throw new McpError(ErrorCode.InternalError,
        `ClickUp request failed after ${MAX_RETRIES + 1} attempts: ${err?.message ?? err}`);
    }
    clearTimeout(th);

    if (res.ok) {
      if (res.status === 204) return { ok: true, status: 204 };
      const text = await res.text();
      if (!text) return { ok: true, status: res.status };
      try { return JSON.parse(text); } catch { return { ok: true, status: res.status, raw: text }; }
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const ra = res.headers.get("retry-after");
      let wait = ra ? (Number.isFinite(+ra) ? +ra * 1000 : Math.max(0, new Date(ra) - Date.now())) : backoffMs(attempt);
      if (!Number.isFinite(wait) || wait < 0) wait = backoffMs(attempt);
      await sleep(Math.min(wait, 60_000));
      continue;
    }
    // 5xx retry ONLY for idempotent methods — retrying POST/PUT/DELETE after
    // a 5xx can duplicate writes (create duplicate task, double-send message).
    const isIdempotent = method === "GET" || method === "HEAD";
    if (res.status >= 500 && isIdempotent && attempt < MAX_RETRIES) {
      await sleep(backoffMs(attempt)); continue;
    }

    const errorBody = await safeReadText(res);
    throw new McpError(ErrorCode.InternalError,
      `ClickUp API ${method} ${path} failed: HTTP ${res.status} ${res.statusText} — ${errorBody || "(no body)"}`);
  }
  throw new McpError(ErrorCode.InternalError,
    `ClickUp request exhausted retries: ${lastErr?.message ?? "unknown"}`);
}

// ---------------------------------------------------------------------------
// Team-id resolution (cached)
// ---------------------------------------------------------------------------

let _cachedTeamId = null;
let _cachedTeams  = null;

async function resolveTeamId(override) {
  if (override) return String(override);
  if (CLICKUP_TEAM_ID_ENV) return CLICKUP_TEAM_ID_ENV;
  if (_cachedTeamId) return _cachedTeamId;
  const teams = await listTeams();
  if (!teams.length) throw new McpError(ErrorCode.InternalError, "No ClickUp workspaces found for this API key.");
  _cachedTeamId = String(teams[0].id);
  return _cachedTeamId;
}

async function listTeams() {
  if (_cachedTeams) return _cachedTeams;
  const data = await clickupFetch("GET", "/api/v2/team");
  _cachedTeams = Array.isArray(data?.teams) ? data.teams : [];
  return _cachedTeams;
}

// ---------------------------------------------------------------------------
// Hierarchy helpers
// ---------------------------------------------------------------------------

async function getSpaces(teamId) {
  const d = await clickupFetch("GET", `/api/v2/team/${teamId}/space`, { query: { archived: false } });
  return Array.isArray(d?.spaces) ? d.spaces : [];
}
async function getFoldersForSpace(spaceId) {
  const d = await clickupFetch("GET", `/api/v2/space/${spaceId}/folder`, { query: { archived: false } });
  return Array.isArray(d?.folders) ? d.folders : [];
}
async function getFolderlessLists(spaceId) {
  const d = await clickupFetch("GET", `/api/v2/space/${spaceId}/list`, { query: { archived: false } });
  return Array.isArray(d?.lists) ? d.lists : [];
}
async function getListsInFolder(folderId) {
  const d = await clickupFetch("GET", `/api/v2/folder/${folderId}/list`, { query: { archived: false } });
  return Array.isArray(d?.lists) ? d.lists : [];
}

// ---------------------------------------------------------------------------
// TOOLS
// ---------------------------------------------------------------------------

const tools = [

  // =========================================================================
  // WORKSPACE / MEMBERS
  // =========================================================================

  {
    name: "clickup_get_workspace_hierarchy",
    description: "Return the full tree: team → spaces → folders → lists (plus folderless lists).",
    inputSchema: z.object({
      team_id: z.string().optional(),
    }),
    async handler({ team_id }) {
      const teamId = await resolveTeamId(team_id);
      const teams  = await listTeams();
      const team   = teams.find((t) => String(t.id) === String(teamId)) || { id: teamId, name: null };
      const spaces = await getSpaces(teamId);

      // Parallelize: fetch folders + folderless lists per space concurrently
      const perSpace = await Promise.all(spaces.map(async (space) => {
        const [folders, folderlessLists] = await Promise.all([
          getFoldersForSpace(space.id),
          getFolderlessLists(space.id),
        ]);
        // For folders missing their nested lists, fetch in parallel
        const folderLists = await Promise.all(folders.map(async (folder) => {
          const lists = Array.isArray(folder.lists) && folder.lists.length
            ? folder.lists : await getListsInFolder(folder.id);
          return { folder, lists };
        }));
        return { space, folderLists, folderlessLists };
      }));

      const hierarchy = perSpace.map(({ space, folderLists, folderlessLists }) => ({
        id: space.id, name: space.name, private: space.private ?? false,
        folders: folderLists.map(({ folder, lists }) => ({
          id: folder.id, name: folder.name, hidden: folder.hidden ?? false,
          lists: lists.map((l) => ({ id: l.id, name: l.name, task_count: l.task_count ?? null })),
        })),
        folderless_lists: folderlessLists.map((l) => ({ id: l.id, name: l.name, task_count: l.task_count ?? null })),
      }));

      return { team: { id: String(team.id), name: team.name ?? null }, spaces: hierarchy };
    },
  },

  {
    name: "clickup_get_workspace_members",
    description: "Return all members of a ClickUp workspace.",
    inputSchema: z.object({ team_id: z.string().optional() }),
    async handler({ team_id }) {
      const teamId = await resolveTeamId(team_id);
      const teams  = await listTeams();
      const team   = teams.find((t) => String(t.id) === String(teamId));
      if (!team) throw new McpError(ErrorCode.InvalidRequest, `Team ${teamId} not found.`);
      return {
        team_id: String(team.id), team_name: team.name ?? null,
        members: (team.members ?? []).map((m) => {
          const u = m?.user || {};
          return { id: u.id, username: u.username ?? null, email: u.email ?? null,
            initials: u.initials ?? null, color: u.color ?? null,
            profilePicture: u.profilePicture ?? null, role: u.role ?? null };
        }),
      };
    },
  },

  {
    name: "clickup_find_member_by_name",
    description: "Find a workspace member by case-insensitive substring on username or email.",
    inputSchema: z.object({
      query: z.string().min(1),
      team_id: z.string().optional(),
    }),
    async handler({ query, team_id }) {
      const teamId  = await resolveTeamId(team_id);
      const teams   = await listTeams();
      const team    = teams.find((t) => String(t.id) === String(teamId));
      const members = team?.members ?? [];
      const needle  = query.trim().toLowerCase();
      const matches = members.map((m) => m?.user).filter(Boolean)
        .filter((u) => (u.username || "").toLowerCase().includes(needle) || (u.email || "").toLowerCase().includes(needle))
        .map((u) => ({ id: u.id, username: u.username ?? null, email: u.email ?? null }));
      return { query, matches };
    },
  },

  {
    name: "clickup_resolve_assignees",
    description: "Resolve names/emails/IDs to numeric ClickUp user IDs. Numeric values pass through.",
    inputSchema: z.object({
      assignees: z.array(z.union([z.string(), z.number()])).min(1),
      team_id: z.string().optional(),
    }),
    async handler({ assignees, team_id }) {
      const teamId  = await resolveTeamId(team_id);
      const teams   = await listTeams();
      const team    = teams.find((t) => String(t.id) === String(teamId));
      const members = team?.members ?? [];
      const resolved = [], unresolved = [];
      for (const raw of assignees) {
        if (typeof raw === "number" || /^\d+$/.test(String(raw).trim())) { resolved.push(Number(raw)); continue; }
        const needle = String(raw).trim().toLowerCase();
        const user   = members.map((m) => m?.user).find((u) => u &&
          ((u.username || "").toLowerCase() === needle || (u.email || "").toLowerCase() === needle));
        if (user?.id != null) { resolved.push(Number(user.id)); continue; }
        const fuzzy = members.map((m) => m?.user).filter(Boolean).filter((u) =>
          (u.username || "").toLowerCase().includes(needle) || (u.email || "").toLowerCase().includes(needle));
        if (fuzzy.length === 1) resolved.push(Number(fuzzy[0].id));
        else unresolved.push(String(raw));
      }
      return { resolved, unresolved };
    },
  },

  // =========================================================================
  // SPACES
  // =========================================================================

  {
    name: "clickup_get_space",
    description: "Get a single space by ID.",
    inputSchema: z.object({ space_id: z.string().min(1) }),
    async handler({ space_id }) {
      return clickupFetch("GET", `/api/v2/space/${encodeURIComponent(space_id)}`);
    },
  },

  {
    name: "clickup_create_space",
    description: "Create a new space in the workspace.",
    inputSchema: z.object({
      team_id: z.string().optional(),
      name: z.string().min(1),
      multiple_assignees: z.boolean().optional(),
      features: z.object({
        due_dates: z.object({ enabled: z.boolean(), start_date: z.boolean().optional(), remap_due_dates: z.boolean().optional(), remap_closed_due_date: z.boolean().optional() }).optional(),
        time_tracking: z.object({ enabled: z.boolean() }).optional(),
        tags: z.object({ enabled: z.boolean() }).optional(),
        time_estimates: z.object({ enabled: z.boolean() }).optional(),
        checklists: z.object({ enabled: z.boolean() }).optional(),
        custom_fields: z.object({ enabled: z.boolean() }).optional(),
        remap_dependencies: z.object({ enabled: z.boolean() }).optional(),
        dependency_warning: z.object({ enabled: z.boolean() }).optional(),
        portfolios: z.object({ enabled: z.boolean() }).optional(),
      }).optional(),
    }),
    async handler({ team_id, name, multiple_assignees, features }) {
      const teamId = await resolveTeamId(team_id);
      const body = { name };
      if (multiple_assignees !== undefined) body.multiple_assignees = multiple_assignees;
      if (features) body.features = features;
      return clickupFetch("POST", `/api/v2/team/${teamId}/space`, { body });
    },
  },


  // =========================================================================
  // LISTS
  // =========================================================================

  {
    name: "clickup_get_lists_in_folder",
    description: "Get all lists inside a folder.",
    inputSchema: z.object({
      folder_id: z.string().min(1),
      archived: z.boolean().optional(),
    }),
    async handler({ folder_id, archived }) {
      return clickupFetch("GET", `/api/v2/folder/${encodeURIComponent(folder_id)}/list`,
        { query: { archived: archived ?? false } });
    },
  },

  {
    name: "clickup_get_folderless_lists",
    description: "Get all folderless (space-level) lists inside a space.",
    inputSchema: z.object({
      space_id: z.string().min(1),
      archived: z.boolean().optional(),
    }),
    async handler({ space_id, archived }) {
      return clickupFetch("GET", `/api/v2/space/${encodeURIComponent(space_id)}/list`,
        { query: { archived: archived ?? false } });
    },
  },

  {
    name: "clickup_get_list",
    description: "Get a single list by ID (includes task statuses, custom fields info).",
    inputSchema: z.object({ list_id: z.string().min(1) }),
    async handler({ list_id }) {
      return clickupFetch("GET", `/api/v2/list/${encodeURIComponent(list_id)}`);
    },
  },

  {
    name: "clickup_create_list",
    description: "Create a list. Provide EITHER folder_id OR space_id (folderless).",
    inputSchema: z.object({
      name: z.string().min(1),
      folder_id: z.string().optional(),
      space_id: z.string().optional(),
      content: z.string().optional(),
      due_date: z.number().int().optional(),
      due_date_time: z.boolean().optional(),
      priority: z.number().int().min(1).max(4).optional(),
      assignee: z.number().int().optional(),
      status: z.string().optional(),
    }).refine((v) => !!(v.folder_id) !== !!(v.space_id), { message: "Provide exactly one of folder_id or space_id." }),
    async handler(args) {
      const { folder_id, space_id, ...rest } = args;
      const body = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      const path = folder_id
        ? `/api/v2/folder/${encodeURIComponent(folder_id)}/list`
        : `/api/v2/space/${encodeURIComponent(space_id)}/list`;
      return clickupFetch("POST", path, { body });
    },
  },

  {
    name: "clickup_get_list_tasks",
    description: "Get all tasks in a specific list. Supports pagination, filters, custom fields.",
    inputSchema: z.object({
      list_id: z.string().min(1),
      archived: z.boolean().optional(),
      include_markdown_description: z.boolean().optional(),
      page: z.number().int().min(0).optional(),
      order_by: z.enum(["id", "created", "updated", "due_date"]).optional(),
      reverse: z.boolean().optional(),
      subtasks: z.boolean().optional(),
      statuses: z.array(z.string()).optional(),
      include_closed: z.boolean().optional(),
      assignees: z.array(z.union([z.string(), z.number()])).optional(),
      tags: z.array(z.string()).optional(),
      due_date_gt: z.number().int().optional(),
      due_date_lt: z.number().int().optional(),
      date_created_gt: z.number().int().optional(),
      date_created_lt: z.number().int().optional(),
      date_updated_gt: z.number().int().optional(),
      date_updated_lt: z.number().int().optional(),
      custom_fields: z.string().optional().describe("JSON-encoded array of custom field filters."),
    }),
    async handler({ list_id, ...args }) {
      const query = {};
      if (args.archived !== undefined) query.archived = args.archived;
      if (args.include_markdown_description) query.include_markdown_description = true;
      if (args.page !== undefined) query.page = args.page;
      if (args.order_by) query.order_by = args.order_by;
      if (args.reverse !== undefined) query.reverse = args.reverse;
      if (args.subtasks !== undefined) query.subtasks = args.subtasks;
      if (args.include_closed !== undefined) query.include_closed = args.include_closed;
      if (args.statuses) query["statuses[]"] = args.statuses;
      if (args.assignees) query["assignees[]"] = args.assignees;
      if (args.tags) query["tags[]"] = args.tags;
      if (args.due_date_gt !== undefined) query.due_date_gt = args.due_date_gt;
      if (args.due_date_lt !== undefined) query.due_date_lt = args.due_date_lt;
      if (args.date_created_gt !== undefined) query.date_created_gt = args.date_created_gt;
      if (args.date_created_lt !== undefined) query.date_created_lt = args.date_created_lt;
      if (args.date_updated_gt !== undefined) query.date_updated_gt = args.date_updated_gt;
      if (args.date_updated_lt !== undefined) query.date_updated_lt = args.date_updated_lt;
      if (args.custom_fields) query.custom_fields = args.custom_fields;
      return clickupFetch("GET", `/api/v2/list/${encodeURIComponent(list_id)}/task`, { query });
    },
  },

  // =========================================================================
  // CUSTOM FIELDS
  // =========================================================================

  {
    name: "clickup_get_list_custom_fields",
    description: "Get all custom fields defined on a list.",
    inputSchema: z.object({ list_id: z.string().min(1) }),
    async handler({ list_id }) {
      return clickupFetch("GET", `/api/v2/list/${encodeURIComponent(list_id)}/field`);
    },
  },

  {
    name: "clickup_set_task_custom_field",
    description: "Set (or update) a custom field value on a task. Call clickup_get_list_custom_fields first to inspect the field's `type` and `type_config` — value shape depends on type: dropdown → option UUID string; labels → array of option UUIDs; users → {add:[userId], rem:[]}; date → unix ms integer; number → number; checkbox → boolean; text/short-text → string; url/email/phone → string.",
    inputSchema: z.object({
      task_id: z.string().min(1),
      field_id: z.string().min(1),
      value: z.any().describe("The value to set. Type depends on the custom field type."),
      value_options: z.record(z.any()).optional().describe("Extra options (e.g. time tracked options)."),
      custom_task_ids: z.boolean().optional(),
      team_id: z.string().optional(),
    }),
    async handler({ task_id, field_id, value, value_options, custom_task_ids, team_id }) {
      const query = {};
      if (custom_task_ids) { query.custom_task_ids = true; query.team_id = team_id || await resolveTeamId(); }
      const body = { value };
      if (value_options) body.value_options = value_options;
      return clickupFetch("POST",
        `/api/v2/task/${encodeURIComponent(task_id)}/field/${encodeURIComponent(field_id)}`,
        { query, body });
    },
  },


  // =========================================================================
  // CHAT (v3)
  // =========================================================================

  {
    name: "clickup_get_chat_channels",
    description: "List chat channels (including DMs and group DMs) for the workspace.",
    inputSchema: z.object({
      team_id: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
      cursor: z.string().optional(),
      include_hidden: z.boolean().optional(),
    }),
    async handler({ team_id, limit, cursor, include_hidden }) {
      const teamId = await resolveTeamId(team_id);
      const query = {};
      if (limit !== undefined) query.limit = limit;
      if (cursor) query.cursor = cursor;
      if (include_hidden !== undefined) query.include_hidden = include_hidden;
      return clickupFetch("GET", `/api/v3/workspaces/${teamId}/chat/channels`, { query });
    },
  },

  {
    name: "clickup_get_chat_channel",
    description: "Get details of a single chat channel by ID.",
    inputSchema: z.object({
      channel_id: z.string().min(1),
      team_id: z.string().optional(),
    }),
    async handler({ channel_id, team_id }) {
      const teamId = await resolveTeamId(team_id);
      return clickupFetch("GET",
        `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(channel_id)}`);
    },
  },

  {
    name: "clickup_get_chat_channel_messages",
    description: "List messages from a ClickUp chat channel (v3). Supports limit and cursor pagination.",
    inputSchema: z.object({
      channel_id: z.string().min(1),
      team_id: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
      cursor: z.string().optional(),
    }),
    async handler({ channel_id, team_id, limit, cursor }) {
      const teamId = await resolveTeamId(team_id);
      const query = {};
      if (limit !== undefined) query.limit = limit;
      if (cursor) query.cursor = cursor;
      return clickupFetch("GET",
        `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(channel_id)}/messages`,
        { query });
    },
  },

  {
    name: "clickup_send_chat_message",
    description: "Send a message to a ClickUp chat channel (v3).",
    inputSchema: z.object({
      channel_id: z.string().min(1),
      content: z.string().min(1),
      type: z.enum(["message", "comment"]).optional(),
      team_id: z.string().optional(),
    }),
    async handler({ channel_id, content, type, team_id }) {
      const teamId = await resolveTeamId(team_id);
      return clickupFetch("POST",
        `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(channel_id)}/messages`,
        { body: { type: type || "message", content } });
    },
  },

  {
    name: "clickup_update_chat_message",
    description: "Edit the content of an existing chat message.",
    inputSchema: z.object({
      channel_id: z.string().min(1),
      message_id: z.string().min(1),
      content: z.string().min(1),
      team_id: z.string().optional(),
    }),
    async handler({ channel_id, message_id, content, team_id }) {
      const teamId = await resolveTeamId(team_id);
      return clickupFetch("PUT",
        `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(channel_id)}/messages/${encodeURIComponent(message_id)}`,
        { body: { content } });
    },
  },

  {
    name: "clickup_delete_chat_message",
    description: "Delete a chat message.",
    inputSchema: z.object({
      channel_id: z.string().min(1),
      message_id: z.string().min(1),
      team_id: z.string().optional(),
    }),
    async handler({ channel_id, message_id, team_id }) {
      const teamId = await resolveTeamId(team_id);
      return clickupFetch("DELETE",
        `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(channel_id)}/messages/${encodeURIComponent(message_id)}`);
    },
  },

  {
    name: "clickup_get_chat_message_replies",
    description: "Get threaded replies for a specific chat message (v3).",
    inputSchema: z.object({
      channel_id: z.string().min(1),
      message_id: z.string().min(1),
      team_id: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
      cursor: z.string().optional(),
    }),
    async handler({ channel_id, message_id, team_id, limit, cursor }) {
      const teamId = await resolveTeamId(team_id);
      const query = {};
      if (limit !== undefined) query.limit = limit;
      if (cursor) query.cursor = cursor;
      return clickupFetch("GET",
        `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(channel_id)}/messages/${encodeURIComponent(message_id)}/replies`,
        { query });
    },
  },

  {
    name: "clickup_send_chat_reply",
    description: "Send a reply in a chat message thread (v3).",
    inputSchema: z.object({
      channel_id: z.string().min(1),
      message_id: z.string().min(1),
      content: z.string().min(1),
      team_id: z.string().optional(),
    }),
    async handler({ channel_id, message_id, content, team_id }) {
      const teamId = await resolveTeamId(team_id);
      return clickupFetch("POST",
        `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(channel_id)}/messages/${encodeURIComponent(message_id)}/replies`,
        { body: { content } });
    },
  },

  {
    name: "clickup_react_to_chat_message",
    description: "Add an emoji reaction to a chat message.",
    inputSchema: z.object({
      message_id: z.string().min(1),
      emoji: z.string().min(1).describe("Emoji character or shortcode, e.g. '👍' or ':thumbsup:'"),
      team_id: z.string().optional(),
    }),
    async handler({ message_id, emoji, team_id }) {
      const teamId = await resolveTeamId(team_id);
      return clickupFetch("POST",
        `/api/v3/workspaces/${teamId}/chat/messages/${encodeURIComponent(message_id)}/reactions`,
        { body: { emoji } });
    },
  },

  // =========================================================================
  // TASKS
  // =========================================================================

  {
    name: "clickup_filter_tasks",
    description: "Filter workspace tasks. Supports assignees, watchers, dates, search text, statuses, tags, list/folder/space filters, and pagination. Use response_format='summary' (default) to keep token usage low — returns only id, name, status, assignees, due_date, url, list_id, date_updated per task. Pass 'full' only when the caller needs custom fields, description, watchers, attachments.",
    inputSchema: z.object({
      team_id: z.string().optional(),
      assignees: z.array(z.union([z.string(), z.number()])).optional(),
      watchers: z.array(z.union([z.string(), z.number()])).optional(),
      search: z.string().optional().describe("Full-text search across task name and description."),
      date_updated_gt: z.number().int().optional(),
      date_updated_lt: z.number().int().optional(),
      date_created_gt: z.number().int().optional(),
      date_created_lt: z.number().int().optional(),
      due_date_gt: z.number().int().optional(),
      due_date_lt: z.number().int().optional(),
      include_closed: z.boolean().optional(),
      subtasks: z.boolean().optional(),
      archived: z.boolean().optional(),
      statuses: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      list_ids: z.array(z.union([z.string(), z.number()])).optional(),
      folder_ids: z.array(z.union([z.string(), z.number()])).optional(),
      space_ids: z.array(z.union([z.string(), z.number()])).optional(),
      order_by: z.enum(["id", "created", "updated", "due_date"]).optional(),
      reverse: z.boolean().optional(),
      page: z.number().int().min(0).optional(),
      include_markdown_description: z.boolean().optional(),
      response_format: z.enum(["summary", "full"]).default("summary").describe("'summary' (default) returns compact task objects ~20x smaller; 'full' returns raw ClickUp task objects."),
    }),
    async handler(args) {
      const teamId = await resolveTeamId(args.team_id);
      const query = {};
      if (args.assignees) query["assignees[]"] = args.assignees;
      if (args.watchers)  query["watchers[]"]  = args.watchers;
      if (args.search)    query.search         = args.search;
      if (args.statuses)  query["statuses[]"]  = args.statuses;
      if (args.tags)      query["tags[]"]      = args.tags;
      if (args.list_ids)  query["list_ids[]"]  = args.list_ids;
      if (args.folder_ids) query["folder_ids[]"] = args.folder_ids;
      if (args.space_ids)  query["space_ids[]"]  = args.space_ids;
      const simple = ["date_updated_gt","date_updated_lt","date_created_gt","date_created_lt",
        "due_date_gt","due_date_lt","include_closed","subtasks","archived","order_by","reverse","page",
        "include_markdown_description"];
      for (const k of simple) if (args[k] !== undefined) query[k] = args[k];
      const data = await clickupFetch("GET", `/api/v2/team/${teamId}/task`, { query });
      const rawTasks = Array.isArray(data?.tasks) ? data.tasks : [];
      const format = args.response_format || "summary";
      const tasks = format === "full" ? rawTasks : rawTasks.map((t) => ({
        id: t.id, custom_id: t.custom_id ?? null, name: t.name,
        status: t.status?.status ?? null,
        assignees: (t.assignees || []).map((a) => ({ id: a.id, username: a.username })),
        due_date: t.due_date ?? null, date_updated: t.date_updated ?? null,
        priority: t.priority?.priority ?? null,
        url: t.url ?? null, list_id: t.list?.id ?? null, list_name: t.list?.name ?? null,
      }));
      return { tasks, last_page: data?.last_page ?? null, page: args.page ?? 0, format };
    },
  },

  {
    name: "clickup_get_task",
    description: "Get a single task by ID.",
    inputSchema: z.object({
      task_id: z.string().min(1),
      custom_task_ids: z.boolean().optional(),
      team_id: z.string().optional(),
      include_subtasks: z.boolean().optional(),
      include_markdown_description: z.boolean().optional(),
    }),
    async handler({ task_id, custom_task_ids, team_id, include_subtasks, include_markdown_description }) {
      const query = {};
      if (custom_task_ids) { query.custom_task_ids = true; query.team_id = team_id || await resolveTeamId(); }
      if (include_subtasks !== undefined) query.include_subtasks = include_subtasks;
      if (include_markdown_description) query.include_markdown_description = true;
      return clickupFetch("GET", `/api/v2/task/${encodeURIComponent(task_id)}`, { query });
    },
  },

  {
    name: "clickup_create_task",
    description: "Create a task in a list.",
    inputSchema: z.object({
      list_id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      markdown_description: z.string().optional(),
      assignees: z.array(z.number().int()).optional(),
      tags: z.array(z.string()).optional(),
      status: z.string().optional(),
      priority: z.number().int().min(1).max(4).optional().describe("1=urgent 2=high 3=normal 4=low"),
      due_date: z.number().int().optional(),
      due_date_time: z.boolean().optional(),
      start_date: z.number().int().optional(),
      start_date_time: z.boolean().optional(),
      time_estimate: z.number().int().optional().describe("Time estimate in milliseconds."),
      notify_all: z.boolean().optional(),
      parent: z.string().optional().describe("Parent task ID to create a subtask."),
      links_to: z.string().optional(),
      custom_fields: z.array(z.object({ id: z.string(), value: z.any() })).optional(),
    }),
    async handler(args) {
      const { list_id, ...rest } = args;
      const body = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      return clickupFetch("POST", `/api/v2/list/${encodeURIComponent(list_id)}/task`, { body });
    },
  },

  {
    name: "clickup_update_task",
    description: "Update fields on an existing task.",
    inputSchema: z.object({
      task_id: z.string().min(1),
      name: z.string().optional(),
      description: z.string().optional(),
      markdown_description: z.string().optional(),
      status: z.string().optional(),
      priority: z.number().int().min(1).max(4).nullable().optional(),
      due_date: z.number().int().nullable().optional(),
      due_date_time: z.boolean().optional(),
      start_date: z.number().int().nullable().optional(),
      start_date_time: z.boolean().optional(),
      time_estimate: z.number().int().nullable().optional(),
      assignees: z.object({
        add: z.array(z.number().int()).optional(),
        rem: z.array(z.number().int()).optional(),
      }).optional(),
      archived: z.boolean().optional(),
      parent: z.string().nullable().optional(),
      custom_task_ids: z.boolean().optional(),
      team_id: z.string().optional(),
    }),
    async handler(args) {
      const { task_id, custom_task_ids, team_id, ...rest } = args;
      const query = {};
      if (custom_task_ids) { query.custom_task_ids = true; query.team_id = team_id || await resolveTeamId(); }
      const body = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      return clickupFetch("PUT", `/api/v2/task/${encodeURIComponent(task_id)}`, { query, body });
    },
  },

  {
    name: "clickup_delete_task",
    description: "Permanently delete a task.",
    inputSchema: z.object({
      task_id: z.string().min(1),
      custom_task_ids: z.boolean().optional(),
      team_id: z.string().optional(),
    }),
    async handler({ task_id, custom_task_ids, team_id }) {
      const query = {};
      if (custom_task_ids) { query.custom_task_ids = true; query.team_id = team_id || await resolveTeamId(); }
      return clickupFetch("DELETE", `/api/v2/task/${encodeURIComponent(task_id)}`, { query });
    },
  },

  {
    name: "clickup_get_task_members",
    description: "Get all members assigned to or watching a task.",
    inputSchema: z.object({ task_id: z.string().min(1) }),
    async handler({ task_id }) {
      return clickupFetch("GET", `/api/v2/task/${encodeURIComponent(task_id)}/member`);
    },
  },

  // =========================================================================
  // TASK WATCHERS
  // =========================================================================

  {
    name: "clickup_add_task_watcher",
    description: "Add a watcher to a task.",
    inputSchema: z.object({
      task_id: z.string().min(1),
      watcher_id: z.number().int().describe("Numeric ClickUp user ID to add as watcher."),
      custom_task_ids: z.boolean().optional(),
      team_id: z.string().optional(),
    }),
    async handler({ task_id, watcher_id, custom_task_ids, team_id }) {
      const query = {};
      if (custom_task_ids) { query.custom_task_ids = true; query.team_id = team_id || await resolveTeamId(); }
      return clickupFetch("POST", `/api/v2/task/${encodeURIComponent(task_id)}/watcher`,
        { query, body: { watcher: watcher_id } });
    },
  },

  {
    name: "clickup_remove_task_watcher",
    description: "Remove a watcher from a task.",
    inputSchema: z.object({
      task_id: z.string().min(1),
      watcher_id: z.number().int(),
      custom_task_ids: z.boolean().optional(),
      team_id: z.string().optional(),
    }),
    async handler({ task_id, watcher_id, custom_task_ids, team_id }) {
      const query = {};
      if (custom_task_ids) { query.custom_task_ids = true; query.team_id = team_id || await resolveTeamId(); }
      return clickupFetch("DELETE", `/api/v2/task/${encodeURIComponent(task_id)}/watcher`,
        { query, body: { watcher: watcher_id } });
    },
  },

  // =========================================================================
  // COMMENTS
  // =========================================================================

  {
    name: "clickup_get_task_comments",
    description: "Get all comments on a task.",
    inputSchema: z.object({
      task_id: z.string().min(1),
      start: z.number().int().optional().describe("Unix ms — oldest comment to include."),
      start_id: z.string().optional(),
      custom_task_ids: z.boolean().optional(),
      team_id: z.string().optional(),
    }),
    async handler({ task_id, start, start_id, custom_task_ids, team_id }) {
      const query = {};
      if (start !== undefined) query.start = start;
      if (start_id) query.start_id = start_id;
      if (custom_task_ids) { query.custom_task_ids = true; query.team_id = team_id || await resolveTeamId(); }
      return clickupFetch("GET", `/api/v2/task/${encodeURIComponent(task_id)}/comment`, { query });
    },
  },

  {
    name: "clickup_create_task_comment",
    description: "Create a comment on a task.",
    inputSchema: z.object({
      task_id: z.string().min(1),
      comment_text: z.string().min(1),
      assignee: z.number().int().optional(),
      notify_all: z.boolean().optional(),
      custom_task_ids: z.boolean().optional(),
      team_id: z.string().optional(),
    }),
    async handler({ task_id, comment_text, assignee, notify_all, custom_task_ids, team_id }) {
      const query = {};
      if (custom_task_ids) { query.custom_task_ids = true; query.team_id = team_id || await resolveTeamId(); }
      const body = { comment_text };
      if (assignee !== undefined) body.assignee = assignee;
      if (notify_all !== undefined) body.notify_all = notify_all;
      return clickupFetch("POST", `/api/v2/task/${encodeURIComponent(task_id)}/comment`, { query, body });
    },
  },

  {
    name: "clickup_update_comment",
    description: "Edit an existing comment's text.",
    inputSchema: z.object({
      comment_id: z.string().min(1),
      comment_text: z.string().min(1),
      assignee: z.number().int().optional(),
      resolved: z.boolean().optional(),
    }),
    async handler({ comment_id, comment_text, assignee, resolved }) {
      const body = { comment_text };
      if (assignee !== undefined) body.assignee = assignee;
      if (resolved !== undefined) body.resolved = resolved;
      return clickupFetch("PUT", `/api/v2/comment/${encodeURIComponent(comment_id)}`, { body });
    },
  },

  {
    name: "clickup_delete_comment",
    description: "Delete a comment.",
    inputSchema: z.object({ comment_id: z.string().min(1) }),
    async handler({ comment_id }) {
      return clickupFetch("DELETE", `/api/v2/comment/${encodeURIComponent(comment_id)}`);
    },
  },

  {
    name: "clickup_get_threaded_comments",
    description: "Get all threaded replies for a comment.",
    inputSchema: z.object({ comment_id: z.string().min(1) }),
    async handler({ comment_id }) {
      return clickupFetch("GET", `/api/v2/comment/${encodeURIComponent(comment_id)}/reply`);
    },
  },

  {
    name: "clickup_create_threaded_comment",
    description: "Create a reply in a comment thread.",
    inputSchema: z.object({
      comment_id: z.string().min(1),
      comment_text: z.string().min(1),
      notify_all: z.boolean().optional(),
    }),
    async handler({ comment_id, comment_text, notify_all }) {
      const body = { comment_text };
      if (notify_all !== undefined) body.notify_all = notify_all;
      return clickupFetch("POST", `/api/v2/comment/${encodeURIComponent(comment_id)}/reply`, { body });
    },
  },

  {
    name: "clickup_get_list_comments",
    description: "Get all comments on a list (list-level, not task comments).",
    inputSchema: z.object({
      list_id: z.string().min(1),
      start: z.number().int().optional(),
      start_id: z.string().optional(),
    }),
    async handler({ list_id, start, start_id }) {
      const query = {};
      if (start !== undefined) query.start = start;
      if (start_id) query.start_id = start_id;
      return clickupFetch("GET", `/api/v2/list/${encodeURIComponent(list_id)}/comment`, { query });
    },
  },

  {
    name: "clickup_create_list_comment",
    description: "Create a comment on a list (list-level discussion).",
    inputSchema: z.object({
      list_id: z.string().min(1),
      comment_text: z.string().min(1),
      notify_all: z.boolean().optional(),
      assignee: z.number().int().optional(),
    }),
    async handler({ list_id, comment_text, notify_all, assignee }) {
      const body = { comment_text };
      if (notify_all !== undefined) body.notify_all = notify_all;
      if (assignee !== undefined) body.assignee = assignee;
      return clickupFetch("POST", `/api/v2/list/${encodeURIComponent(list_id)}/comment`, { body });
    },
  },

  // =========================================================================
  // DOCS (v3)
  // =========================================================================

  {
    name: "clickup_search_docs",
    description: "Search / list Docs in the workspace. Supports text search and pagination.",
    inputSchema: z.object({
      team_id: z.string().optional(),
      search: z.string().optional().describe("Text to search in doc titles."),
      creator: z.number().int().optional().describe("Filter by creator user ID."),
      deleted: z.boolean().optional(),
      archived: z.boolean().optional(),
      limit: z.number().int().positive().max(100).optional(),
      next_cursor: z.string().optional(),
    }),
    async handler({ team_id, search, creator, deleted, archived, limit, next_cursor }) {
      const teamId = await resolveTeamId(team_id);
      const query = {};
      if (search)            query.search      = search;
      if (creator)           query.creator     = creator;
      if (deleted !== undefined) query.deleted = deleted;
      if (archived !== undefined) query.archived = archived;
      if (limit)             query.limit       = limit;
      if (next_cursor)       query.next_cursor = next_cursor;
      return clickupFetch("GET", `/api/v3/workspaces/${teamId}/docs`, { query });
    },
  },

  {
    name: "clickup_get_doc",
    description: "Get a single Doc by ID.",
    inputSchema: z.object({
      doc_id: z.string().min(1),
      team_id: z.string().optional(),
    }),
    async handler({ doc_id, team_id }) {
      const teamId = await resolveTeamId(team_id);
      return clickupFetch("GET", `/api/v3/workspaces/${teamId}/docs/${encodeURIComponent(doc_id)}`);
    },
  },

  {
    name: "clickup_get_doc_pages",
    description: "Get all pages inside a Doc.",
    inputSchema: z.object({
      doc_id: z.string().min(1),
      team_id: z.string().optional(),
      max_page_depth: z.number().int().min(-1).optional().describe("-1 for all depths."),
    }),
    async handler({ doc_id, team_id, max_page_depth }) {
      const teamId = await resolveTeamId(team_id);
      const query = {};
      if (max_page_depth !== undefined) query.max_page_depth = max_page_depth;
      return clickupFetch("GET",
        `/api/v3/workspaces/${teamId}/docs/${encodeURIComponent(doc_id)}/pages`, { query });
    },
  },

  {
    name: "clickup_create_doc",
    description: "Create a new Doc in the workspace.",
    inputSchema: z.object({
      team_id: z.string().optional(),
      name: z.string().min(1),
      parent: z.object({
        id: z.string(),
        type: z.number().int().describe("Parent type: 4=space, 5=folder, 6=list, 12=workspace"),
      }).optional(),
      visibility: z.enum(["PRIVATE", "PUBLIC"]).optional(),
      create_page: z.boolean().optional().describe("If true, create a default first page."),
    }),
    async handler({ team_id, name, parent, visibility, create_page }) {
      const teamId = await resolveTeamId(team_id);
      const body = { name };
      if (parent) body.parent = parent;
      if (visibility) body.visibility = visibility;
      if (create_page !== undefined) body.create_page = create_page;
      return clickupFetch("POST", `/api/v3/workspaces/${teamId}/docs`, { body });
    },
  },

  {
    name: "clickup_create_doc_page",
    description: "Create a new page inside an existing Doc.",
    inputSchema: z.object({
      doc_id: z.string().min(1),
      team_id: z.string().optional(),
      name: z.string().min(1),
      content: z.string().optional().describe("Page body content (markdown or HTML depending on type)."),
      sub_title: z.string().optional(),
      parent_page_id: z.string().optional(),
    }),
    async handler({ doc_id, team_id, name, content, sub_title, parent_page_id }) {
      const teamId = await resolveTeamId(team_id);
      const body = { name };
      if (content) body.content = content;
      if (sub_title) body.sub_title = sub_title;
      if (parent_page_id) body.parent_page_id = parent_page_id;
      return clickupFetch("POST",
        `/api/v3/workspaces/${teamId}/docs/${encodeURIComponent(doc_id)}/pages`, { body });
    },
  },

  {
    name: "clickup_update_doc_page",
    description: "Update the name or content of a Doc page.",
    inputSchema: z.object({
      doc_id: z.string().min(1),
      page_id: z.string().min(1),
      team_id: z.string().optional(),
      name: z.string().optional(),
      content: z.string().optional(),
      sub_title: z.string().optional(),
    }),
    async handler({ doc_id, page_id, team_id, name, content, sub_title }) {
      const teamId = await resolveTeamId(team_id);
      const body = {};
      if (name) body.name = name;
      if (content !== undefined) body.content = content;
      if (sub_title !== undefined) body.sub_title = sub_title;
      return clickupFetch("PUT",
        `/api/v3/workspaces/${teamId}/docs/${encodeURIComponent(doc_id)}/pages/${encodeURIComponent(page_id)}`,
        { body });
    },
  },

  // =========================================================================
  // REMINDERS  (v2 — requires Business plan or above)
  // =========================================================================

  {
    name: "clickup_search_reminders",
    description: "List reminders for a user or the whole workspace. Note: requires ClickUp Business plan or above.",
    inputSchema: z.object({
      team_id: z.string().optional(),
      assignee: z.number().int().optional().describe("Filter by assignee user ID."),
      include_done: z.boolean().optional(),
      due_date_gt: z.number().int().optional().describe("Unix ms — reminders due after this."),
      due_date_lt: z.number().int().optional(),
    }),
    async handler({ team_id, assignee, include_done, due_date_gt, due_date_lt }) {
      const teamId = await resolveTeamId(team_id);
      const query = {};
      if (assignee !== undefined) query.assignee = assignee;
      if (include_done !== undefined) query.include_done = include_done;
      if (due_date_gt !== undefined) query.due_date_gt = due_date_gt;
      if (due_date_lt !== undefined) query.due_date_lt = due_date_lt;
      return clickupFetch("GET", `/api/v2/team/${teamId}/reminder`, { query });
    },
  },

  {
    name: "clickup_create_reminder",
    description: "Create a reminder for a user.",
    inputSchema: z.object({
      team_id: z.string().optional(),
      name: z.string().min(1),
      assignee: z.number().int().describe("User ID the reminder is for."),
      due_date: z.number().int().describe("Unix ms when the reminder fires."),
      due_date_time: z.boolean().optional(),
      notify_all: z.boolean().optional(),
    }),
    async handler({ team_id, name, assignee, due_date, due_date_time, notify_all }) {
      const teamId = await resolveTeamId(team_id);
      const body = { name, assignee, due_date };
      if (due_date_time !== undefined) body.due_date_time = due_date_time;
      if (notify_all !== undefined) body.notify_all = notify_all;
      return clickupFetch("POST", `/api/v2/team/${teamId}/reminder`, { body });
    },
  },


];

// ---------------------------------------------------------------------------
// Zod → JSON Schema (compact, no extra dep)
// ---------------------------------------------------------------------------

function zodToJsonSchema(schema) {
  const def = schema?._def;
  if (!def) return { type: "object" };
  switch (def.typeName) {
    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const properties = {}, required = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(child);
        if (!isOptional(child)) required.push(key);
      }
      const out = { type: "object", properties };
      if (required.length) out.required = required;
      if (def.unknownKeys === "strict") out.additionalProperties = false;
      return out;
    }
    case "ZodString": {
      const out = { type: "string" };
      if (Array.isArray(def.checks)) {
        for (const c of def.checks) {
          if (c.kind === "min") out.minLength = c.value;
          if (c.kind === "max") out.maxLength = c.value;
          if (c.kind === "url") out.format = "uri";
        }
      }
      if (schema.description) out.description = schema.description;
      return out;
    }
    case "ZodNumber": {
      const out = { type: "number" };
      if (Array.isArray(def.checks)) {
        for (const c of def.checks) {
          if (c.kind === "int") out.type = "integer";
          if (c.kind === "min") out.minimum = c.value;
          if (c.kind === "max") out.maximum = c.value;
        }
      }
      if (schema.description) out.description = schema.description;
      return out;
    }
    case "ZodBoolean": return { type: "boolean", ...(schema.description ? { description: schema.description } : {}) };
    case "ZodArray": { const out = { type: "array", items: zodToJsonSchema(def.type) }; if (schema.description) out.description = schema.description; return out; }
    case "ZodEnum": return { type: "string", enum: def.values, ...(schema.description ? { description: schema.description } : {}) };
    case "ZodLiteral": return { const: def.value };
    case "ZodUnion": return { anyOf: def.options.map((o) => zodToJsonSchema(o)) };
    case "ZodRecord": return { type: "object", additionalProperties: zodToJsonSchema(def.valueType) };
    case "ZodOptional": return zodToJsonSchema(def.innerType);
    case "ZodNullable": { const inner = zodToJsonSchema(def.innerType); return inner.type ? { ...inner, type: [inner.type, "null"] } : { anyOf: [inner, { type: "null" }] }; }
    case "ZodDefault": return { ...zodToJsonSchema(def.innerType), default: def.defaultValue() };
    case "ZodEffects": return zodToJsonSchema(def.schema);
    case "ZodAny": case "ZodUnknown": return {};
    default: return {};
  }
}

function isOptional(schema) {
  const def = schema?._def;
  if (!def) return false;
  if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") return true;
  if (def.typeName === "ZodEffects") return isOptional(def.schema);
  return false;
}

// ---------------------------------------------------------------------------
// MCP server wiring
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "pickle-clickup-mcp", version: "2.3.0" },
  { capabilities: { tools: {} } }
);

const toolByName = new Map(tools.map((t) => [t.name, t]));

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const tool = toolByName.get(name);
  if (!tool) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);

  let args;
  try {
    args = tool.inputSchema.parse(rawArgs ?? {});
  } catch (err) {
    const msg = err?.issues?.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")
      || err?.message || String(err);
    throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for ${name}: ${msg}`);
  }

  let result;
  try {
    result = await tool.handler(args);
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `Tool ${name} failed: ${err?.message ?? err}`);
  }

  return {
    content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
  };
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[pickle-clickup-mcp] v2.3.0 ready — ${tools.length} tools registered\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[pickle-clickup-mcp] FATAL on boot: ${err?.stack ?? err}\n`);
  process.exit(1);
});
