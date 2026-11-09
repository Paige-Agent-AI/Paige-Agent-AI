// Run-outcome model projection tests (2026-11-06 owner incident).
//
// The chat used to forward the gateway execute body verbatim; the model — trained on this
// codebase's `success:true/false` convention — read a SUCCEEDED lookup's closed body as
// unconfirmable and told the owner "couldn't confirm whether it went through." These tests pin
// the adapter that ends that: every outcome gets `success` + an own-words note, clean successes
// carry the bounded `data`, unknown fields never cross, and `outcome_unknown` carries the exact
// no-duplicate-retry instruction the incident showed the model needs.
import { assertEquals } from "jsr:@std/assert@1";
import {
  projectGatewayRunForModel,
  projectRunOutcomeForModel,
  projectRunRefusalForModel,
  projectRunTransportFailureForModel,
} from "./run-projection.ts";

Deno.test("a read_observed body projects as success with its data and a do-not-rerun note", () => {
  const out = projectRunOutcomeForModel({
    outcome: "read_observed", code: null, run_id: "r-1", data: '{"contacts":[]}', recorded: true,
  });
  assertEquals(out.success, true);
  assertEquals(out.data, '{"contacts":[]}');
  assertEquals(out.run_id, "r-1");
  assertEquals(out.recorded, true);
  assertEquals(String(out.note).includes("returned data"), true);
});

Deno.test("an executed body projects as success with a done note", () => {
  const out = projectRunOutcomeForModel({ outcome: "executed", code: null, run_id: "r-2", data: null, recorded: true });
  assertEquals(out.success, true);
  assertEquals(out.data, undefined);
  assertEquals(String(out.note).includes("ran successfully"), true);
});

Deno.test("an outcome_unknown body projects as failure with the check-before-retry instruction", () => {
  const out = projectRunOutcomeForModel({ outcome: "outcome_unknown", code: "unrecognized_result", run_id: "r-3", data: null, recorded: false });
  assertEquals(out.success, false);
  assertEquals(out.code, "unrecognized_result");
  const note = String(out.note);
  assertEquals(note.includes("may or may not have landed"), true);
  assertEquals(note.includes("Do NOT run this tool again"), true);
});

Deno.test("a refused body projects as failure naming that nothing ran", () => {
  const out = projectRunOutcomeForModel({ outcome: "refused", code: "approval_required", run_id: "r-4", recorded: true });
  assertEquals(out.success, false);
  assertEquals(out.code, "approval_required");
  assertEquals(String(out.note).includes("nothing touched the connected app"), true);
});

Deno.test("an unknown outcome still projects honestly instead of passing through", () => {
  const out = projectRunOutcomeForModel({ outcome: "brand_new_verb", data: null });
  assertEquals(out.success, false);
  assertEquals(out.outcome, "brand_new_verb");
  assertEquals(String(out.note).includes("does not recognize"), true);
});

Deno.test("unknown extra fields from the body never reach the model", () => {
  const out = projectRunOutcomeForModel({ outcome: "executed", code: null, run_id: "r-5", data: null, recorded: true, secret: "leak", provider_prose: "hello" });
  assertEquals(out.secret, undefined);
  assertEquals(out.provider_prose, undefined);
});

Deno.test("forwarded data is re-capped at the adapter's own bound", () => {
  const big = "y".repeat(50_000);
  const out = projectRunOutcomeForModel({ outcome: "read_observed", data: big });
  assertEquals(String(out.data).length, 8_000 + "\n[truncated]".length);
  assertEquals(String(out.data).endsWith("\n[truncated]"), true);
});

Deno.test("the read note teaches the truncation discipline (never present a partial list as complete)", () => {
  const out = projectRunOutcomeForModel({ outcome: "read_observed", data: "x" });
  const note = String(out.note);
  assertEquals(note.includes("[truncated]"), true);
  assertEquals(note.includes("narrow the query"), true);
});

Deno.test("a refusal body with only an error string projects as a plain failure with the glossary note", () => {
  const out = projectRunRefusalForModel({ error: "execute_not_enabled" });
  assertEquals(out.success, false);
  assertEquals(out.error, "execute_not_enabled");
  assertEquals(String(out.note).includes("refused BEFORE anything ran"), true);
});

Deno.test("a refusal body carrying the closed vocabulary keeps its code as the error", () => {
  const out = projectRunRefusalForModel({ outcome: "refused", code: "approval_required", run_id: "r-6" });
  assertEquals(out.error, "approval_required");
  assertEquals(out.outcome, "refused");
});

// ── The router (non-author review P1, 2026-11-06): the glossary must match the BODY, not the
// HTTP status. A 502 carrying {outcome:"tool_error"} must get the tool_error note; a body the
// gateway never wrote must get the may-have-landed posture — NEVER "it didn't run".

Deno.test("router: a tool_error body (arrives over 502) gets the tool_error glossary, not the nothing-ran one", () => {
  const out = projectGatewayRunForModel({ outcome: "tool_error", code: "provider_reported_error", run_id: "r-7" });
  assertEquals(out.success, false);
  assertEquals(out.code, "provider_reported_error");
  assertEquals(String(out.note).includes("reported a failure"), true);
  assertEquals(String(out.note).includes("nothing touched the connected app"), false);
});

Deno.test("router: an outcome_unknown body over ANY status keeps the no-duplicate-retry instruction", () => {
  const out = projectGatewayRunForModel({ outcome: "outcome_unknown", code: null, run_id: "r-8" });
  assertEquals(String(out.note).includes("Do NOT run this tool again"), true);
});

Deno.test("router: a pre-runner {error:…} body gets the nothing-ran note (true for exactly these)", () => {
  const out = projectGatewayRunForModel({ error: "execute_not_enabled" });
  assertEquals(out.success, false);
  assertEquals(out.error, "execute_not_enabled");
  assertEquals(String(out.note).includes("refused BEFORE anything ran"), true);
});

Deno.test("router: a body with neither outcome nor error is a TRANSPORT failure and gets the may-have-landed posture", () => {
  const out = projectGatewayRunForModel({});
  assertEquals(out.success, false);
  assertEquals(out.error, "gateway_no_answer");
  assertEquals(String(out.note).includes("may or may not have landed"), true);
  assertEquals(String(out.note).includes("nothing touched the connected app"), false);
});

Deno.test("router: a null body (fetch died before any answer) is the same transport posture", () => {
  const out = projectGatewayRunForModel(null);
  assertEquals(out.error, "gateway_no_answer");
  assertEquals(projectRunTransportFailureForModel().error, "gateway_no_answer");
});

Deno.test("refusal projection: a body-carried success field can never override success:false (review P3)", () => {
  const out = projectRunRefusalForModel({ error: "bad_tool_name", success: true });
  assertEquals(out.success, false);
});
