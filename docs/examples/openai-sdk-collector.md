# OpenAI SDK Collector

ttoksem can record exact token usage from an OpenAI SDK response object.

This is a collector adapter, not an LLM execution wrapper. The application still calls OpenAI directly. After the SDK call returns, pass the saved response JSON to ttoksem.

## CLI

```bash
pnpm cli usage openai-response \
  --workspace ttoksem-dev \
  --task answer-doc-question \
  --run-id run_rag_answer_001 \
  --operation chat.completions.create \
  --file ./openai-response.json
```

For an ambiguous user goal, omit `--task` so the event lands in the inbox.

## Supported Usage Shapes

Responses API style:

```json
{
  "id": "resp_001",
  "object": "response",
  "model": "gpt-5.5",
  "usage": {
    "input_tokens": 1000,
    "output_tokens": 120,
    "total_tokens": 1120,
    "input_tokens_details": {
      "cached_tokens": 300
    },
    "output_tokens_details": {
      "reasoning_tokens": 40
    }
  }
}
```

Chat Completions style:

```json
{
  "id": "chatcmpl_001",
  "object": "chat.completion",
  "model": "gpt-5.5",
  "usage": {
    "prompt_tokens": 1000,
    "completion_tokens": 120,
    "total_tokens": 1120,
    "prompt_tokens_details": {
      "cached_tokens": 300
    },
    "completion_tokens_details": {
      "reasoning_tokens": 40
    }
  }
}
```

## Recorded Message

The collector records:

- `provider: openai`
- exact input/output/total tokens
- cached input tokens when present
- reasoning output tokens when present
- raw provider `usage` under `payload.usage.raw_usage`
- `source.system: openai-sdk`
- `source_context.provider_sdk.operation`
- deterministic idempotency when the response has an `id`

If `--observed-cost` is provided, the usage event uses `provider_reported` pricing. Otherwise ttoksem prices the event from local pricing rules when possible.
