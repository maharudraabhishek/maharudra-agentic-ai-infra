import { describe, expect, it } from "vitest";
import {
  DefaultProfileResolver,
  type AgenticInfraProjectConfig,
  type AgentDefinitionRegistry,
  type ResolvedProjectConfig,
  type ToolContract
} from "@maharudra/agentic-ai-infra-core";
import {
  MemoryObservabilitySink,
  createRuntimeServiceContainer,
  startApiService,
  startLocalRuntime,
  startRemoteRuntime,
  InMemoryAgentDefinitionRegistry
} from "../src/index.js";

const minimalConfig: AgenticInfraProjectConfig = {
  project: { name: "Test Project", slug: "test-project" },
  profiles: ["minimal"]
};

function resolved(config: AgenticInfraProjectConfig): ResolvedProjectConfig {
  const result = new DefaultProfileResolver().resolve(config);

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.value;
}

const unsafeLocalTool: ToolContract = {
  id: "local.file.read",
  name: "Local file read",
  description: "Reads local files.",
  category: "read",
  riskLevel: "medium",
  outputPolicy: {
    remoteSafe: false,
    returnsRawFiles: true
  },
  runtimePolicy: {
    allowedModes: ["local-stdio-mcp", "remote-http-mcp"],
    remoteSafe: false,
    localFilesystem: true
  }
};

describe("runtime adapters", () => {
  it("runtime package imports have no startup side effects", async () => {
    const imported = await import("../src/index.js");

    expect(imported.startLocalRuntime).toBeTypeOf("function");
  });

  it("local STDIO adapter does not write logs to stdout", async () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const result = await startLocalRuntime(
        {
          project: { name: "Runtime Test", slug: "runtime-test" },
          profiles: ["minimal"]
        },
        { observability: new MemoryObservabilitySink() }
      );

      expect(result.ok).toBe(true);
      expect(writes).toEqual([]);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("remote runtime refuses to start without auth audit and rate-limit policy", async () => {
    const config = resolved({
      project: { name: "Unsafe Remote", slug: "unsafe-remote" },
      profiles: ["minimal"],
      runtime: {
        modes: ["remote-http-mcp"],
        remoteHttpMcp: {
          enabled: true,
          transport: "https",
          host: "127.0.0.1",
          port: 8443
        }
      }
    });
    const result = await startRemoteRuntime(config);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("runtime.remote-policy-required");
    }
  });

  it("API service refuses to start without auth audit and rate-limit policy", async () => {
    const config = resolved({
      project: { name: "Unsafe API", slug: "unsafe-api" },
      profiles: ["minimal"],
      runtime: {
        modes: ["api-service"],
        apiService: {
          enabled: true,
          transport: "https",
          host: "127.0.0.1",
          port: 8787
        }
      }
    });
    const result = await startApiService(config);

    expect(result.ok).toBe(false);
  });

  it("remote runtime does not bind publicly by default", async () => {
    const result = await startRemoteRuntime({
      project: { name: "Remote Safe", slug: "remote-safe" },
      profiles: ["remote-safe"]
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.host).toBe("127.0.0.1");
    }
  });

  it("remote runtime does not register local-only tools", async () => {
    const result = await startRemoteRuntime(
      {
        project: { name: "Remote Safe", slug: "remote-safe" },
        profiles: ["remote-safe"]
      },
      { tools: [unsafeLocalTool] }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.registeredTools).toEqual([]);
    }
  });
});

describe("RuntimeServiceContainer — Stage 24 eval wiring", () => {
  it("RuntimeServiceContainer exposes evalStore as a non-optional field", () => {
    const result = createRuntimeServiceContainer({ config: minimalConfig });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.evalStore).toBeDefined();
      expect(typeof result.value.evalStore.push).toBe("function");
      expect(result.value.evalStore.size()).toBe(0);
    }
  });

  it("RuntimeServiceContainer exposes evalHarness with default suites", () => {
    const result = createRuntimeServiceContainer({ config: minimalConfig });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.evalHarness).toBeDefined();
      const names = result.value.evalHarness.listSuiteNames();
      expect(names).toContain("retrieval-quality");
      expect(names).toContain("agent-evaluator");
      // LLM judge NOT registered without explicit enable
      expect(names).not.toContain("llm-judge");
    }
  });

  it("evalStore capacity honors config.evals.store.capacity", () => {
    const result = createRuntimeServiceContainer({
      config: { ...minimalConfig, evals: { store: { capacity: 5 } } }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Push 10 records and verify only 5 are retained
      for (let i = 0; i < 10; i += 1) {
        result.value.evalStore.push({
          runId: `r${i}`,
          traceId: `t${i}`,
          recordedAt: new Date().toISOString(),
          report: {
            suiteName: "x",
            status: "passed",
            total: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            results: []
          }
        });
      }
      expect(result.value.evalStore.size()).toBe(5);
    }
  });
});

describe("createRuntimeServiceContainer — agentRegistry (Stage 25)", () => {
  it("wires a non-optional agentRegistry into the container", () => {
    const result = createRuntimeServiceContainer({
      config: { project: { name: "Test", slug: "test" }, profiles: ["minimal"] }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agentRegistry).toBeDefined();
    // count() is the cheapest sanity check that the registry is a real
    // implementation, not a stub.
    expect(result.value.agentRegistry.count()).toBeGreaterThan(0);
  });

  it("default registry contains the six framework defaults", () => {
    const result = createRuntimeServiceContainer({
      config: { project: { name: "Test", slug: "test" }, profiles: ["minimal"] }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agentRegistry.count()).toBe(6);
    expect(result.value.agentRegistry.findById("manager")).toBeDefined();
    expect(result.value.agentRegistry.findById("security-reviewer")).toBeDefined();
  });

  it("caller can override agentRegistry via RuntimeStartOptions", () => {
    const custom = new InMemoryAgentDefinitionRegistry().register({
      id: "solo",
      role: "manager"
    });
    const result = createRuntimeServiceContainer({
      config: { project: { name: "Test", slug: "test" }, profiles: ["minimal"] },
      agentRegistry: custom
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agentRegistry).toBe(custom);
    expect(result.value.agentRegistry.count()).toBe(1);
    expect(result.value.agentRegistry.findById("solo")).toBeDefined();
  });

  it("agentRegistry reflects config.agents.agents when set", () => {
    const result = createRuntimeServiceContainer({
      config: {
        project: { name: "Test", slug: "test" },
        profiles: ["minimal"],
        agents: {
          mode: "single-agent",
          agents: [
            { id: "custom-mgr", role: "manager", description: "Custom" }
          ]
        }
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Caller profile is registered alongside the six defaults.
    // Note: "custom-mgr" is a new id (not in defaults), so total is 7.
    expect(result.value.agentRegistry.count()).toBe(7);
    expect(result.value.agentRegistry.findById("custom-mgr")?.description)
      .toBe("Custom");
  });

  it("agentRegistry satisfies the read-only AgentDefinitionRegistry interface", () => {
    // Compile-time + runtime check that the container exposes the interface,
    // not the concrete class. This protects consumers from accidentally
    // calling register() through the container.
    const result = createRuntimeServiceContainer({
      config: { project: { name: "Test", slug: "test" }, profiles: ["minimal"] }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const asInterface: AgentDefinitionRegistry = result.value.agentRegistry;
    expect(typeof asInterface.list).toBe("function");
    expect(typeof asInterface.findById).toBe("function");
    expect(typeof asInterface.findByRole).toBe("function");
    expect(typeof asInterface.count).toBe("function");
  });
});
