// Seeds a fresh `.ttoksem/demo.db` (or whatever TTOKSEM_DB points at) with
// synthetic data shaped to make the README screenshots look real without
// exposing any private prompts. Run with:
//
//   TTOKSEM_DB=/tmp/ttoksem-demo.db pnpm tsx scripts/seed-demo.ts
//
// Idempotent in the sense that `service.recordUsage` keys by message_id —
// re-running with the same seed regenerates the same events. We delete the
// DB at the start anyway so it's always a clean shape.

import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

import { LedgerService } from "@ttoksem/core";
import type { AiUsageObserved } from "@ttoksem/schema";
import { SqliteLedgerStore } from "@ttoksem/storage-sqlite";

const dbPath = resolve(process.env.TTOKSEM_DB ?? "/tmp/ttoksem-demo.db");
if (existsSync(dbPath)) rmSync(dbPath);
mkdirSync(dirname(dbPath), { recursive: true });

const store = new SqliteLedgerStore(dbPath);
const service = new LedgerService({ store });
await service.init();

const workspaceKey = "demo";
const workspace = await service.createWorkspace({
  key: workspaceKey,
  name: "Demo Workspace",
  rootPath: "/tmp/ttoksem-demo",
});

// ── Pricing snapshot + rules ─────────────────────────────────────────────────
// Two priced models, plus we'll later emit events for an unpriced model so
// the Pricing gap surfaces in screenshots.

const snapshot = await service.upsertPricingSourceSnapshot({
  sourceName: "litellm",
  rawSha256: "sha256:demo-snapshot",
  sourceUrl: "https://github.com/BerriAI/litellm",
  sourceVersion: "demo-2026-04-01",
  validFrom: "2026-01-01T00:00:00.000Z",
});

async function priceRule(provider: string, model: string, unitType: string, perMillionUSD: number) {
  await service.upsertPricingRule({
    workspace: { key: workspaceKey },
    sourceSnapshotId: snapshot.id,
    provider,
    model,
    usageKind: "conversation_turn",
    unitType,
    // priceNanosPerUnit = perMillion * 1e9 / 1e6 = perMillion * 1000
    priceNanosPerUnit: BigInt(Math.round(perMillionUSD * 1000)),
    currency: "USD",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    source: "litellm",
  });
}

await priceRule("anthropic", "claude-sonnet-4-5", "input_token", 3.0);
await priceRule("anthropic", "claude-sonnet-4-5", "output_token", 15.0);
await priceRule("anthropic", "claude-sonnet-4-5", "cached_input_token", 0.3);
await priceRule("anthropic", "claude-haiku-4-5", "input_token", 1.0);
await priceRule("anthropic", "claude-haiku-4-5", "output_token", 5.0);
await priceRule("openai", "gpt-4-turbo", "input_token", 10.0);
await priceRule("openai", "gpt-4-turbo", "output_token", 30.0);

// ── Tasks ────────────────────────────────────────────────────────────────────

const taskSpecs: Array<{ key: string; name: string; closed?: boolean }> = [
  { key: "implement-checkout-flow", name: "Implement checkout flow" },
  { key: "polish-onboarding-ui", name: "Polish onboarding UI" },
  { key: "fix-search-pagination", name: "Fix search pagination" },
  { key: "document-billing-api", name: "Document billing API" },
  { key: "define-rollout-stages", name: "Define rollout stages" },
  { key: "cleanup-deprecated-routes", name: "Cleanup deprecated routes", closed: true },
  { key: "ops-triage", name: "ops-triage" },
];

const tasks: Record<string, string> = {};
for (const spec of taskSpecs) {
  const t = await service.startTask({
    workspace: { key: workspaceKey },
    key: spec.key,
    name: spec.name,
  });
  tasks[spec.key] = t.id;
  if (spec.closed) {
    await service.closeTask({ workspace: { key: workspaceKey }, key: spec.key });
  }
}

// ── Usage events ─────────────────────────────────────────────────────────────

