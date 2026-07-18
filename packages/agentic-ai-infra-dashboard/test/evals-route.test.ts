/**
 * Stage 24 — /evals route tests.
 *
 * Starts real loopback HTTP servers on port 0 (OS-assigned) and exercises the
 * /evals and /evals.json routes, default-route preservation, sanitization, and
 * the HTML distribution chart render.
 */
import { describe, expect, it } from "vitest";
import http from "node:http";
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
    // Inject a record whose result message contains a fake API key pattern
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
