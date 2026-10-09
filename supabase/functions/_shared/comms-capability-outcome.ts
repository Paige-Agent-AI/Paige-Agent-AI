import type { CapabilityOutcome } from "./capability-record.ts";

/**
 * WHICH of the six outcomes a Communications act actually landed in.
 *
 * `capability-record.ts` owns HOW a run is written. This file owns WHAT to write for
 * Communications, because only this executor holds the four seams' own error taxonomies
 * -- `comms-purchase-number`'s snake_case body codes, `tenant_phone_number_rename`'s and
 * `_set_primary`'s SCREAMING plpgsql `RAISE`s, and `comms-a2p-draft`'s
 * `{error:{code}}` envelope. A central hook sees `success:false` and nothing else, which
 * is why it cannot tell a refusal from a charge that landed.
 *
 * ── THE RULE THIS FILE IS BUILT ON ──
 *
 * Classify by what we POSITIVELY KNOW, and where we do not know, say so. The projection
 * copy is not interchangeable prose -- each outcome makes a claim to the owner:
 *
 *   capability_failed              "Nothing was left half-done."
 *   capability_refused             "refused before it ran, so nothing changed"
 *   capability_unreachable         "The service did not answer, so this never ran."
 *   capability_outcome_unknown     "may or may not have taken effect"
 *   capability_completed_unrecorded "This DID take effect: a charge ... has landed."
 *
 * So an UNRECOGNISED error defaults to `capability_outcome_unknown`, NOT to
 * `capability_failed`. On the capability the owner sequenced first, `failed` asserts no
 * money moved -- and an error we do not recognise is exactly the case where we cannot
 * assert that. Defaulting the other way would put the reassuring sentence under the one
 * event where it could be catastrophically wrong.
 */

/**
 * The Communications acts that CHANGE something. Reads are deliberately absent.
 * `comms_setup_calling` (INT-345 K-3) is free and idempotent but creates provider
 * resources — it is an act, so it is recorded (except its no-op re-run, below).
 */
export const COMMS_WRITE_CAPABILITIES: ReadonlySet<string> = new Set([
  "comms_buy_number",
  "comms_name_number",
  "comms_set_primary_number",
  "comms_draft_registration",
  "comms_setup_calling",
]);

/**
 * Refusals: a rule, a permission, a precondition or a price check said no. Nothing
 * external happened, so "nothing changed" is a true statement about every one of these.
 *
 * `NUMBER_NOT_FOUND` sits here rather than under `failed` on purpose: the row is not the
 * caller's to rename, which is the same class of answer as `FORBIDDEN`.
 */
const REFUSED = new Set([
  // tenant_phone_number_rename / _set_primary (plpgsql RAISE, 20260901010000)
  "NUMBER_ID_REQUIRED", "TENANT_REQUIRED_FOR_SERVICE_CALLER", "NO_TENANT_FOR_CALLER",
  "TENANT_MISMATCH", "FORBIDDEN", "NAME_TOO_LONG", "NUMBER_NOT_FOUND", "NUMBER_NOT_ACTIVE",
  // comms-purchase-number (JSON body codes)
  "forbidden", "unauthorized", "method_not_allowed", "tenant_not_resolved",
  "number_unavailable", "price_changed", "price_unverifiable",
  "twilio_subaccount_not_provisioned", "twilio_subaccount_row_missing",
  "twilio_creds_unavailable", "twilio_missing_credentials", "inbound_webhook_secret_missing",
  // comms-a2p-draft: gate refusals, and every SAVE_REFUSAL_STATUS code
  "METHOD_NOT_ALLOWED", "UNAUTHENTICATED", "BAD_JSON", "INVALID_TENANT_ID",
  "WORKSPACE_CHANGED", "NO_TENANT", "TENANT_REQUIRED", "UNKNOWN_TENANT",
  "LEGAL_PROFILE_REQUIRED", "USE_CASE_REQUIRED", "SAMPLES_INVALID", "SAMPLES_REQUIRED",
  "REGISTRATION_IMMUTABLE",
  // No model is configured for this workspace. Nothing was attempted.
  "model_not_configured",
  // comms-setup-calling (INT-345 K-3): the platform's master Twilio credentials are
  // absent — the precondition itself said no before anything was attempted.
  "twilio_master_not_configured",
]);

/**
 * MONEY LEFT AND THE RECORD DID NOT FINISH — recognised by CODE as well as by the
 * `money_already_spent` flag `paige-ai-chat` sets.
 *
 * Belt and braces, deliberately. That flag is derived by string-matching the purchase
 * function's body, and the FIRST shipped version of that match used `===` against a
 * string the server interpolates a database message into -- so it was never once true on
 * the only path where Twilio had already charged the tenant. Recognising the code here
 * as well means a regression in that derivation degrades to the truthful outcome rather
 * than to "may or may not have taken effect" on a charge that certainly landed.
 */
const COMPLETED_UNRECORDED = new Set([
  "number_bought_but_record_failed",
  "twilio_purchase_missing_sid",
]);

/**
 * A service we needed genuinely did not answer, AND nothing external can have happened —
 * so "the service did not answer, so this never ran. Nothing changed." is TRUE.
 *
 * ONLY `MODEL_UNAVAILABLE` qualifies: it is `comms-a2p-draft` failing to reach the model,
 * and a draft that never generated spent no money and left nothing behind.
 *
 * `number_purchase_failed` is DELIBERATELY NOT here (§39 peer-gate, 2026-09-05). Traced to
 * source: `comms-purchase-number:246` reaches that string only via `!bought.data` while
 * `bought.ok === true` — i.e. Twilio answered **2xx** with an empty/unparseable body
 * (`twilio.ts:196` returns `{ ok:true, error:null, data:null }`). On every genuine
 * transport failure `twilioRequest` sets a specific `error` (`twilio_network:…`,
 * `twilio_<status>:…`), so the `??` fallback never fires. A 2xx means the purchase POST was
 * accepted and the tenant may already be billed — and this exit is ABOVE the audit write, so
 * there is no trace anywhere. "Nothing changed" is exactly the lie this file's own governing
 * rule (above) forbids, so it must fall through to `capability_outcome_unknown`: "may or may
 * not have taken effect. Check the service before running it again."
 */
