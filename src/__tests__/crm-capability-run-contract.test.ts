/* eslint-disable @typescript-eslint/no-explicit-any -- Executed edge helper, loaded through a transpile port. */
// @vitest-environment node
//
// CAPABILITY SYSTEM · SLICE 3 (F05) — CRM/scheduling write receipts record an honest Rail outcome.
//
// crm_log_activity / calendar_book_meeting / crm_create_task previously recorded ONLY to
// paige_audit_log; now they also file a capability-Rail row. Two halves, like the pipeline/comms
// contract tests, because two different things can be wrong:
//   1. The MAPPING — does each handler's real result shape land in an outcome whose owner-facing
//      sentence is TRUE (§947: never claim "nothing changed" unless positively known)? Runs the real module.
//   2. The WIRING — is recordCrmRun reachable from BOTH the result and throw paths, holding the
//      service-role client, attributed to the acted-on tenant, and threading crmWriteAttempted set
//      immediately before each of the three writes? Asserted on the 11k-line handler's source.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect } from "vitest";

function load() {
  const src = readFileSync("supabase/functions/_shared/crm-capability-outcome.ts", "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out: any = {};
  // The module's ONLY import is `import type`, erased by TS. A value import here would throw.
  new Function("require", "exports", js)((k: string) => { throw new Error(`unexpected runtime import: ${k}`); }, out);
  return out;
}

const { classifyCrmRun, CRM_WRITE_CAPABILITIES } = load();
const CAPS = ["crm_log_activity", "calendar_book_meeting", "crm_create_task"] as const;
const run = (cap: string, input: { result?: unknown; thrown?: unknown; threw?: boolean; writeAttempted?: boolean }) =>
  classifyCrmRun({ capability: cap, ...input });

describe("CRM capability runs — what the Rail is told (slice 3 / F05)", () => {
  it("covers the three no-refusal write receipts plus crm_create_contact", () => {
    expect([...CRM_WRITE_CAPABILITIES].sort()).toEqual([...CAPS, "crm_create_contact"].sort());
  });

  it("records nothing for a non-CRM capability", () => {
    expect(classifyCrmRun({ capability: "deal_move_stage", result: { success: true } })).toBeNull();
    expect(classifyCrmRun({ capability: "comms_buy_number", result: { success: true } })).toBeNull();
    expect(classifyCrmRun({ capability: "crm_search_contacts", result: { success: true } })).toBeNull();
  });

  it("a real write is capability_succeeded for each receipt", () => {
    expect(run("crm_create_task", { result: { success: true, task_id: "t1" } })).toBe("capability_succeeded");
    expect(run("calendar_book_meeting", { result: { success: true, booking_id: "b1" } })).toBe("capability_succeeded");
    expect(run("crm_log_activity", { result: { success: true, log_id: "l1" } })).toBe("capability_succeeded");
  });

  it("a POST-write throw is capability_outcome_unknown — the row may have already been written", () => {
    for (const cap of CAPS) {
      expect(run(cap, { thrown: new Error("db exploded"), threw: true, writeAttempted: true }))
        .toBe("capability_outcome_unknown");
      // negative controls: the answers that would falsely claim "nothing changed" post-write
      expect(run(cap, { thrown: new Error("x"), threw: true, writeAttempted: true })).not.toBe("capability_failed");
      expect(run(cap, { thrown: new Error("x"), threw: true, writeAttempted: true })).not.toBe("capability_refused");
      expect(run(cap, { thrown: new Error("x"), threw: true, writeAttempted: true })).not.toBe("capability_succeeded");
    }
  });

  it("a PRE-write throw is capability_failed (nothing was dispatched), never a false 'was sent'", () => {
    for (const cap of CAPS) {
      expect(run(cap, { thrown: new Error("SyntaxError: bad json"), threw: true })).toBe("capability_failed");
      expect(run(cap, { thrown: new Error("x"), threw: true, writeAttempted: false })).toBe("capability_failed");
      expect(run(cap, { thrown: new Error("x"), threw: true })).not.toBe("capability_outcome_unknown");
      expect(run(cap, { thrown: new Error("x"), threw: true })).not.toBe("capability_refused");
    }
  });

  it("an UNEXPECTED success:false is outcome_unknown, NOT refused (these handlers have no refusal branch)", () => {
    // deliberate difference from pipeline: deal_move_stage genuinely refuses; these three never emit
    // success:false, so if one appeared it is an unrecognised state, not a "nothing changed" decision.
    for (const cap of CAPS) {
      expect(run(cap, { result: { success: false, error: "unexpected" } })).toBe("capability_outcome_unknown");
      expect(run(cap, { result: { success: false } })).not.toBe("capability_refused");
    }
  });

  it("an unrecognised/empty result shape is capability_outcome_unknown, never a claim", () => {
    expect(run("crm_create_task", { result: null })).toBe("capability_outcome_unknown");
    expect(run("crm_log_activity", { result: "oops" })).toBe("capability_outcome_unknown");
    expect(run("calendar_book_meeting", {})).toBe("capability_outcome_unknown");
  });
});

describe("crm_create_contact — only a GENUINE insert is a created receipt (§947)", () => {
  const cc = (input: { result?: unknown; thrown?: unknown; threw?: boolean; writeAttempted?: boolean }) =>
    classifyCrmRun({ capability: "crm_create_contact", ...input });

  it("a genuine insert (was_created:true) is capability_succeeded", () => {
    expect(cc({ result: { success: true, created: true, client_ref: "CLT-ABC" } })).toBe("capability_succeeded");
  });

  it("a resolved-EXISTING contact records NOTHING — never a false 'created'", () => {
    expect(cc({ result: { success: true, created: false, already_existed: true, client_ref: "CLT-ABC" } })).toBeNull();
    // the negative control: it must not claim a create, a failure, or a refusal
    const out = cc({ result: { success: true, created: false, already_existed: true } });
    expect(out).not.toBe("capability_succeeded");
    expect(out).not.toBe("capability_failed");
    expect(out).not.toBe("capability_refused");
  });

  it("a dedup 'same person?' proposal records NOTHING — it is a proposal, not a refusal", () => {
    expect(cc({ result: { success: false, needs_dedup_confirmation: true, matches: [{ client_ref: "CLT-X" }] } })).toBeNull();
  });

  it("a POST-write throw is outcome_unknown; a PRE-write throw is failed", () => {
    expect(cc({ thrown: new Error("db exploded"), threw: true, writeAttempted: true })).toBe("capability_outcome_unknown");
    expect(cc({ thrown: new Error("SyntaxError"), threw: true, writeAttempted: false })).toBe("capability_failed");
  });

  it("an unexpected success:false (not a dedup) is outcome_unknown, never refused", () => {
    const out = cc({ result: { success: false, error: "weird" } });
    expect(out).toBe("capability_outcome_unknown");
    expect(out).not.toBe("capability_refused");
  });
});

describe("CRM capability run WIRING in paige-ai-chat (source assertions)", () => {
  const src = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");

  it("imports the CRM classifier", () => {
    expect(src).toContain('import { classifyCrmRun } from "../_shared/crm-capability-outcome.ts"');
  });

  it("declares recordCrmRun via the service-role client, attributed to the acted-on tenant", () => {
    expect(src).toMatch(/const recordCrmRun = async/);
    const at = src.indexOf("const recordCrmRun = async");
    const block = src.slice(at, at + 2400);
    expect(block).toContain("classifyCrmRun({");
    expect(block).toContain("await recordCapabilityRun(supabase, {");
    // Booking's RPC accepts the explicit acted-on tenant. Other incumbent CRM
    // calls retain current_user_tenant_id(); actual recorder tests cover both.
    expect(block).toContain('tc.function.name === "calendar_book_meeting" && bookingReceiptTenant !== undefined');
    expect(block).toContain("? bookingReceiptTenant : await resolveActorTenant()");
    expect(block).toContain("tenantId: crmTenant");
    expect(block).toContain("actorId: user.id");
    // never the anon/JWT client, which would silently write nothing
    expect(block).not.toContain("recordCapabilityRun(supabaseClient");
  });

  it("is reachable from BOTH the result path and the throw path, threading crmWriteAttempted", () => {
    expect(src).toContain("await recordCrmRun({ result })");
    expect(src).toContain("await recordCrmRun({ thrown: err, threw: true, writeAttempted: crmWriteAttempted })");
    // the flag is declared once (per iteration) and set before EACH external write — now four,
    // with crm_create_contact's create_contact_v2 dispatch joining the original three.
    expect(src).toContain("let crmWriteAttempted = false;");
    expect((src.match(/crmWriteAttempted = true;/g) ?? []).length).toBe(4);
  });

  it("does not disturb the pipeline recorder's verbatim wiring (shared catch)", () => {
    // slice 3 only ADDS a line; the pipeline catch literal a sibling test hard-codes must remain.
    expect(src).toContain("await recordPipelineRun({ thrown: err, threw: true, writeAttempted: false })");
  });

  it("crm_create_contact calls v2 and Rails/labels ONLY a genuine insert (§947)", () => {
    // the create branch uses the signal-returning RPC, not the scalar shim
    expect(src).toContain('.rpc("create_contact_v2"');
    // the per-client Rail emitter skips a resolved-existing contact (success:true but not a create)
    expect(src).toContain('if (name === "crm_create_contact" && out?.created !== true) return;');
    // the handler shapes the honest created/already_existed result the classifier + Rail read
    expect(src).toContain("created: true, client_ref:");
    expect(src).toContain("already_existed: true");
    // the live step trace tells the truth for a resolve, not "Adding a contact"
    expect(src).toContain('out?.already_existed === true ? "Found an existing contact" : "Adding a contact"');
  });

  it("records crm_create_contact under a STABLE run id so a retry cannot double-record", () => {
    expect(src).toContain("stableRunId, type CapabilityOutcome");
    // keyed on (capability, RPC-resolved tenant, natural-act anchor), passed as the run id
    expect(src).toContain('stableRunId(["crm_create_contact", crmTenant ?? "", anchor])');
    expect(src).toContain("...(crmRunId ? { runId: crmRunId } : {})");
  });
});
