#!/usr/bin/env node
/**
 * scripts/subagent-routing-hook.mjs
 *
 * UserPromptSubmit hook for BOTH Claude Code and Codex CLI.
 *
 * Reads `subagent-routing.json` at the project root and emits a JSON envelope
 * on stdout that the host stack injects as `additionalContext` alongside the
 * user's prompt. Always exits 0 — a misconfigured toggle never blocks a prompt.
 *
 * Behaviour matrix:
 *
 *   mode "auto"  + prompt names a known sub-agent (F3 override regex)
 *      → emit a "skip director; spawn <name>" envelope. Saves one director turn.
 *
 *   mode "auto"  + prompt does NOT name a sub-agent
 *      → emit the standard "spawn director" envelope.
 *
 *   mode "manual"
 *      → emit nothing (silent). The user expects to drive sub-agents directly.
 *
 * Stack-aware injection (F10): the envelope text is tailored at runtime to
 * mention the host's actual invocation primitive — Claude Code's Agent tool
 * call vs Codex CLI's sub-agent spawn — based on env vars the hosts set.
 * If neither is detected, fall back to mentioning both.
 *
 * Token cost when ON: ≈ 200 tokens (≈ 850 chars) per prompt for the standard
 * envelope; ≈ 80 tokens for the override fast-path.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const togglePath = join(projectRoot, "subagent-routing.json");

const DEFAULT_MODE = "auto";

const ROSTER = [
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
];

function loadMode() {
  try {
    if (!existsSync(togglePath)) return DEFAULT_MODE;
    const raw = readFileSync(togglePath, "utf8");
    const parsed = JSON.parse(raw);
    const mode = String(parsed.mode ?? DEFAULT_MODE).toLowerCase();
    return mode === "manual" ? "manual" : "auto";
  } catch {
    return DEFAULT_MODE;
  }
}

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

/**
 * Detect the host stack from environment variables.
 *  - Claude Code sets CLAUDE_CODE_* env vars when invoking hooks.
 *  - Codex CLI sets CODEX_* env vars.
 *  - Unknown / both → fall back to dual-stack prose.
 */
function detectStack() {
  const env = process.env;
  const claudeSignals = Object.keys(env).some((k) => k.startsWith("CLAUDE_CODE_") || k === "CLAUDECODE");
  const codexSignals = Object.keys(env).some((k) => k.startsWith("CODEX_"));
  if (claudeSignals && !codexSignals) return "claude";
  if (codexSignals && !claudeSignals) return "codex";
  return "both";
}

/**
 * Parse the prompt for an explicit sub-agent name. Anchored phrases only —
 * "use the debugger", "have the documentation sub-agent handle this", etc.
 * Returns the matched roster name or null. Never returns "director" — that
 * would defeat the override.
 */
function detectUserOverride(promptText) {
  if (!promptText || typeof promptText !== "string") return null;
  const text = promptText.toLowerCase();
  const namePattern = ROSTER.filter((n) => n !== "director").join("|");
  const patterns = [
    new RegExp(`use the (${namePattern})(\\s+sub-?agent)?\\b`, "i"),
    new RegExp(`have the (${namePattern})(\\s+sub-?agent)?\\s+handle`, "i"),
    new RegExp(`let the (${namePattern})(\\s+sub-?agent)?\\s+`, "i"),
    new RegExp(`route (this )?to (the )?(${namePattern})\\b`, "i"),
    new RegExp(`spawn (the )?(${namePattern})\\b`, "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const captured = m.find((g) => g && ROSTER.includes(g.toLowerCase()));
      if (captured && ROSTER.includes(captured.toLowerCase())) {
        return captured.toLowerCase();
      }
      for (const group of m.slice(1)) {
        if (group && ROSTER.includes(group.toLowerCase())) {
          return group.toLowerCase();
        }
      }
    }
  }
  return null;
}

function buildDirectorBrief(stack) {
  const claudeLine =
    'Claude Code: call Agent with subagent_type:"director" and pass the user\'s prompt verbatim.';
  const codexLine =
    "Codex CLI: spawn the director sub-agent defined at .codex/agents/director.toml.";
  const head =
    "SUB-AGENT AUTO-ROUTING IS ON (toggle: subagent-routing.json → auto). " +
    "Before doing anything else with this prompt, route it through the director sub-agent. ";
  const stackLine =
    stack === "claude"
      ? claudeLine + " "
      : stack === "codex"
        ? codexLine + " "
        : claudeLine + " " + codexLine + " ";
  const tail =
    "The director decomposes the task, picks specialists from the 14-roster (planner, design-architect, " +
    "implementor, clean-coder, refactorer, debugger, validator, executor, documentation, security-reviewer, " +
    "release-manager, ai-agentic-specialist, web-extractor, web-scraper), and ends with HANDBACK → <next>. " +
    "If this prompt arrives while work is already in progress, preserve unfinished work unless the user explicitly cancels or redirects it; merge additive constraints, answer status requests briefly, and keep pending validation/security/docs gates. " +
    "Honor the chain; skipping validator before RESULTS_SUMMARY is forbidden. " +
    "Override: if the user explicitly named a sub-agent in this prompt, honor that and skip the director. " +
    "Disable: node scripts/subagent-routing.mjs off";
  return head + stackLine + tail;
}

function buildOverrideBrief(stack, agentName) {
  const claudeLine = `Claude Code: call Agent with subagent_type:"${agentName}" and pass the user's prompt verbatim.`;
  const codexLine = `Codex CLI: spawn the sub-agent defined at .codex/agents/${agentName}.toml.`;
  const head =
    "SUB-AGENT AUTO-ROUTING (auto mode) — USER OVERRIDE DETECTED. " +
    `The prompt explicitly names "${agentName}". Skip the director. ` +
    "If work is already in progress, preserve unfinished work unless the user explicitly cancels or redirects it; merge additive constraints and keep pending validation/security/docs gates. ";
  const stackLine =
    stack === "claude"
      ? claudeLine
      : stack === "codex"
        ? codexLine
        : claudeLine + " " + codexLine;
  return head + stackLine;
}

async function main() {
  const mode = loadMode();
  if (mode !== "auto") {
    process.exit(0);
  }

  const stack = detectStack();
  const raw = await readStdin();
  let promptText = "";
  try {
    const payload = JSON.parse(raw);
    promptText = payload.prompt ?? payload.user_prompt ?? payload.userPrompt ?? "";
  } catch {
    promptText = "";
  }

  const override = detectUserOverride(promptText);
  const additionalContext = override
    ? buildOverrideBrief(stack, override)
    : buildDirectorBrief(stack);

  const envelope = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  };

  process.stdout.write(JSON.stringify(envelope));
  process.exit(0);
}

main();
