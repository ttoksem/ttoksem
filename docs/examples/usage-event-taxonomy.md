# Usage Event Taxonomy

This example describes how an assistant or integration should record usage when a single user request triggers multiple billable or measurable operations.

The important rule:

```text
task = user goal
run = one explicit request, job, or attempt
usage_event = one cost-bearing or usage-measured operation
```

Do not force everything into one `conversation_turn`. A RAG answer, agent run, or workflow can create several usage events under the same task/run.

## Recommended Usage Kinds

Use stable, descriptive `usage_kind` values. The schema currently accepts strings so integrations can add provider-specific kinds, but these are good defaults:

```text
conversation_turn       high-level assistant turn when granular events are unavailable
chat_completion         text generation from a chat/completion/responses API
embedding               embedding request
rerank                  document/chunk reranking
vector_search           vector database query
web_search              paid web search API call
external_api_call       paid or rate-limited non-AI API call
tool_call               local or remote tool execution when it has measurable usage
image_generation        image generation
image_edit              image editing
audio_transcription     speech-to-text
speech_generation       text-to-speech
batch_job               asynchronous/batch AI job
storage_operation       paid storage/read/write operation
local_compute           local measured compute, usually unpriced unless a rule exists
```

## Unit Mapping

Use the most specific existing fields first:

```text
token-priced model call
  input_tokens, output_tokens, total_tokens

embedding
  input_tokens, total_tokens

image generation or editing
  image_count or unit_count + unit_type=image

audio
  seconds, or unit_count + unit_type=audio_second

request-priced API call
  request_count, or unit_count + unit_type=request

vector DB query
  request_count, unit_count + unit_type=query, or provider raw usage

storage operation
  unit_count + unit_type=byte, gb_month, read_unit, write_unit, or request

unknown but still measurable event
  unit_count + unit_type=<integration-specific unit>
```

If provider cost is known, use `observed_cost` and `observed_currency`. If only a pricing rule was applied, use `estimated_cost` and `estimated_currency`. If no pricing rule exists, keep the usage event and set `pricing_mode=unpriced`.

## RAG Example

A user asks a question against a document collection. One assistant answer might create four usage events:

```text
task: answer-doc-question
run: run_rag_answer_001

1. embedding
2. vector_search
3. rerank
4. chat_completion
```

### Query Embedding

```json
{
  "schema_version": "1.0",
  "message_id": "msg_rag_embed_001",
  "kind": "ingest_message",
  "type": "ai.usage.observed",
  "occurred_at": "2026-04-27T06:00:00.000Z",
  "source": {
    "system": "openai",
    "actor": "rag-pipeline"
  },
  "workspace": {
    "key": "ttoksem-dev"
  },
  "payload": {
    "task": {
      "key": "answer-doc-question"
    },
    "run": {
      "id": "run_rag_answer_001"
    },
    "usage": {
      "provider": "openai",
      "model": "text-embedding-3-small",
      "usage_kind": "embedding",
      "input_tokens": 42,
      "total_tokens": 42,
      "estimated_cost": 0.000001,
      "estimated_currency": "USD",
      "accuracy_mode": "estimated",
      "pricing_mode": "rule_calculated"
    },
    "source_context": {
      "pipeline": "rag",
      "step": "query_embedding"
    }
  }
}
```

### Vector Search

```json
{
  "schema_version": "1.0",
  "message_id": "msg_rag_vector_001",
  "kind": "ingest_message",
  "type": "ai.usage.observed",
  "occurred_at": "2026-04-27T06:00:01.000Z",
  "source": {
    "system": "pinecone",
    "actor": "rag-pipeline"
  },
  "workspace": {
    "key": "ttoksem-dev"
  },
  "payload": {
    "task": {
      "key": "answer-doc-question"
    },
    "run": {
      "id": "run_rag_answer_001"
    },
    "usage": {
      "provider": "pinecone",
      "model": "docs-index",
      "usage_kind": "vector_search",
      "request_count": 1,
      "unit_count": 12,
      "unit_type": "matched_chunk",
      "accuracy_mode": "estimated",
      "pricing_mode": "unpriced",
      "unpriced_reason": "missing_pricing_rule",
      "raw_usage": {
        "top_k": 12,
        "namespace": "docs"
      }
    },
    "source_context": {
      "pipeline": "rag",
      "step": "retrieve"
    }
  }
}
```

### Rerank

```json
{
  "schema_version": "1.0",
  "message_id": "msg_rag_rerank_001",
  "kind": "ingest_message",
  "type": "ai.usage.observed",
  "occurred_at": "2026-04-27T06:00:02.000Z",
  "source": {
    "system": "cohere",
    "actor": "rag-pipeline"
  },
  "workspace": {
    "key": "ttoksem-dev"
  },
  "payload": {
    "task": {
      "key": "answer-doc-question"
    },
    "run": {
      "id": "run_rag_answer_001"
    },
    "usage": {
      "provider": "cohere",
      "model": "rerank-v3.5",
      "usage_kind": "rerank",
      "unit_count": 12,
      "unit_type": "document",
      "accuracy_mode": "estimated",
      "pricing_mode": "unpriced",
      "unpriced_reason": "missing_pricing_rule"
    },
    "source_context": {
      "pipeline": "rag",
      "step": "rerank"
    }
  }
}
```

