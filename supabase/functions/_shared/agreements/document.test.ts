// deno test --allow-import --node-modules-dir=none supabase/functions/_shared/agreements/document.test.ts
//
// --node-modules-dir=none matters: with a package.json present, Deno otherwise builds its own npm
// layout inside node_modules and shadows the npm-installed vite, which breaks `npm run test`.
//
// §32: a green typecheck proves this file parses. It proves nothing about whether pdf-lib can load
// the bytes we produced, embed a font, take a PNG, append a page and save — which is exactly the
// class of failure that compiles clean and then blanks at runtime. These tests RUN that path.
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  assertDocumentIsRenderable,
  assertNamesAreStampable,
  hashDocument,
  isOwnedByTenant,
  looksLikePdf,
  planPresentedDocument,
  renderPresentedPdf,
  sealAgreementPdf,
  UnrenderableDocumentError,
  UnrenderableNameError,
  wouldLoseCharacters,
} from "./document.ts";
import { sanitizeWinAnsi } from "../doc-render.ts";

const PDF_MAGIC = "%PDF";

function head(bytes: Uint8Array, n = 4): string {
  return new TextDecoder().decode(bytes.slice(0, n));
}

// A real 1×1 PNG. Signature images arrive from a browser canvas; this is the smallest valid one.
const ONE_PX_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const BODY = [
  "# Services Agreement",
  "",
  "This agreement is between the parties named below.",
  "",
  "1. The provider will deliver the services described in the attached schedule.",
  "2. Either party may end this agreement with thirty days written notice.",
  "",
  "Signed by the parties as of the date last written below.",
].join("\n");

function party(over: Record<string, unknown> = {}) {
  return {
    fullName: "Jordan Avery",
    email: "jordan@example.com",
    role: "counterparty",
    signingOrder: 1,
    status: "signed",
    typedName: "Jordan Avery",
    signedAt: "2026-06-01T12:00:00.000Z",
    consentAt: "2026-06-01T11:59:40.000Z",
    consentSlug: "esign-consent",
    consentVersion: 1,
    signingIp: "203.0.113.7",
    signingUserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    signatureImagePng: null as Uint8Array | null,
    ...over,
  };
}

const EVENTS = [
  { eventType: "created", at: "2026-06-01T10:00:00.000Z", actorKind: "owner", actorLabel: "owner@acme.test", ip: null },
  { eventType: "sent", at: "2026-06-01T10:05:00.000Z", actorKind: "owner", actorLabel: "owner@acme.test", ip: null },
  { eventType: "viewed", at: "2026-06-01T11:58:00.000Z", actorKind: "signer", actorLabel: "jordan@example.com", ip: "203.0.113.7" },
  { eventType: "consented", at: "2026-06-01T11:59:40.000Z", actorKind: "signer", actorLabel: "jordan@example.com", ip: "203.0.113.7" },
  { eventType: "signed", at: "2026-06-01T12:00:00.000Z", actorKind: "signer", actorLabel: "jordan@example.com", ip: "203.0.113.7" },
];

function sealInput(over: Record<string, unknown> = {}) {
  return {
    presentedBytes: new Uint8Array(),
    presentedSha256: "0".repeat(64),
    presentedKind: "file" as const,
    agreementTitle: "Services Agreement",
    agreementId: "6f1c2a1e-0000-4000-8000-000000000001",
    tenantName: "Acme Consulting",
    parties: [party()],
    events: EVENTS,
    sealedAtIso: "2026-06-01T12:00:01.000Z",
    ...over,
  };
}

Deno.test("the presented document actually renders to real PDF bytes", async () => {
  const bytes = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  assert(bytes.length > 500, `suspiciously small PDF: ${bytes.length} bytes`);
  assertEquals(head(bytes), PDF_MAGIC);
});

Deno.test("hashing is stable over the same array and is 64 hex characters", async () => {
  const bytes = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  const a = await hashDocument(bytes);
  const b = await hashDocument(bytes);
  assertEquals(a, b);
  assert(/^[0-9a-f]{64}$/.test(a), a);
});

