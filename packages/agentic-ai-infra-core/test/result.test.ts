import { describe, expect, it } from "vitest";
import { ok, validationFailure, validationIssue } from "../src/index.js";

describe("FrameworkResult helpers", () => {
  it("creates successful typed results", () => {
    const result = ok({ value: 1 });

    expect(result).toMatchObject({
      ok: true,
      value: { value: 1 }
    });
  });

  it("promotes fatal validation issues to fatal errors", () => {
    const result = validationFailure([
      validationIssue({
        path: "security.allowSecretPaths",
        code: "config.security-policy-weakened",
        message: "Cannot weaken policy.",
        severity: "fatal"
      })
    ]);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.severity).toBe("fatal");
    }
  });
});
