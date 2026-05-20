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

  it("adds a new empty-matcher group without disturbing a non-empty-matcher group", () => {
    const existing = {
      hooks: {
        Stop: [{ matcher: "Bash", hooks: [{ type: "command" as const, command: "scoped.sh" }] }],
      },
    };
    const merged = mergeTtoksemStopHook(existing, "ttoksem hook run --workspace ws");
    expect(merged.hooks!.Stop).toHaveLength(2);
    expect(merged.hooks!.Stop![0].matcher).toBe("Bash");
    expect(merged.hooks!.Stop![0].hooks[0].command).toBe("scoped.sh");
    expect(merged.hooks!.Stop![1].matcher).toBe("");
    expect(hasTtoksemStopHook(merged)).toBe(true);
  });

  it("lands the ttoksem hook only in the empty-matcher group when both group types exist", () => {
    const existing = {
      hooks: {
        Stop: [
          { matcher: "Bash", hooks: [{ type: "command" as const, command: "scoped.sh" }] },
          { matcher: "", hooks: [{ type: "command" as const, command: "other.sh" }] },
        ],
      },
    };
    const merged = mergeTtoksemStopHook(existing, "ttoksem hook run --workspace ws");
    expect(merged.hooks!.Stop).toHaveLength(2);
    expect(merged.hooks!.Stop![0].matcher).toBe("Bash");
    expect(merged.hooks!.Stop![0].hooks.map((h) => h.command)).toEqual(["scoped.sh"]);
    const emptyGroup = merged.hooks!.Stop!.find((g) => g.matcher === "")!;
    const cmds = emptyGroup.hooks.map((h) => h.command);
    expect(cmds).toContain("other.sh");
    expect(cmds).toContain("ttoksem hook run --workspace ws");
  });
});
