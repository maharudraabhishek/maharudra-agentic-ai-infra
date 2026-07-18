import fs from "node:fs/promises";
import path from "node:path";
import type { WritePlan, WriteSummary } from "./types.js";

/**
 * Counts each write-plan action for command output and tests.
 *
 * The summary is derived from the plan rather than from filesystem side
 * effects, which keeps dry-run reporting identical to non-dry-run reporting.
 */
export function summarizeWritePlan(plan: WritePlan): WriteSummary {
  return {
    created: plan.items.filter((item) => item.action === "create").length,
    appended: plan.items.filter((item) => item.action === "append").length,
    overwritten: plan.items.filter((item) => item.action === "overwrite").length,
    unchanged: plan.items.filter((item) => item.action === "unchanged").length,
    conflicts: plan.items.filter((item) => item.action === "conflict").length,
    blocked: plan.items.filter((item) => item.action === "blocked").length
  };
}

/**
 * Executes the approved create and overwrite actions in a write plan.
 *
 * Dry-run plans return a summary without creating directories or files. Blocked,
 * conflict, and unchanged items are intentionally skipped so the writer cannot
 * bypass planner safety decisions.
 */
export async function executeWritePlan(plan: WritePlan): Promise<WriteSummary> {
  if (plan.dryRun) {
    return summarizeWritePlan(plan);
  }

  for (const item of plan.items) {
    // The planner is the only place that decides write eligibility; the writer
    // simply executes eligible actions and ignores everything else.
    if (item.action !== "create" && item.action !== "overwrite" && item.action !== "append") {
      continue;
    }

    // Parent directories are created lazily so dry-run mode does not touch the
    // filesystem and non-dry-run mode only creates directories it needs.
    await fs.mkdir(path.dirname(item.targetPath), { recursive: true });

    if (item.action === "append") {
      const existing = await fs.readFile(item.targetPath, "utf8");
      const separator = existing.endsWith("\n") ? "\n" : "\n\n";

      // Append mode is intentionally narrow and is used for `.gitignore`
      // managed blocks so user-authored ignore rules remain unchanged.
      await fs.writeFile(item.targetPath, `${existing}${separator}${item.content}`, "utf8");
      continue;
    }

    await fs.writeFile(item.targetPath, item.content, "utf8");
  }

  return summarizeWritePlan(plan);
}

/**
 * Formats a write plan into stable CLI output.
 *
 * Stable formatting makes repeated init, dry-run, and validation behavior easy
 * to inspect by a human and straightforward to assert in tests.
 */
export function formatWritePlan(plan: WritePlan): string {
  const lines = [
    `Target: ${plan.targetRoot}`,
    `Mode: ${plan.dryRun ? "dry-run" : "write"}`,
    ""
  ];

  for (const item of plan.items) {
    // Each line includes the action and reason so safety decisions are visible
    // without requiring debug logs or a separate report file.
    lines.push(`${item.action.padEnd(9)} ${item.relativePath} - ${item.reason}`);
  }

  const summary = summarizeWritePlan(plan);

  lines.push(
    "",
    `Summary: ${summary.created} create, ${summary.appended} append, ${summary.overwritten} overwrite, ${summary.unchanged} unchanged, ${summary.conflicts} conflict, ${summary.blocked} blocked`
  );

  return lines.join("\n");
}
