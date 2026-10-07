// deno test --allow-import --node-modules-dir=none supabase/functions/_shared/provider-failure.test.ts
//
// INT-334 — classifyProviderFailure: a class only when the provider's response proves it; `unknown`
// otherwise. Messages below are the providers' documented wording (Anthropic error types, OpenAI
// error codes); the classifier never returns or keeps them.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { classifyProviderFailure as c, PROVIDER_FAILURE_CLASSES } from "./provider-failure.ts";

const A = (status: number, errorType: string | null, message: string | null = null) => c({ provider: "anthropic", status, errorType, message });
const O = (status: number, errorCode: string | null, message: string | null = null, errorType: string | null = null) =>
  c({ provider: "openai", status, errorCode, errorType, message });

Deno.test("Anthropic: each documented error type maps to its class", () => {
  assertEquals(A(401, "authentication_error", "invalid x-api-key"), "auth_config");
  assertEquals(A(403, "permission_error", "Your API key does not have permission to use the specified resource."), "auth_config");
  assertEquals(A(404, "not_found_error", "model: claude-x"), "model_unavailable");
  assertEquals(A(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"), "rate_limit");
  assertEquals(A(500, "api_error", "Internal server error"), "provider_outage");
  assertEquals(A(529, "overloaded_error", "Overloaded"), "provider_outage");
});

Deno.test("Anthropic 400s: billing and limits only when the provider says so; otherwise the request", () => {
  assertEquals(A(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."), "billing");
  assertEquals(A(400, "invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."), "rate_limit");
  assertEquals(A(400, "invalid_request_error", "tools.3.input_schema: JSON schema is invalid"), "invalid_request");
  assertEquals(A(400, "invalid_request_error", "thinking.type: Input should be 'adaptive'"), "invalid_request");
  assertEquals(A(400, "invalid_request_error", null), "invalid_request");
  assertEquals(A(400, null, null), "unknown", "a bare 400 with no type and no text proves nothing");
});

Deno.test("OpenAI: codes decide before status", () => {
  assertEquals(O(429, "insufficient_quota", "You exceeded your current quota, please check your plan and billing details."), "billing");
  assertEquals(O(429, "rate_limit_exceeded", "Rate limit reached for gpt-6.1-sol"), "rate_limit");
  assertEquals(O(429, null, "Too many requests"), "rate_limit");
  assertEquals(O(401, "invalid_api_key", "Incorrect API key provided"), "auth_config");
  assertEquals(O(404, "model_not_found", "The model `gpt-6.1-sol` does not exist or you do not have access to it."), "model_unavailable");
  assertEquals(O(400, null, "Invalid schema for function 'crm_lookup'", "invalid_request_error"), "invalid_request");
  assertEquals(O(503, null, "Service unavailable"), "provider_outage");
});

Deno.test("transport failures are outages; unknown stays unknown", () => {
  assertEquals(c({ provider: "openai", status: 0, transport: "timeout" }), "provider_outage");
  assertEquals(c({ provider: "anthropic", status: 0, transport: "network" }), "provider_outage");
  assertEquals(c({ provider: "anthropic", status: 0 }), "unknown");
  assertEquals(c({ provider: "openai", status: 404, message: "" }), "unknown", "a bare 404 could be a wrong URL as easily as a model");
  assertEquals(c({ provider: "openai", status: 418 }), "unknown");
});

Deno.test("only closed classes, and no message ever comes back", () => {
  const secret = "SECRET-REQUEST-MATERIAL";
  for (const s of [0, 200, 400, 401, 402, 403, 404, 413, 418, 422, 429, 500, 503, 529]) {
    const out = c({ provider: "anthropic", status: s, message: `credit balance ${secret}` });
    assertEquals(PROVIDER_FAILURE_CLASSES.includes(out), true);
    assertEquals(String(out).includes(secret), false);
  }
});
