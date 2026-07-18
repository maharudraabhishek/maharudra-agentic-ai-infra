import http, { type Server } from "node:http";
import {
  fail,
  ok,
  type DashboardConfig,
  type EvalRunRecord,
  type FrameworkResult,
  type TokenEfficiencyReport
} from "@maharudra/agentic-ai-infra-core";

const SECRET_PATTERN = /(BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY|api[_-]?key|secret|password\s*[=:]|approval(?:Text|[_ -]?text)\s*[=:]|rawApprovalText\s*[=:]|bearer\s+[a-z0-9._-]+)/i;
const LOCAL_PATH_PATTERN = /[A-Za-z]:\\|(?:^|["'\s])\/(?:Users|home|var|etc|tmp)\//;
const UNSAFE_KEYS = new Set([
  "approvalText",
  "rawApprovalText",
  "task",
  "taskText",
  "rawTaskText",
  "secret",
  "apiKey",
  "password",
  "privateKey",
  "token",
  "vector",
  "embedding",
  "rawSql",
  "sql",
  "stack",
  "stackTrace",
  "commandOutput",
  "rawFile",
  "rawFiles",
  "fullChunk",
  "fullChunks",
  // Usage import: never expose raw records, file content, or user identifiers.
  "records",
  "rawContent",
  "fileContent",
  "sourceContent",
  "userIdHash"
]);

/** Project identity displayed by the dashboard. */
export type DashboardProjectSummary = {
  readonly name: string;
  readonly slug?: string;
};

/** Safe trajectory summary shown by dashboard views. */
export type DashboardTrajectorySummary = {
  readonly totalSteps: number;
  readonly deniedSteps: number;
  readonly errorSteps: number;
  readonly roles: readonly string[];
  readonly toolNames: readonly string[];
};

/** Safe retrieval summary shown by dashboard views. */
export type DashboardRetrievalSummary = {
  readonly providerCount: number;
  readonly sourceCount: number;
  readonly warningCount: number;
};

/** Safe eval summary shown by dashboard views. */
export type DashboardEvalSummary = {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
};

/** Safe cache summary shown by dashboard views. */
export type DashboardCacheSummary = {
  readonly hits: number;
  readonly misses: number;
  readonly entries: number;
};

/**
 * Aggregated summary of imported actual usage batches for the dashboard.
 *
 * Contains only numeric totals and source labels — no individual usage records,
 * no file paths, and no user identifiers.
 */
export type DashboardUsageImportSummary = {
  /** Total number of successfully imported usage records. */
  readonly totalImportedRecords: number;
  /** Unique source format labels from all imported batches (e.g. "openai-csv"). */
  readonly sources: readonly string[];
  /** Sum of totalTokens across all imported records. */
  readonly totalActualTokens: number;
  /**
   * Sum of reported cost values across imported records, if cost fields exist.
   * Undefined when no imported records include a cost field.
   */
  readonly totalActualCost?: number;
  /** Currency code for cost totals (e.g. "USD"). Undefined for mixed or absent. */
  readonly currency?: string;
};

/**
 * Aggregate reconciliation metrics for the dashboard reconciliation panel.
 *
 * Only aggregate counts and totals — no individual run or record data.
 */
export type DashboardReconciliationSummary = {
  /** Number of estimated runs matched to an actual record. */
  readonly matchedCount: number;
  /** Number of estimated runs with no matching actual record. */
  readonly unmatchedEstimatedCount: number;
  /** Number of actual records with no matching estimated run. */
  readonly unmatchedActualCount: number;
  /** Total framework-estimated tokens across all reconciliation entries. */
  readonly totalEstimatedTokens: number;
  /** Total imported actual tokens across all reconciliation entries. */
  readonly totalActualTokens: number;
  /** Total delta (actual minus estimated). */
  readonly totalDelta: number;
  /** Delta as a percentage of estimated tokens. */
  readonly totalDeltaPercent: number;
};

/** Sanitized dashboard snapshot consumed by JSON and HTML renderers. */
export type DashboardDataSnapshot = {
  readonly generatedAt: string;
  readonly project: DashboardProjectSummary;
  readonly tokens?: TokenEfficiencyReport;
  readonly trajectory?: DashboardTrajectorySummary;
  readonly retrieval?: DashboardRetrievalSummary;
  readonly evals?: DashboardEvalSummary;
  readonly cache?: DashboardCacheSummary;
  readonly securityWarnings?: readonly string[];
  /** Aggregated summary of imported actual usage data, if any imports exist. */
  readonly usageImports?: DashboardUsageImportSummary;
  /** Reconciliation summary comparing estimated vs actual usage, if available. */
  readonly reconciliation?: DashboardReconciliationSummary;
};

/** Provider interface for runtime or generated dashboard data. */
export interface DashboardDataProvider {
  /** Returns a safe dashboard snapshot. */
  getSnapshot(): DashboardDataSnapshot | Promise<DashboardDataSnapshot>;
  /**
   * Optional eval-route data. Implemented by providers wired to a runtime
   * `EvalStore`. When absent, the `/evals` route returns
   * `{ latest: null, history: [] }`.
   */
  getEvalSnapshot?(): Promise<{
    latest: EvalRunRecord | null;
    history: readonly EvalRunRecord[];
  }>;
}

/** Policy required before dashboard binds beyond loopback. */
export type DashboardRemotePolicy = {
  readonly authRequired?: boolean;
  readonly auditEnabled?: boolean;
  readonly rateLimitRequired?: boolean;
};

/** Options for explicit dashboard server startup. */
export type DashboardServerOptions = {
  readonly config?: DashboardConfig;
  readonly provider: DashboardDataProvider;
  readonly host?: string;
  readonly port?: number;
  readonly remotePolicy?: DashboardRemotePolicy;
};

/** Handle returned by explicit dashboard startup. */
export type DashboardServerHandle = {
  readonly host: string;
  readonly port: number;
  /** Stops the dashboard server. */
  stop(): Promise<void>;
};

/**
 * Creates a provider around one static sanitized snapshot.
 */
export function createStaticDashboardDataProvider(
  snapshot: DashboardDataSnapshot
): DashboardDataProvider {
  return {
    getSnapshot() {
      return sanitizeDashboardData(snapshot) as DashboardDataSnapshot;
    }
  };
}

/**
 * Sanitizes any dashboard data before JSON or HTML rendering.
 */
export function sanitizeDashboardData(value: unknown): unknown {
  if (typeof value === "string") {
    if (SECRET_PATTERN.test(value)) {
      return "[redacted]";
    }

    if (LOCAL_PATH_PATTERN.test(value)) {
      return "[redacted-local-path]";
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDashboardData(item));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const safe: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) {
      continue;
    }

    safe[key] = sanitizeDashboardData(nested);
  }

  return safe;
}

/**
 * Renders sanitized dashboard JSON.
 */
export async function renderDashboardJson(
  provider: DashboardDataProvider
): Promise<string> {
  const snapshot = await provider.getSnapshot();

  return JSON.stringify(sanitizeDashboardData(snapshot), null, 2);
}

/**
 * Renders a dependency-free HTML dashboard with simple SVG bars.
 */
export async function renderDashboardHtml(
  provider: DashboardDataProvider
): Promise<string> {
  const snapshot = sanitizeDashboardData(await provider.getSnapshot()) as DashboardDataSnapshot;
  const tokens = snapshot.tokens?.totalUsage.totalTokens ?? 0;
  const budget = snapshot.tokens?.budget.maxTotalTokens ?? Math.max(tokens, 1);
  const percent = Math.min(100, Math.round((tokens / budget) * 100));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(snapshot.project.name)} Agentic AI Infra Dashboard</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #17202a; background: #f7f9fb; }
    main { max-width: 1080px; margin: 0 auto; }
    section { background: #fff; border: 1px solid #d9e2ec; border-radius: 8px; padding: 18px; margin: 16px 0; }
    h1, h2 { margin: 0 0 12px; }
    dl { display: grid; grid-template-columns: 220px 1fr; gap: 8px 16px; }
    dt { color: #52616b; }
    dd { margin: 0; font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(snapshot.project.name)} Dashboard</h1>
    <section>
      <h2>Token Usage</h2>
      <svg width="420" height="28" role="img" aria-label="Token usage ${percent}%">
        <rect width="420" height="28" fill="#e6edf3"></rect>
        <rect width="${Math.round(420 * percent / 100)}" height="28" fill="#2f80ed"></rect>
      </svg>
      <dl>
        <dt>Total tokens</dt><dd>${tokens}</dd>
        <dt>Budget</dt><dd>${budget}</dd>
        <dt>Shared-context savings</dt><dd>${snapshot.tokens?.estimatedTokenSavings ?? 0}</dd>
      </dl>
    </section>
    <section>
      <h2>Runtime Signals</h2>
      <dl>
        <dt>Trajectory steps</dt><dd>${snapshot.trajectory?.totalSteps ?? 0}</dd>
        <dt>Denied steps</dt><dd>${snapshot.trajectory?.deniedSteps ?? 0}</dd>
        <dt>Retrieval sources</dt><dd>${snapshot.retrieval?.sourceCount ?? 0}</dd>
        <dt>Eval failures</dt><dd>${snapshot.evals?.failed ?? 0}</dd>
        <dt>Cache entries</dt><dd>${snapshot.cache?.entries ?? 0}</dd>
        <dt>Security warnings</dt><dd>${snapshot.securityWarnings?.length ?? 0}</dd>
      </dl>
    </section>
    ${renderUsageImportSection(snapshot)}
    ${renderReconciliationSection(snapshot)}
  </main>
</body>
</html>`;
}

/**
 * Renders the "Actual Usage Imports" section when import data is present.
 *
 * Shows totals only — no individual records, no file paths, no user IDs.
 * Includes a cost summary row only when the imported data includes cost values.
 * Labels data as "imported actual provider/client usage" for truthfulness.
 */
function renderUsageImportSection(snapshot: DashboardDataSnapshot): string {
  const imports = snapshot.usageImports;

  if (!imports || imports.totalImportedRecords === 0) {
    return "";
  }

  const costRow =
    imports.totalActualCost !== undefined
      ? `<dt>Total reported cost</dt><dd>${imports.totalActualCost.toFixed(4)} ${escapeHtml(imports.currency ?? "")}</dd>`
      : "";

  return `<section>
      <h2>Actual Usage Imports</h2>
      <p style="color:#52616b;font-size:0.9em;margin:0 0 12px">
        Imported actual provider/client usage — not framework estimates.
        Delta vs estimates shown in the Reconciliation section.
      </p>
      <dl>
        <dt>Imported records</dt><dd>${imports.totalImportedRecords}</dd>
        <dt>Total actual tokens</dt><dd>${imports.totalActualTokens}</dd>
        <dt>Sources</dt><dd>${imports.sources.map(escapeHtml).join(", ") || "none"}</dd>
        ${costRow}
      </dl>
    </section>`;
}

/**
 * Renders the "Estimated vs Actual Reconciliation" section when reconciliation
 * data is present.
 *
 * Shows aggregate delta metrics and a reminder that deltas may include hidden
 * provider-side tokens not visible to the framework.
 */
function renderReconciliationSection(snapshot: DashboardDataSnapshot): string {
  const rec = snapshot.reconciliation;

  if (!rec) {
    return "";
  }

  const deltaSign = rec.totalDelta >= 0 ? "+" : "";
  const deltaColor = Math.abs(rec.totalDeltaPercent) > 20 ? "#c0392b" : "#27ae60";

  return `<section>
      <h2>Estimated vs Actual Reconciliation</h2>
      <p style="color:#52616b;font-size:0.9em;margin:0 0 12px">
        Delta may include hidden system/reasoning/client overhead not visible to the framework.
        Numbers are estimated framework-visible usage vs imported actual provider/client usage.
      </p>
      <dl>
        <dt>Matched runs</dt><dd>${rec.matchedCount}</dd>
        <dt>Unmatched estimated</dt><dd>${rec.unmatchedEstimatedCount}</dd>
        <dt>Unmatched actual</dt><dd>${rec.unmatchedActualCount}</dd>
        <dt>Estimated visible tokens</dt><dd>${rec.totalEstimatedTokens}</dd>
        <dt>Imported actual tokens</dt><dd>${rec.totalActualTokens}</dd>
        <dt>Token delta</dt><dd style="color:${deltaColor}">${deltaSign}${rec.totalDelta} (${deltaSign}${rec.totalDeltaPercent}%)</dd>
      </dl>
    </section>`;
}

/**
 * Sanitizes an eval snapshot before serialization.
 *
 * EvalRunRecord and its QualityReport carry only IDs, suite names, status
 * strings, and short messages — no raw task text, no chunks, no approval text.
 * This sanitizer is defense-in-depth: it walks records and redacts any string
 * matching SECRET_PATTERN or LOCAL_PATH_PATTERN, and drops any field whose key
 * appears in UNSAFE_KEYS.
 */
function sanitizeEvalSnapshot(snapshot: {
  latest: EvalRunRecord | null;
  history: readonly EvalRunRecord[];
}): {
  latest: EvalRunRecord | null;
  history: readonly EvalRunRecord[];
} {
  return {
    latest: snapshot.latest ? (redactRecord(snapshot.latest) as EvalRunRecord) : null,
    history: snapshot.history.map((r) => redactRecord(r) as EvalRunRecord)
  };
}

/**
 * Recursively redacts secrets and local paths from an EvalRunRecord.
 *
 * Returns a new structure — input is not mutated. Field keys in UNSAFE_KEYS
 * are dropped; string values matching SECRET_PATTERN or LOCAL_PATH_PATTERN
 * are replaced with `"[redacted]"`.
 */
function redactRecord(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      if (SECRET_PATTERN.test(value) || LOCAL_PATH_PATTERN.test(value)) {
        return "[redacted]";
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactRecord(entry));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) {
      continue;
    }
    result[key] = redactRecord(val);
  }
  return result;
}

/**
 * Renders the /evals HTML view.
 *
 * Shows the latest eval status, aggregate pass/fail/skip counts across the
 * history, and a simple SVG bar chart. Dependency-free, ~80 lines of static
 * HTML with the same color palette as the main dashboard.
 */
function renderEvalsHtml(snapshot: {
  latest: EvalRunRecord | null;
  history: readonly EvalRunRecord[];
}): string {
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const record of snapshot.history) {
    for (const r of record.report.results) {
      if (r.status === "passed") totalPassed += 1;
      else if (r.status === "failed") totalFailed += 1;
      else if (r.status === "skipped") totalSkipped += 1;
    }
  }

  const max = Math.max(totalPassed, totalFailed, totalSkipped, 1);
  const barWidth = (count: number): number => Math.round((420 * count) / max);

  const latestRow = snapshot.latest
    ? `<dt>Latest run</dt><dd>${escapeHtml(snapshot.latest.runId)} — ${escapeHtml(snapshot.latest.report.status)}</dd>`
    : `<dt>Latest run</dt><dd>none</dd>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Agentic Infra Dashboard — Evals</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 24px; color: #1a1f2c; }
    main { max-width: 720px; }
    section { margin: 24px 0; }
    h1 { font-size: 22px; }
    h2 { font-size: 16px; color: #2f3e52; border-bottom: 1px solid #e6edf3; padding-bottom: 6px; }
    dl { display: grid; grid-template-columns: 200px 1fr; gap: 8px 16px; margin: 12px 0; }
    dt { color: #52616b; }
    dd { margin: 0; font-variant-numeric: tabular-nums; }
    .bar-label { font-size: 12px; fill: #52616b; }
    .bar-count { font-size: 12px; fill: #1a1f2c; font-weight: bold; }
  </style>
</head>
<body>
  <main>
    <h1>Eval Results</h1>
    <section>
      <h2>Summary</h2>
      <dl>
        ${latestRow}
        <dt>History size</dt><dd>${snapshot.history.length}</dd>
        <dt>Total passed</dt><dd>${totalPassed}</dd>
        <dt>Total failed</dt><dd>${totalFailed}</dd>
        <dt>Total skipped</dt><dd>${totalSkipped}</dd>
      </dl>
    </section>
    <section>
      <h2>Distribution</h2>
      <svg width="500" height="120" role="img" aria-label="Eval result distribution">
        <rect x="60" y="10" width="${barWidth(totalPassed)}" height="24" fill="#27ae60"></rect>
        <text x="0" y="27" class="bar-label">passed</text>
        <text x="${barWidth(totalPassed) + 64}" y="27" class="bar-count">${totalPassed}</text>

        <rect x="60" y="44" width="${barWidth(totalFailed)}" height="24" fill="#c0392b"></rect>
        <text x="0" y="61" class="bar-label">failed</text>
        <text x="${barWidth(totalFailed) + 64}" y="61" class="bar-count">${totalFailed}</text>

        <rect x="60" y="78" width="${barWidth(totalSkipped)}" height="24" fill="#7f8c8d"></rect>
        <text x="0" y="95" class="bar-label">skipped</text>
        <text x="${barWidth(totalSkipped) + 64}" y="95" class="bar-count">${totalSkipped}</text>
      </svg>
    </section>
  </main>
</body>
</html>`;
}

/**
 * Resolves dashboard bind settings and enforces remote bind policy.
 */
export function resolveDashboardBindPolicy(params: {
  readonly config?: DashboardConfig;
  readonly host?: string;
  readonly port?: number;
  readonly remotePolicy?: DashboardRemotePolicy;
}): FrameworkResult<{ readonly host: string; readonly port: number }> {
  const host = params.host ?? params.config?.host ?? "127.0.0.1";
  const port = params.port ?? params.config?.port ?? 8788;

  if (!isLoopbackHost(host)) {
    const policy = params.remotePolicy;

    if (
      policy?.authRequired !== true ||
      policy.auditEnabled !== true ||
      policy.rateLimitRequired !== true
    ) {
      return fail({
        code: "dashboard.policy-required",
        message: "Dashboard remote bind requires auth, audit, and rate-limit policy.",
        severity: "fatal"
      });
    }
  }

  return ok({ host, port });
}

/**
 * Starts the dashboard server explicitly.
 *
 * Importing this package never starts servers or binds ports.
 */
export async function startDashboardServer(
  options: DashboardServerOptions
): Promise<FrameworkResult<DashboardServerHandle>> {
  const bind = resolveDashboardBindPolicy(options);

  if (!bind.ok) {
    return bind;
  }

  const server = http.createServer(async (request, response) => {
    const rawUrl = request.url ?? "/";
    const url = new URL(rawUrl, `http://${request.headers.host ?? "localhost"}`);
    const wantsJson =
      rawUrl.endsWith(".json") ||
      request.headers.accept?.includes("application/json") === true;

    response.statusCode = 200;
    response.setHeader(
      "content-type",
      wantsJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8"
    );

    // /evals route — added in Stage 24.
    if (url.pathname === "/evals" || url.pathname === "/evals.json") {
      const evalData = (await options.provider.getEvalSnapshot?.()) ?? {
        latest: null,
        history: []
      };
      const sanitized = sanitizeEvalSnapshot(evalData);

      response.end(
        wantsJson
          ? JSON.stringify(sanitized)
          : renderEvalsHtml(sanitized)
      );
      return;
    }

    // Default route — preserves prior behavior for "/", "/index.html", "/dashboard.json", etc.
    const body = wantsJson
      ? await renderDashboardJson(options.provider)
      : await renderDashboardHtml(options.provider);

    response.end(body);
  });

  try {
    await listen(server, bind.value.port, bind.value.host);
  } catch {
    return fail({
      code: "dashboard.start-failed",
      message: "Dashboard server could not bind to the configured host and port.",
      severity: "recoverable"
    });
  }

  // Resolve the actual bound port (important when port: 0 lets the OS assign one).
  const addr = server.address() as { port: number } | string | null;
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : bind.value.port;

  return ok({
    host: bind.value.host,
    port: actualPort,
    async stop() {
      await close(server);
    }
  });
}

/**
 * Checks whether a host is loopback-only.
 */
function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Escapes HTML text before rendering.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Promisified server listen helper.
 */
function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

/**
 * Promisified server close helper.
 */
function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
