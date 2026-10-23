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
// `ok: true` requires an actual original native signature receipt. A missing acknowledgement is
// verification_pending, never evidence that nothing was signed. A seal that fails
// after a committed signature returns `ok: true` with `completed: false` and says so, because the
// signature genuinely IS recorded and claiming otherwise would be its own lie.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { overRateLimit, trustedClientIp } from "../_shared/rateLimit.ts";
import { sha256Hex } from "../_shared/agreements/token.ts";
import { verifyRetainedAgreementPdf } from "../_shared/agreements/retained-document.ts";
import { decideSigningAccess, MAX_BODY_BYTES, TOKEN_SHAPE } from "../_shared/agreements/signing-guard.ts";
import { assertDocumentIsRenderable, prepareSignatureImage, UnrenderableDocumentError, wouldLoseCharacters } from "../_shared/agreements/document.ts";
import { consentEvidenceText, ESIGN_CONSENT_DISCLOSURE } from "../_shared/agreements/disclosure.ts";
import { sealAndComplete, verifiedCompletedCopy } from "../_shared/agreements/seal.ts";
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
 * Unknown, expired, revoked, declined and voided all leave by this door with
 * the same body. Telling them apart confirms to a stranger that a guessed token is real, which turns
 * this into a way to discover which agreements exist. The BUSINESS sees the true state on its own
 * authenticated surface, where it is entitled to.
 */
const refuse = () =>
  json({ ok: false, error: "This signing link is not valid. Ask the sender to send you a new one." }, 404);

const verificationPending = () => json({
  ok:false,state:"verification_pending",code:"SIGNATURE_VERIFICATION_PENDING",
  error:"Signing could not be confirmed. Check the recorded status or ask the sender to verify it before trying to sign again.",
},503);

type SignatureReceipt = {
  state:"recorded";replayed:boolean;signing_id:string;signer_id:string;signed_at:string;
  consented_event_id:string|null;signed_event_id:string|null;audit_complete:boolean;
  outstanding_count:number;agreement_status:string;
};

/** The original native transaction's closed acknowledgement, never a truthy transport body. */
function signatureReceipt(value:unknown,agreementId:string,signerId:string,checkOnly:boolean):SignatureReceipt|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const r=value as Record<string,unknown>,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if(r.state!=="recorded"||r.signing_id!==agreementId||r.signer_id!==signerId||typeof r.replayed!=="boolean"
    ||(checkOnly&&r.replayed!==true)||typeof r.signed_at!=="string"||!/^\d{4}-\d{2}-\d{2}T/.test(r.signed_at)
    ||!Number.isFinite(Date.parse(r.signed_at))||typeof r.audit_complete!=="boolean"
    ||!Number.isSafeInteger(r.outstanding_count)||(r.outstanding_count as number)<0
    ||typeof r.agreement_status!=="string"||!["sent","viewed","partially_signed","completed"].includes(r.agreement_status))return null;
  const consentId=typeof r.consented_event_id==="string"&&uuid.test(r.consented_event_id);
  const signedId=typeof r.signed_event_id==="string"&&uuid.test(r.signed_event_id);
  if((r.consented_event_id!==null&&!consentId)||(r.signed_event_id!==null&&!signedId)
    ||r.audit_complete!==(consentId&&signedId)||(r.audit_complete&&r.consented_event_id===r.signed_event_id)
    ||(!r.replayed&&!r.audit_complete)||(r.agreement_status==="completed"&&r.outstanding_count!==0))return null;
  return r as SignatureReceipt;
}

