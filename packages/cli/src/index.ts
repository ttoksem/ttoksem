#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import {
  LedgerService,
  type DashboardData,
  type InboxAssignmentResult,
  type InboxGroup,
  type Ledger,
  type LocalLedger,
} from "@ttoksem/core";
import {
  AiUsageObservedSchema,
  type AiUsageObserved,
  type UsageEventRecord,
} from "@ttoksem/schema";
import {
  openAiUsageObservedFromResponse,
  anthropicUsageObservedFromResponse,
  summarizeClaudeAssistantContent,
  type ClaudeAssistantSummary,
} from "@ttoksem/providers";
import { serveDashboard } from "@ttoksem/server";
import { SqliteLedgerStore } from "@ttoksem/storage-sqlite";
import {
  appendQueryParam,
  ensureDashboardAccessKey,
  isLoopbackHost,
  parseAuthMode,
  registerAuthCommands,
} from "./auth.js";
import { registerInitCommand } from "./init.js";
import { registerWorkerCommands } from "./worker.js";
import { makeLedger, requireLocalLedger } from "./ledger-factory.js";
import { getProjectConfig, resolveWorkspaceKey } from "./project-config.js";
import { HttpLedgerError } from "@ttoksem/ledger-http";

/**
 * Translate top-level CLI errors into actionable single-line stderr
 * messages. Most errors are local Error objects whose `.message` is
 * already user-readable; HttpLedgerError needs status-aware framing.
 */
function formatCliError(error: unknown): string {
  if (error instanceof HttpLedgerError) {
    const detail = error.body?.detail ?? error.body?.error;
    const suffix = detail ? ` — ${detail}` : "";
    switch (error.status) {
      case 0:
        return `${error.message}. Check that TTOKSEM_HTTP_URL is reachable, or unset it to fall back to local mode.`;
      case 401:
        return `Authentication failed (HTTP 401)${suffix}. Set or refresh TTOKSEM_HTTP_TOKEN.`;
      case 403:
        return `Authorization failed (HTTP 403)${suffix}. The token is missing the required scope (typically dashboard:read for reads or api:write for mutations).`;
      case 404:
        return `Not found (HTTP 404)${suffix}.`;
      case 410:
        return `Endpoint removed (HTTP 410)${suffix}. Run \`pnpm cli --help\` to see current commands.`;
      default:
        if (error.status >= 500) {
          return `Server error (HTTP ${error.status})${suffix}. Check the ttoksem server logs.`;
        }
        return `${error.message}${suffix}`;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Adapter that turns the existing makeService() into the shape the
 * makeLedger() factory expects. Centralizes the `await service.init()`
 * call so each subcommand body becomes a uniform two-line block.
 */
async function makeLocalService(): Promise<{ service: LedgerService; close: () => Promise<void> }> {
  const { service, close } = await makeService();
  await service.init();
  return { service, close };
}

/**
 * Variant of makeLocalService for subcommands that create the DB (workspace init).
 */
async function makeLocalServiceAllowCreate(): Promise<{ service: LedgerService; close: () => Promise<void> }> {
  const { service, close } = await makeService({ allowCreate: true });
  await service.init();
  return { service, close };
}

/** Convenience: build a LedgerHandle for a standard (non-create) subcommand. */
function makeLedgerLocal() {
  return makeLedger({ makeLocalService });
}

/** Convenience: build a LedgerHandle for workspace init (allowCreate). */
function makeLedgerAllowCreate() {
  return makeLedger({ makeLocalService: makeLocalServiceAllowCreate });
}

/**
 * Read the Claude Code Stop hook stdin payload and extract the transcript dir.
 * Returns undefined when stdin is a TTY (manual invocation) or when the payload
 * does not contain a transcript_path.
 */
async function projectsDirFromStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  try {
    const payload = JSON.parse(raw) as { transcript_path?: string };
    return payload.transcript_path ? dirname(payload.transcript_path) : undefined;
  } catch {
    return undefined;
  }
}

const program = new Command();

program.name("ttoksem").description("Local-first AI task costbook").version("0.0.0");

program
  .command("doctor")
  .description("Check local CLI and SQLite setup")
  .action(async () => {
    const handle = await makeLedgerLocal();
    try {
      requireLocalLedger(handle);
      const dbPath = resolveDbPath(false);
      console.log(`ok database=${dbPath}`);
    } finally {
      await handle.close();
    }
  });

const workspace = program.command("workspace").description("Workspace commands");

workspace
  .command("init")
  .description("Create or reuse a workspace for the current directory")
  .option("--key <key>", "workspace key")
  .option("--name <name>", "workspace name")
  .option("--root <path>", "workspace root path")
  .action(async (options: { key?: string; name?: string; root?: string }) => {
    const handle = await makeLedgerAllowCreate();
    try {
      const service = requireLocalLedger(handle);
      const rootPath = resolveFromCommandCwd(options.root ?? ".");
      const key = options.key ?? slug(rootPath.split("/").filter(Boolean).at(-1) ?? "workspace");
      const workspace = await service.createWorkspace({ key, name: options.name, rootPath });
      console.log(`workspace ${workspace.key} ${workspace.id}`);
    } finally {
      await handle.close();
    }
  });

workspace
  .command("current")
  .description("Show workspace for the current directory")
  .option("--root <path>", "workspace root path")
  .action(async (options: { root?: string }) => {
    const handle = await makeLedgerLocal();
    try {
      const service = requireLocalLedger(handle);
      const current = await service.currentWorkspace(resolveFromCommandCwd(options.root ?? "."));
      console.log(JSON.stringify(current, null, 2));
    } finally {
      await handle.close();
    }
  });

workspace
  .command("list")
  .description("List workspaces")
  .action(async () => {
    const handle = await makeLedger({ makeLocalService });
    try {
      for (const workspace of await handle.ledger.listWorkspaces()) {
        console.log(`${workspace.key}\t${workspace.id}\t${workspace.root_path ?? ""}`);
      }
    } finally {
      await handle.close();
    }
  });

const task = program.command("task").description("Task commands");

task
  .command("start")
  .argument("<key>", "task key")
  .option("--name <name>", "task name")
  .option("--description <description>", "task description")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("Create or activate a task")
  .action(
    async (
      key: string,
      options: { name?: string; description?: string; workspace?: string; root?: string },
    ) => {
      const handle = await makeLedger({ makeLocalService });
      try {
        const started = await handle.ledger.startTask({
          workspace: workspaceResolver(options),
          key: slug(key),
          name: options.name ?? key,
          description: options.description,
        });
        console.log(`task ${started.key} ${started.status} ${started.id} ${started.name}`);
        process.stderr.write(
          `hint: export TTOKSEM_TASK=${started.key}  # autocapture will attribute future events to this task\n`,
        );
      } finally {
        await handle.close();
      }
    },
  );

task
  .command("update")
  .argument("<key>", "task key")
  .option("--name <name>", "task name")
  .option("--description <description>", "task description")
  .option("--clear-description", "clear task description")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("Update a task title or description")
  .action(async (key: string, options: TaskUpdateOptions) => {
    if (!options.name && options.description == null && !options.clearDescription) {
      throw new Error("Provide --name, --description, or --clear-description.");
    }
    const handle = await makeLedger({ makeLocalService });
    try {
      const update = {
        workspace: workspaceResolver(options),
        key: slug(key),
        ...(options.name ? { name: options.name } : {}),
        ...(options.clearDescription ? { description: null } : {}),
        ...(options.description != null ? { description: options.description } : {}),
      };
      const updated = await handle.ledger.updateTask(update);
      console.log(`task ${updated.key} ${updated.status} ${updated.id} ${updated.name}`);
    } finally {
      await handle.close();
    }
  });

task
  .command("archive")
  .argument("<key>", "task key")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("Archive a task by key")
  .action(async (key: string, options: { workspace?: string; root?: string }) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      const archived = await handle.ledger.archiveTask({
        workspace: workspaceResolver(options),
        key: slug(key),
      });
      console.log(`task ${archived.key} ${archived.status} ${archived.id} ${archived.name}`);
    } finally {
      await handle.close();
    }
  });

task
  .command("close")
  .argument("<key>", "task key")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("(deprecated — use 'task archive') Archive a task by key")
  .action(async (key: string, options: { workspace?: string; root?: string }) => {
    process.stderr.write(
      "[deprecation] `task close` is renamed to `task archive`. Update your scripts. " +
        "This alias will be removed in two minor releases.\n",
    );
    const handle = await makeLedger({ makeLocalService });
    try {
      const archived = await handle.ledger.archiveTask({
        workspace: workspaceResolver(options),
        key: slug(key),
      });
      console.log(`task ${archived.key} ${archived.status} ${archived.id} ${archived.name}`);
    } finally {
      await handle.close();
    }
  });

task
  .command("list")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("List workspace tasks")
  .action(async (options: { workspace?: string; root?: string }) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      for (const item of await handle.ledger.listTasks({ workspace: workspaceResolver(options) })) {
        console.log(`${item.key}\t${item.status}\t${item.id}\t${item.name}`);
      }
    } finally {
      await handle.close();
    }
  });

task
  .command("active")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("(deprecated — use $TTOKSEM_TASK) Print the key of the most recently started active task, or nothing if none")
  .action(async (options: { workspace?: string; root?: string }) => {
    process.stderr.write(
      "[deprecation] `task active` is going away in two minor releases. " +
      "Use `echo $TTOKSEM_TASK` for the current shell-scoped task, or " +
      "`task list` to see tasks with status='active'. " +
      "See MIGRATION.md#task-active.\n",
    );
    const handle = await makeLedger({ makeLocalService });
    try {
      const tasks = await handle.ledger.listTasks({ workspace: workspaceResolver(options) });
      const active = tasks
        .filter((t) => t.status === "active")
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      if (active) console.log(active.key);
    } finally {
      await handle.close();
    }
  });

task
  .command("stats")
  .option("--key <key>", "task key")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--field <field>", "output a single field value (run_count, event_count, estimated_cost_nanos, unpriced_count, status)")
  .description("Show stats for a task (run count, event count, cost)")
  .action(async (options: { key?: string; workspace?: string; root?: string; field?: string }) => {
    if (!options.key) throw new Error("--key is required.");
    const handle = await makeLedger({ makeLocalService });
    try {
      const stats = await handle.ledger.getTaskStats({ workspace: workspaceResolver(options), key: options.key });
      if (options.field) {
        const val = stats[options.field as keyof typeof stats];
        if (val === undefined) throw new Error(`Unknown field: ${options.field}`);
        console.log(val ?? "");
      } else {
        for (const [k, v] of Object.entries(stats)) {
          console.log(`${k}=${v ?? ""}`);
        }
      }
    } finally {
      await handle.close();
    }
  });

const usage = program.command("usage").description("Usage commands");

usage
  .command("last-import")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--source <source>", "source filter (e.g. claude-session, codex-session)", "claude-session")
  .description("Print the occurred_at of the last imported event for a given source, or nothing if none")
  .action(async (options: { workspace?: string; root?: string; source: string }) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      const ts = await handle.ledger.getLastImportedAt({ workspace: workspaceResolver(options), source: options.source });
      if (ts) console.log(ts);
    } finally {
      await handle.close();
    }
  });

usage
  .command("add")
  .description("Record an ai.usage.observed message")
  .option("--file <path>", "canonical ai.usage.observed JSON file")
  .option("--workspace <key>", "workspace key")
  .option("--task <key>", "task key")
  .option("--run-id <id>", "existing or explicit run id")
  .option("--provider <provider>", "provider name")
  .option("--model <model>", "model name")
  .option("--started-at <iso>", "usage start timestamp")
  .option("--ended-at <iso>", "usage end timestamp")
  .option("--duration-ms <ms>", "usage duration in milliseconds")
  .option("--input-tokens <count>", "input token count")
  .option("--output-tokens <count>", "output token count")
  .option("--observed-cost <amount>", "provider-observed cost")
  .option("--estimated-cost <amount>", "rule-estimated cost")
  .option("--currency <code>", "ISO currency code", "USD")
  .option("--idempotency-key <key>", "idempotency key")
  .action(async (options: UsageAddOptions) => {
    const message = options.file ? readMessage(options.file) : buildUsageMessage(options);
    const handle = await makeLedger({ makeLocalService });
    try {
      const event = await handle.ledger.recordUsage(message);
      console.log(`usage ${event.id} ${event.provider}/${event.model} ${event.assignment_status}`);
    } finally {
      await handle.close();
    }
  });