Deno.test("re-rendering does NOT reproduce the bytes — which is why the sealed copy is stored, never re-made", async () => {
  // THIS TEST PREVIOUSLY ASSERTED THE OPPOSITE, and it was wrong. It claimed rendering was
  // byte-deterministic "measured, not assumed", on the strength of three runs that happened to
  // agree — and it contradicted this module's own header, which says pdf-lib stamps /CreationDate
  // and /ModDate so "two renders of byte-identical content produce different bytes".
  //
  // The header is right. Measured directly: two renders inside the SAME clock second are byte
  // identical, and two renders that straddle a second boundary are NOT. The old assertion passed
  // only because both of its renders landed in the same second on a fast machine — a race it won
  // locally and lost on a slower CI runner, on both this branch and main.
  //
  // This matters far beyond a flaky test. "Re-rendering reproduces the bytes" would license
  // re-making the document on demand and trusting the stored hash — and the hash would then
  // describe an artifact that no longer exists. The RENDER ONCE, NEVER RE-RENDER rule at the top
  // of this file is load-bearing precisely because of what is asserted below.
  const first = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  const immediate = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  // Within one clock tick the bytes DO agree — the timestamp is the only varying input.
  assertEquals(await hashDocument(first), await hashDocument(immediate));

  // Across a tick they do not. 1.1s is measured to be sufficient; if that ever stops being true
  // this fails loudly and the next person re-measures rather than inheriting a false claim.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const later = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  assertNotEquals(await hashDocument(first), await hashDocument(later));
});

Deno.test("different content hashes differently — the digest tracks the document", async () => {
  const a = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  const b = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY + "\n\n9. An added clause." });
  assertNotEquals(await hashDocument(a), await hashDocument(b));
});

// WHY WE STILL RENDER ONCE AND STORE THE BYTES, despite that determinism.
// Determinism today is a property of pdf-lib 1.17.1 plus this exact renderer plus these fonts. A
// library bump, a font substitution or a tweak to doc-render's layout would change the output and
// every historical hash would stop verifying at once — silently, and years after the signature. The
// integrity claim must not depend on our ability to reproduce a render in 2031. So the bytes shown
// to the signer are uploaded once and served from storage forever after, and the determinism above
// is a convenience we do not build on.

Deno.test("sealing loads the presented bytes and returns a larger, still-valid PDF", async () => {
  const presented = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  const presentedSha256 = await hashDocument(presented);
  const sealed = await sealAgreementPdf(sealInput({ presentedBytes: presented, presentedSha256 }));

  assertEquals(head(sealed), PDF_MAGIC);
  assert(sealed.length > presented.length, "the seal adds signatures and a certificate; it cannot shrink");
  assertNotEquals(await hashDocument(sealed), presentedSha256, "sealed and presented are different artifacts");
});

Deno.test("sealing does not mutate the presented array it was handed", async () => {
  const presented = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  const before = await hashDocument(presented);
  await sealAgreementPdf(sealInput({ presentedBytes: presented, presentedSha256: before }));
  assertEquals(await hashDocument(presented), before, "the frozen document must survive its own sealing");
});

Deno.test("a drawn signature image embeds without taking down the seal", async () => {
  const presented = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  const sealed = await sealAgreementPdf(sealInput({
    presentedBytes: presented,
    presentedSha256: await hashDocument(presented),
    parties: [party({ signatureImagePng: ONE_PX_PNG })],
  }));
  assertEquals(head(sealed), PDF_MAGIC);
});

Deno.test("a CORRUPT signature image degrades to the typed signature instead of losing the record", async () => {
  const presented = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  const sealed = await sealAgreementPdf(sealInput({
    presentedBytes: presented,
    presentedSha256: await hashDocument(presented),
    parties: [party({ signatureImagePng: new Uint8Array([1, 2, 3, 4, 5]) })],
  }));
  assertEquals(head(sealed), PDF_MAGIC, "a bad PNG must never cost us the sealed agreement");
});

