import { AiUsageObservedSchema, type AiUsageObserved } from "@ttoksem/schema";

export interface OpenAiUsageObservedInput {
  workspaceKey: string;
  response: Record<string, unknown>;
  taskKey?: string | null;
  runId?: string | null;
  model?: string | null;
  operation?: string | null;
  occurredAt?: string | null;
  observedCost?: number | null;
  currency?: string | null;
  idempotencyKey?: string | null;
  sourceActor?: string | null;
  promptSnapshot?: Record<string, unknown> | null;
}

export function openAiUsageObservedFromResponse(input: OpenAiUsageObservedInput): AiUsageObserved {
  const usage = openAiUsageFromResponse(input.response);
  const model = stringField(input.response.model) ?? input.model;
  if (!model) throw new Error("OpenAI response model is required.");
  const responseId = stringField(input.response.id);
  const operation = input.operation ?? "openai.sdk";
  const observedCost = input.observedCost ?? null;
  const currency = input.currency ?? "USD";

  return AiUsageObservedSchema.parse({
    schema_version: "1.0",
    message_id: messageId("msg_openai", operation, responseId ?? `${input.occurredAt ?? Date.now()}`),
    kind: "ingest_message",
    type: "ai.usage.observed",
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    source: {
      system: "openai-sdk",
      actor: input.sourceActor ?? "provider-sdk",
    },
    workspace: {
      key: input.workspaceKey,
    },
    idempotency_key: input.idempotencyKey ?? (responseId ? `openai-sdk:${operation}:${responseId}` : undefined),
    payload: {
      task: input.taskKey ? { key: input.taskKey } : null,
      run: input.runId ? { id: input.runId } : null,
      usage: {
        provider: "openai",
        model,
        usage_kind: usage.kind,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cached_input_tokens: usage.cachedInputTokens,
        reasoning_output_tokens: usage.reasoningOutputTokens,
        total_tokens: usage.totalTokens,
        observed_cost: observedCost,
        observed_currency: observedCost == null ? null : currency,
        accuracy_mode: "exact",
        pricing_mode: observedCost == null ? null : "provider_reported",
        raw_usage: usage.raw,
      },
      prompt_snapshot: input.promptSnapshot ?? undefined,
      source_context: {
        tool: "openai-sdk",
        capture_mode: "provider_sdk_response",
        provider_sdk: {
          provider: "openai",
          operation,
          response_id: responseId,
          request_id: stringField(input.response._request_id) ?? stringField(input.response.request_id),
        },
        token_estimation: {
          input: {
            mode: "observed",
            method: "provider_reported",
            scope: "provider_usage",
            tokens: usage.inputTokens,
          },
          output: {
            mode: "observed",
            method: "provider_reported",
            scope: "provider_usage",
            tokens: usage.outputTokens,
          },
          total_tokens: usage.totalTokens,
        },
      },
    },
  });
}

interface OpenAiUsageFields {
  kind: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number;
  raw: Record<string, unknown>;
}

function openAiUsageFromResponse(response: Record<string, unknown>): OpenAiUsageFields {
  const usage = recordField(response.usage);
  if (!usage) throw new Error("OpenAI response usage is required.");

  const inputTokens = numberField(usage.input_tokens) ?? numberField(usage.prompt_tokens);
  const outputTokens = numberField(usage.output_tokens) ?? numberField(usage.completion_tokens);
  const totalTokens = numberField(usage.total_tokens);
  if (inputTokens == null && outputTokens == null && totalTokens == null) {
    throw new Error("OpenAI response usage must include token counts.");
  }

  const inputDetails =
    recordField(usage.input_tokens_details) ?? recordField(usage.prompt_tokens_details);
  const outputDetails =
    recordField(usage.output_tokens_details) ?? recordField(usage.completion_tokens_details);

  const normalizedInput = inputTokens ?? Math.max(0, (totalTokens ?? 0) - (outputTokens ?? 0));
  const normalizedOutput = outputTokens ?? Math.max(0, (totalTokens ?? 0) - normalizedInput);
  const normalizedTotal = totalTokens ?? normalizedInput + normalizedOutput;

  return {
    kind: usageKindForResponse(response),
    inputTokens: normalizedInput,
    outputTokens: normalizedOutput,
    cachedInputTokens: numberField(inputDetails?.cached_tokens),
    reasoningOutputTokens: numberField(outputDetails?.reasoning_tokens),
    totalTokens: normalizedTotal,
    raw: usage,
  };
}

function usageKindForResponse(response: Record<string, unknown>): string {
  const object = stringField(response.object);
  if (object?.includes("chat.completion")) return "chat_completion";
  if (object?.includes("response")) return "response";
  return "chat_completion";
}

function messageId(prefix: string, operation: string, value: string): string {
  return `${prefix}_${slug(`${operation}_${value}`).slice(0, 80)}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_") || "unknown";
}

function recordField(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
