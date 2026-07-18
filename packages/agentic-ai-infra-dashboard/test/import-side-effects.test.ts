import { describe, expect, it, vi } from "vitest";

const httpMock = vi.hoisted(() => ({
  createServer: vi.fn()
}));

vi.mock("node:http", () => ({
  default: {
    createServer: httpMock.createServer
  },
  createServer: httpMock.createServer
}));

describe("dashboard import side effects", () => {
  it("dashboard import does not start a server", async () => {
    await import("../src/index.js");

    expect(httpMock.createServer).not.toHaveBeenCalled();
  });
});
