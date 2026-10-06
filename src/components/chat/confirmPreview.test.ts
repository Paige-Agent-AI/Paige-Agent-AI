/**
 * INT-328 — a saved turn's confirm items pass the same preview gate as the live frame. The review
 * (verifier #10 / compliance LOW) found history forwarded `bundle_ref.paige_confirm[].preview` raw.
 * PROOF CLASS: automated (pure function).
 */
import { describe, expect, it } from "vitest";
import { rehydrateConfirmItems } from "./confirmPreview";

const EMAIL = {
  to_name: "Maya Ortiz",
  to_address: "maya@ortizlandscaping.example",
  from_address: "jordan@northlightadvisory.example",
  subject: "Notes from Tuesday's planning call",
  body_text: "Hi Maya,\n\nHere is what we agreed on Tuesday.\n\nJordan",
};
const item = (extra: Record<string, unknown>) => ({ tool: "comms_send_email", summary: "Email Maya", ...extra });

describe("rehydrateConfirmItems", () => {
  it("a malformed stored preview is dropped, the summary kept", () => {
    expect(rehydrateConfirmItems([item({ preview: { ...EMAIL, body_text: 5 } })])).toEqual([item({})]);
    expect(rehydrateConfirmItems([item({ confirm_preview: { ...EMAIL, subject: ["x"] } })])).toEqual([item({})]);
    expect(rehydrateConfirmItems([item({ preview: "<b>not an object</b>" })])).toEqual([item({})]);
  });
  it("a well-formed stored preview (either key) is normalised to the card's shape", () => {
    expect(rehydrateConfirmItems([item({ preview: EMAIL })])).toEqual([item({ preview: { kind: "email", ...EMAIL } })]);
    expect(rehydrateConfirmItems([item({ confirm_preview: EMAIL })])).toEqual([item({ preview: { kind: "email", ...EMAIL } })]);
  });
  it("keeps every other stored field, drops non-object items, and passes no array through as-is", () => {
    expect(rehydrateConfirmItems([item({ fingerprint: "abc" }), null, 7, ["x"]])).toEqual([item({ fingerprint: "abc" })]);
    expect(rehydrateConfirmItems(undefined)).toBeUndefined();
    expect(rehydrateConfirmItems({ tool: "x" })).toBeUndefined();
  });
});
