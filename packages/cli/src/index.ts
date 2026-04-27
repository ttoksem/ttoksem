#!/usr/bin/env node
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { LedgerService } from "@ttoksem/core";
import { AiUsageObservedSchema, type AiUsageObserved } from "@ttoksem/schema";
import { SqliteLedgerStore } from "@ttoksem/storage-sqlite";

const program = new Command();

program.name("ttoksem").description("Local-first AI task costbook").version("0.0.0");

program
  .command("doctor")
  .description("Check local CLI and SQLite setup")
  .action(async () => {
    const { service, dbPath, close } = await makeService();
    await service.init();
    console.log(`ok database=${dbPath}`);
    await close();
  });

const workspace = program.command("workspace").description("Workspace commands");

workspace
  .command("init")
  .description("Create or reuse a workspace for the current directory")
  .option("--key <key>", "workspace key")
  .option("--name <name>", "workspace name")
  .option("--root <path>", "workspace root path")
  .action(async (options: { key?: string; name?: string; root?: string }) => {
    const { service, close } = await makeService();
    await service.init();
    const rootPath = resolveFromCommandCwd(options.root ?? ".");
    const key = options.key ?? slug(rootPath.split("/").filter(Boolean).at(-1) ?? "workspace");
    const workspace = await service.createWorkspace({ key, name: options.name, rootPath });
    console.log(`workspace ${workspace.key} ${workspace.id}`);
    await close();
  });

workspace
  .command("current")
  .description("Show workspace for the current directory")
  .option("--root <path>", "workspace root path")
  .action(async (options: { root?: string }) => {
    const { service, close } = await makeService();
    await service.init();
    const current = await service.currentWorkspace(resolveFromCommandCwd(options.root ?? "."));
    console.log(JSON.stringify(current, null, 2));
    await close();
  });

workspace
  .command("list")
  .description("List workspaces")
  .action(async () => {
    const { service, close } = await makeService();
    await service.init();
    for (const workspace of await service.listWorkspaces()) {
      console.log(`${workspace.key}\t${workspace.id}\t${workspace.root_path ?? ""}`);
    }
    await close();
  });

const task = program.command("task").description("Task commands");

task
  .command("start")
  .argument("<key>", "task key")
  .option("--name <name>", "task name")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("Create or activate a task")
  .action(async (key: string, options: { name?: string; workspace?: string; root?: string }) => {
    const { service, close } = await makeService();
    await service.init();
    const started = await service.startTask({
      workspace: workspaceResolver(options),
      key: slug(key),
      name: options.name ?? key,
    });
    console.log(`task ${started.key} ${started.status} ${started.id}`);
    await close();
  });

task
  .command("close")
  .option("--key <key>", "task key")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("Close the active task or a named task")
  .action(async (options: { key?: string; workspace?: string; root?: string }) => {
    const { service, close } = await makeService();
    await service.init();
    const closed = await service.closeTask({
      workspace: workspaceResolver(options),
      key: options.key ? slug(options.key) : undefined,
    });
    console.log(`task ${closed.key} ${closed.status} ${closed.id}`);
    await close();
  });

task
  .command("list")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("List workspace tasks")
  .action(async (options: { workspace?: string; root?: string }) => {
    const { service, close } = await makeService();
    await service.init();
    for (const item of await service.listTasks({ workspace: workspaceResolver(options) })) {
      console.log(`${item.key}\t${item.status}\t${item.id}`);
    }
    await close();
  });

const usage = program.command("usage").description("Usage commands");

usage
  .command("add")
  .description("Record an ai.usage.observed message")
  .option("--file <path>", "canonical ai.usage.observed JSON file")
  .option("--workspace <key>", "workspace key")
  .option("--task <key>", "task key")
  .option("--provider <provider>", "provider name")
  .option("--model <model>", "model name")
  .option("--input-tokens <count>", "input token count")
  .option("--output-tokens <count>", "output token count")
  .option("--observed-cost <amount>", "provider-observed cost")
  .option("--estimated-cost <amount>", "rule-estimated cost")
  .option("--currency <code>", "ISO currency code", "USD")
  .option("--idempotency-key <key>", "idempotency key")
  .action(async (options: UsageAddOptions) => {
    const { service, close } = await makeService();
    await service.init();
    const message = options.file ? readMessage(options.file) : buildUsageMessage(options);
    const event = await service.recordUsage(message);
    console.log(`usage ${event.id} ${event.provider}/${event.model} ${event.assignment_status}`);
    await close();
  });

const report = program.command("report").description("Report commands");

report
  .command("today")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--date <yyyy-mm-dd>", "UTC date")
  .description("Show today's workspace cost summary")
  .action(async (options: { workspace?: string; root?: string; date?: string }) => {
    const { service, close } = await makeService();
    await service.init();
    printReport(await service.reportToday({ workspace: workspaceResolver(options), date: options.date }));
    await close();
  });

report
  .command("task")
  .argument("<key>", "task key")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("Show task cost summary")
  .action(async (key: string, options: { workspace?: string; root?: string }) => {
    const { service, close } = await makeService();
    await service.init();
    printReport(await service.reportTask({ workspace: workspaceResolver(options), taskKey: slug(key) }));
    await close();
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

interface UsageAddOptions {
  file?: string;
  workspace?: string;
  task?: string;
  provider?: string;
  model?: string;
  inputTokens?: string;
  outputTokens?: string;
  observedCost?: string;
  estimatedCost?: string;
  currency?: string;
  idempotencyKey?: string;
}

async function makeService(): Promise<{
  service: LedgerService;
  dbPath: string;
  close: () => Promise<void>;
}> {
  const dbPath = process.env.TTOKSEM_DB
    ? resolve(process.env.TTOKSEM_DB)
    : resolveFromCommandCwd(".ttoksem/ttoksem.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteLedgerStore(dbPath);
  return {
    service: new LedgerService({ store }),
    dbPath,
    close: () => store.close(),
  };
}

function workspaceResolver(options: { workspace?: string; root?: string }) {
  return {
    key: options.workspace,
    rootPath: resolveFromCommandCwd(options.root ?? "."),
  };
}

function resolveFromCommandCwd(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

function readMessage(path: string): AiUsageObserved {
  return AiUsageObservedSchema.parse(JSON.parse(readFileSync(resolve(path), "utf8")));
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
      usage: {
        provider: options.provider,
        model: options.model,
        usage_kind: "chat_completion",
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

function parseOptionalInteger(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
