# LLM SmartRouter

This document covers the provider-agnostic LLM infrastructure introduced in Stage 19. It explains
what SmartRouter does, how to configure it, and the design decisions behind cost control and
provider fallback.

---

## 1. Overview

SmartRouter is Layer 11 in the v3 architecture — the Model plane. It selects an LLM provider per
call using a routing policy, enforces a per-call cost budget before any network request is made,
and automatically falls back to the next provider when one fails.

**What SmartRouter does not do yet:**
- It is not called by any framework feature in Stage 19. Integration with query rewrite begins in Stage 21.
- It does not support streaming responses. Streaming support is planned for Stage 26+.
- It does not count tokens exactly. All providers use a heuristic (`ceil(length / 4)`) for Stage 19 budget estimation. Exact counting via provider APIs is Stage 24+.

---

## 2. Provider Types

Three provider implementations are available. Choose based on your environment and requirements.

| Type | Class | isLocal | Cost | Requires |
|---|---|---|---|---|
| `"mock"` | `MockLlmProvider` | true | 0 | nothing — deterministic |
| `"ollama"` | `OllamaLlmProvider` | true | 0 | `ollama serve` running locally |
| `"anthropic"` | `AnthropicLlmProvider` | false | per-token | env var with API key |

**Mock** — deterministic and always available. Returns `"[mock] received N chars"` where N is
the prompt length. Used in tests, CI, and any scenario that needs a provider without a network
dependency.

**Ollama** — runs on your local machine. Free, private, and immune to the budget gate (cost is
always 0). Requires Ollama to be running (`ollama serve`) and a model to be pulled
(`ollama pull llama3.2`). Uses the `/api/generate` HTTP endpoint with `stream: false`.

**Anthropic** — the Anthropic Messages API (`/v1/messages`). Incurs real per-token costs.
The API key must be in an environment variable; it is never stored in config files or logged.
Requires `ANTHROPIC_API_KEY` (or the configured `apiKeyEnvVar`) to be set at runtime.

---

## 3. Routing Policy

`LlmRoutingPolicy` controls how SmartRouter orders and selects providers.

```txt
  LlmRoutingPolicy
  ─────────────────────────────────────────────────────────────
  preferLocal         boolean    true = local providers first
  maxCostPerCallUsd   number     hard per-call cost ceiling (USD)
  fallbackChain       string[]   provider ids in try order
  timeoutMs?          number     per-call abort timeout (default 30 000)
```

**preferLocal** — when true, any provider with `isLocal = true` (mock, ollama) is tried before
remote providers regardless of the fallback chain order. This is the recommended setting for
development: local providers are free and fast.

**fallbackChain** — explicit ordered list of provider ids to try. Providers not named in the
chain are appended after. When empty, providers are tried in construction order.

**maxCostPerCallUsd** — cost ceiling enforced before each provider attempt. If the estimated
cost exceeds this limit, the call is refused with `llm.budget-exceeded` without contacting any
provider. This is a hard stop, not a fallback signal.

---

## 4. Budget Gate

The budget gate checks estimated cost before every provider attempt in the fallback chain.

```txt
  Call flow for each provider in orderedProviders():
  ───────────────────────────────────────────────────
  1. countTokens(prompt + systemPrompt) → inputTokens
  2. maxTokens ?? 512                  → outputTokens (conservative estimate)
  3. CostCatalog.estimateCost(...)     → estimatedCostUsd
  4. BudgetGate.check(...)
        │
        ├─ allowed: true  → call provider.complete()
        └─ allowed: false → return llm.budget-exceeded (hard stop)
```

Budget-exceeded does **not** trigger fallback. This is intentional: the budget limit is a hard
ceiling for cost control. If a call is refused, the caller must either raise the limit, use a
cheaper model, or shorten the prompt. Silently falling through to another provider would make
cost control unpredictable.

Local providers (mock, ollama) always have `estimatedCostUsd = 0`, so they are never blocked
by the budget gate regardless of how small `maxCostPerCallUsd` is.

---

## 5. Cost Catalog

`DefaultCostCatalog` holds approximate per-token USD prices for known Anthropic models.
Local providers (ollama, mock) always return 0.

