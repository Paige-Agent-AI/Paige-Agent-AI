// deno test --allow-import --node-modules-dir=none supabase/functions/_shared/llm-trace.test.ts
//
// Regression test: the sanitized closed-code provider_failure_class survives the
// metadata allowlist even when content_policy is "metadata_only" (which scrubs
// error_message and input/output). It never leaks raw provider message text.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { safeMetadata } from "./llm-trace.ts";

Deno.test("safeMetadata: provider_failure_class survives the allowlist", () => {
  const meta = safeMetadata({ provider_failure_class: "billing_key_limit", caller_function: "paige-ai-chat" });
  assertEquals(meta.provider_failure_class, "billing_key_limit");
  assertEquals(meta.caller_function, "paige-ai-chat");
});

Deno.test("safeMetadata: provider_error_detail survives the allowlist (non-metadata_only path)", () => {
  // provider_error_detail is a sanitized closed-code diagnostic. It survives safeMetadata
  // so it can be persisted for non-metadata_only traces.
  const meta = safeMetadata({ provider_error_detail: "http_402: billing: insufficient credits", caller_function: "paige-ai-chat" });
  assertEquals(meta.provider_error_detail, "http_402: billing: insufficient credits");
  assertEquals(meta.caller_function, "paige-ai-chat");
});

Deno.test("safeMetadata: provider_failure_class survives for metadata_only-shaped input", () => {
  // Simulate what emitTrace passes: the classified class is in metadata, content is scrubbed.
  // provider_error_detail is conditionally excluded by emitTrace when content_policy === "metadata_only",
  // so it never reaches safeMetadata for those traces. Here we verify the class survives.
  const meta = safeMetadata({
    provider_failure_class: "billing_account",
    caller_function: "paige-ai-chat",
    stop_reason: "tool_use",
  });
  assertEquals(meta.provider_failure_class, "billing_account");
  assertEquals(meta.stop_reason, "tool_use");
});

Deno.test("safeMetadata: raw provider message never survives (closed-code only)", () => {
  const secret = "SECRET-REQUEST-MATERIAL";
  const meta = safeMetadata({ provider_failure_class: "billing", error_message: `credit balance ${secret}` });
  // error_message is not in the allowlist, so it's dropped.
  assertEquals(meta.error_message, undefined);
  assertEquals(String(meta.provider_failure_class).includes(secret), false);
});

Deno.test("safeMetadata: unknown keys are dropped", () => {
  const meta = safeMetadata({ provider_failure_class: "billing", foo: "bar", authorization: "Bearer secret" });
  assertEquals(meta.provider_failure_class, "billing");
  assertEquals(meta.foo, undefined);
  assertEquals(meta.authorization, undefined);
});