### Final Generation

```json
{
  "schema_version": "1.0",
  "message_id": "msg_rag_generate_001",
  "kind": "ingest_message",
  "type": "ai.usage.observed",
  "occurred_at": "2026-04-27T06:00:03.000Z",
  "source": {
    "system": "openai",
    "actor": "rag-pipeline"
  },
  "workspace": {
    "key": "ttoksem-dev"
  },
  "payload": {
    "task": {
      "key": "answer-doc-question"
    },
    "run": {
      "id": "run_rag_answer_001"
    },
    "usage": {
      "provider": "openai",
      "model": "gpt-5.5",
      "usage_kind": "chat_completion",
      "input_tokens": 3100,
      "output_tokens": 450,
      "total_tokens": 3550,
      "accuracy_mode": "exact",
      "pricing_mode": "provider_reported",
      "observed_cost": 0.018,
      "observed_currency": "USD",
      "raw_usage": {
        "input_tokens": 3100,
        "output_tokens": 450,
        "total_tokens": 3550
      }
    },
    "source_context": {
      "pipeline": "rag",
      "step": "generate",
      "retrieved_chunk_count": 12,
      "used_chunk_count": 5
    }
  }
}
```

## External API Example

If an agent calls a paid API such as search, maps, OCR, payment enrichment, or market data, record it as its own event.

```json
{
  "schema_version": "1.0",
  "message_id": "msg_api_search_001",
  "kind": "ingest_message",
  "type": "ai.usage.observed",
  "occurred_at": "2026-04-27T06:10:00.000Z",
  "source": {
    "system": "tavily",
    "actor": "agent-tool"
  },
  "workspace": {
    "key": "ttoksem-dev"
  },
  "payload": {
    "task": {
      "key": "research-vendor-pricing"
    },
    "run": {
      "id": "run_vendor_pricing_001"
    },
    "usage": {
      "provider": "tavily",
      "model": "search-api",
      "usage_kind": "web_search",
      "request_count": 1,
      "unit_count": 5,
      "unit_type": "search_result",
      "observed_cost": 0.002,
      "observed_currency": "USD",
      "accuracy_mode": "exact",
      "pricing_mode": "provider_reported",
      "raw_usage": {
        "query": "AI pricing API examples",
        "result_count": 5
      }
    },
    "source_context": {
      "tool": "web_search",
      "endpoint": "/search"
    }
  }
}
```

## Agent Run Example

An agent run should usually avoid a single huge event. Record each measurable step:

```text
task: migrate-repo-to-new-api
run: run_agent_migrate_api_001

usage_event 1: chat_completion       plan
usage_event 2: external_api_call     GitHub issue lookup
usage_event 3: embedding             code search query embedding
usage_event 4: vector_search         code index lookup
usage_event 5: chat_completion       patch generation
usage_event 6: local_compute         test run duration, unpriced
usage_event 7: chat_completion       final response
```

This lets reports answer different questions:

```text
How much did the user goal cost?
  group by task

How much did this run cost?
  group by run_id

Where did money go?
  group by provider and usage_kind

Which steps are still vague?
  filter pricing_mode=unpriced or accuracy_mode=estimated
```

## Repeated Task Example

A repeated task keeps one task key and creates one run per execution when the execution groups several measurable events.

```text
task: refresh-pricing-catalog

run: run_refresh_pricing_20260427
  usage_event 1: web_search             check upstream pricing source
  usage_event 2: external_api_call      fetch pricing snapshot
  usage_event 3: local_compute          normalize snapshot, unpriced
  usage_event 4: local_compute          reprice local ledger, unpriced

run: run_refresh_pricing_20260428
  usage_event 1: external_api_call      fetch pricing snapshot
  usage_event 2: local_compute          normalize snapshot, unpriced
  usage_event 3: local_compute          reprice local ledger, unpriced
```

This lets reports answer:

```text
How much has this repeated goal cost overall?
  group by task

How much did the latest execution cost?
  filter by run_id
```

If a repetition is just one simple model call and no one needs execution-level reporting, recording `task -> usage_event` without a run is acceptable.

## Dashboard Defaults

The dashboard should not show every field by default.

Default row:

```text
time | task | provider/model | kind | tokens/units | cost | confidence
```

Expanded detail:

```text
run
source_context.pipeline
source_context.step
raw_usage
token_estimation
pricing_mode and unpriced_reason
```

For most users, the important distinction is:

```text
exact      provider reported it
estimated  ttoksem or an integration estimated it
manual     a person entered or corrected it
unpriced   usage is known, but cost is not priced yet
```

## What Not To Do

Do not collapse a RAG pipeline into only one `conversation_turn` if the individual steps are known.

Do not store an external paid API call as token usage just because it happened inside an AI workflow.

Do not invent model names for non-model APIs. Use a stable product, endpoint, index, or plan identifier in `model`.

Do not hide unknown pricing by dropping the event. Keep the usage event with `pricing_mode=unpriced` so it can be priced later.
