#!/usr/bin/env node
/**
 * quota-check.mjs
 *
 * Purpose:
 *   Tracks AI provider usage against plan-appropriate budgets and warns when
 *   15% of the period quota remains, prompting an update to the active stage
 *   verification summary before another provider resumes the work.
 *
 * ─── TOKEN / RESOURCE COST OF THIS SCRIPT ────────────────────────────────────
 *   This script is a LOCAL shell process. It does exactly three things:
 *     1. Read  .agentic-local/quota-state.json  (one disk read)
 *     2. Write .agentic-local/quota-state.json  (one disk write, only on increment)
 *     3. Print a line to stdout                 (only when ≥ 50% budget used)
 *   ZERO API calls. ZERO network requests. ZERO tokens consumed.
 *   Total cost: a few milliseconds of local I/O.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Why separate reset cycles per provider:
 *   Claude  → resets DAILY  (rolling ~5 h window; tracked per UTC day here).
 *             Claude has NO weekly quota. It has per-day message limits that vary
 *             by plan (Free ~20/day, Pro ~100/day, Max ~500/day). Claude shows
 *             a limit-hit message ONLY AFTER the limit is reached — no proactive
 *             warning exists, which is exactly why this tracking exists.
 *
 *   Codex   → resets WEEKLY (Monday UTC; tracked per ISO week here).
 *             Codex has a weekly "fast requests" quota (Free ~5/wk, Pro ~10/wk).
 *             Codex shows remaining count in the UI but does NOT push a "hand off
 *             now" warning at 15% remaining — this script fills that gap.
 *
 * Plan defaults (resolved from quota.config.json → plan field):
 *
 *   Claude:   free  → 20 messages/day
 *             pro   → 100 messages/day
 *             max   → 500 messages/day
 *             api   → 500 messages/day (no hard limit; user should customise)
 *
 *   Codex:    free  → 5  fast-requests/week
 *             pro   → 10 fast-requests/week
 *             api   → 50 fast-requests/week (no hard limit; user should customise)
 *
 * Usage:
 *   node scripts/quota-check.mjs <provider> [action]
 *
 *   provider:  claude | codex
 *   action:    increment-and-check  (default) — increment counter then warn if needed
 *              check                           — read-only warn check, no increment
 *              status                          — full report for all providers
 *              reset                           — zero current period counter
 *              known-limits                    — print the plan limits reference table
 *
 * Called by:
 *   Claude Code: Stop hook in .claude/settings.json — fires automatically after
 *                every Claude response (zero user action needed).
 *   Codex:       AGENTS.md § Weekly Quota — run manually at session start/end.
 *
 * Output levels (by % of period budget consumed):
 *   < 50%   →  silent
 *   50–84%  →  single info line
 *   ≥ 85%   →  ⚠️  warning block + stage-summary prompt
 *   100%    →  🚨  exhausted block + stage-summary prompt
 *
 * State file:  .agentic-local/quota-state.json  (gitignored — local only)
 * Config file: quota.config.json               (committed — edit to set your plan)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT        = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH  = resolve(ROOT, '.agentic-local', 'quota-state.json');
const CONFIG_PATH = resolve(ROOT, 'quota.config.json');

// ─── Plan defaults ────────────────────────────────────────────────────────────

/**
 * Known budget defaults per provider plan.
 *
 * Claude uses a DAILY reset cycle — its limits are per-day message counts.
 * Codex  uses a WEEKLY reset cycle — its limits are per-week fast-request counts.
 *
 * Values are approximate published figures. The user can override `budget` in
 * quota.config.json to match their actual account limits.
 *
 * @type {Record<string, Record<string, { budget: number, unit: string, resetCycle: 'daily' | 'weekly' }>>}
 */
const PLAN_DEFAULTS = {
  claude: {
    free: { budget: 20,  unit: 'messages',      resetCycle: 'daily'  },
    pro:  { budget: 100, unit: 'messages',      resetCycle: 'daily'  },
    max:  { budget: 500, unit: 'messages',      resetCycle: 'daily'  },
    // API key: no hard message cap — user should set a comfortable daily budget
    api:  { budget: 500, unit: 'messages',      resetCycle: 'daily'  },
  },
  codex: {
    free: { budget: 5,   unit: 'fast-requests', resetCycle: 'weekly' },
    pro:  { budget: 10,  unit: 'fast-requests', resetCycle: 'weekly' },
    // API key: no weekly fast-request cap — user should set a comfortable weekly budget
    api:  { budget: 50,  unit: 'fast-requests', resetCycle: 'weekly' },
  },
};

