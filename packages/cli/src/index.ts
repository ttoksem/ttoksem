#!/usr/bin/env node
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { LedgerService } from "@ttoksem/core";
import { AiUsageObservedSchema, type AiUsageObserved, type UsageEventRecord } from "@ttoksem/schema";
import { serveDashboard } from "@ttoksem/server";
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
  .alias("chat-turn")
  .description("Record an estimated chat conversation turn")
  .option("--workspace <key>", "workspace key", "ttoksem-dev")
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

const dashboard = program.command("dashboard").description("Dashboard commands");

dashboard
  .command("serve")
  .option("--workspace <key>", "workspace key", "ttoksem-dev")
  .option("--host <host>", "host to bind", "127.0.0.1")
  .option("--port <port>", "port to bind", "4317")
  .description("Serve the local read-only dashboard")
  .action(async (options: DashboardServeOptions) => {
    const dbPath = defaultDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    const server = await serveDashboard({
      dbPath,
      workspaceKey: options.workspace,
      hostname: options.host,
      port: parsePositiveInteger(options.port),
    });
    console.log(`dashboard ${server.url}`);
    await waitForShutdown(server.close);
  });

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
    const { service, close } = await makeService();
    await service.init();
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
    await close();
  });

pricingSnapshot
  .command("list")
  .description("List pricing source snapshots")
  .action(async () => {
    const { service, close } = await makeService();
    await service.init();
    for (const snapshot of await service.listPricingSourceSnapshots()) {
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
    await close();
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
    const { service, close } = await makeService();
    await service.init();
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
    await close();
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
    const { service, close } = await makeService();
    await service.init();
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
    await close();
  });

pricing
  .command("list")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .description("List active pricing rules")
  .action(async (options: { workspace?: string; root?: string }) => {
    const { service, close } = await makeService();
    await service.init();
    for (const rule of await service.listPricingRules({ workspace: workspaceResolver(options) })) {
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
    await close();
  });

pricing
  .command("reprice")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--limit <count>", "maximum unpriced events to check", "100")
  .description("Apply active pricing rules to unpriced usage events")
  .action(async (options: PricingRepriceOptions) => {
    const { service, close } = await makeService();
    await service.init();
    const result = await service.repriceUnpricedUsage({
      workspace: workspaceResolver(options),
      limit: parsePositiveInteger(options.limit),
    });
    console.log(
      `reprice checked=${result.checked} repriced=${result.repriced} still_unpriced=${result.still_unpriced}`,
    );
    await close();
  });

pricing
  .command("migrate-events")
  .option("--workspace <key>", "workspace key")
  .option("--root <path>", "workspace root path")
  .option("--limit <count>", "maximum events to migrate", "100")
  .option("--mode <mode>", "unpriced or repriceable", "repriceable")
  .description("Recalculate existing usage event pricing from active rules")
  .action(async (options: PricingMigrateEventsOptions) => {
    const { service, close } = await makeService();
    await service.init();
    const result = await service.migrateUsageEventPricing({
      workspace: workspaceResolver(options),
      limit: parsePositiveInteger(options.limit),
      mode: parsePricingMigrationMode(options.mode),
    });
    console.log(
      `pricing migrate-events checked=${result.checked} migrated=${result.migrated} unchanged=${result.unchanged} still_unpriced=${result.still_unpriced}`,
    );
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

interface CodexTurnOptions {
  workspace: string;
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
  promptMode: "none" | "hash" | "redacted" | "full";
  idempotencyKey?: string;
}

interface InboxListOptions {
  workspace?: string;
  root?: string;
  limit: string;
}

interface DashboardServeOptions {
  workspace: string;
  host: string;
  port: string;
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

async function makeService(): Promise<{
  service: LedgerService;
  dbPath: string;
  close: () => Promise<void>;
}> {
  const dbPath = defaultDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteLedgerStore(dbPath);
  return {
    service: new LedgerService({ store }),
    dbPath,
    close: () => store.close(),
  };
}

function defaultDbPath(): string {
  return process.env.TTOKSEM_DB
    ? resolve(process.env.TTOKSEM_DB)
    : resolveFromCommandCwd(".ttoksem/ttoksem.db");
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
  const promptText = readOptionalText(options.promptText, options.promptFile);
  const responseText = readOptionalText(options.responseText, options.responseFile);
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
      prompt_snapshot:
        options.promptMode === "none"
          ? { mode: "none" }
          : {
              mode: options.promptMode,
              prompt_text: options.promptMode === "full" ? promptText : null,
              response_text: options.promptMode === "full" ? responseText : null,
              retention_note: "User requested full prompt/response retention for Codex chat logging.",
            },
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
