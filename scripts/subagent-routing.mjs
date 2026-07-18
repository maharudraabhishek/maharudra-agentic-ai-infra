#!/usr/bin/env node
/**
 * scripts/subagent-routing.mjs
 *
 * CLI to inspect and flip the sub-agent auto-routing toggle.
 *
 * The toggle is the single source of truth that decides whether the
 * director sub-agent runs on every prompt (auto) or the user must name
 * sub-agents explicitly (manual). Both Claude Code and Codex CLI read it
 * through their UserPromptSubmit hooks (see scripts/subagent-routing-hook.mjs).
 *
 * Usage:
 *   node scripts/subagent-routing.mjs status    — print current mode and source
 *   node scripts/subagent-routing.mjs on        — set to "auto"
 *   node scripts/subagent-routing.mjs off       — set to "manual"
 *   node scripts/subagent-routing.mjs get-mode  — print just "auto" or "manual"
 *
 * Exit codes:
 *   0   on success (any recognised subcommand)
 *   1   on unknown subcommand or write failure
 *
 * The toggle file lives at the project root as `subagent-routing.json`.
 * If the file is missing or malformed, the effective mode defaults to
 * "auto" — the safer default given the user explicitly opted into the
 * routing system by installing it.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

/** Absolute path of this script's directory (scripts/). Used to anchor projectRoot. */
const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the repository root — one level above scripts/. */
const projectRoot = resolve(here, "..");

/**
 * Absolute path to subagent-routing.json — the single toggle file shared by
 * Claude Code and Codex CLI. Both stacks' UserPromptSubmit hooks read this file
 * on every prompt; changes take effect immediately without restarting the session.
 */
const togglePath = join(projectRoot, "subagent-routing.json");

/**
 * Fail-safe routing mode used when subagent-routing.json is missing, corrupt,
 * or contains an unrecognised value. "auto" keeps the director running so the
 * user never silently loses the routing system they opted into.
 */
const DEFAULT_MODE = "auto";

/**
 * Reads subagent-routing.json and returns the effective routing and deviance modes.
 *
 * Coercion rules (fail-safe, never throws):
 * - Missing file           → mode:"auto", devianceMode:"on"
 * - Parse error            → mode:"auto", devianceMode:"on"
 * - mode any value ≠ "manual" → coerced to "auto"
 * - deviance_mode any value ≠ "off" → coerced to "on"
 *
 * @returns {{ mode: "auto"|"manual", devianceMode: "on"|"off", source: string }}
 */
function readToggle() {
  if (!existsSync(togglePath)) {
    return { mode: DEFAULT_MODE, devianceMode: "on", source: "default (subagent-routing.json missing)" };
  }
  try {
    const raw = readFileSync(togglePath, "utf8");
    const parsed = JSON.parse(raw);
    const mode = String(parsed.mode ?? DEFAULT_MODE).toLowerCase();
    // deviance_mode: missing key defaults to "on"; any value other than literal "off" coerces to "on".
    const devianceRaw = String(parsed.deviance_mode ?? "on").toLowerCase();
    const devianceMode = devianceRaw === "off" ? "off" : "on";
    return {
      mode: mode === "manual" ? "manual" : "auto",
      devianceMode,
      source: togglePath,
    };
  } catch (err) {
    return {
      mode: DEFAULT_MODE,
      devianceMode: "on",
      source: `default (parse error: ${err.message})`,
    };
  }
}

/**
 * Writes the routing mode to subagent-routing.json using read-modify-write so
 * peer keys (deviance_mode, description, flipWith, statusWith) are preserved.
 *
 * Only the `mode` key is changed by this function. To change deviance_mode use
 * scripts/subagent-deviance.mjs, which applies the same read-modify-write pattern.
 *
 * @param {"auto"|"manual"} mode - The routing mode to persist.
 * @throws {Error} If the file cannot be written (disk full, permission denied, etc.)
 */