Deno.test("A NON-LATIN SIGNER NAME IS REFUSED, NOT SILENTLY STAMPED AS '?'", async () => {
  // This test previously asserted only that sealing did not CRASH — and it passed, while the sealed
  // certificate recorded the signer as `?????? ??????`. A legal record that is quietly wrong about
  // who signed it is worse than one that fails loudly, so the engine now refuses.
  const presented = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  await assertRejects(
    () => sealAgreementPdf(sealInput({
      presentedBytes: presented,
      presentedSha256: "0".repeat(64),
      parties: [party({ fullName: "Дмитрий Иванов", typedName: "Дмитрий Иванов" })],
    })),
    UnrenderableNameError,
  );
});

Deno.test("the unrenderable-name check names the offender and passes clean Latin text", () => {
  assert(wouldLoseCharacters("Дмитрий"), "Cyrillic is not WinAnsi-encodable");
  assert(wouldLoseCharacters("イワノフ"), "Japanese is not WinAnsi-encodable");
  assert(!wouldLoseCharacters("Jordan Avery"), "plain Latin must pass");
  assert(!wouldLoseCharacters("Zoë Ravensbourne-O'Neill"), "Latin-1 accents and punctuation must pass");
  assert(!wouldLoseCharacters("Who? Me?"), "a name that already contains ? is not a loss");

  try {
    assertNamesAreStampable(["Jordan Avery", "Дмитрий Иванов", "Sam Okafor"]);
    throw new Error("expected a refusal");
  } catch (e) {
    assert(e instanceof UnrenderableNameError);
    assertEquals(e.names, ["Дмитрий Иванов"], "it names exactly the offender, not the whole party list");
  }
});

Deno.test("a long event history and several parties still seal", async () => {
  const presented = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  const many = Array.from({ length: 60 }, (_, i) => ({
    eventType: "viewed",
    at: `2026-06-01T${String(10 + (i % 12)).padStart(2, "0")}:00:00.000Z`,
    actorKind: "signer",
    actorLabel: `person${i}@example.com`,
    ip: "203.0.113.7",
  }));
  const sealed = await sealAgreementPdf(sealInput({
    presentedBytes: presented,
    presentedSha256: await hashDocument(presented),
    parties: [party(), party({ fullName: "Sam Okafor", email: "sam@example.com", signingOrder: 2 })],
    events: many,
  }));
  assertEquals(head(sealed), PDF_MAGIC);
});

// ── The document's own text, not just a signer's name ────────────────────────────────────────────
// The review caught the asymmetry: the engine refused a name it could not stamp and silently
// replaced the entire contract text with question marks. `renderPresentedPdf`'s docstring claimed a
// refusal it did not perform, which is worse than no docstring — the next reader trusts it.
Deno.test("a body the exporter cannot reproduce is REFUSED, not silently mangled", async () => {
  await assertRejects(
    () => renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: "Платёжные условия: 50%." }),
    UnrenderableDocumentError,
  );
});

Deno.test("a title the exporter cannot reproduce is refused too", async () => {
  await assertRejects(
    () => renderPresentedPdf({ title: "契約書", bodyMarkdown: BODY }),
    UnrenderableDocumentError,
  );
});

Deno.test("an ordinary Latin document still renders", async () => {
  const bytes = await renderPresentedPdf({ title: "Services Agreement — Q3", bodyMarkdown: BODY });
  assert(bytes.length > 500);
  assertEquals(head(bytes), PDF_MAGIC);
});

