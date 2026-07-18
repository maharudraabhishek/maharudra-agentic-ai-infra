import type { EvalDataset, EvalDatasetItem } from "./types.js";
import { fail, ok, type FrameworkResult } from "../errors/index.js";

/**
 * Validates an unknown value against the `EvalDataset` schema (version 1).
 *
 * Returns `FrameworkResult<EvalDataset>` — no throws. Validation errors carry
 * recoverable severity so callers can decide whether to abort or skip the file.
 *
 * @example
 * const raw = JSON.parse(jsonText);
 * const result = validateEvalDataset(raw);
 * if (result.ok) {
 *   const dataset: EvalDataset = result.value;
 * }
 */
export function validateEvalDataset(value: unknown): FrameworkResult<EvalDataset> {
  if (!isRecord(value)) {
    return fail({
      code: "evals.invalid-dataset",
      message: "Eval dataset must be a JSON object.",
      severity: "recoverable"
    });
  }

  if (value.version !== 1) {
    return fail({
      code: "evals.invalid-dataset-version",
      message: `Unsupported eval dataset version: ${String(value.version)}. Expected 1.`,
      severity: "recoverable"
    });
  }

  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    return fail({
      code: "evals.invalid-dataset",
      message: "Eval dataset must have a non-empty 'name' field.",
      severity: "recoverable"
    });
  }

  if (!Array.isArray(value.items)) {
    return fail({
      code: "evals.invalid-dataset",
      message: "Eval dataset 'items' must be an array.",
      severity: "recoverable"
    });
  }

  const items: EvalDatasetItem[] = [];

  for (let i = 0; i < value.items.length; i += 1) {
    const itemResult = validateItem(value.items[i], i);
    if (!itemResult.ok) {
      return itemResult;
    }
    items.push(itemResult.value);
  }

  return ok({
    version: 1,
    name: value.name,
    description: typeof value.description === "string" ? value.description : undefined,
    items
  });
}

function validateItem(raw: unknown, index: number): FrameworkResult<EvalDatasetItem> {
  if (!isRecord(raw)) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item at index ${index} is not an object.`,
      severity: "recoverable"
    });
  }

  if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item at index ${index} is missing a non-empty 'id' field.`,
      severity: "recoverable"
    });
  }

  if (typeof raw.question !== "string") {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' is missing a string 'question' field.`,
      severity: "recoverable"
    });
  }

  if (!isStringArray(raw.expectedChunks)) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' must have 'expectedChunks' as an array of strings.`,
      severity: "recoverable"
    });
  }

  if (typeof raw.expectedAnswer !== "string") {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' must have a string 'expectedAnswer' field.`,
      severity: "recoverable"
    });
  }

  if (!isStringArray(raw.expectedToolCalls)) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' must have 'expectedToolCalls' as an array of strings.`,
      severity: "recoverable"
    });
  }

  if (raw.tags !== undefined && !isStringArray(raw.tags)) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' has invalid 'tags' — must be array of strings.`,
      severity: "recoverable"
    });
  }

  const difficulty = raw.difficulty;
  if (
    difficulty !== undefined &&
    difficulty !== "easy" &&
    difficulty !== "medium" &&
    difficulty !== "hard"
  ) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' has invalid 'difficulty'.`,
      severity: "recoverable"
    });
  }

  const matchMode = raw.matchMode;
  if (
    matchMode !== undefined &&
    matchMode !== "substring" &&
    matchMode !== "exact" &&
    matchMode !== "semantic"
  ) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' has invalid 'matchMode'.`,
      severity: "recoverable"
    });
  }

  if (
    raw.tokenBudget !== undefined &&
    (typeof raw.tokenBudget !== "number" || raw.tokenBudget <= 0)
  ) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' has invalid 'tokenBudget' — must be positive number.`,
      severity: "recoverable"
    });
  }

  return ok({
    id: raw.id,
    question: raw.question,
    expectedChunks: raw.expectedChunks,
    expectedAnswer: raw.expectedAnswer,
    expectedToolCalls: raw.expectedToolCalls,
    tags: raw.tags,
    difficulty: difficulty as EvalDatasetItem["difficulty"],
    matchMode: matchMode as EvalDatasetItem["matchMode"],
    tokenBudget: raw.tokenBudget as number | undefined,
    metadata: isRecord(raw.metadata)
      ? {
          source: typeof raw.metadata.source === "string" ? raw.metadata.source : undefined,
          createdAt: typeof raw.metadata.createdAt === "string" ? raw.metadata.createdAt : undefined
        }
      : undefined
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
