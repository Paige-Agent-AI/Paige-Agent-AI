/**
 * What happened to each approval the operator sent, reported back to the card that asked.
 *
 * WHY THIS EXISTS. Pressing Approve sends the approved fingerprints and starts a new turn. Until
 * this frame, nothing told the card what became of them: it vanished on press, and the only trace
 * of a failure was whatever Paige chose to say. The owner-approved recovery design (2026-09-26)
 * has the card report each action as ran, didn't run, or couldn't confirm, in a sentence the
 * SERVER writes — so the card can never claim a cause the server does not know, and never
 * improvise a remedy that does not exist.
 *
 * ONE HOME for that decision. The chat handler records the facts as they happen (which approval
 * was spent by which call, which tool's approvals were refused and why, what each call returned);
 * this module turns them into the frame. It is pure so the whole mapping is unit-tested, and so
 * the sentences live in one closed set rather than scattered through the handler.
 *
 * THE SENTENCES ARE A CLOSED SET, AND EACH IS ONLY SAID WHEN IT IS TRUE.
 * - "Nothing changed" is claimed only where the server knows nothing ran: an approval it never
 *   spent, a refusal before the call ran, or a proposal that was re-asked.
 * - A call that failed is "didn't run" ONLY when something positively knows nothing was applied:
 *   the tool said so (`not_applied`), or it is one whose failures are defined that way (the n8n
 *   management tools, which report a write they lost the answer to as `outcome_unknown`). Every
 *   other failure after a spent approval is "couldn't confirm". The asymmetry is the point:
 *   "couldn't confirm" said wrongly costs the person a look; "didn't run" said wrongly offers
 *   "Ask Paige again" for something that already happened, and it happens twice.
 * - "Done" needs the call to have said it succeeded. A result that only fails to mention an error
 *   is not a success.
 * - A call whose answer never arrived is `unconfirmed`, never `not_run`: it may have gone through.
 * - An approval that was already used before this request, and so could not be used in it, is
 *   `unconfirmed` too: whatever used it may have done the work.
 */

export type ApprovalOutcomeKind = "ran" | "not_run" | "unconfirmed";

/** Why a tool's approvals could not be spent this turn — set by the approval doors. `expired` is
 *  set by the approval resume (C4a, _shared/paige-turn/resume.ts): the proposal's window closed
 *  before the person approved it, so nothing ran. */
export type ApprovalRefusalReason = "ambiguous" | "unclaimable" | "lookup_failed" | "expired";

type NoteKey =
  | ApprovalRefusalReason
  | "not_attempted"
  | "id_refused"
  | "internal_text"
  | "reproposed"
  | "failed"
  | "unconfirmed"
  | "unusable"
  | "started";

export type ApprovalOutcomeAction = {
  fingerprint: string;
  outcome: ApprovalOutcomeKind;
  /** Present only when the actions ended differently; otherwise the card-level note carries it. */
  note?: string;
};

export type ApprovalOutcomeFrame = {
  actions: ApprovalOutcomeAction[];
  /** One sentence for the whole card, written for the batch, when every action ended the same way. */
  note?: string;
};

type Classified = { outcome: ApprovalOutcomeKind; reason: NoteKey | null };

/** Every sentence the card can show, singular and batch. Plain words, no internal names. */
const NOTES: Record<NoteKey, (many: boolean) => string> = {
  ambiguous: () => "Nothing changed. More than one approval was waiting, so Paige stopped rather than guess.",
  unclaimable: (many) => many
    ? "Nothing changed. Those approvals no longer match anything Paige can run."
    : "Nothing changed. That approval no longer matches anything Paige can run.",
  lookup_failed: () => "Nothing changed. Something went wrong on our side while checking your approval.",
  expired: (many) => many
    ? "Nothing changed. Those approvals expired before they were used. Ask Paige again if you still want them."
    : "Nothing changed. That approval expired before it was used. Ask Paige again if you still want it.",
  not_attempted: (many) => many ? "Nothing changed. Paige didn't run these." : "Nothing changed. Paige didn't run this.",
  id_refused: (many) => many
    ? "Nothing changed. Paige couldn't tell exactly which items these were, so she stopped."
    : "Nothing changed. Paige couldn't tell exactly which item this was, so she stopped.",
  internal_text: (many) => many
    ? "Nothing changed. These messages included internal system details, so Paige stopped before they went out. Ask her to rewrite them."
    : "Nothing changed. The message included internal system details, so Paige stopped before it went out. Ask her to rewrite it.",
  reproposed: (many) => many
    ? "Those approvals couldn't be used, so Paige is asking again."
    : "That approval couldn't be used, so Paige is asking again.",
  failed: (many) => many ? "These didn't go through." : "It didn't go through.",
  unconfirmed: (many) => many
    ? "These may have gone through. Check before asking again, so nothing happens twice."
    : "This may have gone through. Check before asking again, so it doesn't happen twice.",
  unusable: (many) => many
    ? "Those approvals can't be used any more. Check before asking again, so nothing happens twice."
    : "That approval can't be used any more. Check before asking again, so it doesn't happen twice.",
  started: (many) => many ? "They started, and finish on their own." : "It started, and finishes on its own.",
};

