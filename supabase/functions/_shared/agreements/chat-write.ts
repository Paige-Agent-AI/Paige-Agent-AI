/**
 * INT-178 — the governed DRAFT path, the first WRITE PAIGE may make to an agreement.
 *
 * THE BOUNDARY, AND IT IS THE WHOLE POINT. This drafts. It does not send, resend, void, remind or
 * countersign, and it mints no signing link. Nothing it writes is visible to anyone outside the
 * workspace. The outward-facing keys stay unbuilt until each earns its own slice, for the reason
 * `domains/agreement.ts` gave when the READ half shipped first: the send path has a real client on
 * the other end of it.
 *
 * ONE SEAM, NOT A SECOND SYSTEM (§18). Everything below composes `public.save_paige_agreement`
 * (migration 20270401000000). This module owns no table and writes to none directly; it does not
 * re-implement a single rule the RPC already enforces, and it deliberately does not pre-check any
 * of them — a client-side copy of a server rule is a second policy that drifts.
 *
 * WHY THE CALLER'S CLIENT, NOT THE SERVICE ROLE. Same reasoning the read carries, and it matters
 * more here because this writes. `save_paige_agreement` is SECURITY DEFINER, so §59 requires it to
 * re-prove caller scope in its own body — and it does, through `auth.uid()`: authentication, the
 * expected-tenant comparison, owner-or-admin, and the client's membership of the workspace. Every
 * one of those reads NULL under the service role, so a service-role client would not make this
 * permissive, it would make it unauthenticated and refuse everything. The caller's JWT is both the
 * safe choice and the only working one.
 *
 * NOT IDEMPOTENT ON CREATE, AND THAT IS STATED RATHER THAN HIDDEN. With no `agreementId` the RPC
 * INSERTS: a blind retry mints a SECOND draft and a second counterparty signer, because the seed
 * trigger fires per insert. Nothing here dedupes it. The Chat confirmation fingerprint is the
 * execute-once guard, and it is the only one — which is why the capability's idempotency sentence
 * says so in the words an operator would read.
 *
 * ERRORS ARE MAPPED BY CODE, NEVER ECHOED. The RPC's refusals are authored for a human, but they
 * are raised on STANDARD SQLSTATEs (42501 / 23514 / 40001) rather than the reserved `PA###` class
 * this platform uses to mean "a person wrote this sentence for another person". So they are mapped,
 * not forwarded: raw database text must not reach a model or a transcript. The underlying message
 * goes to `console.error`, where an operator can read it and the model cannot.
 */

/** The RPC port. Deliberately structural so vitest can drive this without a Supabase client. */
export type AgreementWriteRpcPort = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

/** Why a draft did not happen. Each maps to exactly one caller-safe sentence below. */
export type AgreementWriteFailure =
  | "no_workspace"
  | "bad_contact_id"
  | "bad_agreement_id"
  | "empty_title"
  | "empty_body"
  | "refused"
  | "already_sent"
  | "conflict"
  | "unavailable"
  | "no_readback";

