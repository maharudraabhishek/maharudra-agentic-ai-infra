import { describe, it, expect } from "vitest";
import type {
  AgentDefinition,
  AgentResponsePolicy,
  ContextPackage,
  DeterministicAgentOutput
} from "@maharudra/agentic-ai-infra-core";
import {
  HeuristicOutputGuard,
  NoopOutputGuard,
  evaluateResponsePolicy
} from "../../src/guardrails/output-guard.js";

const baseOutput = (
  overrides: Partial<DeterministicAgentOutput> = {}
): DeterministicAgentOutput => ({
  role: "security-reviewer",
  summary: "ok",
  findings: ["finding-1"],
  sourceCount: 0,
  ...overrides
});

const pkg = (sourceIds: readonly string[]): ContextPackage => ({
  id: "ctx-1",
  task: "t",
  sources: sourceIds.map((id) => ({ sourceId: id, label: id })),
  contextText: "",
  tokenEstimate: 0
});

describe("Stage 25.5 Phase 03 — evaluateResponsePolicy", () => {
  it("returns pass when policy is undefined (D23)", () => {
    const d = evaluateResponsePolicy(baseOutput(), pkg(["s-1"]), undefined);
    expect(d.pass).toBe(true);
    expect(d.action).toBe("pass");
  });

  it("fails when requireCitations:true and citations are empty", () => {
    const policy: AgentResponsePolicy = { requireCitations: true, onWeakEvidence: "warn" };
    const d = evaluateResponsePolicy(baseOutput(), pkg(["s-1"]), policy);
    expect(d.pass).toBe(false);
    expect(d.action).toBe("warn");
  });

  it("passes when requireCitations:true and citations present", () => {
    const policy: AgentResponsePolicy = { requireCitations: true };
    const d = evaluateResponsePolicy(
      baseOutput({ citations: [{ sourceId: "s-1" }] }),
      pkg(["s-1"]),
      policy
    );
    expect(d.pass).toBe(true);
    expect(d.citationCount).toBe(1);
  });

  it("computes evidenceCoverage as citationCount / sources.length", () => {
    const policy: AgentResponsePolicy = {};
    const d = evaluateResponsePolicy(
      baseOutput({ citations: [{ sourceId: "s-1" }, { sourceId: "s-2" }] }),
      pkg(["s-1", "s-2", "s-3", "s-4"]),
      policy
    );
    expect(d.evidenceCoverage).toBeCloseTo(0.5);
  });

  it("fails when evidenceCoverage < minEvidenceCoverage", () => {
    const policy: AgentResponsePolicy = {
      minEvidenceCoverage: 0.75,
      onWeakEvidence: "abstain"
    };
    const d = evaluateResponsePolicy(
      baseOutput({ citations: [{ sourceId: "s-1" }] }),
      pkg(["s-1", "s-2", "s-3", "s-4"]),
      policy
    );
    expect(d.pass).toBe(false);
    expect(d.action).toBe("abstain");
  });

  it("passes when evidenceCoverage >= minEvidenceCoverage", () => {
    const policy: AgentResponsePolicy = { minEvidenceCoverage: 0.5 };
    const d = evaluateResponsePolicy(
      baseOutput({ citations: [{ sourceId: "s-1" }, { sourceId: "s-2" }] }),
      pkg(["s-1", "s-2", "s-3"]),
      policy
    );
    // 2/3 = 0.667 >= 0.5
    expect(d.pass).toBe(true);
  });

  it("strict-cited mode fails when no citations regardless of requireCitations flag", () => {
    const policy: AgentResponsePolicy = { mode: "strict-cited", onWeakEvidence: "warn" };
    const d = evaluateResponsePolicy(baseOutput(), pkg(["s-1"]), policy);
    expect(d.pass).toBe(false);
  });

  it("grounded mode passes when sources are empty (nothing to cite)", () => {
    const policy: AgentResponsePolicy = { mode: "grounded", onWeakEvidence: "abstain" };
    const d = evaluateResponsePolicy(baseOutput(), undefined, policy);
    expect(d.pass).toBe(true);
  });

  it("grounded mode fails when sources present but citations empty", () => {
    const policy: AgentResponsePolicy = { mode: "grounded", onWeakEvidence: "ask" };
    const d = evaluateResponsePolicy(baseOutput(), pkg(["s-1", "s-2"]), policy);
    expect(d.pass).toBe(false);
    expect(d.action).toBe("ask");
  });

  it("evidenceCoverage is undefined when contextPackage is undefined", () => {
    const policy: AgentResponsePolicy = {};
    const d = evaluateResponsePolicy(baseOutput(), undefined, policy);
    expect(d.evidenceCoverage).toBeUndefined();
  });

  it("HeuristicOutputGuard delegates to evaluateResponsePolicy", () => {
    const guard = new HeuristicOutputGuard();
    const policy: AgentResponsePolicy = { requireCitations: true, onWeakEvidence: "warn" };
    const agent: AgentDefinition = {
      id: "security",
      role: "security-reviewer",
      responsePolicy: policy
    };
    const d = guard.inspect(baseOutput(), pkg(["s-1"]), agent);
    expect(d.pass).toBe(false);
  });

  it("NoopOutputGuard always returns pass", () => {
    const guard = new NoopOutputGuard();
    const d = guard.inspect(baseOutput(), pkg([]), undefined);
    expect(d.pass).toBe(true);
    expect(d.action).toBe("pass");
  });
});
