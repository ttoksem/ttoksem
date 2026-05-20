import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { LedgerService } from "@ttoksem/core";
import { SqliteLedgerStore } from "@ttoksem/storage-sqlite";
import {
  hasTtoksemStopHook,
  mergeTtoksemStopHook,
  type ClaudeSettings,
} from "./settings-merge.js";

function startDir(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace"
  );
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Set up ttoksem in the current project")
    .option("--key <key>", "workspace key (default: current directory name)")
    .option("--name <name>", "workspace display name")
    .option("--yes", "install the autocapture hook without prompting")
    .action(async (options: { key?: string; name?: string; yes?: boolean }) => {
      const cwd = startDir();
      const dbPath = join(cwd, ".ttoksem", "ttoksem.db");
      const key = slugify(options.key ?? (basename(cwd) || "workspace"));

      // 1. Workspace + DB (reuse if present).
      mkdirSync(dirname(dbPath), { recursive: true });
      let store: SqliteLedgerStore | undefined;
      try {
        store = new SqliteLedgerStore(dbPath);
        const service = new LedgerService({ store });
        await service.init();
        const existing = await store.getWorkspaceByKey(key);
        if (existing) {
          console.log(`Reusing workspace "${key}".`);
        } else {
          await service.createWorkspace({ key, name: options.name ?? key, rootPath: cwd });
          console.log(`Created workspace "${key}" at ${dbPath}.`);
        }

        // 2. Claude Code project detection.
        const claudeDir = join(cwd, ".claude");
        if (!existsSync(claudeDir)) {
          console.log(
            "No .claude/ directory here — skipping autocapture hook setup.",
          );
          console.log(
            "Re-run `ttoksem init` after you start using Claude Code in this project.",
          );
          return;
        }

        // 3. Hook install (consent-gated, idempotent).
        const settingsPath = join(claudeDir, "settings.json");
        let settings: ClaudeSettings = {};
        if (existsSync(settingsPath)) {
          try {
            settings = JSON.parse(readFileSync(settingsPath, "utf8")) as ClaudeSettings;
          } catch {
            console.error(`Could not parse ${settingsPath}; leaving it untouched.`);
            return;
          }
        }
        if (hasTtoksemStopHook(settings)) {
          console.log("Autocapture hook already installed.");
          return;
        }
        const consent =
          options.yes === true ||
          (await confirm(
            "Install the ttoksem autocapture hook into .claude/settings.json?",
          ));
        if (!consent) {
          console.log("Skipped. Re-run `ttoksem init` to install it later.");
          return;
        }
        const merged = mergeTtoksemStopHook(
          settings,
          `ttoksem hook run --workspace ${key}`,
        );
        writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
        console.log(`Installed autocapture hook into ${settingsPath}.`);
        console.log(`Hook command: ttoksem hook run --workspace ${key}`);
      } finally {
        await store?.close();
      }
    });
}