// ─── Period key helpers ───────────────────────────────────────────────────────

/**
 * Returns a UTC day key for daily-reset providers (Claude), e.g. "2026-05-13".
 *
 * Uses UTC so the reset is consistent regardless of the user's local timezone.
 * Claude's actual reset is a rolling ~5 h window, not strict UTC midnight, but
 * UTC midnight is a reasonable approximation for tracking purposes.
 *
 * @param {Date} [date=new Date()]
 * @returns {string} day key in "YYYY-MM-DD" format
 */
function getDayKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns an ISO 8601 week key for weekly-reset providers (Codex), e.g. "2026-W20".
 *
 * ISO weeks start on Monday. The first week of the year contains the first Thursday.
 * Codex resets on Monday UTC, which aligns exactly with ISO week boundaries.
 *
 * @param {Date} [date=new Date()]
 * @returns {string} week key in "YYYY-WNN" format
 */
function getWeekKey(date = new Date()) {
  // Work in UTC to avoid timezone shifts changing the day
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayOfWeek = d.getUTCDay() || 7; // 1=Mon … 7=Sun

  // Shift to the nearest Thursday — determines which ISO year the week belongs to
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);

  const yearStart  = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);

  return `${d.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Returns the current period key for a given reset cycle.
 *
 * @param {'daily' | 'weekly'} resetCycle
 * @returns {string} period key appropriate for the cycle
 */
function getPeriodKey(resetCycle) {
  return resetCycle === 'daily' ? getDayKey() : getWeekKey();
}

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Resolves the effective configuration for a single provider.
 *
 * Resolution order (later wins):
 *   1. PLAN_DEFAULTS[provider][plan]  — built-in plan preset
 *   2. quota.config.json providers[provider].budget  — explicit override
 *
 * This means setting `plan: "pro"` gives sensible defaults, and adding
 * `budget: 80` to the config overrides just the budget without changing the unit
 * or resetCycle.
 *
 * @param {string} providerName - "claude" or "codex"
 * @param {Record<string, unknown>} rawProviderConfig - the provider block from quota.config.json
 * @param {number} globalThreshold - warningThresholdPercent from the root config
 * @returns {{ budget: number, unit: string, resetCycle: 'daily' | 'weekly', warningThresholdPercent: number }}
 */
function resolveProviderConfig(providerName, rawProviderConfig, globalThreshold) {
  const planName    = rawProviderConfig?.plan ?? 'pro';
  const planDefaults = PLAN_DEFAULTS[providerName]?.[planName] ?? PLAN_DEFAULTS[providerName]?.pro;

  return {
    ...planDefaults,
    // Explicit budget in config overrides the plan default
    budget: rawProviderConfig?.budget ?? planDefaults.budget,
    // Per-provider threshold override is optional
    warningThresholdPercent: rawProviderConfig?.warningThresholdPercent ?? globalThreshold,
  };
}

/**
 * Loads and resolves quota.config.json.
 *
 * Falls back to plan-default configs if the file is missing or malformed,
 * so a broken config file never crashes the Stop hook mid-session.
 *
 * @returns {Record<string, { budget: number, unit: string, resetCycle: 'daily' | 'weekly', warningThresholdPercent: number }>}
 */
function loadConfig() {
  const globalThreshold = 85;

  // Safe fallback: pro defaults for both providers
  const fallback = {
    claude: resolveProviderConfig('claude', { plan: 'pro' }, globalThreshold),
    codex:  resolveProviderConfig('codex',  { plan: 'pro' }, globalThreshold),
  };

  if (!existsSync(CONFIG_PATH)) return fallback;

  try {
    const raw       = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const threshold = raw.warningThresholdPercent ?? globalThreshold;
    const result    = { ...fallback };

    for (const [name, providerRaw] of Object.entries(raw.providers ?? {})) {
      if (PLAN_DEFAULTS[name]) {
        result[name] = resolveProviderConfig(name, providerRaw, threshold);
      }
    }

    return result;
  } catch {
    // Malformed config — use safe fallback so the Stop hook never crashes
    return fallback;
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * Loads .agentic-local/quota-state.json.
 *
 * State is keyed per-provider so each provider can have its own period key and
 * reset independently. Claude resets when the UTC day changes; Codex resets when
 * the ISO week changes (Monday UTC).
 *
 * A provider's counter is zeroed automatically when its period key is stale
 * (i.e. the reset cycle has elapsed). The two providers reset independently —
 * Codex resetting on Monday does not affect Claude's daily counter.
 *
 * @returns {Record<string, { periodKey: string, used: number }>}
 */
function loadState() {
  if (!existsSync(STATE_PATH)) return {};

  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Returns the current period state for a provider, resetting if the period has elapsed.
 *
 * @param {Record<string, { periodKey: string, used: number }>} state - full state object
 * @param {string} providerName
 * @param {'daily' | 'weekly'} resetCycle
 * @returns {{ periodKey: string, used: number }}
 */
function getProviderState(state, providerName, resetCycle) {
  const currentKey = getPeriodKey(resetCycle);
  const stored     = state[providerName];

  // Missing or stale period key → this provider's quota has reset
  if (!stored || stored.periodKey !== currentKey) {
    return { periodKey: currentKey, used: 0 };
  }

  return stored;
}

/**
 * Persists the full state object to .agentic-local/quota-state.json.
 * Creates .agentic-local/ if it does not yet exist.
 *
 * @param {Record<string, { periodKey: string, used: number }>} state
 */
function saveState(state) {
  const dir = resolve(ROOT, '.agentic-local');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

// ─── Output ───────────────────────────────────────────────────────────────────

/**
 * Continuation instruction lines shown when the warning threshold is reached.
 *
 * @param {string} provider - the provider that is low on quota
 * @returns {string[]}
 */
function continuationLines(provider) {
  const other = provider === 'claude' ? 'Codex' : 'Claude Code';
  const lines = [`  Consider switching to ${other} before quota is exhausted:`];

  if (provider === 'claude') {
    lines.push(`    → Claude Code: update the active stage verification summary`);
    lines.push(`    → Codex:       read STATUS.md, kb.md, and that LIFO summary`);
  } else {
    lines.push(`    → Codex:       update the active stage verification summary`);
    lines.push(`    → Claude Code: read STATUS.md, kb.md, and that LIFO summary`);
  }

  lines.push(`    → Guide: docs/internal/agent-switching/switching-guide.md`);
  return lines;
}

/**
 * Checks usage against the warning threshold and prints the appropriate output.
 *
 * @param {string} provider
 * @param {{ periodKey: string, used: number }} providerState
 * @param {{ budget: number, unit: string, resetCycle: string, warningThresholdPercent: number }} cfg
 */
function checkAndWarn(provider, providerState, cfg) {
  const { used, periodKey } = providerState;
  const { budget, unit, resetCycle, warningThresholdPercent } = cfg;

  const usedPct      = (used / budget) * 100;
  const remainingPct = 100 - usedPct;
  const cycleLabel   = resetCycle === 'daily' ? 'today' : `week ${periodKey}`;

  if (usedPct >= 100) {
    console.log(`\n🚨  QUOTA EXHAUSTED [${provider.toUpperCase()}] — ${cycleLabel}`);
    console.log(`    ${used}/${budget} ${unit} used (100% — limit reached)`);
    continuationLines(provider).forEach(l => console.log(l));
    console.log();
    return;
  }

  if (usedPct >= warningThresholdPercent) {
    console.log(`\n⚠️   QUOTA WARNING [${provider.toUpperCase()}] — ${cycleLabel}`);
    console.log(`    ${used}/${budget} ${unit} used (${Math.round(usedPct)}%) — only ${Math.round(remainingPct)}% remaining`);
    continuationLines(provider).forEach(l => console.log(l));
    console.log();
    return;
  }

  if (usedPct >= 50) {
    // Informational only — no urgency yet
    console.log(`ℹ️   Quota [${provider}] ${cycleLabel}: ${used}/${budget} ${unit} (${Math.round(usedPct)}% used)`);
  }
  // < 50%: silent — do not interrupt normal workflow
}

/**
 * Prints a full status report for all configured providers.
 *
 * @param {Record<string, { periodKey: string, used: number }>} state
 * @param {Record<string, { budget: number, unit: string, resetCycle: string, warningThresholdPercent: number }>} configs
 */
function printStatus(state, configs) {
  console.log('\n📊  Quota Status\n');

  for (const [provider, cfg] of Object.entries(configs)) {
    const providerState = getProviderState(state, provider, cfg.resetCycle);
    const { used, periodKey } = providerState;
    const { budget, unit, resetCycle, warningThresholdPercent } = cfg;
    const pct   = Math.min(100, Math.round((used / budget) * 100));
    const bar   = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
    const cycle = resetCycle === 'daily' ? `daily (${periodKey})` : `weekly (${periodKey})`;

    console.log(`  ${provider.padEnd(8)} [${bar}] ${pct}%  ${used}/${budget} ${unit}`);
    console.log(`           Reset cycle: ${cycle} | Warning at: ${warningThresholdPercent}%`);
    console.log();
  }
}

/**
 * Prints the plan limits reference table for both providers.
 * Useful when deciding which plan to configure in quota.config.json.
 */
function printKnownLimits() {
  console.log(`
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  Known AI Provider Quota Limits (approximate — verify in your account)  │
  └─────────────────────────────────────────────────────────────────────────┘

  CLAUDE (Anthropic)
  Reset cycle: DAILY (rolling ~5 h window, tracked per UTC day)
  Built-in warning: NONE — Claude only tells you AFTER the limit is hit.
  ┌──────────┬──────────────────┬──────────────────────┬───────────────────┐
  │ Plan     │ ~Daily messages  │ Reset window         │ Cost              │
  ├──────────┼──────────────────┼──────────────────────┼───────────────────┤
  │ Free     │ ~20              │ rolling ~8 hours     │ $0/month          │
  │ Pro      │ ~100             │ rolling ~5 hours     │ $20/month         │
  │ Max      │ ~500             │ rolling ~5 hours     │ $100/month        │
  │ API key  │ no message cap   │ per-min rate limits  │ pay-per-token     │
  └──────────┴──────────────────┴──────────────────────┴───────────────────┘
  Note: Anthropic does not publish exact token counts for Pro/Max.
  Values above are community-observed approximates. Longer conversations
  use quota faster because context window size is factored in.

  CODEX (OpenAI)
  Reset cycle: WEEKLY (Monday UTC)
  Built-in warning: Partial — shows count in UI; switches to slow mode on exhaustion.
  ┌──────────┬──────────────────┬──────────────────────┬───────────────────┐
  │ Plan     │ Fast requests/wk │ Slow requests        │ Cost              │
  ├──────────┼──────────────────┼──────────────────────┼───────────────────┤
  │ Free     │ ~5               │ unlimited (slower)   │ $0/month          │
  │ Pro      │ 10               │ unlimited (slower)   │ $20/month         │
  │ API key  │ no weekly cap    │ per-min rate limits  │ pay-per-token     │
  └──────────┴──────────────────┴──────────────────────┴───────────────────┘
  Note: "Fast requests" = o4-mini or o3 with full context window.
  Slow requests use a smaller/faster model — still useful but less capable.
