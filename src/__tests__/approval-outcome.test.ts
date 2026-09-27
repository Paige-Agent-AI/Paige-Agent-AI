/**
 * The approval outcome frame: what the card is told about each approval the operator sent.
 *
 * REAL CODE: the shipped `_shared/approval-outcome.ts`, the module the chat handler imports. The
 * handler wiring is proven on the real handler in scripts/client-memory-authz (checks 18.OUT*).
 */
import { describe, it, expect } from "vitest";
import {
  APPROVAL_OUTCOME_SENTENCES,
  buildApprovalOutcome,
  classifySpentApproval,
  classifyUnspentApproval,
  databaseAnswered,
  invokeOutcomeUnknown,
  OUTCOME_UNKNOWN_NOTE,
  refusedByDatabase,
  sayWhatTheCardSays,
  settleUsedEarlier,
  thrownOutcomeUnknown,
} from "../../supabase/functions/_shared/approval-outcome.ts";
import { executorFailureSpeech } from "../../supabase/functions/_shared/crm-command/executor-error.ts";

const r = (value: unknown) => JSON.stringify(value);

describe("a spent approval is reported by what its call returned", () => {
  it("ran when the call said it succeeded", () => {
    expect(classifySpentApproval(r({ success: true }))).toEqual({ outcome: "ran", reason: null });
    expect(classifySpentApproval(r({ ok: true }))).toEqual({ outcome: "ran", reason: null });
  });

  it("says a run that was only started is started, not finished", () => {
    expect(classifySpentApproval(r({ ok: true, started: true }), { reportsOk: true })).toEqual({ outcome: "ran", reason: "started" });
    expect(classifySpentApproval(r({ ok: true, executed: false }), { reportsOk: true })).toEqual({ outcome: "ran", reason: null });
  });

  it("does not call a result done because it failed to mention an error", () => {
    // A write-back refusal relayed as `{ error }`, with no success flag, read as Done before this.
    expect(classifySpentApproval(r({ error: "Forbidden" }))).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
    expect(classifySpentApproval(r({ id: "a1", created: true }))).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
    expect(classifySpentApproval(r({}))).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
    // The n8n management tools claim success only in `ok`.
    expect(classifySpentApproval(r({ success: true }), { reportsOk: true })).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
  });

  it("never reads a success out of a result that also says ok:false or success:false", () => {
    expect(classifySpentApproval(r({ success: true, ok: false }))).not.toMatchObject({ outcome: "ran" });
    expect(classifySpentApproval(r({ ok: true, success: false }))).not.toMatchObject({ outcome: "ran" });
  });

  it("did not run when it was re-asked, refused before running, or switched off", () => {
    expect(classifySpentApproval(r({ success: false, needs_confirm: true }))).toEqual({ outcome: "not_run", reason: "reproposed" });
    expect(classifySpentApproval(r({ success: false, refused_before_run: true }))).toEqual({ outcome: "not_run", reason: "id_refused" });
    expect(classifySpentApproval(r({ success: false, disabled: true }))).toEqual({ outcome: "not_run", reason: "not_attempted" });
  });

  it("calls a failure 'didn't run' only when something knows nothing was applied", () => {
    expect(classifySpentApproval(r({ success: false, error: "CRM_CONTACT_NOT_FOUND", not_applied: true })))
      .toEqual({ outcome: "not_run", reason: "failed" });
    // The n8n tools report every write they attempted and lost as outcome_unknown, so their other
    // refusals came before anything was written.
    expect(classifySpentApproval(r({ ok: false, error: "forbidden" }), { reportsOk: true })).toEqual({ outcome: "not_run", reason: "failed" });
    // Everything else may have done part of its work.
    expect(classifySpentApproval(r({ success: false, error: "Unknown error" }))).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
    expect(classifySpentApproval(r({ ok: false, code: "X" }))).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
    expect(classifySpentApproval(r({ ok: false, success: false }))).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
  });

  it("is unconfirmed when the answer never arrived, or nothing readable came back", () => {
    expect(classifySpentApproval(r({ success: false, outcome_unknown: true, not_applied: true }))).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
    expect(classifySpentApproval(r({ ok: false, error: "outcome_unknown", retry_safe: false }), { reportsOk: true }))
      .toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
    expect(classifySpentApproval(undefined)).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
    expect(classifySpentApproval("not json")).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
    expect(classifySpentApproval(r([{ success: true }]))).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
  });
});

