#!/usr/bin/env node
/**
 * @pickle/clickup-mcp
 *
 * Free, open-source ClickUp MCP server for the Pickle project.
 * Pure Node.js ESM — no build step, no TypeScript compilation.
 *
 * License: MIT
 * Repo:    https://github.com/adityaarsharma/pickle
 *
 * Exposes the ClickUp REST API (v2 + v3 chat) as MCP tools over stdio.
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

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const CLICKUP_TEAM_ID_ENV = process.env.CLICKUP_TEAM_ID || "";
const API_BASE = "https://api.clickup.com";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 5;
const USER_AGENT = "pickle-clickup-mcp/1.0 (+https://github.com/adityaarsharma/pickle)";

if (!CLICKUP_API_KEY) {
  // We can't throw before the server starts — MCP clients spawn us and read
  // stderr if we crash. Emit a clear diagnostic and exit non-zero.
  process.stderr.write(
    "[pickle-clickup-mcp] FATAL: CLICKUP_API_KEY env var is required.\n" +
      'Set it in your ~/.claude.json mcpServers.clickup.env block, e.g.\n' +
      '  "env": { "CLICKUP_API_KEY": "pk_xxx" }\n'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP client with retries, backoff, and 30s timeout
// ---------------------------------------------------------------------------

/**
 * Sleep for ms milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a URL with query params. Arrays are serialized as repeated keys
 * (ClickUp expects `assignees[]=1&assignees[]=2`).
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

/**
 * Core fetch wrapper — handles auth, timeout, retries on 429 / 5xx.
 */
async function clickupFetch(method, path, { query, body } = {}) {
  const url = buildUrl(path, query);
  const headers = {
    // ClickUp v2 and v3 both accept the raw personal token in Authorization.
    // No "Bearer " prefix.
    Authorization: CLICKUP_API_KEY,
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      lastErr = err;
      // AbortError (timeout) or network failure — retry with backoff
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `ClickUp request failed after ${MAX_RETRIES + 1} attempts: ${err && err.message ? err.message : String(err)}`
      );
    }
    clearTimeout(timeoutHandle);

    // Success
    if (res.ok) {
      // Some endpoints return 204 No Content
      if (res.status === 204) return { ok: true, status: 204 };
      const text = await res.text();
      if (!text) return { ok: true, status: res.status };
      try {
        return JSON.parse(text);
      } catch {
        return { ok: true, status: res.status, raw: text };
      }
    }

    // Rate-limited — honour Retry-After, then retry
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterHeader = res.headers.get("retry-after");
      let waitMs;
      if (retryAfterHeader) {
        const parsed = Number(retryAfterHeader);
        waitMs = Number.isFinite(parsed)
          ? parsed * 1000
          : Math.max(0, new Date(retryAfterHeader).getTime() - Date.now());
        if (!Number.isFinite(waitMs) || waitMs < 0) waitMs = backoffMs(attempt);
      } else {
        waitMs = backoffMs(attempt);
      }
      // Cap wait at 60s to avoid hanging forever
      waitMs = Math.min(waitMs, 60_000);
      await sleep(waitMs);
      continue;
    }

    // Transient server errors — retry
    if (res.status >= 500 && res.status < 600 && attempt < MAX_RETRIES) {
      await sleep(backoffMs(attempt));
      continue;
    }

    // Non-retryable error — surface it with the body for debugging
    const errorBody = await safeReadText(res);
    throw new McpError(
      ErrorCode.InternalError,
      `ClickUp API ${method} ${path} failed: HTTP ${res.status} ${res.statusText} — ${errorBody || "(no body)"}`
    );
  }

  // Should be unreachable, but just in case
  throw new McpError(
    ErrorCode.InternalError,
    `ClickUp request exhausted retries: ${lastErr ? lastErr.message : "unknown"}`
  );
}

