/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handler: null as ((request: Request) => Promise<Response> | Response) | null,
  createClient: vi.fn(),
}));

vi.mock("https://deno.land/std@0.190.0/http/server.ts", () => ({
  serve: (handler: (request: Request) => Promise<Response> | Response) => {
    mocks.handler = handler;
  },
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2.75.0", () => ({
  createClient: mocks.createClient,
}));

vi.mock("../../supabase/functions/_shared/tts-router.ts", () => ({
  planTtsSynthesis: vi.fn(),
  resolveProfileVoice: vi.fn(),
  synthesizeSpeechStream: vi.fn(),
  ttsCacheKey: vi.fn(),
}));

vi.mock("../../supabase/functions/_shared/elevenlabs.ts", () => ({
  elevenlabsMessageStream: vi.fn(),
}));

vi.mock("../../supabase/functions/_shared/provider-types.ts", () => ({
  NeedsConfigError: class NeedsConfigError extends Error {},
}));

describe("paige-tts browser preflight", () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.handler = null;
    vi.stubGlobal("Deno", {
      env: { get: (name: string) => name },
    });

    const edgeModulePath = "../../supabase/functions/paige-tts/index.ts";
    await vi.importActual(edgeModulePath);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts POST with Authorization, Content-Type, and Idempotency-Key", async () => {
    expect(mocks.handler).not.toBeNull();

    const response = await mocks.handler!(
      new Request("https://example.supabase.co/functions/v1/paige-tts", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers":
            "authorization, content-type, idempotency-key",
        },
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);

    const allowedHeaders = (response.headers.get("Access-Control-Allow-Headers") ?? "")
      .toLowerCase()
      .split(",")
      .map((header) => header.trim());

    expect(allowedHeaders).toEqual(
      expect.arrayContaining(["authorization", "content-type", "idempotency-key"]),
    );
  });
});