describe("an approval used before this request could not be used in it", () => {
  it("is unconfirmed, because whatever used it may have done the work", () => {
    expect(settleUsedEarlier(classifyUnspentApproval(undefined), true)).toEqual({ outcome: "unconfirmed", reason: "unusable" });
    expect(settleUsedEarlier(classifySpentApproval(r({ success: false, not_applied: true })), true)).toEqual({ outcome: "unconfirmed", reason: "unusable" });
  });

  it("changes nothing that ran, nothing already unconfirmed, and nothing when it was not used before", () => {
    const ran = classifySpentApproval(r({ success: true }));
    expect(settleUsedEarlier(ran, true)).toBe(ran);
    const unknown = classifySpentApproval(undefined);
    expect(settleUsedEarlier(unknown, true)).toBe(unknown);
    const refused = classifyUnspentApproval("ambiguous");
    expect(settleUsedEarlier(refused, false)).toBe(refused);
  });

  it("says only that it couldn't confirm when nobody could look", () => {
    expect(settleUsedEarlier(classifyUnspentApproval("ambiguous"), "unknown")).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
  });

  it("says it can't be used, and to check, without claiming it ran", () => {
    const note = buildApprovalOutcome([{ fingerprint: "a", ...settleUsedEarlier(classifyUnspentApproval(undefined), true) }]).note!;
    expect(note).toBe("That approval can't be used any more. Check before asking again, so it doesn't happen twice.");
    expect(note).not.toMatch(/nothing changed|went through|done/i);
  });
});

describe("the model is told what the card says", () => {
  it("adds the couldn't-confirm note to an approved call the card will call unconfirmed, keeping its error", () => {
    const aligned = JSON.parse(sayWhatTheCardSays(r({ success: false, error: "Contact not found", note: "Tell them it failed." })));
    expect(aligned).toMatchObject({ success: false, error: "Contact not found", outcome_unknown: true, note: OUTCOME_UNKNOWN_NOTE });
  });

  it("leaves every other result exactly as it was", () => {
    for (const out of [
      { success: true, id: "c1" },
      { success: false, not_applied: true, note: "Nothing was created." },
      { success: false, needs_confirm: true, confirm_fingerprint: "abcd" },
      { success: false, outcome_unknown: true, note: "their own words" },
    ]) expect(sayWhatTheCardSays(r(out))).toBe(r(out));
    expect(sayWhatTheCardSays("plain words")).toBe("plain words");
    expect(sayWhatTheCardSays(r({ ok: false, error: "forbidden" }), { reportsOk: true })).toBe(r({ ok: false, error: "forbidden" }));
  });
});

describe("a single database call's refusal applied nothing", () => {
  it("marks an error the database answered, and nothing else", () => {
    expect(refusedByDatabase({ code: "P0001", message: "ACTION_NOT_FOUND" })).toMatchObject({ not_applied: true });
    expect(refusedByDatabase({ code: "PGRST301", message: "JWT expired" })).toMatchObject({ not_applied: true });
    expect(refusedByDatabase({ code: "", message: "TypeError: fetch failed" })).not.toHaveProperty("not_applied");
    expect(refusedByDatabase({ code: "ECONNRESET", message: "socket hang up" })).not.toHaveProperty("not_applied");
    expect(refusedByDatabase({ message: "<html>504 Gateway Time-out</html>" })).not.toHaveProperty("not_applied");
  });

  it("returns the same error, so the caller throws what it caught", () => {
    const error = { code: "23505", message: "duplicate" };
    expect(refusedByDatabase(error)).toBe(error);
    expect(databaseAnswered(error)).toBe(true);
    expect(databaseAnswered(null)).toBe(false);
  });
});

