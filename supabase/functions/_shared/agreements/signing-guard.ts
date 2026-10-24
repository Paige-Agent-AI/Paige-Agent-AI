// _shared/agreements/signing-guard.ts — the authorization decision for the public signing endpoint.
//
// Pure, so it can be driven exhaustively in tests. The endpoint does IO; this decides.
//
// THE RULE THE WHOLE ENGINE RESTS ON: tenant, agreement and signer are read FROM THE TOKEN ROW and
// from nowhere else. No path segment, query parameter or body field may name or steer any of the
// three. That is the exact inverse of the defect in `docusign-send-envelope`, which takes contact_id
// from the request body and resolves it with the service-role client and no tenant filter.

// WHAT USED TO LIVE HERE AND DELIBERATELY DOES NOT ANY MORE (§58 — removed openly, not silently).
// `signingSecurityHeaders`, `mintNonce` and `signerFacingView` existed for an HTML signing page
// this function no longer serves. The signer's surface is the owner-approved React route
// `/sign/:token`, which carries its own response headers, and the page's read is the
// `peek_agreement_signing` RPC, whose hand-written allow-list is the one home for what a signer
// may be told (proven by K5 in the contract proof). Keeping unused twins of a live rule is worse
// than deleting them: the next reader cannot tell which one governs.

import { tokenState } from "./token.ts";


/** A token is 64 lowercase hex characters. Anything else is refused before it is hashed. */
export const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

/** Largest request body we will read. A signing POST is a name, a flag and maybe a small PNG. */
export const MAX_BODY_BYTES = 512 * 1024;

export type SigningRefusal =
  | "malformed_token"
  | "not_found"
  | "expired"
  | "agreement_not_signable"
  | "waiting_on_earlier_signer";

export interface SignerRow {
  id: string;
  agreement_id: string;
  tenant_id: string;
  status: string;
  signing_order: number;
  token_hash: string | null;
  token_expires_at: string | null;
  token_revoked_at: string | null;
}

export interface AgreementRow {
  id: string;
  status: string;
  expires_at: string | null;
}

export type SigningDecision =
  | { allow: true; canSign: boolean }
  | { allow: false; reason: SigningRefusal };

/**
 * May this token holder VIEW the agreement, and may they SIGN it right now?
 *
 * View and sign are separated because a signer whose turn has not come, or who has already signed,
 * should still be able to read what they are party to — refusing the read would just look broken.
 *
 * `not_found` deliberately absorbs both "no such token" and "revoked". Distinguishing them tells a
 * prober that a link once existed, which is only useful to a prober.
 */
export function decideSigningAccess(input: {
  signer: SignerRow | null;
  agreement: AgreementRow | null;
  earlierUnsignedCount: number;
  now: Date;
}): SigningDecision {
  const { signer, agreement, earlierUnsignedCount, now } = input;

  const state = tokenState(signer, now);
  if (state.usable === false) {
    if (state.reason === "expired") return { allow: false, reason: "expired" };
    return { allow: false, reason: "not_found" };
  }
  if (!signer || !agreement) return { allow: false, reason: "not_found" };

  // ORDER IS LOAD-BEARING HERE. A COMPLETED agreement stays readable by its signers — ESIGN wants
  // the retained record available to BOTH parties, and the counterparty has no account here. It is
  // checked BEFORE the agreement deadline because `expires_at` is the SIGNING deadline (send sets it
  // to ~30 days) while the retrieval token is deliberately much longer. Checked the other way round,
  // an agreement completed on day 20 had its counterparty's emailed copy die on day 30, telling them
  // the link had expired — the retained-record guarantee quietly capped at the signing window. The
  // token's own expiry is the correct bound once there is nothing left to sign.
  if (agreement.status === "completed") {
    return { allow: true, canSign: false };
  }

  // The agreement's own deadline is checked at USE, alongside the token's. Expiry never depends on a
  // sweeper having run — a job that silently stops running would otherwise resurrect dead links.
  if (agreement.expires_at && new Date(agreement.expires_at).getTime() <= now.getTime()) {
    return { allow: false, reason: "expired" };
  }
  if (!["sent", "viewed", "partially_signed"].includes(agreement.status)) {
    return { allow: false, reason: "agreement_not_signable" };
  }

  if (signer.status === "signed") return { allow: true, canSign: false };
  if (signer.status === "declined") return { allow: true, canSign: false };
  if (earlierUnsignedCount > 0) return { allow: true, canSign: false };

  return { allow: true, canSign: true };
}