| Provider/Model | Input (per token) | Output (per token) |
|---|---|---|
| anthropic/claude-haiku-4-5 | $0.0000008 | $0.000004 |
| anthropic/claude-sonnet-4-6 | $0.000003 | $0.000015 |
| anthropic/claude-opus-4-6 | $0.000015 | $0.000075 |
| ollama/\* | $0 | $0 |
| mock/\* | $0 | $0 |

Prices are approximate, sourced from Anthropic pricing as of 2025-Q2. For unknown models
the catalog returns 0 — treat this as "unknown cost, allow the call" rather than "free".

A custom `CostCatalog` implementation can be passed to `SmartRouter` to use live pricing
or include models not in the default table (Stage 24+).

---

## 6. Wire-Up

To enable SmartRouter, add an `llm` section to your project config. When absent, SmartRouter
is not instantiated and framework features that use LLMs are not available.

```typescript
import { createRuntimeServiceContainer } from "@maharudra/agentic-ai-infra-runtime";

const container = createRuntimeServiceContainer({
  profiles: ["vectorless-local"],
  llm: {
    providers: [
      { id: "local", type: "ollama", model: "llama3.2" },
      { id: "remote", type: "anthropic", model: "claude-haiku-4-5",
        apiKeyEnvVar: "ANTHROPIC_API_KEY" }
    ],
    routing: {
      preferLocal: true,
      maxCostPerCallUsd: 0.01,
      fallbackChain: ["local", "remote"]
    }
  }
});

if (container.ok && container.value.smartRouter) {
  const result = await container.value.smartRouter.complete({
    prompt: "Explain retrieval-augmented generation in one sentence."
  });
}
```

---

## 7. Example Config (Pseudocode)

```txt
llm:
  providers:
    - id: "local-ollama"
      type: ollama
      model: llama3.2
      baseUrl: http://localhost:11434

    - id: "cloud-claude"
      type: anthropic
      model: claude-haiku-4-5
      apiKeyEnvVar: ANTHROPIC_API_KEY

  routing:
    preferLocal: true
    maxCostPerCallUsd: 0.01
    fallbackChain:
      - "local-ollama"
      - "cloud-claude"
    timeoutMs: 30000
```

This config tries `local-ollama` first (free, local), falls back to `cloud-claude` if
unavailable, and refuses calls estimated above $0.01.

---

## 8. Testing

Use `MockLlmProvider` for all unit tests that involve the LLM layer. It requires no network,
no setup, and is deterministic.

```typescript
import { MockLlmProvider } from "@maharudra/agentic-ai-infra-test-utils";

const provider = new MockLlmProvider("test");
const result = await provider.complete({ prompt: "hello" });
// result.value.content === "[mock] received 5 chars"
```

For tests that need a failing provider, define `FailingMockLlmProvider` inline in the test
file rather than importing it from a shared location:

```typescript
class FailingMockLlmProvider extends MockLlmProvider {
  override async complete(): Promise<FrameworkResult<LlmResponse>> {
    return { ok: false, error: { code: "llm.provider-unavailable",
      message: "test failure", severity: "recoverable" } };
  }
}
```

---

## 9. Flow Diagram

The following diagram shows how SmartRouter routes a single `complete()` call.

```txt
  LlmRequest
      │
      ▼
  SmartRouter
      │
      ├─ build ordered providers (local-first if preferLocal)
      │
      ▼ for each provider in order
  countTokens() → estimateCost() → BudgetGate.check()
      │                                     │
      │ allowed                             │ blocked
      ▼                                     ▼
  provider.complete()              llm.budget-exceeded (stop)
      │
      ├─ ok: true  → return LlmResponse
      └─ ok: false → next provider
              │
          (all failed)
              ▼
      llm.fallback-exhausted
```

---

## 10. Known Gaps

| Gap | Notes |
|---|---|
| SmartRouter not yet called by framework | First use is Stage 21 — query rewrite |
| Streaming not supported | `LlmRequest`/`LlmResponse` are single-turn; streaming is Stage 26+ |
| Exact token counting (heuristic only) | All providers use `ceil(length / 4)` heuristic; Stage 24+ adds provider API exact counting |
| AnthropicLlmProvider not tested against live API in CI | CI has no API key; integration tests run manually |
| CostCatalog prices are approximate | Sourced 2025-Q2; use a custom `CostCatalog` for live pricing |
