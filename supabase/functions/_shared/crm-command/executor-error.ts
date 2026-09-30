/**
 * WHAT A FAILED CRM EXECUTOR CALL IS ALLOWED TO TELL PAIGE.
 *
 * On 2026-09-25 an approved `contact.create` reached the executor and was refused with
 *
 *     CRM_PATCH_FIELDS_INVALID:company_name,zip
 *
 * — the executor naming, precisely, the two fields it could not accept. `crm-command` then
 * tested that message against `/^(CRM|PIPELINE)_[A-Z0-9_:,-]+$/`, whose character class has no
 * lowercase in it, so the message was discarded and replaced with the generic
 * `CRM_COMMAND_FAILED`. Paige was handed a failure with no reason inside it and told the
 * operator "That one failed on our end", which was the only truthful sentence available to her.
 * `paige_audit_log` recorded the same generic code twice that afternoon (17:34:39.237Z and
 * 17:37:52.332Z, both `crm_create_contact` / `failed`), so the filter did not merely blind
 * Paige in the moment — it blinded the permanent record of what went wrong.
 *
 * THE FILTER WAS NOT ARBITRARY, AND THAT IS THE WHOLE DIFFICULTY. It is the guard that stops
 * raw database text reaching a model and a person, and that job is real: `commandError.message`
 * is not limited to our own `raise exception` calls. Any Postgres error raised anywhere inside
 * the executor surfaces through the same field — a unique violation quoting an index name, a
 * check violation quoting a ROW VALUE belonging to some other record, a not-null violation
 * naming a column, a nested trigger raising whatever text it likes. None of that may be read
 * out to an operator or fed into a model's context.
 *
 * SO THE REPAIR IS NOT TO ADD `a-z` TO THE CHARACTER CLASS. That would fix the reported symptom
 * and open a channel in the same line, because the detail on the one error actually in evidence
 * is CALLER-AUTHORED: `CRM_PATCH_FIELDS_INVALID`'s payload is `array_to_string(v_unknown, ',')`,
 * and `v_unknown` is the set of patch keys the CALLER sent that the allowlist did not match.
 * `patch` is validated as `z.record(z.unknown())`, which accepts any string key of any length,
 * so a widened character class would pass unbounded lowercase text of the caller's choosing
 * straight through to the model.
 *
 * The repair is to stop treating the message as one string to be admitted or refused whole, and
 * to parse it into a bounded, explicitly-shaped payload instead:
 *
 *   HEAD    `CRM_…` or `PIPELINE_…`, uppercase only, at most HEAD_MAX characters. Deliberately
 *           the same shape the old filter accepted, so every code that survives today survives
 *           with a byte-identical value and every downstream equality and `includes` branch
 *           keeps exactly the meaning it has now.
 *   DETAIL  everything after the FIRST ':', admitted only as a comma-separated list of
 *           identifier-shaped tokens — `[A-Za-z0-9_-]`, at most TOKEN_MAX characters each, at
 *           most TOKEN_LIMIT of them, from a raw tail of at most TAIL_MAX characters. If any
 *           part of that fails, the detail is dropped whole and the head still survives alone.
 *
 * The detail is returned as an ARRAY rather than left interpolated in the code string, because
 * a model reads an array as data and a string as prose.
 *
 * CHECKED AGAINST THE WORST STRING EACH LIVE RAISE CAN PRODUCE. Read out of
 * `pg_get_functiondef` on prod rather than out of `20270204000000`, which is superseded — the
 * live authority is `execute_crm_command_reversible` and `preview_crm_command`:
 *
 *   CRM_PATCH_FIELDS_INVALID:%          array_to_string(v_unknown, ',')     caller-authored
 *   CRM_CONTACT_ALREADY_EXISTS:%        v_created.contact_id                a uuid, 36 chars
 *   CRM_DEAL_NOT_EXECUTED:%             a pipeline outcome word             short, lowercase
 *   CRM_BULK_TARGET_VERSION_CONFLICT:%  a changed-target payload
 *
 * CORRECTED after the §39 peer-gate (F6): an earlier draft of this block called that list
 * exhaustive. It is not. Live prod carries SIX detail-bearing raises, not four — the two this
 * block missed are `PIPELINE_IS_DEFAULT: set another pipeline as default first` and
 * `PIPELINE_STAGE_OCCUPIED: move its work before archiving`, from `delete_pipeline`,
 * `manage_pipeline_stage` and the `prevent_occupied_stage_archive` trigger. Both are handled
 * correctly — their prose detail fails the token shape and is dropped, so the specific code
 * survives and the sentence does not — but a comment claiming exhaustiveness is load-bearing for
 * the next reviewer, and this one was wrong. The enumeration is a sample of the shapes, not a
 * closed set; the GUARANTEE comes from the parse below refusing anything that is not token-shaped.
 *
 * and against the strings that must NOT survive, every one of which fails the head match on its
 * very first character and is discarded exactly as it is today:
 *
 *   duplicate key value violates unique constraint "contacts_tenant_id_email_key"
 *   new row for relation "contacts" violates check constraint "contacts_email_check"
 *   null value in column "entity_name" of relation "contacts" violates not-null constraint
 *   Key (tenant_id, email)=(…, someone.else@example.com) already exists.
 *
 * THE RESIDUE, STATED PLAINLY RATHER THAN PAPERED OVER. A caller can still choose the TEXT of a
 * token, within TOKEN_MAX characters and with no spaces in it, and that text is echoed back to
 * the model.
 *
 * CORRECTED after the §39 peer-gate (F7). An earlier draft justified this as "the authenticated
 * operator's own session ... who can already type anything they like into the same chat." That
 * reasoning is WRONG and would have let the next reviewer wave through a genuine third-party
 * channel. Patch keys are MODEL-authored, and the model's context routinely carries untrusted
 * third-party text — inbound email, client-portal content, attached documents.
 *
 * The conclusion survives on a different and sounder argument: the echo grants no capability the
 * injected text did not already hold, because that text had to be in the model's context to reach
 * the patch in the first place. Echoing it back adds no reach. What the cap buys is narrowness,
 * not authority — TOKEN_MAX is set at the width of the widest LEGITIMATE token (a uuid at 36) plus
 * a small margin rather than anything rounder and larger, and TAIL_MAX at 256 binds first in
 * practice, specifically to keep the channel too narrow to carry a fluent instruction. The
 * peer-gate proved the cap holds: an 8-token underscore-prose payload was refused at 276 chars,
 * and newline, CRLF, NUL, RTL-override and non-ASCII all drop the detail whole.
 */

