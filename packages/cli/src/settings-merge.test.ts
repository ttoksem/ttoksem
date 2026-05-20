import { describe, it, expect } from "vitest";
import { mergeTtoksemStopHook, hasTtoksemStopHook } from "./settings-merge.js";

describe("settings-merge", () => {
  it("adds a Stop hook to empty settings", () => {
    const merged = mergeTtoksemStopHook({}, "ttoksem hook run --workspace ws");
    expect(merged.hooks?.Stop?.[0]?.hooks[0]?.command).toBe("ttoksem hook run --workspace ws");
    expect(hasTtoksemStopHook(merged)).toBe(true);
  });

  it("preserves a pre-existing non-ttoksem Stop hook", () => {
    const existing = {
      hooks: { Stop: [{ matcher: "", hooks: [{ type: "command" as const, command: "other.sh" }] }] },
    };
    const merged = mergeTtoksemStopHook(existing, "ttoksem hook run --workspace ws");
    const cmds = merged.hooks!.Stop![0].hooks.map((h) => h.command);
    expect(cmds).toContain("other.sh");
    expect(cmds).toContain("ttoksem hook run --workspace ws");
  });

  it("is idempotent — re-merging does not duplicate the ttoksem hook", () => {
    let s = mergeTtoksemStopHook({}, "ttoksem hook run --workspace ws");
    s = mergeTtoksemStopHook(s, "ttoksem hook run --workspace ws");
    const ttoksemHooks = s.hooks!.Stop![0].hooks.filter((h) => h.command.includes("ttoksem hook run"));
    expect(ttoksemHooks).toHaveLength(1);
  });

  it("preserves unrelated top-level keys", () => {
    const merged = mergeTtoksemStopHook({ $schema: "x" }, "ttoksem hook run --workspace ws");
    expect(merged.$schema).toBe("x");
  });
});
