// _shared/agreements/document.ts — rendering, hashing and sealing the document of record (INT-163).
//
// THE INTEGRITY CLAIM THIS FILE HAS TO EARN. When a completed agreement is later questioned, the
// system must be able to say two separate things and prove both: "this is exactly what the signer
// was shown", and "this is exactly what they signed, unaltered since". That is two artifacts and
// two hashes, and the order they are produced in is the whole design.
//
// RENDER ONCE. NEVER RE-RENDER. pdf-lib stamps /CreationDate and /ModDate into the file, so two
// renders of byte-identical content produce different bytes and therefore different hashes. A
// system that re-renders the document each time somebody opens it can hash whatever it likes — the
// hash proves nothing, because the artifact it describes no longer exists. So: one Uint8Array is
// produced at send, uploaded once, hashed, and every later presentation serves THOSE STORED BYTES.
// This file gives the caller no way to do otherwise.
//
// THE SIGNING RECORD CANNOT CONTAIN THE SEALED HASH. A document cannot carry a hash of itself — adding
// the value changes the bytes that the value describes. The signing record therefore lists the
// PRESENTED hash (the thing it is attesting about) and the event log. The SEALED hash is computed
// after the sealed file is saved, and lives in the database, the owner's UI, and the completion
// email. Anyone specifying "print both hashes on that page" has described an impossible
// object, and the only ways to satisfy it are to fake a value or to hash the wrong bytes.
//
// WHAT THIS FILE REUSES RATHER THAN FORKS (§18). Body rendering is `_shared/doc-render.ts`, the one
// structured-content→PDF home. Stamping is pdf-lib directly, the same technique `finalize-agreement`
// already proves in this runtime. There is no third PDF path.

import { normaliseFormatting, renderDoc, sanitizeWinAnsi } from "../doc-render.ts";
import { sha256Hex } from "./token.ts";

const PDFLIB_SPEC = "npm:pdf-lib@1.17.1";

/**
 * A name this engine cannot faithfully put on paper.
 *
 * WHY THIS IS AN ERROR AND NOT A BEST EFFORT. pdf-lib's StandardFonts encode WinAnsi (CP1252) only,
 * and the sanitiser every stamped string passes through maps anything outside that to `?`. For a
 * heading or a body line that is a cosmetic loss. For the NAME ON A SIGNATURE it is the document
 * asserting that someone called `?????? ??????` signed it — a legal record that is quietly, provably
 * wrong about the one fact it exists to establish. Refusing is the honest outcome, and it is caught
 * at SEND rather than at seal so nobody discovers it after they have already signed.
 *
 * The real fix is a Unicode font: pdf-lib supports it via fontkit and an embedded TTF, neither of
 * which this repo ships today. That is a scoped follow-up, not something to fake in the meantime.
 */
export class UnrenderableNameError extends Error {
  readonly names: string[];
  constructor(names: string[]) {
    super(
      `These names use characters the PDF signature block cannot render yet (Latin characters only): ${names.join(", ")}. ` +
        `Send this agreement with a Latin-character spelling of the name, or wait for Unicode font support.`,
    );
    this.name = "UnrenderableNameError";
    this.names = names;
  }
}

/**
 * Would stamping this string lose characters to `?` — i.e. is the paper record about to lie?
 *
 * Line endings and zero-width formatting are normalised FIRST, because they are not the question.
 * That normalisation now lives inside `sanitizeWinAnsi` itself (`../doc-render.ts`), so the string
 * this check inspects and the string the renderer stamps are the same string. While the two were
 * separate, a name carrying U+202F or a zero-width character passed HERE and rendered as `?`.
 * `sanitizeWinAnsi`'s allow-list has no `\r`, so a body pasted from Windows — or carrying a
 * zero-width space or a narrow no-break space from a word processor — was refused at send with
 * "uses characters the PDF exporter cannot reproduce yet (Latin characters only)", which was true of
 * neither the document nor the author. The exporter drops these harmlessly; only real content loss
 * should stop a send.
 */
export function wouldLoseCharacters(text: string): boolean {
  const raw = normaliseFormatting(text);
  const before = (raw.match(/\?/g) ?? []).length;
  const after = (sanitizeWinAnsi(raw).match(/\?/g) ?? []).length;
  return after > before;
}

