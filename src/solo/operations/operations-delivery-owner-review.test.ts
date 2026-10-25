import { expect, it, vi } from "vitest";
import { parseStaffSubmissions, writeStaffDelivery, readStaffArtifact } from "./operations-delivery-staff";
import { readPendingDeliveryReviews } from "./operations-delivery-reviews";
import { readDeliveryRecovery, saveDeliveryRecovery, clearDeliveryRecovery, type DeliveryRecovery } from "./operations-delivery-local-recovery";
import { releaseReviewers } from "./operations-item-release";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";

const id = (n: number) => `ed740000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: id(1), tenantId: id(2), workItemId: id(3), planId: id(4), clientId: id(5), workUpdatedAt: "2026-10-24T12:00:00.123456Z" };
const row = { id: id(6), tenant_id: scope.tenantId, work_item_id: scope.workItemId, plan_id: scope.planId, client_id: scope.clientId,
  artifact_version_id: id(7), artifact_digest: "a".repeat(64), revision_no: 1, submitted_by: scope.actorId, reviewer_user_id: scope.actorId,
  review_mode: "owner_self_review" as const, state: "in_review" as const, submitted_at: scope.workUpdatedAt,
  reviewed_by: null, reviewed_at: null, review_note: null, updated_at: scope.workUpdatedAt };
const approved = { ...row, state: "approved" as const, reviewed_by: scope.actorId, reviewed_at: "2026-10-24T13:00:00Z", updated_at: "2026-10-24T13:00:00Z" };
const envelope = (submission: unknown) => ({ work_item_id: scope.workItemId, submissions: [submission] });
const submit = { kind: "submit" as const, artifactVersionId: row.artifact_version_id, reviewerId: scope.actorId, reviewMode: "owner_self_review" as const, expectedRevisionNo: 0 };
function caller(ack: unknown, saved: unknown = row, releases: unknown[] = []) {
  return { getActor: vi.fn().mockResolvedValue(scope.actorId), rpc: vi.fn().mockImplementation(async (name: string) => ({
    data: name === "operations_delivery_list_scoped" ? envelope(saved) : name === "operations_delivery_client_status_scoped" ? { work_item_id: scope.workItemId, client_releases: releases } : ack,
    error: null,
  })) };
}
const submitAck = { ok: true, submission_id: row.id, revision_no: 1, state: "in_review", review_mode: "owner_self_review" };
it("reads an explicitly recorded owner review without calling it approved or client accepted", () => {
  expect(parseStaffSubmissions(envelope(row), scope)).toEqual([row]);
});
it.each([undefined, null, "second_person", "owner", ["owner_self_review"]])("same-person source needs the exact recorded owner mode: %j", mode => {
  const value = { ...row, review_mode: mode };
  if (mode === undefined) delete (value as { review_mode?: unknown }).review_mode;
  expect(parseStaffSubmissions(envelope(value), scope)).toBeNull();
});
it("different-person legacy records remain readable but never borrow owner mode", () => {
  const legacy = { ...row, reviewer_user_id: id(8) } as Record<string, unknown>;
  delete legacy.review_mode;
  expect(parseStaffSubmissions(envelope(legacy), scope)).toEqual([legacy]);
  expect(parseStaffSubmissions(envelope({ ...legacy, review_mode: "owner_self_review" }), scope)).toBeNull();
});
it("an owner nomination writes only the original submission and confirms in_review separately", async () => {
  const c = caller(submitAck);
  expect(await writeStaffDelivery(c, scope, submit, () => true)).toMatchObject({ kind: "verified", readback: { submissions: [row], releases: [] } });
  expect(c.rpc.mock.calls.map(call => call[0])).toEqual(["operations_delivery_submit_scoped", "operations_delivery_list_scoped", "operations_delivery_client_status_scoped"]);
  expect(c.rpc.mock.calls[0][1]).toEqual({ p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId,
    p_work_item_id: scope.workItemId, p_artifact_version_id: row.artifact_version_id, p_reviewer_user_id: scope.actorId,
    p_expected_work_updated_at: scope.workUpdatedAt, p_expected_revision_no: 0 });
});
it("a client flag cannot bypass the native current-owner refusal or retry it", async () => {
  const c = caller(null); c.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect(await writeStaffDelivery(c, scope, submit, () => true)).toEqual({ kind: "refused" });
  expect(c.rpc).toHaveBeenCalledOnce();
});
it("a self nomination without explicit owner intent never calls the original writer", async () => {
  const c = caller(submitAck); const action = { kind: "submit" as const, artifactVersionId: row.artifact_version_id, reviewerId: scope.actorId, expectedRevisionNo: 0 };
  expect(await writeStaffDelivery(c, scope, action, () => true)).toEqual({ kind: "invalid" }); expect(c.rpc).not.toHaveBeenCalled();
});
it("a missing or altered owner-mode acknowledgement remains unconfirmed", async () => {
  for (const mode of [undefined, "second_person"]) {
    const c = caller({ ...submitAck, review_mode: mode });
    expect(await writeStaffDelivery(c, scope, submit, () => true)).toEqual({ kind: "unverified" });
    expect(c.rpc).toHaveBeenCalledOnce();
  }
});
it("owner approval is a separate original review and still has no client release", async () => {
  const c = caller({ ok: true, submission_id: row.id, state: "approved", review_mode: "owner_self_review" }, approved);
  expect(await writeStaffDelivery(c, scope, { kind: "review", submission: row, decision: "approved", note: null }, () => true))
    .toMatchObject({ kind: "verified", readback: { submissions: [approved], releases: [] } });
  expect(c.rpc.mock.calls[0]).toEqual(["operations_delivery_review_scoped", { p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId,
    p_submission_id: row.id, p_expected_updated_at: row.updated_at, p_decision: "approved", p_note: null }]);
});
it("a native owner demotion refuses a later review and never resends", async () => {
  const c = caller(null); c.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect(await writeStaffDelivery(c, scope, { kind: "review", submission: row, decision: "approved", note: null }, () => true)).toEqual({ kind: "refused" });
  expect(c.rpc).toHaveBeenCalledOnce();
});
it("an explicitly approved owner version uses the unchanged separate client-release writer", async () => {
  const release = { release_id: id(10), submission_id: row.id, state: "awaiting_client", released_by: scope.actorId, released_at: "2026-10-24T14:00:00Z",
    decision_by: null, decision_at: null, client_note: null, updated_at: "2026-10-24T14:00:00Z" };
  const c = caller({ ok: true, release_id: release.release_id, state: "awaiting_client" }, approved, [release]);
  expect(await writeStaffDelivery(c, scope, { kind: "release", submission: approved }, () => true)).toMatchObject({ kind: "verified", readback: { releases: [{ state: "awaiting_client", decision_by: null }] } });
  expect(c.rpc.mock.calls[0]).toEqual(["operations_delivery_release_scoped", { p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId,
    p_submission_id: approved.id, p_expected_updated_at: approved.updated_at }]);
});
const projection = { ...row, actor_id: scope.actorId, submission_id: row.id, title: "Consultation summary", body: "The exact saved work." };
it("owner artifact inspection binds the original recorded method", async () => {
  const c = caller(projection);
  expect(await readStaffArtifact(c, scope, row, () => true)).toEqual({ kind: "ready", title: projection.title, body: projection.body });
  expect(c.rpc).toHaveBeenCalledOnce();
});
it("a changed artifact review method is not the inspected submission", async () => {
  const second = { ...row, reviewer_user_id: id(8), review_mode: "second_person" as const };
  const c = caller({ ...projection, reviewer_user_id: id(8), review_mode: "owner_self_review" });
  expect(await readStaffArtifact(c, scope, second, () => true)).toEqual({ kind: "source_changed" });
});
const nomination = { submission_id: row.id, work_item_id: scope.workItemId, plan_id: scope.planId, client_id: scope.clientId,
  artifact_version_id: row.artifact_version_id, artifact_digest: row.artifact_digest, revision_no: row.revision_no, submitted_by: scope.actorId,
  reviewer_user_id: scope.actorId, review_mode: "owner_self_review", submission_updated_at: row.updated_at, work_updated_at: scope.workUpdatedAt, title: "Consultation summary" };
it("the original review queue retains an explicit owner nomination", async () => {
  const c = { getActor: vi.fn().mockResolvedValue(scope.actorId), getTenant: vi.fn().mockResolvedValue(scope.tenantId),
    rpc: vi.fn().mockResolvedValue({ data: { actor_id: scope.actorId, tenant_id: scope.tenantId, reviews: [nomination], unavailable_count: 0, has_more: false }, error: null }) };
  expect(await readPendingDeliveryReviews(c, scope, () => true)).toEqual({ kind: "ready", reviews: [nomination], unavailableCount: 0, hasMore: false });
});
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
it("reload retains the exact uncertain owner intent and mode without another write", () => {
  const s = storage(); const recovery: DeliveryRecovery = { version: 1, scope, kind: "attempt", action: submit };
  expect(saveDeliveryRecovery(s, scope, recovery)).toBe(true);
  expect(readDeliveryRecovery(s, { ...scope, workUpdatedAt: "2026-10-24T15:00:00Z" })).toEqual({ kind: "retained", recovery });
  const altered = { ...recovery, action: { ...submit, reviewMode: "second_person" } } as DeliveryRecovery;
  expect(clearDeliveryRecovery(s, scope, altered)).toBe(false);
  expect(clearDeliveryRecovery(s, scope, recovery)).toBe(true);
});
it("owner preparation recovery retains explicit method while missing mode stays refused", () => {
  const s = storage(); const draft = { kind: "preparation" as const, sessionId: id(11), artifactId: id(12), versionId: row.artifact_version_id, reviewerId: scope.actorId, reviewMode: "owner_self_review" as const };
  const recovery: DeliveryRecovery = { version: 1, scope, kind: "draft", draft };
  expect(saveDeliveryRecovery(s, scope, recovery)).toBe(true);
  expect(readDeliveryRecovery(s, scope)).toEqual({ kind: "retained", recovery });
  const bad = { kind: "preparation" as const, sessionId: id(11), artifactId: id(12), versionId: row.artifact_version_id, reviewerId: scope.actorId };
  expect(saveDeliveryRecovery(storage(), scope, { version: 1, scope, kind: "draft", draft: bad })).toBe(false);
});
it("owner review and release recovery retain immutable method but strip copied recorded notes", () => {
  const s = storage(); const recorded = { ...approved, review_note: "Private recorded prose" };
  const recovery: DeliveryRecovery = { version: 1, scope, kind: "attempt", action: { kind: "release", submission: recorded } };
  expect(saveDeliveryRecovery(s, scope, recovery)).toBe(true);
  expect(readDeliveryRecovery(s, scope)).toEqual({ kind: "retained", recovery: { ...recovery, action: { kind: "release", submission: { ...recorded, review_note: null } } } });
  expect([...s.values.values()][0]).not.toContain("Private recorded prose");
});
const member = (owner: boolean, status = "active", permission: TeamMemberRecord["permission"] = "member"): TeamMemberRecord => ({
  membership_id: id(13), user_id: scope.actorId, full_name: "Business owner", email: null, avatar_url: null, status,
  permission, is_owner: owner, job_title: null, responsibilities: null, last_sign_in_at: null,
});
it("only the active canonical business owner is offered their own review", () => {
  expect(releaseReviewers([member(true)], scope.actorId).map(value => value.user_id)).toEqual([scope.actorId]);
  expect(releaseReviewers([member(false, "active", "admin")], scope.actorId)).toEqual([]);
  expect(releaseReviewers([member(true, "invited")], scope.actorId)).toEqual([]);
});
