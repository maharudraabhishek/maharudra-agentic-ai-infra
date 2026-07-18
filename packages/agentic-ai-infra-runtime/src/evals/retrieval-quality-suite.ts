import type {
  EvalSuiteContract,
  FrameworkResult,
  QualityReport
} from "@maharudra/agentic-ai-infra-core";
import { ok } from "@maharudra/agentic-ai-infra-core";
import { runRetrievalQualityEvals, type RetrievalQualityEvalInput } from "./retrieval-evals.js";

/**
 * Lazy provider for retrieval-quality eval input.
 *
 * The provider is called inside `run()` so input can change between successive
 * harness runs without re-registering the suite.
 */
export type RetrievalQualityInputProvider = () => RetrievalQualityEvalInput;

/**
 * `EvalSuiteContract` adapter for the existing retrieval-quality eval set.
 *
 * Wraps `runRetrievalQualityEvals()`. The suite name is `"retrieval-quality"`.
 *
 * @example
 * const suite = new RetrievalQualitySuite(() => ({
 *   retrievedResults: lastResults,
 *   expectedChunkIds: ["chunk-1", "chunk-2"]
 * }));
 * harness.registerSuite(suite);
 */
export class RetrievalQualitySuite implements EvalSuiteContract {
  readonly name = "retrieval-quality";

  /**
   * @param inputProvider - Lazy callback returning current input.
   *   Called once per `run()` invocation.
   */
  constructor(private readonly inputProvider: RetrievalQualityInputProvider) {}

  async run(): Promise<FrameworkResult<QualityReport>> {
    const input = this.inputProvider();
    return ok(runRetrievalQualityEvals(input));
  }
}
