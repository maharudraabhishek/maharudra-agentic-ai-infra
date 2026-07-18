import type { AgenticInfraProjectConfig } from "../config/types.js";
import type { CapabilityProfile } from "./types.js";

/**
 * Baseline config used before profile overlays and user config are merged.
 *
 * The baseline keeps local mode conservative, disables retrieval by default,
 * and enables strict safety settings so projects opt into larger capability
 * surfaces deliberately.
 */
export const DEFAULT_PROJECT_CONFIG: AgenticInfraProjectConfig = {
  runtime: {
    modes: ["local-stdio-mcp"],
    localStdioMcp: {
      enabled: true,
      transport: "stdio",
      allowLocalFilesystem: true,
      allowControlledWrites: false,
      allowShell: false,
      toolProfile: "secure-readonly"
    }
  },
  storage: {
    providers: []
  },
  retrieval: {
    enabled: false,
    providers: []
  },
  agents: {
    mode: "single-agent"
  },
  tokenEfficiency: {
    enabled: true,
    tokenBudget: {
      maxTotalTokens: 16000,
      maxContextTokens: 8000,
      maxResponseTokens: 4000,
      reserveTokens: 1000
    }
  },
  dashboard: {
    enabled: false
  },
  security: {
    minimumPolicy: "strict",
    allowedPaths: [
      "tools/agentic/mcp-server",
      "infra/local-dev/ai-context-db",
      "infra/db/ai-context",
      "docs/03-agentic-infra"
    ],
    blockedPaths: [
      ".env",
      ".env.*",
      ".npmrc",
      ".git",
      "node_modules",
      "dist",
      "build",
      "coverage",
      ".agentic-local"
    ],
    allowPathTraversal: false,
    allowSecretPaths: false,
    allowLocalFilesystemInRemote: false,
    allowShellInRemote: false,
    approvalPolicy: {
      mode: "explicit-approval",
      exactApprovalRequired: true
    },
    promptInjectionDefense: {
      enabled: true,
      retrievedContentIsEvidence: true,
      warnOnUntrustedContent: true,
      precedence: [
        "user-instruction",
        "project-policy",
        "server-side-tool-policy",
        "retrieved-evidence"
      ]
    }
  },
  freshness: {
    defaultPolicy: {
      maxAgeSeconds: 3600,
      requireSourceVersion: true,
      staleWhileRevalidate: false
    },
    cache: {
      enabled: true,
      ttlSeconds: 900,
      maxEntries: 500,
      namespace: "agentic-ai-infra"
    }
  },
  observability: {
    enabled: true,
    safeLogging: true,
    audit: {
      enabled: true,
      sink: "local"
    },
    traces: {
      enabled: true,
      sink: "local"
    }
  },
  tools: [],
  extensions: []
};

/**
 * Built-in capability profiles.
 *
 * Profiles are compact user-facing presets. Each entry documents the intended
 * capability surface and provides only the config differences needed to express
 * that surface.
 */
