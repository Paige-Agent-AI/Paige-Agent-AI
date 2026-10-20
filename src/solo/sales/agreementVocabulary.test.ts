// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGREEMENT_STATE, SIGNATURE_STATE } from "./agreementVocabulary";

// Experience 04 E4-S3 PR-0 — the Sales engagement and signature words live in ONE module, so Sales and
// the client record (Track D) never describe one agreement two ways. Moved verbatim from sales-ops.tsx.
describe("agreementVocabulary — one home for the Sales agreement words", () => {
  it("keeps today's engagement labels and tones", () => {
    expect(AGREEMENT_STATE).toEqual({
      draft: { label: "Draft", tone: "opportunity" },
      active: { label: "Active", tone: "ok" },
      paused: { label: "Paused", tone: "warn" },
      completed: { label: "Completed", tone: "n" },
      cancelled: { label: "Cancelled", tone: "n" },
      unrecognised: { label: "Not readable", tone: "n" },
    });
  });

  it("keeps today's signature labels and tones", () => {
    expect(SIGNATURE_STATE.none).toEqual({ label: "No document", tone: "n" });
    expect(SIGNATURE_STATE.viewed).toEqual({ label: "Opened", tone: "warn" });
    expect(SIGNATURE_STATE.expired).toEqual({ label: "Link expired", tone: "bad" });
    expect(Object.keys(SIGNATURE_STATE)).toEqual(["none", "draft", "sent", "viewed", "partially_signed", "completed", "declined", "voided", "expired", "unrecognised"]);
  });

  it("sales-ops.tsx imports them and no longer declares its own", () => {
    const src = readFileSync("src/solo/sales-ops.tsx", "utf8");
    expect(src).not.toMatch(/const (AGREEMENT_STATE|SIGNATURE_STATE)\s*=/);
    expect(src).toMatch(/from "\.\/sales\/agreementVocabulary"/);
  });
});