Deno.test("the certificate names WHICH medium the frozen hash covers", async () => {
  // Two freeze paths hash different things. A reader re-computing the digest against the wrong
  // medium concludes the document was altered, so the page has to say which one it is.
  const presented = await renderPresentedPdf({ title: "Services Agreement", bodyMarkdown: BODY });
  const asFile = await sealAgreementPdf(sealInput({ presentedBytes: presented, presentedKind: "file" as const }));
  const asText = await sealAgreementPdf(sealInput({ presentedBytes: presented, presentedKind: "text" as const }));
  // pdf-lib writes text as glyph runs, so assert on the artifacts differing rather than on a
  // substring: identical inputs but for the label must not produce identical bytes.
  assertNotEquals(await hashDocument(asFile), await hashDocument(asText));
});

/**
 * RENDER WHAT YOU VALIDATED — the name on the signature block.
 *
 * `normaliseFormatting` used to be private to this module and was reached only from
 * `wouldLoseCharacters`, i.e. from the VALIDATION. The RENDER called `sanitizeWinAnsi` on the raw
 * original. Every codepoint below is handled by the former and absent from the latter's allow-list,
 * so a name carrying one PASSED the check at send and was then stamped into the executed PDF as
 * `?` — a legally executed document asserting that someone whose name is not the signer's signed
 * it. These characters arrive from ordinary copy-paste (a narrow no-break space out of a word
 * processor, a zero-width joiner out of a web page), so this was not an exotic path.
 *
 * The normalisation now lives inside `sanitizeWinAnsi`, which means the validated string and the
 * rendered string are the same string by construction. These tests hold that property down.
 */
Deno.test("a name that passes validation renders faithfully — no `?` in the signature block", () => {
  const divergent: Array<[string, string]> = [
    ["U+202F narrow no-break space", " "],
    ["U+2007 figure space", " "],
    ["U+200B zero-width space", "​"],
    ["U+200C zero-width non-joiner", "‌"],
    ["U+200D zero-width joiner", "‍"],
    ["U+2060 word joiner", "⁠"],
    ["U+FEFF byte-order mark", "﻿"],
    ["CR from a Windows paste", "\r"],
  ];
  for (const [label, ch] of divergent) {
    const name = `Antonia${ch}Daniels`;
    // The validation accepts it — it always did, which is why the defect was silent.
    assertEquals(wouldLoseCharacters(name), false, `${label}: validation should accept`);
    assertNamesAreStampable([name]);
    // ...and the render must now agree rather than substituting `?`.
    assert(
      !sanitizeWinAnsi(name).includes("?"),
      `${label}: rendered as "${sanitizeWinAnsi(name)}" — the PDF would carry a name that is not the signer's`,
    );
  }
});

Deno.test("a name the exporter genuinely cannot stamp is still refused at send", () => {
  for (const name of ["Пётр Ильич", "山田太郎", "محمد عبد", "Dan 🎉 Smith"]) {
    assertEquals(wouldLoseCharacters(name), true, `${name} should still be refused`);
    assertThrows(() => assertNamesAreStampable([name]), UnrenderableNameError);
  }
});