function writeToggle(mode) {
  // Read-modify-write so peer keys (e.g. deviance_mode) survive the write.
  let existing = {};
  if (existsSync(togglePath)) {
    try {
      existing = JSON.parse(readFileSync(togglePath, "utf8"));
    } catch {
      // Corrupt file — start fresh; existing is already {}.
    }
  }
  const body = {
    ...existing,
    mode,
    description:
      "Sub-agent routing + deviance check toggles. 'mode' (auto|manual) controls the director hook; 'deviance_mode' (on|off) controls D50 deviance detection and tool-event telemetry. Read by scripts/subagent-routing-hook.mjs, scripts/subagent-telemetry.mjs, and scripts/subagent-deviance-check.mjs.",
    flipWith: "node scripts/subagent-routing.mjs on|off  |  node scripts/subagent-deviance.mjs on|off",
    statusWith: "node scripts/subagent-routing.mjs status  |  node scripts/subagent-deviance.mjs status",
  };
  writeFileSync(togglePath, JSON.stringify(body, null, 2) + "\n", "utf8");
}

/**
 * The CLI subcommand passed as the first positional argument.
 * Defaults to "status" when omitted so `node scripts/subagent-routing.mjs`
 * is safe to run without arguments.
 */
const cmd = (process.argv[2] ?? "status").toLowerCase();

// ═══════════════════════════════════════════════════════════════════════════════
// ▼▼▼  MAIN ROUTING SWITCH  ▼▼▼
//
// This switch is the entry point for the entire sub-agent auto-routing toggle.
//
//   HOW THE FULL FEATURE WORKS:
//   1. "node scripts/subagent-routing.mjs on"  →  writes mode:"auto" to
//      subagent-routing.json at the project root.
//   2. On EVERY subsequent prompt, the UserPromptSubmit hook
//      (scripts/subagent-routing-hook.mjs) reads that file and, when mode="auto",
//      injects additionalContext into the prompt: "spawn the director sub-agent first."
//   3. Claude Code (or Codex CLI) sees the injected context and calls the
//      DIRECTOR sub-agent (.claude/agents/director.md) before doing anything else.
//   4. The director reads the full prompt, decomposes the task intelligently,
//      picks the right specialists from the 14-roster (planner, design-architect,
//      implementor, clean-coder, refactorer, debugger, validator, executor,
//      documentation, security-reviewer, release-manager, ai-agentic-specialist,
//      web-extractor, web-scraper), and emits a ROUTING PLAN ending in
//      HANDBACK → <next>.
//   5. The orchestrator executes each specialist in turn. validator is mandatory
//      before RESULTS_SUMMARY.
//
//   QUICK REFERENCE:
//     node scripts/subagent-routing.mjs on        ← ENABLE  (director on every prompt)
//     node scripts/subagent-routing.mjs off       ← DISABLE (manual sub-agent naming)
//     node scripts/subagent-routing.mjs status    ← INSPECT current mode
//     node scripts/subagent-routing.mjs get-mode  ← machine-readable "auto"|"manual"
//
// ═══════════════════════════════════════════════════════════════════════════════
switch (cmd) {
  case "status": {
    const { mode, devianceMode, source } = readToggle();
    process.stdout.write(
      `routing_mode:   ${mode}\ndeviance_mode:  ${devianceMode}\nsource:         ${source}\n\n`,
    );
    if (mode === "auto") {
      process.stdout.write(
        "The director sub-agent runs on every prompt and routes to specialists.\n" +
          "Disable with: node scripts/subagent-routing.mjs off\n",
      );
    } else {
      process.stdout.write(
        "User must name sub-agents explicitly in prompts.\n" +
          "Enable auto-routing with: node scripts/subagent-routing.mjs on\n",
      );
    }
    process.exit(0);
    break;
  }
  case "on": {
    try {
      writeToggle("auto");
      process.stdout.write("Sub-agent auto-routing: ON (mode=auto)\n");
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Write failed: ${err.message}\n`);
      process.exit(1);
    }
    break;
  }
  case "off": {
    try {
      writeToggle("manual");
      process.stdout.write("Sub-agent auto-routing: OFF (mode=manual)\n");
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Write failed: ${err.message}\n`);
      process.exit(1);
    }
    break;
  }
  case "get-mode": {
    // Machine-readable output — prints just "auto" or "manual" with no newline,
    // so it can be captured cleanly in shell scripts: MODE=$(node ... get-mode)
    const { mode } = readToggle();
    process.stdout.write(mode);
    process.exit(0);
    break;
  }
  default: {
    process.stderr.write(
      `Unknown subcommand: ${cmd}\n` +
        `Usage:\n` +
        `  node scripts/subagent-routing.mjs status\n` +
        `  node scripts/subagent-routing.mjs on\n` +
        `  node scripts/subagent-routing.mjs off\n` +
        `  node scripts/subagent-routing.mjs get-mode\n`,
    );
    process.exit(1);
  }
}
