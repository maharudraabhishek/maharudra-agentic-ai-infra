import { readFile } from "node:fs/promises";
import { resolve, isAbsolute, sep } from "node:path";
import {
  fail,
  ok,
  validateEvalDataset,
  type EvalDataset,
  type FrameworkResult
} from "@maharudra/agentic-ai-infra-core";

/**
 * Filesystem loader for eval datasets.
 *
 * Reads JSON files from a configured base directory and validates them against
 * the `EvalDataset` schema. Refuses paths that escape the base directory via
 * `..` traversal, absolute paths, or platform-specific separators in the
 * filename.
 *
 * @example
 * const loader = new DatasetLoader("examples/eval-data");
 * const result = await loader.load("retrieval-quality.json");
 * if (result.ok) {
 *   const dataset: EvalDataset = result.value;
 * }
 */
export class DatasetLoader {
  private readonly baseDir: string;

  /**
   * @param baseDir - Absolute or `process.cwd()`-relative directory. All loads
   *   are resolved within this directory.
   */
  constructor(baseDir: string) {
    this.baseDir = isAbsolute(baseDir) ? baseDir : resolve(process.cwd(), baseDir);
  }

  /**
   * Loads and validates one dataset file by relative filename.
   *
   * Rejects filenames containing path separators, traversal segments, or
   * absolute path prefixes. The defense-in-depth check on the resolved path
   * confirms the result stays inside `baseDir`.
   */
  async load(filename: string): Promise<FrameworkResult<EvalDataset>> {
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes(sep) ||
      isAbsolute(filename)
    ) {
      return fail({
        code: "evals.dataset-path-traversal",
        message: `Dataset filename "${filename}" contains illegal path segments.`,
        severity: "recoverable"
      });
    }

    const filePath = resolve(this.baseDir, filename);

    if (!filePath.startsWith(this.baseDir + sep) && filePath !== this.baseDir) {
      return fail({
        code: "evals.dataset-path-traversal",
        message: "Resolved path escapes base directory.",
        severity: "recoverable"
      });
    }

    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch {
      return fail({
        code: "evals.dataset-not-found",
        message: `Dataset file "${filename}" could not be read.`,
        severity: "recoverable"
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail({
        code: "evals.invalid-dataset",
        message: `Dataset file "${filename}" is not valid JSON.`,
        severity: "recoverable"
      });
    }

    return validateEvalDataset(parsed);
  }
}
