import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectGeneratedProjectFiles,
  missingRequiredGeneratedPaths,
  scanGeneratedProject
} from "@maharudra/agentic-ai-infra-test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWritePlan,
  normalizeInitOptions,
  renderTemplates,
  runDoctorCommand,
  runInitCommand,
  runValidateCommand
} from "../src/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const tscPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

type SmokeWorkspace = {
  readonly tempRoot: string;
  readonly projectRoot: string;
};

async function withSmokeWorkspace(
  name: string,
  run: (workspace: SmokeWorkspace) => Promise<void>
): Promise<void> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `agentic-${name}-`));
  const workspace = {
    tempRoot,
    projectRoot: path.join(tempRoot, "project")
  };
  let passed = false;

  try {
    await run(workspace);
    passed = true;
  } finally {
    if (passed) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    } else {
      // Keep diagnostics bounded: the path is enough for local debugging, and
      // generated smoke fixtures must never contain secrets by design.
      process.stderr.write(`Generated smoke workspace retained for debugging: ${tempRoot}\n`);
    }
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function expectSafeGeneratedProject(projectRoot: string): Promise<readonly string[]> {
  const scan = await scanGeneratedProject(projectRoot);

  expect(scan.forbiddenFiles).toEqual([]);
  expect(scan.unresolvedPlaceholders).toEqual([]);
  expect(scan.forbiddenContent).toEqual([]);
  expect(missingRequiredGeneratedPaths(scan.files)).toEqual([]);

  for (const file of scan.files) {
    const content = await fs.readFile(path.join(projectRoot, file), "utf8");

    expect(content, file).not.toMatch(/\bRudraloka\b/i);
    expect(content, file).not.toMatch(/\.codex|\.claude|C:\\Users\\abhi1\\react\\rudraloka-workplace/i);
    expect(content, file).not.toMatch(/docker compose up|docker start|runMigrations\(|RUN_AGENTIC_AI_INFRA_MIGRATIONS/i);
  }

  return scan.files;
}

async function smokeCompileGeneratedSources(projectRoot: string): Promise<void> {
  // The smoke compile typechecks the just-generated user-project skeleton
  // against the in-repo framework package sources. Two TypeScript 6 quirks
  // shape the tsconfig below:
  //
  // 1. `baseUrl` is deprecated and emits TS5101 unless `paths` is rewritten to
  //    use entries that are explicitly relative to the tsconfig file. The
  //    smoke tsconfig lives inside the generated project, so each `paths`
  //    entry already begins with `./` and `baseUrl` is intentionally omitted.
  // 2. `types: ["node"]` would force tsc to find `@types/node` somewhere on
  //    the temp folder's module-resolution path, but the temp project has no
  //    `node_modules/`. `typeRoots` points tsc back at the workspace
  //    `node_modules/@types` directory, so node typings still resolve
  //    correctly without copying them into the temp workspace.
  const smokeTsconfig = path.join(projectRoot, "tsconfig.generated-smoke.json");
  const relativeFromProject = (target: string) =>
    `./${path.relative(projectRoot, target).replaceAll("\\", "/")}`;
  const sourcePath = (packageName: string) =>
    relativeFromProject(path.join(repoRoot, "packages", packageName, "src/index.ts"));
  const typeRoot = relativeFromProject(path.join(repoRoot, "node_modules", "@types"));
  // The SDK is a direct dependency of the runtime package. Resolve it through
  // the runtime package's own node_modules so the path remains stable across
  // pnpm virtual-store layouts that do not hoist transitive deps to the root.
  const sdkEsmRoot = relativeFromProject(
    path.join(
      repoRoot,
      "packages",
      "agentic-ai-infra-runtime",
      "node_modules",
      "@modelcontextprotocol",
      "sdk",
      "dist",
      "esm"
    )
  );
  const include = [
    "agentic-ai-infra.config.ts",
    "tools/agentic/mcp-server/src/**/*.ts",
    "services/agentic-context-service/src/**/*.ts"
  ];

  await fs.writeFile(
    smokeTsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
          typeRoots: [typeRoot],
          types: ["node"],
          paths: {
            "@maharudra/agentic-ai-infra-core": [sourcePath("agentic-ai-infra-core")],
            "@maharudra/agentic-ai-infra-runtime": [sourcePath("agentic-ai-infra-runtime")],
            "@maharudra/agentic-ai-infra-dashboard": [sourcePath("agentic-ai-infra-dashboard")],
            "@modelcontextprotocol/sdk": [`${sdkEsmRoot}/index.d.ts`],
            "@modelcontextprotocol/sdk/*": [`${sdkEsmRoot}/*`]
          }
        },
        include
      },
      null,
      2
    ),
    "utf8"
  );

  const result = spawnSync(process.execPath, [tscPath, "-p", smokeTsconfig], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false
  });

  expect(result.status, `${result.stdout}\n${result.stderr}`.slice(0, 4000)).toBe(0);
}

