import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { findProjectConfig, loadProjectConfig, resolveWorkspaceKey } from "./project-config.js";

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
      const nested = join(root, "a", "b");
      mkdirSync(nested, { recursive: true });
      expect(findProjectConfig(nested)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("loadProjectConfig", () => {
  it("loads and validates a config found upward from startDir", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      writeFileSync(
        join(root, "ttoksem.config.json"),
        JSON.stringify({ workspace: "my-proj", promptMode: "hash", _futureKey: 99 }),
      );
      const loaded = loadProjectConfig(root);
      expect(loaded?.config.workspace).toBe("my-proj");
      expect(loaded?.config.promptMode).toBe("hash");
      expect((loaded?.config as Record<string, unknown>)._futureKey).toBe(99);
      expect(loaded?.path).toBe(join(root, "ttoksem.config.json"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when no config file exists", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      expect(loadProjectConfig(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws a clear error on malformed JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      writeFileSync(join(root, "ttoksem.config.json"), "{ not json");
      expect(() => loadProjectConfig(root)).toThrow(/not valid JSON/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws a clear error on a schema-invalid value", () => {
    const root = mkdtempSync(join(tmpdir(), "ttoksem-cfg-"));
    try {
      writeFileSync(join(root, "ttoksem.config.json"), JSON.stringify({ promptMode: "bogus" }));
      expect(() => loadProjectConfig(root)).toThrow(/invalid/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveWorkspaceKey", () => {
  it("prefers the CLI flag over config and env", () => {
    expect(
      resolveWorkspaceKey({ flag: "from-flag", config: { workspace: "from-config" }, env: "from-env" }),
    ).toBe("from-flag");
  });

  it("prefers the config file over env when no flag", () => {
    expect(resolveWorkspaceKey({ config: { workspace: "from-config" }, env: "from-env" })).toBe(
      "from-config",
    );
  });

  it("falls back to env when neither flag nor config supply a key", () => {
    expect(resolveWorkspaceKey({ env: "from-env" })).toBe("from-env");
  });

  it("returns undefined when nothing supplies a key", () => {
    expect(resolveWorkspaceKey({})).toBeUndefined();
  });
});
