/**
 * Content Guard implementations — Stage 25.5 D42.
 *
 * `NoopContentGuard` is the default, auto-wired into
 * `RuntimeServiceContainer.contentGuard` when no override is supplied.
 * Stage 42 (Constitutional AI) ships `LlmJudgeContentGuard` and injects
 * it via `RuntimeServiceContainerOptions.contentGuard`.
 *
 * @umbrella Guardrails
 */
import type {
  ContentGuard,
  ContentGuardInput,
  SafetyVerdict
} from "@maharudra/agentic-ai-infra-core";

/**
 * Default no-op content guard. Always returns `safe: true, action: "pass"`.
 * D23 preserved — absence of configuration produces this default.
 */
export class NoopContentGuard implements ContentGuard {
  async inspect(_input: ContentGuardInput): Promise<SafetyVerdict> {
    return { safe: true, action: "pass" };
  }
}
