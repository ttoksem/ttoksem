#!/usr/bin/env node
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { LedgerService } from "@ttoksem/core";
import { AiUsageObservedSchema, type AiUsageObserved, type UsageEventRecord } from "@ttoksem/schema";
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

usage
  .command("move")
  .argument("<usage-id>", "usage event id")
  .requiredOption("--task <key>", "destination task key")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("Assign an existing usage event to a task")
  .action(async (usageEventId: string, options: UsageMoveOptions) => {
    const { service, close } = await makeService();
    await service.init();
    const event = await service.moveUsage({
      workspace: workspaceResolver(options),
      usageEventId,
      taskKey: slug(options.task),
    });
    console.log(`usage ${event.id} moved task_id=${event.task_id ?? ""}`);
    await close();
  });

usage
  .command("codex-turn")
  .description("Record an estimated Codex conversation turn")
  .option("--workspace <key>", "workspace key", "ttoksem-dev")
  .option("--task <key>", "task key; omit when the goal is not clear")
  .option("--model <model>", "model label", "codex-chat")
  .option("--input-tokens <count>", "estimated input token count")
  .option("--output-tokens <count>", "estimated output token count")
  .option("--input-chars <count>", "input character count to estimate tokens")
  .option("--output-chars <count>", "output character count to estimate tokens")
  .option("--prompt-text <text>", "full prompt text to store")
  .option("--response-text <text>", "full assistant response text to store")
  .option("--prompt-file <path>", "file containing full prompt text to store")
  .option("--response-file <path>", "file containing full assistant response text to store")
  .option("--prompt-mode <mode>", "prompt snapshot mode", "full")
  .option("--idempotency-key <key>", "idempotency key")
  .action(async (options: CodexTurnOptions) => {
    const { service, close } = await makeService();
    await service.init();
    const message = buildCodexTurnMessage(options);
    const event = await service.recordUsage(message);
    console.log(`usage ${event.id} ${event.provider}/${event.model} ${event.assignment_status}`);
    await close();
  });

const inbox = program.command("inbox").description("Inbox commands");

inbox
  .command("list")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--limit <count>", "maximum events to show", "20")
  .description("List unassigned usage events")
  .action(async (options: InboxListOptions) => {
    const { service, close } = await makeService();
    await service.init();
    const events = await service.listInbox({
      workspace: workspaceResolver(options),
      limit: parsePositiveInteger(options.limit),
    });
    if (events.length === 0) {
      console.log("No unassigned usage events.");
    } else {
      for (const event of events) {
        printUsageEventLine(event);
      }
    }
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

interface UsageMoveOptions {
  task: string;
  workspace?: string;
  root?: string;
}

interface CodexTurnOptions {
  workspace: string;
  task?: string;
  model: string;
  inputTokens?: string;
  outputTokens?: string;
  inputChars?: string;
  outputChars?: string;
  promptText?: string;
  responseText?: string;
  promptFile?: string;
  responseFile?: string;
  promptMode: "none" | "hash" | "redacted" | "full";
  idempotencyKey?: string;
}

interface InboxListOptions {
  workspace?: string;
  root?: string;
  limit: string;
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

function buildCodexTurnMessage(options: CodexTurnOptions): AiUsageObserved {
  const promptText = readOptionalText(options.promptText, options.promptFile);
  const responseText = readOptionalText(options.responseText, options.responseFile);
  const inputTokens = parseEstimatedTokens(options.inputTokens, options.inputChars);
  const outputTokens = parseEstimatedTokens(options.outputTokens, options.outputChars);
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
      usage: {
        provider: "openai",
        model: options.model,
        usage_kind: "conversation_turn",
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens:
          inputTokens == null && outputTokens == null
            ? null
            : (inputTokens ?? 0) + (outputTokens ?? 0),
        accuracy_mode: "estimated",
        pricing_mode: "unpriced",
        unpriced_reason: "missing_pricing_rule",
      },
      prompt_snapshot:
        options.promptMode === "none"
          ? { mode: "none" }
          : {
              mode: options.promptMode,
              prompt_text: options.promptMode === "full" ? promptText : null,
              response_text: options.promptMode === "full" ? responseText : null,
              retention_note: "User requested full prompt/response retention for Codex chat logging.",
            },
      source_context: { tool: "codex-chat", capture_mode: "assistant_estimated_turn" },
    },
  });
}

function readOptionalText(text: string | undefined, file: string | undefined): string | null {
  if (text != null) return text;
  if (file != null) return readFileSync(resolveFromCommandCwd(file), "utf8");
  return null;
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

function printUsageEventLine(event: UsageEventRecord): void {
  const prompt = extractPromptText(event.payload_json);
  const tokens = event.total_tokens ?? (event.input_tokens ?? 0) + (event.output_tokens ?? 0);
  console.log(
    [
      event.id,
      event.occurred_at,
      `${event.provider}/${event.model}`,
      `tokens=${tokens}`,
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

function parseEstimatedTokens(tokens: string | undefined, chars: string | undefined): number | null {
  const explicit = parseOptionalInteger(tokens);
  if (explicit != null) return explicit;
  const charCount = parseOptionalInteger(chars);
  if (charCount == null) return null;
  return Math.max(1, Math.ceil(charCount / 4));
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