`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * CLI entry point.
 *
 * argv[2] = provider  (claude | codex, default: claude)
 * argv[3] = action    (increment-and-check | check | status | reset | known-limits)
 *                     default: increment-and-check
 */
function main() {
  const provider = process.argv[2] ?? 'claude';
  const action   = process.argv[3] ?? 'increment-and-check';

  // status and known-limits do not need a specific provider
  if (action === 'status') {
    const configs = loadConfig();
    const state   = loadState();
    printStatus(state, configs);
    return;
  }

  if (action === 'known-limits') {
    printKnownLimits();
    return;
  }

  const configs     = loadConfig();
  const cfg         = configs[provider];

  if (!cfg) {
    console.error(`Unknown provider: ${provider}. Use: claude | codex`);
    process.exit(1);
  }

  const state         = loadState();
  const providerState = getProviderState(state, provider, cfg.resetCycle);

  switch (action) {
    case 'increment-and-check':
      // Increment the counter then evaluate the threshold.
      // Claude Code: called automatically by the Stop hook after every response.
      // Codex: called manually at session end per AGENTS.md instruction.
      providerState.used++;
      state[provider] = providerState;
      saveState(state);
      checkAndWarn(provider, providerState, cfg);
      break;

    case 'check':
      // Read-only check — does not modify state.
      // Codex: called at session start to catch quota used in prior sessions.
      checkAndWarn(provider, providerState, cfg);
      break;

    case 'reset':
      // Zero the counter for the current period.
      // Use when the counter has drifted (e.g. Stop hook fired unexpectedly).
      providerState.used = 0;
      state[provider] = providerState;
      saveState(state);
      console.log(`✓ Reset ${provider} quota counter for ${cfg.resetCycle === 'daily' ? getDayKey() : getWeekKey()}`);
      break;

    default:
      console.error(`Unknown action: ${action}`);
      console.error(`Use: increment-and-check | check | status | reset | known-limits`);
      process.exit(1);
  }
}

main();
