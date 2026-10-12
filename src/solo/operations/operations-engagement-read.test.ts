import { describe, expect, it } from "vitest";
import { normalizeEngagementRead } from "./operations-engagement-read";

const source = { agreement_id: "agreement-a", tenant_id: "tenant-a", contact_id: "client-a",
  commercial_terms_id: "terms-a", offer_id: null, version: 3, status: "completed",
  completed_at: "2026-10-09T12:00:00Z", content_sha256: "a".repeat(64), sealed_sha256: "b".repeat(64),
  sealed_copy_recorded: true, handoff_authorized: false, client_accepted: false };
const response = { ok: true, actor_id: "actor-a", tenant_id: "tenant-a", evidence: source };
const read = (value: unknown) => normalizeEngagementRead(value, "actor-a", "tenant-a", "agreement-a");
describe("scoped engagement evidence read", () => {
  it("projects only typed source evidence, without private signing fields", () => {
    const result = read({ ...response, evidence: { ...source, body_markdown: "private", sealed_storage_key: "private" } });
    expect(result).toEqual({ agreementId: "agreement-a", tenantId: "tenant-a", contactId: "client-a",
      commercialTermsId: "terms-a", offerId: null, version: 3, status: "completed",
      completedAt: source.completed_at, contentSha256: source.content_sha256, sealedSha256: source.sealed_sha256,
      sealedCopyRecorded: true });
  });
  it.each([{ actor_id: "other" }, { tenant_id: "other" }, { ok: false }, { evidence: null }])("refuses foreign or unavailable envelope %j", patch => {
    expect(read({ ...response, ...patch })).toBeNull();
  });
  it.each([{ tenant_id: "other" }, { agreement_id: "other" }, { version: "3" }, { version: 1.5 },
    { handoff_authorized: true }, { client_accepted: true }, { sealed_copy_recorded: "true" }, { contact_id: null }])("refuses malformed or misleading source %j", patch => {
    expect(read({ ...response, evidence: { ...source, ...patch } })).toBeNull();
  });
  it("retains incomplete signing evidence as unknown rather than inventing a seal", () => {
    expect(read({ ...response, evidence: { ...source, status: "draft", completed_at: null, content_sha256: null,
      sealed_sha256: null, sealed_copy_recorded: false, commercial_terms_id: null } })).toMatchObject({
      status: "draft", completedAt: null, contentSha256: null, sealedSha256: null, sealedCopyRecorded: false,
      commercialTermsId: null });
  });
});