/**
 * Refuse a set of names the signature block cannot render faithfully.
 *
 * Called at SEND (before a token is minted or an email goes out) and again at SEAL as a backstop,
 * so the failure surfaces while it is still cheap to fix.
 */
export function assertNamesAreStampable(names: Array<string | null | undefined>): void {
  const bad = names
    .map((n) => String(n ?? "").trim())
    .filter((n) => n.length > 0 && wouldLoseCharacters(n));
  if (bad.length > 0) throw new UnrenderableNameError([...new Set(bad)]);
}

/**
 * The same refusal for the DOCUMENT rather than for a name.
 *
 * The review caught the asymmetry: the send path refused a signer's name it could not stamp — on
 * the reasoning that a record which is provably wrong about the one fact it exists to establish must
 * fail loudly — and left the entire contract TEXT open to the same mangling. An agreement drafted in
 * Cyrillic, Japanese, Arabic, Greek or Hebrew rendered to a page of question marks, was hashed,
 * frozen by `pa_sent_is_frozen_ck`, and presented as the document of record. Write-once means it
 * could not then be corrected.
 */
export class UnrenderableDocumentError extends Error {
  constructor(where: "title" | "body" | "title and body") {
    super(
      `This agreement's ${where} uses characters the PDF exporter cannot reproduce yet (Latin characters only), ` +
        `so the document would be stored with those characters replaced by "?". Nothing was sent. ` +
        `Rewrite it in Latin characters, or wait for Unicode font support.`,
    );
    this.name = "UnrenderableDocumentError";
  }
}

/**
 * Refuse a document whose own text cannot survive the exporter.
 *
 * Called at SEND and again immediately before a signature is committed, so a counterparty can never
 * bind themselves to an agreement that then can never be sealed.
 */
/**
 * Can this uploaded file actually be presented AND SEALED?
 *
 * Magic bytes are not enough, and the gap matters: `sealAgreementPdf` does `PDFDocument.load` on
 * the presented bytes, so a PDF pdf-lib cannot open fails at SEAL time — after the counterparty
 * has already signed. Encrypted PDFs are the realistic case, and not only password-protected ones:
 * a document saved with permissions restrictions is encrypted too, which is exactly what a business
 * "protects" a contract with.
 *
 * So the load is attempted HERE, at send, where the only cost of refusing is a clear message. If
 * this returns ok, the seal can open the same bytes later. Nothing is presented that cannot be
 * completed. (§32: proving it parses is not proving it runs.)
 */
