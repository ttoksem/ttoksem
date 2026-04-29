import { describe, expect, it } from "vitest";
import { openAiUsageObservedFromResponse, anthropicUsageObservedFromResponse } from "./index.js";

describe("openAiUsageObservedFromResponse", () => {
  it("maps OpenAI Responses usage into a canonical usage message", () => {
    const message = openAiUsageObservedFromResponse({
      workspaceKey: "test",
      taskKey: "capture-openai",
      runId: "run_openai_001",
      operation: "responses.create",
      occurredAt: "2026-04-28T00:00:00.000Z",
      response: {
        id: "resp_001",
        object: "response",
        model: "gpt-5.5",
        usage: {
          input_tokens: 100,
          output_tokens: 30,
          total_tokens: 130,
          input_tokens_details: {
            cached_tokens: 20,
          },
          output_tokens_details: {
            reasoning_tokens: 8,
          },
        },
      },
    });

    expect(message).toMatchObject({
      source: { system: "openai-sdk" },
      workspace: { key: "test" },
      idempotency_key: "openai-sdk:responses.create:resp_001",
      payload: {
        task: { key: "capture-openai" },
        run: { id: "run_openai_001" },
        usage: {
          provider: "openai",
          model: "gpt-5.5",
          usage_kind: "response",
          input_tokens: 100,
          output_tokens: 30,
          cached_input_tokens: 20,
          reasoning_output_tokens: 8,
          total_tokens: 130,
          accuracy_mode: "exact",
        },
      },
    });
  });

  it("maps Chat Completions usage fields and provider-reported cost", () => {
    const message = openAiUsageObservedFromResponse({
      workspaceKey: "test",
      operation: "chat.completions.create",
      occurredAt: "2026-04-28T00:00:00.000Z",
      observedCost: 0.0012,
      response: {
        id: "chatcmpl_001",
        object: "chat.completion",
        model: "gpt-5.5-mini",
        usage: {
          prompt_tokens: 40,
          completion_tokens: 10,
          total_tokens: 50,
          prompt_tokens_details: {
            cached_tokens: 5,
          },
          completion_tokens_details: {
            reasoning_tokens: 2,
          },
        },
      },
    });

    expect(message.payload.usage).toMatchObject({
      usage_kind: "chat_completion",
      input_tokens: 40,
      output_tokens: 10,
      cached_input_tokens: 5,
      reasoning_output_tokens: 2,
      observed_cost: 0.0012,
      observed_currency: "USD",
      pricing_mode: "provider_reported",
    });
  });
});

describe("anthropicUsageObservedFromResponse", () => {
  it("maps Anthropic Messages usage into a canonical usage message", () => {
    const message = anthropicUsageObservedFromResponse({
      workspaceKey: "test",
      taskKey: "capture-anthropic",
      runId: "run_anthropic_001",
      operation: "messages.create",
      occurredAt: "2026-04-29T00:00:00.000Z",
      response: {
        id: "msg_001",
        type: "message",
        model: "claude-sonnet-4-6",
        usage: {
          input_tokens: 200,
          output_tokens: 50,
          cache_read_input_tokens: 80,
          cache_creation_input_tokens: 30,
        },
      },
    });

    expect(message).toMatchObject({
      source: { system: "anthropic-sdk" },
      workspace: { key: "test" },
      idempotency_key: "anthropic-sdk:messages.create:msg_001",
      payload: {
        task: { key: "capture-anthropic" },
        run: { id: "run_anthropic_001" },
        usage: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          usage_kind: "message",
          input_tokens: 200,
          output_tokens: 50,
          cached_input_tokens: 80,
          cache_write_input_tokens: 30,
          total_tokens: 250,
          accuracy_mode: "exact",
        },
      },
    });
  });

  it("maps usage without cache fields and with provider-reported cost", () => {
    const message = anthropicUsageObservedFromResponse({
      workspaceKey: "test",
      operation: "messages.create",
      occurredAt: "2026-04-29T00:00:00.000Z",
      observedCost: 0.005,
      response: {
        id: "msg_002",
        model: "claude-haiku-4-5-20251001",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
        },
      },
    });

    expect(message.payload.usage).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      usage_kind: "message",
      input_tokens: 100,
      output_tokens: 20,
      cached_input_tokens: null,
      cache_write_input_tokens: null,
      total_tokens: 120,
      observed_cost: 0.005,
      observed_currency: "USD",
      pricing_mode: "provider_reported",
    });
  });
});