/** Every sentence the frame can carry. A reader that must not pass free text (the protected-turn
 *  frame check) holds a note to this set rather than to a length. */
export const APPROVAL_OUTCOME_SENTENCES: ReadonlySet<string> = new Set(
  Object.values(NOTES).flatMap((say) => [say(false), say(true)]),
);

/**
 * An approval the handler spent on a call: classify what that call returned. `content` is the
 * tool result exactly as the model received it; `undefined` means the call never produced one.
 *
 * "Done" needs a success the call claimed: `ok: true` from a tool that reports in `ok`
 * (`reportsOk`, the n8n management tools), `success: true` or `ok: true` from any other. A
 * failure is "didn't run" only on positive knowledge that nothing was applied (see the header);
 * everything else is "couldn't confirm".
 */
export function classifySpentApproval(
  content: string | undefined,
  opts: { reportsOk?: boolean } = {},
): Classified {
  if (content === undefined) return { outcome: "unconfirmed", reason: "unconfirmed" };
  let out: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) out = parsed as Record<string, unknown>;
    else return { outcome: "unconfirmed", reason: "unconfirmed" };
  } catch {
    // A result that is not JSON is a result nobody can read: say so rather than guess.
    return { outcome: "unconfirmed", reason: "unconfirmed" };
  }
  if (out.needs_confirm === true) return { outcome: "not_run", reason: "reproposed" };
  if (out.refused_before_run === true) return { outcome: "not_run", reason: "id_refused" };
  // R2 — an approved draft for a customer that carried internal text was refused before it ran
  // (_shared/outbound-draft-check.ts): nothing was filed or sent, and the card says why.
  if (out.error === "internal_text_in_draft") return { outcome: "not_run", reason: "internal_text" };
  if (out.disabled === true) return { outcome: "not_run", reason: "not_attempted" };
  if (out.outcome_unknown === true || (opts.reportsOk && out.error === "outcome_unknown")) {
    return { outcome: "unconfirmed", reason: "unconfirmed" };
  }
  const succeeded = opts.reportsOk ? out.ok === true : out.success === true || out.ok === true;
  // `ok: false` beside a success claim is still a failure, whichever field the tool uses.
  if (succeeded && out.ok !== false && out.success !== false) {
    // An n8n run is started, not finished: the card says so rather than calling it done and dusted.
    return { outcome: "ran", reason: out.started === true ? "started" : null };
  }
  // The n8n management tools turn every write they attempted and lost into `outcome_unknown`
  // (handled above) — the provider's own refusal excepted — so their other `ok: false` answers
  // are refusals before anything was written (_shared/n8n-management.ts).
  const nothingApplied = out.not_applied === true || (opts.reportsOk === true && out.ok === false);
  return nothingApplied ? { outcome: "not_run", reason: "failed" } : { outcome: "unconfirmed", reason: "unconfirmed" };
}

/**
 * An approval that could not be used in this request because it had already been used before it.
 * Whatever used it may have done the work, so "didn't run" — true of this request — would offer
 * "Ask Paige again" for something that may already have happened.
 */
export function settleUsedEarlier(classified: Classified, usedEarlier: boolean | "unknown"): Classified {
  if (classified.outcome !== "not_run" || usedEarlier === false) return classified;
  // Could not look: then nobody knows whether it was used, and that is what the card says.
  return usedEarlier === "unknown"
    ? { outcome: "unconfirmed", reason: "unconfirmed" }
    : { outcome: "unconfirmed", reason: "unusable" };
}

/**
 * Make an approved call's result say what its card will say. When the card will report "couldn't
 * confirm", the model is told the same in the same words, so Paige never says "that failed" (and
 * offers to try again) beside a card telling the person to check first. The tool's own `error`
 * stays: it is the reason, and the audit row keeps it. Returns the content unchanged otherwise.
 */
export function sayWhatTheCardSays(content: string, opts: { reportsOk?: boolean } = {}): string {
  if (classifySpentApproval(content, opts).outcome !== "unconfirmed") return content;
  let out: Record<string, unknown>;
  try { out = JSON.parse(content); } catch { return content; }
  if (!out || typeof out !== "object" || Array.isArray(out) || out.outcome_unknown === true) return content;
  return JSON.stringify({ ...out, outcome_unknown: true, note: OUTCOME_UNKNOWN_NOTE });
}

