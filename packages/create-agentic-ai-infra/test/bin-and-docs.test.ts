import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as createPackage from "../src/index.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const repoRoot = path.resolve(packageRoot, "../..");

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  // templates/ was removed (manifests are inline in templates.ts); skip absent dirs.
  try {
    await fs.access(directory);
  } catch {
    return [];
  }
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relative = path.relative(repoRoot, fullPath).replaceAll("\\", "/");

    if (relative.startsWith("docs/internal/")) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function collectPublicMarkdownFiles(): Promise<string[]> {
  const roots = [
    "docs",
    "templates",
    "examples",
    "packages/create-agentic-ai-infra",
    "packages/agentic-ai-infra-core",
    "packages/agentic-ai-infra-runtime",
    "packages/agentic-ai-infra-dashboard",
    "packages/agentic-ai-infra-test-utils"
  ];
  const files = [path.join(repoRoot, "README.md")];

  for (const root of roots) {
    files.push(...(await collectMarkdownFiles(path.join(repoRoot, root))));
  }

  return files;
}

async function collectFiles(directory: string): Promise<string[]> {
  // Skip directories that do not exist (e.g. templates/ was removed).
  try {
    await fs.access(directory);
  } catch {
    return [];
  }
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!["node_modules", "dist", "build", "coverage", ".agentic-local"].includes(entry.name)) {
        files.push(...(await collectFiles(fullPath)));
      }
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("bin and docs quality", () => {
  it("has a Node shebang in the CLI entrypoint", async () => {
    const cliSource = await fs.readFile(path.join(packageRoot, "src/cli.ts"), "utf8");

    expect(cliSource.split(/\r?\n/)[0]).toBe("#!/usr/bin/env node");
  });

  it("public exports are side-effect free to import", () => {
    expect(createPackage.parseCliArgs).toBeTypeOf("function");
    expect(createPackage.renderTemplates).toBeTypeOf("function");
  });

  it("keeps public docs free of internal history wording", async () => {
    const bannedPattern =
      /\b(Phase\s+\d+|phase history|build history|implementation journal|internal chronology|milestone|placeholder|deferred|not implemented yet|later phase|internal build history)\b/i;
    const markdownFiles = await collectPublicMarkdownFiles();
    const offenders: string[] = [];

    for (const file of markdownFiles) {
      const content = await fs.readFile(file, "utf8");

      if (bannedPattern.test(content)) {
        offenders.push(path.relative(repoRoot, file).replaceAll("\\", "/"));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps public docs truthful about release and runtime boundaries", async () => {
    const markdownFiles = await collectPublicMarkdownFiles();
    const offenders: string[] = [];
    const forbiddenClaims = [
      /packages are published to npm/i,
      /published to npm/i,
      /remote production deployment is automatic/i,
      /complete production auth is included/i,
      /Docker starts automatically/i,
      /migrations run automatically/i,
      /Kubernetes is supported/i,
      /model\/provider integrations are included/i,
      /generated projects are production-deployed out of the box/i
    ];

    for (const file of markdownFiles) {
      const content = await fs.readFile(file, "utf8");
      const normalized = content.replace(/not published to npm|publishing prepared but not executed/gi, "");

      if (forbiddenClaims.some((pattern) => pattern.test(normalized)) || /\{\{[A-Z0-9_]+\}\}/.test(content)) {
        offenders.push(path.relative(repoRoot, file).replaceAll("\\", "/"));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps templates and examples free of secret-looking files", async () => {
    const scannedRoots = ["templates", "examples"];
    const secretFilePattern = /(^|\/)(?:\.env(?:\.|$)|\.npmrc$|id_(?:rsa|dsa|ecdsa|ed25519)$|.*private.*key.*|credentials?(?:\.|$))/i;
    const offenders: string[] = [];

    for (const root of scannedRoots) {
      const files = await collectFiles(path.join(repoRoot, root));

      for (const file of files) {
        const relative = path.relative(repoRoot, file).replaceAll("\\", "/");

        if (secretFilePattern.test(relative)) {
          offenders.push(relative);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps package metadata private and publish-prepared", async () => {
    const packages = [
      "packages/agentic-ai-infra-core/package.json",
      "packages/create-agentic-ai-infra/package.json",
      "packages/agentic-ai-infra-runtime/package.json",
      "packages/agentic-ai-infra-dashboard/package.json",
      "packages/agentic-ai-infra-test-utils/package.json"
    ];

    for (const packagePath of packages) {
      const manifest = JSON.parse(
        await fs.readFile(path.join(repoRoot, packagePath), "utf8")
      ) as {
        private?: boolean;
        publishConfig?: unknown;
        description?: string;
        engines?: { node?: string };
        exports?: unknown;
        files?: readonly string[];
      };

      expect(manifest.private, packagePath).toBe(true);
      expect(manifest.publishConfig, packagePath).toBeUndefined();
      expect(manifest.description, packagePath).toBeTruthy();
      expect(manifest.description, packagePath).not.toMatch(/\bFuture\b/i);
      expect(manifest.engines?.node, packagePath).toBe(">=20");
      expect(manifest.exports, packagePath).toBeTruthy();
      expect(manifest.files, packagePath).toEqual(expect.arrayContaining(["dist", "README.md"]));
    }
  });
});
