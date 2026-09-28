import { describe, expect, it } from "vitest";

import {
  getConfiguredProvider,
  getPlannerRuntimeConfig,
  PlannerError,
} from "../src/planner";

describe("planner provider configuration", () => {
  it("uses Groq by default when a Groq key is available", () => {
    const config = getPlannerRuntimeConfig({
      GROQ_API_KEY: "groq-test-key",
      OPENAI_API_KEY: "openai-test-key",
    });

    expect(config).toMatchObject({
      provider: "groq",
      apiKey: "groq-test-key",
      model: "openai/gpt-oss-20b",
      baseURL: "https://api.groq.com/openai/v1",
      timeoutMs: 10_000,
    });
  });

  it("still supports explicit OpenAI configuration", () => {
    const config = getPlannerRuntimeConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "openai-test-key",
      OPENAI_MODEL: "custom-model",
      AI_TIMEOUT_MS: "7500",
    });

    expect(config).toMatchObject({
      provider: "openai",
      apiKey: "openai-test-key",
      model: "custom-model",
      timeoutMs: 7_500,
    });
    expect(config.baseURL).toBeUndefined();
  });

  it("reports when the selected provider is not configured", () => {
    expect(
      getConfiguredProvider({
        AI_PROVIDER: "groq",
        OPENAI_API_KEY: "openai-test-key",
      }),
    ).toBeNull();
  });

  it("fails clearly when the selected provider has no key", () => {
    expect(() =>
      getPlannerRuntimeConfig({
        AI_PROVIDER: "groq",
      }),
    ).toThrowError(new PlannerError("GROQ_API_KEY is not configured"));
  });

  it("rejects unknown provider values", () => {
    expect(() =>
      getPlannerRuntimeConfig({
        AI_PROVIDER: "something-else",
        GROQ_API_KEY: "groq-test-key",
      }),
    ).toThrowError('AI_PROVIDER must be "auto", "groq", or "openai"');
  });
});
