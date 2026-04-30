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

// ── Anthropic SDK collector ───────────────────────────────────────────────────

export interface AnthropicUsageObservedInput {
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

export function anthropicUsageObservedFromResponse(input: AnthropicUsageObservedInput): AiUsageObserved {
  const usage = anthropicUsageFromResponse(input.response);
  const model = stringField(input.response.model) ?? input.model;
  if (!model) throw new Error("Anthropic response model is required.");
  const responseId = stringField(input.response.id);
  const operation = input.operation ?? "anthropic.sdk";
  const observedCost = input.observedCost ?? null;
  const currency = input.currency ?? "USD";

  return AiUsageObservedSchema.parse({
    schema_version: "1.0",
    message_id: messageId("msg_anthropic", operation, responseId ?? `${input.occurredAt ?? Date.now()}`),
    kind: "ingest_message",
    type: "ai.usage.observed",
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    source: {
      system: "anthropic-sdk",
      actor: input.sourceActor ?? "provider-sdk",
    },
    workspace: { key: input.workspaceKey },
    idempotency_key: input.idempotencyKey ?? (responseId ? `anthropic-sdk:${operation}:${responseId}` : undefined),
    payload: {
      task: input.taskKey ? { key: input.taskKey } : null,
      run: input.runId ? { id: input.runId } : null,
      usage: {
        provider: "anthropic",
        model,
        usage_kind: "message",
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cached_input_tokens: usage.cacheReadInputTokens,
        cache_write_input_tokens: usage.cacheCreationInputTokens,
        total_tokens: usage.totalTokens,
        observed_cost: observedCost,
        observed_currency: observedCost == null ? null : currency,
        accuracy_mode: "exact",
        pricing_mode: observedCost == null ? null : "provider_reported",
        raw_usage: usage.raw,
      },
      prompt_snapshot: input.promptSnapshot ?? undefined,
      source_context: {
        tool: "anthropic-sdk",
        capture_mode: "provider_sdk_response",
        provider_sdk: {
          provider: "anthropic",
          operation,
          response_id: responseId,
        },
        token_estimation: {
          input: { mode: "observed", method: "provider_reported", scope: "provider_usage", tokens: usage.inputTokens },
          output: { mode: "observed", method: "provider_reported", scope: "provider_usage", tokens: usage.outputTokens },
          total_tokens: usage.totalTokens,
        },
      },
    },
  });
}

interface AnthropicUsageFields {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  totalTokens: number;
  raw: Record<string, unknown>;
}

function anthropicUsageFromResponse(response: Record<string, unknown>): AnthropicUsageFields {
  const usage = recordField(response.usage);
  if (!usage) throw new Error("Anthropic response usage is required.");

  const inputTokens = numberField(usage.input_tokens);
  const outputTokens = numberField(usage.output_tokens);
  if (inputTokens == null && outputTokens == null) {
    throw new Error("Anthropic response usage must include input_tokens and output_tokens.");
  }
  const normalizedInput = inputTokens ?? 0;
  const normalizedOutput = outputTokens ?? 0;

  return {
    inputTokens: normalizedInput,
    outputTokens: normalizedOutput,
    cacheReadInputTokens: numberField(usage.cache_read_input_tokens),
    cacheCreationInputTokens: numberField(usage.cache_creation_input_tokens),
    totalTokens: normalizedInput + normalizedOutput,
    raw: usage,
  };
}

// ── Claude session content summarizer ──────────────────────────────────────
// Each assistant message in a Claude Code session JSONL has a `content` array
// of blocks: text / tool_use / thinking. Importing only the token usage drops
// all of that — leaving downstream consumers (dashboard, reports) with no
// answer to "what did Claude actually do during this run?".
//
// This helper extracts a compact, display-ready summary that's safe to embed
// in payload.source_context.assistant_summary. Same shape is reused by the
// live JSONL fallback in the dashboard's runActions endpoint.

export interface ClaudeAssistantToolCall {
  /** Tool name as emitted by the model (Bash, Read, Edit, Task, …). */
  name: string;
  /** Single-line human-readable summary of the most informative input field. */
  summary: string;
  /**
   * Multi-line detail for expanded views: every input field rendered as
   * `key: value` with newlines preserved. Capped to keep payloads bounded.
   */
  detail: string;
}

export interface ClaudeAssistantSummary {
  /** First non-empty text block. Newlines preserved; ~1.5KB cap. */
  text_excerpt: string | null;
  /** First non-empty thinking block. Newlines preserved; ~1.2KB cap. */
  thinking_excerpt: string | null;
  /** Tool invocations in the order they appeared in the assistant message. */
  tool_calls: ClaudeAssistantToolCall[];
  /** True when an interleaved thinking block was present. */
  has_thinking: boolean;
}

const EMPTY_SUMMARY: ClaudeAssistantSummary = Object.freeze({
  text_excerpt: null,
  thinking_excerpt: null,
  tool_calls: [],
  has_thinking: false,
});

export function summarizeClaudeAssistantContent(content: unknown): ClaudeAssistantSummary {
  if (!Array.isArray(content)) return EMPTY_SUMMARY;
  let text_excerpt: string | null = null;
  let thinking_excerpt: string | null = null;
  let has_thinking = false;
  const tool_calls: ClaudeAssistantToolCall[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "";
    if (type === "text") {
      const t = stringField(block.text);
      if (t && !text_excerpt) text_excerpt = compact(t, 1500, true);
    } else if (type === "tool_use") {
      const name = stringField(block.name) ?? "tool";
      tool_calls.push({
        name,
        summary: summarizeToolUseInput(name, block.input),
        detail: detailToolUseInput(block.input),
      });
    } else if (type === "thinking") {
      has_thinking = true;
      const t = stringField(block.thinking);
      if (t && !thinking_excerpt) thinking_excerpt = compact(t, 1200, true);
    }
  }
  return { text_excerpt, thinking_excerpt, tool_calls, has_thinking };
}

function summarizeToolUseInput(name: string, input: unknown): string {
  const i = recordField(input);
  if (!i) return "";
  switch (name) {
    case "Bash":
      return compact(i.command, 160);
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return compact(i.file_path, 160);
    case "Grep": {
      const pattern = compact(i.pattern, 80);
      const path = stringField(i.path);
      return path ? `${pattern} in ${compact(path, 80)}` : pattern;
    }
    case "Glob":
      return compact(i.pattern, 160);
    case "WebFetch":
      return compact(i.url, 160);
    case "WebSearch":
      return compact(i.query, 160);
    case "Task": {
      const sub = stringField(i.subagent_type);
      const desc = stringField(i.description);
      if (sub && desc) return compact(`${sub} — ${desc}`, 160);
      return compact(desc ?? sub, 160);
    }
    case "TodoWrite": {
      const todos = Array.isArray(i.todos) ? i.todos : [];
      return `${todos.length} todo${todos.length === 1 ? "" : "s"}`;
    }
    case "ToolSearch":
      return compact(i.query, 160);
    case "Skill":
      return compact(i.skill, 160);
    case "ScheduleWakeup":
      return compact(i.reason, 160);
    default: {
      // Generic fallback: show the first scalar value (string/number) so we still
      // surface *something* when a new tool shows up that we don't know.
      for (const [, v] of Object.entries(i)) {
        if (typeof v === "string" || typeof v === "number") return compact(v, 160);
      }
      return "";
    }
  }
}

/**
 * Render every scalar input field as `key: value`, separator newlines.
 * For TodoWrite, expand each todo. Capped at ~1.5KB.
 */
function detailToolUseInput(input: unknown): string {
  const i = recordField(input);
  if (!i) return "";
  const lines: string[] = [];
  for (const [k, v] of Object.entries(i)) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      lines.push(`${k}: ${v}`);
    } else if (Array.isArray(v)) {
      // TodoWrite has todos: [{content, status, activeForm}, ...]; render readable.
      if (k === "todos") {
        v.forEach((t, idx) => {
          if (t && typeof t === "object") {
            const r = t as Record<string, unknown>;
            const status = stringField(r.status) ?? "?";
            const content = stringField(r.content) ?? "";
            lines.push(`todo[${idx}] (${status}): ${content}`);
          }
        });
      } else {
        lines.push(`${k}: [${v.length} items]`);
      }
    } else if (typeof v === "object") {
      lines.push(`${k}: ${JSON.stringify(v).slice(0, 200)}`);
    }
  }
  return compact(lines.join("\n"), 1500, true);
}

/**
 * Length-cap a string; when `preserveNewlines` is false, also collapse all
 * whitespace runs to a single space (suitable for single-line summaries).
 */
function compact(value: unknown, max: number, preserveNewlines = false): string {
  if (value == null) return "";
  let s = String(value);
  if (!preserveNewlines) {
    s = s.replace(/\s+/g, " ");
  } else {
    // Drop carriage returns and trailing whitespace per line; otherwise leave
    // newlines and indentation alone so multi-line output renders cleanly in
    // <pre> / white-space: pre-wrap.
    s = s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n");
  }
  s = s.trim();
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

// ── Shared helpers ────────────────────────────────────────────────────────────

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
