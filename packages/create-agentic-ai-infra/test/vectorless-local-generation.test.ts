/**
 * Regression guard for the vectorless-local CLI generation path.
 *
 * These assertions ensure the CLI never emits "filesystem" storage type,
 * always emits "memory" storage for the vectorless-local profile, and never
 * generates Docker Compose files when withDocker is false (the default).
 */
import { describe, expect, it } from "vitest";
import { createProjectConfig } from "../src/config-factory.js";
import { renderTemplates } from "../src/templates.js";
import { normalizeInitOptions } from "../src/validation.js";

describe("vectorless-local CLI generation", () => {
  it("generates a config with no filesystem storage providers", () => {
    const normalized = normalizeInitOptions({
      projectName: "Vectorless Test",
      slug: "vectorless-test",
      profile: "vectorless-local"
    });

    expect(normalized.ok).toBe(true);

    if (!normalized.ok) {
      return;
    }

    const config = createProjectConfig(normalized.value);
    const storage = config.storage as { providers: Array<{ type: string }> };
    const providers = storage.providers ?? [];

    for (const provider of providers) {
      expect(
        provider.type,
        `Storage provider type must not be "filesystem" in vectorless-local config`
      ).not.toBe("filesystem");
    }
  });

  it("generates at least one memory storage provider for vectorless-local", () => {
    const normalized = normalizeInitOptions({
      projectName: "Vectorless Test",
      slug: "vectorless-test",
      profile: "vectorless-local"
    });

    expect(normalized.ok).toBe(true);

    if (!normalized.ok) {
      return;
    }

    const config = createProjectConfig(normalized.value);
    const storage = config.storage as { providers: Array<{ type: string }> };
    const providers = storage.providers ?? [];

    expect(
      providers.some((p) => p.type === "memory"),
      "vectorless-local config must include at least one memory storage provider"
    ).toBe(true);
  });

  it("generates no file content containing the string 'filesystem'", () => {
    const normalized = normalizeInitOptions({
      projectName: "Vectorless Test",
      slug: "vectorless-test",
      profile: "vectorless-local"
    });

    expect(normalized.ok).toBe(true);

    if (!normalized.ok) {
      return;
    }

    const files = renderTemplates(normalized.value);

    for (const file of files) {
      expect(
        file.content,
        `File "${file.relativePath}" must not contain the string "filesystem" (storage type regression)`
      ).not.toContain('"filesystem"');
    }
  });

  it("generates no Docker Compose content when withDocker is false (the default)", () => {
    const normalized = normalizeInitOptions({
      projectName: "Vectorless Test",
      slug: "vectorless-test",
      profile: "vectorless-local"
      // withDocker defaults to false — not set here intentionally
    });

    expect(normalized.ok).toBe(true);

    if (!normalized.ok) {
      return;
    }

    expect(normalized.value.withDocker).toBe(false);

    const files = renderTemplates(normalized.value);
    const paths = files.map((f) => f.relativePath);

    expect(
      paths.includes("infra/local-dev/ai-context-db/docker-compose.yml"),
      "docker-compose.yml must not be generated when withDocker is false"
    ).toBe(false);

    for (const file of files) {
      expect(
        file.content,
        `File "${file.relativePath}" must not reference docker-compose when withDocker is false`
      ).not.toContain("docker-compose");
    }
  });
});
