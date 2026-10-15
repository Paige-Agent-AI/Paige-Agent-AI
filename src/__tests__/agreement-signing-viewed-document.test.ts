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
    // The gate EXPRESSION, not a state name: every consumer the old read flag fed must key on
    // docGateOpen — reverting any one of them (canSign, data-locked, the pointer-events
    // wrapper) turns this pin red.
    expect(page).toContain("const docGateOpen = uploadedDoc ? docPhase === \"ready\" : read;");
    expect(page).toContain("const canSign = docGateOpen && named && consentRead && consentEsign && !busy;");
    expect(page).toContain('style={docGateOpen ? undefined : { pointerEvents: "none" }} aria-hidden={!docGateOpen}');
    expect(page).toMatch(/could not be (loaded|shown)/i);
  });

  it("attests review for uploaded documents, never a fabricated read percentage", () => {
    // The percentage indicator is BRANCHED away for uploaded documents, and the branch's own
    // attestation string is present — a pin that survives on main's shared hero copy binds nothing.
    expect(page).toMatch(/\{row\?\.document_body \? \([\s\S]{0,200}Read \{pct\}%|row\.document_body \? \(\)[\s\S]{0,80}Read \{pct\}%/);
    expect(page).toContain("Document shown — review it in full before signing.");
    expect(page).toContain("The document is shown above. You can sign it now.");
  });

  it("is not a vacuous check: the text body path and its scroll gate remain", () => {
    expect(page).toContain("document_body");
    expect(page).toContain("Read {pct}%");
  });
});