usage
  .command("move")
  .argument("<usage-id>", "usage event id")
  .requiredOption("--task <key>", "destination task key")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("Assign an existing usage event to a task")
  .action(async (usageEventId: string, options: UsageMoveOptions) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      const event = await handle.ledger.moveUsage({
        workspace: workspaceResolver(options),
        usageEventId,
        taskKey: slug(options.task),
      });
      console.log(`usage ${event.id} moved task_id=${event.task_id ?? ""}`);
    } finally {
      await handle.close();
    }
  });

usage
  .command("codex-turn")
  .alias("chat-turn")
  .description("Record an estimated chat conversation turn")
  .option("--workspace <key>", "workspace key")
  .option("--task <key>", "task key; omit when the goal is not clear")
  .option("--run-id <id>", "existing or explicit run id")
  .option("--model <model>", "model label", "codex-chat")
  .option("--started-at <iso>", "turn start timestamp")
  .option("--ended-at <iso>", "turn end timestamp")
  .option("--duration-ms <ms>", "turn duration in milliseconds")
  .option("--input-tokens <count>", "estimated input token count")
  .option("--output-tokens <count>", "estimated output token count")
  .option("--input-chars <count>", "input character count to estimate tokens")
  .option("--output-chars <count>", "output character count to estimate tokens")
  .option("--prompt-text <text>", "full prompt text to store")
  .option("--response-text <text>", "full assistant response text to store")
  .option("--prompt-file <path>", "file containing full prompt text to store")
  .option("--response-file <path>", "file containing full assistant response text to store")
  .option("--prompt-mode <mode>", "prompt snapshot mode: full, redacted, hash, or none", "full")
  .option("--idempotency-key <key>", "idempotency key")
  .action(async (options: CodexTurnOptions) => {
    const handle = await makeLedgerLocal();
    try {
      const service = requireLocalLedger(handle);
      const message = buildCodexTurnMessage({ ...options, workspace: resolveWorkspaceKeyFromOptions(options) });
      const event = await service.recordUsage(message);
      console.log(`usage ${event.id} ${event.provider}/${event.model} ${event.assignment_status}`);
    } finally {
      await handle.close();
    }
  });

usage
  .command("import-codex-sessions")
  .description("Import Codex App/CLI session token_count events")
  .option("--workspace <key>", "workspace key")
  .option("--task <key>", "task key to attach imported usage")
  .option("--file <path>", "single Codex session JSONL file")
  .option("--sessions-dir <path>", "Codex sessions directory; defaults to $CODEX_HOME/sessions")
  .option("--codex-home <path>", "Codex home directory", process.env.CODEX_HOME ?? "~/.codex")
  .option("--thread-id <id>", "only import one Codex thread id")
  .option("--since <iso>", "only import token_count events at or after this UTC timestamp")
  .option("--model <model>", "model label when session metadata does not include one", "codex-app")
  .option("--prompt-mode <mode>", "prompt snapshot mode: full, redacted, hash, or none", "full")
  .option("--limit <count>", "maximum token_count events to import")
  .option("--dry-run", "scan and print counts without writing usage events")
  .action(async (options: CodexSessionImportOptions) => {
    const handle = await makeLedgerLocal();
    try {
      const service = handle.ledger;
      const result = await importCodexSessions(service, {
        ...options,
        workspace: resolveWorkspaceKeyFromOptions(options),
      });
      console.log(
        `codex import scanned_files=${result.scannedFiles} token_events=${result.tokenEvents} imported=${result.imported} skipped=${result.skipped} errors=${result.errors}`,
      );
    } finally {
      await handle.close();
    }
  });

usage
  .command("claude-turn")
  .description("Record an estimated Claude (Claude Code/Claude.app) chat turn")
  .option("--workspace <key>", "workspace key")
  .option("--task <key>", "task key; omit when the goal is not clear")
  .option("--run-id <id>", "existing or explicit run id")
  .option("--model <model>", "model label", "claude-chat")
  .option("--started-at <iso>", "turn start timestamp")
  .option("--ended-at <iso>", "turn end timestamp")
  .option("--duration-ms <ms>", "turn duration in milliseconds")
  .option("--input-tokens <count>", "estimated input token count")
  .option("--output-tokens <count>", "estimated output token count")
  .option("--input-chars <count>", "input character count to estimate tokens")
  .option("--output-chars <count>", "output character count to estimate tokens")
  .option("--prompt-text <text>", "full prompt text to store")
  .option("--response-text <text>", "full assistant response text to store")
  .option("--prompt-file <path>", "file containing full prompt text to store")
  .option("--response-file <path>", "file containing full assistant response text to store")
  .option("--prompt-mode <mode>", "prompt snapshot mode: full, redacted, hash, or none", "full")
  .option("--idempotency-key <key>", "idempotency key")
  .action(async (options: ClaudeTurnOptions) => {
    const handle = await makeLedgerLocal();
    try {
      const service = requireLocalLedger(handle);
      const message = buildClaudeTurnMessage({ ...options, workspace: resolveWorkspaceKeyFromOptions(options) });
      const event = await service.recordUsage(message);
      console.log(`usage ${event.id} ${event.provider}/${event.model} ${event.assignment_status}`);
    } finally {
      await handle.close();
    }
  });

usage
  .command("import-claude-sessions")
  .description("Import Claude Code session JSONL events from ~/.claude/projects")
  .option("--workspace <key>", "workspace key")
  .option("--task <key>", "task key to attach imported usage")
  .option("--file <path>", "single Claude Code session JSONL file")
  .option("--projects-dir <path>", "Claude Code projects directory; defaults to $CLAUDE_HOME/projects")
  .option("--claude-home <path>", "Claude home directory", process.env.CLAUDE_HOME ?? "~/.claude")
  .option("--thread-id <id>", "only import one Claude session id")
  .option("--since <iso>", "only import assistant events at or after this UTC timestamp")
  .option("--model <model>", "model label when an assistant event does not include one", "claude-app")
  .option("--prompt-mode <mode>", "prompt snapshot mode: full, redacted, hash, or none", "full")
  .option("--limit <count>", "maximum assistant events to import")
  .option("--dry-run", "scan and print counts without writing usage events")
  .option("--no-subagents", "skip subagent JSONL files (default: include)")
  .action(async (options: ClaudeSessionImportOptions) => {
    const handle = await makeLedgerLocal();
    try {
      const service = handle.ledger;
      const result = await importClaudeSessions(service, {
        ...options,
        workspace: resolveWorkspaceKeyFromOptions(options),
      });
      console.log(
        `claude import scanned_files=${result.scannedFiles} assistant_events=${result.assistantEvents} imported=${result.imported} skipped=${result.skipped} errors=${result.errors}`,
      );
    } finally {
      await handle.close();
    }
  });

usage
  .command("openai-response")
  .description("Record exact usage from an OpenAI SDK response JSON file")
  .requiredOption("--file <path>", "OpenAI SDK response JSON file")
  .requiredOption("--workspace <key>", "workspace key")
  .option("--task <key>", "task key; omit when the goal is not clear")
  .option("--run-id <id>", "existing or explicit run id")
  .option("--model <model>", "model label when the response does not include one")
  .option("--operation <name>", "SDK operation name", "openai.sdk")
  .option("--occurred-at <iso>", "usage timestamp; defaults to now")
  .option("--observed-cost <amount>", "provider-observed cost if known")
  .option("--currency <code>", "ISO currency code", "USD")
  .option("--idempotency-key <key>", "idempotency key")
  .action(async (options: OpenAiResponseOptions) => {
    const handle = await makeLedgerLocal();
    try {
      const service = requireLocalLedger(handle);
      const response = readJsonRecord(options.file);
      const message = openAiUsageObservedFromResponse({
        workspaceKey: options.workspace,
        taskKey: options.task ? slug(options.task) : null,
        runId: options.runId ?? null,
        model: options.model ?? null,
        operation: options.operation,
        occurredAt: options.occurredAt ?? null,
        observedCost: parseOptionalNumber(options.observedCost),
        currency: options.currency,
        idempotencyKey: options.idempotencyKey ?? null,
        response,
      });
      const event = await service.recordUsage(message);
      console.log(`usage ${event.id} ${event.provider}/${event.model} ${event.assignment_status}`);
    } finally {
      await handle.close();
    }
  });

usage
  .command("anthropic-response")
  .description("Record exact usage from an Anthropic SDK response JSON file")
  .requiredOption("--file <path>", "Anthropic SDK response JSON file")
  .requiredOption("--workspace <key>", "workspace key")
  .option("--task <key>", "task key; omit when the goal is not clear")
  .option("--run-id <id>", "existing or explicit run id")
  .option("--model <model>", "model label when the response does not include one")
  .option("--operation <name>", "SDK operation name", "anthropic.sdk")
  .option("--occurred-at <iso>", "usage timestamp; defaults to now")
  .option("--observed-cost <amount>", "provider-observed cost if known")
  .option("--currency <code>", "ISO currency code", "USD")
  .option("--idempotency-key <key>", "idempotency key")
  .action(async (options: AnthropicResponseOptions) => {
    const handle = await makeLedgerLocal();
    try {
      const service = requireLocalLedger(handle);
      const response = readJsonRecord(options.file);
      const message = anthropicUsageObservedFromResponse({
        workspaceKey: options.workspace,
        taskKey: options.task ? slug(options.task) : null,
        runId: options.runId ?? null,
        model: options.model ?? null,
        operation: options.operation,
        occurredAt: options.occurredAt ?? null,
        observedCost: parseOptionalNumber(options.observedCost),
        currency: options.currency,
        idempotencyKey: options.idempotencyKey ?? null,
        response,
      });
      const event = await service.recordUsage(message);
      console.log(`usage ${event.id} ${event.provider}/${event.model} ${event.assignment_status}`);
    } finally {
      await handle.close();
    }
  });

const inbox = program.command("inbox").description("Inbox commands");

inbox
  .command("list")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--limit <count>", "maximum groups or events to show", "20")
  .option("--events", "show raw unassigned usage events instead of inbox groups")
  .description("List assignment inbox groups")
  .action(async (options: InboxListOptions) => {
    const limit = parsePositiveInteger(options.limit);
    const handle = await makeLedger({ makeLocalService });
    try {
      if (options.events) {
        const events = await handle.ledger.listInbox({
          workspace: workspaceResolver(options),
          limit,
        });
        if (events.length === 0) {
          console.log("No unassigned usage events.");
        } else {
          for (const event of events) {
            printUsageEventLine(event);
          }
        }
      } else {
        const groups = await handle.ledger.listInboxGroups({
          workspace: workspaceResolver(options),
          limit,
        });
        if (groups.length === 0) console.log("No inbox groups.");
        else printInboxGroups(groups);
      }
    } finally {
      await handle.close();
    }
  });

inbox
  .command("show")
  .argument("<group-id>", "inbox group id")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--limit <count>", "maximum events to show", "50")
  .description("Show an inbox group and its sample events")
  .action(async (groupId: string, options: InboxShowOptions) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      const result = await handle.ledger.showInboxGroup({
        workspace: workspaceResolver(options),
        groupId,
        limit: parsePositiveInteger(options.limit),
      });
      printInboxGroupDetail(result.group, result.events);
    } finally {
      await handle.close();
    }
  });

inbox
  .command("assign")
  .argument("<group-id>", "inbox group id")
  .requiredOption("--task <key>", "destination task key")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--all", "assign every eligible event in the group")
  .description("Assign an inbox group to a task")
  .action(async (groupId: string, options: InboxAssignOptions) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      const result = await handle.ledger.assignInboxGroup({
        workspace: workspaceResolver(options),
        groupId,
        taskKey: slug(options.task),
        all: options.all,
      });
      printInboxAssignmentResult(result);
    } finally {
      await handle.close();
    }
  });

inbox
  .command("accept")
  .argument("<group-id>", "inbox group id with a suggested task")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--all", "assign every eligible event in the group")
  .description("Accept an inbox group's suggested task")
  .action(async (groupId: string, options: InboxAcceptOptions) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      const result = await handle.ledger.acceptInboxGroup({
        workspace: workspaceResolver(options),
        groupId,
        all: options.all,
      });
      printInboxAssignmentResult(result);
    } finally {
      await handle.close();
    }
  });

