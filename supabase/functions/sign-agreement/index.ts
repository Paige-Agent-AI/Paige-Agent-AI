// sign-agreement — the token-gated signing act (INT-163). `verify_jwt = false`.
//
// WHAT THIS IS, AND WHAT IT IS NOT. The signer's surface is the owner-approved React route
// `/sign/:token`, built and browser-verified by the UI lane and FROZEN under §28. This function
// serves NO markup. It does the work that genuinely needs elevated credentials and cannot happen in
// the page or in a database function: producing the signed PDF, sealing it, writing the audit trail,
// and sending notifications.
//
// The page's other calls are RPCs — `peek_agreement_signing` and `decline_agreement_signing` — so
// this endpoint exists for exactly the one act that needs pdf-lib and the service role.
//
// THE ONE RULE, unchanged from the rest of the engine: tenant, agreement and signer are read FROM
// THE TOKEN ROW. No request field names or steers any of them. That is the deliberate inverse of
// `docusign-send-envelope`, which resolves a body-supplied contact id with the service-role client
// and no tenant filter.
//
// SUCCESS IS UNAMBIGUOUS. `ok: true` is returned only when the signature is committed, and the page
// treats anything else as "nothing was signed" (§13). There is no optimistic path: a seal that fails
// after a committed signature returns `ok: true` with `completed: false` and says so, because the
// signature genuinely IS recorded and claiming otherwise would be its own lie.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { overRateLimit, trustedClientIp } from "../_shared/rateLimit.ts";
import { sha256Hex } from "../_shared/agreements/token.ts";
import { verifyRetainedAgreementPdf } from "../_shared/agreements/retained-document.ts";
import { checkSignatureImage, decideSigningAccess, MAX_BODY_BYTES, TOKEN_SHAPE } from "../_shared/agreements/signing-guard.ts";
import { assertDocumentIsRenderable, UnrenderableDocumentError, wouldLoseCharacters } from "../_shared/agreements/document.ts";
import { consentEvidenceText, ESIGN_CONSENT_DISCLOSURE } from "../_shared/agreements/disclosure.ts";
import { sealAndComplete } from "../_shared/agreements/seal.ts";
import { notify, ownerNotificationEmail, tenantContactForDisclosure } from "../_shared/agreements/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

// Typed from the factory rather than from `ReturnType<typeof createClient>`: supabase-js's generic
// DEFAULTS drift between releases (the declared default is `unknown`/`never`, what a real call infers
// is `any`/`"public"`), so the widely-copied `ReturnType<typeof createClient>` no longer describes the
// client this file actually builds. Inferring from the same factory the handler calls cannot drift.
const serviceClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
type ServiceClient = ReturnType<typeof serviceClient>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * ONE REFUSAL, whatever the cause.
 *
 * Unknown, expired, revoked, already signed, already declined and voided all leave by this door with
 * the same body. Telling them apart confirms to a stranger that a guessed token is real, which turns
 * this into a way to discover which agreements exist. The BUSINESS sees the true state on its own
 * authenticated surface, where it is entitled to.
 */