describe("an approval that was never spent is reported with the reason its tool was refused", () => {
  it("names the refusal when one was recorded, and says only that Paige didn't run it when none was", () => {
    expect(classifyUnspentApproval("ambiguous")).toEqual({ outcome: "not_run", reason: "ambiguous" });
    expect(classifyUnspentApproval("lookup_failed")).toEqual({ outcome: "not_run", reason: "lookup_failed" });
    expect(classifyUnspentApproval(undefined)).toEqual({ outcome: "not_run", reason: "not_attempted" });
  });
});

describe("the frame says each reason once", () => {
  it("writes one card-level sentence when every action ended the same way, and no row repeats it", () => {
    const frame = buildApprovalOutcome([
      { fingerprint: "a", ...classifyUnspentApproval("ambiguous") },
      { fingerprint: "b", ...classifyUnspentApproval("ambiguous") },
    ]);
    expect(frame.note).toBe("Nothing changed. More than one approval was waiting, so Paige stopped rather than guess.");
    expect(frame.actions).toEqual([{ fingerprint: "a", outcome: "not_run" }, { fingerprint: "b", outcome: "not_run" }]);
  });

  it("writes the batch sentence for more than one, and the single one for one", () => {
    expect(buildApprovalOutcome([{ fingerprint: "a", ...classifyUnspentApproval(undefined) }]).note)
      .toBe("Nothing changed. Paige didn't run this.");
    expect(buildApprovalOutcome([
      { fingerprint: "a", ...classifyUnspentApproval(undefined) },
      { fingerprint: "b", ...classifyUnspentApproval(undefined) },
    ]).note).toBe("Nothing changed. Paige didn't run these.");
    expect(buildApprovalOutcome([
      { fingerprint: "a", ...classifySpentApproval(r({ outcome_unknown: true })) },
      { fingerprint: "b", ...classifySpentApproval(r({ outcome_unknown: true })) },
    ]).note).toBe("These may have gone through. Check before asking again, so nothing happens twice.");
  });

  it("writes the failure for the batch when several calls ran and failed", () => {
    const one = { fingerprint: "a", ...classifySpentApproval(r({ success: false, not_applied: true })) };
    expect(buildApprovalOutcome([one]).note).toBe("It didn't go through.");
    expect(buildApprovalOutcome([one, { ...one, fingerprint: "b" }]).note).toBe("These didn't go through.");
  });

  it("says nothing when everything ran", () => {
    expect(buildApprovalOutcome([{ fingerprint: "a", ...classifySpentApproval(r({ success: true })) }]))
      .toEqual({ actions: [{ fingerprint: "a", outcome: "ran" }] });
  });

  it("puts the sentence on the one that did not run when the batch ended differently", () => {
    const frame = buildApprovalOutcome([
      { fingerprint: "a", ...classifySpentApproval(r({ success: true })) },
      { fingerprint: "b", ...classifySpentApproval(r({ success: false, error: "x", not_applied: true })) },
    ]);
    expect(frame.note).toBeUndefined();
    expect(frame.actions).toEqual([
      { fingerprint: "a", outcome: "ran" },
      { fingerprint: "b", outcome: "not_run", note: "It didn't go through." },
    ]);
  });

  it("returns an empty frame for no approvals", () => {
    expect(buildApprovalOutcome([])).toEqual({ actions: [] });
  });
});

