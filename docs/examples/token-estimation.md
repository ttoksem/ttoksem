# Token Estimation Examples

This example tells an assistant how to record token values when exact provider usage is not available.

The goal is simple input behavior:

```text
Record the best-known numeric token values.
Record where those values came from.
Do not ask the user to choose internal estimation fields.
```

## Field Meaning

Use token columns as the current best-known numbers:

```text
input_tokens   current best-known input token count
output_tokens  current best-known output token count
total_tokens   input_tokens + output_tokens when either side is known
```

Use `accuracy_mode` for the overall usage confidence:

```text
exact      provider or runtime reported the usage
estimated  assistant/tool estimated the usage
manual     a person entered or corrected the usage
```

Until dedicated token provenance columns exist, put token provenance in `payload.source_context.token_estimation`.

## Decision Table

```text
Provider usage is available
  token values: provider numbers
  accuracy_mode: exact
  token_estimation.mode: observed
  token_estimation.method: provider_reported
  token_estimation.scope: provider_usage

Only prompt or response text is available
  token values: ceil(character_count / 4), minimum 1
  accuracy_mode: estimated
  token_estimation.mode: estimated
  token_estimation.method: chars_div_4
  token_estimation.scope: user_prompt_only or assistant_response_text

Explicit token numbers are entered by a person or assistant
  token values: entered numbers
  accuracy_mode: manual
  token_estimation.mode: manual
  token_estimation.method: user_entered

No tokens, text, units, or observed cost are available
  do not invent exact-looking token counts
  record a non-token unit such as unit_count=1 and unit_type=conversation_turn, or skip the usage event
```

## CLI Example: Codex Turn With Text

For a chat assistant, prefer this shape when prompt and response text are known:

```bash
pnpm cli usage codex-turn \
  --workspace ttoksem-dev \
  --task document-token-estimation-examples \
  --prompt-text "예시를 넣어줘서 ai로 읽어도 제대로된 값을 넣게 알려줘" \
  --response-text "토큰 추정 예시를 추가하겠습니다." \
  --started-at 2026-04-27T05:40:00.000Z \
  --ended-at 2026-04-27T05:40:03.000Z
```

The CLI estimates token counts from text length and stores provenance automatically:

```json
{
  "usage": {
    "input_tokens": 8,
    "output_tokens": 5,
    "total_tokens": 13,
    "accuracy_mode": "estimated",
    "pricing_mode": "unpriced",
    "unpriced_reason": "missing_pricing_rule"
  },
  "source_context": {
    "tool": "codex-chat",
    "capture_mode": "assistant_estimated_turn",
    "token_estimation": {
      "input": {
        "mode": "estimated",
        "method": "chars_div_4",
        "scope": "user_prompt_only",
        "source": "prompt_text",
        "chars": 31,
        "tokens": 8,
        "version": "v1"
      },
      "output": {
        "mode": "estimated",
        "method": "chars_div_4",
        "scope": "assistant_response_text",
        "source": "response_text",
        "chars": 18,
        "tokens": 5,
        "version": "v1"
      },
      "total_tokens": 13
    }
  }
}
```

If the assistant only has the latest user prompt, set the input scope to `user_prompt_only`. Do not imply this is the full model context.

## CLI Example: Explicit Estimated Character Counts

When full text should not be stored but character counts are known, pass character counts:

```bash
pnpm cli usage codex-turn \
  --workspace ttoksem-dev \
  --task document-token-estimation-examples \
  --input-chars 1200 \
  --output-chars 2400 \
  --prompt-mode none
```

Expected interpretation:

```json
{
  "usage": {
    "input_tokens": 300,
    "output_tokens": 600,
    "total_tokens": 900,
    "accuracy_mode": "estimated"
  },
  "source_context": {
    "token_estimation": {
      "input": {
        "mode": "estimated",
        "method": "chars_div_4",
        "scope": "user_prompt_only",
        "source": "input_chars_option",
        "chars": 1200,
        "tokens": 300,
        "version": "v1"
      },
      "output": {
        "mode": "estimated",
        "method": "chars_div_4",
        "scope": "assistant_response_text",
        "source": "output_chars_option",
        "chars": 2400,
        "tokens": 600,
        "version": "v1"
      },
      "total_tokens": 900
    }
  }
}
```

## CLI Example: Explicit Token Counts

When a person or assistant already has token numbers but they did not come from provider usage, pass token counts directly:

```bash
pnpm cli usage codex-turn \
  --workspace ttoksem-dev \
  --task document-token-estimation-examples \
  --input-tokens 1000 \
  --output-tokens 300 \
  --prompt-mode none
```

Expected interpretation:

```json
{
  "usage": {
    "input_tokens": 1000,
    "output_tokens": 300,
    "total_tokens": 1300,
    "accuracy_mode": "manual"
  },
  "source_context": {
    "token_estimation": {
      "input": {
        "mode": "manual",
        "method": "user_entered",
        "scope": "user_prompt_only",
        "source": "input_tokens_option",
        "tokens": 1000
      },
      "output": {
        "mode": "manual",
        "method": "user_entered",
        "scope": "assistant_response_text",
        "source": "output_tokens_option",
        "tokens": 300
      },
      "total_tokens": 1300
    }
  }
}
```

## Canonical JSON Example: Provider-Reported Usage

When importing provider usage, keep the provider numbers and mark them as observed:

```json
{
  "schema_version": "1.0",
  "message_id": "msg_provider_001",
  "kind": "ingest_message",
  "type": "ai.usage.observed",
  "occurred_at": "2026-04-27T05:40:00.000Z",
  "source": {
    "system": "openai",
    "actor": "provider-import"
  },
  "workspace": {
    "key": "ttoksem-dev"
  },
  "payload": {
    "task": {
      "key": "implement-codex-turn-logging"
    },
    "usage": {
      "provider": "openai",
      "model": "gpt-5.5",
      "usage_kind": "chat_completion",
      "input_tokens": 1234,
      "output_tokens": 321,
      "total_tokens": 1555,
      "observed_cost": 0.0123,
      "observed_currency": "USD",
      "accuracy_mode": "exact",
      "pricing_mode": "provider_reported",
      "raw_usage": {
        "input_tokens": 1234,
        "output_tokens": 321,
        "total_tokens": 1555
      }
    },
    "source_context": {
      "token_estimation": {
        "input": {
          "mode": "observed",
          "method": "provider_reported",
          "scope": "provider_usage",
          "tokens": 1234
        },
        "output": {
          "mode": "observed",
          "method": "provider_reported",
          "scope": "provider_usage",
          "tokens": 321
        },
        "total_tokens": 1555
      }
    }
  }
}
```

## What Not To Do

Do not store an estimated number as if it were exact:

```json
{
  "input_tokens": 1,
  "accuracy_mode": "exact"
}
```

Do not hide the scope of a partial estimate:

```json
{
  "input_tokens": 1,
  "accuracy_mode": "estimated",
  "source_context": {
    "token_estimation": {
      "input": {
        "method": "chars_div_4"
      }
    }
  }
}
```

Prefer this:

```json
{
  "input_tokens": 1,
  "accuracy_mode": "estimated",
  "source_context": {
    "token_estimation": {
      "input": {
        "mode": "estimated",
        "method": "chars_div_4",
        "scope": "user_prompt_only",
        "source": "prompt_text",
        "chars": 2,
        "tokens": 1,
        "version": "v1"
      }
    }
  }
}
```

This makes a small value like `input_tokens=1` explainable instead of misleading.