inbox
  .command("assign-event")
  .argument("<usage-id>", "usage event id")
  .requiredOption("--task <key>", "destination task key")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("Assign one inbox usage event to a task")
  .action(async (usageEventId: string, options: InboxAssignEventOptions) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      const event = await handle.ledger.assignInboxEvent({
        workspace: workspaceResolver(options),
        usageEventId,
        taskKey: slug(options.task),
      });
      console.log(`usage ${event.id} moved task_id=${event.task_id ?? ""}`);
    } finally {
      await handle.close();
    }
  });

const dashboard = program.command("dashboard").description("Dashboard commands");

dashboard
  .command("overview")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--task-limit <count>", "maximum task rows", "8")
  .option("--recent-limit <count>", "maximum recent usage rows", "8")
  .option("--day-limit <count>", "maximum daily buckets", "14")
  .description("Show a report-style workspace dashboard")
  .action(async (options: DashboardOverviewOptions) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      const data = await handle.ledger.dashboard({
        workspace: workspaceResolver(options),
        taskLimit: parsePositiveInteger(options.taskLimit),
        recentLimit: parsePositiveInteger(options.recentLimit),
        dayLimit: parsePositiveInteger(options.dayLimit),
      });
      printDashboardOverview(data);
    } finally {
      await handle.close();
    }
  });

dashboard
  .command("serve")
  .option("--workspace <key>", "workspace key")
  .option("--host <host>", "host to bind", "127.0.0.1")
  .option("--port <port>", "port to bind", "4317")
  .option("--auth <mode>", "auth mode: access-key or none", "access-key")
  .option("--create-key-name <name>", "name for the initial persistent dashboard key", "dashboard")
  .option("--unsafe-no-auth", "allow --auth none on a non-loopback host")
  .description("Serve the local read-only dashboard")
  .action(async (options: DashboardServeOptions) => {
    const authMode = parseAuthMode(options.auth);
    if (authMode === "none" && !isLoopbackHost(options.host) && !options.unsafeNoAuth) {
      throw new Error("--auth none on a non-loopback host requires --unsafe-no-auth.");
    }
    // Guard: dashboard serve is local-only (it opens the SQLite db directly).
    // requireLocalLedger fires before any logic when TTOKSEM_HTTP_URL is set.
    const handle = await makeLedgerLocal();
    try {
      requireLocalLedger(handle);
    } finally {
      await handle.close();
    }
    const workspaceKey = resolveWorkspaceKeyFromOptions(options);
    if (!workspaceKey) {
      throw new Error(
        "dashboard serve requires a workspace key. Pass --workspace <key>, set TTOKSEM_WORKSPACE_KEY, or add a ttoksem.config.json with {\"workspace\": \"<key>\"}.",
      );
    }
    const initialToken =
      authMode === "access-key"
        ? await ensureDashboardAccessKey(makeLedgerLocal, requireLocalLedger, workspaceKey, options.createKeyName)
        : null;
    const dbPath = resolveDbPath(false);
    const server = await serveDashboard({
      dbPath,
      workspaceKey,
      hostname: options.host,
      port: parsePositiveInteger(options.port),
      authMode,
    });
    console.log(`dashboard ${initialToken ? appendQueryParam(server.url, "token", initialToken.token) : server.url}`);
    if (initialToken) {
      console.log(`dashboard access_key ${initialToken.key.id} prefix=${initialToken.key.token_prefix}`);
      console.log(`dashboard token ${initialToken.token}`);
    }
    await waitForShutdown(server.close);
  });

registerAuthCommands(program, makeService, makeLedgerLocal, requireLocalLedger);
registerInitCommand(program);
registerWorkerCommands(program);

const pricing = program.command("pricing").description("Pricing commands");
const pricingSnapshot = pricing.command("snapshot").description("Pricing source snapshot commands");

pricingSnapshot
  .command("upsert")
  .option("--id <id>", "snapshot id, defaults to generated price_snapshot_*")
  .requiredOption("--source-name <name>", "pricing source name: litellm, manual, import, openrouter")
  .requiredOption("--raw-sha256 <hash>", "raw source snapshot sha256")
  .option("--source-url <url>", "source URL")
  .option("--source-version <version>", "source version")
  .option("--source-commit <commit>", "source commit")
  .option("--source-retrieved-at <iso>", "UTC ISO timestamp when source was retrieved")
  .option("--bundled-at <iso>", "UTC ISO timestamp when snapshot was bundled")
  .option("--valid-from <iso>", "UTC ISO timestamp when snapshot becomes the known pricing basis")
  .option("--raw-storage-ref <ref>", "raw snapshot storage reference")
  .option("--metadata <json>", "metadata JSON object")
  .description("Create or reuse a pricing source snapshot")
  .action(async (options: PricingSnapshotUpsertOptions) => {
    const handle = await makeLedgerLocal();
    try {
      const service = requireLocalLedger(handle);
      const snapshot = await service.upsertPricingSourceSnapshot({
        id: options.id,
        sourceName: parsePricingSourceName(options.sourceName),
        sourceUrl: options.sourceUrl,
        sourceVersion: options.sourceVersion,
        sourceCommit: options.sourceCommit,
        sourceRetrievedAt: options.sourceRetrievedAt,
        bundledAt: options.bundledAt,
        validFrom: options.validFrom,
        rawSha256: options.rawSha256,
        rawStorageRef: options.rawStorageRef,
        metadataJson: parseOptionalJsonObject(options.metadata),
      });
      console.log(
        `pricing snapshot ${snapshot.id} ${snapshot.source_name} ${snapshot.raw_sha256}`,
      );
    } finally {
      await handle.close();
    }
  });

pricingSnapshot
  .command("list")
  .description("List pricing source snapshots")
  .action(async () => {
    const handle = await makeLedger({ makeLocalService });
    try {
      for (const snapshot of await handle.ledger.listPricingSourceSnapshots()) {
        console.log(
          [
            snapshot.id,
            snapshot.source_name,
            `sha256=${snapshot.raw_sha256}`,
            snapshot.source_commit ? `commit=${snapshot.source_commit}` : "",
            snapshot.valid_from ? `valid_from=${snapshot.valid_from}` : "",
          ]
            .filter(Boolean)
            .join("\t"),
        );
      }
    } finally {
      await handle.close();
    }
  });

pricing
  .command("import-litellm")
  .requiredOption("--source-snapshot-id <id>", "pricing source snapshot id")
  .option("--file <path>", "raw LiteLLM model_prices_and_context_window.json file")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--provider <provider>", "only import one LiteLLM provider")
  .option("--model <model>", "only import one model key")
  .option("--effective-from <iso>", "UTC ISO timestamp when imported rules take effect")
  .option("--limit <count>", "maximum normalized rules to import")
  .description("Import normalized pricing rules from a LiteLLM pricing snapshot")
  .action(async (options: PricingImportLiteLlmOptions) => {
    const handle = await makeLedgerLocal();
    try {
      const service = requireLocalLedger(handle);
      const snapshot = await service.getPricingSourceSnapshot(options.sourceSnapshotId);
      if (!snapshot) throw new Error(`Pricing source snapshot not found: ${options.sourceSnapshotId}`);
      const rawStorageRef = options.file ?? snapshot.raw_storage_ref;
      if (!rawStorageRef) throw new Error("Provide --file or store raw_storage_ref on the snapshot.");
      const raw = JSON.parse(readFileSync(resolveFromCommandCwd(rawStorageRef), "utf8")) as unknown;
      const normalized = normalizeLiteLlmPricingRules(raw, {
        provider: options.provider,
        model: options.model,
        effectiveFrom: options.effectiveFrom ?? snapshot.valid_from ?? snapshot.source_retrieved_at ?? undefined,
        limit: options.limit ? parsePositiveInteger(options.limit) : undefined,
      });
      for (const rule of normalized.rules) {
        await service.upsertPricingRule({
          workspace: workspaceResolver(options),
          sourceSnapshotId: snapshot.id,
          provider: rule.provider,
          model: rule.model,
          usageKind: rule.usageKind,
          unitType: rule.unitType,
          priceNanosPerUnit: rule.priceNanosPerUnit,
          currency: "USD",
          effectiveFrom: rule.effectiveFrom,
          source: "litellm",
        });
      }
      console.log(
        `pricing import-litellm imported=${normalized.rules.length} skipped=${normalized.skipped} snapshot=${snapshot.id}`,
      );
    } finally {
      await handle.close();
    }
  });

pricing
  .command("upsert")
  .requiredOption("--provider <provider>", "provider name")
  .requiredOption("--model <model>", "model name, or * for wildcard")
  .requiredOption("--usage-kind <kind>", "usage kind")
  .requiredOption("--unit-type <unit>", "priced unit type")
  .requiredOption("--price <amount>", "price amount for the --per unit count")
  .option("--per <count>", "unit count represented by --price", "1")
  .option("--currency <code>", "ISO currency code", "USD")
  .option("--effective-from <iso>", "UTC ISO timestamp when this rule takes effect")
  .option("--source-snapshot-id <id>", "pricing source snapshot id")
  .option("--source <source>", "pricing source", "manual")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("Create or update an active pricing rule")
  .action(async (options: PricingUpsertOptions) => {
    const handle = await makeLedgerLocal();
    try {
      const service = requireLocalLedger(handle);
      const rule = await service.upsertPricingRule({
        workspace: workspaceResolver(options),
        sourceSnapshotId: options.sourceSnapshotId,
        provider: options.provider,
        model: options.model,
        usageKind: options.usageKind,
        unitType: options.unitType,
        priceNanosPerUnit: priceNanosPerUnit(options.price, options.per),
        currency: options.currency,
        effectiveFrom: options.effectiveFrom,
        source: options.source,
      });
      console.log(
        `pricing ${rule.provider}/${rule.model} ${rule.usage_kind} ${rule.unit_type} ${rule.price_nanos_per_unit} nanos ${rule.currency}`,
      );
    } finally {
      await handle.close();
    }
  });

pricing
  .command("list")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("List active pricing rules")
  .action(async (options: { workspace?: string; root?: string }) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      for (const rule of await handle.ledger.listPricingRules({ workspace: workspaceResolver(options) })) {
        console.log(
          [
            rule.provider,
            rule.model,
            rule.usage_kind,
            rule.unit_type,
            `nanos=${rule.price_nanos_per_unit}`,
            rule.currency,
            `from=${rule.effective_from}`,
            rule.source_snapshot_id ? `snapshot=${rule.source_snapshot_id}` : "",
          ]
            .filter(Boolean)
            .join("\t"),
        );
      }
    } finally {
      await handle.close();
    }
  });

pricing
  .command("reprice")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--limit <count>", "maximum unpriced events to check", "100")
  .description("Apply active pricing rules to unpriced usage events")
  .action(async (options: PricingRepriceOptions) => {
    const handle = await makeLedgerLocal();
    try {
      const service = requireLocalLedger(handle);
      const result = await service.repriceUnpricedUsage({
        workspace: workspaceResolver(options),
        limit: parsePositiveInteger(options.limit),
      });
      console.log(
        `reprice checked=${result.checked} repriced=${result.repriced} still_unpriced=${result.still_unpriced}`,
      );
    } finally {
      await handle.close();
    }
  });

pricing
  .command("migrate-events")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--limit <count>", "maximum events to migrate", "100")
  .option("--mode <mode>", "unpriced or repriceable", "repriceable")
  .description("Recalculate existing usage event pricing from active rules")
  .action(async (options: PricingMigrateEventsOptions) => {
    const handle = await makeLedgerLocal();
    try {
      const service = requireLocalLedger(handle);
      const result = await service.migrateUsageEventPricing({
        workspace: workspaceResolver(options),
        limit: parsePositiveInteger(options.limit),
        mode: parsePricingMigrationMode(options.mode),
      });
      console.log(
        `pricing migrate-events checked=${result.checked} migrated=${result.migrated} unchanged=${result.unchanged} still_unpriced=${result.still_unpriced}`,
      );
    } finally {
      await handle.close();
    }
  });

const report = program.command("report").description("Report commands");

report
  .command("today")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--date <yyyy-mm-dd>", "UTC date")
  .description("Show today's workspace cost summary")
  .action(async (options: { workspace?: string; root?: string; date?: string }) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      printReport(await handle.ledger.reportToday({ workspace: workspaceResolver(options), date: options.date }));
    } finally {
      await handle.close();
    }
  });