describe("every sentence is one the operator can act on", () => {
  const keys: Array<Parameters<typeof classifyUnspentApproval>[0]> = ["ambiguous", "unclaimable", "lookup_failed", undefined];
  const spent = [{ needs_confirm: true }, { refused_before_run: true }, { success: false, error: "internal_text_in_draft" }, { success: false, not_applied: true }, { outcome_unknown: true }, { ok: true, started: true }];
  const notes = [
    ...keys.flatMap((k) => [1, 2].map((n) => buildApprovalOutcome(Array.from({ length: n }, (_, i) => ({ fingerprint: `f${i}`, ...classifyUnspentApproval(k) }))).note)),
    ...spent.flatMap((s) => [1, 2].map((n) => buildApprovalOutcome(Array.from({ length: n }, (_, i) => ({ fingerprint: `f${i}`, ...classifySpentApproval(r(s)) }))).note)),
    ...[1, 2].map((n) => buildApprovalOutcome(Array.from({ length: n }, (_, i) => ({ fingerprint: `f${i}`, ...settleUsedEarlier(classifyUnspentApproval(undefined), true) }))).note),
  ];

  it("covers every reason", () => {
    expect(notes.every((n) => typeof n === "string" && n.length > 0)).toBe(true);
  });

  it("is the closed set a reader can hold a note to, and nothing outside it", () => {
    expect(new Set(notes)).toEqual(APPROVAL_OUTCOME_SENTENCES);
  });

  it("carries no internal names, and names no control", () => {
    for (const note of notes) {
      expect(note).toMatch(/^[A-Z].*\.$/);
      expect(note).not.toMatch(/fingerprint|tool|rpc|confirmation|token|null|undefined|\bid\b/i);
      expect(note).not.toMatch(/\b(press|click|tap|button)\b|approve (it|them|one)/i);
    }
  });

  it("claims nothing changed only where nothing ran", () => {
    const failed = buildApprovalOutcome([{ fingerprint: "a", ...classifySpentApproval(r({ success: false, not_applied: true })) }]).note!;
    const unknown = buildApprovalOutcome([{ fingerprint: "a", ...classifySpentApproval(r({ outcome_unknown: true })) }]).note!;
    expect(failed).not.toMatch(/nothing changed/i);
    expect(unknown).not.toMatch(/nothing changed/i);
  });
});

