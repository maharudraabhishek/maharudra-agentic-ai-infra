import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWritePlan,
  executeWritePlan,
  normalizeInitOptions,
  renderTemplates
} from "../src/index.js";

let tempRoot: string;

async function makeOptions(overrides = {}) {
  const result = normalizeInitOptions({
    projectName: "Demo Project",
    slug: "demo-project",
    target: "project",
    ...overrides
  });

  if (!result.ok) {
    throw new Error("Expected valid options.");
  }

  return result.value;
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-cli-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("write planning and execution", () => {
  it("dry-run writes nothing", async () => {
    const options = await makeOptions({ dryRun: true });
    const plan = await createWritePlan({
      files: renderTemplates(options),
      options,
      cwd: tempRoot
    });

    expect(plan.ok).toBe(true);

    if (plan.ok) {
      await executeWritePlan(plan.value);
    }

    await expect(
      fs.access(path.join(tempRoot, "project", "agentic-ai-infra.config.ts"))
    ).rejects.toThrow();
  });

  it("refuses overwrite by default", async () => {
    const target = path.join(tempRoot, "project");
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "AGENTS.md"), "custom", "utf8");

    const options = await makeOptions();
    const plan = await createWritePlan({
      files: renderTemplates(options),
      options,
      cwd: tempRoot
    });

    expect(plan.ok).toBe(true);

    if (plan.ok) {
      expect(plan.value.items.find((item) => item.relativePath === "AGENTS.md")?.action).toBe("conflict");
      await executeWritePlan(plan.value);
    }

    await expect(fs.readFile(path.join(target, "AGENTS.md"), "utf8")).resolves.toBe("custom");
  });

  it("plans unchanged files for idempotent reruns", async () => {
    const options = await makeOptions();
    const firstPlan = await createWritePlan({
      files: renderTemplates(options),
      options,
      cwd: tempRoot
    });

    if (!firstPlan.ok) {
      throw new Error("Expected valid first plan.");
    }

    await executeWritePlan(firstPlan.value);

    const secondPlan = await createWritePlan({
      files: renderTemplates(options),
      options,
      cwd: tempRoot
    });

    expect(secondPlan.ok).toBe(true);

    if (secondPlan.ok) {
      expect(secondPlan.value.items.every((item) => item.action === "unchanged")).toBe(true);
    }
  });

  it("appends the managed .gitignore block without duplicating user content", async () => {
    const target = path.join(tempRoot, "project");
    const userContent = "node_modules/\n# user rule\n";

    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, ".gitignore"), userContent, "utf8");

    const options = await makeOptions();
    const firstPlan = await createWritePlan({
      files: renderTemplates(options),
      options,
      cwd: tempRoot
    });

    expect(firstPlan.ok).toBe(true);

    if (!firstPlan.ok) {
      throw new Error("Expected valid first plan.");
    }

    expect(firstPlan.value.items.find((item) => item.relativePath === ".gitignore")?.action).toBe("append");
    await executeWritePlan(firstPlan.value);

    const secondPlan = await createWritePlan({
      files: renderTemplates(options),
      options,
      cwd: tempRoot
    });
    const content = await fs.readFile(path.join(target, ".gitignore"), "utf8");

    expect(content.startsWith(userContent)).toBe(true);
    expect(content.match(/BEGIN agentic-ai-infra managed local state/g)).toHaveLength(1);
    expect(secondPlan.ok).toBe(true);

    if (secondPlan.ok) {
      expect(secondPlan.value.items.find((item) => item.relativePath === ".gitignore")?.action).toBe("unchanged");
    }
  });

  it("blocks sensitive paths even with force", async () => {
    const options = await makeOptions({ force: true });
    const plan = await createWritePlan({
      files: [{ relativePath: ".env", content: "SECRET=value" }],
      options,
      cwd: tempRoot
    });

    expect(plan.ok).toBe(true);

    if (plan.ok) {
      expect(plan.value.items[0]?.action).toBe("blocked");
    }
  });

  it("rejects target traversal", async () => {
    const result = normalizeInitOptions({
      projectName: "Demo",
      slug: "demo",
      target: "../outside"
    }, tempRoot);

    expect(result.ok).toBe(false);
  });
});
