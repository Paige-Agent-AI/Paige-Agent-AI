import { beforeEach, expect, it, vi } from "vitest";
import { readPortalDocumentsGlance } from "./usePortalDocumentsGlance";

const actor = "e0914000-0000-4000-8000-0000000000c1", tenant = "e0924000-0000-4000-8000-0000000000c1", contact = "e0934000-0000-4000-8000-0000000000c1";
const f = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
  rpc: (...a: unknown[]) => f.rpc(...a), from: (...a: unknown[]) => f.from(...a),
} }));
const profile = { id: contact, tenant_id: tenant, linked_user_id: actor, first_name: "Jordan", last_name: "Rivera", entity_name: null, street_address: null, city: null, state: null, zip_code: null, onboarding_stage: null, is_signup_contact: false, paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null, updated_at: "2026-01-01T00:00:00Z", email: "jordan@example.test", phone: null, contact_methods: [] };
const docs = (summary = { shared: 3, from_you: 1 }) => ({ data: { tenant_id: tenant, client_id: contact, summary, files: [], has_more: true }, error: null });
const release = (n: number, state: string) => ({ release_id: `e0954000-0000-4000-8000-00000000000${n}`, submission_id: `e0964000-0000-4000-8000-00000000000${n}`, state, revision_no: 1, artifact_digest: "c".repeat(64), title: `Work ${n}`, updated_at: "2026-01-02T00:00:00Z" });
let answer: Record<string, unknown> = {};
beforeEach(() => {
  vi.clearAllMocks();
  answer = { client_portal_self_profile: { data: profile, error: null }, client_portal_documents: docs(),
    operations_delivery_client_reviews_scoped: { data: { actor_id: actor, tenant_id: tenant, releases: [release(1, "awaiting_client"), release(2, "accepted")], unavailable_count: 0, has_more: false }, error: null } };
  f.rpc.mockImplementation(async (name: string) => answer[name]);
});
it("counts every file from the summary of a one-row read, and only work still waiting for the customer", async () => {
  expect(await readPortalDocumentsGlance()).toEqual({ state: "ready", shared: 3, fromYou: 1, awaitingReview: 1, awaitingReviewMore: false });
  expect(f.rpc).toHaveBeenCalledWith("client_portal_documents", { p_tenant_id: tenant, p_limit: 1, p_before: null });
  expect(f.from).not.toHaveBeenCalled();
});
it("counts no review work where the business cannot release it", async () => {
  answer.operations_delivery_client_reviews_scoped = { data: null, error: { code: "42501", message: "DELIVERY_CLIENT_REVIEWS_UNAVAILABLE" } };
  expect(await readPortalDocumentsGlance()).toEqual({ state: "ready", shared: 3, fromYou: 1, awaitingReview: 0, awaitingReviewMore: false });
});
it("never turns a failed read into a zero", async () => {
  answer.client_portal_documents = { data: null, error: { code: "PGRST000" } };
  expect((await readPortalDocumentsGlance()).state).toBe("error");
  answer.client_portal_documents = docs();
  answer.operations_delivery_client_reviews_scoped = { data: null, error: { code: "PGRST000", message: "network" } };
  expect((await readPortalDocumentsGlance()).state).toBe("error");
});
it("is unavailable without a customer relationship", async () => {
  answer.client_portal_self_profile = { data: null, error: null };
  expect((await readPortalDocumentsGlance()).state).toBe("unavailable");
});
it("marks the review count as a floor when the released-work page has more", async () => {
  answer.operations_delivery_client_reviews_scoped = { data: { actor_id: actor, tenant_id: tenant, releases: [release(1, "awaiting_client"), release(2, "awaiting_client")], unavailable_count: 0, has_more: true }, error: null };
  expect(await readPortalDocumentsGlance()).toEqual({ state: "ready", shared: 3, fromYou: 1, awaitingReview: 2, awaitingReviewMore: true });
});