export const BUILT_IN_PROFILES: readonly CapabilityProfile[] = [
  {
    name: "minimal",
    label: "Minimal",
    description: "Small local contract surface with strict security defaults.",
    capabilitySurface: ["local stdio runtime", "single-agent mode", "safe logging"],
    config: {}
  },
  {
    name: "secure-readonly",
    label: "Secure Readonly",
    description: "Local read-oriented tooling with controlled outputs.",
    capabilitySurface: ["safe reads", "bounded outputs", "strict path policy"],
    config: {
      runtime: {
        modes: ["local-stdio-mcp"],
        localStdioMcp: {
          enabled: true,
          transport: "stdio",
          allowLocalFilesystem: true,
          allowControlledWrites: false,
          allowShell: false,
          toolProfile: "secure-readonly"
        }
      }
    }
  },
  {
    name: "controlled-write",
    label: "Controlled Write",
    description: "Local write capability surface gated by explicit approval.",
    capabilitySurface: ["proposal-based writes", "exact approval", "audit events"],
    config: {
      runtime: {
        modes: ["local-stdio-mcp"],
        localStdioMcp: {
          enabled: true,
          transport: "stdio",
          allowLocalFilesystem: true,
          allowControlledWrites: true,
          allowShell: false,
          toolProfile: "controlled-write"
        }
      },
      security: {
        approvalPolicy: {
          mode: "explicit-approval",
          exactApprovalRequired: true
        }
      }
    }
  },
  {
    name: "vectorless-local",
    label: "Vectorless Local",
    description:
      "Zero-dependency local context — full-text, document-tree, and symbol retrieval from in-memory index. No Postgres or pgvector required.",
    capabilitySurface: [
      "in-memory context store",
      "full-text retrieval",
      "document-tree retrieval",
      "symbol/code retrieval"
    ],
    config: {
      storage: {
        defaultProviderId: "in-memory-store",
        providers: [
          {
            id: "in-memory-store",
            type: "memory",
            capabilities: ["full-text", "document-tree", "symbol-code"]
          }
        ]
      },
      retrieval: {
        enabled: true,
        providers: [
          {
            id: "memory-full-text",
            type: "full-text",
            enabled: true,
            storageProviderId: "in-memory-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "memory-document-tree",
            type: "document-tree",
            enabled: true,
            storageProviderId: "in-memory-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "memory-symbol-code",
            type: "symbol-code",
            enabled: true,
            storageProviderId: "in-memory-store",
            safetyPolicy: { remoteSafe: false }
          }
        ],
        router: {
          strategy: "hybrid",
          providerOrder: ["memory-full-text", "memory-document-tree", "memory-symbol-code"],
          maxResults: 8
        }
      },
      agents: {
        mode: "single-agent"
      }
    }
  },
  {
    name: "local-context",
    label: "Local Context",
    description: "Local context contracts with lexical and structure-aware retrieval surfaces.",
    capabilitySurface: ["local context storage", "full-text retrieval", "document-tree retrieval", "symbol/code retrieval"],
    config: {
      storage: {
        defaultProviderId: "local-context-store",
        providers: [
          {
            id: "local-context-store",
            type: "postgres",
            connectionRef: "local-ai-context-postgres",
            capabilities: ["full-text", "document-tree", "symbol-code"]
          }
        ]
      },
      retrieval: {
        enabled: true,
        providers: [
          {
            id: "local-full-text",
            type: "full-text",
            enabled: true,
            storageProviderId: "local-context-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "local-document-tree",
            type: "document-tree",
            enabled: true,
            storageProviderId: "local-context-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "local-symbol-code",
            type: "symbol-code",
            enabled: true,
            storageProviderId: "local-context-store",
            safetyPolicy: { remoteSafe: false }
          }
        ],
        router: {
          strategy: "hybrid",
          providerOrder: ["local-full-text", "local-document-tree", "local-symbol-code"],
          maxResults: 8
        }
      }
    }
  },
  {
    name: "full-agentic-context",
    label: "Full Agentic Context",
    description: "Local context, vector-ready storage contracts, and token-efficient agent contracts.",
    capabilitySurface: ["shared context packet", "role context slices", "pgvector retrieval contract", "eval visibility"],
    config: {
      storage: {
        defaultProviderId: "local-context-store",
        providers: [
          {
            id: "local-context-store",
            type: "postgres",
            connectionRef: "local-ai-context-postgres",
            capabilities: ["full-text", "document-tree", "page-index", "symbol-code"]
          },
          {
            id: "local-postgres-context",
            type: "postgres",
            connectionRef: "local-ai-context-postgres",
            capabilities: ["pgvector", "graph"]
          }
        ]
      },
      retrieval: {
        enabled: true,
        providers: [
          {
            id: "local-full-text",
            type: "full-text",
            enabled: true,
            storageProviderId: "local-context-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "local-pgvector",
            type: "pgvector",
            enabled: true,
            storageProviderId: "local-postgres-context",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "local-page-index",
            type: "page-index",
            enabled: true,
            storageProviderId: "local-context-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "local-graph",
            type: "graph",
            enabled: true,
            storageProviderId: "local-postgres-context",
            safetyPolicy: { remoteSafe: false }
          }
        ],
        router: {
          strategy: "hybrid",
          providerOrder: ["local-full-text", "local-pgvector", "local-page-index", "local-graph"],
          maxResults: 12
        }
      },
      agents: {
        mode: "token-efficient-multi-agent",
        sharedContext: {
          enabled: true,
          maxPacketTokens: 9000
        }
      },
      tokenEfficiency: {
        enabled: true,
        tokenBudget: {
          maxTotalTokens: 24000,
          maxContextTokens: 12000,
          maxResponseTokens: 6000,
          reserveTokens: 2000,
          roleBudgets: {
            manager: 4000,
            "architecture-reviewer": 5000,
            "security-reviewer": 5000,
            "implementation-planner": 7000,
            "eval-reviewer": 4000,
            "docs-reviewer": 4000,
            planner: 5000,
            implementer: 9000,
            reviewer: 5000,
            security: 5000
          }
        }
      }
    }
  },
  {
    name: "remote-safe",
    label: "Remote Safe",
    description: "Remote HTTPS MCP/API contract surface with business-safe tool filtering.",
    capabilitySurface: ["HTTPS transport", "auth policy", "rate limits", "audit", "remote-safe tools"],
    config: {
      runtime: {
        modes: ["remote-http-mcp"],
        remoteHttpMcp: {
          enabled: true,
          transport: "https",
          host: "127.0.0.1",
          port: 8443,
          auth: { required: true, provider: "project", policyRef: "remote-auth-policy" },
          authorization: { required: true, policyRef: "remote-authorization-policy" },
          rateLimit: { required: true, policyRef: "remote-rate-limit-policy" },
          audit: { enabled: true, sink: "safe-log", policyRef: "remote-audit-policy" },
          exposeLocalFilesystem: false,
          allowShell: false,
          toolProfile: "remote-safe"
        }
      }
    }
  },
  {
    /**
     * hybrid-rag — production hybrid retrieval with RRF fusion and heuristic reranking.
     *
     * Combines full-text (tsvector/GIN), pgvector semantic similarity, PageIndex,
     * and symbol search. Results are merged via ReciprocalRankFusion (k=60) and
     * reranked via HeuristicReranker (exact match, recency, source priority, heading
     * depth). maxResults: 12 provides a rich, diverse context window within practical
     * token budgets.
     *
     * Requirements: Postgres with pgvector. Run `docker compose up -d postgres` before
     * starting. Storage type: postgres (same connection as local-context).
     */
    name: "hybrid-rag",
    label: "Hybrid RAG",
    description: "Production hybrid retrieval: full-text + pgvector + PageIndex + symbol with RRF merger and heuristic reranking.",
    capabilitySurface: [
      "full-text retrieval",
      "pgvector semantic retrieval",
      "page-index retrieval",
      "symbol/code retrieval",
      "RRF multi-provider fusion",
      "heuristic reranking"
    ],
    config: {
      storage: {
        defaultProviderId: "rag-context-store",
        providers: [
          {
            id: "rag-context-store",
            type: "postgres",
            connectionRef: "local-ai-context-postgres",
            capabilities: ["full-text", "document-tree", "page-index", "symbol-code"]
          },
          {
            id: "rag-vector-store",
            type: "postgres",
            connectionRef: "local-ai-context-postgres",
            capabilities: ["pgvector"]
          }
        ]
      },
      retrieval: {
        enabled: true,
        providers: [
          {
            id: "rag-full-text",
            type: "full-text",
            enabled: true,
            storageProviderId: "rag-context-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "rag-pgvector",
            type: "pgvector",
            enabled: true,
            storageProviderId: "rag-vector-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "rag-page-index",
            type: "page-index",
            enabled: true,
            storageProviderId: "rag-context-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "rag-symbol",
            type: "symbol-code",
            enabled: true,
            storageProviderId: "rag-context-store",
            safetyPolicy: { remoteSafe: false }
          }
        ],
        router: {
          strategy: "hybrid",
          providerOrder: ["rag-full-text", "rag-pgvector", "rag-page-index", "rag-symbol"],
          maxResults: 12,
          merger: "rrf",
          reranker: "heuristic"
        }
      },
      agents: {
        mode: "single-agent"
      }
    }
  },
  {
    name: "hybrid-all",
    label: "Hybrid All",
    description: "Combined local, remote-safe, API, retrieval, dashboard, and multi-agent contract surface.",
    capabilitySurface: ["local stdio MCP", "remote HTTPS MCP", "API service", "hybrid retrieval", "dashboard contracts"],
    config: {
      runtime: {
        modes: ["local-stdio-mcp", "remote-http-mcp", "api-service"],
        localStdioMcp: {
          enabled: true,
          transport: "stdio",
          allowLocalFilesystem: true,
          allowControlledWrites: true,
          allowShell: false,
          toolProfile: "controlled-write"
        },
        remoteHttpMcp: {
          enabled: true,
          transport: "https",
          host: "127.0.0.1",
          port: 8443,
          auth: { required: true, provider: "project", policyRef: "remote-auth-policy" },
          authorization: { required: true, policyRef: "remote-authorization-policy" },
          rateLimit: { required: true, policyRef: "remote-rate-limit-policy" },
          audit: { enabled: true, sink: "safe-log", policyRef: "remote-audit-policy" },
          exposeLocalFilesystem: false,
          allowShell: false,
          toolProfile: "remote-safe"
        },
        apiService: {
          enabled: true,
          transport: "https",
          host: "127.0.0.1",
          port: 8787,
          auth: { required: true, provider: "project", policyRef: "api-auth-policy" },
          authorization: { required: true, policyRef: "api-authorization-policy" },
          rateLimit: { required: true, policyRef: "api-rate-limit-policy" },
          audit: { enabled: true, sink: "safe-log", policyRef: "api-audit-policy" }
        }
      },
      dashboard: {
        enabled: true,
        host: "127.0.0.1",
        port: 8788,
        showTokenUsage: true,
        showRetrievalQuality: true,
        showEvalResults: true,
        showAuditEvents: true,
        showAgentWorkflows: true
      },
      storage: {
        defaultProviderId: "local-context-store",
        providers: [
          {
            id: "local-context-store",
            type: "postgres",
            connectionRef: "local-ai-context-postgres",
            capabilities: ["full-text", "document-tree", "page-index", "symbol-code"]
          },
          {
            id: "local-postgres-context",
            type: "postgres",
            connectionRef: "local-ai-context-postgres",
            capabilities: ["pgvector", "graph"]
          }
        ]
      },
      retrieval: {
        enabled: true,
        providers: [
          {
            id: "local-full-text",
            type: "full-text",
            enabled: true,
            storageProviderId: "local-context-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "local-pgvector",
            type: "pgvector",
            enabled: true,
            storageProviderId: "local-postgres-context",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "local-document-tree",
            type: "document-tree",
            enabled: true,
            storageProviderId: "local-context-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "local-page-index",
            type: "page-index",
            enabled: true,
            storageProviderId: "local-context-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "local-symbol-code",
            type: "symbol-code",
            enabled: true,
            storageProviderId: "local-context-store",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "local-graph",
            type: "graph",
            enabled: true,
            storageProviderId: "local-postgres-context",
            safetyPolicy: { remoteSafe: false }
          },
          {
            id: "local-hybrid",
            type: "hybrid",
            enabled: true,
            storageProviderId: "local-context-store",
            safetyPolicy: { remoteSafe: false }
          }
        ],
        router: {
          strategy: "hybrid",
          providerOrder: [
            "local-full-text",
            "local-pgvector",
            "local-document-tree",
            "local-page-index",
            "local-symbol-code",
            "local-graph"
          ],
          maxResults: 16
        }
      },
      agents: {
        mode: "token-efficient-multi-agent",
        sharedContext: {
          enabled: true,
          maxPacketTokens: 12000
        }
      },
      tokenEfficiency: {
        enabled: true,
        tokenBudget: {
          maxTotalTokens: 32000,
          maxContextTokens: 16000,
          maxResponseTokens: 8000,
          reserveTokens: 3000,
          roleBudgets: {
            manager: 5000,
            "architecture-reviewer": 6000,
            "security-reviewer": 6000,
            "implementation-planner": 9000,
            "eval-reviewer": 5000,
            "docs-reviewer": 5000,
            planner: 6000,
            implementer: 12000,
            reviewer: 6000,
            security: 6000,
            retrieval: 6000,
            dashboard: 4000
          }
        }
      }
    }
  }
];
