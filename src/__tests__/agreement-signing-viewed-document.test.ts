/**
 * A2 — the signer sees the actual uploaded document (#1399).
 *
 * The byte-serving seam already exists: `agreement-document` streams the exact frozen
 * presented bytes to an open agreement's signing token. The signing page never called
 * it — an uploaded document (`document_path`, no `document_body`) rendered a placeholder
 * telling the signer to ask the business to resend the agreement as text, and the read
 * gate's scroll measurement never had a document to measure.
 *
 * Pins in this suite (source-level, the house wiring-proof class):
 *  - the page fetches the frozen document through the token door when the row carries
 *    an uploaded document;
 *  - the placeholder asking for a resend is unreachable for those rows;
 *  - the PDF viewer renders inside the existing document slot;
 *  - signing stays locked until the viewer has loaded (fail-closed: a signer cannot
 *    consent to a document they cannot see), with an honest failure line;
 *  - the attestation for uploaded documents is the signer's own review claim, never a
 *    measured-reading percentage the product cannot observe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const page = readFileSync(join(root, "src/pages/sign/AgreementSigning.tsx"), "utf8");

describe("the signing page presents the uploaded document", () => {
  it("fetches the frozen bytes through the signing-token door", () => {
    expect(page).toContain("agreement-document");
    expect(page).toMatch(/token=\$\{encodeURIComponent\(token\)\}|token="\s*\+\s*token|token=\$\{token\}/);
  });

  it("renders the document viewer in the existing slot, never the resend placeholder", () => {
    expect(page).toMatch(/<iframe[^>]*agreement-doc|<object[^>]*agreement-doc|data-iframe="agreement-doc"|title="The document you are signing"/);
    expect(page).not.toContain("Ask the business to resend it as text");
  });

  it("keeps signing locked until the viewer loaded, with an honest failure line", () => {
    expect(page).toMatch(/docPhase|docStatus|docLoaded/);
    expect(page).toMatch(/could not be (loaded|shown)/i);
    expect(page).toMatch(/docPhase === "ready"|docStatus === "ready"|docLoaded/);
  });

  it("attests review for uploaded documents, never a fabricated read percentage", () => {
    // The percentage indicator belongs to the text body's measured scroll only; the
    // uploaded-document branch must not render "Read {pct}%" over a PDF.
    expect(page).toMatch(/document_body\s*\?|row\.document_body \?/);
    expect(page).toMatch(/reviewed the document|review it in full|Read it in full below/);
  });

  it("is not a vacuous check: the text body path and its scroll gate remain", () => {
    expect(page).toContain("document_body");
    expect(page).toContain("Read {pct}%");
  });
});