/** No mark, consent or source parameters: this call cannot create an unsigned record. */
async function verifyOriginalSignature(db:ServiceClient,tokenHash:string,signer:Record<string,unknown>,agreement:Record<string,unknown>,finishExistingAttempt=false):Promise<Response>{
  try{
    const {data,error}=await db.rpc("_record_agreement_signature",{
      _token_hash:tokenHash,_agreement_version:null,_content_sha256:null,_content_storage_key:null,
      _typed_name:null,_signature_image_png:null,_consent_read:false,_consent_esign:false,
      _consent_slug:null,_consent_version:null,_consent_sha256:null,_ip:null,_user_agent:null,
    });
    if(error?.code==="42501")return refuse();
    if(error)return verificationPending();
    const receipt=signatureReceipt(data,String(agreement.id),String(signer.id),true);
    return receipt?await finishRecordedSignature(db,signer,agreement,receipt,!finishExistingAttempt):verificationPending();
  }catch{return verificationPending();}
}

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

  const typedName = typeof body.typed_name === "string" ? body.typed_name.trim() : "";
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

  const { data: signer,error:signerReadError } = await db.from("paige_agreement_signers")
    .select("id,agreement_id,tenant_id,status,signing_order,full_name,email,token_hash,token_expires_at,token_revoked_at")
    .eq("token_hash", tokenHash).maybeSingle();
  if(signerReadError)return verificationPending();
  if (!signer) return refuse();

  const now = new Date();

  const { data: agreement,error:agreementReadError } = await db.from("paige_agreements")
    .select("id,tenant_id,version,title,body_source,body_markdown,status,expires_at,content_storage_key,content_sha256")
    .eq("id", signer.agreement_id).maybeSingle();
  if(agreementReadError)return verificationPending();

  // Out of turn is a refusal for the same reason as everything else: this person cannot sign yet, and
  // which of the several reasons applies is not a stranger's business.
  const { count: earlier,error:orderReadError } = await db.from("paige_agreement_signers")
    .select("id", { count: "exact", head: true })
    .eq("agreement_id", signer.agreement_id).lt("signing_order", signer.signing_order).neq("status", "signed");
  if(orderReadError)return verificationPending();

  // ONE HOME FOR THE ELIGIBILITY RULES. `decideSigningAccess` is pure and driven exhaustively in
  // `signing-guard.test.ts`, including the orderings that are easy to get subtly wrong — revoked
  // outranking everything, a NULL expiry failing closed, and completed being answered BEFORE the
  // signing deadline. Re-deriving those here would be a second copy of the same rules, and the
  // second copy is always the one that drifts. Only `canSign` admits a NEW signing act.
  const decision = decideSigningAccess({
    signer: signer as never,
    agreement: agreement as never,
    earlierUnsignedCount: earlier ?? 0,
    now,
  });
  if (!decision.allow) return refuse();
  if (!agreement || agreement.tenant_id !== signer.tenant_id) return refuse();
  if(signer.status==="signed"||body.check_only===true){
    return verifyOriginalSignature(db,tokenHash,signer,agreement);
  }
  if(!decision.canSign)return refuse();

  // ── Now the parts that are the SIGNER's mistake to make, and are told plainly ──────────────────
  if (!consentRead || !consentEsign) {
    return json({ ok: false, code:"SIGNING_CONSENT_REQUIRED", error: "Both confirmations are required before you can sign." }, 400);
  }
  if (typedName.length < 2) {
    return json({ ok: false, code:"SIGNER_NAME_REQUIRED", error: "Please type your full legal name." }, 400);
  }
  if (typedName.length > 200) {
    return json({ok:false,code:"SIGNER_NAME_TOO_LONG",error:"That name is too long to retain exactly. Contact the sender for another signing method."},400);
  }
  // EVERY VALUE THAT MUST SURVIVE THE SEAL IS CHECKED HERE, before anything terminal is written.
  // `status = 'signed'` is one-way by trigger and the sealed document is write-once, so a value that
  // only fails at stamping time strands the agreement permanently — signature recorded, completion
  // impossible, and no shipped path able to clear the column. A 400 now costs the signer one retry.
  if (wouldLoseCharacters(typedName)) {
    return json({
      ok: false,
      code:"SIGNER_NAME_UNRENDERABLE",
      error: "The signature block cannot retain the characters in that name. Contact the sender for another signing method.",
    }, 400);
  }
  const image = await prepareSignatureImage(signatureImage);
  if (!image.ok) return json({ ok: false, code:"SIGNATURE_IMAGE_UNRENDERABLE", error: image.reason }, 400);

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
        code:"SIGNING_DOCUMENT_UNRENDERABLE",
        error: "This agreement cannot be signed as written: some of its text cannot be reproduced in the signed document. Ask the sender to reissue it.",
      }, 422);
    }
    throw e;
  }

  // The seal verifies these same original bytes again after signing. Refuse a
  // known missing/changed presentation BEFORE the irreversible signature write.
  // Reuse the retained file or legacy text digest; never render a replacement or
  // infer signed economics from mutable commercial records here.
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
    // A Storage/verification failure cannot grant permission to sign.
  }
  if (!presentationVerified) {
    return json({
      ok: false,
      code:"SIGNING_DOCUMENT_UNVERIFIED",
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
      code:"SIGNING_SENDER_UNAVAILABLE",
      error: "This agreement cannot be signed right now because the sender has no contact address on file. Please contact them directly.",
    }, 409);
  }

  const { data: tenantRow } = await db.from("tenants").select("name").eq("id", signer.tenant_id).maybeSingle();
  const consentText = consentEvidenceText(
    ESIGN_CONSENT_DISCLOSURE, String(tenantRow?.name ?? "the sender"), tenantContact,
  );
  try{
    // ONE original transaction revalidates authority/document at its actual native act clock.
    // No direct signature/event/progress write remains as a fallback around its constraints.
    const {data,error}=await db.rpc("_record_agreement_signature",{
      _token_hash:tokenHash,_agreement_version:agreement.version,_content_sha256:agreement.content_sha256,
      _content_storage_key:agreement.content_storage_key,_typed_name:typedName,_signature_image_png:image.base64,
      _consent_read:consentRead,_consent_esign:consentEsign,_consent_slug:ESIGN_CONSENT_DISCLOSURE.slug,
      _consent_version:ESIGN_CONSENT_DISCLOSURE.version,_consent_sha256:await sha256Hex(consentText),
      _ip:ip==="unknown"?null:ip,_user_agent:(req.headers.get("user-agent")??"").slice(0,500),
    });
    if(error?.code==="42501")return refuse();
    if(error?.code==="23514")return json({ok:false,code:"SIGNATURE_REFUSED",error:"That signature could not be confirmed. Reload the agreement or ask the sender to check its current status."},409);
    if(error)return verifyOriginalSignature(db,tokenHash,signer,agreement,true);
    const receipt=signatureReceipt(data,String(agreement.id),String(signer.id),false);
    return receipt?await finishRecordedSignature(db,signer,agreement,receipt):verificationPending();
  }catch{
    // A lost acknowledgement is reconciled once with EMPTY action evidence. Never resend the mark.
    return verifyOriginalSignature(db,tokenHash,signer,agreement,true);
  }
});

