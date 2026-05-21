import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { findProjectConfig } from "./project-config.js";

describe("findProjectConfig", () => {
  it("finds ttoksem.config.json by walking up from a nested directory", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      writeFileSync(join(root, "ttoksem.config.json"), "{}");
      const nested = join(root, "a", "b");
      mkdirSync(nested, { recursive: true });
      expect(findProjectConfig(nested)).toBe(join(root, "ttoksem.config.json"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when no config file exists in any ancestor", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      expect(findProjectConfig(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
