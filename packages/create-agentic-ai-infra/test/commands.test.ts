import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, runDoctorCommand, runInitCommand } from "../src/index.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-cli-command-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("CLI commands", () => {
  it("runs help without writes", async () => {
    const result = await runCli(["--help"], tempRoot);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    await expect(fs.readdir(tempRoot)).resolves.toEqual([]);
  });

  it("runs init dry-run without writes", async () => {
    const result = await runInitCommand(
      {
        projectName: "Demo",
        slug: "demo",
        target: "project",
        dryRun: true
      },
      tempRoot
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Mode: dry-run");
    await expect(fs.readdir(tempRoot)).resolves.toEqual([]);
  });

  it("runs doctor without mutation and treats Docker as optional by default", async () => {
    const before = await fs.readdir(tempRoot);
    const result = await runDoctorCommand(
      {
        projectName: "Demo",
        slug: "demo",
        target: "."
      },
      tempRoot
    );
    const after = await fs.readdir(tempRoot);

    expect(after).toEqual(before);
    expect(result.stdout).toContain("Docker:");
    expect(result.stdout).not.toContain("ERROR   Docker: Docker CLI was not found.");
  });
});
