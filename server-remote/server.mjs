#!/usr/bin/env node
/**
 * @pickle/mcp  v1.0.0
 *
 * Hosted MCP server for Pickle — stateless, privacy-first.
 * Tokens arrive per-request in headers. Nothing is stored. Nothing is logged.
 *
 * Port: 3055 (override with PORT env var)
 *
 * Endpoints:
 *   POST /mcp       — MCP StreamableHTTP (primary)
 *   GET  /mcp       — SSE fallback (legacy clients)
 *   GET  /health    — { status: "ok", version: "1.0.0" }
 *   GET  /          — Landing page (static from ./public/)
 *
 * Request headers expected:
 *   x-clickup-token   — ClickUp personal API token (pk_...)
 *
 * Zero telemetry. Only talks to https://api.clickup.com.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import https from "node:https";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT         = Number(process.env.PORT ?? 3055);
const API_BASE     = "https://api.clickup.com";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES  = 5;
const USER_AGENT   = "pickle-mcp-remote/3.0 (+https://pickle.adityaarsharma.com)";
const CACHE_TTL_MS = 3_600_000; // 1 hour — workspace/team data per user token
const VERSION      = "1.0.0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR   = path.join(__dirname, "data");
const USAGE_FILE   = path.join(DATA_DIR, "usage.json");

// Ensure data dir exists
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

// Marketing/admin config — set via env vars on the server

// ---------------------------------------------------------------------------
// SSRF protection — whitelist of allowed outbound hosts
// ---------------------------------------------------------------------------

const ALLOWED_HOSTS = new Set([
  "api.clickup.com",
  "slack.com",                   // Slack Web API base
  "graph.microsoft.com",          // Microsoft Graph (Teams + Planner)
  "login.microsoftonline.com",    // Microsoft OAuth (if needed for refresh)
]);

function assertSafeHost(urlStr) {
  let hostname;
  try { hostname = new URL(urlStr).hostname; } catch {
    throw new McpError(ErrorCode.InvalidRequest, "Invalid API URL");
  }
  if (!ALLOWED_HOSTS.has(hostname)) {
    throw new McpError(ErrorCode.InvalidRequest, `Blocked request to disallowed host: ${hostname}`);
  }
}

// ---------------------------------------------------------------------------
// License gate
// Pro key format:  anything Polar.sh issues (validated server-side later)
// For now: any non-empty key >= 8 chars is accepted.
// ---------------------------------------------------------------------------

// Local build: usage/install tracking is intentionally a no-op (no telemetry).
function trackAudit() {}
function trackInstallFingerprint() {}
function trackPlatformsSeen() {}

function validateLicenseKey(key) {
  return typeof key === "string" && key.trim().length >= 8;
}

// ---------------------------------------------------------------------------
// Local build: no freemium cap — any window works.
// ---------------------------------------------------------------------------

const FREE_TIER_MAX_WINDOW_MS = 3650 * 24 * 60 * 60 * 1000; // effectively unlimited (local)
const PRO_COMING_SOON_NOTE = null;

// Parse a window string like "1h", "6h", "1d", "3d", "7d" into milliseconds.
// Returns { ms, clamped, original } so callers can surface a note when clamped.
function parseTimeWindow(input) {
  if (input === undefined || input === null || input === "") {
    return { ms: FREE_TIER_MAX_WINDOW_MS, clamped: false, original: "7d" };
  }
  const m = String(input).trim().toLowerCase().match(/^(\d+)\s*([hd])$/);
  if (!m) {
    return { ms: FREE_TIER_MAX_WINDOW_MS, clamped: true, original: String(input) };
  }
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === "h" ? n * 60 * 60 * 1000 : n * 24 * 60 * 60 * 1000;
  if (ms > FREE_TIER_MAX_WINDOW_MS) {
    return { ms: FREE_TIER_MAX_WINDOW_MS, clamped: true, original: String(input) };
  }
  return { ms, clamped: false, original: String(input) };
}

// Apply window to ClickUp date filter args: clamps date_updated_gt /
// date_created_gt to "now - window" if they're absent OR set further back.
// Returns the adjusted args and a note if clamped.
function applyWindowCap(args, kind = "updated") {
  const tw = parseTimeWindow(args.time_window);
  const floor = Date.now() - tw.ms;
  const key = kind === "created" ? "date_created_gt" : "date_updated_gt";
  const existing = typeof args[key] === "number" ? args[key] : 0;
  const finalFloor = Math.max(existing, floor);
  return {
    args: { ...args, [key]: finalFloor },
    clamped: tw.clamped,
    window_used: tw.original === "7d" && !args.time_window ? "7d (default)" : tw.original,
    pro_note: tw.clamped ? PRO_COMING_SOON_NOTE : null,
  };
}

// ---------------------------------------------------------------------------
// Multi-tenant in-memory cache (process-level, keyed by SHA-256 of token)
// Stores workspace/team resolution so we don't re-fetch on every tool call
// within the same server request.
// ---------------------------------------------------------------------------

const _userCache = new Map();

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function getCached(tokenHash, field) {
  const entry = _userCache.get(tokenHash);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _userCache.delete(tokenHash); return undefined; }
  return entry[field];
}

function setCached(tokenHash, field, value) {
  const existing = _userCache.get(tokenHash) ?? { ts: Date.now() };
  existing[field] = value;
  existing.ts = Date.now();
  _userCache.set(tokenHash, existing);
}

// Prune stale cache entries every 5 minutes to avoid unbounded growth
setInterval(() => {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [k, v] of _userCache) if (v.ts < cutoff) _userCache.delete(k);
}, 300_000).unref();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function backoffMs(n) { return 500 * Math.pow(2, n) + Math.floor(Math.random() * 250); }
async function safeReadText(res) { try { return await res.text(); } catch { return ""; } }

function buildUrl(base, pathStr, query) {
  const url = new URL(pathStr, base);
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) { if (v != null) url.searchParams.append(key, String(v)); }
      } else if (typeof value === "boolean") {
        url.searchParams.append(key, value ? "true" : "false");
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Zod → JSON Schema (compact, no extra dep — identical to server.mjs)
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
// MCP server factory — creates a new server instance per request
// Captures the ClickUp token via closure; uses per-user cache for team data.
// ---------------------------------------------------------------------------

const TOOL_COUNT = 40; // Updated at runtime in startupLog

function createPickleServer(ctxOrLegacyToken, legacyPickleKey = "") {
  // Backwards-compat: old call sites passed (clickupToken, pickleKey).
  // New call sites pass a ctx object: { pickleKey, clickupToken, slackToken, teamsToken }.
  const ctx = (typeof ctxOrLegacyToken === "object" && ctxOrLegacyToken !== null)
    ? ctxOrLegacyToken
    : { clickupToken: String(ctxOrLegacyToken || ""), pickleKey: legacyPickleKey, slackToken: "", teamsToken: "" };
  const { clickupToken = "", slackToken = "", teamsToken = "", pickleKey = "" } = ctx;
  // clickupToken may be empty when user is setting up — that's allowed for setup-only flow.
  const tokenHash = clickupToken ? hashToken(clickupToken) : null;

  // ── Per-user ClickUp HTTP client ─────────────────────────────────────────
  async function clickupFetch(method, pathStr, { query, body } = {}) {
    if (!clickupToken) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `ClickUp isn't connected for this Pickle key yet. ${(() => {
          const connected = [];
          if (slackToken) connected.push("Slack");
          if (teamsToken) connected.push("Microsoft Teams");
          if (!connected.length) return "Run `pickle_setup` with platform=\"clickup\" to connect.";
          return `You currently have ${connected.join(" and ")} connected. Either audit there instead, or run \`pickle_setup\` with platform="clickup" to connect ClickUp.`;
        })()}`
      );
    }
    const url = buildUrl(API_BASE, pathStr, query);
    assertSafeHost(url);

    const headers = {
      Authorization: clickupToken,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const th = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(url, {
          method, headers,
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

      const isIdempotent = method === "GET" || method === "HEAD";
      if (res.status >= 500 && isIdempotent && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt)); continue;
      }

      const errorBody = await safeReadText(res);
      throw new McpError(ErrorCode.InternalError,
        `ClickUp API ${method} ${pathStr} → HTTP ${res.status} ${res.statusText}: ${errorBody || "(no body)"}`);
    }
    throw new McpError(ErrorCode.InternalError,
      `ClickUp request exhausted retries: ${lastErr?.message ?? "unknown"}`);
  }

  // ── Per-user team resolution (cached) ───────────────────────────────────
  async function listTeams() {
    const cached = getCached(tokenHash, "teams");
    if (cached) return cached;
    const data = await clickupFetch("GET", "/api/v2/team");
    const teams = Array.isArray(data?.teams) ? data.teams : [];
    setCached(tokenHash, "teams", teams);
    return teams;
  }

  async function resolveTeamId(override) {
    if (override) return String(override);
    const cached = getCached(tokenHash, "teamId");
    if (cached) return cached;
    const teams = await listTeams();
    if (!teams.length) throw new McpError(ErrorCode.InternalError, "No ClickUp workspaces found for this token.");
    const teamId = String(teams[0].id);
    setCached(tokenHash, "teamId", teamId);
    return teamId;
  }

  // ── Hierarchy helpers ────────────────────────────────────────────────────
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

  // Helper: tell the user what they DO have connected when they ask for
  // something they don't. Surfaces a smart "I see you have X — want X instead?"
  function connectedPlatformsHint(missing) {
    const connected = [];
    if (clickupToken && missing !== "clickup") connected.push("ClickUp");
    if (slackToken   && missing !== "slack")   connected.push("Slack");
    if (teamsToken   && missing !== "teams")   connected.push("Microsoft Teams");
    if (!connected.length) {
      return `Run \`pickle_setup\` with platform="${missing}" to connect.`;
    }
    return `You currently have ${connected.join(" and ")} connected. Either audit there instead, or run \`pickle_setup\` with platform="${missing}" to connect ${missing}.`;
  }

  // ── Per-user Slack HTTP client ────────────────────────────────────────────
  // Generic, used by every Slack tool below. SSRF-guarded to slack.com only.
  async function slackFetch(method, pathStr, { query, body } = {}) {
    if (!slackToken) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Slack isn't connected for this Pickle key yet. ${connectedPlatformsHint("slack")}`
      );
    }
    const url = buildUrl("https://slack.com", pathStr, query);
    assertSafeHost(url);

    const headers = {
      Authorization: `Bearer ${slackToken.replace(/^Bearer\s+/i, "")}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";

    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const th = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(url, {
          method, headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(th);
        lastErr = err;
        if (attempt < MAX_RETRIES) { await sleep(backoffMs(attempt)); continue; }
        throw new McpError(ErrorCode.InternalError,
          `Slack request failed after ${MAX_RETRIES + 1} attempts: ${err?.message ?? err}`);
      }
      clearTimeout(th);

      // Slack returns 200 with { ok: false, error: "..." } on app-level errors.
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const ra = res.headers.get("retry-after");
        const wait = ra ? Math.max(0, Number(ra) * 1000) : backoffMs(attempt);
        await sleep(Math.min(wait || backoffMs(attempt), 60_000));
        continue;
      }
      if (res.status >= 500 && (method === "GET" || method === "HEAD") && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
      if (!res.ok) {
        throw new McpError(ErrorCode.InternalError,
          `Slack API ${method} ${pathStr} → HTTP ${res.status} ${res.statusText}: ${text || "(no body)"}`);
      }
      if (json && json.ok === false) {
        throw new McpError(ErrorCode.InternalError,
          `Slack API error: ${json.error || "unknown_error"}${json.needed ? ` (needs scope: ${json.needed})` : ""}`);
      }
      return json;
    }
    throw new McpError(ErrorCode.InternalError,
      `Slack request exhausted retries: ${lastErr?.message ?? "unknown"}`);
  }

  // ── Per-user Microsoft Graph (Teams) HTTP client ──────────────────────────
  async function graphFetch(method, pathStr, { query, body } = {}) {
    if (!teamsToken) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Microsoft Teams isn't connected for this Pickle key yet. ${connectedPlatformsHint("teams")}`
      );
    }
    const url = buildUrl("https://graph.microsoft.com", pathStr, query);
    assertSafeHost(url);

    const cleanToken = teamsToken.replace(/^Bearer\s+/i, "");
    const headers = {
      Authorization: `Bearer ${cleanToken}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const th = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(url, {
          method, headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(th);
        lastErr = err;
        if (attempt < MAX_RETRIES) { await sleep(backoffMs(attempt)); continue; }
        throw new McpError(ErrorCode.InternalError,
          `Microsoft Graph request failed after ${MAX_RETRIES + 1} attempts: ${err?.message ?? err}`);
      }
      clearTimeout(th);

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const ra = res.headers.get("retry-after");
        const wait = ra ? Math.max(0, Number(ra) * 1000) : backoffMs(attempt);
        await sleep(Math.min(wait || backoffMs(attempt), 60_000));
        continue;
      }
      if (res.status >= 500 && (method === "GET" || method === "HEAD") && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      if (res.ok) {
        if (res.status === 204) return { ok: true, status: 204 };
        const text = await res.text();
        if (!text) return { ok: true, status: res.status };
        try { return JSON.parse(text); } catch { return { ok: true, status: res.status, raw: text }; }
      }
      const errorBody = await safeReadText(res);
      throw new McpError(ErrorCode.InternalError,
        `Microsoft Graph ${method} ${pathStr} → HTTP ${res.status} ${res.statusText}: ${errorBody || "(no body)"}`);
    }
    throw new McpError(ErrorCode.InternalError,
      `Microsoft Graph request exhausted retries: ${lastErr?.message ?? "unknown"}`);
  }

  // =========================================================================
  // TOOLS — identical feature set to local server.mjs
  // =========================================================================

  const tools = [

    // ── SETUP (called first by AI hosts on a new install) ─────────────────
    {
      name: "pickle_setup",
      description: "FIRST-RUN SETUP for Pickle. Call this tool IMMEDIATELY whenever the user says any of: \"Pickle Start\" / \"Pickle start\" / \"Pickle set me up\" / \"setup Pickle\" / \"set up Pickle\" / \"connect Pickle\" / \"how do I get started with Pickle\" / \"Pickle set me up for ClickUp|Slack|Teams\". It returns step-by-step instructions for getting the right token(s) for ClickUp, Slack, or Microsoft Teams — and a checklist for adding them to the user's MCP config. No external skills, no shell scripts required. Always call this tool as the very first action whenever the user is onboarding to Pickle.",
      inputSchema: z.object({
        platform: z.enum(["clickup", "slack", "teams", "all"]).optional()
          .describe("Which platform the user wants to connect first. Defaults to 'all' (returns the full setup guide for ClickUp + Slack + Teams)."),
      }),
      async handler({ platform }) {
        const target = platform || "all";

        const clickupGuide = [
          "## Connect ClickUp (≈ 30 seconds)",
          "1. Open https://app.clickup.com → click your avatar → **Settings** → **Apps**",
          "2. Under **ClickUp API**, click **Generate** — copy the `pk_…` token",
          "3. In your assistant's MCP config (`~/.claude.json`, Cursor MCP settings, etc.), set the header:",
          "   `\"x-clickup-token\": \"pk_YOUR_TOKEN\"`",
          "4. Restart your assistant — Pickle's 40 ClickUp tools appear automatically",
          "",
          "✓ Token is used per-request, never stored on the Pickle server.",
        ].join("\n");

        const slackGuide = [
          "## Connect Slack (≈ 2 minutes)",
          "1. Open https://api.slack.com/apps → **Create New App** → **From scratch**",
          "2. Name it 'Pickle' (or whatever) → pick your workspace",
          "3. **OAuth & Permissions** → User Token Scopes → add: `channels:history`, `groups:history`, `im:history`, `mpim:history`, `users:read`, `chat:write`",
          "4. **Install to Workspace** → copy the **User OAuth Token** (`xoxp-…`)",
          "5. Add header to your MCP config: `\"x-slack-token\": \"xoxp-YOUR_TOKEN\"`",
          "6. Restart your assistant",
          "",
          "Slack audit patterns (ghost mode, DM-only completion, decisions-in-DM) need a Slack token connected — they read chat data. Everything is free and local.",
        ].join("\n");

        const teamsGuide = [
          "## Connect Microsoft Teams (≈ 5 minutes, persistent)",
          "Quick test (1-hour token, no Azure app):",
          "1. Open https://developer.microsoft.com/graph/graph-explorer → sign in with your Teams account",
          "2. DevTools → Network → copy the `Authorization: Bearer …` value",
          "3. Add header: `\"x-teams-token\": \"Bearer YOUR_TOKEN\"`",
          "",
          "Persistent setup (one-time):",
          "1. https://portal.azure.com → **App registrations** → **New registration** → 'Pickle CLI', Personal Microsoft accounts",
          "2. **API permissions** → Add → Microsoft Graph (Delegated): `Chat.Read`, `ChannelMessage.Read.All`, `Team.ReadBasic.All`, `User.Read`, `Tasks.ReadWrite`, `offline_access`",
          "3. Complete the device-flow sign-in when Pickle prompts",
          "",
          "Microsoft Teams audit patterns (cross-tool catches, decisions-in-DM, manager bottleneck) need a Teams token connected — they read chat data. Everything is free and local.",
        ].join("\n");

        // Current install status — based on which platform tokens are in
        // this MCP request's headers. Lets pickle_setup be re-entrant:
        // first call gives the full guide, re-calls show status + remaining work.
        const status = {
          clickup: !!clickupToken,
          slack:   !!slackToken,
          teams:   !!teamsToken,
        };
        const connectedCount = Object.values(status).filter(Boolean).length;
        const statusLines = [
          `${status.clickup ? "✓ ClickUp connected" : "✗ ClickUp not yet"}`,
          `${status.slack   ? "✓ Slack connected"   : "✗ Slack not yet"}`,
          `${status.teams   ? "✓ Microsoft Teams connected" : "✗ Microsoft Teams not yet"}`,
        ].join("\n");

        const intro = [
          "# Pickle setup 🥒",
          "",
          "Pickle audits your ClickUp workspace for patterns no native tool surfaces — stale tasks, broken promises, empty descriptions, zombie tasks, standup copy-paste, and more. Cross-tool catches (ghost mode, DM-only completion, decisions-in-DM, manager bottleneck) also work once a Slack/Teams token is connected.",
          "",
          "Free and open source. No paid tier, no account, no telemetry.",
          "",
          "---",
          "",
          "## Your current connection status",
          statusLines,
          "",
          connectedCount === 0
            ? "Looks like this is your first time. Pick a platform below to connect."
            : connectedCount === 3
              ? "All three platforms are connected. You're ready: try \"Pickle, audit my ClickUp from last 24 hours\"."
              : `${connectedCount} of 3 platforms connected. Run audits on what's connected, or set up the rest below.`,
          "",
          "---",
          "",
        ].join("\n");

        const blocks = [];
        if (target === "clickup" || target === "all") blocks.push(clickupGuide);
        if (target === "slack"   || target === "all") blocks.push(slackGuide);
        if (target === "teams"   || target === "all") blocks.push(teamsGuide);

        const outro = [
          "",
          "---",
          "",
          "## After you've added at least one token",
          "Just ask me: **\"What in my workspace needs attention today?\"**",
          "",
          "Pickle will scan whichever platform(s) you've connected and return a ranked morning brief.",
          "",
          "**Privacy:** every token travels in the HTTPS header per request. Pickle uses it to call the corresponding API on your behalf, then discards it. No tokens stored, no task data logged, no chat content kept.",
          "",
          "**Help:** anything broken? Email pickle@adityaarsharma.com — that's the founder.",
        ].join("\n");

        return intro + blocks.join("\n\n---\n\n") + outro;
      },
    },

    // ── WORKSPACE / MEMBERS ────────────────────────────────────────────────

    {
      name: "clickup_get_workspace_hierarchy",
      description: "Return the full tree: team → spaces → folders → lists (plus folderless lists).",
      inputSchema: z.object({ team_id: z.string().optional() }),
      async handler({ team_id }) {
        const teamId = await resolveTeamId(team_id);
        const teams  = await listTeams();
        const team   = teams.find((t) => String(t.id) === String(teamId)) || { id: teamId, name: null };
        const spaces = await getSpaces(teamId);
        const perSpace = await Promise.all(spaces.map(async (space) => {
          const [folders, folderlessLists] = await Promise.all([
            getFoldersForSpace(space.id),
            getFolderlessLists(space.id),
          ]);
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
      inputSchema: z.object({ query: z.string().min(1), team_id: z.string().optional() }),
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

    // ── SPACES ─────────────────────────────────────────────────────────────

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

    // ── LISTS ──────────────────────────────────────────────────────────────

    {
      name: "clickup_get_lists_in_folder",
      description: "Get all lists inside a folder.",
      inputSchema: z.object({ folder_id: z.string().min(1), archived: z.boolean().optional() }),
      async handler({ folder_id, archived }) {
        return clickupFetch("GET", `/api/v2/folder/${encodeURIComponent(folder_id)}/list`,
          { query: { archived: archived ?? false } });
      },
    },

    {
      name: "clickup_get_folderless_lists",
      description: "Get all folderless (space-level) lists inside a space.",
      inputSchema: z.object({ space_id: z.string().min(1), archived: z.boolean().optional() }),
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
        const p = folder_id
          ? `/api/v2/folder/${encodeURIComponent(folder_id)}/list`
          : `/api/v2/space/${encodeURIComponent(space_id)}/list`;
        return clickupFetch("POST", p, { body });
      },
    },

    {
      name: "clickup_get_list_tasks",
      description: "Get tasks in a specific list, scoped to the audit time window (default last 7 days; pass any window). Supports pagination, filters, custom fields. Use the `time_window` parameter ('1h'|'6h'|'1d'|'3d'|'7d') to scope the audit.",
      inputSchema: z.object({
        list_id: z.string().min(1),
        time_window: z.string().optional().describe("Audit window: '1h', '6h', '1d', '3d', or '7d' (default). Free tier caps at 7d."),
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
      async handler({ list_id, ...rawArgs }) {
        const capped = applyWindowCap(rawArgs, "updated");
        const args = capped.args;
        trackAudit(pickleKey, "clickup_get_list_tasks", capped.window_used);
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
        const result = await clickupFetch("GET", `/api/v2/list/${encodeURIComponent(list_id)}/task`, { query });
        return {
          ...result,
          _audit: { window_used: capped.window_used, pro_note: capped.pro_note },
        };
      },
    },

    // ── CUSTOM FIELDS ──────────────────────────────────────────────────────

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
      description: "Set (or update) a custom field value on a task.",
      inputSchema: z.object({
        task_id: z.string().min(1),
        field_id: z.string().min(1),
        value: z.any().describe("Value shape depends on custom field type."),
        value_options: z.record(z.any()).optional(),
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

    // ── CHAT (v3) ─────────────────────────────────────────────────────────

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
      inputSchema: z.object({ channel_id: z.string().min(1), team_id: z.string().optional() }),
      async handler({ channel_id, team_id }) {
        const teamId = await resolveTeamId(team_id);
        return clickupFetch("GET", `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(channel_id)}`);
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
          `/api/v3/workspaces/${teamId}/chat/channels/${encodeURIComponent(channel_id)}/messages`, { query });
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

    // ── TASKS ──────────────────────────────────────────────────────────────

    {
      name: "clickup_filter_tasks",
      description: "Filter workspace tasks for audits. Scoped to the audit time window (default last 7 days; pass any window). Pass `time_window` ('1h'|'6h'|'1d'|'3d'|'7d') to scope the audit. Supports assignees, watchers, dates, search text, statuses, tags, list/folder/space filters, and pagination. Use response_format='summary' (default) for compact results.",
      inputSchema: z.object({
        team_id: z.string().optional(),
        time_window: z.string().optional().describe("Audit window: '1h', '6h', '1d', '3d', or '7d' (default). Free tier caps at 7d."),
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
        response_format: z.enum(["summary", "full"]).default("summary"),
      }),
      async handler(rawArgs) {
        const capped = applyWindowCap(rawArgs, "updated");
        const args = capped.args;
        trackAudit(pickleKey, "clickup_filter_tasks", capped.window_used);
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
        return {
          tasks,
          last_page: data?.last_page ?? null,
          page: args.page ?? 0,
          format,
          _audit: { window_used: capped.window_used, pro_note: capped.pro_note },
        };
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

    // ── WATCHERS ───────────────────────────────────────────────────────────

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

    // ── COMMENTS ───────────────────────────────────────────────────────────

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

    // ── DOCS (v3) ──────────────────────────────────────────────────────────

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
        if (search)               query.search      = search;
        if (creator)              query.creator     = creator;
        if (deleted !== undefined) query.deleted    = deleted;
        if (archived !== undefined) query.archived  = archived;
        if (limit)                query.limit       = limit;
        if (next_cursor)          query.next_cursor = next_cursor;
        return clickupFetch("GET", `/api/v3/workspaces/${teamId}/docs`, { query });
      },
    },

    {
      name: "clickup_get_doc",
      description: "Get a single Doc by ID.",
      inputSchema: z.object({ doc_id: z.string().min(1), team_id: z.string().optional() }),
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
        content: z.string().optional().describe("Page body content (markdown or HTML)."),
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

    // ── REMINDERS ──────────────────────────────────────────────────────────

    {
      name: "clickup_search_reminders",
      description: "List reminders for a user or the whole workspace. Requires ClickUp Business plan or above.",
      inputSchema: z.object({
        team_id: z.string().optional(),
        assignee: z.number().int().optional().describe("Filter by assignee user ID."),
        include_done: z.boolean().optional(),
        due_date_gt: z.number().int().optional().describe("Unix ms — reminders due after this."),
        due_date_lt: z.number().int().optional(),
      }),
      async handler({ team_id, assignee, include_done, due_date_gt, due_date_lt }) {
        const teamId = await resolveTeamId(team_id);
        const query = { team_id: teamId };
        if (assignee !== undefined) query.user_id = assignee;
        if (include_done !== undefined) query.include_done = include_done;
        if (due_date_gt !== undefined) query.due_date_gt = due_date_gt;
        if (due_date_lt !== undefined) query.due_date_lt = due_date_lt;
        return clickupFetch("GET", `/api/v2/reminder`, { query });
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
        const body = { name, assignee, due_date, team_id: teamId };
        if (due_date_time !== undefined) body.due_date_time = due_date_time;
        if (notify_all !== undefined) body.notify_all = notify_all;
        return clickupFetch("POST", `/api/v2/reminder`, { body });
      },
    },

    // =========================================================================
    // SLACK — read-only audit tools (requires x-slack-token header)
    // =========================================================================

    {
      name: "slack_list_channels",
      description: "List Slack public + private channels the authenticated user can see. Lightweight metadata only (id, name, is_private, num_members, topic). Useful for picking which channel to audit.",
      inputSchema: z.object({
        types: z.string().optional().describe("Comma-separated channel types. Default: 'public_channel,private_channel'."),
        exclude_archived: z.boolean().optional().default(true),
        limit: z.number().int().min(1).max(1000).optional().default(200),
        cursor: z.string().optional(),
      }),
      async handler(args) {
        const query = {
          types: args.types || "public_channel,private_channel",
          exclude_archived: args.exclude_archived !== false,
          limit: args.limit || 200,
        };
        if (args.cursor) query.cursor = args.cursor;
        const r = await slackFetch("GET", "/api/conversations.list", { query });
        const channels = (r.channels || []).map((c) => ({
          id: c.id, name: c.name, is_private: !!c.is_private,
          num_members: c.num_members ?? null,
          topic: c.topic?.value || null, purpose: c.purpose?.value || null,
          is_archived: !!c.is_archived,
        }));
        return { channels, response_metadata: r.response_metadata || null };
      },
    },

    {
      name: "slack_get_channel_history",
      description: "Get messages from a Slack channel scoped to the audit time window (default last 7 days; pass any window). Returns ts, user, text, reply_count, reactions. Pass `time_window` ('1h'|'6h'|'1d'|'3d'|'7d').",
      inputSchema: z.object({
        channel: z.string().min(1).describe("Channel ID (e.g. 'C0123ABCDEF'). Use slack_list_channels to find it."),
        time_window: z.string().optional().describe("Audit window: '1h', '6h', '1d', '3d', or '7d' (default). Free tier caps at 7d."),
        limit: z.number().int().min(1).max(1000).optional().default(200),
        cursor: z.string().optional(),
        inclusive: z.boolean().optional().default(true),
      }),
      async handler(rawArgs) {
        const tw = parseTimeWindow(rawArgs.time_window);
        const oldest = (Date.now() - tw.ms) / 1000; // Slack uses Unix seconds
        trackAudit(pickleKey, "slack_get_channel_history", tw.original);
        const query = {
          channel: rawArgs.channel,
          oldest: String(oldest),
          limit: rawArgs.limit || 200,
          inclusive: rawArgs.inclusive !== false,
        };
        if (rawArgs.cursor) query.cursor = rawArgs.cursor;
        const r = await slackFetch("GET", "/api/conversations.history", { query });
        const messages = (r.messages || []).map((m) => ({
          ts: m.ts, user: m.user || m.bot_id || null,
          text: m.text || "", thread_ts: m.thread_ts || null,
          reply_count: m.reply_count ?? 0,
          reactions: (m.reactions || []).map((r) => ({ name: r.name, count: r.count })),
          subtype: m.subtype || null,
        }));
        return {
          messages,
          has_more: !!r.has_more,
          response_metadata: r.response_metadata || null,
          _audit: { window_used: tw.original, pro_note: tw.clamped ? PRO_COMING_SOON_NOTE : null },
        };
      },
    },

    {
      name: "slack_list_dms",
      description: "List the authenticated user's open direct messages (1:1 and group DMs / 'mpim'). Returns id, type, user(s), last activity. Use slack_get_channel_history with the DM id to read messages.",
      inputSchema: z.object({
        types: z.string().optional().describe("Default 'im,mpim' (1:1 and group DMs)."),
        limit: z.number().int().min(1).max(1000).optional().default(200),
        cursor: z.string().optional(),
      }),
      async handler(args) {
        const query = {
          types: args.types || "im,mpim",
          limit: args.limit || 200,
        };
        if (args.cursor) query.cursor = args.cursor;
        const r = await slackFetch("GET", "/api/conversations.list", { query });
        const dms = (r.channels || []).map((c) => ({
          id: c.id,
          type: c.is_im ? "im" : (c.is_mpim ? "mpim" : "other"),
          user: c.user || null,
          is_user_deleted: !!c.is_user_deleted,
          updated: c.updated || null,
        }));
        return { dms, response_metadata: r.response_metadata || null };
      },
    },

    {
      name: "slack_list_users",
      description: "List active members of the Slack workspace. Returns id, name, real_name, email, is_bot, is_deleted. Useful for resolving user IDs in messages to readable names during audits.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(1000).optional().default(200),
        cursor: z.string().optional(),
        include_locale: z.boolean().optional().default(false),
      }),
      async handler(args) {
        const query = { limit: args.limit || 200, include_locale: args.include_locale === true };
        if (args.cursor) query.cursor = args.cursor;
        const r = await slackFetch("GET", "/api/users.list", { query });
        const members = (r.members || []).filter((u) => !u.deleted).map((u) => ({
          id: u.id, name: u.name, real_name: u.real_name || u.profile?.real_name || null,
          email: u.profile?.email || null,
          is_bot: !!u.is_bot, is_admin: !!u.is_admin, is_owner: !!u.is_owner,
          tz: u.tz || null,
        }));
        return { members, response_metadata: r.response_metadata || null };
      },
    },

    {
      name: "slack_search_messages",
      description: "Full-text search Slack messages (user token only, search:read scope required). Returns ranked matches with channel, user, ts, text. Useful for audits like 'find every message containing shipping today' or '@mention X without follow-up'.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Slack search query. Supports operators like `in:#channel`, `from:@user`, `before:2026-05-10`."),
        time_window: z.string().optional().describe("Audit window appended as `after:<date>` if not already in query. Free tier caps at 7d."),
        count: z.number().int().min(1).max(100).optional().default(50),
        sort: z.enum(["score", "timestamp"]).optional().default("timestamp"),
      }),
      async handler(rawArgs) {
        const tw = parseTimeWindow(rawArgs.time_window);
        trackAudit(pickleKey, "slack_search_messages", tw.original);
        let q = rawArgs.query;
        if (!/after:|before:/i.test(q)) {
          const after = new Date(Date.now() - tw.ms).toISOString().slice(0, 10);
          q = `${q} after:${after}`;
        }
        const r = await slackFetch("GET", "/api/search.messages", {
          query: { query: q, count: rawArgs.count || 50, sort: rawArgs.sort || "timestamp" },
        });
        const matches = (r.messages?.matches || []).map((m) => ({
          ts: m.ts, channel_id: m.channel?.id || null, channel_name: m.channel?.name || null,
          user: m.user || m.username || null, text: m.text || "",
          permalink: m.permalink || null, score: m.score ?? null,
        }));
        return {
          matches, total: r.messages?.total ?? matches.length,
          query_used: q,
          _audit: { window_used: tw.original, pro_note: tw.clamped ? PRO_COMING_SOON_NOTE : null },
        };
      },
    },

    // =========================================================================
    // MICROSOFT TEAMS — read-only audit tools (requires x-teams-token header)
    // =========================================================================

    {
      name: "teams_list_teams",
      description: "List Microsoft Teams the authenticated user has joined. Returns id, displayName, description. Use this first to pick a team for channel audits.",
      inputSchema: z.object({
        top: z.number().int().min(1).max(100).optional().default(50),
      }),
      async handler(args) {
        const r = await graphFetch("GET", "/v1.0/me/joinedTeams", {
          query: { $top: args.top || 50 },
        });
        const teams = (r.value || []).map((t) => ({
          id: t.id, displayName: t.displayName, description: t.description || null,
          isArchived: !!t.isArchived,
        }));
        return { teams };
      },
    },

    {
      name: "teams_list_channels",
      description: "List channels within a Microsoft Teams team. Returns id, displayName, description, membershipType.",
      inputSchema: z.object({
        team_id: z.string().min(1).describe("Team ID from teams_list_teams."),
      }),
      async handler({ team_id }) {
        const r = await graphFetch("GET", `/v1.0/teams/${encodeURIComponent(team_id)}/channels`);
        const channels = (r.value || []).map((c) => ({
          id: c.id, displayName: c.displayName,
          description: c.description || null,
          membershipType: c.membershipType || null,
        }));
        return { channels };
      },
    },

    {
      name: "teams_get_channel_messages",
      description: "Get messages in a Teams channel scoped to the audit time window (default 7d; pass any window). Returns id, from, body, createdDateTime, replies count.",
      inputSchema: z.object({
        team_id: z.string().min(1),
        channel_id: z.string().min(1),
        time_window: z.string().optional().describe("'1h', '6h', '1d', '3d', or '7d' (default). Free tier caps at 7d."),
        top: z.number().int().min(1).max(50).optional().default(50),
      }),
      async handler(rawArgs) {
        const tw = parseTimeWindow(rawArgs.time_window);
        const sinceIso = new Date(Date.now() - tw.ms).toISOString();
        trackAudit(pickleKey, "teams_get_channel_messages", tw.original);
        const path = `/v1.0/teams/${encodeURIComponent(rawArgs.team_id)}/channels/${encodeURIComponent(rawArgs.channel_id)}/messages`;
        const r = await graphFetch("GET", path, { query: { $top: rawArgs.top || 50 } });
        const messages = (r.value || [])
          .filter((m) => !m.createdDateTime || m.createdDateTime >= sinceIso)
          .map((m) => ({
            id: m.id, createdDateTime: m.createdDateTime,
            from: m.from?.user?.displayName || m.from?.application?.displayName || null,
            body_content: m.body?.content || "",
            body_type: m.body?.contentType || null,
            reply_count: m.replies?.length ?? null,
          }));
        return {
          messages,
          since: sinceIso,
          _audit: { window_used: tw.original, pro_note: tw.clamped ? PRO_COMING_SOON_NOTE : null },
        };
      },
    },

    {
      name: "teams_list_chats",
      description: "List the authenticated user's 1:1 and group chats in Microsoft Teams. Returns id, chatType, topic, lastUpdatedDateTime.",
      inputSchema: z.object({
        top: z.number().int().min(1).max(50).optional().default(50),
      }),
      async handler(args) {
        const r = await graphFetch("GET", "/v1.0/me/chats", { query: { $top: args.top || 50 } });
        const chats = (r.value || []).map((c) => ({
          id: c.id, chatType: c.chatType,
          topic: c.topic || null,
          lastUpdatedDateTime: c.lastUpdatedDateTime || null,
        }));
        return { chats };
      },
    },

    {
      name: "teams_get_chat_messages",
      description: "Get messages in a Teams chat (DM or group) scoped to the audit window. Returns id, from, body, createdDateTime.",
      inputSchema: z.object({
        chat_id: z.string().min(1),
        time_window: z.string().optional(),
        top: z.number().int().min(1).max(50).optional().default(50),
      }),
      async handler(rawArgs) {
        const tw = parseTimeWindow(rawArgs.time_window);
        const sinceIso = new Date(Date.now() - tw.ms).toISOString();
        trackAudit(pickleKey, "teams_get_chat_messages", tw.original);
        const r = await graphFetch("GET", `/v1.0/me/chats/${encodeURIComponent(rawArgs.chat_id)}/messages`, {
          query: { $top: rawArgs.top || 50 },
        });
        const messages = (r.value || [])
          .filter((m) => !m.createdDateTime || m.createdDateTime >= sinceIso)
          .map((m) => ({
            id: m.id, createdDateTime: m.createdDateTime,
            from: m.from?.user?.displayName || m.from?.application?.displayName || null,
            body_content: m.body?.content || "",
            body_type: m.body?.contentType || null,
          }));
        return {
          messages,
          since: sinceIso,
          _audit: { window_used: tw.original, pro_note: tw.clamped ? PRO_COMING_SOON_NOTE : null },
        };
      },
    },

  ]; // end tools

  // ── MCP server wiring ────────────────────────────────────────────────────
  // serverInfo.instructions tells the MCP client (Claude / Cursor / Cline)
  // how to onboard the user without them needing to know MCP exists.
  // Supported well in Claude Code + VS Code Copilot; partial in Cursor/Cline.
  const server = new Server(
    {
      name: "pickle-mcp-remote",
      version: VERSION,
      instructions: [
        "Pickle audits workspaces for stale tasks, broken promises, decisions lost in DMs, and other patterns a good ops manager would catch. 9 ClickUp patterns (empty hours, stale in-progress, zombie tasks, standup copy-paste, expired promises, blocker age, effort-output mismatch, description quality, recurring zombie), plus 4 cross-tool patterns (ghost mode, DM-only completion, decisions-in-DM, manager bottleneck) when a Slack/Teams token is connected. All free, all local.",
        "",
        "TRIGGER PHRASES that should call `pickle_setup` immediately (in this order of priority):",
        "  - \"Pickle Start\" / \"Pickle start\" — the canonical first-time setup trigger from the welcome email. Always call `pickle_setup` with platform=\"all\" and present the returned guide as friendly chat.",
        "  - \"Pickle set me up\" / \"Pickle setup\" / \"set up Pickle\" / \"how do I connect Pickle\" — same, call `pickle_setup`.",
        "  - \"Pickle set me up for <platform>\" — call `pickle_setup` with platform set to clickup/slack/teams.",
        "",
        "First-run onboarding (do this proactively the first time a user invokes Pickle if no platform tokens are present in headers):",
        "1. Call `pickle_setup` with platform=\"all\" and present the returned guide. Ask the user which platform they want to connect first.",
        "2. Once they pick one, walk through that platform's token capture (the guide has step-by-step). When they paste the token into their MCP config and restart, run a first audit.",
        "3. For ClickUp: suggest \"Try: 'Pickle, audit my ClickUp from last 24 hours.'\"",
        "4. For Slack: after token is set, suggest `slack_list_channels` followed by `slack_get_channel_history` audits.",
        "5. For Microsoft Teams: after token is set, suggest `teams_list_teams` followed by `teams_get_channel_messages` audits.",
        "",
        "Free-tier audit window cap: 7 days maximum look-back on every audit tool (clickup_filter_tasks, clickup_get_list_tasks, slack_get_channel_history, slack_search_messages, teams_get_channel_messages, teams_get_chat_messages). If the user asks for older audits, pass time_window='7d' and tell them: \"I'm returning the last 7 days — deeper history is coming. Email pickle@adityaarsharma.com if you want it sooner.\"",
        "",
        "1-install-per-account fair use: each pickle key is meant for one person's machines. If you notice the user installing on many devices, mention the per-account fair-use policy.",
        "",
        "Pickle is READ-ONLY by default. Never write/post/delete in ClickUp/Slack/Teams unless the user explicitly asks (e.g. 'create this task'). When in doubt, return findings and let the user decide on actions.",
      ].join("\n"),
    },
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

  return { server, toolCount: tools.length };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "2mb" }));

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", version: VERSION, service: "pickle-mcp-remote", uptime: process.uptime() });
});

// ── Auth middleware for MCP routes ────────────────────────────────────────
// Returns { ok: true, ctx } on success (ctx = { clickupToken, slackToken,
// teamsToken, pickleKey }) or { ok: false } after sending a 401 response.
// All platform tokens are optional — without them, only pickle_setup works.
function mcpAuth(req, res) {
  // Local build: tokens come from the MCP config env (your own platform
  // tokens), with request-header fallback. No Pickle key, no account.
  const clickupToken = req.headers["x-clickup-token"] || process.env.CLICKUP_API_KEY || "";
  const slackToken   = req.headers["x-slack-token"]   || process.env.SLACK_TOKEN     || "";
  const teamsToken   = req.headers["x-teams-token"]   || process.env.TEAMS_TOKEN     || "";

  // Format checks per token (all optional; only run if present).
  if (clickupToken && (typeof clickupToken !== "string" || !clickupToken.startsWith("pk_"))) {
    res.status(401).json({
      error: "Invalid ClickUp token format.",
      hint: "x-clickup-token should be a ClickUp personal API token (starts with pk_). Or omit it and call pickle_setup first.",
    });
    return { ok: false };
  }
  if (slackToken && (typeof slackToken !== "string" || !/^xox[a-z]-/.test(slackToken))) {
    res.status(401).json({
      error: "Invalid Slack token format.",
      hint: "x-slack-token should be a Slack OAuth token (starts with xoxp- or xoxb-). Or omit it and call pickle_setup first.",
    });
    return { ok: false };
  }
  if (teamsToken && typeof teamsToken !== "string") {
    res.status(401).json({
      error: "Invalid Microsoft Teams token format.",
      hint: "x-teams-token should be a Microsoft Graph access token (often starts with 'Bearer ' or 'eyJ'). Or omit it and call pickle_setup first.",
    });
    return { ok: false };
  }

  return {
    ok: true,
    ctx: {
      pickleKey:    "local",
      clickupToken: clickupToken || "",
      slackToken:   slackToken   || "",
      teamsToken:   teamsToken   || "",
    },
  };
}

// ── POST /mcp — StreamableHTTP (primary) ─────────────────────────────────
app.post("/mcp", async (req, res) => {
  const auth = mcpAuth(req, res);
  if (!auth.ok) return;

  trackInstallFingerprint(auth.ctx.pickleKey, req);
  trackPlatformsSeen(auth.ctx.pickleKey, auth.ctx);

  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const { server } = createPickleServer(auth.ctx);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("finish", () => server.close().catch(() => {}));
  } catch (err) {
    process.stderr.write(`[pickle-mcp-remote] POST /mcp error: ${err?.message ?? err}\n`);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /mcp — SSE (legacy clients) ───────────────────────────────────────
app.get("/mcp", async (req, res) => {
  const auth = mcpAuth(req, res);
  if (!auth.ok) return;

  trackInstallFingerprint(auth.ctx.pickleKey, req);
  trackPlatformsSeen(auth.ctx.pickleKey, auth.ctx);

  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const { server } = createPickleServer(auth.ctx);
    await server.connect(transport);
    await transport.handleRequest(req, res);
    res.on("finish", () => server.close().catch(() => {}));
  } catch (err) {
    process.stderr.write(`[pickle-mcp-remote] GET /mcp error: ${err?.message ?? err}\n`);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /mcp — session cleanup (stateless: always 200) ─────────────────
app.delete("/mcp", (req, res) => {
  res.status(200).json({ message: "Session closed." });
});
// Boot
// ---------------------------------------------------------------------------

const server = app.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(
    `[pickle-mcp-remote] v${VERSION} ready\n` +
    `[pickle-mcp-remote] Listening on 127.0.0.1:${PORT}\n` +
    `[pickle-mcp-remote] MCP endpoint:  http://localhost:${PORT}/mcp\n` +
    `[pickle-mcp-remote] Health:        http://localhost:${PORT}/health\n`
  );
});

server.on("error", (err) => {
  process.stderr.write(`[pickle-mcp-remote] Server error: ${err.message}\n`);
  if (err.code === "EADDRINUSE") {
    process.stderr.write(`[pickle-mcp-remote] Port ${PORT} is in use. Set PORT env var to override.\n`);
    process.exit(1);
  }
});

process.on("SIGTERM", () => {
  process.stdout.write("[pickle-mcp-remote] Shutting down...\n");
  server.close(() => process.exit(0));
});