Deno.test("ordinary Latin names are stamped verbatim", () => {
  for (const name of ["Antonio Daniel", "Zoë Müller", "Jean-Luc O'Brien", "José Álvarez"]) {
    assertEquals(sanitizeWinAnsi(name), name);
    assertEquals(wouldLoseCharacters(name), false);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WHICH DOCUMENT GETS SIGNED (#1395)
//
// Every send rendered the presented PDF from `body_markdown`. For `body_source = 'tenant_upload'`
// that column is NULL by CHECK, so the render produced a title and no content; those bytes were
// uploaded, hashed into `content_sha256` as the integrity record, and emailed for signature, while
// the file the tenant uploaded was never read — the send path did not even SELECT `document_path`.
//
// Nothing caught it because the edge function is only type-checked in CI, never exercised. The
// decision now lives in a pure function so these tests can reach it.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("a tenant's uploaded document is presented, never rendered", () => {
  assertEquals(planPresentedDocument("tenant_upload", "tenant/source/1700000000-nda.pdf"), {
    kind: "uploaded",
    path: "tenant/source/1700000000-nda.pdf",
  });
});

Deno.test("a drafted or templated agreement is still rendered", () => {
  assertEquals(planPresentedDocument("paige_draft", null), { kind: "render" });
  assertEquals(planPresentedDocument("tenant_template", null), { kind: "render" });
  // An unknown or absent source renders, which is the pre-existing behaviour for everything that
  // is not an upload. Only `tenant_upload` carries a file.
  assertEquals(planPresentedDocument(null, null), { kind: "render" });
});

Deno.test("an upload with no file is REFUSED, never quietly rendered", () => {
  // This is the exact substitution that produced the defect: absent document, render anyway.
  assertEquals(planPresentedDocument("tenant_upload", null), {
    kind: "refuse",
    reason: "missing_document",
  });
  assertEquals(planPresentedDocument("tenant_upload", "   "), {
    kind: "refuse",
    reason: "missing_document",
  });
});

Deno.test("the renderability assert CANNOT catch an absent body — it never could", () => {
  // Documented as a test rather than a comment because the whole defect rests on it. The guard
  // tests whether characters survive the exporter, not whether there is anything to sign, and
  // `String(null ?? "")` is empty — an empty string loses no characters. Anyone who assumes this
  // assert protects against a missing document is making the mistake that shipped #1395.
  assertDocumentIsRenderable("Mutual NDA", null);
  assertDocumentIsRenderable("Mutual NDA", "");
});

Deno.test("rendering a null body really does produce a document with no body — the defect, reproduced", async () => {
  const bytes = await renderPresentedPdf({
    title: "Mutual NDA",
    // The exact value the send path passed for every tenant_upload.
    bodyMarkdown: null as unknown as string,
  });
  // It does not throw, and it does produce a real PDF. That is precisely why this shipped: every
  // signal downstream — upload, hash, freeze, email — looked healthy.
  assert(bytes.length > 0, "expected a PDF to be produced");
  assert(looksLikePdf(bytes), "expected the rendered bytes to be a PDF");

  // And it is SMALL — a title page and nothing else. Compared against the same title with a real
  // body, because an absolute byte count would be a brittle assertion about pdf-lib's output.
  // The gap is the missing agreement.
  const withBody = await renderPresentedPdf({
    title: "Mutual NDA",
    bodyMarkdown: "## Terms\n\nThe parties agree as follows. ".repeat(40),
  });
  assert(
    withBody.length > bytes.length,
    `expected a real body to produce a larger document than a null one (null=${bytes.length}, body=${withBody.length})`,
  );
});

Deno.test("looksLikePdf accepts a PDF and refuses what the upload control also allows", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n");
  assert(looksLikePdf(pdf));

  // .docx and .xlsx are ZIP containers — "PK\x03\x04".
  assert(!looksLikePdf(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])));
  // .rtf
  assert(!looksLikePdf(new TextEncoder().encode("{\\rtf1\\ansi\\deff0")));
  // legacy .doc (OLE compound file)
  assert(!looksLikePdf(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])));
  // .txt / .md
  assert(!looksLikePdf(new TextEncoder().encode("# Mutual NDA\n\nThis agreement...")));
  // nothing at all
  assert(!looksLikePdf(new Uint8Array()));
  assert(!looksLikePdf(new Uint8Array([0x25, 0x50])));
});

Deno.test("looksLikePdf requires the header at offset 0, not merely somewhere", () => {
  // A file with bytes before the header is a damaged PDF. Presenting one for signature on the
  // strength of "the magic appears somewhere" is a guess, and this is not a place to guess.
  const withPreamble = new TextEncoder().encode("junk-prefix%PDF-1.7\n");
  assert(!looksLikePdf(withPreamble));
});

/**
 * THE OWNERSHIP PREDICATE ON `document_path`.
 *
 * `save_paige_agreement` validates only that the path is NON-EMPTY, and the value arrives from the
 * browser. Ordinary reads of the uploads bucket are authorized on the path's first segment against
 * `tenant_members`, but the send path downloads with the SERVICE ROLE and never reaches that
 * policy. Before the presented-document fix the field was never read, so a foreign value was
 * inert; reading it is what made this predicate necessary.
 */
