import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { TtoksemConfigSchema, type TtoksemConfig } from "@ttoksem/schema";

export interface LoadedProjectConfig {
  config: TtoksemConfig;
  path: string;
}

/**
 * Discover, read, parse, and validate ttoksem.config.json.
 * Returns null when no file is found. Throws a clear error on malformed JSON
 * or schema-invalid content — never silently ignores a broken config.
 */
export function loadProjectConfig(startDir: string): LoadedProjectConfig | null {
  const path = findProjectConfig(startDir);
  if (!path) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`ttoksem.config.json at ${path} is not valid JSON: ${String(err)}`);
  }
  const result = TtoksemConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`ttoksem.config.json at ${path} is invalid: ${result.error.message}`);
  }
  return { config: result.data, path };
}

/**
 * Resolve the workspace key by precedence: CLI flag > config file > env var.
 * Returns undefined when none supply a key — the ledger then resolves by
 * cwd/root_path (see workspace-spec.md), and errors if that also fails.
 * Note: there is intentionally no "ttoksem-dev" built-in default — that
 * hardcoded value is removed in Task 5.
 */
export function resolveWorkspaceKey(input: {
  flag?: string;
  config?: TtoksemConfig;
  env?: string;
}): string | undefined {
  return input.flag ?? input.config?.workspace ?? input.env;
}

let cached: LoadedProjectConfig | null | undefined;

/** Memoized project-config load from the CLI's effective cwd (INIT_CWD ?? cwd). */
export function getProjectConfig(): LoadedProjectConfig | null {
  if (cached === undefined) {
    cached = loadProjectConfig(process.env.INIT_CWD ?? process.cwd());
  }
  return cached;
}

/**
 * Walk up from startDir to find ttoksem.config.json.
 * Mirrors findExistingDbUpwards() in index.ts: same termination on filesystem root.
 * @returns Absolute path to ttoksem.config.json, or null if not found.
 */
export function findProjectConfig(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, "ttoksem.config.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
