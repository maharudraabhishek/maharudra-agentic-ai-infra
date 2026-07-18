#!/usr/bin/env node
/**
 * session-summary.mjs
 *
 * Purpose:
 *   Tracks files modified during the current Claude Code session and writes a
 *   lightweight session-summary.md so the user can copy it to Claude Web for
 *   review, or hand it off to Codex.
 *
 * ─── TOKEN / RESOURCE COST OF THIS SCRIPT ────────────────────────────────────
 *   This script is a LOCAL shell process. It does exactly these things:
 *     1. Read  .agentic-local/session-state.json    (one disk read)
 *     2. Scan  packages/, docs/, scripts/, .claude/ (key dirs only — no node_modules)
 *     3. Write .agentic-local/session-state.json    (one disk write)
 *     4. Write session-summary.md                  (one disk write)
 *     5. Print one line to stdout                  (always — brief status line)
 *   ZERO API calls. ZERO network requests. ZERO tokens consumed.
 *   Total cost: ~10–40 ms of local disk I/O and a shallow directory walk.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * How it works:
 *   Fires via the Stop hook after every Claude Code response. Requires the
 *   Stop hook in .claude/settings.json to be structured as:
 *
 *     "Stop": [
 *       { "type": "command", "command": "node scripts/session-summary.mjs" }
 *     ]
 *
 *   NOT wrapped in an extra { "hooks": [...] } object — that nesting is wrong
 *   and causes the hook to be silently ignored by Claude Code.
 *
 * State file:   .agentic-local/session-state.json   (gitignored — local only)
 * Output file:  session-summary.md                  (project root — gitignored)
 *
 * Usage (called automatically by Stop hook; also safe to run manually):
 *   node scripts/session-summary.mjs
 *
 * To reset the session (start fresh file list for today):
 *   node scripts/session-summary.mjs reset
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'fs';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT         = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR    = resolve(ROOT, '.agentic-local');
const STATE_PATH   = resolve(STATE_DIR, 'session-state.json');
const SUMMARY_PATH = resolve(ROOT, 'session-summary.md');

// ─── Scan configuration ───────────────────────────────────────────────────────

const SCAN_DIRS = ['packages', 'docs', 'scripts', '.claude'];

const SCAN_ROOT_FILES = [
  'README.md', 'AGENTS.md', 'CLAUDE.md', 'CUSTOMIZE_WITH_CODEX.md',
  'package.json', 'pnpm-workspace.yaml', 'quota.config.json',
  'STATUS.md', 'kb.md',
];

const EXCLUDE_DIR_NAMES = new Set([
  'node_modules', 'dist', '.agentic-local', 'coverage',
  '.git', '__pycache__', '.cache',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns today's UTC date key (e.g. "2026-05-16").
 * @returns {string}
 */
function getDayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Formats a Date (or ISO string) as "YYYY-MM-DD HH:MM <LocalTZ> (HH:MM UTC)".
 *
 * Example: "2026-05-16 06:39 IST (01:09 UTC)"
 *
 * The local timezone is detected at call time via Intl so the output is always
 * correct regardless of which machine runs the script.
 *
 * @param {Date|string} dateOrIso
 * @returns {string}
 */
function formatDateTime(dateOrIso) {
  const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;

  // Detect the local IANA timezone and derive its short abbreviation.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzAbbr = new Intl.DateTimeFormat('en', { timeZoneName: 'short', timeZone: tz })
    .formatToParts(d)
    .find(p => p.type === 'timeZoneName')?.value ?? tz;

  // Format local date and time parts (hour12: false gives 00–23 range).
  const localFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const partsMap = Object.fromEntries(
    localFmt.formatToParts(d)
      .filter(p => p.type !== 'literal')
      .map(p => [p.type, p.value])
  );
  // Some runtimes return "24" for the midnight hour when hour12 is false; normalise.
  const localHour = partsMap.hour === '24' ? '00' : (partsMap.hour ?? '00');
  const localDate = `${partsMap.year}-${partsMap.month}-${partsMap.day}`;
  const localTime = `${localHour}:${partsMap.minute ?? '00'}`;

  // UTC time for the right-hand side of the dual format.
  const utcHH = String(d.getUTCHours()).padStart(2, '0');
  const utcMM = String(d.getUTCMinutes()).padStart(2, '0');

  return `${localDate} ${localTime} ${tzAbbr} (${utcHH}:${utcMM} UTC)`;
}

/**
 * Returns date key from a specific Date object.
 * @param {Date} d
 * @returns {string}
 */
function getDayKeyFrom(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns elapsed time as a human-readable string (e.g. "1h 23m" or "47m").
 * @param {string} startIso - Session start ISO timestamp.
 * @returns {string}
 */
function getElapsed(startIso) {
  const diffMs = Date.now() - new Date(startIso).getTime();
  const totalMin = Math.floor(diffMs / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Recursively walks a directory, skipping excluded dirs.
 * @param {string} dir
 * @param {string[]} results
 */
function walkDir(dir, results) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) walkDir(fullPath, results);
    else if (entry.isFile()) results.push(fullPath);
  }
}

/**
 * Collects all files in the scan scope.
 * @returns {string[]}
 */
function collectScanFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const absDir = resolve(ROOT, dir);
    if (existsSync(absDir)) walkDir(absDir, files);
  }
  for (const rootFile of SCAN_ROOT_FILES) {
    const absFile = resolve(ROOT, rootFile);
    if (existsSync(absFile)) files.push(absFile);
  }
  return files;
}

/**
 * Returns files modified at or after sinceMs.
 * @param {number} sinceMs
 * @returns {{ relPath: string, mtime: string }[]}
 */
function findModifiedFiles(sinceMs) {
  const modified = [];
  for (const absPath of collectScanFiles()) {
    let stat;
    try { stat = statSync(absPath); } catch { continue; }
    if (stat.mtimeMs >= sinceMs) {
      modified.push({
        relPath: relative(ROOT, absPath).replaceAll('\\', '/'),
        mtime: stat.mtime.toISOString(),
      });
    }
  }
  modified.sort((a, b) => a.mtime.localeCompare(b.mtime));
  return modified;
}

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ dayKey: string, sessionStart: string, responseCount: number }} SessionState
 */

/**
 * Loads session state, resetting if it belongs to a different UTC day.
 * @returns {SessionState}
 */
function loadState() {
  const today = getDayKey();
  if (!existsSync(STATE_PATH)) {
    return { dayKey: today, sessionStart: new Date().toISOString(), responseCount: 0 };
  }
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    if (raw.dayKey !== today) {
      return { dayKey: today, sessionStart: new Date().toISOString(), responseCount: 0 };
    }
    return raw;
  } catch {
    return { dayKey: today, sessionStart: new Date().toISOString(), responseCount: 0 };
  }
}

/**
 * Saves session state to .agentic-local/session-state.json.
 * @param {SessionState} state
 */
function saveState(state) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

// ─── Summary writer ───────────────────────────────────────────────────────────

/**
 * Writes session-summary.md at the project root.
 * @param {SessionState} state
 * @param {{ relPath: string, mtime: string }[]} modifiedFiles
 */
function writeSummary(state, modifiedFiles) {
  const now = new Date();
  const fileList = modifiedFiles.length === 0
    ? '_No files modified yet this session._'
    : modifiedFiles.map(f => `- \`${f.relPath}\`  _(${f.mtime.slice(11, 16)} UTC)_`).join('\n');

  const content = `# Claude Code — Session Summary
<!-- Auto-generated by scripts/session-summary.mjs via Stop hook. Do not edit by hand. -->

| Field | Value |
| --- | --- |
| Session started | ${formatDateTime(state.sessionStart)} |
| Last updated | ${formatDateTime(now)} |
| Duration | ${getElapsed(state.sessionStart)} |
| Responses this session | ${state.responseCount} |
| Files modified | ${modifiedFiles.length} |

## Files Modified This Session

${fileList}

---

**For the current operational state and verification evidence:**
Read \`STATUS.md\`, \`kb.md\`, and the active stage's LIFO
\`prompts/stage-{N}[-{sub}]/verification-summary.md\`.

**To review on Claude Web:**
Copy this file content into Claude Web and ask it to review the changes.

**Core rules reminder:**
- pnpm only (use \`pnpm.cmd\` on Windows PowerShell)
- TypeScript + OOP/SOLID + clean architecture
- All packages private: true — do not publish
- No paid provider SDKs, no external LLM calls
- \`references/\` is read-only reference material
- Fail closed on unsafe or ambiguous behavior

**Stop hook fix reminder:**
If this file is not updating automatically, check \`.claude/settings.json\`.
The Stop hook commands must be direct objects in the array — NOT wrapped in
an extra \`{ "hooks": [...] }\` object. Correct format:

\`\`\`json
"Stop": [
  { "type": "command", "command": "node scripts/quota-check.mjs claude increment-and-check" },
  { "type": "command", "command": "node scripts/session-summary.mjs" }
]
\`\`\`
`;

  writeFileSync(SUMMARY_PATH, content, 'utf8');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

function main() {
  const action = process.argv[2];

  if (action === 'reset') {
    const today = getDayKey();
    const fresh = { dayKey: today, sessionStart: new Date().toISOString(), responseCount: 0 };
    saveState(fresh);
    writeSummary(fresh, []);
    console.log(`✓  Session reset ${formatDateTime(fresh.sessionStart)} — session-summary.md cleared`);
    return;
  }

  const state = loadState();
  state.responseCount++;
  saveState(state);

  const modifiedFiles = findModifiedFiles(new Date(state.sessionStart).getTime());
  writeSummary(state, modifiedFiles);

  console.log(
    `[session-summary] #${state.responseCount} | ` +
    `started ${formatDateTime(state.sessionStart)} | ` +
    `elapsed ${getElapsed(state.sessionStart)} | ` +
    `${modifiedFiles.length} file(s) modified`
  );
  // Reminder shown at the start of every next Claude turn via hook feedback.
  // This ensures RESULTS_SUMMARY is never forgotten after a multi-step task.
  console.log(
    `⚠️  REMINDER → After completing any multi-step task, output RESULTS_SUMMARY block ` +
    `(see CLAUDE.md) as the FINAL part of the response. Do not end the response without it.`
  );
}

main();
