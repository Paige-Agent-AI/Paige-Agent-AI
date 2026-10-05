import { describe, expect, it } from "vitest";
import { dealCreateRelationshipIssue, preserveResolvedDealClient, projectDealRelationshipIntegrity } from "../../supabase/functions/_shared/crm-command/deal-relationship-integrity";

const base = { tenantId: "test-tenant-a", linkedDealCount: 0, clientLabels: ["Jordan Rivers"], queryFailed: false, truncated: false };
const candidate = { id: "deal-a", tenant_id: "test-tenant-a", contact_client_id: null, title: "Jordan Rivers / discovery", pipeline_id: "pipeline-a", stage_id: "stage-a", status: "open" };

describe("canonical deal relationship diagnostics", () => {
  it("refuses omitted identity while preserving explicit prospect intent", () => {
    expect(dealCreateRelationshipIssue({ action: "deal.create", title: "Named client" })).not.toBeNull();
    expect(dealCreateRelationshipIssue({ action: "deal.create", contact_id: null })).not.toBeNull();
    expect(dealCreateRelationshipIssue({ action: "deal.create", client_ref: "CLT-CLIENT000001" })).toBeNull();
    for (const unlinked_reason of ["anonymous_prospect", "early_stage_prospect", "import_pending_identity"]) {
      expect(dealCreateRelationshipIssue({ action: "deal.create", unlinked_reason })).toBeNull();
    }
    expect(dealCreateRelationshipIssue({ action: "deal.create", unlinked_reason: "guess" })).not.toBeNull();
    expect(dealCreateRelationshipIssue({ action: "deal.create", client_ref: "CLT-CLIENT000001", unlinked_reason: "anonymous_prospect" })).not.toBeNull();
    expect(dealCreateRelationshipIssue({ action: "deal.update", unlinked_reason: "anonymous_prospect" })).not.toBeNull();
  });
  it("propagates an authorized client context before approval/idempotency without overwriting an explicit target", () => {
    expect(preserveResolvedDealClient({ action: "deal.create", title: "Discovery" }, "CLT-CLIENT000001"))
      .toMatchObject({ client_ref: "CLT-CLIENT000001" });
    expect(preserveResolvedDealClient({ action: "deal.create", contact_id: null }, "CLT-CLIENT000001"))
      .toMatchObject({ client_ref: "CLT-CLIENT000001" });
    expect(preserveResolvedDealClient({ action: "deal.create", client_ref: "CLT-CLIENT000002" }, "CLT-CLIENT000001"))
      .toMatchObject({ client_ref: "CLT-CLIENT000002" });
    expect(preserveResolvedDealClient({ action: "deal.create", contact_id: "explicit-id" }, "CLT-CLIENT000001"))
      .toEqual({ action: "deal.create", contact_id: "explicit-id" });
    expect(preserveResolvedDealClient({ action: "deal.update" }, "CLT-CLIENT000001")).toEqual({ action: "deal.update" });
    expect(preserveResolvedDealClient({ action: "deal.create" }, null)).toEqual({ action: "deal.create" });
  });
  it("requires clarification for a possible orphan, never name-only auto-linking", () => {
    expect(projectDealRelationshipIntegrity({ ...base, unlinkedDeals: [candidate] }))
      .toMatchObject({ status: "POSSIBLE_RELATIONSHIP_GAP", next_action: "ASK_USER", can_auto_link: false, candidates: [{ id: "deal-a" }] });
  });
  it("excludes a foreign-tenant same-name deal and already linked records", () => {
    const result = projectDealRelationshipIntegrity({ ...base, unlinkedDeals: [
      { ...candidate, tenant_id: "test-tenant-b" }, { ...candidate, contact_client_id: "another-client" },
    ] });
    expect(result.candidates).toEqual([]);
    expect(result.status).toBe("NO_LINKED_DEALS_IN_CHECKED_SCOPE");
  });
  it("keeps competing candidates ambiguous", () => {
    const result = projectDealRelationshipIntegrity({ ...base, unlinkedDeals: [candidate, { ...candidate, id: "deal-b" }] });
    expect(result.candidates).toHaveLength(2);
    expect(result.next_action).toBe("ASK_USER");
    expect(result.can_auto_link).toBe(false);
  });
  it("does not convert read failures or truncated reads to absence", () => {
    expect(projectDealRelationshipIntegrity({ ...base, unlinkedDeals: [], queryFailed: true }))
      .toMatchObject({ status: "UNVERIFIED", next_action: "RETRY_READ" });
    expect(projectDealRelationshipIntegrity({ ...base, unlinkedDeals: [], truncated: true }).next_action).toBe("CONTINUE_READ");
  });
  it("does not treat substrings or empty identity as evidence", () => {
    expect(projectDealRelationshipIntegrity({ ...base, clientLabels: ["Ann"], unlinkedDeals: [{ ...candidate, title: "Annette Jones" }] }).candidates).toEqual([]);
    expect(projectDealRelationshipIntegrity({ ...base, clientLabels: [], unlinkedDeals: [candidate] }).candidates).toEqual([]);
  });
});
