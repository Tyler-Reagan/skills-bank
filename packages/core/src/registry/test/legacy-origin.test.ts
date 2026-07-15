import { describe, expect, test, vi, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLegacyOrigin } from "../legacy-origin.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-origin-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readLegacyOrigin", () => {
  test("returns null, silently, when there's no sidecar", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(readLegacyOrigin(dir)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("returns null but logs the corruption when the sidecar is unparseable (issue #210)", () => {
    fs.writeFileSync(path.join(dir, ".skills-bank.json"), "{ not json", "utf8");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(readLegacyOrigin(dir)).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toContain("unreadable");
    } finally {
      spy.mockRestore();
    }
  });
});