/** An approval the handler never spent: the reason its tool was refused, if one was recorded. */
export function classifyUnspentApproval(refusal: ApprovalRefusalReason | undefined): Classified {
  return { outcome: "not_run", reason: refusal ?? "not_attempted" };
}

/**
 * Build the frame. When every action ended the same way the sentence is written ONCE, for the
 * batch, as the card-level note; saying the same reason on every row reads as a system repeating
 * itself. When they differ, each action that did not run carries its own sentence.
 */
export function buildApprovalOutcome(
  entries: Array<{ fingerprint: string } & Classified>,
): ApprovalOutcomeFrame {
  if (!entries.length) return { actions: [] };
  const first = entries[0];
  const uniform = entries.every((e) => e.outcome === first.outcome && e.reason === first.reason);
  if (uniform) {
    return {
      actions: entries.map(({ fingerprint, outcome }) => ({ fingerprint, outcome })),
      ...(first.reason ? { note: NOTES[first.reason](entries.length > 1) } : {}),
    };
  }
  return {
    actions: entries.map(({ fingerprint, outcome, reason }) => ({
      fingerprint,
      outcome,
      ...(reason ? { note: NOTES[reason](false) } : {}),
    })),
  };
}

/**
 * Did the answer to a thrown failure never arrive? Only then is the outcome unknown.
 *
 * - A PostgREST/Postgres refusal is a plain object carrying a SQLSTATE (or `PGRST…`) code: the
 *   database ANSWERED, so the outcome is known (it failed).
 * - A plain object with no such code is postgrest-js saying it has no answer: its own wrapped
 *   network failure, or a gateway page (a 504) in place of the database's reply. Handler code
 *   never throws a plain object, so there is nothing else it can be. Unknown.
 * - A transport failure thrown as an Error — an abort or timeout, a `TypeError` from fetch, a
 *   functions-js fetch or relay error, a storage client's unknown (network) error — means the
 *   request may have reached its destination and committed while the answer was lost.
 * - Any other throw (a validation `Error` raised by the handler's own code, a string) is a known
 *   failure. Calling it unknown would tell the operator "it may have gone through" about something
 *   that certainly did not, and send them checking for nothing.
 */
export function thrownOutcomeUnknown(err: unknown): boolean {
  const transport = /fetch|network|connection|socket|timed? ?out/i;
  if (err instanceof Error) {
    return err.name === "AbortError" || err.name === "TimeoutError"
      || /(?:FetchError|RelayError|UnknownError)$/.test(err.name)
      || (err.name === "TypeError" && transport.test(err.message));
  }
  // A network error's own code (`ECONNRESET`) is not the database answering: only a SQLSTATE is.
  if (err && typeof err === "object") return !databaseAnswered(err);
  return false;
}

/**
 * Did the database answer? postgrest-js reports a database refusal with its SQLSTATE (or
 * PostgREST's own `PGRST…` code). An error with neither is postgrest-js saying it has no answer —
 * a failed fetch, or a gateway page (a 504) in place of the database's reply — and the statement
 * may have committed.
 */
export function databaseAnswered(error: unknown): boolean {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code);
}

/**
 * Mark a database refusal of ONE call as having applied nothing, for the approval card. Only for a
 * call that is a single statement (one RPC): the database answered with a code, so its one
 * transaction rolled back and nothing it would have written was written. A multi-step tool must not
 * use this — an earlier step may already have committed. Returns the same error, to be thrown.
 */
export function refusedByDatabase<T>(error: T): T {
  if (databaseAnswered(error)) Object.assign(error as object, { not_applied: true });
  return error;
}

/**
 * Did a function invocation end without the function's own answer? A function that answered wrote
 * its own `ok`. An error that came back with no such answer means the request failed in transit,
 * the relay failed, or the platform cut the function off, and in each of those it may have run and
 * committed while the answer was lost. The safe reading is "couldn't confirm", never "didn't run".
 * `status` is the HTTP status of an answered request (a functions-js `FunctionsHttpError`), and
 * only that: a relay or fetch failure has no status worth reading.
 */
export function invokeOutcomeUnknown(error: unknown, body: Record<string, unknown>, status?: number): boolean {
  if (!error || typeof body.ok === "boolean") return false;
  // The gateway turning a request away (401, 404, 413, 429 …) is an answer too: the function never
  // started. A request timeout is not — it says nothing about what ran.
  if (typeof status === "number" && status >= 400 && status < 500 && status !== 408) return false;
  return true;
}

/** What the model is told when a call's answer never arrived, so its words match the card's. */
export const OUTCOME_UNKNOWN_NOTE =
  "Say this to the operator in ONE plain line: you could not confirm whether it went through, and they should check before asking for it again so it does not happen twice. Do NOT say it was done, do NOT say it failed, and do NOT call this tool again in this reply.";
