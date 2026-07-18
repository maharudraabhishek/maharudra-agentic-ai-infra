import { describe, expect, it } from "vitest";
import {
  importActualUsage,
  OpenAICsvParser,
  AnthropicCsvParser,
  ManualCsvParser,
  getUsageImportParser,
  reconcileUsage,
  buildEstimatedVsActualComparisons,
  buildUsageImportSummary
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const OPENAI_CSV_SAMPLE = `date,model,n_requests,n_context_tokens_total,n_generated_tokens_total,operation
2024-01-15,gpt-4o,10,5000,1200,
2024-01-16,gpt-4o-mini,25,8000,2000,
`;

const ANTHROPIC_CSV_SAMPLE = `date,model,input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens
2024-01-15,claude-sonnet-4-6,4000,1100,500,200
2024-01-16,claude-haiku-4-5,2000,600,0,100
`;

const ANTHROPIC_JSON_SAMPLE = JSON.stringify([
  {
    model: "claude-sonnet-4-6",
    input_tokens: 4000,
    output_tokens: 1100,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 200,
    timestamp: "2024-01-15T10:00:00Z"
  },
  {
    model: "claude-haiku-4-5",
    input_tokens: 2000,
    output_tokens: 600,
    timestamp: "2024-01-16T10:00:00Z"
  }
]);

const ANTHROPIC_JSON_DATA_WRAPPER = JSON.stringify({
  data: [
    {
      model: "claude-sonnet-4-6",
      input_tokens: 3000,
      output_tokens: 900,
      timestamp: "2024-01-17T10:00:00Z"
    }
  ]
});

const MANUAL_CSV_SAMPLE = `provider,client,model,run_id,input_tokens,output_tokens,total_tokens,cost,currency
anthropic,claude-code,claude-sonnet-4-6,run-001,4000,1100,5100,0.0156,USD
openai,codex,gpt-4o,run-002,3000,800,3800,0.0114,USD
`;

const MANUAL_JSON_SAMPLE = JSON.stringify([
  {
    provider: "anthropic",
    client: "claude-code",
    model: "claude-sonnet-4-6",
    run_id: "run-001",
    trace_id: "trace-abc",
    input_tokens: 4000,
    output_tokens: 1100,
    total_tokens: 5100,
    cost: 0.0156,
    currency: "USD"
  },
  {
    provider: "openai",
    client: "codex",
    model: "gpt-4o",
    run_id: "run-002",
    input_tokens: 3000,
    output_tokens: 800,
    total_tokens: 3800
  }
]);

// ---------------------------------------------------------------------------
// OpenAI CSV parser
// ---------------------------------------------------------------------------

describe("OpenAICsvParser", () => {
  it("parses a valid OpenAI CSV and maps column names correctly", () => {
    const parser = new OpenAICsvParser();
    const result = parser.parse(OPENAI_CSV_SAMPLE, "openai-usage.csv");

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.batch?.records).toHaveLength(2);

    const first = result.batch?.records[0];
    expect(first?.provider).toBe("openai");
    expect(first?.inputTokens).toBe(5000);
    expect(first?.outputTokens).toBe(1200);
    expect(first?.totalTokens).toBe(6200);
    expect(first?.model).toBe("gpt-4o");
    expect(first?.confidence).toBe("approximate");
    expect(first?.sourceFileName).toBe("openai-usage.csv");
  });

  it("reports correct skip count when rows have mismatched columns", () => {
    const csv = `date,model,n_context_tokens_total,n_generated_tokens_total\n2024-01-15,gpt-4o,5000\n2024-01-16,gpt-4o-mini,8000,2000\n`;
    const parser = new OpenAICsvParser();
    const result = parser.parse(csv, "test.csv");

    expect(result.ok).toBe(true);
    expect(result.batch?.skippedRows).toBeGreaterThanOrEqual(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns a fatal error when file exceeds size limit", () => {
    const bigContent = "a".repeat(11 * 1024 * 1024);
    const parser = new OpenAICsvParser();
    const result = parser.parse(bigContent, "huge.csv", {
      source: "openai-csv",
      maxFileSizeBytes: 10 * 1024 * 1024
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/exceeds limit/i);
  });

  it("returns a fatal error for empty CSV content", () => {
    const parser = new OpenAICsvParser();
    const result = parser.parse("", "empty.csv");

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Anthropic CSV parser
// ---------------------------------------------------------------------------

describe("AnthropicCsvParser", () => {
  it("parses a valid Anthropic CSV and maps cache columns", () => {
    const parser = new AnthropicCsvParser();
    const result = parser.parse(ANTHROPIC_CSV_SAMPLE, "anthropic-usage.csv");

    expect(result.ok).toBe(true);
    expect(result.batch?.records).toHaveLength(2);

    const first = result.batch?.records[0];
    expect(first?.provider).toBe("anthropic");
    expect(first?.inputTokens).toBe(4000);
    expect(first?.outputTokens).toBe(1100);
    expect(first?.cacheWriteTokens).toBe(500);
    expect(first?.cacheReadTokens).toBe(200);
    expect(first?.model).toBe("claude-sonnet-4-6");
  });
});

// ---------------------------------------------------------------------------
// Anthropic JSON parser
// ---------------------------------------------------------------------------

describe("importActualUsage with anthropic-usage-api-json", () => {
  it("parses a JSON array from Anthropic usage API", () => {
    const result = importActualUsage(ANTHROPIC_JSON_SAMPLE, "claude-usage.json", {
      source: "anthropic-usage-api-json"
    });

    expect(result.ok).toBe(true);
    expect(result.batch?.records).toHaveLength(2);

    const first = result.batch?.records[0];
    expect(first?.provider).toBe("anthropic");
    expect(first?.inputTokens).toBe(4000);
    expect(first?.cacheWriteTokens).toBe(500);
    expect(first?.cacheReadTokens).toBe(200);
    expect(first?.confidence).toBe("high");
  });

  it("parses the { data: [...] } wrapped format", () => {
    const result = importActualUsage(ANTHROPIC_JSON_DATA_WRAPPER, "claude-usage.json", {
      source: "anthropic-usage-api-json"
    });

    expect(result.ok).toBe(true);
    expect(result.batch?.records).toHaveLength(1);
  });

  it("returns a fatal error for malformed JSON", () => {
    const result = importActualUsage("{not valid json", "bad.json", {
      source: "anthropic-usage-api-json"
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/parse/i);
  });

  it("returns a fatal error for a JSON object that is not an array", () => {
    const result = importActualUsage('{"model":"gpt-4"}', "bad.json", {
      source: "anthropic-usage-api-json"
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/array/i);
  });
});

// ---------------------------------------------------------------------------
// Manual CSV parser
// ---------------------------------------------------------------------------

describe("ManualCsvParser", () => {
  it("parses a manual CSV with cost and currency columns", () => {
    const parser = new ManualCsvParser();
    const result = parser.parse(MANUAL_CSV_SAMPLE, "manual.csv");

    expect(result.ok).toBe(true);
    expect(result.batch?.records).toHaveLength(2);

    const first = result.batch?.records[0];
    expect(first?.provider).toBe("anthropic");
    expect(first?.client).toBe("claude-code");
    expect(first?.runId).toBe("run-001");
    expect(first?.totalTokens).toBe(5100);
    expect(first?.cost).toBeCloseTo(0.0156);
    expect(first?.currency).toBe("USD");
    expect(first?.confidence).toBe("estimated");
  });

  it("skips rows with zero token data", () => {
    const csv = `provider,client,total_tokens\nanthropiconly-no-tokens,claude-code,0\nanthropiconly,claude-code,500\n`;
    const parser = new ManualCsvParser();
    const result = parser.parse(csv, "test.csv");

    expect(result.ok).toBe(true);
    expect(result.batch?.records).toHaveLength(1);
    expect(result.batch?.skippedRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Manual JSON parser
// ---------------------------------------------------------------------------

describe("importActualUsage with manual-json", () => {
  it("parses a manual JSON array of usage objects", () => {
    const result = importActualUsage(MANUAL_JSON_SAMPLE, "usage.json", {
      source: "manual-json"
    });

    expect(result.ok).toBe(true);
    expect(result.batch?.records).toHaveLength(2);

    const first = result.batch?.records[0];
    expect(first?.provider).toBe("anthropic");
    expect(first?.runId).toBe("run-001");
    expect(first?.traceId).toBe("trace-abc");
    expect(first?.totalTokens).toBe(5100);
  });

  it("returns a fatal error for a non-array JSON value", () => {
    const result = importActualUsage('{"item":1}', "bad.json", {
      source: "manual-json"
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/array/i);
  });
});

// ---------------------------------------------------------------------------
// Privacy: no prompt / body / API key import
// ---------------------------------------------------------------------------

describe("privacy safety", () => {
  it("strips unsafe columns (prompt, content, api_key) before building records", () => {
    // CSV with unsafe columns that should be silently dropped.
    const csv = `provider,model,total_tokens,prompt,content,api_key\nanthropiconly,claude-sonnet-4-6,5000,DO NOT STORE,ALSO DO NOT STORE,sk-secret\n`;
    const result = importActualUsage(csv, "test.csv", { source: "generic-csv" });

    expect(result.ok).toBe(true);
    const record = result.batch?.records[0] as Record<string, unknown> | undefined;
    // Ensure none of the unsafe fields appear anywhere in the safe record.
    expect(JSON.stringify(record)).not.toContain("DO NOT STORE");
    expect(JSON.stringify(record)).not.toContain("ALSO DO NOT STORE");
    expect(JSON.stringify(record)).not.toContain("sk-secret");
  });

  it("hashes user_id column by default", () => {
    const csv = `provider,model,total_tokens,user_id\nanthropiconly,claude-sonnet-4-6,5000,user@example.com\n`;
    const result = importActualUsage(csv, "test.csv", {
      source: "generic-csv",
      hashUserIds: true
    });

    expect(result.ok).toBe(true);
    const record = result.batch?.records[0];
    expect(record?.userIdHash).toBeDefined();
    // Hashed ID should not match the original value.
    expect(record?.userIdHash).not.toBe("user@example.com");
    // Hash should be 16 hex chars (truncated SHA-256).
    expect(record?.userIdHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("redacts user_id when redactUserIds is true", () => {
    const csv = `provider,model,total_tokens,user_id\nanthropiconly,claude-sonnet-4-6,5000,user@example.com\n`;
    const result = importActualUsage(csv, "test.csv", {
      source: "generic-csv",
      redactUserIds: true
    });

    expect(result.ok).toBe(true);
    const record = result.batch?.records[0];
    expect(record?.userIdHash).toBe("[redacted]");
  });

  it("does not store raw email even when hash is disabled", () => {
    // Even with hashUserIds: false, the raw email must not appear in unsafe
    // columns. Only user_id-mapped columns flow through handleUserId.
    const csv = `provider,model,total_tokens,user_email\nanthropiconly,claude-sonnet-4-6,5000,user@example.com\n`;
    const result = importActualUsage(csv, "test.csv", {
      source: "generic-csv",
      hashUserIds: false
    });

    expect(result.ok).toBe(true);
    // user_email is in UNSAFE_COLUMN_NAMES so the record must not contain the email.
    expect(JSON.stringify(result.batch?.records[0])).not.toContain("user@example.com");
  });
});

// ---------------------------------------------------------------------------
// Row and file size limits
// ---------------------------------------------------------------------------

describe("import limits", () => {
  it("respects maxRows and counts skipped rows", () => {
    const rows = Array.from(
      { length: 20 },
      (_, i) => `anthropic,claude-sonnet-4-6,${(i + 1) * 1000},${(i + 1) * 200}`
    ).join("\n");
    const csv = `provider,model,total_tokens,output_tokens\n${rows}\n`;

    const result = importActualUsage(csv, "test.csv", {
      source: "generic-csv",
      maxRows: 5
    });

    expect(result.ok).toBe(true);
    expect(result.batch?.records.length).toBeLessThanOrEqual(5);
    expect(result.batch?.skippedRows).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes("Row limit"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("getUsageImportParser", () => {
  it("returns a parser for all supported source formats", () => {
    const sources = [
      "openai-csv",
      "anthropic-usage-api-json",
      "anthropic-csv",
      "manual-json",
      "manual-csv",
      "generic-csv"
    ] as const;

    for (const source of sources) {
      expect(getUsageImportParser(source)).toBeDefined();
    }
  });

  it("returns undefined for an unknown source", () => {
    expect(
      getUsageImportParser("unknown-format" as never)
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

describe("reconcileUsage", () => {
  const estimatedRecords = [
    { runId: "run-001", traceId: "trace-abc", client: "claude-code", model: "claude-sonnet-4-6", taskType: "debugging", estimatedTokens: 4500, timestamp: "2024-01-15T10:00:00Z" },
    { runId: "run-002", traceId: "trace-def", client: "codex", model: "gpt-4o", taskType: "explanation", estimatedTokens: 3200, timestamp: "2024-01-16T10:00:00Z" },
    { runId: "run-003", client: "claude-code", model: "claude-sonnet-4-6", estimatedTokens: 2000, timestamp: "2024-01-17T10:00:00Z" }
  ];

  it("matches by runId when available", () => {
    const batch = {
      source: "manual-json" as const,
      sourceFileName: "usage.json",
      importedAt: new Date().toISOString(),
      records: [
        {
          provider: "anthropic", client: "claude-code", model: "claude-sonnet-4-6",
          runId: "run-001", totalTokens: 5100, inputTokens: 4000, outputTokens: 1100,
          sourceFileName: "usage.json", importedAt: new Date().toISOString(),
          confidence: "high" as const
        }
      ],
      skippedRows: 0,
      totalRows: 1
    };

    const report = reconcileUsage(estimatedRecords, [batch]);

    const matched = report.entries.find((e) => e.runId === "run-001");
    expect(matched?.matchStatus).toBe("matched-run-id");
    expect(matched?.estimatedTokens).toBe(4500);
    expect(matched?.actualTokens).toBe(5100);
    expect(matched?.delta).toBe(600); // actual - estimated
  });

  it("falls back to traceId matching when runId is absent from actual record", () => {
    const batch = {
      source: "manual-json" as const,
      sourceFileName: "usage.json",
      importedAt: new Date().toISOString(),
      records: [
        {
          provider: "anthropic", client: "claude-code", model: "claude-sonnet-4-6",
          // No runId on the actual record — only traceId.
          traceId: "trace-abc",
          totalTokens: 5100, inputTokens: 4000, outputTokens: 1100,
          sourceFileName: "usage.json", importedAt: new Date().toISOString(),
          confidence: "high" as const
        }
      ],
      skippedRows: 0,
      totalRows: 1
    };

    const report = reconcileUsage(estimatedRecords, [batch]);

    const matched = report.entries.find((e) => e.traceId === "trace-abc" && e.matchStatus !== "unmatched-estimated");
    expect(matched?.matchStatus).toBe("matched-trace-id");
  });

  it("falls back to timestamp window matching", () => {
    const batch = {
      source: "manual-json" as const,
      sourceFileName: "usage.json",
      importedAt: new Date().toISOString(),
      records: [
        {
          provider: "openai", client: "codex", model: "gpt-4o",
          // Timestamp within 5 min of run-002.
          timestamp: "2024-01-16T10:02:00Z",
          totalTokens: 3500, inputTokens: 3000, outputTokens: 500,
          sourceFileName: "usage.json", importedAt: new Date().toISOString(),
          confidence: "approximate" as const
        }
      ],
      skippedRows: 0,
      totalRows: 1
    };

    // Use estimated records without IDs to force timestamp matching.
    const estNoIds = [
      { runId: "run-ts-1", client: "codex", model: "gpt-4o", estimatedTokens: 3200, timestamp: "2024-01-16T10:00:00Z" }
    ];

    const report = reconcileUsage(estNoIds, [batch]);
    const matched = report.entries.find((e) => e.runId === "run-ts-1" && e.matchStatus !== "unmatched-estimated");
    expect(matched?.matchStatus).toBe("matched-timestamp-window");
  });

  it("produces unmatched-estimated entries for runs with no matching actual record", () => {
    const report = reconcileUsage(estimatedRecords, []);

    const unmatched = report.entries.filter((e) => e.matchStatus === "unmatched-estimated");
    expect(unmatched).toHaveLength(estimatedRecords.length);
    expect(report.unmatchedEstimatedCount).toBe(estimatedRecords.length);
    expect(report.matchedCount).toBe(0);
  });

  it("produces unmatched-actual entries for actual records with no estimated match", () => {
    const batch = {
      source: "manual-csv" as const,
      sourceFileName: "usage.csv",
      importedAt: new Date().toISOString(),
      records: [
        {
          provider: "openai", runId: "run-orphan",
          totalTokens: 1000, inputTokens: 800, outputTokens: 200,
          sourceFileName: "usage.csv", importedAt: new Date().toISOString(),
          confidence: "high" as const
        }
      ],
      skippedRows: 0,
      totalRows: 1
    };

    const report = reconcileUsage([], [batch]);

    const unmatched = report.entries.filter((e) => e.matchStatus === "unmatched-actual");
    expect(unmatched).toHaveLength(1);
    expect(report.unmatchedActualCount).toBe(1);
  });

  it("computes delta and deltaPercent correctly for matched entries", () => {
    const batch = {
      source: "manual-json" as const,
      sourceFileName: "usage.json",
      importedAt: new Date().toISOString(),
      records: [
        {
          provider: "anthropic", runId: "run-001",
          totalTokens: 6000, inputTokens: 5000, outputTokens: 1000,
          sourceFileName: "usage.json", importedAt: new Date().toISOString(),
          confidence: "high" as const
        }
      ],
      skippedRows: 0,
      totalRows: 1
    };

    const est = [{ runId: "run-001", estimatedTokens: 4000 }];
    const report = reconcileUsage(est, [batch]);

    const entry = report.entries.find((e) => e.runId === "run-001" && e.matchStatus !== "unmatched-estimated");
    expect(entry?.delta).toBe(2000);   // 6000 - 4000
    expect(entry?.deltaPercent).toBe(50); // 2000 / 4000 = 50%
  });

  it("includes possibleCauses notes in every report", () => {
    const report = reconcileUsage([], []);
    expect(report.possibleCauses.length).toBeGreaterThan(0);
    expect(report.possibleCauses.some((c) => c.toLowerCase().includes("reasoning"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildEstimatedVsActualComparisons
// ---------------------------------------------------------------------------

describe("buildEstimatedVsActualComparisons", () => {
  it("labels all entries as estimated in estimated-only mode", () => {
    const report = reconcileUsage(
      [{ runId: "r1", client: "codex", estimatedTokens: 3000 }],
      []
    );
    const comparisons = buildEstimatedVsActualComparisons(report, "estimated-only");

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]?.hasActualData).toBe(false);
    expect(comparisons[0]?.confidence).toBe("estimated");
    expect(comparisons[0]?.notes.some((n) => n.toLowerCase().includes("estimated"))).toBe(true);
  });

  it("omits clients with no actual data in actual-imported-only mode", () => {
    const report = reconcileUsage(
      [{ runId: "r1", client: "codex", estimatedTokens: 3000 }],
      []
    );
    const comparisons = buildEstimatedVsActualComparisons(report, "actual-imported-only");
    expect(comparisons).toHaveLength(0);
  });

  it("shows both sides and delta in estimated-vs-actual mode", () => {
    const batch = {
      source: "manual-json" as const,
      sourceFileName: "usage.json",
      importedAt: new Date().toISOString(),
      records: [
        {
          provider: "anthropic", client: "claude-code", runId: "r1",
          totalTokens: 5000, inputTokens: 4000, outputTokens: 1000,
          sourceFileName: "usage.json", importedAt: new Date().toISOString(),
          confidence: "high" as const
        }
      ],
      skippedRows: 0,
      totalRows: 1
    };

    const report = reconcileUsage(
      [{ runId: "r1", client: "claude-code", estimatedTokens: 4000 }],
      [batch]
    );
    const comparisons = buildEstimatedVsActualComparisons(report, "estimated-vs-actual");

    const entry = comparisons.find((c) => c.client === "claude-code");
    expect(entry?.hasActualData).toBe(true);
    expect(entry?.actualTokens).toBe(5000);
    expect(entry?.delta).toBe(1000);
    expect(entry?.deltaPercent).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// buildUsageImportSummary
// ---------------------------------------------------------------------------

describe("buildUsageImportSummary", () => {
  it("aggregates totals across batches", () => {
    const batch1 = {
      source: "openai-csv" as const,
      sourceFileName: "openai.csv",
      importedAt: new Date().toISOString(),
      records: [
        {
          provider: "openai", totalTokens: 6200, inputTokens: 5000, outputTokens: 1200,
          cost: 0.02, currency: "USD",
          sourceFileName: "openai.csv", importedAt: new Date().toISOString(),
          confidence: "approximate" as const
        }
      ],
      skippedRows: 0,
      totalRows: 1
    };

    const batch2 = {
      source: "anthropic-csv" as const,
      sourceFileName: "anthropic.csv",
      importedAt: new Date().toISOString(),
      records: [
        {
          provider: "anthropic", totalTokens: 5100, inputTokens: 4000, outputTokens: 1100,
          cost: 0.0156, currency: "USD",
          sourceFileName: "anthropic.csv", importedAt: new Date().toISOString(),
          confidence: "approximate" as const
        }
      ],
      skippedRows: 0,
      totalRows: 1
    };

    const summary = buildUsageImportSummary([batch1, batch2]);

    expect(summary.totalImportedRecords).toBe(2);
    expect(summary.totalActualTokens).toBe(11300);
    expect(summary.sources).toContain("openai-csv");
    expect(summary.sources).toContain("anthropic-csv");
    expect(summary.totalActualCost).toBeCloseTo(0.0356);
    expect(summary.currency).toBe("USD");
  });

  it("returns undefined cost when no records have cost", () => {
    const batch = {
      source: "manual-csv" as const,
      sourceFileName: "test.csv",
      importedAt: new Date().toISOString(),
      records: [
        {
          provider: "generic", totalTokens: 1000, inputTokens: 800, outputTokens: 200,
          sourceFileName: "test.csv", importedAt: new Date().toISOString(),
          confidence: "estimated" as const
        }
      ],
      skippedRows: 0,
      totalRows: 1
    };

    const summary = buildUsageImportSummary([batch]);
    expect(summary.totalActualCost).toBeUndefined();
    expect(summary.currency).toBeUndefined();
  });
});