report
  .command("task")
  .argument("<key>", "task key")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("Show task cost summary")
  .action(async (key: string, options: { workspace?: string; root?: string }) => {
    const handle = await makeLedger({ makeLocalService });
    try {
      printReport(await handle.ledger.reportTask({ workspace: workspaceResolver(options), taskKey: slug(key) }));
    } finally {
      await handle.close();
    }
  });

const hook = program.command("hook").description("Claude Code hook integration");
hook
  .command("run")
  .description("Autocapture: import this project's Claude Code session usage")
  .option("--workspace <key>", "workspace key")
  .option("--projects-dir <path>", "Claude Code project dir (overrides stdin; for manual runs)")
  .action(async (options: { workspace?: string; projectsDir?: string }) => {
    const projectsDir = options.projectsDir ?? (await projectsDirFromStdin());
    if (!projectsDir) {
      console.error(
        "ttoksem hook run: no project dir (no --projects-dir and no hook stdin payload)",
      );
      process.exitCode = 1;
      return;
    }
    const workspace = resolveWorkspaceKeyFromOptions(options);
    if (!workspace) {
      throw new Error(
        "hook run could not determine a workspace. Pass --workspace <key>, set TTOKSEM_WORKSPACE_KEY, or add ttoksem.config.json with {\"workspace\": \"<key>\"}.",
      );
    }
    const handle = await makeLedgerLocal();
    try {
      const service = handle.ledger;
      const lastImportedAt = await service.getLastImportedAt({
        workspace: { key: workspace },
        source: "claude-session",
      });
      // Advance one millisecond past the last imported event so the `< since`
      // filter in parseClaudeSessionUsage excludes it on re-run (incremental import).
      // getLastImportedAt returns string|null; the option field is string|undefined.
      //
      // Known limitation: `since` is workspace-scoped (MAX occurred_at across the whole
      // workspace), not project-scoped. This is fine for the single-project onboarding
      // case; if multiple Claude Code projects share one workspace, a project whose most
      // recent event predates another project's high-water-mark could have events missed
      // by the since-filter. The DB-layer idempotency key still prevents true duplicates.
      const since = lastImportedAt
        ? new Date(Date.parse(lastImportedAt) + 1).toISOString()
        : undefined;
      const importOptions: ClaudeSessionImportOptions = {
        workspace,
        task: process.env.TTOKSEM_TASK || undefined,
        projectsDir,
        claudeHome: process.env.CLAUDE_HOME ?? "~/.claude",
        model: "claude-app",
        promptMode: "full",
        subagents: true,
        since,
      };
      const result = await importClaudeSessions(service, importOptions);
      console.log(
        `ttoksem hook run imported=${result.imported} skipped=${result.skipped} errors=${result.errors}`,
      );
    } finally {
      await handle.close();
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(formatCliError(error));
  process.exitCode = 1;
});

interface UsageAddOptions {
  file?: string;
  workspace?: string;
  task?: string;
  runId?: string;
  provider?: string;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: string;
  inputTokens?: string;
  outputTokens?: string;
  observedCost?: string;
  estimatedCost?: string;
  currency?: string;
  idempotencyKey?: string;
}

interface UsageMoveOptions {
  task: string;
  workspace?: string;
  root?: string;
}

type PromptMode = "none" | "hash" | "redacted" | "full";

interface CodexTurnOptions {
  workspace?: string;
  task?: string;
  runId?: string;
  model: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: string;
  inputTokens?: string;
  outputTokens?: string;
  inputChars?: string;
  outputChars?: string;
  promptText?: string;
  responseText?: string;
  promptFile?: string;
  responseFile?: string;
  promptMode: PromptMode;
  idempotencyKey?: string;
}

interface CodexSessionImportOptions {
  workspace?: string;
  task?: string;
  file?: string;
  sessionsDir?: string;
  codexHome: string;
  threadId?: string;
  since?: string;
  model: string;
  promptMode: PromptMode;
  limit?: string;
  dryRun?: boolean;
}

interface ClaudeTurnOptions {
  workspace?: string;
  task?: string;
  runId?: string;
  model: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: string;
  inputTokens?: string;
  outputTokens?: string;
  inputChars?: string;
  outputChars?: string;
  promptText?: string;
  responseText?: string;
  promptFile?: string;
  responseFile?: string;
  promptMode: PromptMode;
  idempotencyKey?: string;
}

interface ClaudeSessionImportOptions {
  workspace?: string;
  task?: string;
  file?: string;
  projectsDir?: string;
  claudeHome: string;
  threadId?: string;
  since?: string;
  model: string;
  promptMode: PromptMode;
  limit?: string;
  dryRun?: boolean;
  subagents: boolean;
}

interface OpenAiResponseOptions {
  file: string;
  workspace: string;
  task?: string;
  runId?: string;
  model?: string;
  operation: string;
  occurredAt?: string;
  observedCost?: string;
  currency: string;
  idempotencyKey?: string;
}

interface AnthropicResponseOptions {
  file: string;
  workspace: string;
  task?: string;
  runId?: string;
  model?: string;
  operation: string;
  occurredAt?: string;
  observedCost?: string;
  currency: string;
  idempotencyKey?: string;
}

interface InboxListOptions {
  workspace?: string;
  root?: string;
  limit: string;
  events?: boolean;
}

interface InboxShowOptions {
  workspace?: string;
  root?: string;
  limit: string;
}

interface InboxAssignOptions {
  workspace?: string;
  root?: string;
  task: string;
  all?: boolean;
}

interface InboxAcceptOptions {
  workspace?: string;
  root?: string;
  all?: boolean;
}

interface InboxAssignEventOptions {
  workspace?: string;
  root?: string;
  task: string;
}

interface DashboardServeOptions {
  workspace?: string;
  host: string;
  port: string;
  auth: string;
  createKeyName: string;
  unsafeNoAuth?: boolean;
}

interface DashboardOverviewOptions {
  workspace?: string;
  root?: string;
  taskLimit: string;
  recentLimit: string;
  dayLimit: string;
}

interface TaskUpdateOptions {
  name?: string;
  description?: string;
  clearDescription?: boolean;
  workspace?: string;
  root?: string;
}

interface PricingUpsertOptions {
  provider: string;
  model: string;
  usageKind: string;
  unitType: string;
  price: string;
  per: string;
  currency: string;
  effectiveFrom?: string;
  sourceSnapshotId?: string;
  source: string;
  workspace?: string;
  root?: string;
}

interface PricingImportLiteLlmOptions {
  sourceSnapshotId: string;
  file?: string;
  workspace?: string;
  root?: string;
  provider?: string;
  model?: string;
  effectiveFrom?: string;
  limit?: string;
}

interface PricingSnapshotUpsertOptions {
  id?: string;
  sourceName: string;
  sourceUrl?: string;
  sourceVersion?: string;
  sourceCommit?: string;
  sourceRetrievedAt?: string;
  bundledAt?: string;
  validFrom?: string;
  rawSha256: string;
  rawStorageRef?: string;
  metadata?: string;
}

interface PricingRepriceOptions {
  workspace?: string;
  root?: string;
  limit: string;
}

interface PricingMigrateEventsOptions {
  workspace?: string;
  root?: string;
  limit: string;
  mode: string;
}

async function makeService(opts: { allowCreate?: boolean } = {}): Promise<{
  service: LedgerService;
  dbPath: string;
  close: () => Promise<void>;
}> {
  const dbPath = resolveDbPath(opts.allowCreate ?? false);
  if (opts.allowCreate) mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteLedgerStore(dbPath);
  return {
    service: new LedgerService({ store }),
    dbPath,
    close: () => store.close(),
  };
}

// Resolve which SQLite ledger to open. Order:
// 1. TTOKSEM_DB env var — explicit override always wins.
// 2. Walk up from INIT_CWD/cwd looking for an existing .ttoksem/ttoksem.db,
//    so running the CLI from any subdir (or accidentally one level up of the
//    repo) still hits the same workspace ledger.
// 3. If nothing found and allowCreate is false (every command except
//    `workspace init`), refuse rather than silently spawning a fresh empty
//    DB at cwd — that's how data ended up split across two files.
// 4. If allowCreate is true, fall back to cwd/.ttoksem/ttoksem.db.
function resolveDbPath(allowCreate: boolean): string {
  if (process.env.TTOKSEM_DB) return resolve(process.env.TTOKSEM_DB);

  const startDir = process.env.INIT_CWD ?? process.cwd();
  const found = findExistingDbUpwards(startDir);
  if (found) return found;

  if (allowCreate) return resolve(startDir, ".ttoksem/ttoksem.db");

  throw new Error(
    `No .ttoksem/ttoksem.db found in any ancestor of ${startDir}. ` +
      `Run 'ttoksem workspace init' from your repo root to create one, or set TTOKSEM_DB to an absolute path.`,
  );
}

function findExistingDbUpwards(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".ttoksem", "ttoksem.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let closing = false;
    const keepAlive = setInterval(() => {}, 2_147_483_647);
    const shutdown = () => {
      if (closing) return;
      closing = true;
      clearInterval(keepAlive);
      close().then(resolve, reject);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function workspaceResolver(options: { workspace?: string; root?: string }) {
  return {
    key: resolveWorkspaceKeyFromOptions(options),
    rootPath: resolveFromCommandCwd(options.root ?? "."),
  };
}

/** Flag > ttoksem.config.json > TTOKSEM_WORKSPACE_KEY env var. */
function resolveWorkspaceKeyFromOptions(options: { workspace?: string }): string | undefined {
  return resolveWorkspaceKey({
    flag: options.workspace,
    config: getProjectConfig()?.config,
    env: process.env.TTOKSEM_WORKSPACE_KEY,
  });
}

function resolveFromCommandCwd(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

function readMessage(path: string): AiUsageObserved {
  return AiUsageObservedSchema.parse(JSON.parse(readFileSync(resolve(path), "utf8")));
}

function readJsonRecord(path: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
  if (!isRecord(value)) throw new Error(`JSON file must contain an object: ${path}`);
  return value;
}

function buildUsageMessage(options: UsageAddOptions): AiUsageObserved {
  if (!options.workspace) throw new Error("--workspace is required without --file");
  if (!options.provider) throw new Error("--provider is required without --file");
  if (!options.model) throw new Error("--model is required without --file");
  const observedCost = parseOptionalNumber(options.observedCost);
  const estimatedCost = parseOptionalNumber(options.estimatedCost);
  return AiUsageObservedSchema.parse({
    schema_version: "1.0",
    message_id: `msg_${Date.now()}`,
    kind: "ingest_message",
    type: "ai.usage.observed",
    occurred_at: new Date().toISOString(),
    source: { system: "cli", actor: "local:user" },
    workspace: { key: options.workspace },
    idempotency_key: options.idempotencyKey,
    payload: {
      task: options.task ? { key: slug(options.task) } : null,
      run: runRef(options),
      usage: {
        provider: options.provider,
        model: options.model,
        usage_kind: "chat_completion",
        started_at: options.startedAt ?? null,
        ended_at: options.endedAt ?? null,
        duration_ms: parseOptionalInteger(options.durationMs),
        input_tokens: parseOptionalInteger(options.inputTokens),
        output_tokens: parseOptionalInteger(options.outputTokens),
        observed_cost: observedCost,
        observed_currency: observedCost == null ? null : options.currency,
        estimated_cost: estimatedCost,
        estimated_currency: estimatedCost == null ? null : options.currency,
        accuracy_mode: observedCost == null ? "manual" : "exact",
        pricing_mode:
          observedCost != null ? "provider_reported" : estimatedCost != null ? "manual" : "unpriced",
        unpriced_reason: observedCost == null && estimatedCost == null ? "missing_pricing_rule" : null,
      },
      source_context: { tool: "ttoksem-cli" },
    },
  });
}

function buildCodexTurnMessage(options: CodexTurnOptions): AiUsageObserved {
  const promptMode = parsePromptMode(options.promptMode);
  const promptText = readOptionalText(options.promptText, options.promptFile);
  const responseText = readOptionalText(options.responseText, options.responseFile);
  const promptSnapshot = buildPromptSnapshot({
    mode: promptMode,
    promptText,
    responseText,
  });
  const inputEstimate = estimateTokenCount({
    tokens: options.inputTokens,
    chars: options.inputChars,
    text: promptText,
    scope: "user_prompt_only",
    textSource: "prompt_text",
    charsSource: "input_chars_option",
    tokensSource: "input_tokens_option",
  });
  const outputEstimate = estimateTokenCount({
    tokens: options.outputTokens,
    chars: options.outputChars,
    text: responseText,
    scope: "assistant_response_text",
    textSource: "response_text",
    charsSource: "output_chars_option",
    tokensSource: "output_tokens_option",
  });
  const inputTokens = inputEstimate.tokens;
  const outputTokens = outputEstimate.tokens;
  const totalTokens =
    inputTokens == null && outputTokens == null ? null : (inputTokens ?? 0) + (outputTokens ?? 0);
  const accuracyMode = tokenAccuracyMode(inputEstimate.mode, outputEstimate.mode);
  return AiUsageObservedSchema.parse({
    schema_version: "1.0",
    message_id: `msg_codex_${Date.now()}`,
    kind: "ingest_message",
    type: "ai.usage.observed",
    occurred_at: new Date().toISOString(),
    source: { system: "codex-chat", actor: "assistant:auto-log" },
    workspace: { key: options.workspace },
    idempotency_key: options.idempotencyKey,
    payload: {
      task: options.task ? { key: slug(options.task) } : null,
      run: runRef(options),
      usage: {
        provider: "openai",
        model: options.model,
        usage_kind: "conversation_turn",
        started_at: options.startedAt ?? null,
        ended_at: options.endedAt ?? null,
        duration_ms: parseOptionalInteger(options.durationMs),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        accuracy_mode: accuracyMode,
        pricing_mode: "unpriced",
        unpriced_reason: "missing_pricing_rule",
      },
      prompt_snapshot: promptSnapshot.snapshot,
      source_context: {
        tool: "codex-chat",
        capture_mode: "assistant_estimated_turn",
        token_estimation: {
          input: inputEstimate.context,
          output: outputEstimate.context,
          total_tokens: totalTokens,
        },
      },
    },
  });
}

async function importCodexSessions(
  service: Ledger,
  options: CodexSessionImportOptions,
): Promise<{ scannedFiles: number; tokenEvents: number; imported: number; skipped: number; errors: number }> {
  const files = codexSessionFiles(options);
  parsePromptMode(options.promptMode);
  const limit = options.limit ? parsePositiveInteger(options.limit) : Number.POSITIVE_INFINITY;
  const sinceMs = options.since ? Date.parse(options.since) : null;
  if (sinceMs != null && !Number.isFinite(sinceMs)) throw new Error(`Invalid --since timestamp: ${options.since}`);

  const allMessages: AiUsageObserved[] = [];
  for (const file of files) {
    const messages = parseCodexSessionUsage(file, options, sinceMs);
    allMessages.push(...messages);
  }
  const limited = Number.isFinite(limit) ? allMessages.slice(0, limit) : allMessages;

  const preview = analyzeImport(limited, files.length);
  printImportPreview(preview, "codex import");
  warnMultiPromptGroup(preview, options.task, "codex import");

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  for (const message of limited) {
    if (options.dryRun) {
      skipped += 1;
      continue;
    }
    try {
      await service.recordUsage(message);
      imported += 1;
    } catch (error) {
      errors += 1;
      console.error(
        `codex import error idempotency=${message.idempotency_key ?? ""} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { scannedFiles: files.length, tokenEvents: limited.length, imported, skipped, errors };
}

function codexSessionFiles(options: CodexSessionImportOptions): string[] {
  if (options.file) return [resolveImportPath(options.file)];
  const codexHome = resolveImportPath(options.codexHome);
  const sessionsDir = options.sessionsDir ? resolveImportPath(options.sessionsDir) : join(codexHome, "sessions");
  if (!existsSync(sessionsDir)) throw new Error(`Codex sessions directory not found: ${sessionsDir}`);
  return collectJsonlFiles(sessionsDir).sort();
}

function collectJsonlFiles(root: string): string[] {
  const stat = statSync(root);
  if (stat.isFile()) return root.endsWith(".jsonl") ? [root] : [];
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const entryStat = statSync(path);
    if (entryStat.isDirectory()) {
      files.push(...collectJsonlFiles(path));
    } else if (entryStat.isFile() && path.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}

function parseCodexSessionUsage(
  file: string,
  options: CodexSessionImportOptions,
  sinceMs: number | null,
): AiUsageObserved[] {
  let session: CodexSessionMeta | null = null;
  let promptGroup: CodexPromptGroup = emptyCodexPromptGroup();
  const messages: AiUsageObserved[] = [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const item = JSON.parse(line) as unknown;
    if (!isRecord(item)) continue;
    const payload = isRecord(item.payload) ? item.payload : null;
    if (item.type === "session_meta" && payload) {
      session = codexSessionMeta(payload, file);
      continue;
    }
    if (item.type === "event_msg" && payload?.type === "user_message") {
      promptGroup = nextCodexPromptGroup(promptGroup, stringField(payload.message), stringField(item.timestamp));
      continue;
    }
    if (!session || item.type !== "event_msg" || !payload || payload.type !== "token_count") continue;
    if (options.threadId && session.id !== options.threadId) continue;
    const timestamp = typeof item.timestamp === "string" ? item.timestamp : null;
    if (!timestamp) continue;
    const occurredMs = Date.parse(timestamp);
    if (!Number.isFinite(occurredMs)) continue;
    if (sinceMs != null && occurredMs < sinceMs) continue;
    const info = isRecord(payload.info) ? payload.info : null;
    const usage = isRecord(info?.last_token_usage) ? tokenUsage(info.last_token_usage) : null;
    if (!usage) continue;
    messages.push(buildCodexSessionUsageMessage({ session, usage, timestamp, promptGroup, options }));
  }
  return messages;
}

function buildCodexSessionUsageMessage(input: {
  session: CodexSessionMeta;
  usage: CodexTokenUsage;
  timestamp: string;
  promptGroup: CodexPromptGroup;
  options: CodexSessionImportOptions;
}): AiUsageObserved {
  const model = input.session.model ?? input.options.model;
  const idempotencyKey = `codex-session:${input.session.id}:${input.timestamp}`;
  const runId = codexPromptRunId(input.session, input.promptGroup);
  const promptSnapshot = buildPromptSnapshot({
    mode: input.options.promptMode,
    promptText: input.promptGroup.promptText,
  });
  return AiUsageObservedSchema.parse({
    schema_version: "1.0",
    message_id: `msg_${slug(idempotencyKey)}`,
    kind: "ingest_message",
    type: "ai.usage.observed",
    occurred_at: input.timestamp,
    source: { system: "codex-session", actor: "codex-local-import" },
    workspace: { key: input.options.workspace },
    idempotency_key: idempotencyKey,
    payload: {
      task: input.options.task ? { key: slug(input.options.task) } : null,
      run: {
        id: runId,
        external_ref: {
          system: "codex-session-prompt",
          id: `${input.session.id}:${input.promptGroup.index}`,
          prompt_hash: input.promptGroup.promptHash,
          started_at: input.promptGroup.startedAt,
        },
      },
      usage: {
        provider: input.session.modelProvider ?? "openai",
        model,
        usage_kind: "conversation_turn",
        started_at: input.promptGroup.startedAt ?? input.timestamp,
        input_tokens: input.usage.inputTokens,
        output_tokens: input.usage.outputTokens,
        cached_input_tokens: input.usage.cachedInputTokens,
        reasoning_output_tokens: input.usage.reasoningOutputTokens,
        total_tokens: input.usage.totalTokens,
        accuracy_mode: "exact",
        pricing_mode: "unpriced",
        unpriced_reason: "missing_pricing_rule",
        raw_usage: input.usage.raw,
      },
      prompt_snapshot: promptSnapshot.snapshot,
      source_context: {
        tool: "codex",
        capture_mode: "codex_session_token_count",
        user_message: promptSnapshot.contextPromptText,
        prompt_group: {
          index: input.promptGroup.index,
          prompt_hash: input.promptGroup.promptHash,
          started_at: input.promptGroup.startedAt,
        },
        session: {
          id: input.session.id,
          cwd: input.session.cwd,
          source: input.session.source,
          originator: input.session.originator,
          cli_version: input.session.cliVersion,
          file: input.session.file,
        },
        token_usage: input.usage.raw,
      },
    },
  });
}

interface CodexSessionMeta {
  id: string;
  cwd: string | null;
  source: string | null;
  originator: string | null;
  cliVersion: string | null;
  modelProvider: string | null;
  model: string | null;
  file: string;
}

interface CodexTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  raw: Record<string, unknown>;
}

interface CodexPromptGroup {
  index: number;
  promptText: string | null;
  promptHash: string;
  startedAt: string | null;
}

function emptyCodexPromptGroup(): CodexPromptGroup {
  return {
    index: 0,
    promptText: null,
    promptHash: "no-prompt",
    startedAt: null,
  };
}

function nextCodexPromptGroup(
  previous: CodexPromptGroup,
  promptText: string | null,
  startedAt: string | null,
): CodexPromptGroup {
  return {
    index: previous.index + 1,
    promptText,
    promptHash: promptText ? createHash("sha256").update(promptText, "utf8").digest("hex").slice(0, 12) : "no-prompt",
    startedAt,
  };
}

function codexPromptRunId(session: CodexSessionMeta, promptGroup: CodexPromptGroup): string {
  const sessionId = session.id.replace(/[^a-zA-Z0-9]/g, "_");
  const groupIndex = String(promptGroup.index).padStart(4, "0");
  return `run_codex_${sessionId}_prompt_${groupIndex}_${promptGroup.promptHash}`;
}

function codexSessionMeta(payload: Record<string, unknown>, file: string): CodexSessionMeta {
  const id = stringField(payload.id) ?? sessionIdFromPath(file);
  if (!id) throw new Error(`Codex session id not found: ${file}`);
  return {
    id,
    cwd: stringField(payload.cwd),
    source: stringField(payload.source),
    originator: stringField(payload.originator),
    cliVersion: stringField(payload.cli_version),
    modelProvider: stringField(payload.model_provider),
    model: stringField(payload.model),
    file,
  };
}

function tokenUsage(raw: Record<string, unknown>): CodexTokenUsage | null {
  const inputTokens = numberField(raw.input_tokens);
  const outputTokens = numberField(raw.output_tokens);
  const cachedInputTokens = numberField(raw.cached_input_tokens);
  const reasoningOutputTokens = numberField(raw.reasoning_output_tokens);
  const totalTokens = numberField(raw.total_tokens);
  if (inputTokens == null && outputTokens == null && totalTokens == null) return null;
  return { inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens, totalTokens, raw };
}

interface ImportPreview {
  scannedFiles: number;
  totalEvents: number;
  promptGroups: number;
  distinctPromptHashes: number;
  timeRange: { start: string | null; end: string | null };
  modelCounts: Map<string, number>;
  tokensTotal: number;
  groups: ImportPreviewGroup[];
}

interface ImportPreviewGroup {
  index: number;
  runId: string;
  promptHash: string;
  promptText: string | null;
  events: number;
  firstAt: string;
  lastAt: string;
  models: Set<string>;
  tokens: number;
}

function analyzeImport(messages: AiUsageObserved[], scannedFiles: number): ImportPreview {
  const groupsByRunId = new Map<string, ImportPreviewGroup>();
  const modelCounts = new Map<string, number>();
  const promptHashes = new Set<string>();
  let totalTokens = 0;
  let minAt: string | null = null;
  let maxAt: string | null = null;

  for (const message of messages) {
    const payload = (message as { payload?: Record<string, unknown> }).payload ?? {};
    const occurredAt = (message as { occurred_at?: string }).occurred_at ?? "";
    const run = isRecord(payload.run) ? payload.run : null;
    const sourceContext = isRecord(payload.source_context) ? payload.source_context : null;
    const promptGroupRecord = sourceContext && isRecord(sourceContext.prompt_group) ? sourceContext.prompt_group : null;
    const usage = isRecord(payload.usage) ? payload.usage : null;
    const runId = stringField(run?.id) ?? "no_run";
    const promptHash = stringField(promptGroupRecord?.prompt_hash) ?? "no-hash";
    const groupIndex = numberField(promptGroupRecord?.index) ?? 0;
    const promptText = stringField(sourceContext?.user_message);
    const model = stringField(usage?.model) ?? "unknown";
    const inputTok = numberField(usage?.input_tokens) ?? 0;
    const outputTok = numberField(usage?.output_tokens) ?? 0;
    const cachedTok = numberField(usage?.cached_input_tokens) ?? 0;
    const cacheWriteTok = numberField(usage?.cache_write_input_tokens) ?? 0;
    const reasoningTok = numberField(usage?.reasoning_output_tokens) ?? 0;
    const totalRaw = numberField(usage?.total_tokens);
    const eventTokens = totalRaw ?? inputTok + outputTok + cachedTok + cacheWriteTok + reasoningTok;

    promptHashes.add(promptHash);
    totalTokens += eventTokens;
    modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    if (occurredAt && (!minAt || occurredAt < minAt)) minAt = occurredAt;
    if (occurredAt && (!maxAt || occurredAt > maxAt)) maxAt = occurredAt;

    let group = groupsByRunId.get(runId);
    if (!group) {
      group = {
        index: groupIndex,
        runId,
        promptHash,
        promptText,
        events: 0,
        firstAt: occurredAt,
        lastAt: occurredAt,
        models: new Set(),
        tokens: 0,
      };
      groupsByRunId.set(runId, group);
    }
    group.events += 1;
    if (occurredAt && (!group.firstAt || occurredAt < group.firstAt)) group.firstAt = occurredAt;
    if (occurredAt && occurredAt > group.lastAt) group.lastAt = occurredAt;
    group.models.add(model);
    group.tokens += eventTokens;
    if (!group.promptText && promptText) group.promptText = promptText;
  }

  const groups = Array.from(groupsByRunId.values()).sort((a, b) => a.index - b.index);

  return {
    scannedFiles,
    totalEvents: messages.length,
    promptGroups: groupsByRunId.size,
    distinctPromptHashes: promptHashes.size,
    timeRange: { start: minAt, end: maxAt },
    modelCounts,
    tokensTotal: totalTokens,
    groups,
  };
}

function printImportPreview(preview: ImportPreview, label: string): void {
  const models = Array.from(preview.modelCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, c]) => `${m}:${c}`)
    .join(",");
  console.error(`${label} preview:`);
  console.error(`  scanned_files=${preview.scannedFiles}`);
  console.error(`  events=${preview.totalEvents}`);
  console.error(`  prompt_groups=${preview.promptGroups}`);
  console.error(`  distinct_prompt_hashes=${preview.distinctPromptHashes}`);
  console.error(`  models=${models || "none"}`);
  console.error(`  time_range=${preview.timeRange.start ?? "?"}..${preview.timeRange.end ?? "?"}`);
  console.error(`  tokens_total=${preview.tokensTotal}`);
  if (preview.groups.length === 0) return;
  console.error(`prompt groups:`);
  for (const group of preview.groups) {
    const idxStr = String(group.index).padStart(4, "0");
    const promptSnippet = group.promptText
      ? truncatePromptText(group.promptText.replace(/\s+/g, " "), 80)
      : "(no prompt)";
    const modelList = Array.from(group.models).sort().join(",");
    console.error(
      `  [${idxStr}] hash=${group.promptHash} events=${group.events} tokens=${group.tokens} models=${modelList} prompt=${JSON.stringify(promptSnippet)}`,
    );
  }
}

function warnMultiPromptGroup(
  preview: ImportPreview,
  taskKey: string | undefined,
  label: string,
): void {
  if (!taskKey || preview.promptGroups <= 1) return;
  const samples = preview.groups
    .slice(0, 3)
    .map((group) => {
      const idxStr = String(group.index).padStart(4, "0");
      const promptSnippet = group.promptText
        ? truncatePromptText(group.promptText.replace(/\s+/g, " "), 60)
        : "(no prompt)";
      return `  [${idxStr}] ${promptSnippet}`;
    })
    .join("\n");
  const moreNote =
    preview.groups.length > 3 ? `\n  ... ${preview.groups.length - 3} more group(s)` : "";
  console.error(
    `${label} warning: --task ${taskKey} was passed with ${preview.promptGroups} distinct prompt groups. ` +
      `All events will be assigned to ${taskKey}; if this import covers multiple goals, ` +
      `move the wrong ones with \`pnpm cli usage move <usage_id> --task <key>\` or ` +
      `\`pnpm cli inbox assign-event <usage_id> --task <key>\` after the fact.\n` +
      `Sample groups:\n${samples}${moreNote}`,
  );
}

function truncatePromptText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildClaudeTurnMessage(options: ClaudeTurnOptions): AiUsageObserved {
  const promptMode = parsePromptMode(options.promptMode);
  const promptText = readOptionalText(options.promptText, options.promptFile);
  const responseText = readOptionalText(options.responseText, options.responseFile);
  const promptSnapshot = buildPromptSnapshot({
    mode: promptMode,
    promptText,
    responseText,
  });
  const inputEstimate = estimateTokenCount({
    tokens: options.inputTokens,
    chars: options.inputChars,
    text: promptText,
    scope: "user_prompt_only",
    textSource: "prompt_text",
    charsSource: "input_chars_option",
    tokensSource: "input_tokens_option",
  });
  const outputEstimate = estimateTokenCount({
    tokens: options.outputTokens,
    chars: options.outputChars,
    text: responseText,
    scope: "assistant_response_text",
    textSource: "response_text",
    charsSource: "output_chars_option",
    tokensSource: "output_tokens_option",
  });
  const inputTokens = inputEstimate.tokens;
  const outputTokens = outputEstimate.tokens;
  const totalTokens =
    inputTokens == null && outputTokens == null ? null : (inputTokens ?? 0) + (outputTokens ?? 0);
  const accuracyMode = tokenAccuracyMode(inputEstimate.mode, outputEstimate.mode);
  return AiUsageObservedSchema.parse({
    schema_version: "1.0",
    message_id: `msg_claude_${Date.now()}`,
    kind: "ingest_message",
    type: "ai.usage.observed",
    occurred_at: new Date().toISOString(),
    source: { system: "claude-chat", actor: "assistant:auto-log" },
    workspace: { key: options.workspace },
    idempotency_key: options.idempotencyKey,
    payload: {
      task: options.task ? { key: slug(options.task) } : null,
      run: runRef(options),
      usage: {
        provider: "anthropic",
        model: options.model,
        usage_kind: "conversation_turn",
        started_at: options.startedAt ?? null,
        ended_at: options.endedAt ?? null,
        duration_ms: parseOptionalInteger(options.durationMs),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        accuracy_mode: accuracyMode,
        pricing_mode: "unpriced",
        unpriced_reason: "missing_pricing_rule",
      },
      prompt_snapshot: promptSnapshot.snapshot,
      source_context: {
        tool: "claude-chat",
        capture_mode: "assistant_estimated_turn",
        token_estimation: {
          input: inputEstimate.context,
          output: outputEstimate.context,
          total_tokens: totalTokens,
        },
      },
    },
  });
}

async function importClaudeSessions(
  service: Ledger,
  options: ClaudeSessionImportOptions,
): Promise<{ scannedFiles: number; assistantEvents: number; imported: number; skipped: number; errors: number }> {
  const files = claudeSessionFiles(options);
  parsePromptMode(options.promptMode);
  const limit = options.limit ? parsePositiveInteger(options.limit) : Number.POSITIVE_INFINITY;
  const sinceMs = options.since ? Date.parse(options.since) : null;
  if (sinceMs != null && !Number.isFinite(sinceMs)) throw new Error(`Invalid --since timestamp: ${options.since}`);

  const allMessages: AiUsageObserved[] = [];
  for (const file of files) {
    const messages = parseClaudeSessionUsage(file, options, sinceMs);
    allMessages.push(...messages);
  }
  const limited = Number.isFinite(limit) ? allMessages.slice(0, limit) : allMessages;

  const preview = analyzeImport(limited, files.length);
  printImportPreview(preview, "claude import");
  warnMultiPromptGroup(preview, options.task, "claude import");

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  for (const message of limited) {
    if (options.dryRun) {
      skipped += 1;
      continue;
    }
    try {
      await service.recordUsage(message);
      imported += 1;
    } catch (error) {
      errors += 1;
      console.error(
        `claude import error idempotency=${message.idempotency_key ?? ""} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { scannedFiles: files.length, assistantEvents: limited.length, imported, skipped, errors };
}

function claudeSessionFiles(options: ClaudeSessionImportOptions): string[] {
  if (options.file) return [resolveImportPath(options.file)];
  const claudeHome = resolveImportPath(options.claudeHome);
  const projectsDir = options.projectsDir ? resolveImportPath(options.projectsDir) : join(claudeHome, "projects");
  if (!existsSync(projectsDir)) throw new Error(`Claude projects directory not found: ${projectsDir}`);
  const files = collectJsonlFiles(projectsDir);
  const filtered = options.subagents
    ? files
    : files.filter((path) => !path.includes(`${"/"}subagents${"/"}`));
  return filtered.sort();
}

function parseClaudeSessionUsage(
  file: string,
  options: ClaudeSessionImportOptions,
  sinceMs: number | null,
): AiUsageObserved[] {
  let session: ClaudeSessionMeta | null = null;
  let promptGroup: ClaudeSessionPromptGroup = emptyClaudePromptGroup();
  const messages: AiUsageObserved[] = [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let item: unknown;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(item)) continue;
    session = updateClaudeSessionMeta(session, item, file);
    if (item.type === "user") {
      const text = claudeUserPromptText(item);
      if (text != null) {
        promptGroup = nextClaudePromptGroup(promptGroup, text, stringField(item.timestamp));
      }
      continue;
    }
    if (item.type !== "assistant") continue;
    if (options.threadId && session?.id !== options.threadId) continue;
    const message = isRecord(item.message) ? item.message : null;
    const usageRaw = message && isRecord(message.usage) ? message.usage : null;
    if (!usageRaw) continue;
    const timestamp = stringField(item.timestamp);
    if (!timestamp) continue;
    const occurredMs = Date.parse(timestamp);
    if (!Number.isFinite(occurredMs)) continue;
    if (sinceMs != null && occurredMs < sinceMs) continue;
    const usage = claudeTokenUsage(usageRaw);
    if (!usage) continue;
    if (!session) session = fallbackClaudeSessionMeta(item, file);
    const eventUuid = stringField(item.uuid) ?? `${session.id}:${timestamp}`;
    const messageId = stringField(message?.id);
    const requestId = stringField(item.requestId);
    const model = stringField(message?.model) ?? session.model ?? options.model;
    // Summarize the assistant content blocks (text/tool_use/thinking) so the
    // ledger captures *what was done*, not just how many tokens it cost.
    // Stored in source_context.assistant_summary; the dashboard reads it
    // directly without having to re-open the JSONL.
    const assistantSummary = summarizeClaudeAssistantContent(message?.content);
    messages.push(
      buildClaudeSessionUsageMessage({
        session: { ...session, model },
        usage,
        timestamp,
        promptGroup,
        options,
        eventUuid,
        messageId,
        requestId,
        assistantSummary,
      }),
    );
  }
  return messages;
}

function buildClaudeSessionUsageMessage(input: {
  session: ClaudeSessionMeta;
  usage: ClaudeTokenUsage;
  timestamp: string;
  promptGroup: ClaudeSessionPromptGroup;
  options: ClaudeSessionImportOptions;
  eventUuid: string;
  messageId: string | null;
  requestId: string | null;
  assistantSummary: ClaudeAssistantSummary;
}): AiUsageObserved {
  const idempotencyKey = `claude-session:${input.session.id}:${input.eventUuid}`;
  const runId = claudePromptRunId(input.session, input.promptGroup);
  const promptSnapshot = buildPromptSnapshot({
    mode: input.options.promptMode,
    promptText: input.promptGroup.promptText,
  });
  return AiUsageObservedSchema.parse({
    schema_version: "1.0",
    message_id: `msg_${slug(idempotencyKey)}`,
    kind: "ingest_message",
    type: "ai.usage.observed",
    occurred_at: input.timestamp,
    source: { system: "claude-session", actor: "claude-local-import" },
    workspace: { key: input.options.workspace },
    idempotency_key: idempotencyKey,
    payload: {
      task: input.options.task ? { key: slug(input.options.task) } : null,
      run: {
        id: runId,
        external_ref: {
          system: "claude-session-prompt",
          id: `${input.session.id}:${input.promptGroup.index}`,
          prompt_hash: input.promptGroup.promptHash,
          started_at: input.promptGroup.startedAt,
        },
      },
      usage: {
        provider: "anthropic",
        model: input.session.model,
        usage_kind: "conversation_turn",
        started_at: input.promptGroup.startedAt ?? input.timestamp,
        input_tokens: input.usage.inputTokens,
        output_tokens: input.usage.outputTokens,
        cached_input_tokens: input.usage.cachedInputTokens,
        cache_write_input_tokens: input.usage.cacheWriteInputTokens,
        total_tokens: input.usage.totalTokens,
        accuracy_mode: "exact",
        pricing_mode: "unpriced",
        unpriced_reason: "missing_pricing_rule",
        raw_usage: input.usage.raw,
      },
      prompt_snapshot: promptSnapshot.snapshot,
      source_context: {
        tool: "claude-code",
        capture_mode: "claude_session_assistant_event",
        user_message: promptSnapshot.contextPromptText,
        prompt_group: {
          index: input.promptGroup.index,
          prompt_hash: input.promptGroup.promptHash,
          started_at: input.promptGroup.startedAt,
        },
        session: {
          id: input.session.id,
          cwd: input.session.cwd,
          source: input.session.source,
          originator: input.session.originator,
          cli_version: input.session.cliVersion,
          file: input.session.file,
          is_subagent: input.session.isSubagent,
        },
        message_id: input.messageId,
        request_id: input.requestId,
        token_usage: input.usage.raw,
        assistant_summary: input.assistantSummary,
      },
    },
  });
}

interface ClaudeSessionMeta {
  id: string;
  cwd: string | null;
  source: string | null;
  originator: string | null;
  cliVersion: string | null;
  model: string | null;
  file: string;
  isSubagent: boolean;
}

interface ClaudeTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  totalTokens: number | null;
  raw: Record<string, unknown>;
}

interface ClaudeSessionPromptGroup {
  index: number;
  promptText: string | null;
  promptHash: string;
  startedAt: string | null;
}

function emptyClaudePromptGroup(): ClaudeSessionPromptGroup {
  return { index: 0, promptText: null, promptHash: "no-prompt", startedAt: null };
}

function nextClaudePromptGroup(
  previous: ClaudeSessionPromptGroup,
  promptText: string | null,
  startedAt: string | null,
): ClaudeSessionPromptGroup {
  return {
    index: previous.index + 1,
    promptText,
    promptHash: promptText ? createHash("sha256").update(promptText, "utf8").digest("hex").slice(0, 12) : "no-prompt",
    startedAt,
  };
}

function claudePromptRunId(session: ClaudeSessionMeta, promptGroup: ClaudeSessionPromptGroup): string {
  const sessionId = session.id.replace(/[^a-zA-Z0-9]/g, "_");
  const groupIndex = String(promptGroup.index).padStart(4, "0");
  return `run_claude_${sessionId}_prompt_${groupIndex}_${promptGroup.promptHash}`;
}

function updateClaudeSessionMeta(
  current: ClaudeSessionMeta | null,
  item: Record<string, unknown>,
  file: string,
): ClaudeSessionMeta | null {
  const sessionId = stringField(item.sessionId);
  if (!sessionId && !current) return null;
  if (current && (!sessionId || sessionId === current.id)) {
    if (current.cwd && current.cliVersion && current.source && current.model) return current;
    const next = { ...current };
    if (!next.cwd) next.cwd = stringField(item.cwd);
    if (!next.cliVersion) next.cliVersion = stringField(item.version);
    if (!next.source) next.source = stringField(item.entrypoint);
    if (!next.model) {
      const message = isRecord(item.message) ? item.message : null;
      next.model = stringField(message?.model);
    }
    return next;
  }
  return {
    id: sessionId ?? claudeSessionIdFromPath(file),
    cwd: stringField(item.cwd),
    source: stringField(item.entrypoint),
    originator: stringField(item.userType) ?? "claude-code",
    cliVersion: stringField(item.version),
    model: null,
    file,
    isSubagent: file.includes(`${"/"}subagents${"/"}`),
  };
}

function claudeSessionIdFromPath(file: string): string {
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.jsonl$/, "");
}

function fallbackClaudeSessionMeta(item: Record<string, unknown>, file: string): ClaudeSessionMeta {
  const sessionId = stringField(item.sessionId) ?? claudeSessionIdFromPath(file);
  return {
    id: sessionId,
    cwd: stringField(item.cwd),
    source: stringField(item.entrypoint),
    originator: stringField(item.userType) ?? "claude-code",
    cliVersion: stringField(item.version),
    model: null,
    file,
    isSubagent: file.includes(`${"/"}subagents${"/"}`),
  };
}

function claudeUserPromptText(item: Record<string, unknown>): string | null {
  const message = isRecord(item.message) ? item.message : null;
  if (!message) return null;
  const content = message.content;
  if (typeof content === "string") return content.trim() ? content : null;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  if (parts.length === 0) return null;
  const joined = parts.join("\n").trim();
  return joined ? joined : null;
}

function claudeTokenUsage(raw: Record<string, unknown>): ClaudeTokenUsage | null {
  const inputTokens = numberField(raw.input_tokens);
  const outputTokens = numberField(raw.output_tokens);
  const cachedInputTokens = numberField(raw.cache_read_input_tokens);
  const cacheWriteInputTokens = numberField(raw.cache_creation_input_tokens);
  const totalTokensRaw = numberField(raw.total_tokens);
  if (
    inputTokens == null &&
    outputTokens == null &&
    cachedInputTokens == null &&
    cacheWriteInputTokens == null &&
    totalTokensRaw == null
  )
    return null;
  const totalTokens =
    totalTokensRaw ??
    (inputTokens == null && outputTokens == null && cachedInputTokens == null && cacheWriteInputTokens == null
      ? null
      : (inputTokens ?? 0) + (outputTokens ?? 0) + (cachedInputTokens ?? 0) + (cacheWriteInputTokens ?? 0));
  return { inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens, totalTokens, raw };
}

function buildPromptSnapshot(input: {
  mode: PromptMode;
  promptText: string | null;
  responseText?: string | null;
}): { snapshot: Record<string, unknown>; contextPromptText: string | null } {
  if (input.mode === "none") {
    return { snapshot: { mode: "none" }, contextPromptText: null };
  }
  if (input.promptText == null && input.responseText == null) {
    return { snapshot: { mode: "none" }, contextPromptText: null };
  }
  if (input.mode === "full") {
    return {
      snapshot: {
        mode: "full",
        prompt_text: input.promptText,
        response_text: input.responseText ?? null,
        retention_note: "User requested full prompt/response retention for Codex chat logging.",
      },
      contextPromptText: input.promptText,
    };
  }
  if (input.mode === "hash") {
    return {
      snapshot: {
        mode: "hash",
        prompt_hash: input.promptText ? hashText(input.promptText) : null,
        response_hash: input.responseText ? hashText(input.responseText) : null,
        retention_note: "Only SHA-256 prompt/response hashes are retained; text is not stored.",
      },
      contextPromptText: null,
    };
  }

  const promptRedaction = input.promptText ? redactText(input.promptText) : null;
  const responseRedaction = input.responseText ? redactText(input.responseText) : null;
  const categories = [
    ...new Set([...(promptRedaction?.categories ?? []), ...(responseRedaction?.categories ?? [])]),
  ];
  const matchCount = (promptRedaction?.matchCount ?? 0) + (responseRedaction?.matchCount ?? 0);
  return {
    snapshot: {
      mode: "redacted",
      prompt_text: promptRedaction?.text ?? null,
      response_text: responseRedaction?.text ?? null,
      redaction: {
        method: "built_in_patterns",
        redacted: matchCount > 0,
        match_count: matchCount,
        categories,
      },
      retention_note: "Prompt/response text is retained after built-in secret redaction.",
    },
    contextPromptText: promptRedaction?.text ?? null,
  };
}

interface RedactionRule {
  category: string;
  pattern: RegExp;
  replacement: string | ((match: string, matches: unknown[]) => string);
}

const REDACTION_RULES: RedactionRule[] = [
  {
    category: "private_key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED:private-key]",
  },
  {
    category: "credential_assignment",
    pattern:
      /\b([A-Z0-9_.-]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|TOKEN|SECRET|PASSWORD|AUTHORIZATION)[A-Z0-9_.-]*)(\s*[:=]\s*)(["']?)([^\s"',;]{8,})\3/gi,
    replacement: (_match, matches) =>
      `${String(matches[1] ?? "")}${String(matches[2] ?? "")}${String(
        matches[3] ?? "",
      )}[REDACTED:credential]${String(matches[3] ?? "")}`,
  },
  {
    category: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
    replacement: "Bearer [REDACTED:token]",
  },
  {
    category: "openai_api_key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED:api-key]",
  },
  {
    category: "ttoksem_token",
    pattern: /\bttok_[A-Za-z0-9_-]{16,}\b/g,
    replacement: "[REDACTED:ttoksem-token]",
  },
  {
    category: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[REDACTED:email]",
  },
];

function redactText(value: string): { text: string; matchCount: number; categories: string[] } {
  let text = value;
  let matchCount = 0;
  const categories = new Set<string>();
  for (const rule of REDACTION_RULES) {
    text = text.replace(rule.pattern, (...matches: unknown[]) => {
      matchCount += 1;
      categories.add(rule.category);
      const fullMatch = String(matches[0] ?? "");
      return typeof rule.replacement === "string" ? rule.replacement : rule.replacement(fullMatch, matches);
    });
  }
  return { text, matchCount, categories: [...categories] };
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parsePromptMode(value: string): PromptMode {
  if (value === "full" || value === "none" || value === "redacted" || value === "hash") return value;
  throw new Error(`Invalid prompt mode: ${value}`);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sessionIdFromPath(path: string): string | null {
  const match = path.match(/rollout-[^.]*-([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
  return match?.[1] ?? null;
}

function resolveImportPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolveFromCommandCwd(path);
}

function readOptionalText(text: string | undefined, file: string | undefined): string | null {
  if (text != null) return text;
  if (file != null) return readFileSync(resolveFromCommandCwd(file), "utf8");
  return null;
}

function runRef(options: { runId?: string }) {
  if (!options.runId) return null;
  return {
    id: options.runId,
  };
}

function printReport(report: {
  date: string;
  event_count: number;
  estimated_total: number;
  observed_total: number;
  currency: string | null;
  unpriced_count: number;
}): void {
  const currency = report.currency ?? "mixed/unknown";
  console.log(`Estimated total: ${report.estimated_total.toFixed(9)} ${currency}`);
  console.log(`Provider-observed total: ${report.observed_total.toFixed(9)} ${currency}`);
  console.log(`Pricing basis: event-time records`);
  console.log(`Events: ${report.event_count}`);
  console.log(`Unpriced usage: ${report.unpriced_count} event(s)`);
}

function printDashboardOverview(data: DashboardData): void {
  const currency = data.summary.currency ?? "USD";
  const total = data.summary.event_count;
  const priced = Math.max(0, total - data.summary.unpriced_count);
  const assigned = data.summary.assigned_count;
  const unassigned = data.summary.unassigned_count;

  console.log(`Workspace dashboard: ${data.workspace.key}`);
  console.log(`Cost basis: event_time_estimate`);
  console.log(`Pricing basis: event-time records`);
  console.log("");
  console.log("Summary");
  console.log(`  Estimated total       ${formatMoney(data.summary.estimated_total, currency)}`);
  console.log(`  Provider observed     ${formatMoney(data.summary.observed_total, currency)}`);
  console.log(`  Usage events          ${total}`);
  console.log(`  Assigned usage        ${assigned}/${total}`);
  console.log(`  Unassigned usage      ${unassigned}`);
  console.log(`  Unpriced usage        ${data.summary.unpriced_count}`);
  console.log(`  Tasks / runs          ${data.summary.task_count} / ${data.summary.run_count}`);

  const warnings = dashboardWarnings(data);
  if (warnings.length > 0) {
    console.log("");
    console.log("Warnings");
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  console.log("");
  console.log("Cost quality");
  printTextBar("observed", data.summary.observed_total, data.summary.estimated_total, formatMoney(data.summary.observed_total, currency));
  printTextBar("estimated", Math.max(0, data.summary.estimated_total - data.summary.observed_total), data.summary.estimated_total, formatMoney(Math.max(0, data.summary.estimated_total - data.summary.observed_total), currency));
  printTextCountBar("priced", priced, total);
  printTextCountBar("unpriced", data.summary.unpriced_count, total);

  console.log("");
  console.log("Daily cost");
  for (const row of data.daily) {
    printTextBar(row.date, row.estimated_total, maxDailyCost(data), formatMoney(row.estimated_total, currency), row.event_count);
  }

  console.log("");
  console.log("Top tasks");
  printDashboardTable(
    ["Task", "Cost", "Events", "Runs", "Unpriced", "Detail"],
    data.task_insights.slice(0, 8).map((row) => [
      row.task_key,
      formatMoney(row.estimated_total, currency),
      String(row.event_count),
      String(row.run_count),
      String(row.unpriced_count),
      row.task_key === "unassigned" ? "ttoksem inbox list" : `ttoksem report task ${row.task_key}`,
    ]),
  );

  console.log("");
  console.log("Report tiles");
  printDashboardTable(
    ["Report", "Key metric", "Warning", "Next"],
    [
      ["Workspace daily cost", formatMoney(data.summary.estimated_total, currency), warningForCount(data.summary.unpriced_count, "unpriced"), "ttoksem report today"],
      ["Task cost summary", `${data.summary.task_count} tasks`, warningForCount(data.summary.unassigned_count, "unassigned"), "ttoksem report task <task>"],
      ["Model cost breakdown", `${data.recent.length} recent rows`, "", "filter by provider/model"],
      ["Data quality", `${data.summary.unpriced_count + data.summary.unassigned_count} gaps`, warnings[0] ?? "", "ttoksem inbox list"],
    ],
  );
}

function dashboardWarnings(data: DashboardData): string[] {
  const warnings: string[] = [];
  if (data.summary.unpriced_count > 0) {
    warnings.push(`${data.summary.unpriced_count} usage event(s) are unpriced; totals are incomplete.`);
  }
  if (data.summary.unassigned_count > 0) {
    warnings.push(`${data.summary.unassigned_count} usage event(s) are unassigned; task totals may be incomplete.`);
  }
  if (data.summary.currency == null && data.summary.event_count > 0) {
    warnings.push("Currency is mixed or unknown.");
  }
  return warnings;
}

function warningForCount(count: number, label: string): string {
  return count > 0 ? `${count} ${label}` : "";
}

function maxDailyCost(data: DashboardData): number {
  return Math.max(...data.daily.map((row) => row.estimated_total), 0.000001);
}

function printTextBar(label: string, value: number, max: number, valueText: string, eventCount?: number): void {
  const width = barWidth(value, max);
  const suffix = eventCount == null ? "" : `  events=${eventCount}`;
  console.log(`  ${label.padEnd(14)} ${valueText.padStart(16)}  ${"█".repeat(width)}${suffix}`);
}

function printTextCountBar(label: string, value: number, max: number): void {
  const width = barWidth(value, max);
  console.log(`  ${label.padEnd(14)} ${String(value).padStart(16)}  ${"!".repeat(width)}`);
}

function barWidth(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1, Math.round((value / max) * 24));
}

function printDashboardTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  console.log(
    "  " +
      headers
        .map((header, index) => header.padEnd(widths[index] ?? header.length))
        .join("  "),
  );
  console.log("  " + widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(
      "  " +
        row
          .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
          .join("  "),
    );
  }
}

function formatMoney(value: number, currency: string): string {
  return `${value.toFixed(9)} ${currency}`;
}

function printInboxGroups(groups: InboxGroup[]): void {
  printDashboardTable(
    ["Group", "Status", "Events", "Cost", "Tokens", "Range", "Suggested", "Evidence", "Sample"],
    groups.map((group) => [
      group.group_id,
      group.assignment_status,
      String(group.event_count),
      formatMoney(group.estimated_total, group.currency ?? "USD"),
      String(group.token_count),
      formatTimeRange(group.first_occurred_at, group.last_occurred_at),
      formatInboxSuggestion(group.suggested_task),
      group.reason_codes.slice(0, 3).join(","),
      group.prompt_samples[0] ? truncate(group.prompt_samples[0], 48) : group.sample_event_ids[0] ?? "",
    ]),
  );
}

function printInboxGroupDetail(group: InboxGroup, events: UsageEventRecord[]): void {
  console.log(`Inbox group: ${group.group_id}`);
  console.log(`  Status       ${group.assignment_status}`);
  console.log(`  Events       ${group.event_count}`);
  console.log(`  Cost         ${formatMoney(group.estimated_total, group.currency ?? "USD")}`);
  console.log(`  Tokens       ${group.token_count}`);
  console.log(`  Range        ${formatTimeRange(group.first_occurred_at, group.last_occurred_at)}`);
  console.log(`  Suggested    ${formatInboxSuggestion(group.suggested_task)}`);
  console.log(`  Evidence     ${group.reason_codes.join(", ")}`);
  console.log(`  Context      ${formatInboxContext(group)}`);
  if (group.prompt_samples.length > 0) {
    console.log("  Prompts");
    for (const prompt of group.prompt_samples) console.log(`    - ${truncate(prompt, 120)}`);
  }
  console.log("");
  console.log("Events");
  for (const event of events) printUsageEventLine(event);
}

function printInboxAssignmentResult(result: InboxAssignmentResult): void {
  console.log(
    `inbox ${result.group.group_id} assigned task=${result.task.key} assigned=${result.assigned_count} skipped=${result.skipped_count}`,
  );
  if (result.assigned_event_ids.length > 0) {
    console.log(`events ${result.assigned_event_ids.join(",")}`);
  }
  if (result.skipped_event_ids.length > 0) {
    console.log(`skipped ${result.skipped_event_ids.join(",")}`);
  }
}

function formatInboxSuggestion(suggestion: InboxGroup["suggested_task"]): string {
  if (!suggestion) return "";
  return `${suggestion.task_key} ${suggestion.level} ${(suggestion.confidence * 100).toFixed(0)}%`;
}

function formatInboxContext(group: InboxGroup): string {
  const context = group.source_context;
  return [
    context.date_bucket,
    context.tool ? `tool=${context.tool}` : "",
    context.cwd ? `cwd=${context.cwd}` : "",
    context.git_branch ? `branch=${context.git_branch}` : "",
    context.command ? `command=${context.command}` : "",
    context.conversation_id ? `conversation=${context.conversation_id}` : "",
    context.request_id ? `request=${context.request_id}` : "",
    context.external_ref ? `external=${context.external_ref}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatTimeRange(first: string, last: string): string {
  return first === last ? first : `${first}..${last}`;
}

function printUsageEventLine(event: UsageEventRecord): void {
  const prompt = extractPromptText(event.payload_json);
  const tokens = event.total_tokens ?? (event.input_tokens ?? 0) + (event.output_tokens ?? 0);
  console.log(
    [
      event.id,
      event.occurred_at,
      `${event.provider}/${event.model}`,
      `tokens=${tokens}`,
      event.duration_ms == null ? "" : `duration_ms=${event.duration_ms}`,
      `pricing=${event.pricing_mode ?? "unknown"}`,
      prompt ? `prompt=${truncate(prompt, 80)}` : "",
    ]
      .filter(Boolean)
      .join("\t"),
  );
}

function extractPromptText(payload: Record<string, unknown>): string | null {
  const payloadObject = payload.payload;
  if (!isRecord(payloadObject)) return null;
  const promptSnapshot = payloadObject.prompt_snapshot;
  if (!isRecord(promptSnapshot)) return null;
  const promptText = promptSnapshot.prompt_text;
  return typeof promptText === "string" && promptText.length > 0 ? promptText : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= maxLength ? oneLine : `${oneLine.slice(0, maxLength - 3)}...`;
}

function parseOptionalInteger(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

function estimateTokenCount(input: {
  tokens?: string;
  chars?: string;
  text: string | null;
  scope: string;
  textSource: string;
  charsSource: string;
  tokensSource: string;
}): {
  tokens: number | null;
  mode: "manual" | "estimated" | null;
  context: Record<string, unknown> | null;
} {
  const explicitTokens = parseOptionalInteger(input.tokens);
  if (explicitTokens != null) {
    return {
      tokens: explicitTokens,
      mode: "manual",
      context: {
        mode: "manual",
        method: "user_entered",
        scope: input.scope,
        source: input.tokensSource,
        tokens: explicitTokens,
      },
    };
  }

  const explicitChars = parseOptionalInteger(input.chars);
  const charCount = explicitChars ?? input.text?.length ?? null;
  if (charCount == null) return { tokens: null, mode: null, context: null };

  const tokens = Math.max(1, Math.ceil(charCount / 4));
  return {
    tokens,
    mode: "estimated",
    context: {
      mode: "estimated",
      method: "chars_div_4",
      scope: input.scope,
      source: explicitChars == null ? input.textSource : input.charsSource,
      chars: charCount,
      tokens,
      version: "v1",
    },
  };
}

function tokenAccuracyMode(
  inputMode: "manual" | "estimated" | null,
  outputMode: "manual" | "estimated" | null,
): "manual" | "estimated" {
  if (inputMode === "estimated" || outputMode === "estimated") return "estimated";
  if (inputMode === "manual" || outputMode === "manual") return "manual";
  return "estimated";
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function priceNanosPerUnit(price: string, per: string): number {
  const amount = parseOptionalNumber(price);
  const unitCount = parseOptionalNumber(per);
  if (amount == null || unitCount == null || unitCount <= 0) {
    throw new Error(`Invalid price/per: ${price}/${per}`);
  }
  return Math.round((amount / unitCount) * 1_000_000_000);
}

interface NormalizedLiteLlmRule {
  provider: string;
  model: string;
  usageKind: string;
  unitType: string;
  priceNanosPerUnit: number;
  effectiveFrom?: string;
}

interface NormalizeLiteLlmOptions {
  provider?: string;
  model?: string;
  effectiveFrom?: string;
  limit?: number;
}

const litellmTokenCostFields: Array<[field: string, unitType: string]> = [
  ["input_cost_per_token", "input_token"],
  ["output_cost_per_token", "output_token"],
  ["cache_read_input_token_cost", "cached_input_token"],
  ["cache_creation_input_token_cost", "cache_write_input_token"],
  ["input_cost_per_audio_token", "audio_input_token"],
  ["output_cost_per_audio_token", "audio_output_token"],
  ["output_cost_per_reasoning_token", "reasoning_output_token"],
];

function normalizeLiteLlmPricingRules(
  raw: unknown,
  options: NormalizeLiteLlmOptions,
): { rules: NormalizedLiteLlmRule[]; skipped: number } {
  if (!isRecord(raw)) throw new Error("LiteLLM pricing source must be a JSON object.");
  const rules: NormalizedLiteLlmRule[] = [];
  let skipped = 0;
  for (const [model, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      skipped += 1;
      continue;
    }
    const provider = typeof value.litellm_provider === "string" ? value.litellm_provider : null;
    if (!provider) {
      skipped += 1;
      continue;
    }
    if (options.provider && provider !== options.provider) continue;
    if (options.model && model !== options.model) continue;
    const usageKind = usageKindForLiteLlmMode(value.mode);
    for (const [field, unitType] of litellmTokenCostFields) {
      const rawPrice = value[field];
      if (typeof rawPrice !== "number" || !Number.isFinite(rawPrice) || rawPrice < 0) continue;
      const priceNanosPerUnit = Math.round(rawPrice * 1_000_000_000);
      if (priceNanosPerUnit <= 0 && rawPrice > 0) {
        skipped += 1;
        continue;
      }
      rules.push({
        provider,
        model,
        usageKind,
        unitType,
        priceNanosPerUnit,
        effectiveFrom: options.effectiveFrom,
      });
      if (options.limit && rules.length >= options.limit) return { rules, skipped };
    }
  }
  return { rules, skipped };
}

function usageKindForLiteLlmMode(mode: unknown): string {
  if (mode === "embedding") return "embedding";
  if (mode === "rerank") return "rerank";
  if (mode === "image_generation") return "image_generation";
  if (mode === "image_edit") return "image_edit";
  if (mode === "audio_transcription") return "audio_transcription";
  if (mode === "audio_speech") return "speech_generation";
  if (mode === "search") return "web_search";
  return "chat_completion";
}

function parsePricingSourceName(value: string): "litellm" | "manual" | "import" | "openrouter" {
  if (value === "litellm" || value === "manual" || value === "import" || value === "openrouter") {
    return value;
  }
  throw new Error(`Invalid pricing source name: ${value}`);
}

function parsePricingMigrationMode(value: string): "unpriced" | "repriceable" {
  if (value === "unpriced" || value === "repriceable") return value;
  throw new Error(`Invalid pricing migration mode: ${value}`);
}

function parseOptionalJsonObject(value: string | undefined): Record<string, unknown> | null {
  if (value == null) return null;
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error("--metadata must be a JSON object");
  return parsed;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
