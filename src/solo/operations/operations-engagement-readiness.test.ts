import { describe, expect, it } from "vitest";
import { inspectEngagementReadiness, type EngagementEvidence } from "./operations-engagement-readiness";

const evidence: EngagementEvidence = {
  tenantId: "tenant-a", agreementId: "signing-a", contactId: "client-a",
  commercialTermsId: "terms-a", offerId: "offer-a", version: 3,
  status: "completed", completedAt: "2026-10-09T12:00:00Z",
  contentSha256: "a".repeat(64), sealedSha256: "b".repeat(64), sealedCopyRecorded: true,
};
const scope = { tenantId: "tenant-a", contactId: "client-a", commercialTermsId: "terms-a", offerId: "offer-a" };
describe("Operations engagement evidence preparation", () => {
  it("preserves exact signed provenance but never grants execution or client acceptance", () => {
    expect(inspectEngagementReadiness(evidence, scope)).toEqual({
      state: "ready_for_scope_review", source: {
        agreementId: "signing-a", contactId: "client-a", commercialTermsId: "terms-a",
        offerId: "offer-a", version: 3, contentSha256: "a".repeat(64), sealedSha256: "b".repeat(64),
      }, handoffAuthorized: false, clientAccepted: false,
    });
  });
  it.each(["draft", "sent", "viewed", "partially_signed", "voided", "declined", "expired", "unknown"])("refuses %s signing", status => {
    expect(inspectEngagementReadiness({ ...evidence, status }, scope).state).toBe("signing_incomplete");
  });
  it.each(["tenantId", "contactId", "commercialTermsId", "offerId"] as const)("refuses mismatched %s instead of linking another source", key => {
    expect(inspectEngagementReadiness({ ...evidence, [key]: "other" }, scope).state).toBe("source_mismatch");
  });
  it("keeps absent commercial terms separate from a signed standalone document", () => {
    expect(inspectEngagementReadiness({ ...evidence, commercialTermsId: null }, scope).state).toBe("source_mismatch");
  });
  it.each([
    { version: 0 }, { version: 1.5 }, { contentSha256: null }, { sealedSha256: "invalid" },
    { sealedCopyRecorded: false }, { completedAt: null }, { completedAt: "not-a-date" },
  ])("refuses missing or malformed frozen evidence %j", patch => {
    expect(inspectEngagementReadiness({ ...evidence, ...patch }, scope).state).toBe("sealed_evidence_unavailable");
  });
  it("treats absent reads as unavailable, never an accepted commitment", () => {
    expect(inspectEngagementReadiness(null, scope).state).toBe("unavailable");
  });
});
