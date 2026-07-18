#!/usr/bin/env node
/**
 * scripts/subagent-telemetry.mjs
 *
 * Hook handler for SubagentStart, SubagentStop, PreToolUse, PostToolUse,
 * and PermissionRequest events for BOTH Claude Code and Codex CLI.
 *
 * Appends one JSON line per hook firing to `.agentic-local/subagent-routing-log.jsonl`
 * (gitignored — same root as `quota-state.json`). The deviance checker
 * (`scripts/subagent-deviance-check.mjs`) reads this log on every Stop hook
 * to detect normalization-of-deviance signals (D50).
 *
 * Stdin payload shape (per both stacks' hook docs):
 *
 *   SubagentStart / SubagentStop:
 *   {
 *     "hookEventName": "SubagentStart" | "SubagentStop",
 *     "turn_id": "<id>",
 *     "subagent": "<name>",
 *     "subagent_type": "<name>",     // Claude Code synonym
 *     "agent_id": "<id>",
 *     "prompt": "<the prompt sent to the subagent>",   // SubagentStart only
 *     "result": "<the subagent's final message>",       // SubagentStop only
 *     ... possibly other host-specific fields
 *   }
 *
 *   PreToolUse / PostToolUse / PermissionRequest:
 *   {
 *     "hookEventName": "PreToolUse" | "PostToolUse" | "PermissionRequest",
 *     "turn_id": "<id>",
 *     "agent_id": "<id>",
 *     "tool_name": "<name>",
 *     "tool_input": { ... }
 *     // PostToolUse additionally:
 *     "tool_response": { ... },
 *     "duration_ms": <number>
 *     // PermissionRequest additionally:
 *     "decision": "allow" | "deny" | "ask"
 *   }
 *
 * Behaviour:
 *   - SubagentStart:       writes a `SubagentStart` record. Always written
 *                          regardless of deviance_mode.
 *   - SubagentStop:        writes a `SubagentStop` record. Always written.
 *                          If the result's last line reads `HANDBACK → <name>`
 *                          and <name> is not in the known roster, emits a
 *                          nearest-name suggestion to stderr (F11 mitigation).
 *   - PreToolUse:          writes a tool-event record if deviance_mode=on
 *                          and agent_id is present.
 *   - PostToolUse:         writes a tool-event record with outcome +
 *                          duration_ms if deviance_mode=on and agent_id present.
 *   - PermissionRequest:   writes a tool-event record with decision if
 *                          deviance_mode=on and agent_id present.
 *
 * Tool-event records with missing agent_id are dropped with a stderr message.
 * When deviance_mode="off", tool events exit 0 without writing.
 *
 * Always exits 0. Misbehaving telemetry must never block a turn.
 *
 * Token cost: none — pure local I/O.
 */