export async function inspectUploadedPdf(
  bytes: Uint8Array,
): Promise<{ ok: true; pages: number } | { ok: false; reason: "not_pdf" | "unreadable" | "empty" }> {
  if (!looksLikePdf(bytes)) return { ok: false, reason: "not_pdf" };
  try {
    // Loaded through the same dynamic specifier the seal uses, so this proves the seal's own
    // loader accepts these bytes rather than proving some other parser does.
    const { PDFDocument } = await import(PDFLIB_SPEC);
    // Deliberately NOT `ignoreEncryption` — accepting an encrypted document here would move the
    // failure to the seal, which is the thing this exists to prevent.
    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPageCount();
    if (pages < 1) return { ok: false, reason: "empty" };
    return { ok: true, pages };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/**
 * Does this storage path belong to this workspace, canonically?
 *
 * CHECKING THE FIRST SEGMENT IS NOT ENOUGH, and the reason is demonstrable rather than theoretical.
 * The path is interpolated into a request URL, and a URL parser resolves dot segments BEFORE the
 * request is made — including percent-encoded ones:
 *
 *   new URL("aaa/%2e%2e/bbb/source/x.pdf", "https://h/storage/v1/object/").pathname
 *     => "/storage/v1/object/bbb/source/x.pdf"
 *
 * The `aaa/` prefix a naive check validates is simply gone by the time the service role fetches.
 * So the predicate validates the path as WRITTEN and refuses anything that could be rewritten in
 * transit: every segment must be literally canonical. Percent-encoding is rejected outright rather
 * than decoded and re-checked — decoding invites the same question one layer down, and a key this
 * system produces never needs it. Legitimate keys are built as
 * `${tenantId}/source/${Date.now()}-${safe}` with `safe` already stripped to `[\w.-]`
 * (useSoloAgreementSignings.ts:432-436), so this accepts exactly what we mint and nothing else.
 */
export function isOwnedByTenant(path: string, tenantId: string | null): boolean {
  if (!path || !tenantId) return false;
  // No percent-encoding, no backslashes, no control characters — nothing a parser could rewrite.
  if (/[%\\]/.test(path) || /[\u0000-\u001f\u007f]/.test(path)) return false;
  const segments = path.split("/");
  if (segments.length < 2) return false;
  if (segments[0] !== tenantId) return false;
  // Every segment literally canonical: non-empty, not a dot segment, and drawn from the alphabet
  // the upload side can actually produce.
  return segments.every((segment) => segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment));
}

/**
 * WHICH BYTES DO WE PRESENT FOR SIGNATURE?
 *
 * Pure, and separated from the send handler on purpose. This decision shipped wrong and nothing
 * caught it, because the edge function is only type-checked in CI and never exercised — its own
 * workflow step says so. A rule that decides what a counterparty is asked to sign belongs
 * somewhere a test can reach.
 *
 * The rule itself is one line of intent: **a tenant's uploaded document is never rendered.** It is
 * presented as the tenant supplied it. Rendering one produces a document nobody wrote, because
 * `paige_agreements` CHECKs `body_markdown IS NULL` for this source, and a null body renders as a
 * title with no content rather than as an error.
 */
export type PresentationPlan =
  | { kind: "render" }
  | { kind: "uploaded"; path: string }
  | { kind: "refuse"; reason: "missing_document" };

export function planPresentedDocument(
  bodySource: string | null | undefined,
  documentPath: string | null | undefined,
): PresentationPlan {
  if (bodySource !== "tenant_upload") return { kind: "render" };
  const path = typeof documentPath === "string" ? documentPath.trim() : "";
  // A tenant_upload with no file is a broken row, not something to paper over by rendering: the
  // CHECK that forbids it (document_path IS NOT NULL) is the same one that nulls the body, so a row
  // that reaches here without a path has already escaped the constraint and must not be presented.
  if (!path) return { kind: "refuse", reason: "missing_document" };
  return { kind: "uploaded", path };
}

/**
 * Is this actually a PDF?
 *
 * Checked by MAGIC BYTES rather than by the filename or the upload's declared content type, both
 * of which the browser supplies and neither of which survives a rename. The header is required at
 * offset 0, as the specification states it: every producer a tenant is realistically using — Word,
 * Acrobat, Pages, a browser print — writes it there, and leading bytes before it mean a damaged
 * file, which is not something to present for signature on a guess.
 *
 * This exists because the upload control accepts `.doc/.docx/.rtf/.txt/.md` alongside PDF, while
 * the presented-document bucket accepts `application/pdf` only and the seal stamps signatures INTO
 * the document. A non-PDF cannot be presented and cannot be sealed, so it is refused at send.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF-"
  const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (bytes.length < MAGIC.length) return false;
  return MAGIC.every((b, i) => bytes[i] === b);
}

export function assertDocumentIsRenderable(title: string, bodyMarkdown: string | null): void {
  const badTitle = wouldLoseCharacters(String(title ?? ""));
  const badBody = wouldLoseCharacters(String(bodyMarkdown ?? ""));
  if (badTitle && badBody) throw new UnrenderableDocumentError("title and body");
  if (badTitle) throw new UnrenderableDocumentError("title");
  if (badBody) throw new UnrenderableDocumentError("body");
}

export interface AgreementPartyLine {
  fullName: string;
  email: string;
  role: string;
  signingOrder: number;
  status: string;
  typedName: string | null;
  signedAt: string | null;
  consentAt: string | null;
  consentSlug: string | null;
  consentVersion: number | null;
  signingIp: string | null;
  signingUserAgent: string | null;
  /** Data URL or raw base64 PNG of a drawn mark, when the signer drew one. */
  signatureImagePng: Uint8Array | null;
}

export interface AgreementEventLine {
  eventType: string;
  at: string;
  actorKind: string;
  actorLabel: string | null;
  ip: string | null;
}