async function finishRecordedSignature(db:ServiceClient,signer:Record<string,unknown>,agreement:Record<string,unknown>,receipt:SignatureReceipt,checkOnly=false):Promise<Response>{
  const result={ok:true,state:"recorded",signing_id:receipt.signing_id,signer_id:receipt.signer_id,document_title:String(agreement.title),
    signed_at:receipt.signed_at,replayed:receipt.replayed,audit_complete:receipt.audit_complete,
    consented_event_id:receipt.consented_event_id,signed_event_id:receipt.signed_event_id,
    signed_pdf_path:null,completed:false};
  if(!receipt.replayed){
    try{await tellOwner(db,signer,String(agreement.title),"signed");}
    catch{console.warn("[sign-agreement] activity notification not confirmed");}
  }
  if(!receipt.audit_complete)return json({...result,note:"Your signature is recorded, but its consent and signing history could not be fully verified. Ask the sender to review this agreement."});
  if(receipt.outstanding_count>0)return json(result);
  if(checkOnly){
    // An explicit status check may verify an EXISTING completed copy, never
    // seal/upload, mark completed, rotate credentials or send announcements.
    if(receipt.agreement_status==="completed")try{
      const {data:completed,error}=await db.from("paige_agreements")
        .select("status,sealed_storage_key,sealed_sha256").eq("id",agreement.id).eq("tenant_id",signer.tenant_id).maybeSingle();
      if(!error&&completed&&(await verifiedCompletedCopy(db,completed)).ok)return json({...result,completed:true});
    }catch{/* Retain the actual signature; withhold unverified completion. */}
    return json({...result,note:"Your signature is recorded. The completed copy could not be verified yet. Ask the sender to check this agreement."});
  }
  try{
    const sealed=await sealAndComplete(db,String(agreement.id));
    if(sealed.ok)return json({...result,completed:true});
    console.warn("[sign-agreement] completed copy not verified",{reason:sealed.reason});
  }catch{console.warn("[sign-agreement] completed copy verification interrupted");}
  return json({...result,note:"Your signature is recorded. The completed copy could not be verified yet. Ask the sender to check this agreement."});
}

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
