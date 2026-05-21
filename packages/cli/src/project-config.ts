import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Walk up from startDir to find ttoksem.config.json.
 * Mirrors findExistingDbUpwards() in index.ts: same termination on filesystem root.
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