describe("generated project smoke tests", () => {
  it("dry-run leaves a blank workspace unchanged", async () => {
    await withSmokeWorkspace("dry-run", async ({ tempRoot }) => {
      const result = await runInitCommand(
        {
          projectName: "Dry Run Workspace",
          slug: "dry-run-workspace",
          target: "project",
          dryRun: true
        },
        tempRoot
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Mode: dry-run");
      await expect(fs.readdir(tempRoot)).resolves.toEqual([]);
    });
  });

  it("generates and validates a blank workspace", async () => {
    await withSmokeWorkspace("blank", async ({ tempRoot, projectRoot }) => {
      const init = await runInitCommand(
        {
          projectName: "Blank Workspace",
          slug: "blank-workspace",
          target: "project"
        },
        tempRoot
      );

      expect(init.exitCode).toBe(0);
      const files = await expectSafeGeneratedProject(projectRoot);
      const localPackage = await readJson<{ name: string }>(
        path.join(projectRoot, "tools/agentic/mcp-server/package.json")
      );

      expect(files).toContain(".gitignore");
      expect(localPackage.name).toBe("blank-workspace-agentic-mcp-server");
      expect(localPackage.name).not.toMatch(/maharudra/i);

      const validate = await runValidateCommand(
        { projectName: "Blank Workspace", slug: "blank-workspace", target: "project" },
        tempRoot
      );
      const doctor = await runDoctorCommand(
        { projectName: "Blank Workspace", slug: "blank-workspace", target: "project" },
        tempRoot
      );

      expect(validate.exitCode).toBe(0);
      expect(doctor.stdout).toContain("Generated config");
      await smokeCompileGeneratedSources(projectRoot);
    });
  });

  it("preserves existing project files and appends .gitignore once", async () => {
    await withSmokeWorkspace("existing", async ({ tempRoot, projectRoot }) => {
      const userGitignore = "node_modules/\n# custom ignore rule\n";

      await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
      await fs.writeFile(path.join(projectRoot, "package.json"), "{\"name\":\"existing-app\"}\n", "utf8");
      await fs.writeFile(path.join(projectRoot, "src/app.ts"), "export const app = true;\n", "utf8");
      await fs.writeFile(path.join(projectRoot, ".gitignore"), userGitignore, "utf8");

      const first = await runInitCommand(
        {
          projectName: "Existing Full Stack App",
          slug: "existing-full-stack-app",
          profile: "local-context",
          retrieval: ["full-text", "document-tree", "symbol-code"],
          target: "project"
        },
        tempRoot
      );

      expect(first.exitCode).toBe(0);
      expect(first.stdout).toContain("append    .gitignore");

      const second = await runInitCommand(
        {
          projectName: "Existing Full Stack App",
          slug: "existing-full-stack-app",
          profile: "local-context",
          retrieval: ["full-text", "document-tree", "symbol-code"],
          target: "project"
        },
        tempRoot
      );
      const gitignore = await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8");

      expect(second.exitCode).toBe(0);
      expect(gitignore.startsWith(userGitignore)).toBe(true);
      expect(gitignore.match(/BEGIN agentic-ai-infra managed local state/g)).toHaveLength(1);
      await expectSafeGeneratedProject(projectRoot);
    });
  });

  it("generates full agentic context with dashboard and Docker files only when selected", async () => {
    await withSmokeWorkspace("full-context", async ({ tempRoot, projectRoot }) => {
      const result = await runInitCommand(
        {
          projectName: "Full Agentic Context",
          slug: "full-agentic-context",
          profile: "full-agentic-context",
          agentMode: "token-efficient-multi-agent",
          retrieval: ["hybrid-all"],
          dashboard: true,
          withDocker: true,
          target: "project"
        },
        tempRoot
      );

      expect(result.exitCode).toBe(0);
      const files = await expectSafeGeneratedProject(projectRoot);
      const config = await fs.readFile(path.join(projectRoot, "agentic-ai-infra.config.ts"), "utf8");
      const localPackage = await fs.readFile(
        path.join(projectRoot, "tools/agentic/mcp-server/package.json"),
        "utf8"
      );

      expect(files).toContain("tools/agentic/mcp-server/src/dashboard.ts");
      expect(files).toContain("infra/local-dev/ai-context-db/docker-compose.yml");
      expect(config).toContain("\"mode\": \"token-efficient-multi-agent\"");
      expect(config).toContain("\"pgvector\"");
      expect(localPackage).toContain("\"dashboard\": \"node dist/dashboard.js\"");
      expect(localPackage).toContain("@maharudra/agentic-ai-infra-dashboard");
      await smokeCompileGeneratedSources(projectRoot);
    });
  });

  it("generates remote-safe MCP/API skeleton without dashboard or Docker by default", async () => {
    await withSmokeWorkspace("remote-safe", async ({ tempRoot, projectRoot }) => {
      const result = await runInitCommand(
        {
          projectName: "Remote Safe Workspace",
          slug: "remote-safe-workspace",
          profile: "remote-safe",
          runtime: ["remote-http-mcp", "api-service"],
          target: "project"
        },
        tempRoot
      );

      expect(result.exitCode).toBe(0);
      const files = await expectSafeGeneratedProject(projectRoot);
      const remotePackage = await readJson<{ name: string }>(
        path.join(projectRoot, "services/agentic-context-service/package.json")
      );

      expect(files).toContain("services/agentic-context-service/src/server.ts");
      expect(files).toContain("services/agentic-context-service/src/start.ts");
      expect(files).not.toContain("tools/agentic/mcp-server/src/dashboard.ts");
      expect(files).not.toContain("infra/local-dev/ai-context-db/docker-compose.yml");
      expect(remotePackage.name).toBe("remote-safe-workspace-agentic-context-service");
      expect(remotePackage.name).not.toMatch(/maharudra/i);
      await smokeCompileGeneratedSources(projectRoot);
    });
  });
});

// ---------------------------------------------------------------------------
// Stage 16 — WritePlan dry-run assertions
//
// These tests use createWritePlan directly so they never write to disk.
// They extend the Stage 11 regression guards (profile-config-smoke,
// vectorless-local-generation) with deeper file-path and content assertions
// on the planner output for two representative profiles.
//
// Planner API:
//   createWritePlan({ files: renderTemplates(opts), options: opts, cwd })
//   → Promise<CliResult<WritePlan>>
//   WritePlan.items[i]: { relativePath, content, action, targetPath, reason }
//   action is "create" for all items when cwd points to an empty temp dir.
// ---------------------------------------------------------------------------

let planTempRoot: string;

beforeEach(async () => {
  planTempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-plan-smoke-"));
});

afterEach(async () => {
  await fs.rm(planTempRoot, { recursive: true, force: true });
});

describe("WritePlan dry-run assertions (Stage 16)", () => {
  describe('profile "vectorless-local"', () => {
    // (a) normalizeInitOptions returns ok: true for vectorless-local.
    it("(a) normalizeInitOptions with profile vectorless-local returns ok: true", () => {
      const result = normalizeInitOptions({
        projectName: "Smoke Project",
        slug: "smoke-project",
        profile: "vectorless-local"
      });
      expect(result.ok).toBe(true);
    });

    // (b + c) Dry-run produces a WritePlan containing all required file paths.
    // The plan has dryRun: true — executeWritePlan would skip all writes.
    it("(b+c) dry-run produces a WritePlan with agentic-ai-infra.config.ts, package.json, AGENTS.md", async () => {
      const normalized = normalizeInitOptions({
        projectName: "Smoke Project",
        slug: "smoke-project",
        profile: "vectorless-local",
        dryRun: true
      });
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      const files = renderTemplates(normalized.value);
      const planResult = await createWritePlan({ files, options: normalized.value, cwd: planTempRoot });

      expect(planResult.ok).toBe(true);
      if (!planResult.ok) return;

      // dryRun flag propagated into the plan — executeWritePlan would no-op.
      expect(planResult.value.dryRun).toBe(true);

      const paths = planResult.value.items.map((i) => i.relativePath);
      expect(paths).toContain("agentic-ai-infra.config.ts");
      expect(paths).toContain("tools/agentic/mcp-server/package.json");
      expect(paths).toContain("AGENTS.md");
    });

    // (d) Generated config file content contains the expected storage type and profile name.
    it('(d) generated config contains storage type "memory" and profile name "vectorless-local"', async () => {
      const normalized = normalizeInitOptions({
        projectName: "Smoke Project",
        slug: "smoke-project",
        profile: "vectorless-local",
        dryRun: true
      });
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      const files = renderTemplates(normalized.value);
      const planResult = await createWritePlan({ files, options: normalized.value, cwd: planTempRoot });
      expect(planResult.ok).toBe(true);
      if (!planResult.ok) return;

      const configItem = planResult.value.items.find(
        (i) => i.relativePath === "agentic-ai-infra.config.ts"
      );
      expect(configItem).toBeDefined();
      // Confirm in-memory storage (not filesystem, not postgres).
      expect(configItem!.content).toContain('"type": "memory"');
      // Confirm the profile name appears in the serialized config.
      expect(configItem!.content).toContain('"vectorless-local"');
    });

    // (e) No WritePlan item content contains the literal string "filesystem".
    it('(e) no WritePlan item content contains "filesystem"', async () => {
      const normalized = normalizeInitOptions({
        projectName: "Smoke Project",
        slug: "smoke-project",
        profile: "vectorless-local",
        dryRun: true
      });
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      const files = renderTemplates(normalized.value);
      const planResult = await createWritePlan({ files, options: normalized.value, cwd: planTempRoot });
      expect(planResult.ok).toBe(true);
      if (!planResult.ok) return;

      for (const item of planResult.value.items) {
        expect(
          item.content,
          `WritePlan item "${item.relativePath}" must not contain "filesystem" (storage type regression)`
        ).not.toContain('"filesystem"');
      }
    });

    // (f) No WritePlan item references docker-compose when withDocker is false (the default).
    it("(f) no WritePlan item references docker-compose when withDocker is false", async () => {
      const normalized = normalizeInitOptions({
        projectName: "Smoke Project",
        slug: "smoke-project",
        profile: "vectorless-local",
        dryRun: true
        // withDocker defaults to false — intentionally not set
      });
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      expect(normalized.value.withDocker).toBe(false);

      const files = renderTemplates(normalized.value);
      const planResult = await createWritePlan({ files, options: normalized.value, cwd: planTempRoot });
      expect(planResult.ok).toBe(true);
      if (!planResult.ok) return;

      const paths = planResult.value.items.map((i) => i.relativePath);
      expect(paths).not.toContain("infra/local-dev/ai-context-db/docker-compose.yml");

      for (const item of planResult.value.items) {
        expect(
          item.content,
          `WritePlan item "${item.relativePath}" must not reference docker-compose when withDocker is false`
        ).not.toContain("docker-compose");
      }
    });
  });

  describe('profile "local-context" (assertion g: repeat b–f)', () => {
    // (g-b+c) Dry-run produces a WritePlan with required paths including AGENTS.md.
    it("(g-b+c) dry-run for local-context produces a WritePlan with required file paths and AGENTS.md", async () => {
      const normalized = normalizeInitOptions({
        projectName: "Smoke Project",
        slug: "smoke-project",
        profile: "local-context",
        retrieval: ["full-text"],
        dryRun: true
      });
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      const files = renderTemplates(normalized.value);
      const planResult = await createWritePlan({ files, options: normalized.value, cwd: planTempRoot });

      expect(planResult.ok).toBe(true);
      if (!planResult.ok) return;

      expect(planResult.value.dryRun).toBe(true);

      const paths = planResult.value.items.map((i) => i.relativePath);
      expect(paths).toContain("agentic-ai-infra.config.ts");
      expect(paths).toContain("tools/agentic/mcp-server/package.json");
      // AGENTS.md must be in every generated project plan regardless of profile.
      expect(paths).toContain("AGENTS.md");
    });

    // (g-d) Generated config for local-context contains postgres storage and connectionRef.
    it('(g-d) local-context config contains storage type "postgres" and connectionRef field', async () => {
      const normalized = normalizeInitOptions({
        projectName: "Smoke Project",
        slug: "smoke-project",
        profile: "local-context",
        retrieval: ["full-text"],
        dryRun: true
      });
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      const files = renderTemplates(normalized.value);
      const planResult = await createWritePlan({ files, options: normalized.value, cwd: planTempRoot });
      expect(planResult.ok).toBe(true);
      if (!planResult.ok) return;

      const configItem = planResult.value.items.find(
        (i) => i.relativePath === "agentic-ai-infra.config.ts"
      );
      expect(configItem).toBeDefined();
      expect(configItem!.content).toContain('"type": "postgres"');
      expect(configItem!.content).toContain('"connectionRef"');
    });

    // (g-e) No WritePlan item content for local-context contains "filesystem".
    it('(g-e) no local-context WritePlan item content contains "filesystem"', async () => {
      const normalized = normalizeInitOptions({
        projectName: "Smoke Project",
        slug: "smoke-project",
        profile: "local-context",
        retrieval: ["full-text"],
        dryRun: true
      });
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      const files = renderTemplates(normalized.value);
      const planResult = await createWritePlan({ files, options: normalized.value, cwd: planTempRoot });
      expect(planResult.ok).toBe(true);
      if (!planResult.ok) return;

      for (const item of planResult.value.items) {
        expect(
          item.content,
          `WritePlan item "${item.relativePath}" must not contain "filesystem" (storage type regression)`
        ).not.toContain('"filesystem"');
      }
    });

    // (g-f) No local-context WritePlan item references docker-compose when withDocker is false.
    it("(g-f) no local-context WritePlan item references docker-compose when withDocker is false", async () => {
      const normalized = normalizeInitOptions({
        projectName: "Smoke Project",
        slug: "smoke-project",
        profile: "local-context",
        retrieval: ["full-text"],
        dryRun: true
        // withDocker defaults to false
      });
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) return;

      expect(normalized.value.withDocker).toBe(false);

      const files = renderTemplates(normalized.value);
      const planResult = await createWritePlan({ files, options: normalized.value, cwd: planTempRoot });
      expect(planResult.ok).toBe(true);
      if (!planResult.ok) return;

      const paths = planResult.value.items.map((i) => i.relativePath);
      expect(paths).not.toContain("infra/local-dev/ai-context-db/docker-compose.yml");

      for (const item of planResult.value.items) {
        expect(
          item.content,
          `WritePlan item "${item.relativePath}" must not reference docker-compose when withDocker is false`
        ).not.toContain("docker-compose");
      }
    });
  });
});