/** Why a viewer cannot sign, in words the signer can act on. */
export function explainCannotSign(signerStatus: string, earlierUnsignedCount: number): string {
  if (signerStatus === "signed") return "You have already signed this agreement.";
  if (signerStatus === "declined") return "You declined this agreement.";
  if (earlierUnsignedCount > 0) {
    return earlierUnsignedCount === 1
      ? "This agreement is waiting on one other person to sign before it reaches you."
      : `This agreement is waiting on ${earlierUnsignedCount} other people to sign before it reaches you.`;
  }
  return "This agreement cannot be signed right now.";
}

/** The largest drawn mark accepted, in base64 characters — roughly 300 KB decoded. */
export const MAX_SIGNATURE_IMAGE_B64 = 400_000;
export const MAX_SIGNATURE_IMAGE_PIXELS = 4_194_304;
const PNG_SAMPLE_DEPTHS:Readonly<Record<number,readonly number[]>>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};

export type SignatureImageCheck =
  | { ok: true; base64: string | null }
  | { ok: false; reason: string };

/**
 * Validate a drawn signature BEFORE it is committed, not when it is stamped.
 *
 * WHY AT THE BOUNDARY. `status = 'signed'` is terminal by trigger, and the sealed document is
 * write-once. The review found that a signer-supplied blob was stored after nothing more than a
 * `https?:` check and a 400 000-character slice — a slice that can itself break base64 padding — and
 * then detonated inside `sealAndComplete`, one layer ABOVE the deliberate `embedPng` fallback that
 * was supposed to catch it. The signature stood, sealing failed on that call and on every retry, and
 * the signer was told their completed copy was "still being prepared" forever. There is no repair
 * path: `authenticated` holds no UPDATE grant on the column.
 *
 * So the blob is decoded and identified HERE, where the answer is a 400 and the person simply signs
 * again. Truncation is refused rather than performed: silently cutting a payload produces exactly the
 * corrupt value this function exists to keep out.
 */
export function checkSignatureImage(raw: unknown): SignatureImageCheck {
  if (raw === null || raw === undefined || raw === "") return { ok: true, base64: null };
  if (typeof raw !== "string") return { ok: false, reason: "A drawn signature must be sent as image data." };

  // A URL here would make the sealer fetch an attacker-chosen address with our credentials.
  if (/^\s*https?:/i.test(raw)) {
    return { ok: false, reason: "A drawn signature must be sent as image data, not a link." };
  }

  const base64 = raw.replace(/^\s*data:image\/png;base64,/i, "").replace(/\s+/g, "");
  if (base64.length > MAX_SIGNATURE_IMAGE_B64) {
    return { ok: false, reason: "That drawn signature is too large. Draw it again, or type your name instead." };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    return { ok: false, reason: "That drawn signature could not be read. Draw it again, or type your name instead." };
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(base64);
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, reason: "That drawn signature could not be read. Draw it again, or type your name instead." };
  }

  // The PNG signature. The bucket is PDF-only and this column is not a bucket, so nothing else
  // downstream would ever reject a JPEG or an HTML file sitting in this column — pdf-lib's
  // `embedPng` would, at seal time, which is far too late.
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < PNG_MAGIC.length || PNG_MAGIC.some((b, i) => bytes[i] !== b)) {
    return { ok: false, reason: "A drawn signature must be a PNG image. Draw it again, or type your name instead." };
  }

  // Bound the native renderer BEFORE decompression. IHDR is the first13-byte
  // PNG chunk (W3C PNG3 §11.2.1); compressed byte limits alone do not bound pixels.
  const unreadable = (): SignatureImageCheck => ({ ok: false, reason: "That drawn signature could not be read. Draw it again, or type your name instead." });
  if (bytes.length < 33) return unreadable();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12,16)) !== "IHDR") return unreadable();
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 4096 || height > 2048 || width * height > MAX_SIGNATURE_IMAGE_PIXELS) {
    return { ok: false, reason: "That drawn signature is too large. Draw it again, or type your name instead." };
  }
  // The existing decoder sizes its buffer from sample depth and interlace as
  // well as dimensions. Validate PNG3 IHDR/Table12 before that allocation.
  if(!PNG_SAMPLE_DEPTHS[bytes[25]]?.includes(bytes[24])||bytes[26]!==0||bytes[27]!==0||bytes[28]>1)return unreadable();
  let imageData = false, ended = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = view.getUint32(offset), end = offset + 12 + size;
    if (end > bytes.length) return unreadable();
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if(kind==="IHDR"&&offset!==8)return unreadable();
    if (["acTL", "fcTL", "fdAT"].includes(kind)) {
      return { ok: false, reason: "A drawn signature must be a static PNG image. Draw it again, or type your name instead." };
    }
    if (kind === "IDAT" && size > 0) imageData = true;
    if (kind === "IEND") { ended = size === 0 && end === bytes.length; break; }
    offset = end;
  }
  if (!imageData || !ended) return unreadable();

  return { ok: true, base64 };
}