import { mkdirSync, appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path, { dirname, resolve, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const stateDir = join(projectRoot, ".agentic-local");
const logPath = join(stateDir, "subagent-routing-log.jsonl");

const KNOWN_ROSTER = new Set([
  "director",
  "planner",
  "design-architect",
  "implementor",
  "clean-coder",
  "refactorer",
  "debugger",
  "validator",
  "executor",
  "documentation",
  "security-reviewer",
  "release-manager",
  "ai-agentic-specialist",
  "web-extractor",
  "web-scraper",
  "user",
]);

async function readStdin() {
  return new Promise((resolveStdin) => {
    let data = "";
    if (process.stdin.isTTY) return resolveStdin("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolveStdin(data));
    setTimeout(() => resolveStdin(data), 500);
  });
}

function parsePayload(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { rawStdin: raw.slice(0, 512) };
  }
}

function ensureStateDir() {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const v0 = new Array(n + 1);
  const v1 = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) v0[i] = i;
  for (let i = 0; i < m; i += 1) {
    v1[0] = i + 1;
    for (let j = 0; j < n; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= n; j += 1) v0[j] = v1[j];
  }
  return v1[n];
}

function nearestRosterName(candidate) {
  let best = null;
  let bestDist = Infinity;
  for (const name of KNOWN_ROSTER) {
    const d = levenshtein(candidate.toLowerCase(), name);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return bestDist <= 3 ? best : null;
}

/**
 * Read `deviance_mode` from `subagent-routing.json`.
 *
 * Missing key → `"on"`. Any value other than the literal `"off"` → `"on"`.
 *
 * @returns {"on" | "off"}
 */
function readDevianceMode() {
  const togglePath = join(projectRoot, "subagent-routing.json");
  if (!existsSync(togglePath)) return "on";
  try {
    const parsed = JSON.parse(readFileSync(togglePath, "utf8"));
    const raw = String(parsed.deviance_mode ?? "on").toLowerCase();
    return raw === "off" ? "off" : "on";
  } catch {
    return "on";
  }
}

/**
 * Extract file-system paths referenced by a tool invocation.
 *
 * Extraction rule (v1.0 §4 / v1.2 restored):
 *   1. `tool_input.file_path` — push if string.
 *   2. `tool_input.path`      — push if string.
 *   3. `tool_input.paths`     — push each element if string array.
 *   4. `tool_input.notebook_path` — push if string (NotebookEdit).
 *   5. `tool_input.edits[*].file_path` — push each (MultiEdit, best-effort).
 *
 * Paths are deduplicated, empty strings dropped, separators normalised to
 * forward slash, and absolute paths inside the project root made
 * project-relative.
 *
 * @param {Record<string, unknown> | null | undefined} toolInput - Raw tool_input object.
 * @returns {string[]} Deduplicated, normalised paths (may be empty).
 */
function extractToolInputPaths(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return [];

  const raw = [];
  if (typeof toolInput.file_path === "string") raw.push(toolInput.file_path);
  if (typeof toolInput.path === "string") raw.push(toolInput.path);
  if (Array.isArray(toolInput.paths)) {
    for (const p of toolInput.paths) {
      if (typeof p === "string") raw.push(p);
    }
  }
  if (typeof toolInput.notebook_path === "string") raw.push(toolInput.notebook_path);
  // MultiEdit: edits[*].file_path (best-effort optional chain)
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (edit && typeof edit.file_path === "string") raw.push(edit.file_path);
    }
  }

  // security: redact secret paths before persisting to .agentic-local logs
  const SENSITIVE_BASENAME =
    /(^|\/)(\.env(\..*)?|\.npmrc|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.pfx|.*\.p12|credentials(\.json)?)$/i;

  const seen = new Set();
  const result = [];
  for (const p of raw) {
    if (!p) continue;

    // Step 1 — normalise OS separators to forward slash.
    const slashNorm = p.replace(/\\/g, "/");

    // Step 2 — canonicalize: resolve the path relative to projectRoot so that
    // absolute paths and relative paths (including those with ".." segments)
    // are both reduced to a single absolute form, then make project-relative.
    const abs = path.resolve(projectRoot, slashNorm.replace(/\//g, path.sep));
    const projectRootFwd = projectRoot.replace(/\\/g, "/");
    const absFwd = abs.replace(/\\/g, "/");
    const relPosix = absFwd.startsWith(projectRootFwd + "/")
      ? absFwd.slice(projectRootFwd.length + 1)
      : path.posix.relative(projectRootFwd, absFwd);

    // Step 3 — collapse any remaining "." / ".." segments in the POSIX form.
    const normalized = path.posix.normalize(relPosix);

    // Step 4 — detect out-of-tree writes (path escapes the project root).
    let finalPath;
    if (normalized.startsWith("../") || normalized === "..") {
      // Tag instead of drop so detectors can still emit a signal on the event.
      finalPath = `[out-of-tree]:${p}`;
      process.stderr.write(`telemetry: out-of-tree path tagged: ${p}\n`);
    } else {
      // Step 5 — redact paths whose basename matches a sensitive-file pattern.
      finalPath = SENSITIVE_BASENAME.test(normalized)
        ? "[redacted-secret-path]"
        : normalized;
    }

    if (!seen.has(finalPath)) {
      seen.add(finalPath);
      result.push(finalPath);
    }
  }
  return result;
}

function extractHandback(result) {
  if (typeof result !== "string") return null;
  const lines = result.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = lines[i].match(/HANDBACK\s*[→\->]+\s*([A-Za-z0-9_-]+)/);
    if (m) return m[1];
  }
  return null;
}

/** Tool events that require deviance_mode=on and a present agent_id. */
const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse", "PermissionRequest"]);

async function main() {
  const raw = await readStdin();
  const payload = parsePayload(raw);
  const event =
    payload.hookEventName ??
    payload.hookSpecificOutput?.hookEventName ??
    "unknown";
  const turnId = payload.turn_id ?? payload.turnId ?? null;
  const agentId = payload.agent_id ?? payload.agentId ?? null;

  // Tool events have different handling from subagent lifecycle events.
  if (TOOL_EVENTS.has(event)) {
    // When deviance_mode is off, skip tool-event records entirely.
    if (readDevianceMode() === "off") {
      process.exit(0);
    }

    // agent_id is mandatory on tool event records; drop if missing.
    if (!agentId) {
      process.stderr.write(`telemetry: dropped ${event} record — missing agent_id\n`);
      process.exit(0);
    }

    const toolInput = payload.tool_input ?? null;
    const toolName = payload.tool_name ?? payload.toolName ?? "unknown";
    const toolInputPaths = extractToolInputPaths(toolInput);

    /** @type {Record<string, unknown>} */
    const record = {
      ts: new Date().toISOString(),
      event,
      turn_id: turnId,
      agent_id: agentId,
      // subagent is not available on tool events from the hook payload directly;
      // deviance-check resolves it via agent_id join against SubagentStart records.
      subagent: payload.subagent ?? payload.subagent_type ?? null,
      tool_name: toolName,
      tool_input_paths: toolInputPaths,
    };

    if (event === "PostToolUse") {
      // Outcome derived from tool_response presence / error marker.
      const resp = payload.tool_response ?? payload.toolResponse;
      const isError = resp && (resp.is_error === true || resp.error != null);
      record.outcome = isError ? "error" : "ok";
      record.duration_ms =
        typeof payload.duration_ms === "number"
          ? payload.duration_ms
          : typeof payload.durationMs === "number"
            ? payload.durationMs
            : null;
    }

    if (event === "PermissionRequest") {
      // Normalise to the three known values; any unknown or missing value → "ask".
      const rawDecision = payload.decision ?? payload.permissionDecision ?? null;
      const knownDecision =
        rawDecision === "allow" || rawDecision === "deny" || rawDecision === "ask"
          ? rawDecision
          : "ask";
      record.decision = knownDecision;
    }

    try {
      ensureStateDir();
      appendFileSync(logPath, JSON.stringify(record) + "\n", "utf8");
    } catch {
      // Fail-safe: telemetry must never block a turn.
    }

    process.exit(0);
  }

  // Subagent lifecycle events (SubagentStart / SubagentStop) — always written
  // regardless of deviance_mode.
  const subagent = payload.subagent ?? payload.subagent_type ?? "unknown";

  const record = {
    ts: new Date().toISOString(),
    event,
    subagent,
    turn_id: turnId,
    agent_id: agentId,
  };

  if (event === "SubagentStop" && typeof payload.result === "string") {
    const handback = extractHandback(payload.result);
    if (handback) {
      record.handback = handback;
      if (!KNOWN_ROSTER.has(handback)) {
        const suggestion = nearestRosterName(handback);
        record.handback_unknown = true;
        if (suggestion) record.handback_suggestion = suggestion;
        const msg =
          `[subagent-telemetry] HANDBACK → ${handback} is not in the known roster.` +
          (suggestion ? ` Did you mean → ${suggestion} ?` : "") +
          "\n";
        process.stderr.write(msg);
      }
    }
  }

  try {
    ensureStateDir();
    appendFileSync(logPath, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // Fail-safe: telemetry must never block a turn.
  }

  process.exit(0);
}

main();