const UNREACHABLE = new Set(["MODEL_UNAVAILABLE"]);

/**
 * It genuinely ran, produced nothing usable, and left nothing behind. Only the model
 * paths qualify: the draft is written in one `tenant_a2p_registration_save_draft` call
 * that is reached only after valid copy exists, so a bad generation cannot half-save.
 */
const FAILED = new Set(["MODEL_BAD_OUTPUT", "NO_VALID_DRAFT", "model_returned_empty"]);

/**
 * EVERY machine-readable signal a result body or a thrown value carries, most specific
 * first. Plural on purpose: no single field is the code.
 *
 *   - A PostgREST error is a PLAIN OBJECT whose `code` is the SQLSTATE (`P0001`) and whose
 *     raised text is in `message`/`hint`. Reading `code` there yields `P0001`, which
 *     matches nothing and turns every refusal from the two phone RPCs into "unknown".
 *   - `comms-a2p-draft`'s 422 is the opposite: `{ error: { code, message } }`, where
 *     `code` is the meaning and `message` is prose for a human.
 *
 * One fixed field order cannot serve both, so the classifier is handed all of them and
 * takes the first it RECOGNISES -- an unrecognised `P0001` no longer shadows a
 * `NUMBER_NOT_ACTIVE` sitting one field away.
 */
export function commsSignals(v: unknown): string[] {
  if (typeof v === "string") { const t = v.trim(); return t ? [t] : []; }
  if (!v || typeof v !== "object") return [];
  const o = v as Record<string, unknown>;
  const out: string[] = [];
  // Nested first: on a 422 the real code is one level down and the outer object has none.
  if (o.error !== undefined && o.error !== null) out.push(...commsSignals(o.error));
  for (const k of ["message", "hint", "code"]) {
    const raw = o[k];
    if (typeof raw === "string" && raw.trim()) out.push(raw.trim());
  }
  return out;
}

/**
 * `startsWith`, not equality. `comms-purchase-number` interpolates the database message
 * into its own error string -- `number_bought_but_record_failed: duplicate key value...`
 * -- and an exact compare against that was already shipped once, was never true, and hid
 * the one flag that says money left the account.
 */
const matches = (signal: string, codes: ReadonlySet<string>): boolean => {
  for (const code of codes) if (signal === code || signal.startsWith(code + ":")) return true;
  return false;
};

function classifySignals(signals: readonly string[]): CapabilityOutcome {
  // MONEY IS CHECKED ACROSS EVERY SIGNAL BEFORE ANYTHING ELSE IS CHECKED AT ALL. If a
  // charge has landed, no other field -- however specific, however early -- may downgrade
  // that to a refusal or a failure. Every other class is then resolved most-specific-first.
  for (const s of signals) if (matches(s, COMPLETED_UNRECORDED)) return "capability_completed_unrecorded";
  for (const s of signals) {
    if (matches(s, REFUSED)) return "capability_refused";
    if (matches(s, UNREACHABLE)) return "capability_unreachable";
    if (matches(s, FAILED)) return "capability_failed";
    // The E.164 guard answers with prose, not a code (comms-purchase-number:137). It is a
    // refusal of a malformed request and nothing was attempted.
    if (s.startsWith("phone_number must be E.164")) return "capability_refused";
  }
  return "capability_outcome_unknown";
}

/**
 * The outcome to record, or `null` for "record nothing".
 *
 * Pass EITHER `result` (the executor produced a tool result) OR `thrown` (it threw). Both
 * paths matter: `comms_name_number` and `comms_set_primary_number` use `if (e) throw e`,
 * so every one of their refusals arrives as a throw and would otherwise never be recorded.
 */
export function classifyCommsRun(input: {
  capability: string;
  result?: unknown;
  thrown?: unknown;
  threw?: boolean;
}): CapabilityOutcome | null {
  if (!COMMS_WRITE_CAPABILITIES.has(input.capability)) return null;

  if (input.threw) return classifySignals(commsSignals(input.thrown));

  const r = (input.result && typeof input.result === "object")
    ? input.result as Record<string, unknown>
    : null;
  if (!r) return "capability_outcome_unknown";

  // FIRST, before success is even read. This flag only ever appears on the failure shape,
  // but it is the one state where getting the order wrong is unrecoverable for the owner.
  if (r.money_already_spent === true) return "capability_completed_unrecorded";

  if (r.success === true) {
    // NOTHING WAS BOUGHT AND NO CHARGE STARTED -- the workspace already held this number,
    // so `comms-purchase-number` returned early. Recording it would put "Bought a phone
    // number (monthly charge)" on the Rail for an act that did not happen and money that
    // did not move, which is the §13 lie this whole family exists to prevent. The Rail is
    // a record of acts; there was no act.
    if (input.capability === "comms_buy_number" && r.already_owned === true) return null;
    // Same no-act precedent for the setup action: an idempotent re-run that found
    // the workspace already configured performed no act and moved no money.
    if (input.capability === "comms_setup_calling" && r.outcome === "skipped_existing") return null;
    return "capability_succeeded";
  }

  // The WHOLE result, not just `.error`: a body that carries its code at the top level
  // (`{ success:false, code:'…' }`) would otherwise classify as unknown.
  return classifySignals(commsSignals(r));
}