Deno.test("a path in this workspace is accepted", () => {
  assert(isOwnedByTenant("11111111-1111-1111-1111-111111111111/source/1700-nda.pdf", "11111111-1111-1111-1111-111111111111"));
});

Deno.test("a path in ANOTHER workspace is refused", () => {
  assert(!isOwnedByTenant("22222222-2222-2222-2222-222222222222/source/1700-nda.pdf", "11111111-1111-1111-1111-111111111111"));
});

Deno.test("traversal, absolute and backslash forms are refused rather than normalised", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  assert(!isOwnedByTenant(`${me}/../2222/source/x.pdf`, me));
  assert(!isOwnedByTenant(`/${me}/source/x.pdf`, me));
  assert(!isOwnedByTenant(`${me}\\source\\x.pdf`, me));
  assert(!isOwnedByTenant(`${me}//source/x.pdf`, me));
});

Deno.test("a bare tenant segment with no file is refused", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  assert(!isOwnedByTenant(me, me));
  assert(!isOwnedByTenant(`${me}/`, me));
});

Deno.test("a prefix that merely starts with the tenant id is refused", () => {
  // `<tenant>evil/...` must not pass by string prefix.
  const me = "11111111-1111-1111-1111-111111111111";
  assert(!isOwnedByTenant(`${me}evil/source/x.pdf`, me));
});

Deno.test("an absent path or absent tenant is refused", () => {
  assert(!isOwnedByTenant("", "11111111-1111-1111-1111-111111111111"));
  assert(!isOwnedByTenant("11111111-1111-1111-1111-111111111111/source/x.pdf", null));
});

/**
 * THE BYPASS THAT DEFEATED THE FIRST VERSION OF THIS PREDICATE.
 *
 * Checking that the first segment equals the tenant is not enough, because the path is
 * interpolated into a request URL and a URL parser resolves dot segments — including
 * percent-encoded ones — before the request is made. Demonstrated, not assumed:
 *
 *   new URL("aaa/%2e%2e/bbb/source/x.pdf", "https://h/storage/v1/object/").pathname
 *     === "/storage/v1/object/bbb/source/x.pdf"
 *
 * The validated prefix is gone by the time the service role fetches.
 */
Deno.test("percent-encoded dot segments are refused — the prefix would be erased in transit", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  const victim = "22222222-2222-2222-2222-222222222222";
  assert(!isOwnedByTenant(`${me}/%2e%2e/${victim}/source/x.pdf`, me));
  assert(!isOwnedByTenant(`${me}/%2E%2E/${victim}/source/x.pdf`, me));
  assert(!isOwnedByTenant(`${me}/%2e%2E/${victim}/source/x.pdf`, me));
  // And the encoded separator that would rebuild a segment boundary.
  assert(!isOwnedByTenant(`${me}%2f${victim}/source/x.pdf`, me));
});

Deno.test("any percent-encoding at all is refused rather than decoded and re-checked", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  // Even innocuous encoding: decoding invites the same question one layer down, and a key this
  // system mints never needs it.
  assert(!isOwnedByTenant(`${me}/source/my%20file.pdf`, me));
});

Deno.test("control characters are refused", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  assert(!isOwnedByTenant(`${me}/source/x\u0000.pdf`, me));
  assert(!isOwnedByTenant(`${me}/source/x\u000a.pdf`, me));
});

Deno.test("a literal dot segment is refused even with the right prefix", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  assert(!isOwnedByTenant(`${me}/./source/x.pdf`, me));
  assert(!isOwnedByTenant(`${me}/../${me}/source/x.pdf`, me));
});

Deno.test("the key shape the upload side actually mints is accepted", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  // `${tenantId}/source/${Date.now()}-${safe}` with safe stripped to [\w.-]
  assert(isOwnedByTenant(`${me}/source/1758662400000-Mutual_NDA-v2.final.pdf`, me));
});
