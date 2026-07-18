/**
 * Anti-drift gate: verifies that every CLI_PROFILE_NAMES entry generates a config
 * that passes DefaultConfigValidator.
 *
 * If a profile is added to core's BUILT_IN_PROFILE_NAMES but the CLI generator is
 * not updated to produce a compatible config for it, this test will fail and surface
 * the gap before it reaches production.
 *
 * Stage 16 additions (extend only — do not duplicate Stage 11 assertions):
 * (a) No storage provider has type "filesystem" (explicit guard alongside validator rejection)
 * (b) Per-profile retrieval and storage type expectations (no-RAG, vectorless-local, postgres)
 * (c) Non-empty projectName regression guard for slug/name default logic
 */
import type { AgenticInfraProjectConfig } from "@maharudra/agentic-ai-infra-core";
import { DefaultConfigValidator } from "@maharudra/agentic-ai-infra-core";
import { describe, expect, it } from "vitest";
import { createProjectConfig } from "../src/config-factory.js";
import { CLI_PROFILE_NAMES } from "../src/types.js";
import { normalizeInitOptions } from "../src/validation.js";

const validator = new DefaultConfigValidator();

// Profiles with no RAG requirement: retrieval strategies are empty by design.
const NO_RAG_PROFILES = new Set([
  "minimal",
  "secure-readonly",
  "controlled-write",
  "remote-safe"
]);

// Profiles that declare Postgres storage when retrieval strategies are supplied.
const POSTGRES_PROFILES = new Set([
  "local-context",
  "full-agentic-context",
  "hybrid-all"
]);

// hybrid-rag always emits all four providers + merger/reranker without needing
// explicit retrieval strategy flags — the profile drives the full pipeline.
const HYBRID_RAG_PROVIDERS = ["full-text", "pgvector", "page-index", "symbol-code"];

describe("profile-config smoke (anti-drift gate)", () => {
  for (const profileName of CLI_PROFILE_NAMES) {
    it(`profile "${profileName}" generates a config that passes DefaultConfigValidator`, () => {
      const normalized = normalizeInitOptions({
        projectName: "Smoke Test Project",
        slug: "smoke-test-project",
        profile: profileName
      });

      // --- EXISTING ASSERTIONS (Stage 11, do not remove) ---
      expect(
        normalized.ok,
        `normalizeInitOptions failed for profile "${profileName}": ` +
          (normalized.ok ? "" : normalized.issues.map((i) => i.message).join("; "))
      ).toBe(true);

      if (!normalized.ok) {
        return;
      }

      const config = createProjectConfig(normalized.value);

      const result = validator.validate(config as unknown as AgenticInfraProjectConfig);

      expect(
        result.ok,
        `DefaultConfigValidator rejected config for profile "${profileName}". ` +
          (!result.ok ? result.issues?.map((i: { message: string }) => i.message).join("; ") : "")
      ).toBe(true);

      // --- STAGE 16 ADDITIONS ---

      const storageProviders =
        (config.storage as { providers?: Array<{ type: string }> }).providers ?? [];

      // (a) No storage provider has type "filesystem".
      // The validator also rejects this, but the explicit assertion here names the offending
      // provider so the failure is immediately actionable when a future profile regresses.
      for (const provider of storageProviders) {
        expect(
          provider.type,
          `Storage provider for profile "${profileName}" must not be "filesystem" (regression guard)`
        ).not.toBe("filesystem");
      }

      // (c) projectName is non-empty — regression guard for slug/name default logic.
      // Ensures a future refactor of slugifyProjectName or projectName defaulting does
      // not silently produce an empty name in the generated project block.
      expect(
        (config.project as { name?: string }).name,
        `projectName must be non-empty in generated config for profile "${profileName}"`
      ).toBeTruthy();

      // (b) Per-profile retrieval provider and storage type expectations.
      const retrievalProviders =
        (config.retrieval as { providers?: Array<{ type: string }> }).providers ?? [];

      if (NO_RAG_PROFILES.has(profileName)) {
        // No RAG requirement: retrieval strategies are empty, so the generated retrieval
        // providers list must be empty or contain only non-pgvector providers.
        const noPgvector =
          retrievalProviders.length === 0 ||
          retrievalProviders.every((p) => p.type !== "pgvector");
        expect(
          noPgvector,
          `Profile "${profileName}" must not declare pgvector retrieval providers (no RAG requirement)`
        ).toBe(true);
      } else if (profileName === "vectorless-local") {
        // vectorless-local: must declare an in-memory storage provider; pgvector is excluded
        // because the profile has no vector store dependency.
        expect(
          storageProviders.some((p) => p.type === "memory"),
          `Profile "vectorless-local" must include at least one memory storage provider`
        ).toBe(true);
        expect(
          retrievalProviders.every((p) => p.type !== "pgvector"),
          `Profile "vectorless-local" must not include a pgvector retrieval provider`
        ).toBe(true);
      } else if (profileName === "hybrid-rag") {
        // hybrid-rag: always emits postgres storage, four specific retrieval providers,
        // merger:"rrf", and reranker:"heuristic" — no extra strategy flags needed.
        expect(
          storageProviders.some((p) => p.type === "postgres"),
          `Profile "hybrid-rag" must declare postgres storage`
        ).toBe(true);
        expect(
          storageProviders.every((p) => p.type !== "filesystem"),
          `Profile "hybrid-rag" must not emit filesystem storage`
        ).toBe(true);

        // Validate the four required retrieval providers are present.
        for (const expectedType of HYBRID_RAG_PROVIDERS) {
          expect(
            retrievalProviders.some((p) => p.type === expectedType),
            `Profile "hybrid-rag" must include a "${expectedType}" provider`
          ).toBe(true);
        }

        // Validate merger and reranker fields in the generated router config.
        const router = (config.retrieval as { router?: { merger?: string; reranker?: string; maxResults?: number } }).router;
        expect(router?.merger, `hybrid-rag router must declare merger:"rrf"`).toBe("rrf");
        expect(router?.reranker, `hybrid-rag router must declare reranker:"heuristic"`).toBe("heuristic");
        expect(router?.maxResults, `hybrid-rag router maxResults must be 12`).toBe(12);
      } else if (POSTGRES_PROFILES.has(profileName)) {
        // local-context, full-agentic-context, hybrid-all: when retrieval strategies are
        // provided, storage must be postgres and at least one retrieval provider must be
        // declared. The base smoke options have no retrieval strategies, so we normalize
        // a second time with full-text to exercise the retrieval-aware config path.
        const withRetrieval = normalizeInitOptions({
          projectName: "Smoke Test Project",
          slug: "smoke-test-project",
          profile: profileName,
          retrieval: ["full-text"]
        });
        expect(
          withRetrieval.ok,
          `normalizeInitOptions with retrieval strategies must succeed for profile "${profileName}"`
        ).toBe(true);
        if (withRetrieval.ok) {
          const configWithRetrieval = createProjectConfig(withRetrieval.value);
          const pgProviders =
            (configWithRetrieval.storage as { providers?: Array<{ type: string }> }).providers ?? [];
          expect(
            pgProviders.some((p) => p.type === "postgres"),
            `Profile "${profileName}" must declare postgres storage when retrieval strategies are provided`
          ).toBe(true);
          const pgRetrievalProviders =
            (configWithRetrieval.retrieval as { providers?: Array<{ type: string }> }).providers ?? [];
          expect(
            pgRetrievalProviders.length,
            `Profile "${profileName}" must declare at least one retrieval provider when retrieval strategies are provided`
          ).toBeGreaterThan(0);
        }
      }
    });
  }
});