function backoffMs(attempt) {
  // Exponential: 500, 1000, 2000, 4000, 8000 (+ jitter up to 250ms)
  const base = 500 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Team-id resolution (cached for process lifetime)
// ---------------------------------------------------------------------------

let _cachedTeamId = null;
let _cachedTeams = null;

async function resolveTeamId(override) {
  if (override) return String(override);
  if (CLICKUP_TEAM_ID_ENV) return CLICKUP_TEAM_ID_ENV;
  if (_cachedTeamId) return _cachedTeamId;
  const teams = await listTeams();
  if (!teams.length) {
    throw new McpError(
      ErrorCode.InternalError,
      "No ClickUp workspaces found for this API key."
    );
  }
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
// ClickUp API helpers (composed into tool handlers below)
// ---------------------------------------------------------------------------

async function getSpaces(teamId) {
  const data = await clickupFetch("GET", `/api/v2/team/${teamId}/space`, {
    query: { archived: false },
  });
  return Array.isArray(data?.spaces) ? data.spaces : [];
}

async function getFoldersForSpace(spaceId) {
  const data = await clickupFetch("GET", `/api/v2/space/${spaceId}/folder`, {
    query: { archived: false },
  });
  return Array.isArray(data?.folders) ? data.folders : [];
}

async function getFolderlessLists(spaceId) {
  const data = await clickupFetch("GET", `/api/v2/space/${spaceId}/list`, {
    query: { archived: false },
  });
  return Array.isArray(data?.lists) ? data.lists : [];
}

async function getListsInFolder(folderId) {
  const data = await clickupFetch("GET", `/api/v2/folder/${folderId}/list`, {
    query: { archived: false },
  });
  return Array.isArray(data?.lists) ? data.lists : [];
}

// ---------------------------------------------------------------------------
// Tool definitions
// Each entry: { name, description, inputSchema (zod), handler }
// ---------------------------------------------------------------------------

const tools = [
  // -----------------------------------------------------------------
  // Workspace hierarchy + members
  // -----------------------------------------------------------------
  {
    name: "clickup_get_workspace_hierarchy",
    description:
      "Return the full tree for a ClickUp workspace: team → spaces → folders → lists (plus folderless lists). Uses CLICKUP_TEAM_ID if set, otherwise the first team on the key.",
    inputSchema: z.object({
      team_id: z
        .string()
        .optional()
        .describe("Workspace/team ID. Defaults to CLICKUP_TEAM_ID or the first team on the key."),
    }),
    async handler({ team_id }) {
      const teamId = await resolveTeamId(team_id);
      const teams = await listTeams();
      const team =
        teams.find((t) => String(t.id) === String(teamId)) || { id: teamId, name: null };

      const spaces = await getSpaces(teamId);
      const hierarchy = [];
      for (const space of spaces) {
        const folders = await getFoldersForSpace(space.id);
        const folderlessLists = await getFolderlessLists(space.id);
        const folderEntries = [];
        for (const folder of folders) {
          const lists = Array.isArray(folder.lists) && folder.lists.length
            ? folder.lists
            : await getListsInFolder(folder.id);
          folderEntries.push({
            id: folder.id,
            name: folder.name,
            hidden: folder.hidden ?? false,
            lists: lists.map((l) => ({
              id: l.id,
              name: l.name,
              task_count: l.task_count ?? null,
            })),
          });
        }
        hierarchy.push({
          id: space.id,
          name: space.name,
          private: space.private ?? false,
          folders: folderEntries,
          folderless_lists: folderlessLists.map((l) => ({
            id: l.id,
            name: l.name,
            task_count: l.task_count ?? null,
          })),
        });
      }
      return {
        team: { id: String(team.id), name: team.name ?? null },
        spaces: hierarchy,
      };
    },
  },

  {
    name: "clickup_get_workspace_members",
    description:
      "Return the list of members for a ClickUp workspace. Derived from GET /api/v2/team.",
    inputSchema: z.object({
      team_id: z.string().optional(),
    }),
    async handler({ team_id }) {
      const teamId = await resolveTeamId(team_id);
      const teams = await listTeams();
      const team = teams.find((t) => String(t.id) === String(teamId));
      if (!team) {
        throw new McpError(ErrorCode.InvalidRequest, `Team ${teamId} not found on this API key.`);
      }
      const members = Array.isArray(team.members) ? team.members : [];
      return {
        team_id: String(team.id),
        team_name: team.name ?? null,
        members: members.map((m) => {
          const u = m?.user || {};
          return {
            id: u.id,
            username: u.username ?? null,
            email: u.email ?? null,
            initials: u.initials ?? null,
            color: u.color ?? null,
            profilePicture: u.profilePicture ?? null,
            role: u.role ?? null,
          };
        }),
      };
    },
  },

  {
    name: "clickup_find_member_by_name",
    description:
      "Find a workspace member by case-insensitive substring match on username or email. Returns all matches.",
    inputSchema: z.object({
      query: z.string().min(1, "query is required"),
      team_id: z.string().optional(),
    }),
    async handler({ query, team_id }) {
      const teamId = await resolveTeamId(team_id);
      const teams = await listTeams();
      const team = teams.find((t) => String(t.id) === String(teamId));
      const members = team && Array.isArray(team.members) ? team.members : [];
      const needle = query.trim().toLowerCase();
      const matches = members
        .map((m) => m?.user)
        .filter(Boolean)
        .filter((u) => {
          const uname = (u.username || "").toLowerCase();
          const email = (u.email || "").toLowerCase();
          return uname.includes(needle) || email.includes(needle);
        })
        .map((u) => ({
          id: u.id,
          username: u.username ?? null,
          email: u.email ?? null,
        }));
      return { query, matches };
    },
  },

  {
    name: "clickup_resolve_assignees",
    description:
      "Resolve a list of names/emails/IDs to numeric ClickUp user IDs. Anything already numeric passes through untouched. Unresolved entries are returned under `unresolved`.",
    inputSchema: z.object({
      assignees: z
        .array(z.union([z.string(), z.number()]))
        .min(1, "at least one assignee required"),
      team_id: z.string().optional(),
    }),
    async handler({ assignees, team_id }) {
      const teamId = await resolveTeamId(team_id);
      const teams = await listTeams();
      const team = teams.find((t) => String(t.id) === String(teamId));
      const members = team && Array.isArray(team.members) ? team.members : [];
      const resolved = [];
      const unresolved = [];
      for (const raw of assignees) {
        // Numeric or numeric string → pass through
        if (typeof raw === "number" || /^\d+$/.test(String(raw).trim())) {
          resolved.push(Number(raw));
          continue;
        }
        const needle = String(raw).trim().toLowerCase();
        const user = members
          .map((m) => m?.user)
          .find((u) => {
            if (!u) return false;
            const uname = (u.username || "").toLowerCase();
            const email = (u.email || "").toLowerCase();
            return uname === needle || email === needle;
          });
        if (user && user.id != null) {
          resolved.push(Number(user.id));
        } else {
          // Fuzzy fallback: substring match if unique
          const fuzzy = members
            .map((m) => m?.user)
            .filter(Boolean)
            .filter((u) => {
              const uname = (u.username || "").toLowerCase();
              const email = (u.email || "").toLowerCase();
              return uname.includes(needle) || email.includes(needle);
            });
          if (fuzzy.length === 1) {
            resolved.push(Number(fuzzy[0].id));
          } else {
            unresolved.push(String(raw));
          }
        }
      }
      return { resolved, unresolved };
    },
  },

  // -----------------------------------------------------------------
  // Chat (v3 API)
  // -----------------------------------------------------------------
  {
    name: "clickup_get_chat_channels",
    description:
      "List chat channels (including DMs and group DMs) for the workspace via the v3 chat API.",
    inputSchema: z.object({
      team_id: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
      cursor: z.string().optional().describe("Opaque pagination cursor from a prior response."),
      include_hidden: z.boolean().optional(),
    }),
    async handler({ team_id, limit, cursor, include_hidden }) {
      const teamId = await resolveTeamId(team_id);
      const query = {};
      if (limit !== undefined) query.limit = limit;
      if (cursor) query.cursor = cursor;
      if (include_hidden !== undefined) query.include_hidden = include_hidden;
      const data = await clickupFetch(
        "GET",
        `/api/v3/workspaces/${teamId}/chat/channels`,
        { query }
      );
      return data;
    },
  },

  {
    name: "clickup_get_chat_channel_messages",
    description:
      "List messages from a ClickUp chat channel (v3). Supports `limit` and `cursor` for pagination.",
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
      const data = await clickupFetch(
        "GET",
        `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(channel_id)}/messages`,
        { query }
      );
      return data;
    },
  },

  {
    name: "clickup_get_chat_message_replies",
    description: "Get replies (thread) for a specific chat message (v3).",
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
      const data = await clickupFetch(
        "GET",
        `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(
          channel_id
        )}/messages/${encodeURIComponent(message_id)}/replies`,
        { query }
      );
      return data;
    },
  },

  {
    name: "clickup_send_chat_message",
    description: "Send a message to a ClickUp chat channel (v3).",
    inputSchema: z.object({
      channel_id: z.string().min(1),
      content: z.string().min(1, "content is required"),
      type: z.enum(["message", "comment"]).optional().describe("Defaults to 'message'."),
      team_id: z.string().optional(),
    }),
    async handler({ channel_id, content, type, team_id }) {
      const teamId = await resolveTeamId(team_id);
      const body = {
        type: type || "message",
        content,
      };
      const data = await clickupFetch(
        "POST",
        `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(channel_id)}/messages`,
        { body }
      );
      return data;
    },
  },

  // -----------------------------------------------------------------
  // Tasks
  // -----------------------------------------------------------------
  {
    name: "clickup_filter_tasks",
    description:
      "Filter workspace tasks via GET /team/{team_id}/task. Supports assignees, watchers, date_updated_gt, include_closed, subtasks, and page (0-indexed). All array params are sent as repeated query keys.",
    inputSchema: z.object({
      team_id: z.string().optional(),
      assignees: z.array(z.union([z.string(), z.number()])).optional(),
      watchers: z.array(z.union([z.string(), z.number()])).optional(),
      date_updated_gt: z.number().int().optional().describe("Unix ms timestamp."),
      date_updated_lt: z.number().int().optional(),
      date_created_gt: z.number().int().optional(),
      date_created_lt: z.number().int().optional(),
      include_closed: z.boolean().optional(),
      subtasks: z.boolean().optional(),
      archived: z.boolean().optional(),
      statuses: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      list_ids: z.array(z.union([z.string(), z.number()])).optional(),
      folder_ids: z.array(z.union([z.string(), z.number()])).optional(),
      space_ids: z.array(z.union([z.string(), z.number()])).optional(),
      order_by: z.string().optional(),
      reverse: z.boolean().optional(),
      page: z.number().int().min(0).optional().describe("0-indexed page number."),
    }),
    async handler(args) {
      const teamId = await resolveTeamId(args.team_id);
      const query = {};
      // ClickUp expects bracketed array keys for some filters
      if (args.assignees) query["assignees[]"] = args.assignees;
      if (args.watchers) query["watchers[]"] = args.watchers;
      if (args.statuses) query["statuses[]"] = args.statuses;
      if (args.tags) query["tags[]"] = args.tags;
      if (args.list_ids) query["list_ids[]"] = args.list_ids;
      if (args.folder_ids) query["folder_ids[]"] = args.folder_ids;
      if (args.space_ids) query["space_ids[]"] = args.space_ids;
      if (args.date_updated_gt !== undefined) query.date_updated_gt = args.date_updated_gt;
      if (args.date_updated_lt !== undefined) query.date_updated_lt = args.date_updated_lt;
      if (args.date_created_gt !== undefined) query.date_created_gt = args.date_created_gt;
      if (args.date_created_lt !== undefined) query.date_created_lt = args.date_created_lt;
      if (args.include_closed !== undefined) query.include_closed = args.include_closed;
      if (args.subtasks !== undefined) query.subtasks = args.subtasks;
      if (args.archived !== undefined) query.archived = args.archived;
      if (args.order_by) query.order_by = args.order_by;
      if (args.reverse !== undefined) query.reverse = args.reverse;
      if (args.page !== undefined) query.page = args.page;

      const data = await clickupFetch("GET", `/api/v2/team/${teamId}/task`, { query });
      // Normalize: ClickUp returns { tasks: [...], last_page: bool } sometimes
      return {
        tasks: Array.isArray(data?.tasks) ? data.tasks : [],
        last_page: data?.last_page ?? null,
        page: args.page ?? 0,
      };
    },
  },

  {
    name: "clickup_get_task",
    description: "Get a single task by its ID.",
    inputSchema: z.object({
      task_id: z.string().min(1),
      custom_task_ids: z.boolean().optional(),
      team_id: z.string().optional().describe("Required when custom_task_ids=true."),
      include_subtasks: z.boolean().optional(),
    }),
    async handler({ task_id, custom_task_ids, team_id, include_subtasks }) {
      const query = {};
      if (custom_task_ids) {
        query.custom_task_ids = true;
        query.team_id = team_id || (await resolveTeamId());
      }
      if (include_subtasks !== undefined) query.include_subtasks = include_subtasks;
      const data = await clickupFetch(
        "GET",
        `/api/v2/task/${encodeURIComponent(task_id)}`,
        { query }
      );
      return data;
    },
  },

  {
    name: "clickup_create_task",
    description: "Create a task in a list. Required: list_id, name.",
    inputSchema: z.object({
      list_id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      assignees: z.array(z.number().int()).optional(),
      tags: z.array(z.string()).optional(),
      status: z.string().optional(),
      priority: z.number().int().min(1).max(4).optional(),
      due_date: z.number().int().optional().describe("Unix ms."),
      due_date_time: z.boolean().optional(),
      start_date: z.number().int().optional(),
      start_date_time: z.boolean().optional(),
      notify_all: z.boolean().optional(),
      parent: z.string().optional(),
      links_to: z.string().optional(),
      custom_fields: z
        .array(z.object({ id: z.string(), value: z.any() }))
        .optional(),
    }),
    async handler(args) {
      const { list_id, ...rest } = args;
      const body = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) body[k] = v;
      }
      const data = await clickupFetch(
        "POST",
        `/api/v2/list/${encodeURIComponent(list_id)}/task`,
        { body }
      );
      return data;
    },
  },

  {
    name: "clickup_update_task",
    description: "Update fields on an existing task.",
    inputSchema: z.object({
      task_id: z.string().min(1),
      name: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      priority: z.number().int().min(1).max(4).nullable().optional(),
      due_date: z.number().int().nullable().optional(),
      due_date_time: z.boolean().optional(),
      start_date: z.number().int().nullable().optional(),
      start_date_time: z.boolean().optional(),
      assignees: z
        .object({
          add: z.array(z.number().int()).optional(),
          rem: z.array(z.number().int()).optional(),
        })
        .optional(),
      archived: z.boolean().optional(),
      custom_task_ids: z.boolean().optional(),
      team_id: z.string().optional(),
    }),
    async handler(args) {
      const { task_id, custom_task_ids, team_id, ...rest } = args;
      const query = {};
      if (custom_task_ids) {
        query.custom_task_ids = true;
        query.team_id = team_id || (await resolveTeamId());
      }
      const body = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) body[k] = v;
      }
      const data = await clickupFetch(
        "PUT",
        `/api/v2/task/${encodeURIComponent(task_id)}`,
        { query, body }
      );
      return data;
    },
  },

  // -----------------------------------------------------------------
  // Comments
  // -----------------------------------------------------------------
  {
    name: "clickup_get_task_comments",
    description: "Get comments on a task.",
    inputSchema: z.object({
      task_id: z.string().min(1),
      start: z.number().int().optional().describe("Unix ms of oldest comment to include."),
      start_id: z.string().optional(),
      custom_task_ids: z.boolean().optional(),
      team_id: z.string().optional(),
    }),
    async handler({ task_id, start, start_id, custom_task_ids, team_id }) {
      const query = {};
      if (start !== undefined) query.start = start;
      if (start_id) query.start_id = start_id;
      if (custom_task_ids) {
        query.custom_task_ids = true;
        query.team_id = team_id || (await resolveTeamId());
      }
      const data = await clickupFetch(
        "GET",
        `/api/v2/task/${encodeURIComponent(task_id)}/comment`,
        { query }
      );
      return data;
    },
  },

  {
    name: "clickup_get_threaded_comments",
    description: "Get threaded replies for a comment.",
    inputSchema: z.object({
      comment_id: z.string().min(1),
    }),
    async handler({ comment_id }) {
      const data = await clickupFetch(
        "GET",
        `/api/v2/comment/${encodeURIComponent(comment_id)}/reply`
      );
      return data;
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
    async handler({
      task_id,
      comment_text,
      assignee,
      notify_all,
      custom_task_ids,
      team_id,
    }) {
      const query = {};
      if (custom_task_ids) {
        query.custom_task_ids = true;
        query.team_id = team_id || (await resolveTeamId());
      }
      const body = { comment_text };
      if (assignee !== undefined) body.assignee = assignee;
      if (notify_all !== undefined) body.notify_all = notify_all;
      const data = await clickupFetch(
        "POST",
        `/api/v2/task/${encodeURIComponent(task_id)}/comment`,
        { query, body }
      );
      return data;
    },
  },

  // -----------------------------------------------------------------
  // Reminders
  // -----------------------------------------------------------------
  {
    name: "clickup_search_reminders",
    description:
      "List reminders for the workspace. Wraps GET /team/{team_id}/reminder. ClickUp returns all reminders on the key; filter client-side as needed.",
    inputSchema: z.object({
      team_id: z.string().optional(),
      include_done: z.boolean().optional(),
    }),
    async handler({ team_id, include_done }) {
      const teamId = await resolveTeamId(team_id);
      const query = {};
      if (include_done !== undefined) query.include_done = include_done;
      const data = await clickupFetch("GET", `/api/v2/team/${teamId}/reminder`, { query });
      return data;
    },
  },

  // -----------------------------------------------------------------
  // Lists
  // -----------------------------------------------------------------
  {
    name: "clickup_create_list",
    description:
      "Create a list. Provide EITHER folder_id OR space_id (folderless). Required: name.",
    inputSchema: z
      .object({
        name: z.string().min(1),
        folder_id: z.string().optional(),
        space_id: z.string().optional(),
        content: z.string().optional(),
        due_date: z.number().int().optional(),
        due_date_time: z.boolean().optional(),
        priority: z.number().int().min(1).max(4).optional(),
        assignee: z.number().int().optional(),
        status: z.string().optional(),
      })
      .refine((v) => !!v.folder_id !== !!v.space_id, {
        message: "Provide exactly one of folder_id or space_id.",
      }),
    async handler(args) {
      const { folder_id, space_id, ...rest } = args;
      const body = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) body[k] = v;
      }
      const path = folder_id
        ? `/api/v2/folder/${encodeURIComponent(folder_id)}/list`
        : `/api/v2/space/${encodeURIComponent(space_id)}/list`;
      const data = await clickupFetch("POST", path, { body });
      return data;
    },
  },
];

