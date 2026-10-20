/**
 * Experience 04 E4-S3 — the step line tells the truth about a READ.
 *
 * The four admitted conversational reads (read_business_metric, get_business_snapshot,
 * read_client_engagement_status, read_business_time_zone) answer with a closed envelope —
 * `{ status: available | needs_input | refused | unavailable, message, ... }` — and no `success` or
 * `ok` field. Before E4-S3 the one failure reading (`toolResultReportsFailure`) saw none of those as a
 * failure, so a refused, unavailable or no-match read closed its step as a finished check. These pin:
 *   - an `unavailable` read is a failure (an error row with the failure wording, which persists);
 *   - a `needs_input` or `refused` read renders NO row (nothing was read; PAIGE's reply asks or
 *     refuses), exactly like a proposal waiting on the owner;
 *   - an `available` read says it finished ("Checked …");
 *   - every other result shape reads exactly as before.
 *
 * describeStep lives in the edge function (Deno imports), so it is read out of the source and
 * transpiled on its own, the same way paige-step-start.test.ts does.
 */
import { specialistStepLabel } from "../../supabase/functions/_shared/paige-turn/specialist-step-label";
import { readEnvelopeStatus } from "../../supabase/functions/_shared/paige-turn/interactive";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Step = { label: string; group: string; detail?: string } | null;
const CHAT = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const slice = (() => {
  const from = CHAT.indexOf("function toolResultReportsFailure");
  const to = CHAT.indexOf("// One home for turning a client_ref");
  if (from < 0 || to < 0 || to < from) throw new Error("describeStep could not be located");
  return CHAT.slice(from, to);
})();
const { describeStep, toolResultReportsFailure } = (() => {
  const js = ts.transpileModule(`${slice}\nexports.describeStep = describeStep;\nexports.toolResultReportsFailure = toolResultReportsFailure;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out: { describeStep?: (tc: unknown, res: unknown) => Step; toolResultReportsFailure?: (o: unknown) => boolean } = {};
  new Function("exports", "specialistStepLabel", "readEnvelopeStatus", js)(out, specialistStepLabel, readEnvelopeStatus);
  return out as { describeStep: (tc: unknown, res: unknown) => Step; toolResultReportsFailure: (o: unknown) => boolean };
})();

const call = (name: string) => ({ id: "toolu_1", function: { name, arguments: "{}" } });
const result = (o: unknown) => ({ content: JSON.stringify(o) });
const READS = ["read_business_metric", "get_business_snapshot", "read_client_engagement_status", "read_business_time_zone"];

describe("toolResultReportsFailure reads the closed read envelope", () => {
  it("an unavailable envelope is a failure; available, needs_input and refused are not failures", () => {
    expect(toolResultReportsFailure({ status: "unavailable", message: "Could not be read." })).toBe(true);
    expect(toolResultReportsFailure({ status: "available", message: "ok", projection: "x" })).toBe(false);
    // Not finished either — describeStep withdraws them; they are not error rows.
    expect(toolResultReportsFailure({ status: "needs_input", message: "Which client?" })).toBe(true);
    expect(toolResultReportsFailure({ status: "refused", message: "Only the owner." })).toBe(true);
  });

  it("every other shape reads exactly as before", () => {
    expect(toolResultReportsFailure({ success: true, status: "refused", message: "x" })).toBe(false);
    expect(toolResultReportsFailure({ ok: true, status: "unavailable", message: "x" })).toBe(false);
    expect(toolResultReportsFailure({ status: "refused" })).toBe(false); // no message: not an envelope
    expect(toolResultReportsFailure({ status: "pending", message: "x" })).toBe(false); // not an envelope status
    expect(toolResultReportsFailure({ ok: false })).toBe(true);
    expect(toolResultReportsFailure({ success: false })).toBe(true);
    expect(toolResultReportsFailure({ error: "x" })).toBe(true);
    expect(toolResultReportsFailure([{ status: "unavailable", message: "x" }])).toBe(false);
    expect(toolResultReportsFailure(null)).toBe(false);
  });
});

describe("describeStep — a read's FINISH says what actually happened", () => {
  it("an available client or time-zone read says it finished", () => {
    expect(describeStep(call("read_client_engagement_status"), result({ status: "available", message: "m", projection: "p" })))
      .toEqual({ label: "Checked where that client stands", group: "shared" });
    expect(describeStep(call("read_business_time_zone"), result({ status: "available", message: "m", projection: "p" })))
      .toEqual({ label: "Checked your business time zone", group: "shared" });
  });

  it("an unavailable read is an error row with the failure wording", () => {
    expect(describeStep(call("read_client_engagement_status"), result({ status: "unavailable", message: "m" })))
      .toEqual({ label: "Couldn't check where that client stands", group: "shared" });
    expect(describeStep(call("read_business_time_zone"), result({ status: "unavailable", message: "m" })))
      .toEqual({ label: "Couldn't check your business time zone", group: "shared" });
  });

  it.each(READS)("%s: a needs_input or refused envelope renders no row (nothing was read)", (name) => {
    expect(describeStep(call(name), result({ status: "needs_input", message: "Which client?", projection: "CLIENTS MATCHING \"x\": none" }))).toBeNull();
    expect(describeStep(call(name), result({ status: "refused", message: "Only the owner or an admin." }))).toBeNull();
  });

  it("read_business_metric keeps its Exp02-owned wording (E4-S3 adds no label for it; withdrawn pending Exp02)", () => {
    // The shared envelope rule still applies to it (needs_input / refused withdrawn above); only the
    // wording is Exp02's, and E4-S3 does not set it.
    expect(describeStep(call("read_business_metric"), result({ status: "available", message: "m" })))
      .toEqual({ label: "Working on that", group: "shared" });
    expect(describeStep(call("read_business_metric"), result({ status: "unavailable", message: "m" })))
      .toEqual({ label: "Working on that", group: "shared" });
  });

  it("get_business_snapshot keeps its Exp02-owned wording", () => {
    expect(describeStep(call("get_business_snapshot"), result({ status: "available", message: "m" })))
      .toEqual({ label: "Taking stock of your business", group: "shared" });
    expect(describeStep(call("get_business_snapshot"), result({ status: "unavailable", message: "m" })))
      .toEqual({ label: "Couldn't take stock of your business", group: "shared" });
  });

  it("asked with no result (the START's group probe) still answers", () => {
    expect(describeStep(call("read_client_engagement_status"), null)).toMatchObject({ group: "shared" });
  });
});
