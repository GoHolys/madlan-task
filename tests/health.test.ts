import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/health/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("health endpoint", () => {
  it("reports ready when the selected model provider is configured", async () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "test-key");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      modelConfigured: true,
      modelProvider: "groq",
    });
  });

  it("fails readiness when the selected model provider has no key", async () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      modelConfigured: false,
      modelProvider: null,
    });
  });
});
