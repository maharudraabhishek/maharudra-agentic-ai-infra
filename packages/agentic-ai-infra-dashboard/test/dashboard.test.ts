import { describe, expect, it } from "vitest";
import {
  createStaticDashboardDataProvider,
  renderDashboardHtml,
  renderDashboardJson,
  resolveDashboardBindPolicy
} from "../src/index.js";

const provider = createStaticDashboardDataProvider({
  generatedAt: "2026-05-12T00:00:00.000Z",
  project: {
    name: "Dashboard Test",
    slug: "dashboard-test"
  },
  tokens: {
    budget: {
      maxTotalTokens: 1000,
      maxContextTokens: 500
    },
    totalUsage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150
    },
    withinBudget: true,
    estimatedTokenSavings: 200,
    notes: ["safe summary"]
  },
  trajectory: {
    totalSteps: 1,
    deniedSteps: 0,
    errorSteps: 0,
    roles: ["manager"],
    toolNames: ["agentic.safe.read"]
  },
  retrieval: {
    providerCount: 1,
    sourceCount: 2,
    warningCount: 0
  },
  evals: {
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0
  },
  cache: {
    hits: 1,
    misses: 0,
    entries: 1
  },
  securityWarnings: [
    "approvalText=DO-NOT-SHOW",
    "C:\\Users\\person\\secret.txt"
  ],
  // Unsafe fields are intentionally present to prove renderer sanitization.
  ...( {
    approvalText: "APPROVE_agentic.write.propose",
    rawTaskText: "raw task must be absent",
    vector: [1, 2, 3],
    rawSql: "select * from secrets",
    stackTrace: "Error stack",
    commandOutput: "shell output"
  } as Record<string, unknown>)
});

describe("dashboard package", () => {
  it("renders sanitized JSON without raw task or approval text", async () => {
    const json = await renderDashboardJson(provider);

    expect(json).toContain("Dashboard Test");
    expect(json).not.toContain("APPROVE_agentic.write.propose");
    expect(json).not.toContain("DO-NOT-SHOW");
    expect(json).not.toContain("raw task must be absent");
    expect(json).not.toContain("vector");
    expect(json).not.toContain("rawSql");
    expect(json).not.toContain("stackTrace");
    expect(json).not.toContain("commandOutput");
    expect(json).not.toContain("C:\\Users\\person\\secret.txt");
  });

  it("renders sanitized HTML without approval text or unsafe raw fields", async () => {
    const html = await renderDashboardHtml(provider);

    expect(html).toContain("Dashboard Test Dashboard");
    expect(html).not.toContain("APPROVE_agentic.write.propose");
    expect(html).not.toContain("DO-NOT-SHOW");
    expect(html).not.toContain("raw task must be absent");
    expect(html).not.toContain("rawSql");
    expect(html).not.toContain("commandOutput");
    expect(html).not.toContain("C:\\Users\\person\\secret.txt");
  });

  it("defaults to loopback-only dashboard binding", () => {
    const result = resolveDashboardBindPolicy({});

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.host).toBe("127.0.0.1");
    }
  });

  it("rejects non-loopback dashboard binding without remote policy", () => {
    const result = resolveDashboardBindPolicy({ host: "0.0.0.0" });

    expect(result.ok).toBe(false);
  });

});