/** `CRM_BULK_TARGET_VERSION_CONFLICT` is the longest live head at 32 characters. */
const HEAD_MAX = 64;
/** The widest legitimate token is a uuid (36). The margin is deliberate and small. */
const TOKEN_MAX = 40;
/** The failure in evidence carried two. Eight is generous for a badly-wrong patch. */
const TOKEN_LIMIT = 8;
/** Refuse an oversized tail before splitting it, rather than after. */
const TAIL_MAX = 256;

const HEAD_SHAPE = /^(?:CRM|PIPELINE)_[A-Z][A-Z0-9_]*$/;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+$/;

export type ExecutorError = {
  /** Bare, uppercase, machine-readable. Never carries the detail. */
  code: string;
  /** Bounded identifier-shaped tokens. Empty when there was no admissible detail. */
  detail: string[];
};

/**
 * Parse a Postgres error message into the most the operator's session is allowed to learn from
 * it. `fallback` is the generic code to use when nothing admissible survives — the caller picks
 * it, because the three call sites mean different things by failure.
 */
export function parseExecutorError(
  raw: string | null | undefined,
  fallback: string,
): ExecutorError {
  const message = typeof raw === "string" ? raw.trim() : "";
  if (!message) return { code: fallback, detail: [] };

  const split = message.indexOf(":");
  const head = split === -1 ? message : message.slice(0, split);
  if (head.length > HEAD_MAX || !HEAD_SHAPE.test(head)) return { code: fallback, detail: [] };

  // The head is ours. Past this point the worst case is a dropped detail, never a dropped code.
  if (split === -1) return { code: head, detail: [] };

  const tail = message.slice(split + 1);
  if (!tail || tail.length > TAIL_MAX) return { code: head, detail: [] };

  const tokens = tail.split(",");
  if (tokens.length > TOKEN_LIMIT) return { code: head, detail: [] };
  for (const token of tokens) {
    if (!token || token.length > TOKEN_MAX || !TOKEN_SHAPE.test(token)) {
      return { code: head, detail: [] };
    }
  }
  return { code: head, detail: tokens };
}