export type AgreementWriteResult =
  | { success: true; agreementId: string; title: string; status: string; created: boolean }
  | { success: false; reason: AgreementWriteFailure; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The sentences. Each says what happened to the DOCUMENT, because that is the thing the person
 * cares about, and each says plainly whether anything was written — a draft that may or may not
 * exist is worse than one that certainly does not.
 */
const MESSAGES: Record<AgreementWriteFailure, string> = {
  no_workspace: "No workspace is active, so nothing was drafted. Open a workspace and try again.",
  bad_contact_id:
    "That is not a client I can identify, so nothing was drafted. Look the client up first, then draft against the id that lookup returns.",
  bad_agreement_id:
    "That is not an agreement I can identify, so nothing was drafted and nothing was changed. List the agreements first and use the id from that list.",
  empty_title: "An agreement needs a title before it can be saved. Nothing was drafted.",
  empty_body: "An agreement needs its text before it can be saved. Nothing was drafted.",
  refused:
    "That agreement could not be drafted — the active workspace may have changed, this account may not be an owner or admin of it, or that client may not be in it. Nothing was written.",
  already_sent:
    "That agreement has already been sent, so it can no longer be changed. Nothing was written. Draft a new agreement instead of editing this one.",
  conflict:
    "Someone else changed this agreement while it was being edited, so nothing was written. Open it again to see their version before drafting over it.",
  unavailable:
    "The agreement could not be saved just now. Nothing was written. Try again, and if it keeps failing the agreements engine may need attention.",
  no_readback:
    "The save was not confirmed, so I cannot tell you whether the draft was written. Check the agreements list before drafting again — drafting a second time could leave you with two.",
};

function fail(reason: AgreementWriteFailure): AgreementWriteResult {
  return { success: false, reason, message: MESSAGES[reason] };
}

/**
 * Map a refusal to a reason. The RPC raises several distinct sentences on ONE SQLSTATE, so the code
 * alone is not enough to tell "already sent" from an ordinary validation refusal — and that one
 * distinction is worth making, because the remedy differs (draft a NEW agreement, rather than fix
 * this one). It is matched on a stable substring of the server's own sentence and falls back to the
 * generic reason when it does not match, so a reworded refusal degrades to a safe message rather
 * than to a wrong one.
 */
function classify(error: { message?: string; code?: string }): AgreementWriteFailure {
  const said = (error.message ?? "").toLowerCase();
  if (error.code === "40001") return "conflict";
  if (error.code === "42501") return "refused";
  if (error.code === "23514") {
    if (said.includes("already been sent")) return "already_sent";
    if (said.includes("title")) return "empty_title";
    if (said.includes("body")) return "empty_body";
    return "unavailable";
  }
  return "unavailable";
}

/**
 * Draft a new agreement, or revise one that is still a draft.
 *
 * `expectedTenantId` is a BRAKE, never a steering wheel — it is the tenant the chat turn already
 * resolved server-side, and the RPC compares it to the session's own tenant and refuses when they
 * differ. Passing it cannot widen what the caller may write.
 */
export async function draftAgreement(input: {
  caller: AgreementWriteRpcPort;
  expectedTenantId: string | null | undefined;
  contactId: unknown;
  title: unknown;
  bodyMarkdown: unknown;
  agreementId?: unknown;
}): Promise<AgreementWriteResult> {
  const { caller, expectedTenantId } = input;
  if (!expectedTenantId) return fail("no_workspace");

  // Ids are validated HERE, not left to the tool schema. JSON-Schema `format: "uuid"` is advisory —
  // nothing enforces it, and a model inventing an id is ordinary rather than exceptional. Letting
  // one through makes Postgres fail the cast, which surfaces as an engine fault rather than as the
  // true answer, which is that the id was never real.
  const contactId = typeof input.contactId === "string" ? input.contactId.trim() : "";
  if (!UUID.test(contactId)) return fail("bad_contact_id");

  const hasId = input.agreementId !== undefined && input.agreementId !== null && input.agreementId !== "";
  const agreementId = hasId && typeof input.agreementId === "string" ? input.agreementId.trim() : "";
  if (hasId && !UUID.test(agreementId)) return fail("bad_agreement_id");

  // Refused here as well as by the RPC, because an empty title or body is a model mistake rather
  // than a server condition, and the round trip teaches it nothing the sentence does not.
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return fail("empty_title");
  const bodyMarkdown = typeof input.bodyMarkdown === "string" ? input.bodyMarkdown.trim() : "";
  if (!bodyMarkdown) return fail("empty_body");

  let data: unknown;
  let error: { message?: string; code?: string } | null;
  try {
    ({ data, error } = await caller.rpc("save_paige_agreement", {
      _expected_tenant_id: expectedTenantId,
      _agreement_id: hasId ? agreementId : null,
      _contact_id: contactId,
      _title: title,
      _body_markdown: bodyMarkdown,
    }));
  } catch (thrown) {
    // A THROW is not a refusal, and must not be reported as one. PostgREST resolves its errors; a
    // throw here is transport. Either way nothing is known to have been written.
    console.error("[agreement_draft] save threw", {
      reason: thrown instanceof Error ? thrown.message : "unknown",
    });
    return fail("unavailable");
  }

  if (error) {
    // The server's own words go where an operator reads them and the model does not.
    console.error("[agreement_draft] save refused", { code: error.code, message: error.message });
    return fail(classify(error));
  }

  // A resolved call with no row is NOT a success. The write may have landed, so this must never
  // advise a retry that could duplicate it — which is exactly what the create path would do.
  const row = data as { id?: unknown; title?: unknown; status?: unknown } | null;
  if (!row || typeof row.id !== "string") {
    console.error("[agreement_draft] save returned no row");
    return fail("no_readback");
  }

  return {
    success: true,
    agreementId: row.id,
    title: typeof row.title === "string" ? row.title : title,
    status: typeof row.status === "string" ? row.status : "draft",
    // Which of the two things happened, said plainly, because "saved" reads as an edit and a
    // silently-created duplicate is the failure this tool is most likely to produce.
    created: !hasId,
  };
}

/**
 * ─── THE SEND ────────────────────────────────────────────────────────────────────────────────
 *
 * THIS REACHES SOMEONE. It emails each signer a link they can sign with, freezes the presented
 * document as the record of what they were shown, and moves the agreement one way out of draft.
 * Nothing recalls it once delivered. That is why `agreement_send` is classified `high`: the model
 * asserting "they said yes" is refused outright, and only a fingerprint echoed back from a card a
 * person actually saw will run it.
 *
 * IT CALLS THE EDGE FUNCTION, NOT AN RPC, AND FORWARDS THE CALLER'S JWT. `agreement-send` runs its
 * OWN owner-or-admin check against that token — the one that could not bind until recently, so
 * every send refused for everyone. Forwarding the caller's authorization is what makes that check
 * mean something; a service-role call would bypass the very gate this depends on.
 *
 * ONE SEND PER DRAFT IS THE GUARANTEE. EXACTLY-ONCE DELIVERY IS NOT. A second plain send is refused
 * 409 by the status gate, and a signer already holding a live link is reported as not delivered
 * rather than re-mailed. Below that, nothing dedupes — the shared sender records its idempotency
 * key and deliberately does not act on it. Never describe this as exactly-once.
 *
 * `res.ok` IS NOT DELIVERY, and this module does not pretend otherwise: the function answers with a
 * body naming who was sent to and who was not, and that body is the truth. A 2xx with nobody
 * delivered is a real outcome and is reported as one.
 */
export type AgreementSendFailure =
  | "no_workspace"
  | "bad_agreement_id"
  | "refused"
  | "not_a_draft"
  | "needs_setup"
  | "document_problem"
  | "stale_document"
  | "not_delivered"
  | "nobody_reachable"
  | "unavailable";

export type AgreementSendResult =
  | { success: true; agreementId: string; sentTo: number; notDelivered: number }
  | { success: false; reason: AgreementSendFailure; message: string };

const SEND_MESSAGES: Record<AgreementSendFailure, string> = {
  no_workspace: "No workspace is active, so nothing was sent.",
  bad_agreement_id:
    "That is not an agreement I can identify, so nothing was sent. List the agreements and use the id from that list.",
  refused:
    "That agreement could not be sent — the active workspace may have changed, or this account may not be an owner or admin of it. Nothing was sent.",
  not_a_draft:
    "That agreement is not a draft any more, so it was not sent again. Nothing went out. Draft a new agreement rather than resending this one.",
  needs_setup:
    "Something this agreement needs is missing, so nothing was sent. It may have no signer yet, or the workspace may have no contact address for signers to reach. Open the agreement in Sales — it will say which.",
  document_problem:
    "The document for that agreement could not be prepared, so nothing was sent and nobody was emailed. The agreement is unchanged.",
  stale_document:
    "The document stored for that agreement is not the file that was uploaded, so nothing was sent. Create a new agreement from that document and send that instead.",
  not_delivered:
    "No signer could be reached, so the send did not complete — and in the case where an email went out but its link could not be activated, that email may already be in their inbox. The door names each signer and why; a resend is the fix for a dead link.",
  nobody_reachable:
    "Nothing reached anybody. No message went out, so this agreement is unchanged and nobody has been asked to sign.",
  unavailable:
    "The agreement could not be sent just now. Nothing is known to have gone out. Check the agreement's status before trying again, because a send that did reach someone cannot be recalled.",
};

function sendFail(reason: AgreementSendFailure): AgreementSendResult {
  return { success: false, reason, message: SEND_MESSAGES[reason] };
}

/** The HTTP port. Structural so vitest can drive this without a network. */
export type AgreementSendPort = (
  agreementId: string,
) => PromiseLike<{ ok: boolean; status: number; body: unknown }>;

/**
 * The refusals `sendAgreement` makes before any I/O: no workspace, or an id that is not a UUID. Pure,
 * and exported so the chat's step START (paige-ai-chat `announceStart`) asks the SAME question rather
 * than a copy of it — a send these refuse is never announced as running.
 */
export function agreementSendPrecheck(
  expectedTenantId: string | null | undefined,
  rawAgreementId: unknown,
): { ok: true; agreementId: string } | { ok: false; reason: "no_workspace" | "bad_agreement_id" } {
  if (!expectedTenantId) return { ok: false, reason: "no_workspace" };
  const agreementId = typeof rawAgreementId === "string" ? rawAgreementId.trim() : "";
  if (!UUID.test(agreementId)) return { ok: false, reason: "bad_agreement_id" };
  return { ok: true, agreementId };
}

export async function sendAgreement(input: {
  send: AgreementSendPort;
  expectedTenantId: string | null | undefined;
  agreementId: unknown;
}): Promise<AgreementSendResult> {
  const pre = agreementSendPrecheck(input.expectedTenantId, input.agreementId);
  if (!pre.ok) return sendFail(pre.reason);
  const agreementId = pre.agreementId;

  let reply: { ok: boolean; status: number; body: unknown };
  try {
    reply = await input.send(agreementId);
  } catch (thrown) {
    // A THROW leaves the outcome GENUINELY UNKNOWN — the request may have been received and acted
    // on. The sentence says so rather than inviting a retry that could email a signer twice.
    console.error("[agreement_send] send threw", {
      reason: thrown instanceof Error ? thrown.message : "unknown",
    });
    return sendFail("unavailable");
  }

  const body = (reply.body ?? {}) as {
    ok?: unknown; error?: unknown; status?: unknown;
    sent?: unknown; failed?: unknown; notDelivered?: unknown;
  };

  if (!reply.ok) {
    // The function's own refusal sentences are written for a person, but they are not carried
    // through: they are its words about its internals, and the caller gets a mapped sentence. The
    // status is what distinguishes the cases a person can act on.
    console.error("[agreement_send] refused", { status: reply.status, error: body.error });
    // MAPPED FROM WHAT THE FUNCTION ACTUALLY RETURNS, read at its source rather than assumed — an
    // earlier draft of this map had 502 as the document case and 422 as nothing, which would have
    // told a person to check the wrong thing.
    //   403 not an owner/admin, or no tenant     404 not in this workspace
    //   409 already sent / cannot be resent, AND `needs_config` (no workspace contact address)
    //   400 malformed, or no signer yet          422 a name or document that cannot be rendered
    //   502 the document could not be stored, verified or recorded
    if (reply.status === 403) return sendFail("refused");
    if (reply.status === 404) return sendFail("bad_agreement_id");
    if (reply.status === 409) {
      // The 409 family carries three different remedies, and the body distinguishes them: a missing
      // workspace contact address is `needs_config`, which a person fixes; a row whose frozen bytes
      // are not the uploaded file is a STALE DOCUMENT that only a new agreement fixes; an agreement
      // that has already gone is not a retry at all.
      if (body.status === "needs_config") return sendFail("needs_setup");
      if (typeof body.error === "string" && body.error.includes("not the file that was uploaded")) {
        return sendFail("stale_document");
      }
      return sendFail("not_a_draft");
    }
    // The id is validated above, so a 400 on a well-formed id is the "add at least one signer" case
    // rather than a malformed request — actionable, and named as such.
    if (reply.status === 400) return sendFail("needs_setup");
    if (reply.status === 422) return sendFail("document_problem");
    if (reply.status === 502) {
      // The door's own document failures all happen BEFORE any send, so "nobody was emailed" is
      // true for them. The `not_sent` answer is different: it means no signer completed delivery,
      // and one named case is an email that DID go out with a link that could not be activated —
      // claiming nobody was emailed there would be false in the direction that matters.
      return sendFail(body.status === "not_sent" ? "not_delivered" : "document_problem");
    }
    return sendFail("unavailable");
  }

  // A 2xx WITH NOBODY DELIVERED IS NOT A SUCCESS. `res.ok` means the function ran, not that a
  // signer was emailed — reading only the status is exactly how a send with zero recipients gets
  // reported to an owner as delivered.
  const sent = Array.isArray(body.sent) ? body.sent.length : 0;
  // `failed` and `notDelivered` are DIFFERENT lists in the function's reply, and collapsing them
  // would under-report. Both mean a named signer did not get their link.
  const notDelivered =
    (Array.isArray(body.notDelivered) ? body.notDelivered.length : 0) +
    (Array.isArray(body.failed) ? body.failed.length : 0);
  if (sent === 0) {
    console.error("[agreement_send] completed with no recipient", { notDelivered });
    return sendFail("nobody_reachable");
  }

  return { success: true, agreementId, sentTo: sent, notDelivered };
}
