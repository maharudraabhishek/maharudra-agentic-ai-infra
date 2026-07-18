# Stage 24 — Phase 10: Dashboard /evals route
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START

**Platform:** Windows 11, PowerShell, Node >= 20, **pnpm only**
**CI command:** `pnpm run ci`
**Read first:** `AGENTS.md`, `STATUS.md`, `kb.md`, `packages/agentic-ai-infra-dashboard/src/index.ts` (CRITICAL: examine the `http.createServer` callback at ~line 402 — it does NOT have URL routing today, only Accept-header branching)
**Prerequisite:** Phase 9 complete (`EvalStore` available on container); CI green at ~410 tests
**Expected after this phase:** ~416 tests passing

---

## SCOPE — Phase 10 only

Add a `/evals` route to the dashboard HTTP server. Critical: the existing server has **no URL routing** — its single handler returns the snapshot for every path. This phase refactors the request handler to dispatch by `url.pathname` while preserving existing `/` and `/*.json` behavior.

Also extends the `DashboardDataProvider` interface with an optional `getEvalSnapshot()` method, sanitizes records before serialization, and adds a simple SVG-based HTML render for the `/evals` HTML view.

---

## VERIFIED FACTS

- Dashboard server callback (line 402): `http.createServer(async (request, response) => { ... })` — single handler, no path dispatch
- `DashboardEvalSummary` is `{ total, passed, failed, skipped }` only — no `lastRunStatus` or `historyCount` fields
- Existing top-of-file constants: `SECRET_PATTERN`, `LOCAL_PATH_PATTERN`, `UNSAFE_KEYS` — reuse for sanitization
- `escapeHtml(value: string): string` already exists in the file — reuse

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-dashboard/src/index.ts                MODIFY (URL routing + /evals route + sanitize + render)
packages/agentic-ai-infra-dashboard/test/dashboard.test.ts      MODIFY (existing tests still pass)
packages/agentic-ai-infra-dashboard/test/evals-route.test.ts    NEW (≥6 tests)
```

---

## CHANGE 1 — `dashboard/src/index.ts`

### 1a. Imports

Add at the top:

```typescript
import type { EvalRunRecord } from "@maharudra/agentic-ai-infra-core";
```

### 1b. Extend `DashboardDataProvider` interface

Locate the existing interface (search for `export interface DashboardDataProvider`). Add an optional method:

```typescript
export interface DashboardDataProvider {
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
```

### 1c. Refactor the `http.createServer` callback

Locate the existing handler (~line 402):

```typescript
const server = http.createServer(async (request, response) => {
  const wantsJson = request.url?.endsWith(".json") || request.headers.accept?.includes("application/json");
  const body = wantsJson
    ? await renderDashboardJson(options.provider)
    : await renderDashboardHtml(options.provider);

  response.statusCode = 200;
  response.setHeader("content-type", wantsJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8");
  response.end(body);
});
```

Replace with:

```typescript
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
```

### 1d. Add `sanitizeEvalSnapshot()`

Place this near the other sanitizers / render helpers in the file (after `renderReconciliationSection` and before `resolveDashboardBindPolicy`):

```typescript
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
```

### 1e. Add `renderEvalsHtml()`

Place this AFTER `sanitizeEvalSnapshot`:

```typescript
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
```

---

## CHANGE 2 — `dashboard/test/dashboard.test.ts`

The existing dashboard tests must continue passing. Audit them:

- Any test that calls `provider.getSnapshot()` directly — unaffected
- Any test that hits the HTTP server at `/` — unaffected (default route still works)
- If any existing test asserts on `request.url === undefined` behavior — verify the new `rawUrl ?? "/"` handling preserves it

Most likely no test changes are needed in this file. If you find an assertion that breaks, update the assertion to match the new behavior, not the other way around.

---

## CHANGE 3 — `dashboard/test/evals-route.test.ts` (NEW)

Use Node's `http` and `node:net` to hit the dashboard with mock requests, OR import and exercise the route logic directly. The simplest pattern matches existing dashboard tests:

```typescript
import { describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { EvalRunRecord, QualityReport } from "@maharudra/agentic-ai-infra-core";
import {
  startDashboardServer,
  type DashboardDataProvider,
  type DashboardDataSnapshot
} from "../src/index.js";

function emptySnapshot(): DashboardDataSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    project: { name: "test" }
  };
}

function buildProvider(opts: {
  evalSnapshot?: {
    latest: EvalRunRecord | null;
    history: readonly EvalRunRecord[];
  };
}): DashboardDataProvider {
  return {
    getSnapshot: () => emptySnapshot(),
    getEvalSnapshot: opts.evalSnapshot
      ? async () => opts.evalSnapshot!
      : undefined
  };
}

function makeRecord(id: string, status: "passed" | "failed" | "skipped"): EvalRunRecord {
  const report: QualityReport = {
    suiteName: "test",
    status,
    total: 1,
    passed: status === "passed" ? 1 : 0,
    failed: status === "failed" ? 1 : 0,
    skipped: status === "skipped" ? 1 : 0,
    results: [{ id: "x", name: "x", status }]
  };
  return {
    runId: `run-${id}`,
    traceId: `trace-${id}`,
    recordedAt: new Date().toISOString(),
    report
  };
}

async function get(port: number, path: string, accept = "text/html"): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers: { accept } },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("dashboard /evals route", () => {
  it("returns 200 with skipped HTML when getEvalSnapshot is absent", async () => {
    const provider = buildProvider({});
    const handleResult = await startDashboardServer({
      provider,
      host: "127.0.0.1",
      port: 0,
      remotePolicy: undefined
    });
    expect(handleResult.ok).toBe(true);
    if (!handleResult.ok) return;

    const port = handleResult.value.port;
    try {
      const res = await get(port, "/evals", "text/html");
      expect(res.status).toBe(200);
      expect(res.body).toContain("Eval Results");
    } finally {
      await handleResult.value.stop();
    }
  });

  it("returns JSON shape { latest, history } at /evals.json", async () => {
    const r = makeRecord("1", "passed");
    const provider = buildProvider({
      evalSnapshot: { latest: r, history: [r] }
    });
    const handleResult = await startDashboardServer({
      provider,
      host: "127.0.0.1",
      port: 0,
      remotePolicy: undefined
    });
    if (!handleResult.ok) throw new Error("server start failed");

    try {
      const res = await get(handleResult.value.port, "/evals.json", "application/json");
      expect(res.status).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.latest).toBeDefined();
      expect(Array.isArray(parsed.history)).toBe(true);
      expect(parsed.history.length).toBe(1);
    } finally {
      await handleResult.value.stop();
    }
  });

  it("/ default route still returns the main dashboard HTML", async () => {
    const provider = buildProvider({});
    const handleResult = await startDashboardServer({
      provider,
      host: "127.0.0.1",
      port: 0,
      remotePolicy: undefined
    });
    if (!handleResult.ok) throw new Error("server start failed");

    try {
      const res = await get(handleResult.value.port, "/", "text/html");
      expect(res.status).toBe(200);
      // Existing main dashboard markup includes "Token Usage"
      expect(res.body).toContain("Token Usage");
    } finally {
      await handleResult.value.stop();
    }
  });

  it("redacts secrets from eval records before serialization", async () => {
    // Inject a record whose suite name contains a fake API key pattern
    const r: EvalRunRecord = {
      runId: "run-1",
      traceId: "trace-1",
      recordedAt: new Date().toISOString(),
      report: {
        suiteName: "test",
        status: "passed",
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        results: [{
          id: "x",
          name: "x",
          status: "passed",
          message: "found api_key=secret123 in config"
        }]
      }
    };
    const provider = buildProvider({ evalSnapshot: { latest: r, history: [r] } });
    const handleResult = await startDashboardServer({
      provider,
      host: "127.0.0.1",
      port: 0,
      remotePolicy: undefined
    });
    if (!handleResult.ok) throw new Error("server start failed");

    try {
      const res = await get(handleResult.value.port, "/evals.json", "application/json");
      expect(res.body).toContain("[redacted]");
      expect(res.body).not.toContain("api_key=secret123");
    } finally {
      await handleResult.value.stop();
    }
  });

  it("HTML view shows the SVG distribution chart", async () => {
    const provider = buildProvider({
      evalSnapshot: {
        latest: makeRecord("1", "passed"),
        history: [makeRecord("1", "passed"), makeRecord("2", "failed")]
      }
    });
    const handleResult = await startDashboardServer({
      provider,
      host: "127.0.0.1",
      port: 0,
      remotePolicy: undefined
    });
    if (!handleResult.ok) throw new Error("server start failed");

    try {
      const res = await get(handleResult.value.port, "/evals", "text/html");
      expect(res.body).toContain("<svg");
      expect(res.body).toContain("Distribution");
      expect(res.body).toContain("History size");
    } finally {
      await handleResult.value.stop();
    }
  });

  it("HTML view shows 'none' when no latest record exists", async () => {
    const provider = buildProvider({ evalSnapshot: { latest: null, history: [] } });
    const handleResult = await startDashboardServer({
      provider,
      host: "127.0.0.1",
      port: 0,
      remotePolicy: undefined
    });
    if (!handleResult.ok) throw new Error("server start failed");

    try {
      const res = await get(handleResult.value.port, "/evals", "text/html");
      expect(res.body).toContain("none");
    } finally {
      await handleResult.value.stop();
    }
  });
});
```

If the existing dashboard tests use a different function name (e.g. not `startDashboardServer`), use that — check `dashboard/src/index.ts` for the actual exported start function.

---

## SELF-REVIEW CHECKLIST

- [ ] `http.createServer` callback now dispatches by `url.pathname`
- [ ] `/` route preserves prior behavior (returns main dashboard HTML)
- [ ] `/evals` and `/evals.json` routes return eval snapshot data
- [ ] `DashboardDataProvider.getEvalSnapshot?()` is added as optional
- [ ] `sanitizeEvalSnapshot()` walks records and redacts via `SECRET_PATTERN`, `LOCAL_PATH_PATTERN`, `UNSAFE_KEYS`
- [ ] `renderEvalsHtml()` is dependency-free, produces valid HTML with one SVG block
- [ ] `DashboardEvalSummary` is UNCHANGED — no `lastRunStatus` or `historyCount` fields invented
- [ ] All existing dashboard tests still pass
- [ ] ≥6 new tests in `evals-route.test.ts` all pass
- [ ] Test count reaches ~416
- [ ] `pnpm run ci` passes
- [ ] No new dependencies added
- [ ] JSDoc on new helper functions and the extended interface method

---

## WHAT NOT TO DO

- Do NOT delete the existing default route handling — preserve `/` and `/*.json`
- Do NOT add request body parsing or query strings — `/evals` is GET-only, no params
- Do NOT modify `DashboardEvalSummary` — Phase 9 already wired the existing shape
- Do NOT call into the runtime container directly — the dashboard only knows the `DashboardDataProvider` interface (clean module boundary)
- Do NOT add authentication or rate-limiting in this phase — Stage 24 is local-first, dashboard already enforces loopback-bind in `resolveDashboardBindPolicy`
- Do NOT cast `EvalRunRecord` aggressively — `redactRecord` returns `unknown`, the outer function does the single cast

---

## DONE SIGNAL

```
Stage 24 Phase 10 complete.
Test count: [N]/[N] passing (target ~416).
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: 3
Next: Phase 11 — Documentation
```
