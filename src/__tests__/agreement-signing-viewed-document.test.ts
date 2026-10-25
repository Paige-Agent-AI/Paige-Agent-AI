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
import * as ts from "typescript";

const root = join(__dirname, "..", "..");
const page = readFileSync(join(root, "src/pages/sign/AgreementSigning.tsx"), "utf8");

/** Inspect executable TSX expressions, not text that could also occur in a comment.
 * The original upload gate now composes with verified prepared-field review and
 * decision/recovery locks. Every original consumer still needs the same gate. */
function documentGates(text: string) {
  const source = ts.createSourceFile("AgreementSigning.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations: ts.VariableDeclaration[] = [], openings: ts.JsxOpeningElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    if (ts.isJsxOpeningElement(node)) openings.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const unwrap = (node: ts.Expression): ts.Expression => ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
  const shape = (node: ts.Expression): string => {
    node = unwrap(node);
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isStringLiteral(node)) return JSON.stringify(node.text);
    if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) return "!" + shape(node.operand);
    if (ts.isBinaryExpression(node)) return "(" + shape(node.left) + ts.tokenToString(node.operatorToken.kind) + shape(node.right) + ")";
    throw Error("Unsupported document-gate expression");
  };
  const terms = (node: ts.Expression, operator: ts.SyntaxKind): string[] => {
    node = unwrap(node);
    return ts.isBinaryExpression(node) && node.operatorToken.kind === operator
      ? [...terms(node.left, operator), ...terms(node.right, operator)] : [shape(node)];
  };
  const declaration = (name: string) => {
    const found = declarations.filter(node => ts.isIdentifier(node.name) && node.name.text === name);
    expect(found).toHaveLength(1);
    const initializer = found[0].initializer;
    if (!initializer) throw Error("Missing actual gate initializer: " + name);
    return initializer;
  };
  const attribute = (node: ts.JsxOpeningElement, name: string) => node.attributes.properties
    .find((value): value is ts.JsxAttribute => ts.isJsxAttribute(value) && value.name.getText(source) === name);
  const expression = (node: ts.JsxOpeningElement, name: string) => {
    const init = attribute(node, name)?.initializer;
    if (!init || !ts.isJsxExpression(init) || !init.expression) throw Error("Missing actual gate attribute: " + name);
    return init.expression;
  };
  const doc = declaration("docGateOpen"), gate = unwrap(doc);
  if (!ts.isConditionalExpression(gate)) throw Error("Both original document modes must remain gated");
  expect(shape(gate.condition)).toBe('(fieldMode==="legacy")');
  const legacy = unwrap(gate.whenTrue);
  if (!ts.isConditionalExpression(legacy)) throw Error("Legacy upload and text gates must remain distinct");
  expect(shape(legacy.condition)).toBe("uploadedDoc");
  expect(shape(legacy.whenTrue)).toBe('(docPhase==="ready")');
  expect(shape(legacy.whenFalse)).toBe("read");
  expect(shape(gate.whenFalse)).toBe("(preparedReview!==null)");

  const sign = declaration("canSign");
  expect(terms(sign, ts.SyntaxKind.AmpersandAmpersandToken)).toEqual([
    "docGateOpen", "named", "consentRead", "consentEsign", "!busy", "!declineOpen", "!declineUnconfirmed",
  ]);
  const wrappers = openings.filter(node => attribute(node, "style") && attribute(node, "aria-hidden"));
  expect(wrappers).toHaveLength(1);
  expect(shape(expression(wrappers[0], "aria-hidden"))).toBe("!docGateOpen");
  const pointer = unwrap(expression(wrappers[0], "style"));
  if (!ts.isConditionalExpression(pointer)) throw Error("Signature pointer lock must be conditional");
  expect(terms(pointer.condition, ts.SyntaxKind.AmpersandAmpersandToken)).toEqual([
    "docGateOpen", "!busy", "!declineOpen", "!declineUnconfirmed",
  ]);
  expect(shape(pointer.whenTrue)).toBe("undefined");
  const blocked = unwrap(pointer.whenFalse);
  if (!ts.isObjectLiteralExpression(blocked)) throw Error("Closed document must suppress pointer input");
  expect(blocked.properties).toHaveLength(1);
  const property = blocked.properties[0];
  if (!ts.isPropertyAssignment(property)) throw Error("Pointer lock must be an actual property");
  expect(property.name.getText(source)).toBe("pointerEvents");
  expect(shape(property.initializer)).toBe('"none"');

  const fieldsets = openings.filter(node => node.tagName.getText(source) === "fieldset");
  expect(fieldsets).toHaveLength(1);
  const disabled = expression(fieldsets[0], "disabled");
  expect(terms(disabled, ts.SyntaxKind.BarBarToken)).toEqual(["!docGateOpen", "busy", "declineOpen", "declineUnconfirmed"]);
  const locks = openings.filter(node => attribute(node, "data-locked"));
  expect(locks).toHaveLength(1);
  const locked = expression(locks[0], "data-locked");
  expect(shape(locked)).toBe("!docGateOpen");
  return { source, slots: { document: doc, signature: sign, pointer: pointer.condition, keyboard: disabled, locked } };
}

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
    documentGates(page);
    expect(page).toMatch(/could not be (loaded|shown)/i);
  });

  it.each(["document", "signature", "pointer", "keyboard", "locked"] as const)("rejects an actual %s-gate bypass", (name) => {
    const { source, slots } = documentGates(page), slot = slots[name];
    const replacement = name === "keyboard" || name === "locked" ? "false" : "true";
    const changed = page.slice(0, slot.getStart(source)) + replacement + page.slice(slot.end);
    expect(() => documentGates(changed)).toThrow();
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
