#!/usr/bin/env node
/**
 * scripts/subagent-deviance.mjs
 *
 * CLI to inspect and flip the D50 deviance-check toggle (`deviance_mode`
 * in `subagent-routing.json`).
 *
 * Mirrors the interface and exit-code contract of
 * `scripts/subagent-routing.mjs`. Both scripts read/write the same file
 * (`subagent-routing.json`) using read-modify-write, so flipping one toggle
 * never clobbers the other.
 *
 * When `deviance_mode` is `"on"` (the default), `subagent-telemetry.mjs`
 * records PreToolUse / PostToolUse / PermissionRequest events, and
 * `subagent-deviance-check.mjs --dry-run` can run the detector suite on
 * demand. The Codex config intentionally does not register this detector on
 * Stop because Stop fires at ordinary turn boundaries.
 *
 * Missing key in file → coerces to `"on"`.
 * Any value other than the literal string `"off"` → coerces to `"on"`.
 *
 * Usage:
 *   node scripts/subagent-deviance.mjs status    — print routing + deviance modes and source
 *   node scripts/subagent-deviance.mjs on        — set deviance_mode to "on"
 *   node scripts/subagent-deviance.mjs off       — set deviance_mode to "off"
 *   node scripts/subagent-deviance.mjs get-mode  — print exactly "on" or "off", no newline
 *
 * Exit codes:
 *   0   on success (any recognised subcommand)
 *   1   on unknown subcommand or write failure
 *
 * Always exits 0 on read operations — a missing or malformed file defaults
 * to `"on"` (detection is on by default; the user must explicitly opt out).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const togglePath = join(projectRoot, "subagent-routing.json");
const stateDir = join(projectRoot, ".agentic-local");
const alertsPath = join(stateDir, "deviance-alerts.jsonl");

const DEFAULT_DEVIANCE_MODE = "on";
const DEFAULT_ROUTING_MODE = "auto";

/**
 * Read `deviance_mode` from `subagent-routing.json`.
 *
 * @returns {{ devianceMode: "on" | "off", routingMode: "auto" | "manual", source: string }}
 *   Always returns a valid object. Falls back to defaults when the file is
 *   missing or unparseable.
 */
function readToggles() {
  if (!existsSync(togglePath)) {
    return {
      devianceMode: DEFAULT_DEVIANCE_MODE,
      routingMode: DEFAULT_ROUTING_MODE,
      source: "default (subagent-routing.json missing)",
    };
  }
  try {
    const raw = readFileSync(togglePath, "utf8");
    const parsed = JSON.parse(raw);

    const routingRaw = String(parsed.mode ?? DEFAULT_ROUTING_MODE).toLowerCase();
    const routingMode = routingRaw === "manual" ? "manual" : "auto";

    const devianceRaw = String(parsed.deviance_mode ?? DEFAULT_DEVIANCE_MODE).toLowerCase();
    const devianceMode = devianceRaw === "off" ? "off" : "on";

    return { devianceMode, routingMode, source: togglePath };
  } catch (err) {
    return {
      devianceMode: DEFAULT_DEVIANCE_MODE,
      routingMode: DEFAULT_ROUTING_MODE,
      source: `default (parse error: ${err.message})`,
    };
  }
}

/**
 * Write `deviance_mode` to `subagent-routing.json` using read-modify-write.
 *
 * Preserves all existing keys (including `mode`, `description`, etc.) so
 * that flipping the deviance toggle never clobbers the routing toggle or
 * any other peer key.
 *
 * @param {"on" | "off"} devianceMode - The new value to write.
 * @throws {Error} If the file cannot be written.
 */
function writeDevianceMode(devianceMode) {
  let existing = {};
  if (existsSync(togglePath)) {
    try {
      existing = JSON.parse(readFileSync(togglePath, "utf8"));
    } catch {
      // Corrupt file — start fresh.
    }
  }
  const body = {
    ...existing,
    deviance_mode: devianceMode,
    description:
      "Sub-agent routing + deviance check toggles. 'mode' (auto|manual) controls the director hook; 'deviance_mode' (on|off) controls D50 deviance detection and tool-event telemetry. Read by scripts/subagent-routing-hook.mjs, scripts/subagent-telemetry.mjs, and scripts/subagent-deviance-check.mjs.",
    flipWith: "node scripts/subagent-routing.mjs on|off  |  node scripts/subagent-deviance.mjs on|off",
    statusWith: "node scripts/subagent-routing.mjs status  |  node scripts/subagent-deviance.mjs status",
  };
  writeFileSync(togglePath, JSON.stringify(body, null, 2) + "\n", "utf8");
}

const cmd = (process.argv[2] ?? "status").toLowerCase();

switch (cmd) {
  case "status": {
    const { devianceMode, routingMode, source } = readToggles();
    process.stdout.write(
      `routing_mode:   ${routingMode}\ndeviance_mode:  ${devianceMode}\nsource:         ${source}\n\n`,
    );
    if (devianceMode === "on") {
      process.stdout.write(
        "D50 deviance detection is ON. Tool-event telemetry is recorded.\n" +
          "Automatic Codex Stop-hook detection is disabled; run an audit manually with:\n" +
          "  node scripts/subagent-deviance-check.mjs --dry-run\n" +
          "Disable with: node scripts/subagent-deviance.mjs off\n",
      );
    } else {
      process.stdout.write(
        "D50 deviance detection is OFF. Tool-event records are dropped;\n" +
          "SubagentStart/Stop records are still written.\n" +
          "Enable with: node scripts/subagent-deviance.mjs on\n",
      );
    }
    process.exit(0);
    break;
  }
  case "on": {
    try {
      writeDevianceMode("on");
      process.stdout.write("Sub-agent deviance check: ON (deviance_mode=on)\n");
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Write failed: ${err.message}\n`);
      process.exit(1);
    }
    break;
  }
  case "off": {
    try {
      writeDevianceMode("off");
      process.stdout.write("Sub-agent deviance check: OFF (deviance_mode=off)\n");
      // Append an audit record so the alerts log preserves a trace of the flip.
      try {
        if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
        const auditRecord = {
          ts: new Date().toISOString(),
          event: "deviance_mode_flipped",
          new_state: "off",
          by: "subagent-deviance.mjs CLI",
        };
        appendFileSync(alertsPath, JSON.stringify(auditRecord) + "\n", "utf8");
      } catch {
        // Non-fatal: audit write failure must not prevent the toggle from succeeding.
      }
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Write failed: ${err.message}\n`);
      process.exit(1);
    }
    break;
  }
  case "get-mode": {
    const { devianceMode } = readToggles();
    // Contract: print exactly "on" or "off" with no newline, no labels.
    process.stdout.write(devianceMode);
    process.exit(0);
    break;
  }
  default: {
    process.stderr.write(
      `Unknown subcommand: ${cmd}\n` +
        `Usage:\n` +
        `  node scripts/subagent-deviance.mjs status\n` +
        `  node scripts/subagent-deviance.mjs on\n` +
        `  node scripts/subagent-deviance.mjs off\n` +
        `  node scripts/subagent-deviance.mjs get-mode\n`,
    );
    process.exit(1);
  }
}
