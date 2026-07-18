#!/usr/bin/env node
/**
 * scripts/subagent-deviance-check.mjs
 *
 * Optional deviance audit for BOTH Claude Code and Codex CLI.
 *
 * Reads the per-turn telemetry log
 * (`.agentic-local/subagent-routing-log.jsonl` — appended to by
 * `scripts/subagent-telemetry.mjs`) and scans for the 9 normalization-of-
 * deviance signals defined in
 * `docs/internal/learning-notes/safe-agent-schema.md`.
 *
 * Severity:
 *   HIGH    → stderr warning + append to `.agentic-local/deviance-alerts.jsonl`
 *   MEDIUM  → stderr warning only
 *
 * Always exits 0. Detection is observational; the user (or the next
 * director invocation) decides what to do with the alerts.
 *
 * Usage:
 *   --dry-run       scan log without writing alerts; emits JSON verdict on stdout
 *   hook stdin      still supported if a caller deliberately wires this as a hook
 *
 * When deviance_mode="off" in subagent-routing.json, exits 0 immediately
 * after emitting a disabled message to stderr. With --dry-run, still
 * prints JSON but with verdict="DISABLED".
 *
 * Dry-run verdict union (D50 contract — grep anchor for validator):
 *   type DryRunVerdict =
 *     | "CLEAN"
 *     | "MEDIUM-ONLY"
 *     | "HIGH-ALERTS"
 *     | "DISABLED"
 *     | "TELEMETRY-INCOMPLETE";
 *
 * Resolution precedence: DISABLED > TELEMETRY-INCOMPLETE > HIGH-ALERTS > MEDIUM-ONLY > CLEAN.
 *
 * Turn windowing (v1.1 strict join):
 *   - Filter log entries by turn_id equality.
 *   - If turn_id is absent in the stop payload OR no entries match the id,
 *     emit one MEDIUM finding "telemetry-incomplete" and skip signals 2,5,6,7,9.
 *   - Signals 1, 3, 4, 8 still run.
 *
 * Active-subagent resolution (v1.1):
 *   1. Strict join: find SubagentStart in window where start.agent_id === entry.agent_id.
 *   2. Fallback: if entry has no agent_id AND every Start in window also has no agent_id
 *      AND no Start is currently open: use most recent prior Start; emit one MEDIUM
 *      "ambiguous-attribution" finding.
 *   3. Else: skip the entry silently.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

// parseClaudeSchema is already exported from safe-agent-schema-lint.mjs.
import { parseClaudeSchema } from "./safe-agent-schema-lint.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const stateDir = join(projectRoot, ".agentic-local");
const logPath = join(stateDir, "subagent-routing-log.jsonl");
const alertsPath = join(stateDir, "deviance-alerts.jsonl");

const ROSTER = new Set([
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

/**
 * Sensitive write-surface prefixes for signal 7 (project-relative, POSIX).
 * Changes to these paths require a security-reviewer SubagentStop in the turn.
 */
const SENSITIVE_PREFIXES = [
  "packages/agentic-ai-infra-runtime/src/mcp/",
  ".claude/agents/",
  ".codex/agents/",
  "scripts/subagent-routing.mjs",
  "scripts/subagent-routing-hook.mjs",
  "scripts/subagent-deviance.mjs",
  "scripts/subagent-deviance-check.mjs",
  "scripts/subagent-telemetry.mjs",
  "scripts/safe-agent-schema-lint.mjs",
  ".claude/settings.json",
  ".codex/config.toml",
];

/** Doc-only prefixes excluded from signal 7. */
const SIGNAL7_DOC_EXCLUSIONS = [".agents/skills/", "prompts/"];

/** Self-write allowlist for signal 7: paths under this prefix are always skipped. */
const SIGNAL7_SELF_WRITE_ALLOWLIST = [".agentic-local/"];

/** Write-creating tool names for signals 2 and 7. */
const WRITE_TOOL_NAMES = new Set(["Write", "Edit", "NotebookEdit", "MultiEdit"]);

