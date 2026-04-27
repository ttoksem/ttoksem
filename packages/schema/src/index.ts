import { z } from "zod";

const isoUtc = z.string().regex(/Z$/, "timestamp must be UTC ISO-8601 text ending in Z");
const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();
const nullableInteger = z.number().int().nonnegative().nullable().optional();

export const ExternalRefSchema = z
  .object({
    system: z.string().min(1),
    id: z.string().min(1),
    url: z.string().optional(),
  })
  .passthrough();

export const WorkspaceRecordSchema = z.object({
  id: z.string().startsWith("ws_"),
  key: z.string().min(1),
  name: z.string().min(1),
  description: nullableString,
  status: z.enum(["active", "archived"]),
  root_path: nullableString,
  active_task_id: z.string().startsWith("task_").nullable().optional(),
  source: z.string(),
  external_ref_json: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata_json: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: isoUtc,
  archived_at: nullableString,
  updated_at: isoUtc,
});

export type WorkspaceRecord = z.infer<typeof WorkspaceRecordSchema>;

export const TaskRecordSchema = z.object({
  id: z.string().startsWith("task_"),
  workspace_id: z.string().startsWith("ws_"),
  key: z.string().min(1),
  name: z.string().min(1),
  description: nullableString,
  type: nullableString,
  status: z.enum(["open", "active", "closed", "archived"]),
  definition_mode: z.enum(["explicit", "suggested", "imported"]),
  source: z.string(),
  external_ref_json: z.record(z.string(), z.unknown()).nullable().optional(),
  labels_json: z.array(z.string()).nullable().optional(),
  metadata_json: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: isoUtc,
  started_at: nullableString,
  closed_at: nullableString,
  updated_at: isoUtc,
});

export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export const UsageFieldsSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    usage_kind: z.string().min(1),
    started_at: isoUtc.nullable().optional(),
    ended_at: isoUtc.nullable().optional(),
    duration_ms: nullableInteger,
    input_tokens: nullableInteger,
    output_tokens: nullableInteger,
    cached_input_tokens: nullableInteger,
    cache_write_input_tokens: nullableInteger,
    reasoning_output_tokens: nullableInteger,
    audio_input_tokens: nullableInteger,
    audio_output_tokens: nullableInteger,
    total_tokens: nullableInteger,
    image_count: nullableInteger,
    seconds: nullableNumber,
    request_count: nullableInteger,
    unit_count: nullableNumber,
    unit_type: nullableString,
    observed_cost: nullableNumber,
    observed_currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    estimated_cost: nullableNumber,
    estimated_currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    accuracy_mode: z.enum(["exact", "estimated", "manual"]),
    pricing_mode: z
      .enum(["provider_reported", "rule_calculated", "manual", "unpriced"])
      .nullable()
      .optional(),
    unpriced_reason: z
      .enum([
        "missing_pricing_rule",
        "missing_usage_units",
        "unsupported_usage_unit",
        "ambiguous_model_match",
        "mixed_currency",
      ])
      .nullable()
      .optional(),
    raw_usage: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine(
    (value) =>
      value.input_tokens != null ||
      value.output_tokens != null ||
      (value.unit_count != null && value.unit_type != null) ||
      value.observed_cost != null,
    "usage must include tokens, units, or observed cost",
  );

export type UsageFields = z.infer<typeof UsageFieldsSchema>;

export const AiUsageObservedSchema = z.object({
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+$/),
  message_id: z.string().min(1),
  kind: z.literal("ingest_message"),
  type: z.literal("ai.usage.observed"),
  occurred_at: isoUtc,
  source: z.object({
    system: z.string().min(1),
    version: z.string().optional(),
    actor: z.string().optional(),
  }),
  workspace: z
    .object({
      id: z.string().optional(),
      key: z.string().optional(),
      root_path: z.string().optional(),
      external_ref: ExternalRefSchema.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "workspace resolver is required"),
  trace: z
    .object({
      trace_id: z.string().optional(),
      span_id: z.string().optional(),
      parent_span_id: z.string().optional(),
    })
    .optional(),
  idempotency_key: z.string().min(1).optional(),
  payload: z.object({
    task: z
      .object({
        id: z.string().optional(),
        key: z.string().optional(),
        external_ref: ExternalRefSchema.optional(),
      })
      .nullable()
      .optional(),
    run: z
      .object({
        id: z.string().optional(),
        session_id: z.string().optional(),
        external_ref: ExternalRefSchema.optional(),
      })
      .nullable()
      .optional(),
    usage: UsageFieldsSchema,
    prompt_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    source_context: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
});

export type AiUsageObserved = z.infer<typeof AiUsageObservedSchema>;

export const UsageEventRecordSchema = z.object({
  id: z.string().startsWith("usage_"),
  workspace_id: z.string().startsWith("ws_"),
  task_id: z.string().startsWith("task_").nullable().optional(),
  run_id: z.string().startsWith("run_").nullable().optional(),
  message_id: z.string(),
  source: z.string(),
  idempotency_key: nullableString,
  occurred_at: isoUtc,
  started_at: nullableString,
  ended_at: nullableString,
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  provider: z.string(),
  model: z.string(),
  usage_kind: z.string(),
  input_tokens: z.number().int().nullable().optional(),
  output_tokens: z.number().int().nullable().optional(),
  total_tokens: z.number().int().nullable().optional(),
  observed_cost_nanos: z.number().int().nullable().optional(),
  estimated_cost_nanos: z.number().int().nullable().optional(),
  observed_currency: nullableString,
  estimated_currency: nullableString,
  accuracy_mode: z.enum(["exact", "estimated", "manual"]),
  pricing_mode: z
    .enum(["provider_reported", "rule_calculated", "manual", "unpriced"])
    .nullable()
    .optional(),
  unpriced_reason: nullableString,
  assignment_status: z.enum(["unassigned", "suggested", "assigned", "dismissed"]),
  payload_json: z.record(z.string(), z.unknown()),
  created_at: isoUtc,
});

export type UsageEventRecord = z.infer<typeof UsageEventRecordSchema>;

export const DailyReportSchema = z.object({
  workspace: WorkspaceRecordSchema,
  date: z.string(),
  estimated_total: z.number(),
  observed_total: z.number(),
  currency: z.string().nullable(),
  event_count: z.number().int(),
  unpriced_count: z.number().int(),
});

export type DailyReport = z.infer<typeof DailyReportSchema>;
