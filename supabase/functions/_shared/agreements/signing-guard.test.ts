// deno test --allow-import --node-modules-dir=none supabase/functions/_shared/agreements/signing-guard.test.ts
//
// The access decision for an unauthenticated endpoint, driven exhaustively. Everything here is pure,
// so there is no excuse for leaving a branch untested.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  checkSignatureImage,
  decideSigningAccess,
  explainCannotSign,
  MAX_BODY_BYTES,
  TOKEN_SHAPE,
} from "./signing-guard.ts";
import { consentEvidenceText, ESIGN_CONSENT_DISCLOSURE, renderDisclosure } from "./disclosure.ts";

const NOW = new Date("2026-06-01T12:00:00Z");
const FUTURE = "2026-07-01T00:00:00Z";
const PAST = "2026-05-01T00:00:00Z";

const signer = (over: Record<string, unknown> = {}) => ({
  id: "s1", agreement_id: "a1", tenant_id: "t1", status: "pending", signing_order: 1,
  token_hash: "a".repeat(64), token_expires_at: FUTURE, token_revoked_at: null, ...over,
});
const agreement = (over: Record<string, unknown> = {}) => ({
  id: "a1", status: "sent", expires_at: null, ...over,
});

Deno.test("token shape is checked before anything is hashed or looked up", () => {
  assert(TOKEN_SHAPE.test("a".repeat(64)));
  assert(!TOKEN_SHAPE.test("A".repeat(64)), "uppercase is not what we mint");
  assert(!TOKEN_SHAPE.test("a".repeat(63)), "short");
  assert(!TOKEN_SHAPE.test("a".repeat(65)), "long");
  assert(!TOKEN_SHAPE.test("../../etc/passwd"), "path traversal");
  assert(!TOKEN_SHAPE.test("' OR 1=1--"), "injection shapes never reach the database");
  assert(MAX_BODY_BYTES > 0 && MAX_BODY_BYTES <= 1024 * 1024, "a signing POST is small");
});

Deno.test("the happy path allows viewing and signing", () => {
  assertEquals(
    decideSigningAccess({ signer: signer(), agreement: agreement(), earlierUnsignedCount: 0, now: NOW }),
    { allow: true, canSign: true },
  );
});

Deno.test("an unknown token and a REVOKED token are indistinguishable to the caller", () => {
  const unknown = decideSigningAccess({ signer: null, agreement: null, earlierUnsignedCount: 0, now: NOW });
  const revoked = decideSigningAccess({
    signer: signer({ token_revoked_at: PAST }), agreement: agreement(), earlierUnsignedCount: 0, now: NOW,
  });
  assertEquals(unknown, { allow: false, reason: "not_found" });
  assertEquals(revoked, { allow: false, reason: "not_found" },
    "telling them it was revoked confirms a link once existed — useful only to someone probing");
});

Deno.test("an expired TOKEN is refused at use, not by a sweeper", () => {
  assertEquals(
    decideSigningAccess({ signer: signer({ token_expires_at: PAST }), agreement: agreement(), earlierUnsignedCount: 0, now: NOW }),
    { allow: false, reason: "expired" },
  );
});

Deno.test("a token with NO expiry is refused — an immortal link is the worst default", () => {
  assertEquals(
    decideSigningAccess({ signer: signer({ token_expires_at: null }), agreement: agreement(), earlierUnsignedCount: 0, now: NOW }),
    { allow: false, reason: "expired" },
  );
});

Deno.test("an expired AGREEMENT is refused even when the token itself is still live", () => {
  assertEquals(
    decideSigningAccess({ signer: signer(), agreement: agreement({ expires_at: PAST }), earlierUnsignedCount: 0, now: NOW }),
    { allow: false, reason: "expired" },
  );
});

Deno.test("A COMPLETED AGREEMENT STAYS READABLE BY ITS SIGNER — the retained-record rule", () => {
  // The counterparty has no account here. If completion closed their access, the only copy they
  // could ever reach would be the one they happened to have open at the time.
  assertEquals(
    decideSigningAccess({
      signer: signer({ status: "signed" }), agreement: agreement({ status: "completed" }),
      earlierUnsignedCount: 0, now: NOW,
    }),
    { allow: true, canSign: false },
  );
});