// ---------------------------------------------------------------------------
// Zod → JSON Schema (minimal — enough for the MCP `inputSchema` field)
// We avoid an extra dep (zod-to-json-schema) with a compact converter.
// ---------------------------------------------------------------------------

function zodToJsonSchema(schema) {
  const def = schema?._def;
  if (!def) return { type: "object" };
  switch (def.typeName) {
    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const properties = {};
      const required = [];
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
    case "ZodBoolean":
      return {
        type: "boolean",
        ...(schema.description ? { description: schema.description } : {}),
      };
    case "ZodArray": {
      const out = { type: "array", items: zodToJsonSchema(def.type) };
      if (schema.description) out.description = schema.description;
      return out;
    }
    case "ZodEnum":
      return {
        type: "string",
        enum: def.values,
        ...(schema.description ? { description: schema.description } : {}),
      };
    case "ZodLiteral":
      return { const: def.value };
    case "ZodUnion": {
      const options = def.options.map((o) => zodToJsonSchema(o));
      return { anyOf: options };
    }
    case "ZodOptional":
      return zodToJsonSchema(def.innerType);
    case "ZodNullable": {
      const inner = zodToJsonSchema(def.innerType);
      if (inner.type) {
        return { ...inner, type: [inner.type, "null"] };
      }
      return { anyOf: [inner, { type: "null" }] };
    }
    case "ZodDefault":
      return { ...zodToJsonSchema(def.innerType), default: def.defaultValue() };
    case "ZodEffects":
      // e.g. .refine() — just unwrap
      return zodToJsonSchema(def.schema);
    case "ZodAny":
    case "ZodUnknown":
      return {};
    default:
      return {};
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
  {
    name: "pickle-clickup-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const toolByName = new Map(tools.map((t) => [t.name, t]));

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const tool = toolByName.get(name);
  if (!tool) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  let args;
  try {
    args = tool.inputSchema.parse(rawArgs ?? {});
  } catch (err) {
    const message =
      err?.issues?.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ") ||
      (err && err.message) ||
      String(err);
    throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for ${name}: ${message}`);
  }

  let result;
  try {
    result = await tool.handler(args);
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(
      ErrorCode.InternalError,
      `Tool ${name} failed: ${err && err.message ? err.message : String(err)}`
    );
  }

  // MCP content must be an array of content blocks. We return structured JSON
  // as a single text block (compact, not pretty-printed) so downstream LLMs
  // can parse it and token usage stays low.
  return {
    content: [
      {
        type: "text",
        text: typeof result === "string" ? result : JSON.stringify(result),
      },
    ],
  };
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Don't log to stdout — stdio is the MCP transport. stderr is fine.
  process.stderr.write(
    "[pickle-clickup-mcp] ready — " + tools.length + " tools registered\n"
  );
}

main().catch((err) => {
  process.stderr.write(
    `[pickle-clickup-mcp] FATAL on boot: ${err && err.stack ? err.stack : String(err)}\n`
  );
  process.exit(1);
});