/**
 * THE PLAIN WORDS (§36). What survives above is machine-readable, and `CRM_PATCH_FIELDS_INVALID`
 * is jargon followed by a field name the operator never typed. So the response also carries the
 * two fields the Chat door already understands from its own CRM refusals: a `note` telling the
 * model how to say it to a person in ONE line, and — where it genuinely beats the bare code, see
 * the audit-row reasoning below — a plain `message` sentence, which `paige-ai-chat` reads as
 * `error` ahead of `code`.
 *
 * There is deliberately no per-code phrasebook here. Sixty hand-written sentences would go stale
 * the moment a new `raise` lands, and writing prose for codes with no evidence behind them is
 * inventing behaviour. Instead the model is handed the precise reason as DATA — `code` plus
 * `detail` — and instructed to put it into its own plain words without reciting either.
 *
 * `effect` is not decoration, and it is not defaulted on purpose. The three call sites know
 * different things about whether anything was written, and a sentence that is true at one of
 * them is a lie at another:
 *
 *   "refused"  the executor refused this command — preview or execute. Nothing was written.
 *   "unproven" the idempotency readback could not be completed. Nothing ran in THIS request, but
 *              an earlier attempt under the same key may already have committed, so this must
 *              never claim that nothing was created. It says what it knows and stops there.
 *   "lost"     the execute call went out and its answer did not come back: no database code, so
 *              the database never said no, and the command may have committed. It must not
 *              claim anything either way.
 *
 * WHY `message` IS RARE AND `note` IS ALWAYS THERE. Walking this response downstream (§37) turns
 * up a consumer past the obvious one. `paige-ai-chat` builds the tool result as
 * `error: crmBody.message ?? crmBody.code ?? …`, and its `paige_audit_log` writer then persists
 * `String(out.error).slice(0, 300)` as the permanent record of what went wrong. So a `message`
 * does not merely steer the model — it DISPLACES the code in the audit row. Attaching a plain
 * sentence to all ~55 bare codes would have turned `CRM_CONTACT_NOT_FOUND` in the audit log into
 * "The workspace refused this one", which is a forensic regression introduced by a fix for a
 * forensics problem.
 *
 * So `message` is set only where there is a genuinely better sentence than the bare code AND the
 * code it displaces is the useless one — `CRM_PATCH_FIELDS_INVALID`, whose audit row today reads
 * `CRM_COMMAND_FAILED` anyway. Everywhere else `message` is omitted, `error` falls back to the
 * specific code exactly as it does today, and the audit row is byte-identical to before.
 *
 * `note` is safe to attach everywhere, because nothing downstream reads it except the model, and
 * it is what actually carries §36: it tells the model to put the reason in plain words and
 * forbids it reciting the code or the field names to a person. That is the plain-words guarantee
 * — not the `error` string, which no operator ever sees.
 */
export function executorFailureSpeech(
  code: string,
  detail: string[],
  effect: "refused" | "unproven" | "lost",
): { message?: string; note: string; outcome_unknown?: true } {
  if (effect === "lost") {
    return {
      outcome_unknown: true,
      note:
        "Say this to the operator in ONE plain line: you could not confirm whether it went through, and they should check the record before asking for it again so it does not happen twice. Do NOT claim anything was created or changed, do NOT claim it failed, do NOT read the code out to them, and do NOT call this tool again in this reply.",
    };
  }
  if (effect === "unproven") {
    return {
      // The same fact as data, for the approval card: the chat reads this flag, never the prose,
      // and reports the approval as "couldn't confirm" instead of "didn't go through".
      outcome_unknown: true,
      note:
        "Say this to the operator in ONE plain line: nothing ran just now, you could not confirm what happened to the earlier attempt, and they should check the record before asking for it again. Do NOT claim anything was created or changed, do NOT claim it failed outright, do NOT read the code out to them, and do NOT call this tool again in this reply.",
    };
  }
  if (code === "CRM_PATCH_FIELDS_INVALID" && detail.length > 0) {
    return {
      message:
        "Nothing was created or changed. Some of the details were sent under names this workspace does not accept.",
      note:
        "Say this to the operator in ONE plain line: nothing was saved, you sent some of the details under the wrong names, and this one needs looking at. Do NOT read the field names or the code out to them, do NOT claim anything was created or changed, and do NOT call this tool again in this reply.",
    };
  }
  return {
    note:
      "Say this to the operator in ONE plain line: nothing was created or changed, and say why in your own plain words, taking the reason from the `code` and `detail` fields. Do NOT read the code, the field names or any internal wording out to them, do NOT claim anything was saved, and do NOT call this tool again in this reply.",
  };
}
