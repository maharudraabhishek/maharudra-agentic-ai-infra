#!/usr/bin/env node
/**
 * scripts/safe-agent-schema-lint.mjs
 *
 * Validates that every `.claude/agents/<name>.md` and
 * `.codex/agents/<name>.toml` declares the D50 SafeAgentSchema with the
 * required fields.
 *
 * Validation rules (per docs/internal/learning-notes/safe-agent-schema.md):
 *
 *   Required keys on every sub-agent:
 *     - required_tools           : non-empty string[]
 *     - refused_tools            : string[]  (may be empty)
 *     - handoff_targets          : non-empty string[]  (each name in 15-roster or "user")
 *     - write_surfaces           : string[]  (may be empty)
 *     - read_surfaces            : non-empty string[]
 *     - permission_scopes        : string[]  (may be empty)
 *     - permission_collection_required : boolean
 *     - deviance_signals         : non-empty string[]
 *     - validation_criteria      : non-empty string[]
 *
 * Exits 0 on full pass. Exits 1 with a per-file failure summary on any
 * violation.
 *
 * Usage:
 *   node scripts/safe-agent-schema-lint.mjs
 *   node scripts/safe-agent-schema-lint.mjs --json
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, basename } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const claudeDir = join(projectRoot, ".claude", "agents");
const codexDir = join(projectRoot, ".codex", "agents");

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

const REQUIRED_KEYS = [
  ["required_tools", "non-empty-string-array"],
  ["refused_tools", "string-array"],
  ["handoff_targets", "non-empty-string-array"],
  ["write_surfaces", "string-array"],
  ["read_surfaces", "non-empty-string-array"],
  ["permission_scopes", "string-array"],
  ["permission_collection_required", "boolean"],
  ["deviance_signals", "non-empty-string-array"],
  ["validation_criteria", "non-empty-string-array"],
];

function stripQuotes(s) {
  let v = s.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

function parseInlineArray(content) {
  // content is the substring between [ and ]
  const items = [];
  let depth = 0;
  let current = "";
  let inString = null;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (inString) {
      current += ch;
      if (ch === inString && content[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "{") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === "]" || ch === "}") {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) items.push(stripQuotes(trimmed));
      current = "";
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) items.push(stripQuotes(trimmed));
  return items;
}

/**
 * Parse the `safe_agent_schema:` YAML block from a .claude/agents/*.md file.
 *
 * Strategy: line-by-line state machine.
 *  - Find the frontmatter (between `---` markers).
 *  - Find the line `safe_agent_schema:` at any indent.
 *  - Iterate forward, parsing direct sub-keys (one indent level deeper than
 *    `safe_agent_schema:`).
 *  - For each sub-key:
 *      * `key: scalar`             → scalar value
 *      * `key: [a, b, c]`          → inline array (may span lines until `]`)
 *      * `key:` followed by indented `- item` lines → dash array
 */
export function parseClaudeSchema(text) {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const body = fmMatch[1];
  const lines = body.split(/\n/);

  let sasIdx = -1;
  let sasIndent = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)safe_agent_schema:\s*$/);
    if (m) {
      sasIdx = i;
      sasIndent = m[1].length;
      break;
    }
  }
  if (sasIdx === -1) return null;

  const subIndent = sasIndent + 2;
  const out = {};
  let i = sasIdx + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const leading = line.match(/^(\s*)/)[1].length;
    if (leading <= sasIndent) break; // back at parent level — done with safe_agent_schema
    if (leading !== subIndent) {
      i += 1;
      continue;
    }
    const kv = line.slice(subIndent).match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1];
    const rest = kv[2];

    if (rest === "") {
      // Either dash array or multi-line bracket array on following lines.
      const next = lines[i + 1] ?? "";
      const nextLeading = next.match(/^(\s*)/)[1].length;
      if (nextLeading > subIndent && next.trim().startsWith("-")) {
        // dash array
        const arr = [];
        let j = i + 1;
        while (j < lines.length) {
          const l = lines[j];
          if (!l.trim()) { j += 1; continue; }
          const lLead = l.match(/^(\s*)/)[1].length;
          if (lLead <= subIndent) break;
          const dm = l.slice(lLead).match(/^-\s+(.*)$/);
          if (!dm) break;
          arr.push(stripQuotes(dm[1]));
          j += 1;
        }
        out[key] = arr;
        i = j;
        continue;
      }
      if (nextLeading > subIndent && next.trim().startsWith("[")) {
        // multi-line bracket array
        let collected = "";
        let j = i + 1;
        while (j < lines.length) {
          collected += lines[j];
          if (lines[j].includes("]")) { j += 1; break; }
          collected += " ";
          j += 1;
        }
        const inner = collected.slice(collected.indexOf("[") + 1, collected.lastIndexOf("]"));
        out[key] = parseInlineArray(inner);
        i = j;
        continue;
      }
      // Key with empty value and no continuation — treat as empty array.
      out[key] = [];
      i += 1;
      continue;
    }

    if (rest.startsWith("[")) {
      // Inline array — may close on this line or span lines until `]`
      if (rest.includes("]")) {
        const inner = rest.slice(1, rest.lastIndexOf("]"));
        out[key] = parseInlineArray(inner);
      } else {
        let collected = rest;
        let j = i + 1;
        while (j < lines.length) {
          collected += " " + lines[j].trim();
          if (lines[j].includes("]")) { j += 1; break; }
          j += 1;
        }
        const inner = collected.slice(1, collected.lastIndexOf("]"));
        out[key] = parseInlineArray(inner);
        i = j;
        continue;
      }
    } else if (rest === "true" || rest === "false") {
      out[key] = rest === "true";
    } else {
      out[key] = stripQuotes(rest);
    }
    i += 1;
  }
  return out;
}