Deno.test("A COMPLETED AGREEMENT STAYS READABLE PAST ITS SIGNING DEADLINE", () => {
  // The previous fixture used expires_at:null, so it could never have caught this: `expires_at` is
  // the ~30-day SIGNING deadline, while the retrieval token deliberately lives far longer. With the
  // deadline checked first, a counterparty's emailed copy died on day 30 and told them the link had
  // expired — the retained-record guarantee capped at the signing window.
  assertEquals(
    decideSigningAccess({
      signer: signer({ status: "signed", token_expires_at: "2027-06-01T00:00:00Z" }),
      agreement: agreement({ status: "completed", expires_at: PAST }),
      earlierUnsignedCount: 0, now: NOW,
    }),
    { allow: true, canSign: false },
  );
});

Deno.test("a still-live agreement past its deadline is still refused", () => {
  // The other half of the same ordering: moving the completed branch up must not let an UNFINISHED
  // agreement outlive its own deadline.
  assertEquals(
    decideSigningAccess({
      signer: signer(), agreement: agreement({ status: "partially_signed", expires_at: PAST }),
      earlierUnsignedCount: 0, now: NOW,
    }),
    { allow: false, reason: "expired" },
  );
});

Deno.test("a voided agreement stops answering immediately", () => {
  for (const status of ["voided", "declined", "expired", "draft"]) {
    assertEquals(
      decideSigningAccess({ signer: signer(), agreement: agreement({ status }), earlierUnsignedCount: 0, now: NOW }),
      { allow: false, reason: "agreement_not_signable" },
      `status ${status} must not be signable`,
    );
  }
});

Deno.test("a signer who already signed may still READ, but cannot sign again", () => {
  assertEquals(
    decideSigningAccess({ signer: signer({ status: "signed" }), agreement: agreement({ status: "partially_signed" }), earlierUnsignedCount: 0, now: NOW }),
    { allow: true, canSign: false },
  );
});

Deno.test("a signer out of turn may read but not sign", () => {
  assertEquals(
    decideSigningAccess({ signer: signer({ signing_order: 2 }), agreement: agreement(), earlierUnsignedCount: 1, now: NOW }),
    { allow: true, canSign: false },
  );
});

Deno.test("revocation outranks every other state, so voiding kills a link instantly", () => {
  assertEquals(
    decideSigningAccess({
      signer: signer({ token_revoked_at: PAST, status: "pending" }),
      agreement: agreement({ status: "voided" }), earlierUnsignedCount: 0, now: NOW,
    }),
    { allow: false, reason: "not_found" },
  );
});

Deno.test("the reason a signer cannot sign is said in words they can act on", () => {
  assertEquals(explainCannotSign("signed", 0), "You have already signed this agreement.");
  assertEquals(explainCannotSign("declined", 0), "You declined this agreement.");
  assert(explainCannotSign("pending", 1).includes("one other person"));
  assert(explainCannotSign("pending", 3).includes("3 other people"));
});


// ── The boundary checks, because what they keep out is IRREVERSIBLE ──────────────────────────────
// `status = 'signed'` is terminal by trigger and the sealed document is write-once, so a value that
// only fails when it is stamped strands the agreement forever: signature recorded, completion
// impossible, no shipped path able to clear the column. These run at the door instead.

Deno.test("no drawn signature is fine — the typed name is what the record relies on", () => {
  for (const empty of [null, undefined, ""]) {
    const r = checkSignatureImage(empty);
    assert(r.ok && r.base64 === null, `empty input should be accepted as "none": ${JSON.stringify(r)}`);
  }
});

Deno.test("A REAL PNG IS ACCEPTED, with or without its data-URL prefix", () => {
  // The smallest valid PNG: signature + IHDR + IDAT + IEND.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const bare = checkSignatureImage(png);
  assert(bare.ok && bare.base64 === png, `a bare base64 PNG must pass: ${JSON.stringify(bare)}`);
  const dataUrl = checkSignatureImage(`data:image/png;base64,${png}`);
  assert(dataUrl.ok && dataUrl.base64 === png, "the data-URL prefix must be stripped, not stored");
});

Deno.test('signature PNG decoding is bounded before pixel allocation',()=>{
  const original=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
  for(const [width,height] of [[0,1],[1,0],[100000,1],[1,100000],[4096,2048]]){
    const bytes=original.slice(),view=new DataView(bytes.buffer);view.setUint32(16,width);view.setUint32(20,height);
    const result=checkSignatureImage(btoa(String.fromCharCode(...bytes)));
    assert(!result.ok,`An unsafe ${width}x${height} header must refuse before the real decoder`);
  }
  assert(!checkSignatureImage(btoa(String.fromCharCode(...original.slice(0,24)))).ok,'A truncated header is not a signature');
});