const refuse = () =>
  json({ ok: false, error: "This signing link is not valid. Ask the sender to send you a new one." }, 404);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const db = serviceClient();
  const ip = trustedClientIp(req);

  // Per-address ceiling first, before the body is read or anything is hashed. Fail-OPEN: a limiter
  // hiccup must never strand a real signer mid-ceremony, and entropy — not this — is what defeats
  // guessing a 256-bit token.
  if (await overRateLimit(db, `sa:ip:${ip}`, 20, 60) || await overRateLimit(db, `sa:iph:${ip}`, 120, 3600)) {
    return json({ ok: false, error: "Too many attempts. Please wait a moment and try again." }, 429);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "That request was too large." }, 413);

  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw || "{}"); } catch { return json({ ok: false, error: "Malformed request." }, 400); }

  const token = String(body.token ?? "").trim();
  // Shape before hashing: anything that is not 64 hex is garbage, refused for the cost of a regex.
  if (!TOKEN_SHAPE.test(token)) return refuse();

  const typedName = String(body.typed_name ?? "").trim();
  const consentRead = body.consent_read === true;
  const consentEsign = body.consent_esign === true;
  const signatureImage = body.signature_image_base64 ?? null;

  const tokenHash = await sha256Hex(token);
  // Per-token ceiling, keyed on the HASH. Never the raw token: the limiter persists its bucket in a
  // durable table with no prune job, so keying on the plaintext would re-store the one credential we
  // went to the trouble of never storing.
  if (await overRateLimit(db, `sa:tok:${tokenHash.slice(0, 32)}`, 5, 60, true)) {
    return json({ ok: false, error: "Too many attempts. Please wait a minute." }, 429);
  }

  const { data: signer } = await db.from("paige_agreement_signers")
    .select("id,agreement_id,tenant_id,status,signing_order,full_name,email,token_hash,token_expires_at,token_revoked_at")
    .eq("token_hash", tokenHash).maybeSingle();
  if (!signer) return refuse();

  const now = new Date();

  const { data: agreement } = await db.from("paige_agreements")
    .select("id,tenant_id,title,body_source,body_markdown,status,expires_at,content_storage_key,content_sha256")
    .eq("id", signer.agreement_id).maybeSingle();

  // Out of turn is a refusal for the same reason as everything else: this person cannot sign yet, and
  // which of the several reasons applies is not a stranger's business.
  const { count: earlier } = await db.from("paige_agreement_signers")
    .select("id", { count: "exact", head: true })
    .eq("agreement_id", signer.agreement_id).lt("signing_order", signer.signing_order).neq("status", "signed");

  // ONE HOME FOR THE ELIGIBILITY RULES. `decideSigningAccess` is pure and driven exhaustively in
  // `signing-guard.test.ts`, including the orderings that are easy to get subtly wrong — revoked
  // outranking everything, a NULL expiry failing closed, and completed being answered BEFORE the
  // signing deadline. Re-deriving those here would be a second copy of the same rules, and the
  // second copy is always the one that drifts. For the ACT of signing, only `canSign` counts.
  const decision = decideSigningAccess({
    signer: signer as never,
    agreement: agreement as never,
    earlierUnsignedCount: earlier ?? 0,
    now,
  });
  if (!decision.allow || !decision.canSign) return refuse();
  if (!agreement || agreement.tenant_id !== signer.tenant_id) return refuse();

  // ── Now the parts that are the SIGNER's mistake to make, and are told plainly ──────────────────
  if (!consentRead || !consentEsign) {
    return json({ ok: false, error: "Both confirmations are required before you can sign." }, 400);
  }
  if (typedName.length < 2) {
    return json({ ok: false, error: "Please type your full legal name." }, 400);
  }
  // EVERY VALUE THAT MUST SURVIVE THE SEAL IS CHECKED HERE, before anything terminal is written.
  // `status = 'signed'` is one-way by trigger and the sealed document is write-once, so a value that
  // only fails at stamping time strands the agreement permanently — signature recorded, completion
  // impossible, and no shipped path able to clear the column. A 400 now costs the signer one retry.
  if (wouldLoseCharacters(typedName)) {
    return json({
      ok: false,
      error: "The signature block cannot reproduce the characters in that name yet (Latin characters only), so signing it would put the wrong name on the record. Type a Latin-character spelling of your name.",
    }, 400);
  }
  const image = checkSignatureImage(signatureImage);
  if (!image.ok) return json({ ok: false, error: image.reason }, 400);

  // The same question asked of the DOCUMENT. An agreement whose own text cannot be exported would
  // seal to a page of question marks — and `pa_sent_is_frozen_ck` means it could never be corrected
  // — so it is refused before a counterparty binds themselves to it rather than after.
  try {
    assertDocumentIsRenderable(
      String(agreement.title),
      agreement.body_source === "tenant_upload" ? null : (agreement.body_markdown as string | null),
    );
  } catch (e) {
    if (e instanceof UnrenderableDocumentError) {
      console.error("[sign-agreement] refused — document text cannot be exported", {
        agreementId: signer.agreement_id,
      });
      return json({
        ok: false,
        error: "This agreement cannot be signed as written: some of its text cannot be reproduced in the signed document. Ask the sender to reissue it.",
      }, 422);
    }
    throw e;
  }

  // The seal checks again after the signature. Check the same frozen presentation
  // BEFORE the one-way write as well: an absent or altered file/text must not leave
  // a new signer bound to a record we already know cannot be retained faithfully.
  // No rendering or mutable commercial-terms lookup belongs in this check.
  let presentationVerified = false;
  try {
    if (agreement.content_storage_key) {
      const presented = await db.storage.from("paige-agreements").download(agreement.content_storage_key);
      if (!presented.error && presented.data) {
        presentationVerified = await verifyRetainedAgreementPdf(
          new Uint8Array(await presented.data.arrayBuffer()), agreement.content_sha256,
        );
      }
    } else if (agreement.body_source !== "tenant_upload" && typeof agreement.body_markdown === "string") {
      presentationVerified = typeof agreement.content_sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(agreement.content_sha256) &&
        await sha256Hex(agreement.body_markdown) === agreement.content_sha256;
    }
  } catch {
    // Storage/verification failure cannot grant permission to commit a signature.
  }
  if (!presentationVerified) {
    console.error("[sign-agreement] retained presentation could not be verified", { agreementId: agreement.id });
    return json({
      ok: false,
      error: "This agreement cannot be signed right now because its retained document could not be verified. Please reload or contact the sender.",
    }, 503);
  }

  const tenantContact = await tenantContactForDisclosure(db as never, String(signer.tenant_id));
  if (!tenantContact) {
    // The send path refuses without one, so reaching here means the workspace lost it afterwards.
    // Recording consent against a notice that promises a route to nobody would permanently hash a
    // defective disclosure into the legal record.
    console.error("[sign-agreement] no tenant contact address — consent not recorded", {
      tenantId: signer.tenant_id, agreementId: signer.agreement_id,
    });
    return json({
      ok: false,
      error: "This agreement cannot be signed right now because the sender has no contact address on file. Please contact them directly.",
    }, 409);
  }

  const { data: tenantRow } = await db.from("tenants").select("name").eq("id", signer.tenant_id).maybeSingle();
  const consentText = consentEvidenceText(
    ESIGN_CONSENT_DISCLOSURE, String(tenantRow?.name ?? "the sender"), tenantContact,
  );
  const nowIso = now.toISOString();

  // Conditional on the signer still being unsigned, which is what makes a double-submit idempotent at
  // the ROW rather than in this function's memory. The database's own triggers independently refuse
  // an out-of-turn or already-signed write.
  const { data: committed, error: signError } = await db.from("paige_agreement_signers").update({
    status: "signed",
    signed_at: nowIso,
    typed_name: typedName.slice(0, 200),
    signature_image_png: image.base64,
    esign_consent_at: nowIso,
    esign_consent_slug: ESIGN_CONSENT_DISCLOSURE.slug,
    esign_consent_version: ESIGN_CONSENT_DISCLOSURE.version,
    esign_consent_sha256: await sha256Hex(consentText),
    signing_ip: ip === "unknown" ? null : ip,
    signing_user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500),
  }).eq("id", signer.id).in("status", ["pending", "viewed"]).is("token_revoked_at", null).select("id");

  if (signError) {
    console.error("[sign-agreement] signature write refused", {
      error: signError.message, code: (signError as { code?: string }).code,
    });
    return json({ ok: false, error: "That signature could not be recorded. Please reload and try again." }, 409);
  }
  if (!committed || committed.length === 0) {
    // A ZERO-ROW UPDATE IS NOT ALWAYS A REFUSAL. The conditional write is what makes a double-submit
    // safe at the row — and it matches nothing the second time precisely BECAUSE the first one
    // worked. Answering that with "this signing link is not valid" tells somebody who has just
    // legally bound themselves that nothing happened. Re-read before refusing: if they are signed,
    // say so idempotently; only a genuinely ineligible row gets the refusal.
    const { data: already } = await db.from("paige_agreement_signers")
      .select("status").eq("id", signer.id).maybeSingle();
    if (already?.status !== "signed") return refuse();
    const { data: nowAgreement } = await db.from("paige_agreements")
      .select("status").eq("id", signer.agreement_id).maybeSingle();
    return json({
      ok: true,
      signing_id: agreement.id,
      signed_pdf_path: null,
      completed: nowAgreement?.status === "completed",
      note: "Your signature was already recorded. Nothing was signed twice.",
    });
  }

  for (const eventType of ["consented", "signed"]) {
    const { error } = await db.from("paige_agreement_events").insert({
      agreement_id: signer.agreement_id,
      tenant_id: signer.tenant_id,
      signer_id: signer.id,
      event_type: eventType,
      actor_kind: "signer",
      actor_email: signer.email,
      ip: ip === "unknown" ? null : ip,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500),
    });
    // An audit row that will not write is logged loudly and never blocks a signature the person is
    // entitled to give.
    if (error) console.error("[sign-agreement] audit event not recorded", { eventType, error: error.message });
  }

  await tellOwner(db, signer, String(agreement.title), "signed");

  const { count: outstanding } = await db.from("paige_agreement_signers")
    .select("id", { count: "exact", head: true })
    .eq("agreement_id", signer.agreement_id).neq("status", "signed");

  if ((outstanding ?? 0) > 0) {
    await db.from("paige_agreements").update({ status: "partially_signed" })
      .eq("id", agreement.id).in("status", ["sent", "viewed"]);
    return json({ ok: true, signing_id: agreement.id, signed_pdf_path: null, completed: false });
  }

  // Sealed HERE, server-side, rather than trusting the browser to ask for it: a ceremony whose final
  // step depends on the tab staying open silently does not finish when somebody closes it.
  const sealed = await sealAndComplete(db, String(signer.agreement_id));
  if (!sealed.ok) {
    console.error("[sign-agreement] sealing failed after the final signature", {
      agreementId: signer.agreement_id, reason: sealed.reason, detail: sealed.detail,
    });
    // The signature IS recorded and stands. Only completion is deferred, and the signer is told the
    // truth rather than shown a success that did not happen.
    return json({
      ok: true,
      signing_id: agreement.id,
      signed_pdf_path: null,
      completed: false,
      note: "Your signature is recorded. The completed retained copy is not ready yet.",
    });
  }

  // `signed_pdf_path` is deliberately NULL rather than the storage key. That key is
  // `${tenant_id}/${agreement_id}/sealed-<uuid>.pdf` — the tenant's UUID and our storage layout,
  // handed to an anonymous token holder. The bucket is private so the key grants nothing, but it is
  // exactly the identifier every other surface in this engine withholds, and the page never reads it.
  // The completed copy reaches the signer through their emailed retrieval token instead.
  return json({ ok: true, signing_id: agreement.id, signed_pdf_path: null, completed: true });
});

/** Tell the business what happened. Never blocks the signer's request. */
async function tellOwner(
  db: ServiceClient,
  signer: Record<string, unknown>,
  agreementTitle: string,
  event: "viewed" | "signed" | "declined",
): Promise<void> {
  const to = await ownerNotificationEmail(db as never, String(signer.tenant_id));
  if (!to) {
    console.warn("[sign-agreement] no owner address resolved — activity notice not sent", {
      tenantId: signer.tenant_id, event,
    });
    return;
  }
  await notify({
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    templateName: "agreement-activity",
    recipientEmail: to,
    tenantId: String(signer.tenant_id),
    idempotencyKey: `agreement-${event}-${signer.agreement_id}-${signer.id}`,
    templateData: {
      event,
      signer_name: signer.full_name,
      agreement_title: agreementTitle,
    },
  });
}