/**
 * Parse the `[safe_agent_schema]` TOML table from a .codex/agents/*.toml
 * file. Uses the same line-by-line approach.
 */
export function parseCodexSchema(text) {
  const lines = text.split(/\n/);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === "[safe_agent_schema]") {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === -1) return null;

  const out = {};
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("[")) break; // next TOML table
    if (line.startsWith("developer_instructions")) break;
    const kv = line.match(/^([a-z_]+)\s*=\s*(.*)$/);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1];
    const rest = kv[2];

    if (rest.startsWith("[")) {
      if (rest.endsWith("]") && balanced(rest)) {
        const inner = rest.slice(1, rest.lastIndexOf("]"));
        out[key] = parseInlineArray(inner);
      } else {
        let collected = rest;
        let j = i + 1;
        while (j < lines.length) {
          collected += " " + lines[j].trim();
          if (lines[j].includes("]")) { j += 1; break; }
          j += 1;
        }
        const inner = collected.slice(1, collected.lastIndexOf("]"));
        out[key] = parseInlineArray(inner);
        i = j;
        continue;
      }
    } else if (rest === "true" || rest === "false") {
      out[key] = rest === "true";
    } else {
      out[key] = stripQuotes(rest);
    }
    i += 1;
  }
  return out;
}

function balanced(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === "[") depth += 1;
    else if (ch === "]") depth -= 1;
  }
  return depth === 0;
}

function validateSchema(schema, fileLabel) {
  const errors = [];
  if (!schema) {
    errors.push(`${fileLabel}: missing safe_agent_schema block`);
    return errors;
  }
  for (const [key, type] of REQUIRED_KEYS) {
    const value = schema[key];
    if (value === undefined) {
      errors.push(`${fileLabel}: missing required key "${key}"`);
      continue;
    }
    if (type === "non-empty-string-array") {
      if (!Array.isArray(value) || value.length === 0) {
        errors.push(`${fileLabel}: "${key}" must be a non-empty string array`);
      }
    } else if (type === "string-array") {
      if (!Array.isArray(value)) {
        errors.push(`${fileLabel}: "${key}" must be a string array (may be empty)`);
      }
    } else if (type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push(`${fileLabel}: "${key}" must be a boolean`);
      }
    }
  }
  if (Array.isArray(schema.handoff_targets)) {
    for (const target of schema.handoff_targets) {
      if (!ROSTER.has(target)) {
        errors.push(`${fileLabel}: handoff_targets includes unknown name "${target}"`);
      }
    }
  }
  return errors;
}

function lintDir(dir, parseFn, ext) {
  let totalErrors = [];
  let entries = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(ext));
  } catch {
    return { errors: [`${dir}: directory missing`], files: 0 };
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const text = readFileSync(fullPath, "utf8");
    const schema = parseFn(text);
    const label = `${basename(dir)}/${entry}`;
    totalErrors = totalErrors.concat(validateSchema(schema, label));
  }
  return { errors: totalErrors, files: entries.length };
}

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json");

  const claudeResult = lintDir(claudeDir, parseClaudeSchema, ".md");
  const codexResult = lintDir(codexDir, parseCodexSchema, ".toml");

  const allErrors = [...claudeResult.errors, ...codexResult.errors];

  if (jsonOut) {
    process.stdout.write(
      JSON.stringify(
        {
          claudeFiles: claudeResult.files,
          codexFiles: codexResult.files,
          errors: allErrors,
          verdict: allErrors.length === 0 ? "PASS" : "FAIL",
        },
        null,
        2,
      ),
    );
    process.exit(allErrors.length === 0 ? 0 : 1);
  }

  process.stdout.write(
    `safe-agent-schema-lint:\n` +
      `  .claude/agents/  ${claudeResult.files} file(s) scanned\n` +
      `  .codex/agents/   ${codexResult.files} file(s) scanned\n\n`,
  );

  if (allErrors.length === 0) {
    process.stdout.write(`PASS — all sub-agent schemas valid.\n`);
    process.exit(0);
  }

  process.stdout.write(`FAIL — ${allErrors.length} violation(s):\n`);
  for (const err of allErrors) {
    process.stdout.write(`  - ${err}\n`);
  }
  process.exit(1);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