/**
 * Render the body a signer will be shown.
 *
 * Throws `UnrenderableDocumentError` when the title or body uses characters the PDF exporter cannot
 * encode — Latin-only StandardFonts. That is a truthful refusal, not a silent mangling: an agreement
 * whose text was quietly replaced with `?` is not a document anybody should be asked to sign.
 *
 * §13 — THIS DOCSTRING USED TO BE FALSE, which is the worst kind of comment. It claimed a refusal on
 * the strength of `renderDoc` throwing `NeedsConfigError`; `sanitizeWinAnsi` maps every unencodable
 * codepoint to `?` precisely so pdf-lib never throws, and `renderDoc` catches and degrades besides.
 * The check is performed here now rather than merely described.
 */
export async function renderPresentedPdf(input: {
  title: string;
  bodyMarkdown: string;
}): Promise<Uint8Array> {
  assertDocumentIsRenderable(input.title, input.bodyMarkdown);
  const result = await renderDoc({
    format: "pdf",
    title: input.title,
    content: input.bodyMarkdown,
  });
  return result.bytes;
}

/** The presented-bytes hash. Takes the exact array that was uploaded — never a re-render. */
export async function hashDocument(bytes: Uint8Array): Promise<string> {
  return await sha256Hex(bytes);
}

/**
 * Seal a completed agreement: stamp each signature INTO the document, then append the signing record.
 *
 * The signature is drawn onto the document itself rather than recorded beside it, because "the
 * signature is attached to or logically associated with the record" is the actual statutory test —
 * a row in a database that merely points at a PDF is weaker evidence than a PDF that carries the
 * mark. The signing-record page then carries the provenance the page images cannot.
 *
 * Returns the sealed bytes. The caller hashes THOSE and stores the result; this function neither
 * knows nor can know its own output's hash.
 */
