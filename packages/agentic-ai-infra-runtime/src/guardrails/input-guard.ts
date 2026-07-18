/**
 * Input Guard — Stage 25.5 Phase 01
 *
 * Wires `SecurityConfig.promptInjectionDefense` (declared in Stage 5, never
 * enforced at runtime) into the retrieval/context tool handlers.
 *
 * Position in the v3 layer model: Layer 8 → Layer 9 boundary.
 * Runs AFTER retrieval results are produced and BEFORE the context package
 * is returned to the executor. Heuristic-only (no LLM call), so Stage 21 D1
 * (Layer 11 not callable from Layer 8) is honored.
 *
 * Defaults to NON-FATAL — emits an observability warning when
 * `warnOnUntrustedContent` is true; does not block the context build.
 *
 * @umbrella Guardrails (project-wide vocabulary, Stage 25.5 D25)
 */
import type {
  ContextPackage,
  PromptInjectionDefenseConfig,
  RetrievalResult,
  SecurityConfig
} from "@maharudra/agentic-ai-infra-core";
import type { RuntimeObservabilitySink } from "../observability/index.js";

/**
 * Heuristic patterns that suggest a retrieved document is trying to override
 * higher-precedence instructions. These are intentionally conservative —
 * false positives are acceptable, false negatives are not.
 */
const INJECTION_HEURISTICS: readonly RegExp[] = [
  /\bignore\s+(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instruction|prompt|message|rule)s?\b/i,
  /\b(?:disregard|override|forget)\s+(?:the\s+)?(?:system|user|prior|above)\s+(?:prompt|instruction|rule)s?\b/i,
  /\b(?:you\s+are\s+now|new\s+instruction|new\s+role)\b.{0,80}\b(?:assistant|agent|ai|system)\b/i,
  /<\s*\/?\s*(?:system|user|assistant|instruction)\s*>/i
];

/** Input accepted by `DefaultInputGuard.inspect`. */
export type InputGuardInput = {
  readonly contextPackage: ContextPackage;
  readonly retrievedResults: readonly RetrievalResult[];
  readonly runtimeMode: string;
};

/** Result of an input-guard inspection. */
export type InputGuardVerdict = {
  /** When false, callers SHOULD NOT use the context package. Non-blocking by default. */
  readonly clean: boolean;
  /** Number of retrieved results that tripped a heuristic. */
  readonly suspectCount: number;
  /** Reasons in plain language for observability/dashboards. */
  readonly reasons: readonly string[];
};

/**
 * Read-only interface for input guards (D21 pattern — mutation on impls, not interface).
 */
export interface InputGuard {
  inspect(input: InputGuardInput): InputGuardVerdict;
}

/**
 * No-op guard — used when `promptInjectionDefense.enabled` is false or absent.
 * Always returns `clean: true`. Honors D23 (default behavior unchanged).
 */
export class NoopInputGuard implements InputGuard {
  inspect(_input: InputGuardInput): InputGuardVerdict {
    return { clean: true, suspectCount: 0, reasons: [] };
  }
}

/**
 * Default input guard. Reads `SecurityConfig.promptInjectionDefense` and
 * applies heuristic checks to retrieved content. Non-fatal: emits warnings
 * through the observability sink when `warnOnUntrustedContent` is true.
 */
export class DefaultInputGuard implements InputGuard {
  constructor(
    private readonly config: PromptInjectionDefenseConfig,
    private readonly observability?: RuntimeObservabilitySink
  ) {}

  inspect(input: InputGuardInput): InputGuardVerdict {
    if (!this.config.enabled) {
      return { clean: true, suspectCount: 0, reasons: [] };
    }

    const reasons: string[] = [];
    let suspectCount = 0;

    for (const result of input.retrievedResults) {
      const text = `${result.content ?? ""}`;

      for (const pattern of INJECTION_HEURISTICS) {
        if (pattern.test(text)) {
          suspectCount += 1;
          reasons.push(
            `sourceId="${result.sourceId}" matched ${pattern.source.slice(0, 40)}...`
          );
          break;
        }
      }
    }

    const clean = suspectCount === 0;

    if (!clean && this.config.warnOnUntrustedContent) {
      void this.observability?.log({
        level: "warn",
        message: "[InputGuard] Retrieved content matched injection heuristic; treating as evidence not instruction (D26).",
        metadata: { suspectCount, reasonCount: reasons.length }
      });
    }

    return { clean, suspectCount, reasons };
  }
}

/**
 * Factory: builds the right guard for a `SecurityConfig`.
 *
 * @param security - May be undefined; the guard is no-op in that case.
 * @returns `DefaultInputGuard` when promptInjectionDefense.enabled is true;
 *   `NoopInputGuard` otherwise. D23 backwards-compat.
 */
export function createInputGuard(
  security: SecurityConfig | undefined,
  observability?: RuntimeObservabilitySink
): InputGuard {
  const config = security?.promptInjectionDefense;

  if (!config || !config.enabled) {
    return new NoopInputGuard();
  }

  return new DefaultInputGuard(config, observability);
}