describe("an invocation is unknown only when the function's own answer never came back", () => {
  it("knows the outcome when crm-command answered, whatever it said", () => {
    expect(invokeOutcomeUnknown({ name: "FunctionsHttpError" }, { ok: false, outcome: "refused", code: "CRM_FORBIDDEN" })).toBe(false);
    expect(invokeOutcomeUnknown(null, { ok: true, outcome: "succeeded" })).toBe(false);
    expect(invokeOutcomeUnknown(null, {})).toBe(false);
  });

  it("does not know when the request failed in transit or the platform cut the function off", () => {
    expect(invokeOutcomeUnknown({ name: "FunctionsFetchError" }, {})).toBe(true);
    expect(invokeOutcomeUnknown({ name: "FunctionsRelayError" }, {})).toBe(true);
    expect(invokeOutcomeUnknown({ name: "FunctionsHttpError" }, { code: "WORKER_LIMIT", message: "Function exceeded" }, 546)).toBe(true);
    expect(invokeOutcomeUnknown({ name: "FunctionsHttpError" }, {}, 504)).toBe(true);
  });

  it("knows the function never started when the gateway turned the request away", () => {
    expect(invokeOutcomeUnknown({ name: "FunctionsHttpError" }, { code: 401, message: "Invalid JWT" }, 401)).toBe(false);
    expect(invokeOutcomeUnknown({ name: "FunctionsHttpError" }, {}, 404)).toBe(false);
    expect(invokeOutcomeUnknown({ name: "FunctionsHttpError" }, {}, 429)).toBe(false);
    // A request timeout says nothing about what ran.
    expect(invokeOutcomeUnknown({ name: "FunctionsHttpError" }, {}, 408)).toBe(true);
  });

  it("carries crm-command's lost execute answer through as data", () => {
    const lost = executorFailureSpeech("CRM_COMMAND_FAILED", [], "lost");
    expect(lost.outcome_unknown).toBe(true);
    expect(lost.note).toMatch(/could not confirm/);
    expect(lost.note).not.toMatch(/nothing (was )?(created|changed)/i);
    const doorResult = r({ success: false, ok: false, outcome: "failed", code: "CRM_COMMAND_FAILED", ...lost, error: "CRM_COMMAND_FAILED" });
    expect(classifySpentApproval(doorResult)).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
  });

  it("carries crm-command's own 'could not confirm' through as data, and only that one", () => {
    const unproven = executorFailureSpeech("CRM_READBACK_UNAVAILABLE", [], "unproven");
    expect(unproven.outcome_unknown).toBe(true);
    expect(executorFailureSpeech("CRM_CONTACT_NOT_FOUND", [], "refused").outcome_unknown).toBeUndefined();
    // Exactly the tool result the chat's CRM door builds from that answer.
    const doorResult = r({ success: false, ok: false, outcome: "refused", code: "CRM_READBACK_UNAVAILABLE", ...unproven, error: "CRM_READBACK_UNAVAILABLE" });
    expect(classifySpentApproval(doorResult)).toEqual({ outcome: "unconfirmed", reason: "unconfirmed" });
  });

  it("tells the model the same thing the card says", () => {
    expect(OUTCOME_UNKNOWN_NOTE).toMatch(/could not confirm/);
    expect(OUTCOME_UNKNOWN_NOTE).not.toMatch(/nothing (was )?changed/i);
    expect(OUTCOME_UNKNOWN_NOTE).toMatch(/do NOT call this tool again/);
  });
});

describe("a thrown failure is unknown only when the answer never arrived", () => {
  it("knows the database answered when a code came back", () => {
    expect(thrownOutcomeUnknown({ code: "22P02", message: "invalid input syntax for type uuid" })).toBe(false);
    expect(thrownOutcomeUnknown({ code: "P0001", message: "ACTION_NOT_FOUND" })).toBe(false);
  });

  it("does not know when the transport failed", () => {
    expect(thrownOutcomeUnknown({ code: "", message: "TypeError: fetch failed" })).toBe(true);
    expect(thrownOutcomeUnknown(new TypeError("fetch failed"))).toBe(true);
    expect(thrownOutcomeUnknown(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(thrownOutcomeUnknown(Object.assign(new Error("slow"), { name: "TimeoutError" }))).toBe(true);
    // functions-js and storage-js name their transport failures.
    expect(thrownOutcomeUnknown(Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" }))).toBe(true);
    expect(thrownOutcomeUnknown(Object.assign(new Error("Relay Error invoking the Edge Function"), { name: "FunctionsRelayError" }))).toBe(true);
    expect(thrownOutcomeUnknown(Object.assign(new Error("network"), { name: "StorageUnknownError" }))).toBe(true);
  });

  it("does not know when postgrest-js has no answer to report", () => {
    // Handler code never throws a plain object: one without a database code is postgrest-js's own
    // network failure, or a gateway page (a 504) where the database's reply should be.
    expect(thrownOutcomeUnknown({ message: "<html>504 Gateway Time-out</html>" })).toBe(true);
    expect(thrownOutcomeUnknown({ code: "ECONNRESET", message: "socket hang up" })).toBe(true);
  });

  it("does not call a handler's own refusal unknown", () => {
    expect(thrownOutcomeUnknown(new Error("quote_required"))).toBe(false);
    expect(thrownOutcomeUnknown(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(thrownOutcomeUnknown(Object.assign(new Error("Edge Function returned a non-2xx status code"), { name: "FunctionsHttpError" }))).toBe(false);
    expect(thrownOutcomeUnknown("boom")).toBe(false);
  });
});
