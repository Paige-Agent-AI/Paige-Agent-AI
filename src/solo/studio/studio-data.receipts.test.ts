import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: api.rpc, from: api.from, functions: { invoke: api.invoke } } }));
import { loadStudioPublicationReceipts, Said } from "./studio-data";

const tenant = "00000000-0000-4000-8000-000000000010";
const session = "00000000-0000-4000-8000-000000000020";
const page = "00000000-0000-4000-8000-000000000030";
const receiptId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const occurred = "2026-11-13T17:00:00.000Z";
function receipt(overrides: Record<string, unknown> = {}) {
  return { id: receiptId(41), occurred_at: occurred, capability_key: "growth_page_publish", outcome: "capability_succeeded", ...overrides };
}
function response(receipts: unknown, extra: Record<string, unknown> = {}) { return { data: { ok: true, receipts, ...extra }, error: null }; }
beforeEach(() => {
  api.rpc.mockReset().mockResolvedValue(response([]));
  api.from.mockReset().mockImplementation(() => { throw new Error("A private table read is not a receipt reader"); });
  api.invoke.mockReset().mockImplementation(() => { throw new Error("A receipt read cannot execute an effect"); });
});

describe("original Studio publication receipt reader", () => {
  it("uses only the authenticated native tuple and returns the actual receipt identity", async () => {
    const row = receipt({ detail: { token: "PRIVATE_RECEIPT_TOKEN", email: "private@example.invalid", approval: "PRIVATE_APPROVAL" }, actor_id: "PRIVATE_ACTOR", tenant_id: "PRIVATE_TENANT", status: "published" });
    api.rpc.mockResolvedValue(response([row]));
    expect(await loadStudioPublicationReceipts(tenant, session, page)).toEqual([{ id: receiptId(41), occurredAt: occurred, action: "publish", outcome: "succeeded" }]);
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith("studio_publication_receipts", { p_expected_tenant: tenant, p_session_id: session, p_page_id: page });
    expect(api.from).not.toHaveBeenCalled();
    expect(api.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["capability_succeeded", "succeeded"], ["capability_failed", "failed"], ["capability_refused", "refused"],
    ["capability_outcome_unknown", "unknown"], ["capability_unreachable", "unreachable"], ["capability_completed_unrecorded", "unrecorded"],
  ])("retains the native %s outcome without promoting it to success", async (native, outcome) => {
    api.rpc.mockResolvedValue(response([receipt({ capability_key: "growth_page_unpublish", outcome: native })]));
    expect(await loadStudioPublicationReceipts(tenant, session, page)).toEqual([{ id: receiptId(41), occurredAt: occurred, action: "unpublish", outcome }]);
  });

  it("keeps only the native first five IDs in source order and leaves input unchanged", async () => {
    const rows = Array.from({ length: 7 }, (_, n) => receipt({ id: receiptId(50 + n), occurred_at: `2026-11-13T17:00:0${6 - n}Z` }));
    const before = JSON.stringify(rows);
    api.rpc.mockResolvedValue(response(rows));
    expect((await loadStudioPublicationReceipts(tenant, session, page)).map((row) => row.id)).toEqual(rows.slice(0, 5).map((row) => row.id));
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("does not infer a receipt from page status, a public URL or a payload-level receipt label", async () => {
    api.rpc.mockResolvedValue(response([], { status: "published", public_url: "https://public.example.com/page", receipt_id: "MADE_UP_RECEIPT" }));
    expect(await loadStudioPublicationReceipts(tenant, session, page)).toEqual([]);
    expect(api.rpc).toHaveBeenCalledTimes(1);
    expect(api.from).not.toHaveBeenCalled();
  });

  it.each([null, undefined, [], {}, { ok: false, code: "not_allowed" }, { ok: false, code: "scope_changed" }, { ok: true }, { ok: true, receipts: null }, { ok: true, receipts: {} }, { ok: "true", receipts: [] }])("refuses unavailable or malformed native envelopes", async (data) => {
    api.rpc.mockResolvedValue({ data, error: null });
    await expect(loadStudioPublicationReceipts(tenant, session, page)).rejects.toBeInstanceOf(Said);
    await expect(loadStudioPublicationReceipts(tenant, session, page)).rejects.toThrow("Publication receipts are unavailable right now.");
    expect(api.from).not.toHaveBeenCalled();
  });

  it("does not expose native error details or infer success from receipts beside an error", async () => {
    api.rpc.mockResolvedValue({ ...response([receipt()]), error: { message: "PRIVATE_RPC_ERROR", code: "42501" } });
    await expect(loadStudioPublicationReceipts(tenant, session, page)).rejects.toThrow("Publication receipts are unavailable right now.");
  });

  it("turns a thrown transport failure into the same private-data-free refusal", async () => {
    api.rpc.mockRejectedValue(new Error("PRIVATE_TRANSPORT_VALUE private@example.invalid"));
    await expect(loadStudioPublicationReceipts(tenant, session, page)).rejects.toBeInstanceOf(Said);
    await expect(loadStudioPublicationReceipts(tenant, session, page)).rejects.toThrow("Publication receipts are unavailable right now.");
  });

  it("omits malformed receipt entries without losing a valid neighboring receipt", async () => {
    api.rpc.mockResolvedValue(response([receipt(), null, false, [], "not-a-receipt"]));
    expect(await loadStudioPublicationReceipts(tenant, session, page)).toEqual([{ id: receiptId(41), occurredAt: occurred, action: "publish", outcome: "succeeded" }]);
  });

  it("omits unsupported action/outcome names and non-receipt IDs", async () => {
    api.rpc.mockResolvedValue(response([receipt({ capability_key: "growth_form_publish" }), receipt({ capability_key: "growth_page.publish" }), receipt({ outcome: "published" }), receipt({ outcome: "approved" }), receipt({ id: "page-status-is-not-a-receipt" })]));
    expect(await loadStudioPublicationReceipts(tenant, session, page)).toEqual([]);
  });

  it("does not accept inherited object names as native outcome categories", async () => {
    api.rpc.mockResolvedValue(response([receipt({ outcome: "constructor" }), receipt({ outcome: "toString" }), receipt({ outcome: "__proto__" })]));
    expect(await loadStudioPublicationReceipts(tenant, session, page)).toEqual([]);
  });

  it("does not leak private annotations through permissively parseable timestamps", async () => {
    api.rpc.mockResolvedValue(response([receipt({ occurred_at: "2026-11-13 (private@example.invalid)" }), receipt({ occurred_at: "2026-11-13 (token=PRIVATE_TOKEN)" }), receipt({ occurred_at: "not-a-date" })]));
    expect(await loadStudioPublicationReceipts(tenant, session, page)).toEqual([]);
  });
});
