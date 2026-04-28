import { describe, expect, it } from "vitest";
import { openAiUsageObservedFromResponse } from "./index.js";

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
