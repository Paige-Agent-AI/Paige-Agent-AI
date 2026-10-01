/* eslint-disable @typescript-eslint/no-explicit-any -- Executed edge helper, loaded through a transpile port. */
// @vitest-environment node
//
// WAVE 3 · COMMUNICATIONS — the owner can find out what Paige did with the phone line.
//
// Two halves, because two different things can be wrong:
//   1. The MAPPING — does each of the four acts' real error codes land in an outcome whose
//      owner-facing sentence is TRUE? This half runs the real module.
//   2. The WIRING — is the recorder reachable from both the result path and the throw path,
//      and is it holding the service-role client? `paige-ai-chat/index.ts` is an 11k-line
//      `serve()` handler that cannot be imported, so this half asserts on its source. That
//      is weaker than execution and is stated as such: it catches the exact regressions
//      that make this feature silently write nothing.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect } from "vitest";

function load() {
  const src = readFileSync("supabase/functions/_shared/comms-capability-outcome.ts", "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out: any = {};
  // The module's ONLY import is `import type`, which TypeScript erases. If someone adds a
  // value import this throws rather than silently importing undefined.
  new Function("require", "exports", js)((k: string) => { throw new Error(`unexpected runtime import: ${k}`); }, out);
  return out;
}

const { classifyCommsRun, commsSignals, COMMS_WRITE_CAPABILITIES } = load();
const buy = (result: unknown) => classifyCommsRun({ capability: "comms_buy_number", result });
const threw = (capability: string, thrown: unknown) => classifyCommsRun({ capability, thrown, threw: true });

describe("Communications capability runs — what the Rail is told", () => {
  it("covers the four acts that change something, and no read", () => {
    expect([...COMMS_WRITE_CAPABILITIES].sort()).toEqual([
      "comms_buy_number", "comms_draft_registration", "comms_name_number", "comms_set_primary_number",
    ]);
    for (const read of ["comms_list_numbers", "comms_search_numbers", "comms_registration_status", "comms_overview"]) {
      expect(classifyCommsRun({ capability: read, result: { success: true } })).toBeNull();
    }
  });

  it("records a real purchase as done", () => {
    expect(buy({ success: true, phone_number: "+14155550123", already_owned: false, charge_wired: false }))
      .toBe("capability_succeeded");
  });

  // The workspace already held the number: `comms-purchase-number` returned early, nothing was
  // bought and no charge started. "Bought a phone number (monthly charge)" would be a lie about
  // money, so there is no row at all.
  it("writes NOTHING when the number was already owned", () => {
    expect(buy({ success: true, already_owned: true, charge_wired: false })).toBeNull();
  });

  // The one the sixth outcome exists for. Twilio charged; the row did not write.
  it("says the charge landed when the record did not, from the flag", () => {
    expect(buy({ success: false, error: "number_bought_but_record_failed: duplicate key", money_already_spent: true }))
      .toBe("capability_completed_unrecorded");
    expect(buy({ success: false, error: "twilio_purchase_missing_sid", money_already_spent: true }))
      .toBe("capability_completed_unrecorded");
  });

  // Belt and braces: the flag is derived by string-matching, and that derivation has already
  // shipped broken once. The code alone must still reach the truthful outcome.
  it("says the charge landed even if the flag is missing, from the code", () => {
    expect(buy({ success: false, error: "number_bought_but_record_failed: duplicate key value violates…" }))
      .toBe("capability_completed_unrecorded");
    expect(buy({ success: false, code: "twilio_purchase_missing_sid" }))
      .toBe("capability_completed_unrecorded");
  });

  it("calls a refusal a refusal — nothing changed is TRUE for every one of these", () => {
    for (const code of [
      "forbidden", "unauthorized", "tenant_not_resolved", "number_unavailable",
      "price_changed", "price_unverifiable", "twilio_subaccount_not_provisioned",
      "twilio_subaccount_row_missing", "inbound_webhook_secret_missing", "twilio_creds_unavailable",
      // A config problem the request layer catches before anything is sent — nothing attempted.
      "twilio_missing_credentials",
    ]) expect(buy({ success: false, error: code })).toBe("capability_refused");
    expect(buy({ success: false, error: "phone_number must be E.164 (e.g. +14155550123)" }))
      .toBe("capability_refused");
  });

  // MODEL_UNAVAILABLE is the ONLY genuinely-unreachable case: a draft that never generated
  // spent no money and left nothing, so "the service did not answer, nothing changed" is true.
  it("calls a model that never answered unreachable — nothing changed is true there", () => {
    expect(classifyCommsRun({ capability: "comms_draft_registration", result: { success: false, error: "MODEL_UNAVAILABLE" } }))
      .toBe("capability_unreachable");
  });

  // §39 peer-gate, 2026-09-05. `number_purchase_failed` is reachable ONLY on a Twilio 2xx with
  // an empty body (comms-purchase-number:246, via `!bought.data`): the POST was accepted and the
  // tenant MAY already be billed. "The service did not answer, so this never ran. Nothing
  // changed." would be a false reassurance on a possible charge, so it must be unknown, never
  // unreachable — check the service before running it again.
  it("calls a 2xx-with-empty-body purchase UNKNOWN, never unreachable — money may have moved", () => {
    expect(buy({ success: false, error: "number_purchase_failed" })).toBe("capability_outcome_unknown");
  });

  // `capability_failed` promises "Nothing was left half-done." An error we do not recognise is
  // exactly where that promise cannot be made — on the capability that spends money.
  it("defaults an unrecognised error to unknown, never to failed", () => {
    expect(buy({ success: false, error: "purchase_failed" })).toBe("capability_outcome_unknown");
    expect(buy({ success: false, error: "something nobody has seen" })).toBe("capability_outcome_unknown");
    expect(buy({})).toBe("capability_outcome_unknown");
    expect(classifyCommsRun({ capability: "comms_buy_number", result: null })).toBe("capability_outcome_unknown");
  });

  it("reads a raised plpgsql code off a thrown PostgREST object, which is not an Error", () => {
    // This is the shape `.rpc()` actually rejects with: a plain object. The handler's own
    // catch reports "Unknown error" for it; the Rail must not.
    for (const code of ["NUMBER_NOT_FOUND", "NUMBER_NOT_ACTIVE", "FORBIDDEN", "NAME_TOO_LONG", "TENANT_MISMATCH"]) {
      expect(threw("comms_name_number", { message: code, details: null, hint: null, code: "P0001" }))
        .toBe("capability_refused");
    }
    expect(threw("comms_set_primary_number", { message: "NUMBER_NOT_ACTIVE" })).toBe("capability_refused");
    expect(threw("comms_set_primary_number", new Error("NO_TENANT_FOR_CALLER"))).toBe("capability_refused");
    // A network blow-up mid-call is genuinely unknown, and says so.
    expect(threw("comms_name_number", new Error("fetch failed"))).toBe("capability_outcome_unknown");
    // A read that throws still records nothing.
    expect(threw("comms_list_numbers", new Error("NUMBER_NOT_FOUND"))).toBeNull();
  });

  it("digs the code out of the a2p 422 envelope, where it is one level down", () => {
    // Both fields are offered; the classifier takes the one it recognises rather than
    // betting on a fixed field order that the two envelope shapes disagree about.
    expect(commsSignals({ error: { code: "LEGAL_PROFILE_REQUIRED", message: "Add the legal name in Setup." } }))
      .toContain("LEGAL_PROFILE_REQUIRED");
    for (const code of ["LEGAL_PROFILE_REQUIRED", "REGISTRATION_IMMUTABLE", "SAMPLES_REQUIRED", "USE_CASE_REQUIRED", "WORKSPACE_CHANGED", "model_not_configured"]) {
      expect(classifyCommsRun({ capability: "comms_draft_registration", result: { success: false, error: code } }))
        .toBe("capability_refused");
    }
    // The model answered with nothing usable. Nothing was saved, and nothing is half-done.
    for (const code of ["MODEL_BAD_OUTPUT", "NO_VALID_DRAFT", "model_returned_empty"]) {
      expect(classifyCommsRun({ capability: "comms_draft_registration", result: { success: false, error: code } }))
        .toBe("capability_failed");
    }
    expect(classifyCommsRun({ capability: "comms_draft_registration", result: { success: true, draft: {}, saved: true } }))
      .toBe("capability_succeeded");
  });
});

describe("Communications capability runs — the wiring that makes them exist", () => {
  const chat = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");

  // The failure this guards is the reason the whole feature is wired at the executor:
  // `record_capability_run` is service_role-only ON ITS 6-ARG SIGNATURE, and the anon+JWT client returns
  // `permission denied` as a value rather than a throw. Swap the client and the feature
  // ships green, writes nothing, and nobody finds out.
  it("hands the recorder the SERVICE-ROLE client, not the caller's", () => {
    const call = chat.match(/await recordCapabilityRun\(([A-Za-z]+),/);
    expect(call?.[1]).toBe("supabase");
    expect(chat).toContain("const supabase = createClient(supabaseUrl, supabaseServiceKey);");
  });

  // `comms_name_number` and `comms_set_primary_number` use `if (e) throw e`, so EVERY
  // refusal they produce arrives in the catch. Recording only from the result path covers
  // one act of four and no refusals at all, while looking finished.
  it("records from the result path AND the throw path", () => {
    expect(chat).toContain("await recordCommsRun({ result });");
    expect(chat).toContain("await recordCommsRun({ thrown: err, threw: true });");
    // Classification runs INSIDE the recorder's try, so an unexpected shape reaching the
    // classifier cannot crash the turn (§39 peer-gate — the "cannot fail the turn" guarantee).
    expect(chat).toContain("const outcome: CapabilityOutcome | null = classifyCommsRun({");
  });

  // §39 peer-gate, 2026-09-05. The row must be attributed to the tenant the seam ACTUALLY acted
  // on — current_user_tenant_id() on the caller's JWT — not personaCtx.tenant_id, which resolves
  // the linked-client branch first and can name a different workspace than the purchase hit.
  it("records against the seam's own resolved tenant, not the persona tenant", () => {
    const decl = chat.indexOf("const recordCommsRun = async (");
    const region = chat.slice(chat.indexOf("let actorTenant", decl - 2000), decl + 900);
    expect(region).toContain('supabaseClient.rpc("current_user_tenant_id")');
    expect(chat).toContain("tenantId: await resolveActorTenant(),");
    // and NOT the persona tenant inside the recorder
    const body = chat.slice(chat.indexOf("const recordCommsRun = async ("), chat.indexOf("};", chat.indexOf("const recordCommsRun = async (")) + 2);
    expect(body).not.toContain("personaCtx.tenant_id");
  });

  // `admin` and `crmTenantId` are block-scoped inside the try. If the recorder is moved in
  // there it cannot be called from the catch, which is the half that matters most.
  it("declares the recorder above the try, where the catch can reach it", () => {
    const decl = chat.indexOf("const recordCommsRun = async (");
    const tryLine = chat.indexOf('const admin = createClient(supabaseUrl, supabaseServiceKey);');
    expect(decl).toBeGreaterThan(0);
    expect(decl).toBeLessThan(tryLine);
  });

  // Reads must never write a run row. Asserted on the module, not on prose.
  it("names no read capability anywhere in the write set", () => {
    const mod = readFileSync("supabase/functions/_shared/comms-capability-outcome.ts", "utf8");
    const set = mod.slice(mod.indexOf("COMMS_WRITE_CAPABILITIES"), mod.indexOf("]);", mod.indexOf("COMMS_WRITE_CAPABILITIES")));
    for (const read of ["comms_list_numbers", "comms_search_numbers", "comms_registration_status", "comms_overview"]) {
      expect(set).not.toContain(read);
    }
  });
});

describe("the sixth outcome reaches the database it was added for", () => {
  const mig = readFileSync("supabase/migrations/20261220000000_an_act_that_landed_but_was_not_recorded.sql", "utf8");

  // A CHECK that permits a value whose only caller path rejects it is a value that can
  // never be written — green migration, unreachable outcome.
  it("is admitted by the column CHECK, the source cross-check, AND the RPC's own guard", () => {
    const spots = mig.split("capability_completed_unrecorded").length - 1;
    expect(spots).toBeGreaterThanOrEqual(4);
    expect(mig).toMatch(/source_kind='capability_run'\s+AND outcome IN \([^)]*capability_completed_unrecorded/);
    expect(mig).toMatch(/_outcome NOT IN \([^)]*'capability_completed_unrecorded'\)/);
  });

  // It uses `done`, not `try`: the act HAPPENED. "Did not buy a phone number" over a real
  // charge is the exact lie the outcome was added to prevent.
  it("titles it as something that happened, not something attempted", () => {
    expect(mig).toContain("title := done || ' — but the record did not finish';");
  });

  it("names all four Communications acts in the projection", () => {
    for (const key of ["comms_buy_number", "comms_name_number", "comms_set_primary_number", "comms_draft_registration"]) {
      expect(mig).toContain(`WHEN '${key}'`);
    }
  });

  // The live constraint is `paige_workspace_event_source`; the file that created it called it
  // `n8n_workspace_event_source`. Dropping only one leaves the other standing and every
  // capability_run insert is rejected forever, by a migration that applied green.
  it("drops BOTH historical names of the cross-check before rebuilding it", () => {
    expect(mig).toContain("DROP CONSTRAINT IF EXISTS n8n_workspace_event_source");
    expect(mig).toContain("DROP CONSTRAINT IF EXISTS paige_workspace_event_source");
  });
});