const PROMPT_LIB = [
  "Refactor the checkout button to use the new design tokens.",
  "Add unit tests for the search query builder edge cases.",
  "Document the new billing webhook retry behavior.",
  "Investigate the flaky CI check on the onboarding flow.",
  "Add a rollback_at column to the rollout_stages table.",
  "Audit which API routes are still used after the v2 migration.",
  "Wire pagination for the search results endpoint.",
  "Tighten the onboarding modal copy after legal review.",
  "Generate an OpenAPI spec for the billing endpoints.",
  "Triage the staging error spike from this morning.",
  "Reproduce the checkout 500 from yesterday's report.",
  "Draft the release notes for this week's deploy.",
];

const ASSIST_TEXTS = [
  "Reviewed the checkout component and found three call sites importing the old token names.",
  "The flaky test was racing against the modal's close animation; tightened the wait condition.",
  "Sketched a migration plan that backfills rollback_at from closed_at where present.",
  "Confirmed the v2 routes carry 98% of traffic; the remaining 2% is one internal cron job.",
];

let messageCounter = 0;

function nextId(prefix: string) {
  messageCounter += 1;
  return `${prefix}_${messageCounter.toString().padStart(4, "0")}`;
}

function buildMessage(opts: {
  taskKey: string | null;
  occurredAt: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  promptText: string;
  responseText?: string;
  runId?: string;
  source?: string;
  withAssistantSummary?: boolean;
}): AiUsageObserved {
  const messageId = nextId("msg");
  return {
    schema_version: "1.0",
    message_id: messageId,
    kind: "ingest_message",
    type: "ai.usage.observed",
    occurred_at: opts.occurredAt,
    source: { system: opts.source ?? "claude-code", actor: "demo-seed" },
    workspace: { key: workspaceKey },
    payload: {
      task: opts.taskKey ? { key: opts.taskKey } : null,
      run: opts.runId ? { id: opts.runId } : null,
      usage: {
        provider: opts.provider,
        model: opts.model,
        usage_kind: "conversation_turn",
        started_at: opts.occurredAt,
        ended_at: opts.occurredAt,
        input_tokens: opts.inputTokens,
        output_tokens: opts.outputTokens,
        cached_input_tokens: null,
        cache_write_input_tokens: null,
        reasoning_output_tokens: null,
        audio_input_tokens: null,
        audio_output_tokens: null,
        total_tokens: opts.inputTokens + opts.outputTokens,
        image_count: null,
        seconds: null,
        request_count: 1,
        unit_count: null,
        unit_type: null,
        observed_cost: null,
        observed_currency: null,
        estimated_cost: null,
        estimated_currency: null,
        accuracy_mode: "exact",
      },
      prompt_snapshot: {
        mode: "full",
        prompt_text: opts.promptText,
        response_text: opts.responseText ?? null,
      },
      source_context: opts.withAssistantSummary
        ? {
            tool: opts.source ?? "claude-code",
            assistant_summary: {
              text_excerpt: opts.responseText ?? ASSIST_TEXTS[messageCounter % ASSIST_TEXTS.length],
              has_thinking: true,
              thinking_excerpt:
                "Need to keep the change scoped to the checkout flow — touching the cart layout would balloon the diff.",
              tool_calls: [
                {
                  name: "Read",
                  summary: "Read packages/checkout/src/CheckoutButton.tsx",
                  detail: "{ file_path: 'packages/checkout/src/CheckoutButton.tsx' }",
                },
                {
                  name: "Grep",
                  summary: "Search for old token names across packages/",
                  detail: "{ pattern: 'token--legacy', path: 'packages' }",
                },
                {
                  name: "Edit",
                  summary: "Replace 3 occurrences of token--legacy with token-checkout",
                  detail: "{ file_path: 'packages/checkout/src/CheckoutButton.tsx' }",
                },
                {
                  name: "Bash",
                  summary: "pnpm --filter @demo/checkout test",
                  detail: "Tests passed: 12 / 12",
                },
              ],
            },
          }
        : { tool: opts.source ?? "claude-code" },
    },
  };
}

const NOW_MS = Date.parse("2026-04-30T03:00:00.000Z");
const DAY = 86_400_000;

async function emit(opts: Parameters<typeof buildMessage>[0]) {
  await service.recordUsage(buildMessage(opts));
}