Deno.test('a drawn signature is a static PNG rather than an animated allocation',()=>{
  const original=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
  const animation=new Uint8Array(20);new DataView(animation.buffer).setUint32(0,8);animation.set([97,99,84,76],4);new DataView(animation.buffer).setUint32(8,10000);
  const bytes=new Uint8Array(original.length+animation.length);bytes.set(original.subarray(0,33));bytes.set(animation,33);bytes.set(original.subarray(33),53);
  assert(!checkSignatureImage(btoa(String.fromCharCode(...bytes))).ok,'Animation must refuse before frame decoding');
});

Deno.test('the native PNG allocation cannot be steered by invalid sample headers',()=>{
  const original=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
  for(const [offset,value] of [[24,255],[24,1],[25,255],[26,1],[27,1],[28,255]]){
    const bytes=original.slice();bytes[offset]=value;
    assert(!checkSignatureImage(btoa(String.fromCharCode(...bytes))).ok,`Invalid header ${offset}=${value} must refuse before decoding`);
  }
});

Deno.test('a later PNG header cannot replace the bounded dimensions',()=>{
  const original=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
  const chunk=original.slice(8,33);new DataView(chunk.buffer).setUint32(8,100000);
  const bytes=new Uint8Array(original.length+chunk.length);bytes.set(original.subarray(0,33));bytes.set(chunk,33);bytes.set(original.subarray(33),33+chunk.length);
  assert(!checkSignatureImage(btoa(String.fromCharCode(...bytes))).ok,'A second IHDR must refuse before native parsing');
});

Deno.test("A NON-PNG IS REFUSED AT THE DOOR, not at the seal", () => {
  // Valid base64, decodes cleanly, and is a JPEG. pdf-lib's embedPng would reject it at completion,
  // by which time the signature is terminal.
  const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46));
  const r = checkSignatureImage(jpeg);
  assert(!r.ok, "a JPEG must not be stored in a column that is only ever embedded as PNG");
  assert(r.ok === false && r.reason.includes("PNG"), r.ok === false ? r.reason : "");
});

Deno.test("a malformed or over-long blob is REFUSED rather than truncated", () => {
  assert(!checkSignatureImage("not base64 at all!!").ok);
  assert(!checkSignatureImage("aGVsbG8").ok, "a length that is not a multiple of four cannot decode");
  // Truncation is what produced the corrupt values in the first place: a 400 000-character slice
  // through valid base64 breaks its own padding.
  const huge = "A".repeat(500_000);
  const r = checkSignatureImage(huge);
  assert(!r.ok && r.reason.includes("too large"), "over-length must be refused, never silently cut");
});

Deno.test("a URL is refused — it would make the sealer fetch an attacker's address with our credentials", () => {
  assert(!checkSignatureImage("https://attacker.test/x.png").ok);
  assert(!checkSignatureImage("  HTTP://attacker.test/x.png").ok);
});

// ── The disclosure is the one artifact that must be provably the text the person was shown ───────
Deno.test("A TENANT NAME CONTAINING $ IS INSERTED LITERALLY, not expanded", () => {
  // `String.replaceAll` expands $&, $', $` and $1 in the REPLACEMENT. The tenant writes its own
  // name, so `Acme $'` spliced copies of the surrounding paragraphs into the notice — and that
  // garbled version was what `consentEvidenceText` hashed into the permanent record.
  const hostile = "Acme $' $& $` $1 LLC";
  const text = renderDisclosure(ESIGN_CONSENT_DISCLOSURE, hostile, "hello@acme.test");
  assert(text.includes(hostile), "the tenant name must appear exactly as written");
  assert(!text.includes("{{tenant}}"), "every placeholder must still be filled");
  assert(!text.includes("{{contact}}"), "every placeholder must still be filled");
  // The evidence text is what is hashed, so it has to carry the same literal value.
  assert(consentEvidenceText(ESIGN_CONSENT_DISCLOSURE, hostile, "hello@acme.test").includes(hostile));
});

Deno.test("the disclosure names a REAL contact route, never a placeholder", () => {
  const text = renderDisclosure(ESIGN_CONSENT_DISCLOSURE, "Acme Consulting", "hello@acme.test");
  assert(text.includes("hello@acme.test"), "the promised route to a human must be a real address");
  assert(!text.includes("the sender of this agreement"), "a hardcoded stand-in is not a contact route");
});
