// agreement-send — freeze, hash, mint and send (INT-163). Authenticated; `verify_jwt` default true.
//
// ORDER MATTERS MORE THAN ANYTHING ELSE IN THIS FILE. `draft -> sent` is one-way, so every step that
// can fail must fail BEFORE the status moves:
//
//   1. authorize the caller and resolve their tenant FROM THE SESSION
//   2. check the email provider is configured        <- first, because a missing key discovered at
//   3. render the document ONCE                          step 6 leaves an agreement stuck in `sent`
//   4. upload it (upsert:false), re-read, re-hash        with live tokens nobody received and no
//   5. mint one token per signer                         way back to draft
//   6. email each signer
//   7. only now: status -> sent
//
// §9 — HOW THIS DIFFERS FROM THE FUNCTION IT SITS BESIDE. `docusign-send-envelope` takes contact_id
// off the request body and resolves it against `clients` with the service-role client and no tenant
// filter, behind a guard that checks the tenant-blind `has_role()` over `user_roles`. Here the tenant
// comes from `current_user_tenant_id()` under the CALLER'S OWN JWT, every query is scoped to it, and
// the database re-proves each link by trigger even for the service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderPresentedPdf, hashDocument, assertDocumentIsRenderable, assertNamesAreStampable, inspectUploadedPdf, isOwnedByTenant, planPresentedDocument, UnrenderableDocumentError, UnrenderableNameError } from "../_shared/agreements/document.ts";
import { expiryFromNow, mintSignerToken, sha256Hex, SIGNING_TOKEN_TTL_DAYS } from "../_shared/agreements/token.ts";
import { tenantContactForDisclosure } from "../_shared/agreements/notify.ts";
import { overRateLimit } from "../_shared/rateLimit.ts";