// Pricing-priced events spread across tasks and days.
const ASSIGNED_TASKS = ["implement-checkout-flow", "polish-onboarding-ui", "fix-search-pagination", "document-billing-api", "define-rollout-stages", "ops-triage"];
const PROVIDERS_PRICED = [
  { provider: "anthropic", model: "claude-sonnet-4-5", inputBase: 3500, outputBase: 1400 },
  { provider: "anthropic", model: "claude-haiku-4-5", inputBase: 2200, outputBase: 800 },
  { provider: "openai", model: "gpt-4-turbo", inputBase: 1800, outputBase: 700 },
];

let eventIdx = 0;
for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
  const eventsToday = 3 + (dayOffset % 4); // 3..6 events per day
  for (let i = 0; i < eventsToday; i++) {
    const taskKey = ASSIGNED_TASKS[(eventIdx + dayOffset) % ASSIGNED_TASKS.length];
    const tier = PROVIDERS_PRICED[eventIdx % PROVIDERS_PRICED.length];
    const occurredAt = new Date(NOW_MS - dayOffset * DAY - i * 1500_000).toISOString();
    const inputTokens = tier.inputBase + ((eventIdx * 137) % 800);
    const outputTokens = tier.outputBase + ((eventIdx * 91) % 400);
    await emit({
      taskKey,
      occurredAt,
      provider: tier.provider,
      model: tier.model,
      inputTokens,
      outputTokens,
      promptText: PROMPT_LIB[eventIdx % PROMPT_LIB.length],
      responseText: ASSIST_TEXTS[eventIdx % ASSIST_TEXTS.length],
      source: tier.provider === "openai" ? "openai-sdk" : "claude-code",
    });
    eventIdx++;
  }
}

// One task with a rich run trace for the run-detail screenshot.
const traceRunId = "run_demo_checkout_refactor";
for (let i = 0; i < 6; i++) {
  await emit({
    taskKey: "implement-checkout-flow",
    occurredAt: new Date(NOW_MS - 2 * DAY - i * 60_000).toISOString(),
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    inputTokens: 4200 + i * 250,
    outputTokens: 1100 + i * 80,
    promptText: PROMPT_LIB[0],
    responseText: ASSIST_TEXTS[0],
    runId: traceRunId,
    withAssistantSummary: true,
    source: "claude-code",
  });
}

// Unpriced events — different model that has no rule, so the dashboard
// flags them under "Pricing gap".
for (let i = 0; i < 5; i++) {
  await emit({
    taskKey: "polish-onboarding-ui",
    occurredAt: new Date(NOW_MS - i * DAY * 2 - 3_000_000).toISOString(),
    provider: "openai",
    model: "gpt-5-preview",
    inputTokens: 1500 + i * 100,
    outputTokens: 600 + i * 50,
    promptText: PROMPT_LIB[(i + 5) % PROMPT_LIB.length],
    source: "openai-sdk",
  });
}
for (let i = 0; i < 3; i++) {
  await emit({
    taskKey: "document-billing-api",
    occurredAt: new Date(NOW_MS - i * DAY - 1_000_000).toISOString(),
    provider: "google",
    model: "gemini-2-flash",
    inputTokens: 900 + i * 80,
    outputTokens: 350 + i * 40,
    promptText: PROMPT_LIB[(i + 8) % PROMPT_LIB.length],
    source: "openai-sdk",
  });
}

// Unassigned events for the inbox — vary prompt samples so the inbox
// screenshot doesn't look like a single repeated row.
const INBOX_PROMPTS = [
  "Help me draft a migration plan for the search index rebuild.",
  "Review this PR description and suggest tighter bullet points.",
  "Pull the last week's checkout error rates from the metrics dashboard.",
  "Walk me through how the rollout stage rollback would work in practice.",
  "Compare the bundle sizes between the legacy and new onboarding flows.",
];
for (let i = 0; i < INBOX_PROMPTS.length; i++) {
  // Each "group" gets 2-3 events to make the inbox card show realistic counts.
  const groupCount = 2 + (i % 2);
  for (let j = 0; j < groupCount; j++) {
    await emit({
      taskKey: null,
      occurredAt: new Date(NOW_MS - (i + 1) * DAY * 0.5 - j * 60_000).toISOString(),
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      inputTokens: 1500 + i * 200,
      outputTokens: 600 + j * 80,
      promptText: INBOX_PROMPTS[i],
      source: "claude-code",
    });
  }
}

await store.close();
console.log(`Seeded demo workspace at ${dbPath}`);