export async function sealAgreementPdf(input: {
  presentedBytes: Uint8Array;
  presentedSha256: string;
  /**
   * WHAT THE FROZEN HASH ACTUALLY COVERS, because the two send paths freeze different media and the
   * record must not imply otherwise. `agreement-send` stores a PDF and hashes the file; the approved
   * page's own path presents the agreement's TEXT and the database freezes the digest of that text.
   * Both are "the exact bytes presented" for their medium — saying which one is the difference
   * between a reproducible check and a reader computing the wrong digest and concluding forgery.
   */
  presentedKind: "file" | "text";
  agreementTitle: string;
  agreementId: string;
  tenantName: string;
  parties: AgreementPartyLine[];
  events: AgreementEventLine[];
  sealedAtIso: string;
}): Promise<Uint8Array> {
  // Backstop. The send path already refused these, so reaching here means a name changed after
  // send or a caller skipped the check — either way, stamping `?` onto the record is not the answer.
  assertNamesAreStampable(input.parties.flatMap((p) => [p.fullName, p.typedName]));

  const { PDFDocument, StandardFonts, rgb } = await import(PDFLIB_SPEC);

  // Load the EXACT bytes the signer saw. Everything below is additive to that document.
  const pdf = await PDFDocument.load(input.presentedBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 612, PAGE_H = 792, MARGIN = 54;
  const ink = rgb(0.09, 0.09, 0.11);
  const muted = rgb(0.42, 0.42, 0.46);
  const rule = rgb(0.78, 0.78, 0.82);

  // ── 1) The signature block, stamped onto a page appended to the agreement itself ───────────────
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const nextPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
  const room = (h: number) => { if (y - h < MARGIN) nextPage(); };

  // Every string that reaches drawText goes through the same WinAnsi normalisation doc-render uses.
  // pdf-lib's StandardFonts THROW on an unencodable codepoint, so an un-sanitised signer name would
  // take down the seal — at the one moment the record matters most.
  const text = (s: string, size: number, f: unknown, color = ink, indent = 0) => {
    // This helper draws ONE line and advances `y` by exactly one line. `sanitizeWinAnsi` now
    // normalises CR to `\n` instead of mapping it to `?`, and pdf-lib's drawText renders an
    // embedded newline as two lines — which would silently overlap the line that follows. A name
    // or a heading is a single line by definition, so flatten it.
    const line = sanitizeWinAnsi(s).replace(/\n+/g, " ").trim();
    room(size * 1.5);
    page.drawText(line, { x: MARGIN + indent, y: y - size, size, font: f, color });
    y -= size * 1.5;
  };

  const hr = () => {
    room(14);
    page.drawLine({
      start: { x: MARGIN, y: y - 6 },
      end: { x: PAGE_W - MARGIN, y: y - 6 },
      thickness: 0.5,
      color: rule,
    });
    y -= 14;
  };

  text("Signatures", 18, bold);
  hr();
  y -= 4;

  for (const p of input.parties.filter((x) => x.status === "signed")) {
    room(120);
    text(p.fullName, 13, bold);
    text(`${p.role} · ${p.email}`, 9, font, muted);
    y -= 4;

    if (p.signatureImagePng) {
      try {
        const png = await pdf.embedPng(p.signatureImagePng);
        const w = 200;
        const h = w * (png.height / png.width);
        room(h + 10);
        page.drawImage(png, { x: MARGIN, y: y - h, width: w, height: h });
        y -= h + 8;
      } catch (e) {
        // A drawn mark that will not embed must not cost us the seal. The typed name below is the
        // signature that the record actually relies on; the image is corroboration.
        console.error("[agreements] signature image embed failed", String(e));
      }
    }

    text(`/s/ ${p.typedName ?? p.fullName}`, 14, bold);
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: MARGIN + 260, y: y + 4 },
      thickness: 0.5,
      color: rule,
    });
    y -= 8;
    text(`Signed ${p.signedAt ?? "—"} (UTC)`, 9, font, muted);
    if (p.consentAt) {
      text(
        `Consented to sign electronically ${p.consentAt} (UTC) · disclosure ${p.consentSlug ?? "—"} v${p.consentVersion ?? "—"}`,
        9, font, muted,
      );
    }
    y -= 10;
  }

  // ── 2) The signing record ─────────────────────────────────────────────────────────────────────
  // NOT "certificate of completion": that is a signing vendor's product noun and is banned by owner
  // ruling. The page is the same evidence; the name is ours.
  nextPage();
  text("Signing record", 18, bold);
  text(sanitizeWinAnsi(input.agreementTitle), 11, font, muted);
  hr();
  y -= 6;

  text("Agreement", 11, bold);
  text(`Reference: ${input.agreementId}`, 9, font);
  text(`Prepared by: ${sanitizeWinAnsi(input.tenantName)}`, 9, font);
  text(`Completed: ${input.sealedAtIso} (UTC)`, 9, font);
  y -= 4;

  // The hash of what every party was shown. This is the value a later reader re-computes against the
  // presented file to prove it was not altered. Split across lines because 64 hex characters do not
  // fit the measure at this size.
  text(
    input.presentedKind === "file"
      ? "Document presented to all parties (SHA-256 of the file)"
      : "Agreement text presented to all parties (SHA-256 of the text, UTF-8)",
    11, bold,
  );
  text(input.presentedSha256.slice(0, 32), 9, font);
  text(input.presentedSha256.slice(32), 9, font);
  text(
    "The completed file carries its own SHA-256, recorded alongside this agreement and shown with it.",
    8, font, muted,
  );
  y -= 8;

  text("Parties", 11, bold);
  for (const p of input.parties) {
    room(40);
    text(`${p.signingOrder}. ${sanitizeWinAnsi(p.fullName)} — ${p.email}`, 9, font);
    text(`   ${p.role} · ${p.status}${p.signedAt ? ` · signed ${p.signedAt} UTC` : ""}`, 8, font, muted);
    if (p.signingIp) {
      text(`   Origin ${p.signingIp} · ${sanitizeWinAnsi((p.signingUserAgent ?? "").slice(0, 78))}`, 8, font, muted);
    }
  }
  y -= 8;

  text("Event history", 11, bold);
  for (const e of input.events) {
    room(16);
    const who = e.actorLabel ? ` · ${sanitizeWinAnsi(e.actorLabel)}` : "";
    const from = e.ip ? ` · ${e.ip}` : "";
    text(`${e.at}  ${e.eventType}  (${e.actorKind})${who}${from}`, 8, font);
  }
  y -= 10;

  hr();
  // The honest sentence. What we hold is possession of an address, a network origin and a client —
  // strong circumstantial attribution, and not an identity check. Saying so on the record itself is
  // better than letting a reader assume more than the evidence carries.
  text(
    "Attribution is evidenced by control of the email address the signing link was sent to, together",
    8, font, muted,
  );
  text(
    "with the network origin, client and timestamps recorded above. No government identity check was",
    8, font, muted,
  );
  text("performed. All times are UTC, recorded by the server.", 8, font, muted);

  return await pdf.save();
}