// ---------------------------------------------------------------------------
// Module-level schema cache (agent name → parsed schema or null).
// Negative entries (null) are cached to avoid repeated failed reads.
// ---------------------------------------------------------------------------
/** @type {Map<string, Record<string, unknown> | null>} */
const schemaCache = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    return {};
  }
}

function readLog() {
  if (!existsSync(logPath)) return [];
  try {
    const text = readFileSync(logPath, "utf8");
    return text
      .split(/\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Parse `subagent-routing.json` and return both toggle values.
 *
 * Centralised so `readDevianceMode` and `readToggleMode` share one I/O call.
 * Missing file or parse error → both fields fall back to their safe defaults.
 *
 * @returns {{ devianceMode: "on" | "off", routingMode: "auto" | "manual" }}
 */
function readRoutingJson() {
  const togglePath = join(projectRoot, "subagent-routing.json");
  if (!existsSync(togglePath)) return { devianceMode: "on", routingMode: "auto" };
  try {
    const parsed = JSON.parse(readFileSync(togglePath, "utf8"));
    const devianceRaw = String(parsed.deviance_mode ?? "on").toLowerCase();
    const routingRaw = String(parsed.mode ?? "auto").toLowerCase();
    return {
      devianceMode: devianceRaw === "off" ? "off" : "on",
      routingMode: routingRaw === "manual" ? "manual" : "auto",
    };
  } catch {
    return { devianceMode: "on", routingMode: "auto" };
  }
}

/**
 * Read `deviance_mode` from `subagent-routing.json`.
 *
 * Missing key → `"on"`. Any value other than literal `"off"` → `"on"`.
 *
 * @returns {"on" | "off"}
 */
function readDevianceMode() {
  return readRoutingJson().devianceMode;
}

/**
 * Read `mode` from `subagent-routing.json`.
 *
 * Both names (`readToggleMode` and the older alias `readRoutingMode`) resolve
 * the same field — `readToggleMode` is the name used throughout this file and
 * by the signal-4 detector; `readRoutingMode` was a prior working name.
 * Keeping `readToggleMode` here avoids renaming a call site that validator
 * greps for.
 *
 * @returns {"auto" | "manual"}
 */
function readToggleMode() {
  return readRoutingJson().routingMode;
}

/**
 * Load and cache the SafeAgentSchema for a named sub-agent from its
 * `.claude/agents/<name>.md` frontmatter.
 *
 * Uses a module-level Map cache. Negative results (file not found or no
 * `safe_agent_schema` block) are cached as `null` to avoid repeated I/O.
 *
 * @param {string} name - Sub-agent name (e.g. `"implementor"`).
 * @returns {Record<string, unknown> | null} Parsed schema or null.
 */
function loadAgentSchema(name) {
  if (schemaCache.has(name)) return schemaCache.get(name) ?? null;
  const filePath = join(projectRoot, ".claude", "agents", `${name}.md`);
  if (!existsSync(filePath)) {
    schemaCache.set(name, null);
    return null;
  }
  try {
    const text = readFileSync(filePath, "utf8");
    const schema = parseClaudeSchema(text);
    schemaCache.set(name, schema);
    return schema;
  } catch {
    schemaCache.set(name, null);
    return null;
  }
}

/**
 * Return telemetry entries that belong to the given turn.
 *
 * v1.1 strict join: filter by `turn_id` equality. If `turnId` is falsy or
 * no entries match, return `null` — callers must emit a telemetry-incomplete
 * finding and skip tool-event detectors.
 *
 * @param {Array<Record<string, unknown>>} entries - All log entries.
 * @param {string | null} turnId - The current turn id.
 * @returns {{ entries: Array<Record<string, unknown>>, incomplete: boolean }}
 */
function turnEntries(entries, turnId) {
  if (!turnId) return { entries: [], incomplete: true };
  const filtered = entries.filter((e) => e.turn_id === turnId);
  if (filtered.length === 0) return { entries: [], incomplete: true };
  return { entries: filtered, incomplete: false };
}

/**
 * Resolve the active sub-agent name for a tool-event entry.
 *
 * Resolution rules (v1.1):
 *  1. Strict join: find SubagentStart in window where start.agent_id === entry.agent_id.
 *  2. Fallback: if entry.agent_id is absent AND every Start in window has no agent_id
 *     AND no Start is currently open → use most recent prior Start; push one MEDIUM
 *     "ambiguous-attribution" finding.
 *  3. Else: return null (skip entry silently).
 *
 * @param {Record<string, unknown>} entry - The tool-event log entry.
 * @param {Array<Record<string, unknown>>} windowEntries - Turn-scoped entries.
 * @param {Array<Record<string, unknown>>} ambiguousFindingsAccum - Accumulator for the one
 *   "ambiguous-attribution" finding (emitted at most once — callers must deduplicate).
 * @returns {string | null} Sub-agent name or null if unresolvable.
 */
function resolveActiveSubagent(entry, windowEntries, ambiguousFindingsAccum) {
  if (entry.agent_id) {
    const match = windowEntries.find(
      (e) => e.event === "SubagentStart" && e.agent_id === entry.agent_id,
    );
    return match ? String(match.subagent ?? "unknown") : null;
  }

  // Fallback path: agent_id absent on entry.
  const starts = windowEntries.filter((e) => e.event === "SubagentStart");
  const allStartsLackId = starts.every((s) => !s.agent_id);
  if (!allStartsLackId) return null;

  const stops = windowEntries.filter((e) => e.event === "SubagentStop");
  const hasOpenStart = starts.some((s) => {
    // A start is "open" when there is no corresponding stop with the same agent_id.
    if (!s.agent_id) return false;
    return !stops.some((st) => st.agent_id === s.agent_id);
  });
  if (hasOpenStart) return null;

  // Emit one ambiguous-attribution finding (callers dedup by checking accumulator).
  if (ambiguousFindingsAccum.length === 0) {
    ambiguousFindingsAccum.push({
      signal: "ambiguous-attribution",
      severity: "MEDIUM",
      message:
        "could not resolve active subagent by agent_id; used most recent Start",
    });
  }

  // Use most recent Start.
  const last = starts[starts.length - 1];
  return last ? String(last.subagent ?? "unknown") : null;
}

/**
 * Test whether a project-relative POSIX path falls under a write-surface prefix.
 *
 * Trailing `/**` and `/*` are stripped from the prefix before the check.
 *
 * @param {string} path - Project-relative POSIX path.
 * @param {string[]} surfaces - Write-surface prefixes (glob-suffix stripped).
 * @returns {boolean}
 */
function matchesSurface(path, surfaces) {
  for (const raw of surfaces) {
    const prefix = raw.replace(/\/\*\*?$/, "").replace(/\*\*?$/, "");
    // Exact file-path match is checked first, before trailing-slash normalization,
    // so a surface declared as a bare filename (e.g. "scripts/foo.mjs") still
    // matches the same literal path.
    if (prefix === path) return true;
    // Normalize prefix to always carry a trailing slash so "docs" never
    // accidentally matches "docs-extra/x" via a bare startsWith prefix check.
    const normalizedPrefix = prefix.endsWith("/") ? prefix : prefix + "/";
    if (path.startsWith(normalizedPrefix)) return true;
  }
  return false;
}

/**
 * Test whether a project-relative POSIX path is a sensitive write surface
 * per the signal-7 list, excluding doc-only and self-write allowlisted paths.
 *
 * @param {string} path - Project-relative POSIX path.
 * @returns {boolean}
 */
function isSensitivePath(path) {
  // Self-write allowlist: .agentic-local/ is always safe.
  if (SIGNAL7_SELF_WRITE_ALLOWLIST.some((p) => path.startsWith(p))) return false;
  // Doc-only exclusions.
  if (SIGNAL7_DOC_EXCLUSIONS.some((p) => path.startsWith(p))) return false;
  return SENSITIVE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : prefix + "/"),
  );
}

function ensureStateDir() {
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
}

function writeAlerts(highFindings, turnId) {
  if (highFindings.length === 0) return;
  try {
    ensureStateDir();
    const ts = new Date().toISOString();
    for (const f of highFindings) {
      const record = { ts, turn_id: turnId ?? null, ...f };
      appendFileSync(alertsPath, JSON.stringify(record) + "\n", "utf8");
    }
  } catch {
    // Fail-safe; alert writing is observational.
  }
}

function printFindings(findings) {
  if (findings.length === 0) return;
  process.stderr.write("[subagent-deviance-check] findings this turn:\n");
  for (const f of findings) {
    const signalLabel = typeof f.signal === "number" ? `signal #${f.signal}` : `signal: ${f.signal}`;
    const tag = `[${f.severity}] ${signalLabel}`;
    const suggest = f.suggestion ? `  (suggestion: ${f.suggestion})` : "";
    process.stderr.write(`  ${tag} — ${f.message}${suggest}\n`);
  }
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

/**
 * The nine deviance signals (D50). Each detector returns an array of
 * findings (possibly empty). Severity is encoded in each finding.
 *
 * Detectors that require tool-event window entries (2, 5, 6, 7, 9) are
 * only called when the turn window is complete (turnId matched entries).
 * Detectors that work on start/stop only (1, 3, 4, 8) always run.
 */
const DETECTORS = [
  // Signal 1 — RESULTS_SUMMARY without a preceding validator turn
  function signal1(entries, payload) {
    const findings = [];
    const stopResult = payload.result ?? "";
    const hasResultsSummary = /\bRESULTS_SUMMARY\b/.test(stopResult);
    if (!hasResultsSummary) return findings;
    const validatorRan = entries.some(
      (e) => e.event === "SubagentStop" && e.subagent === "validator",
    );
    if (!validatorRan) {
      findings.push({
        signal: 1,
        severity: "HIGH",
        message:
          "RESULTS_SUMMARY emitted in this turn but no validator SubagentStop is recorded.",
      });
    }
    return findings;
  },

  // Signal 2 — write outside write_surfaces[] (requires tool-event window)
  function signal2(entries) {
    const findings = [];
    const ambiguous = [];
    const postWriteEvents = entries.filter(
      (e) => e.event === "PostToolUse" && WRITE_TOOL_NAMES.has(e.tool_name),
    );
    for (const e of postWriteEvents) {
      const subagentName = resolveActiveSubagent(e, entries, ambiguous);
      if (!subagentName) continue;
      const schema = loadAgentSchema(subagentName);
      if (!schema) continue;
      const surfaces = Array.isArray(schema.write_surfaces) ? schema.write_surfaces : [];
      for (const p of e.tool_input_paths ?? []) {
        if (!matchesSurface(p, surfaces)) {
          findings.push({
            signal: 2,
            severity: "HIGH",
            message: `Write to "${p}" by "${subagentName}" is outside its declared write_surfaces[].`,
            path: p,
            subagent: subagentName,
          });
        }
      }
    }
    // Surface any ambiguous-attribution findings generated during resolution.
    return [...ambiguous, ...findings];
  },

  // Signal 3 — HANDBACK → unknown name
  function signal3(entries) {
    const findings = [];
    for (const e of entries) {
      if (e.handback && e.handback_unknown) {
        findings.push({
          signal: 3,
          severity: "HIGH",
          message: `HANDBACK → ${e.handback} — not in the 15-roster (subagent: ${e.subagent}).`,
          suggestion: e.handback_suggestion ?? null,
        });
      }
    }
    return findings;
  },

  // Signal 4 — auto mode on but no director ran this turn
  function signal4(entries) {
    const findings = [];
    const toggleAuto = readToggleMode() === "auto";
    if (!toggleAuto) return findings;
    if (entries.length === 0) return findings;
    const directorRan = entries.some(
      (e) => e.event === "SubagentStart" && e.subagent === "director",
    );
    const anySubagentRan = entries.some((e) => e.event === "SubagentStart");
    if (anySubagentRan && !directorRan) {
      findings.push({
        signal: 4,
        severity: "MEDIUM",
        message:
          "subagent-routing.json mode=auto but no director SubagentStart recorded this turn (some sub-agent ran without director routing).",
      });
    }
    return findings;
  },

  // Signal 5 — tool not in required_tools[] (requires tool-event window)
  // TODO(D50-Q1): downgrade ToolSearch-resolved tools
  function signal5(entries) {
    const findings = [];
    const ambiguous = [];
    const preToolEvents = entries.filter((e) => e.event === "PreToolUse");
    for (const e of preToolEvents) {
      const subagentName = resolveActiveSubagent(e, entries, ambiguous);
      if (!subagentName) continue;
      const schema = loadAgentSchema(subagentName);
      if (!schema) continue;
      const required = Array.isArray(schema.required_tools) ? schema.required_tools : [];
      if (!required.includes(e.tool_name)) {
        findings.push({
          signal: 5,
          severity: "MEDIUM",
          message: `Tool "${e.tool_name}" used by "${subagentName}" is not in its required_tools[].`,
          tool: e.tool_name,
          subagent: subagentName,
        });
      }
    }
    return [...ambiguous, ...findings];
  },

  // Signal 6 — permission requested outside upfront block (requires tool-event window)
  // TODO(D50-clause-C): trailing-call downgrade requires re-route marker in telemetry
  function signal6(entries) {
    const findings = [];
    const ambiguous = [];
    // director and planner are the only agents permitted to request permissions.
    const UPFRONT_AGENTS = new Set(["director", "planner"]);
    const permissionEvents = entries.filter((e) => e.event === "PermissionRequest");
    for (const e of permissionEvents) {
      const subagentName = resolveActiveSubagent(e, entries, ambiguous);
      if (!subagentName) continue;
      if (!UPFRONT_AGENTS.has(subagentName)) {
        findings.push({
          signal: 6,
          severity: "HIGH",
          message: `permission requested outside upfront block by "${subagentName}".`,
          subagent: subagentName,
        });
      }
    }
    return [...ambiguous, ...findings];
  },

  // Signal 7 — security-reviewer skipped for write-surface change (requires tool-event window)
  function signal7(entries) {
    const findings = [];
    const WRITE_EVENTS = entries.filter(
      (e) => e.event === "PostToolUse" && WRITE_TOOL_NAMES.has(e.tool_name),
    );
    let firstSensitivePath = null;
    for (const e of WRITE_EVENTS) {
      for (const p of e.tool_input_paths ?? []) {
        if (isSensitivePath(p)) {
          firstSensitivePath = p;
          break;
        }
      }
      if (firstSensitivePath) break;
    }
    if (!firstSensitivePath) return findings;
    const securityReviewerRan = entries.some(
      (e) => e.event === "SubagentStop" && e.subagent === "security-reviewer",
    );
    if (!securityReviewerRan) {
      findings.push({
        signal: 7,
        severity: "HIGH",
        message:
          `Write to sensitive surface "${firstSensitivePath}" but no security-reviewer SubagentStop recorded this turn.`,
        path: firstSensitivePath,
      });
    }
    return findings;
  },

  // Signal 8 — director re-spawned mid-chain (more than one director Start)
  function signal8(entries) {
    const findings = [];
    const starts = entries.filter(
      (e) => e.event === "SubagentStart" && e.subagent === "director",
    );
    if (starts.length > 1) {
      findings.push({
        signal: 8,
        severity: "MEDIUM",
        message: `Director SubagentStart fired ${starts.length}× in this turn — director should run once per prompt.`,
      });
    }
    return findings;
  },

  // Signal 9 — refused_tools[] invoked (requires tool-event window)
  function signal9(entries) {
    const findings = [];
    const ambiguous = [];
    const preToolEvents = entries.filter((e) => e.event === "PreToolUse");
    for (const e of preToolEvents) {
      const subagentName = resolveActiveSubagent(e, entries, ambiguous);
      if (!subagentName) continue;
      const schema = loadAgentSchema(subagentName);
      if (!schema) continue;
      const refused = Array.isArray(schema.refused_tools) ? schema.refused_tools : [];
      if (refused.includes(e.tool_name)) {
        findings.push({
          signal: 9,
          severity: "HIGH",
          message: `Tool "${e.tool_name}" is in refused_tools[] for "${subagentName}" but was invoked.`,
          tool: e.tool_name,
          subagent: subagentName,
        });
      }
    }
    return [...ambiguous, ...findings];
  },
];

/** Detectors that only need start/stop entries and always run. */
const ALWAYS_RUN_SIGNALS = new Set([1, 3, 4, 8]);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const devianceMode = readDevianceMode();

  if (devianceMode === "off") {
    process.stderr.write(
      "[subagent-deviance-check] disabled via subagent-routing.json deviance_mode=off\n",
    );
    if (dryRun) {
      process.stdout.write(
        JSON.stringify(
          {
            mode: readToggleMode(),
            devianceMode: "off",
            entriesScanned: 0,
            findings: [],
            verdict: "DISABLED",
          },
          null,
          2,
        ) + "\n",
      );
    }
    process.exit(0);
  }

  const raw = dryRun ? "" : await readStdin();
  const payload = parsePayload(raw);
  const turnId = payload.turn_id ?? payload.turnId ?? null;

  const allEntries = readLog();
  const { entries, incomplete } = turnEntries(allEntries, turnId);

  let findings = [];
  let telemetryIncomplete = false;

  if (incomplete) {
    telemetryIncomplete = true;
    findings.push({
      signal: "telemetry-incomplete",
      severity: "MEDIUM",
      message:
        "turn_id missing or no entries found; tool-event detectors skipped",
    });
  }

  // When windowing is incomplete, run only always-run detectors using the
  // last 50 entries as best-effort context.
  const scanEntries = incomplete ? allEntries.slice(-50) : entries;

  for (let i = 0; i < DETECTORS.length; i += 1) {
    const detector = DETECTORS[i];
    // Detector function names follow the "signal<N>" convention (e.g. "signal1").
    // Parse the 1-based signal number to check ALWAYS_RUN_SIGNALS membership.
    const sigNum = parseInt(detector.name.replace("signal", ""), 10);
    if (incomplete && !ALWAYS_RUN_SIGNALS.has(sigNum)) continue;
    try {
      const out = detector(scanEntries, payload);
      if (Array.isArray(out)) findings = findings.concat(out);
    } catch {
      // Per-detector failure is not fatal; continue scanning.
    }
  }

  const high = findings.filter((f) => f.severity === "HIGH");
  if (!dryRun) {
    writeAlerts(high, turnId);
  }
  printFindings(findings);

  if (dryRun) {
    // Precedence within an active (non-DISABLED) run: TELEMETRY-INCOMPLETE > HIGH-ALERTS > MEDIUM-ONLY > CLEAN.
    let verdict;
    if (telemetryIncomplete) {
      verdict = "TELEMETRY-INCOMPLETE";
    } else if (high.length > 0) {
      verdict = "HIGH-ALERTS";
    } else if (findings.length > 0) {
      verdict = "MEDIUM-ONLY";
    } else {
      verdict = "CLEAN";
    }
    process.stdout.write(
      JSON.stringify(
        {
          mode: readToggleMode(),
          devianceMode,
          entriesScanned: scanEntries.length,
          findings,
          verdict,
        },
        null,
        2,
      ) + "\n",
    );
  }

  process.exit(0);
}

main();
