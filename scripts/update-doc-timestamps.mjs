#!/usr/bin/env node
/**
 * update-doc-timestamps.mjs
 *
 * PURPOSE:
 *   Fires via the PostToolUse hook after every Write or Edit tool call.
 *   When the edited file is one of the tracked documentation files, it finds
 *   the last `<!-- Last updated: ... -->` HTML comment in the file and
 *   replaces it with a fresh dual-format timestamp. If no such comment exists,
 *   it appends one at the end of the file.
 *
 * TRACKED FILES (paths relative to project root):
 *   STATUS.md, kb.md, STRUCTURE.md, CHAT_CONTEXT.md
 *
 * HOOK SETUP (in .claude/settings.json — PostToolUse):
 *   "PostToolUse": [
 *     {
 *       "matcher": "Write|Edit",
 *       "hooks": [
 *         { "type": "command", "command": "node scripts/update-doc-timestamps.mjs" }
 *       ]
 *     }
 *   ]
 *
 * STDIN CONTRACT:
 *   Claude Code delivers a JSON object on stdin after each tool use:
 *   {
 *     "tool_name":    "Write" | "Edit",
 *     "tool_input":   { "file_path": "/absolute/path/to/file", ... },
 *     "tool_response": { ... }
 *   }
 *   Any parse failure or missing file_path causes a silent no-op exit.
 *
 * RESOURCE COST:
 *   Zero tokens. Zero API calls. Zero network.
 *   Non-matching files: one stdin read, then immediate exit (~5 ms).
 *   Matching files: one stdin read + one file read + one file write (~20 ms).
 *
 * TIMESTAMP FORMAT (identical to session-summary.mjs):
 *   "YYYY-MM-DD HH:MM <LocalTZ> (HH:MM UTC)"
 *   Example: "2026-05-16 07:30 IST (02:00 UTC)"
 *   Local timezone is detected at call time via Intl — correct on any machine.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Set of doc file paths (relative to project root, POSIX separators) that
 *  receive automatic timestamp updates. */
const TRACKED = new Set([
  'STATUS.md',
  'kb.md',
  'STRUCTURE.md',
  'CHAT_CONTEXT.md',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a Date as "YYYY-MM-DD HH:MM <LocalTZ> (HH:MM UTC)".
 *
 * Identical logic to session-summary.mjs. Both scripts must produce the same
 * format so timestamps are visually consistent across all tracked files.
 *
 * @param {Date} d
 * @returns {string}
 */
function formatDateTime(d) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzAbbr = new Intl.DateTimeFormat('en', { timeZoneName: 'short', timeZone: tz })
    .formatToParts(d)
    .find(p => p.type === 'timeZoneName')?.value ?? tz;

  const localFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(
    localFmt.formatToParts(d)
      .filter(p => p.type !== 'literal')
      .map(p => [p.type, p.value])
  );
  const h = parts.hour === '24' ? '00' : (parts.hour ?? '00');
  const utcH = String(d.getUTCHours()).padStart(2, '0');
  const utcM = String(d.getUTCMinutes()).padStart(2, '0');
  return `${parts.year}-${parts.month}-${parts.day} ${h}:${parts.minute ?? '00'} ${tzAbbr} (${utcH}:${utcM} UTC)`;
}

/**
 * Reads all of stdin as a UTF-8 string.
 * Resolves with an empty string if stdin closes immediately.
 *
 * @returns {Promise<string>}
 */
function readStdin() {
  return new Promise(resolve => {
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
    process.stdin.resume();
  });
}

/**
 * Finds the last `<!-- Last updated: ... -->` comment in `content` and
 * replaces it with `newTag`. If no such comment exists, appends `newTag`
 * on a new line at the end of the file.
 *
 * The replace targets any content between `<!-- Last updated:` and the next
 * `-->`, so stage labels like "— Stage 5 complete" are replaced with the
 * plain timestamp going forward. Stage annotations belong in the file body,
 * not the bottom timestamp comment.
 *
 * @param {string} content  - Current file text.
 * @param {string} newTag   - Replacement comment, e.g. "<!-- Last updated: ... -->".
 * @returns {string}        - Updated file text.
 */
function injectTimestamp(content, newTag) {
  const MARKER = '<!-- Last updated:';
  const lastIdx = content.lastIndexOf(MARKER);

  if (lastIdx !== -1) {
    const endIdx = content.indexOf('-->', lastIdx);
    if (endIdx !== -1) {
      return content.slice(0, lastIdx) + newTag + content.slice(endIdx + 3);
    }
  }

  // No existing marker — append after trimming trailing whitespace.
  return content.trimEnd() + '\n' + newTag + '\n';
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const raw = await readStdin();

  let payload;
  try { payload = JSON.parse(raw); } catch { return; }

  // Extract the file path written or edited by Claude.
  const filePath = payload?.tool_input?.file_path;
  if (!filePath) return;

  // Normalise to a root-relative POSIX path for Set lookup.
  const rel = relative(ROOT, resolve(filePath)).replace(/\\/g, '/');
  if (!TRACKED.has(rel)) return;

  if (!existsSync(filePath)) return;

  let content;
  try { content = readFileSync(filePath, 'utf8'); } catch { return; }

  const ts = formatDateTime(new Date());
  const newTag = `<!-- Last updated: ${ts} -->`;
  const updated = injectTimestamp(content, newTag);

  // Skip write if nothing changed (e.g. timestamp already current to the minute).
  if (updated === content) return;

  try {
    writeFileSync(filePath, updated, 'utf8');
    console.log(`[doc-timestamps] ${rel} — Last updated: ${ts}`);
  } catch {
    // Never block agent output on a timestamp write failure.
  }
}

main();
