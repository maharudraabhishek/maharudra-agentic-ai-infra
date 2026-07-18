import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PROFILE_NAMES,
  BUILT_IN_PROFILES,
  DefaultConfigValidator,
  type AgenticInfraProjectConfig,
  type ErrorCode
} from "../src/index.js";

function issueCodes(config: AgenticInfraProjectConfig): readonly ErrorCode[] {
  const result = new DefaultConfigValidator().validate(config);

  if (result.ok) {
    return [];
  }

  return result.error.issues?.map((issue) => issue.code) ?? [result.error.code];
}

describe("DefaultConfigValidator", () => {
  it("resolves a valid minimal config", () => {
    const result = new DefaultConfigValidator().validate({
      project: { name: "Demo Project", slug: "demo-project" },
      profiles: ["minimal"]
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.runtime.modes).toEqual(["local-stdio-mcp"]);
      expect(result.value.security.minimumPolicy).toBe("strict");
    }
  });

  it("resolves every built-in profile with a project identity", () => {
    for (const profile of BUILT_IN_PROFILE_NAMES) {
      const result = new DefaultConfigValidator().validate({
        project: { name: `${profile} project`, slug: `${profile}-project` },
        profiles: [profile]
      });

      expect(result, profile).toMatchObject({ ok: true });
    }
  });

  it("reports missing project names and invalid slugs", () => {
    expect(
      issueCodes({
        project: { name: "", slug: "Bad Slug" },
        profiles: ["minimal"]
      })
    ).toEqual(
      expect.arrayContaining(["config.missing-project-name", "config.invalid-slug"])
    );
  });

  it("reports unknown profiles and bad runtime modes", () => {
    expect(
      issueCodes({
        project: { name: "Demo", slug: "demo" },
        profiles: ["does-not-exist"]
      })
    ).toContain("config.invalid-profile");

    expect(
      issueCodes({
        project: { name: "Demo", slug: "demo" },
        runtime: {
          modes: ["bad-mode" as never]
        }
      })
    ).toContain("config.invalid-runtime-mode");
  });

  it("requires auth, authorization, rate limits, and audit for remote MCP", () => {
    expect(
      issueCodes({
        project: { name: "Remote Demo", slug: "remote-demo" },
        runtime: {
          modes: ["remote-http-mcp"],
          remoteHttpMcp: {
            enabled: true,
            transport: "https"
          }
        }
      })
    ).toEqual(
      expect.arrayContaining([
        "config.remote-auth-required",
        "config.remote-authorization-required",
        "config.remote-rate-limit-required",
        "config.remote-audit-required"
      ])
    );
  });

  it("rejects invalid and conflicting dashboard/runtime ports", () => {
    expect(
      issueCodes({
        project: { name: "Port Demo", slug: "port-demo" },
        profiles: ["remote-safe"],
        dashboard: {
          enabled: true,
          port: 8443
        }
      })
    ).toContain("config.duplicate-port");

    expect(
      issueCodes({
        project: { name: "Port Demo", slug: "port-demo" },
        dashboard: {
          enabled: true,
          port: 70000
        }
      })
    ).toContain("config.invalid-port");
  });

  it("requires storage for retrieval and Postgres storage for pgvector", () => {
    expect(
      issueCodes({
        project: { name: "Retrieval Demo", slug: "retrieval-demo" },
        retrieval: {
          enabled: true,
          providers: [
            {
              id: "lexical",
              type: "full-text",
              enabled: true,
              storageProviderId: "missing-store"
            }
          ]
        },
        storage: { providers: [] }
      })
    ).toEqual(
      expect.arrayContaining([
        "config.retrieval-storage-required",
        "config.retrieval-storage-required"
      ])
    );

    expect(
      issueCodes({
        project: { name: "Vector Demo", slug: "vector-demo" },
        retrieval: {
          enabled: true,
          providers: [
            {
              id: "vector",
              type: "pgvector",
              enabled: true,
              storageProviderId: "file-store"
            }
          ]
        },
        storage: {
          providers: [
            {
              id: "file-store",
              type: "filesystem",
              localPath: ".agentic-local/context"
            }
          ]
        }
      })
    ).toContain("config.pgvector-postgres-required");
  });

  it("requires shared context and token budgets for multi-agent mode", () => {
    expect(
      issueCodes({
        project: { name: "Agents Demo", slug: "agents-demo" },
        agents: {
          mode: "token-efficient-multi-agent"
        },
        tokenEfficiency: {
          enabled: false
        }
      })
    ).toEqual(
      expect.arrayContaining([
        "config.multi-agent-context-required",
        "config.multi-agent-token-budget-required"
      ])
    );
  });

  it("rejects weakened security defaults and unsafe paths", () => {
    const codes = issueCodes({
      project: { name: "Security Demo", slug: "security-demo" },
      security: {
        allowSecretPaths: true,
        allowPathTraversal: true,
        allowedPaths: ["..\\outside", "C:\\Users\\Example\\.env"],
        blockedPaths: ["safe/path"]
      }
    });

    expect(codes).toEqual(
      expect.arrayContaining([
        "config.security-policy-weakened",
        "config.security-policy-weakened",
        "config.invalid-path"
      ])
    );
  });

  it("rejects unsafe tools on remote surfaces", () => {
    expect(
      issueCodes({
        project: { name: "Tool Demo", slug: "tool-demo" },
        profiles: ["remote-safe"],
        tools: [
          {
            id: "local-file-read",
            name: "Local file read",
            description: "Reads local files.",
            category: "read",
            riskLevel: "medium",
            outputPolicy: {
              remoteSafe: true,
              returnsRawFiles: true
            },
            runtimePolicy: {
              allowedModes: ["remote-http-mcp"],
              remoteSafe: true,
              localFilesystem: true
            }
          }
        ]
      })
    ).toContain("config.unsafe-remote-tool");
  });

  it("no built-in profile references filesystem as knowledge storage", () => {
    for (const profile of BUILT_IN_PROFILES) {
      const providers = profile.config.storage?.providers ?? [];

      for (const provider of providers) {
        expect(
          provider.type,
          `Profile "${profile.name}" has a filesystem storage provider — use "postgres" instead`
        ).not.toBe("filesystem");
      }
    }
  });

  it("rejects filesystem as knowledge storage type with a clear error", () => {
    const codes = issueCodes({
      project: { name: "Filesystem Demo", slug: "filesystem-demo" },
      storage: {
        providers: [
          {
            id: "local-fs-store",
            type: "filesystem",
            localPath: ".agentic-local/context"
          }
        ]
      }
    });

    expect(codes).toContain("config.filesystem-storage-not-implemented");
  });

  it("rejects invalid token budgets and malformed extension providers", () => {
    expect(
      issueCodes({
        project: { name: "Token Demo", slug: "token-demo" },
        tokenEfficiency: {
          enabled: true,
          tokenBudget: {
            maxTotalTokens: 1000,
            maxContextTokens: 2000
          }
        },
        extensions: [
          {
            id: "custom-retriever",
            kind: "retrieval",
            capabilities: []
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        "config.invalid-token-budget",
        "config.invalid-extension-provider"
      ])
    );
  });

  describe("evals config validation", () => {
    const baseConfig: AgenticInfraProjectConfig = {
      project: { name: "Eval Demo", slug: "eval-demo" },
      profiles: ["minimal"]
    };

    it("accepts evals.store.capacity = 50", () => {
      const result = new DefaultConfigValidator().validate({
        ...baseConfig,
        evals: { store: { capacity: 50 } }
      });
      expect(result.ok).toBe(true);
    });

    it("rejects evals.store.capacity = 0 with config.invalid-evals-store-capacity", () => {
      const result = new DefaultConfigValidator().validate({
        ...baseConfig,
        evals: { store: { capacity: 0 } }
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("config.invalid-evals-store-capacity");
    });

    it("rejects evals.store.capacity = -5", () => {
      const result = new DefaultConfigValidator().validate({
        ...baseConfig,
        evals: { store: { capacity: -5 } }
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("config.invalid-evals-store-capacity");
    });

    it("rejects evals.store.capacity = 1.5 (non-integer)", () => {
      const result = new DefaultConfigValidator().validate({
        ...baseConfig,
        evals: { store: { capacity: 1.5 } }
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("config.invalid-evals-store-capacity");
    });

    it("rejects evals.llmJudge.enabled = true without llm config", () => {
      const result = new DefaultConfigValidator().validate({
        ...baseConfig,
        evals: { llmJudge: { enabled: true } }
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("config.llm-judge-requires-llm-config");
    });

    it("accepts evals.llmJudge.enabled = true WITH llm config", () => {
      const result = new DefaultConfigValidator().validate({
        ...baseConfig,
        evals: { llmJudge: { enabled: true } },
        llm: { providers: [{ id: "mock-llm", type: "mock", model: "test" }] }
      });
      expect(result.ok).toBe(true);
    });

    it("accepts evals.llmJudge.enabled = false without llm config", () => {
      const result = new DefaultConfigValidator().validate({
        ...baseConfig,
        evals: { llmJudge: { enabled: false } }
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("DefaultConfigValidator — agent profile duplicate-id check (Stage 25)", () => {
    it("accepts config with no agent profiles", () => {
      const result = new DefaultConfigValidator().validate({
        project: { name: "T", slug: "t" },
        profiles: ["minimal"]
      });
      expect(result.ok).toBe(true);
    });

    it("accepts config with distinct agent profile ids", () => {
      const result = new DefaultConfigValidator().validate({
        project: { name: "T", slug: "t" },
        profiles: ["minimal"],
        agents: {
          mode: "single-agent",
          agents: [
            { id: "mgr", role: "manager" },
            { id: "sec", role: "security-reviewer" }
          ]
        }
      });
      expect(result.ok).toBe(true);
    });

    it("reports config.duplicate-id when agent profile ids collide", () => {
      expect(
        issueCodes({
          project: { name: "T", slug: "t" },
          profiles: ["minimal"],
          agents: {
            mode: "single-agent",
            agents: [
              { id: "shared", role: "manager" },
              { id: "shared", role: "security-reviewer" }
            ]
          }
        })
      ).toContain("config.duplicate-id");
    });
  });
});
