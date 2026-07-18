import { describe, expect, it } from "vitest";
import {
  DefaultProfileResolver,
  getBuiltInProfiles,
  isBuiltInProfileName
} from "../src/index.js";

describe("DefaultProfileResolver", () => {
  it("uses the minimal profile by default", () => {
    const result = new DefaultProfileResolver().resolve({
      project: { name: "Demo", slug: "demo" }
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.profiles).toEqual(["minimal"]);
      expect(result.value.runtime.modes).toEqual(["local-stdio-mcp"]);
    }
  });

  it("applies built-in profile capability surfaces", () => {
    const profiles = getBuiltInProfiles();

    expect(profiles.map((profile) => profile.name)).toContain("hybrid-all");
    expect(isBuiltInProfileName("remote-safe")).toBe(true);
    expect(isBuiltInProfileName("unknown")).toBe(false);
  });

  it("lets explicit user config tighten or specialize a profile", () => {
    const result = new DefaultProfileResolver().resolve({
      project: { name: "Demo", slug: "demo" },
      profiles: ["remote-safe"],
      dashboard: {
        enabled: true,
        port: 9443
      }
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.runtime.modes).toEqual(["remote-http-mcp"]);
      expect(result.value.dashboard.port).toBe(9443);
    }
  });
});