// This function makes the platform send signature requests on a workspace admin's say-so, as an
// internal caller, so its volume is bounded: sends and resends per workspace per hour.
const AGREEMENT_SENDS_PER_TENANT_PER_HOUR = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PUBLIC_BASE = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai").replace(/\/$/, "");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ ok: false, error: "Sign in and try again." }, 401);

  // The caller's own client. Its RLS and its tenant resolution are the authority; the service-role
  // client below is only used for the writes the engine must perform itself.
  const caller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: userData } = await caller.auth.getUser();
  const actorId = userData?.user?.id ?? null;
  if (!actorId) return json({ ok: false, error: "Sign in and try again." }, 401);

  const { data: tenantId } = await caller.rpc("current_user_tenant_id");
  if (!tenantId) return json({ ok: false, error: "Open a workspace and try again." }, 403);

  // AUTHENTICATED IS NOT AUTHORIZED. The first version stopped at "has a tenant", which let any
  // active member of any seat role — a coach, a sales rep, a client user who happens to hold a
  // membership — send a legally binding agreement on their employer's behalf and freeze the
  // document. save_paige_agreement and void_paige_agreement both gate on is_tenant_admin; the
  // outward act was the one path that did not. Checked under the CALLER'S JWT, so it is the same
  // predicate the RPCs enforce rather than a second opinion about it.
  const { data: isAdmin } = await caller.rpc("is_tenant_admin", { _tenant: tenantId });
  if (isAdmin !== true) {
    return json({ ok: false, error: "Only an owner or admin can send an agreement for signature." }, 403);
  }

  // §60/§61 — the agreement_signing lock, enforced on the server rather than merely declared.
  // A pure Agency manages sub-accounts, not a client book, so it has no book to send an agreement
  // into. Enterprise is the hybrid tier and keeps it; sub-accounts and solo tenants keep it. Keyed
  // on the §51 invariant (a child is never a manager tier), so parentage decides first.
  const { data: tenantRow } = await admin.from("tenants")
    .select("name,account_type,parent_tenant_id").eq("id", tenantId).maybeSingle();
  if (!tenantRow?.parent_tenant_id && tenantRow?.account_type === "agency") {
    return json({
      ok: false,
      error: "Agreements are sent from the account that holds the client relationship. Switch into the sub-account whose client this is and send it from there.",
    }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "Malformed request." }, 400); }

  const agreementId = String(body.agreementId ?? "");
  const resend = body.resend === true;
  if (!agreementId) return json({ ok: false, error: "Which agreement?" }, 400);

  // ── 2) PROVIDER FIRST. Nothing is rendered, minted or moved until we know a send can happen.
  if (!Deno.env.get("RESEND_API_KEY")) {
    return json({
      ok: false,
      status: "needs_config",
      error: "No email provider is connected yet, so this agreement was not sent and nothing was changed. Connect email delivery in Settings, then send it again.",
    }, 503);
  }

  if (await overRateLimit(admin, `agreement-send:${tenantId}`, AGREEMENT_SENDS_PER_TENANT_PER_HOUR, 3600, true)) {
    return json({
      ok: false,
      error: "This workspace has sent a lot of agreements in the last hour, so this one was not sent and nothing was changed. Try again later.",
    }, 429);
  }

  // Scoped by the caller's tenant, never by an id from the body alone.
  const { data: agreement } = await admin.from("paige_agreements")
    .select("id,tenant_id,title,body_source,body_markdown,document_path,status,expires_at,content_storage_key,content_sha256")
    .eq("id", agreementId).eq("tenant_id", tenantId).maybeSingle();
  if (!agreement) return json({ ok: false, error: "That agreement is not in this workspace." }, 404);

  if (!resend && agreement.status !== "draft") {
    return json({ ok: false, error: `This agreement is already ${agreement.status}. Draft a new one rather than resending this.` }, 409);
  }
  if (resend && !["sent", "viewed", "partially_signed"].includes(agreement.status)) {
    return json({ ok: false, error: `An agreement that is ${agreement.status} cannot be resent.` }, 409);
  }

  const { data: signers } = await admin.from("paige_agreement_signers")
    .select("id,full_name,email,signing_order,status,token_hash,token_expires_at,token_revoked_at")
    .eq("agreement_id", agreementId).eq("tenant_id", tenantId).order("signing_order", { ascending: true });

  if (!signers || signers.length === 0) {
    return json({ ok: false, error: "Add at least one signer before sending." }, 400);
  }

  // Refuse a name the signature block cannot render faithfully — BEFORE anything is sent, so nobody
  // discovers it after they have already signed. Stamping `?` would make the record wrong about the
  // one fact it exists to establish.
  try {
    assertNamesAreStampable(signers.map((s: Record<string, unknown>) => String(s.full_name ?? "")));
  } catch (e) {
    if (e instanceof UnrenderableNameError) return json({ ok: false, error: e.message, names: e.names }, 422);
    throw e;
  }

  // And the same question about the DOCUMENT ITSELF, which the first version never asked. The
  // exporter maps every unencodable codepoint to `?` rather than throwing, so an agreement written
  // in Cyrillic, Japanese, Arabic, Greek or Hebrew was rendered as a page of question marks, hashed,
  // frozen by `pa_sent_is_frozen_ck` and emailed as the document of record — exactly the "provably
  // wrong about the one fact it exists to establish" failure the name check above refuses. Frozen
  // means it could not then be corrected: the agreement had to be voided and redrafted.
  try {
    assertDocumentIsRenderable(
      String(agreement.title),
      agreement.body_source === "tenant_upload" ? null : (agreement.body_markdown as string | null),
    );
  } catch (e) {
    if (e instanceof UnrenderableDocumentError) return json({ ok: false, error: e.message }, 422);
    throw e;
  }

  const tenantName = (tenantRow?.name as string) ?? "Your business";

  // The ESIGN disclosure promises the signer a route to a human for a paper copy and to withdraw
  // consent. Refuse BEFORE anything is frozen or minted rather than shipping a notice addressed to
  // nobody — and refuse here, where it is still a draft the owner can fix.
  const tenantContact = await tenantContactForDisclosure(admin as never, String(tenantId));
  if (!tenantContact) {
    return json({
      ok: false,
      status: "needs_config",
      error: "Add a contact email for your workspace before sending an agreement. The signer has to be told where to ask for a paper copy or withdraw consent, and that promise needs a real address behind it. Nothing was sent.",
    }, 409);
  }

  // ── 3/4) Render ONCE and freeze. On a resend the document is already frozen and is NOT re-rendered:
  // the whole integrity claim is that every signer saw the same bytes.
  let contentKey = agreement.content_storage_key as string | null;
  let contentHash = agreement.content_sha256 as string | null;

  // ── 3a) AN AGREEMENT FROZEN BY THE OLD CODE STILL HOLDS THE BLANK.
  //
  // The freeze below is guarded on the content columns being absent, and those are written BEFORE
  // email delivery — so they survive a failed send and every successful one. Every tenant_upload
  // sent, or merely attempted, before this fix therefore carries a title-only render and that
  // render's hash as its integrity record, and a resend would keep mailing links to it.
  //
  // Those columns are write-once by `enforce_agreement_seal_immutable` (20270401000000:529-533),
  // and rightly so: an integrity record a resend can quietly rewrite is not one. So this does not
  // repair the row — it REFUSES to keep presenting it. Repairing affected rows is a deliberate data
  // decision (which rows are safely repairable, and what happens to any already signed against a
  // blank) and is named as owed rather than taken here.
  //
  // Identified by PROVENANCE, not by re-hashing the uploaded source. The source object remains
  // mutable through the bucket's own tenant-admin policies, so a source that was later replaced or
  // deleted would make an intact agreement look defective and block a legitimate resend. The key
  // written by the code that presented the tenant's bytes carries its own marker.
  //
  // REFUSED BEFORE ANYTHING IS RENDERED, and keyed on the frozen DIGEST rather than on "has both
  // columns" — because that is the predicate `issue_agreement_signing_link` applies
  // (`20270413000000`), and two doors that refuse *nearly* the same set are two doors that will
  // drift. A digest with no key took the freeze branch below under the older shape and died on the
  // write-once trigger with a database error; it now gets the same honest 409 the link path gives.
  if (contentHash && agreement.body_source === "tenant_upload"
      && !String(contentKey ?? "").includes("/presented-source-")) {
    // Says what is true, not why. The causal version of this sentence — that the row predates the
    // uploaded-document fix — is a guess: a draft whose send froze a rendered PDF and then failed
    // every delivery can be switched to an upload afterwards and land here with no defect involved.
    console.error("[agreement-send] stored document is not the uploaded file", { agreementId, contentKey });
    return json({
      ok: false,
      error: "The document stored for this agreement is not the file that was uploaded, so nothing was sent. Create a new agreement from that document and send that instead.",
    }, 409);
  }

  if (!contentKey || !contentHash) {
    let bytes: Uint8Array;

    const plan = planPresentedDocument(agreement.body_source as string | null, agreement.document_path as string | null);

    if (plan.kind !== "render") {
      // THE TENANT'S OWN FILE *IS* THE AGREEMENT, and this branch exists because rendering here
      // presented a document nobody wrote. `paige_agreements` CHECKs that a tenant_upload has
      // `body_markdown IS NULL` (20270401000000:132) and `save_paige_agreement` nulls it on every
      // write (:838), so the render below received null; `assertDocumentIsRenderable` let it pass,
      // because `String(null ?? "")` is empty and an empty string loses no characters — that assert
      // tests character fidelity, not whether there is anything to sign; and `doc-render` turns a
      // null body with a title into ZERO blocks rather than throwing. The result was a title-only
      // PDF, uploaded, hashed into `content_sha256` as the integrity record, and emailed for
      // signature, while the file the tenant uploaded was never read. The SELECT above did not even
      // ask for `document_path`.
      //
      // The uploaded file lives in a DIFFERENT bucket from the presented one: the browser writes to
      // `tenant-agreements` (useSoloAgreementSignings.ts:439), the frozen presentation lives in
      // `paige-agreements`. Crossing that seam is deliberate, and the presented copy is still
      // written to `paige-agreements` below so everything downstream — freeze, re-read, seal — is
      // unchanged.
      if (plan.kind === "refuse") {
        console.error("[agreement-send] tenant_upload with no document_path", { agreementId });
        return json({ ok: false, error: "This agreement has no uploaded document, so nothing was sent. Re-upload the file and try again." }, 422);
      }
      const documentPath = plan.path;

      // The title still goes through the character check: it is rendered into the signing record
      // even when the body is the tenant's own file. The body is not ours to validate.
      try {
        assertDocumentIsRenderable(agreement.title, null);
      } catch (e) {
        if (e instanceof UnrenderableDocumentError) return json({ ok: false, error: e.message }, 422);
        throw e;
      }

      // TENANT OWNERSHIP, RE-IMPOSED HERE BECAUSE NOTHING ELSE IMPOSES IT ON THIS PATH.
      // `save_paige_agreement` validates only that `_document_path` is NON-EMPTY
      // (20270401000000:788-790), and the value arrives from the browser through
      // `create_agreement_signing`. Ordinary reads of this bucket are authorized on the path's
      // first segment against `tenant_members` (20260630190349:2-13) — but the download below
      // uses the SERVICE ROLE, which bypasses that policy completely.
      //
      // Before this change `document_path` was never read, so a foreign value sat inert in the
      // row. Reading it without re-stating the policy's own predicate would have turned a dormant
      // field into a cross-tenant file read, and copied another workspace's document into this
      // caller's presented-document area where `agreement-document` would serve it back to them.
      // The upload side builds the path as `${tenantId}/source/...`
      // (useSoloAgreementSignings.ts:436), so the first segment is the owning tenant by
      // construction on both sides.
      if (!isOwnedByTenant(documentPath, tenantId)) {
        console.error("[agreement-send] document_path is not owned by this workspace", { agreementId, tenantId });
        return json({ ok: false, error: "That uploaded document does not belong to this workspace, so nothing was sent." }, 403);
      }

      const source = await admin.storage.from("tenant-agreements").download(documentPath);
      if (source.error || !source.data) {
        console.error("[agreement-send] uploaded document could not be read", { agreementId, error: source.error?.message });
        return json({ ok: false, error: "The uploaded document could not be read, so nothing was sent." }, 502);
      }
      bytes = new Uint8Array(await source.data.arrayBuffer());

      // REFUSE RATHER THAN PRESENT SOMETHING WE CANNOT SHOW OR SEAL. The upload control accepts
      // .doc/.docx/.rtf/.txt/.md as well as PDF, the presented bucket accepts application/pdf only,
      // and the seal stamps signatures INTO the document, which needs a PDF. Sending a file we
      // cannot present is the same failure as sending a blank one; refusing is the honest outcome,
      // and it is what makes converting-or-restricting a decision we can take later rather than a
      // prerequisite for stopping the leak.
      const inspected = await inspectUploadedPdf(bytes);
      if (!inspected.ok) {
        console.error("[agreement-send] uploaded document cannot be presented", { agreementId, documentPath, reason: inspected.reason });
        const message = inspected.reason === "not_pdf"
          ? "That document is not a PDF, so it cannot be sent for signature yet. Upload a PDF and send it again."
          : inspected.reason === "empty"
          ? "That PDF has no pages, so there is nothing to sign. Upload the document again."
          : "That PDF could not be opened — it may be password-protected or damaged. Save an unprotected copy and upload it again.";
        return json({ ok: false, error: message }, 422);
      }
    } else {
      try {
        bytes = await renderPresentedPdf({ title: agreement.title, bodyMarkdown: agreement.body_markdown });
      } catch (e) {
        console.error("[agreement-send] render failed", { agreementId, error: String(e) });
        if (e instanceof UnrenderableDocumentError) return json({ ok: false, error: e.message }, 422);
        return json({ ok: false, error: "This agreement could not be turned into a document. Nothing was sent." }, 422);
      }
    }

    // PROVENANCE IN THE KEY. A legacy blank has to be identifiable later WITHOUT consulting the
    // uploaded source, because that object stays mutable — the bucket's tenant-admin UPDATE/DELETE
    // policies let it be replaced or removed while `content_storage_key` remains valid and
    // immutable. Re-hashing the source to spot a legacy row therefore punishes a perfectly intact
    // agreement whose source was tidied up, blocking a legitimate resend. The marker is written
    // once, by the code that actually presented the tenant's bytes, and answers the question on
    // its own.
    const marker = plan.kind === "uploaded" ? "presented-source" : "presented";
    const key = `${tenantId}/${agreementId}/${marker}-${crypto.randomUUID()}.pdf`;
    const up = await admin.storage.from("paige-agreements")
      .upload(key, bytes, { contentType: "application/pdf", upsert: false });
    if (up.error) {
      console.error("[agreement-send] presented upload failed", { agreementId, error: up.error.message });
      return json({ ok: false, error: "The document could not be stored, so nothing was sent." }, 502);
    }

    // Hash what IS stored, not what we meant to store.
    const back = await admin.storage.from("paige-agreements").download(key);
    if (back.error || !back.data) {
      console.error("[agreement-send] stored document could not be re-read", { agreementId, key });
      return json({ ok: false, error: "The document could not be verified, so nothing was sent." }, 502);
    }
    const stored = new Uint8Array(await back.data.arrayBuffer());
    const storedHash = await hashDocument(stored);
    if (storedHash !== await hashDocument(bytes)) {
      console.error("[agreement-send] stored bytes differ from rendered bytes", { agreementId, key });
      return json({ ok: false, error: "The stored document did not match what was produced, so nothing was sent." }, 502);
    }
    contentKey = key;
    contentHash = storedHash;

    // Recorded NOW, not at the end. If the send fails after this point the agreement stays a draft
    // — but it keeps the bytes it already froze, so a retry reuses them instead of rendering a
    // second document and leaving the first orphaned in the bucket with no reaper.
    const { error: freezeError } = await admin.from("paige_agreements")
      .update({ content_storage_key: contentKey, content_sha256: contentHash })
      .eq("id", agreementId).eq("tenant_id", tenantId);
    if (freezeError) {
      console.error("[agreement-send] frozen document could not be recorded", { agreementId, error: freezeError.message });
      return json({ ok: false, error: "The document could not be recorded, so nothing was sent." }, 502);
    }
  }

  // ── 5) Tokens. A signer already holding a LIVE link keeps it: a double-submitted send must not
  // silently kill a URL the person may already have open. An explicit resend re-mints deliberately.
  //
  // THE TOKEN IS WRITTEN ONLY ONCE ITS EMAIL IS ACCEPTED, and that ordering is the fix for a real
  // defect. It used to persist first: when every delivery then failed, the function correctly left
  // the agreement a draft — but the hash and the 30-day expiry stayed on the row. On the NEXT send
  // that link read as `live`, so nothing was minted, nothing was emailed, and the signer was pushed
  // into `sent` as "reused" — which made `sent.length` non-zero, advanced the status, and returned
  // `{ok:true, status:'sent'}` with zero outbound requests made and the plaintext gone forever.
  // Paige repeated that to the owner as delivery to a named person who would never receive it.
  const now = new Date();
  const sent: Array<{ email: string }> = [];
  const notDelivered: Array<{ email: string; reason: string }> = [];
  const failed: Array<{ email: string; reason: string }> = [];

  for (const s of signers as Array<Record<string, unknown>>) {
    if (s.status === "signed" || s.status === "declined") continue;

    const live = s.token_hash && !s.token_revoked_at && s.token_expires_at &&
      new Date(String(s.token_expires_at)).getTime() > now.getTime();

    if (live && !resend) {
      // A live link exists but its plaintext is gone by design, so it cannot be put in an email.
      // Reported in its OWN bucket: counting it as sent is how a send with no messages at all came
      // to report success.
      notDelivered.push({
        email: String(s.email),
        reason: "this signer already has a live link; the link itself cannot be re-read, so resend to issue a new one",
      });
      continue;
    }

    const token = mintSignerToken();
    const tokenHash = await sha256Hex(token);
    // THE APP ROUTE, NOT THIS ENGINE. `sign-agreement` is POST-only JSON and serves no markup, so
    // the link that pointed at it answered a signer's click with `405 {"error":"POST only"}` — the
    // email reached them and there was no path from it to a signable surface. The signer's page is
    // the React route `/sign/:token`, which calls `peek_agreement_signing` to read and this engine
    // to sign. Same `PUBLIC_SITE_URL` primitive every other outbound link in this repo uses.
    const link = `${PUBLIC_BASE}/sign/${token}`;
    const res = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
      method: "POST",
      // As an internal caller: this function has already authorized the sender (owner/admin of the
      // agreement's workspace) and derived the signer from the agreement, which is what the send
      // function requires of anything that is not a person sending their own mail.
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
      // The sender's real contract — templateName / recipientEmail / tenantId / templateData —
      // read off an existing caller rather than assumed. `idempotencyKey` is RECORDED, not enforced —
      // the shared sender stores it and deliberately does not dedupe on it (see its own note), so
      // this is a label on the send, never a promise that a retry cannot mail the signer twice.
      body: JSON.stringify({
        templateName: "agreement-signature-request",
        recipientEmail: s.email,
        tenantId,
        idempotencyKey: `agreement-${agreementId}-${s.id}-${tokenHash.slice(0, 16)}`,
        templateData: {
          signer_name: s.full_name,
          tenant_name: tenantName,
          agreement_title: agreement.title,
          signing_url: link,
          expires_in_days: SIGNING_TOKEN_TTL_DAYS,
        },
      }),
    });
    // `res.ok` IS NOT DELIVERY. `send-transactional-email` answers a suppressed recipient — anyone
    // carrying a bounce or complaint row — with HTTP 200 and `{success:false, reason:'suppressed'}`.
    // Reading only the status code therefore wrote a live token nobody holds, pushed the signer into
    // `sent`, moved the agreement one-way out of draft, and reported delivery to a named person who
    // received nothing. The body is the truth; the status code is not.
    let sendResult: Record<string, unknown> = {};
    try { sendResult = await res.json(); } catch { /* non-JSON → treated as undelivered below */ }
    if (!res.ok || sendResult?.success !== true) {
      console.error("[agreement-send] signer email not delivered", {
        signerId: s.id, status: res.status,
        reason: String(sendResult?.reason ?? sendResult?.error ?? "unknown").slice(0, 120),
      });
      // The token was never written, so the next attempt mints a fresh one and delivers it rather
      // than finding a "live" link nobody holds.
      failed.push({
        email: String(s.email),
        reason: sendResult?.reason === "email_suppressed"
          ? "this address is on the suppression list (a previous email bounced or was reported), so nothing was sent"
          : "the email could not be delivered",
      });
      continue;
    }

    // Delivered. NOW the link becomes real.
    const { error: mintError } = await admin.from("paige_agreement_signers").update({
      token_hash: tokenHash,
      token_expires_at: expiryFromNow(now, SIGNING_TOKEN_TTL_DAYS),
      token_revoked_at: null,
    }).eq("id", s.id).eq("tenant_id", tenantId);
    if (mintError) {
      // The message is already out and its link will not work. Say exactly that; a resend fixes it.
      console.error("[agreement-send] token write failed after the email went out", { signerId: s.id, error: mintError.message });
      failed.push({ email: String(s.email), reason: "the email went out but its link could not be activated — resend it" });
      continue;
    }

    sent.push({ email: String(s.email) });
    await admin.from("paige_agreement_events").insert({
      agreement_id: agreementId, tenant_id: tenantId, signer_id: s.id,
      event_type: resend ? "resent" : "sent", actor_kind: "owner", actor_user_id: actorId,
    });
  }

  if (sent.length === 0) {
    // Nothing reached anybody. The agreement keeps whatever status it had — a draft stays a draft —
    // and the answer names every signer and why, rather than reporting a send that did not happen.
    return json({
      ok: false, status: "not_sent",
      error: agreement.status === "draft"
        ? "No signer could be reached, so this agreement is still a draft."
        : "No new message went out, so nothing about this agreement changed.",
      failed, notDelivered,
    }, 502);
  }

  // ── 7) Only now does the status move — and ONLY from `draft`, which is the one legal edge into
  // `sent`. The forward-only trigger allows viewed -> {partially_signed, completed, declined,
  // voided, expired} and partially_signed -> {completed, ...}; neither set contains `sent`, so
  // writing it unconditionally made every resend after the signer opened the document raise 23514.
  // The links had already been reissued and the emails already sent by then, so the operator — and
  // Paige, repeating it — got "sent but its status did not update" with no retry that could succeed.
  const statusPatch: Record<string, unknown> = {
    sent_at: new Date().toISOString(),
    content_storage_key: contentKey,
    content_sha256: contentHash,
    // An explicit resend EXTENDS the deadline. The new token carries a fresh 30 days, but
    // `decideSigningAccess` also refuses on the AGREEMENT's `expires_at` — so a resend on day 29 of a
    // 30-day window handed the signer a link that died the next day while the owner was told it had
    // been resent. The resend they performed to buy time bought none.
    expires_at: resend
      ? expiryFromNow(now, SIGNING_TOKEN_TTL_DAYS)
      : (agreement.expires_at ?? expiryFromNow(now, SIGNING_TOKEN_TTL_DAYS)),
  };
  if (agreement.status === "draft") statusPatch.status = "sent";

  const { error: statusError } = await admin.from("paige_agreements").update(statusPatch)
    .eq("id", agreementId).eq("tenant_id", tenantId).in("status", ["draft", "sent", "viewed", "partially_signed"]);

  if (statusError) {
    console.error("[agreement-send] status write failed after sending", { agreementId, error: statusError.message });
    // The emails ARE out. Reporting failure here would be a lie in the other direction.
    return json({
      ok: true, status: "sent", documentSha256: contentHash, sent, failed, notDelivered,
      warning: "The agreement was sent but its status did not update. Reload before sending again.",
    });
  }

  return json({ ok: true, status: resend ? "resent" : "sent", documentSha256: contentHash, sent, failed, notDelivered });
});
