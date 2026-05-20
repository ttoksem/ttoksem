export interface HookEntry {
  type: "command";
  command: string;
  asyncRewake?: boolean;
  timeout?: number;
}

export interface MatcherGroup {
  matcher: string;
  hooks: HookEntry[];
}

export interface ClaudeSettings {
  $schema?: string;
  hooks?: { Stop?: MatcherGroup[] } & Record<string, MatcherGroup[] | undefined>;
  [key: string]: unknown;
}

const TTOKSEM_HOOK_MARKER = "ttoksem hook run";

export function hasTtoksemStopHook(settings: ClaudeSettings): boolean {
  return (settings.hooks?.Stop ?? []).some((group) =>
    group.hooks.some((h) => h.type === "command" && h.command.includes(TTOKSEM_HOOK_MARKER)),
  );
}

export function mergeTtoksemStopHook(settings: ClaudeSettings, command: string): ClaudeSettings {
  const entry: HookEntry = { type: "command", command, asyncRewake: true, timeout: 60 };
  const next: ClaudeSettings = { ...settings };
  const hooks = { ...(next.hooks ?? {}) };
  const stop: MatcherGroup[] = [...(hooks.Stop ?? [])];

  const groupIndex = stop.findIndex((g) => g.matcher === "");
  if (groupIndex === -1) {
    stop.push({ matcher: "", hooks: [entry] });
  } else {
    const group = { ...stop[groupIndex] };
    const kept = group.hooks.filter(
      (h) => !(h.type === "command" && h.command.includes(TTOKSEM_HOOK_MARKER)),
    );
    group.hooks = [...kept, entry];
    stop[groupIndex] = group;
  }

  hooks.Stop = stop;
  next.hooks = hooks;
  return next;
}
