import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PORTAL_AGREEMENTS_LOAD_ERROR,
  PORTAL_AGREEMENTS_REFRESH_ERROR,
  fetchSignedCopy,
  isMultipleRelationships,
  openAgreementForSigning,
  parseAgreementsPage,
  signedCopyFilename,
  useClientPortalAgreements,
  type ClientPortalAgreementsState,
} from "./useClientPortalAgreements";

const f = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  getUser: vi.fn(),
  authListener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => f.rpc(...args),
    functions: { invoke: (...args: unknown[]) => f.invoke(...args) },
    auth: {
      getUser: () => f.getUser(),
      onAuthStateChange: (cb: typeof f.authListener) => {
        f.authListener = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Synthetic test tenants (Northwind Studio and a second business); never real accounts.
const T = "e0923000-0000-4000-8000-000000000002";
const T2 = "e0923000-0000-4000-8000-000000000009";
const A1 = "e0923000-0000-4000-9000-000000000001";
const A2 = "e0923000-0000-4000-9000-000000000002";
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: "Website build agreement", engagement_title: "Website build", state: "awaiting_you", sent_at: "2026-10-10T12:00:00Z",
  completed_at: null, expires_at: "2026-11-01T12:00:00Z", can_sign: true, can_download: false, sign_note: null, ...extra,
});
const payload = (agreements: unknown[], extra: Record<string, unknown> = {}) => ({
  tenant_id: T, business_name: "Northwind Studio", server_now: "2026-10-18T12:00:00Z",
  summary: { awaiting_you: 1, signed: 0 }, agreements, has_more: false, ...extra,
});
const ok = (data: unknown) => ({ data, error: null });
const TOKEN = "a".repeat(64);

let root: Root, host: HTMLDivElement;
let state: ClientPortalAgreementsState;
function Probe() { state = useClientPortalAgreements(); return null; }
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const mount = async () => { await act(async () => root.render(<Probe />)); await flush(); };
const reads = () => f.rpc.mock.calls.filter((c) => c[0] === "client_portal_agreements");

beforeEach(() => {
  vi.clearAllMocks();
  f.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  f.rpc.mockResolvedValue(ok(payload([row(A1), row(A2, { state: "signed", can_sign: false, can_download: true, completed_at: "2026-10-12T12:00:00Z" })])));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("parseAgreementsPage — exact keys, fail closed", () => {
  it("accepts the promised shape and returns null for no relationship", () => {
    expect(parseAgreementsPage(null)).toBeNull();
    const page = parseAgreementsPage(payload([row(A1)]))!;
    expect(page.business_name).toBe("Northwind Studio");
    expect(page.agreements[0]).toMatchObject({ id: A1, state: "awaiting_you", can_sign: true, engagement_title: "Website build" });
  });

  it("refuses a row or root that carries any other key, or misses one", () => {
    for (const leak of ["body", "token_hash", "signer_email", "amount", "sealed_storage_key", "offer_id"]) {
      expect(() => parseAgreementsPage(payload([row(A1, { [leak]: "x" })])), leak).toThrow();
    }
    const { sign_note: _drop, ...missing } = row(A1);
    expect(() => parseAgreementsPage(payload([missing]))).toThrow();
    expect(() => parseAgreementsPage({ ...payload([row(A1)]), events: [] })).toThrow();
    expect(() => parseAgreementsPage(payload([row(A1)], { summary: { awaiting_you: 1, signed: 0, total: 1 } }))).toThrow();
  });

  it("never draws a button the server would refuse: can_sign only while waiting, download only when signed", () => {
    expect(() => parseAgreementsPage(payload([row(A1, { state: "expired" })]))).toThrow();
    expect(() => parseAgreementsPage(payload([row(A1, { sign_note: "use_email_link" })]))).toThrow();
    expect(() => parseAgreementsPage(payload([row(A1, { can_sign: false, can_download: true })]))).toThrow();
    expect(() => parseAgreementsPage(payload([row(A1, { state: "dreaming", can_sign: false })]))).toThrow();
    expect(() => parseAgreementsPage(payload([row(A1, { sign_note: "call_us", can_sign: false })]))).toThrow();
    expect(() => parseAgreementsPage(payload([row(A1), row(A1)]))).toThrow();
    expect(() => parseAgreementsPage(payload([row("not-a-uuid")]))).toThrow();
  });

  it("accepts the states and notes that keep the page honest, and a note only where it means something", () => {
    const page = parseAgreementsPage(payload([
      row(A1, { state: "awaiting_signature", can_sign: false, sign_note: "use_email_link" }),
      row(A2, { state: "awaiting_countersign", can_sign: false }),
    ]))!;
    expect(page.agreements.map((a) => a.state)).toEqual(["awaiting_signature", "awaiting_countersign"]);
    for (const note of ["link_expired", "link_revoked", "use_email_link"]) {
      expect(parseAgreementsPage(payload([row(A1, { can_sign: false, sign_note: note })]))!.agreements[0].sign_note).toBe(note);
    }
    // A note on a row that waits on nobody's signature has no meaning; it is refused, not shown.
    expect(() => parseAgreementsPage(payload([row(A1, { state: "signed", can_sign: false, sign_note: "link_expired" })]))).toThrow();
  });
});

describe("useClientPortalAgreements", () => {
  it("reads once on mount, unpinned, then pins the business the server answered for", async () => {
    await mount();
    expect(reads()[0][1]).toEqual({ p_tenant_id: null, p_limit: 50 });
    expect(state.loading).toBe(false);
    expect(state.tenantId).toBe(T);
    expect(state.businessName).toBe("Northwind Studio");
    expect(state.agreements.map((a) => a.id)).toEqual([A1, A2]);
    await act(async () => { await state.refresh(); });
    expect(reads()[1][1]).toEqual({ p_tenant_id: T, p_limit: 50 });
  });

  it("never shows a later answer for another business", async () => {
    await mount();
    f.rpc.mockResolvedValue(ok(payload([row(A1)], { tenant_id: T2, business_name: "Other Co" })));
    await act(async () => { await state.refresh(); });
    expect(state.businessName).toBe("Northwind Studio");
    expect(state.error).toBe(PORTAL_AGREEMENTS_REFRESH_ERROR);
  });

  it("resolves no relationship as unavailable (the page then shows the platform terms)", async () => {
    f.rpc.mockResolvedValue(ok(null));
    await mount();
    expect(state.unavailable).toBe(true);
    expect(state.agreements).toEqual([]);
  });

  it("stops asking once the server refuses an account linked to several businesses", async () => {
    f.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "select an authorized customer relationship" } });
    await mount();
    expect(state.multipleBusinesses).toBe(true);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(reads()).toHaveLength(1);
  });

  it("confirms the caller is a customer only once a list came back", async () => {
    f.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function public.client_portal_agreements" } });
    await mount();
    // A failed read says nothing about who this is: not unavailable, not a customer either.
    expect(state.customerConfirmed).toBe(false);
    expect(state.unavailable).toBe(false);
    expect(state.multipleBusinesses).toBe(false);
    await act(async () => { await state.refresh(); });
    expect(state.customerConfirmed).toBe(true);
    f.rpc.mockResolvedValueOnce(ok(null));
    await act(async () => { await state.refresh(); });
    expect(state.customerConfirmed).toBe(false);
    expect(state.unavailable).toBe(true);
  });

  it("does not read a permission refusal as 'more than one business'", async () => {
    const denied = { code: "42501", message: "permission denied for function client_portal_agreements" };
    expect(isMultipleRelationships(denied)).toBe(false);
    expect(isMultipleRelationships({ code: "42501", message: "customer authentication required" })).toBe(false);
    expect(isMultipleRelationships({ code: "42501", message: "select an authorized customer relationship" })).toBe(true);
    f.rpc.mockResolvedValueOnce({ data: null, error: denied });
    await mount();
    expect(state.multipleBusinesses).toBe(false);
    expect(state.customerConfirmed).toBe(false);
    expect(state.error).toBe(PORTAL_AGREEMENTS_LOAD_ERROR);
  });

  it("says load on a first failure, and refresh — keeping the list — on a later one", async () => {
    f.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST000", message: "network" } });
    await mount();
    expect(state.error).toBe(PORTAL_AGREEMENTS_LOAD_ERROR);
    await act(async () => { await state.refresh(); });
    expect(state.error).toBeNull();
    f.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST000", message: "network" } });
    await act(async () => { await state.refresh(); });
    expect(state.error).toBe(PORTAL_AGREEMENTS_REFRESH_ERROR);
    expect(state.agreements).toHaveLength(2);
    // A widened projection is a failed read, never a shown one.
    f.rpc.mockResolvedValueOnce(ok(payload([row(A1, { body: "the whole contract" })])));
    await act(async () => { await state.refresh(); });
    expect(state.error).toBe(PORTAL_AGREEMENTS_REFRESH_ERROR);
  });

  it("re-reads when the window regains focus and when the tab becomes visible (back from signing)", async () => {
    await mount();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(reads()).toHaveLength(2);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(reads()).toHaveLength(3);
  });

  it("clears everything and re-reads, unpinned, when the signed-in person changes", async () => {
    await mount();
    expect(state.scopeEpoch).toBe(0);
    f.rpc.mockReturnValue(new Promise(() => {}));
    await act(async () => { f.authListener!("SIGNED_IN", { user: { id: "u2" } }); });
    expect(state.agreements).toEqual([]);
    expect(state.tenantId).toBeNull();
    expect(state.loading).toBe(true);
    expect(state.scopeEpoch).toBe(1);
    await flush();
    expect(reads().at(-1)![1]).toEqual({ p_tenant_id: null, p_limit: 50 });
    await act(async () => { f.authListener!("SIGNED_OUT", null); });
    expect(state.unavailable).toBe(true);
  });
});

describe("openAgreementForSigning", () => {
  it("returns the link only when the server sent a well-formed token and deadline", async () => {
    f.rpc.mockResolvedValueOnce(ok({ ok: true, token: TOKEN, expires_at: "2026-11-01T12:00:00Z" }));
    expect(await openAgreementForSigning(A1, T)).toEqual({ ok: true, token: TOKEN, expiresAt: "2026-11-01T12:00:00Z" });
    expect(f.rpc).toHaveBeenLastCalledWith("client_portal_open_agreement_signing", { p_agreement_id: A1, p_tenant_id: T });
    for (const bad of [{ ok: true, token: "short", expires_at: "2026-11-01T12:00:00Z" }, { ok: true, token: TOKEN }, { ok: true, token: TOKEN, expires_at: "2026-11-01T12:00:00Z", extra: 1 }, "yes", null]) {
      f.rpc.mockResolvedValueOnce(ok(bad));
      expect(await openAgreementForSigning(A1, T), JSON.stringify(bad)).toEqual({ ok: false, code: "FAILED" });
    }
  });

  it("passes the server's refusal codes through, and classifies the rest", async () => {
    for (const code of ["CLIENT_AGREEMENT_UNAVAILABLE", "NOT_SIGNABLE", "TRY_AGAIN_LATER"]) {
      f.rpc.mockResolvedValueOnce(ok({ ok: false, error: code }));
      expect(await openAgreementForSigning(A1, T)).toEqual({ ok: false, code });
    }
    // "Not here" carries why, so the page never points at a dead link; an unknown or missing reason reads as the
    // one that is true in every case.
    for (const [note, expected] of [["link_expired", "link_expired"], ["link_revoked", "link_revoked"], ["use_email_link", "use_email_link"], ["call_us", "use_email_link"], [undefined, "use_email_link"]]) {
      f.rpc.mockResolvedValueOnce(ok({ ok: false, error: "NOT_SIGNABLE_HERE", ...(note ? { note } : {}) }));
      expect(await openAgreementForSigning(A1, T), String(note)).toEqual({ ok: false, code: "NOT_SIGNABLE_HERE", note: expected });
    }
    f.rpc.mockResolvedValueOnce(ok({ ok: false, error: "SOMETHING_NEW" }));
    expect(await openAgreementForSigning(A1, T)).toEqual({ ok: false, code: "FAILED" });
    f.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "select an authorized customer relationship" } });
    expect(await openAgreementForSigning(A1, T)).toEqual({ ok: false, code: "MULTIPLE_BUSINESSES" });
    f.rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await openAgreementForSigning(A1, T)).toEqual({ ok: false, code: "FAILED" });
  });
});

describe("fetchSignedCopy", () => {
  it("asks the portal door, with the pinned business, attachment only for a download", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    f.invoke.mockResolvedValue({ data: blob, error: null });
    expect(await fetchSignedCopy(A1, T, true)).toEqual({ ok: true, blob });
    expect(f.invoke).toHaveBeenLastCalledWith(`agreement-document?portal=1&agreementId=${A1}&tenantId=${T}&download=1`, { method: "GET" });
    await fetchSignedCopy(A1, null, false);
    expect(f.invoke).toHaveBeenLastCalledWith(`agreement-document?portal=1&agreementId=${A1}`, { method: "GET" });
  });

  it("is a failure unless bytes actually arrived", async () => {
    for (const answer of [{ data: { error: "Not available" }, error: null }, { data: new Blob([]), error: null }, { data: null, error: { message: "403" } }]) {
      f.invoke.mockResolvedValueOnce(answer);
      expect(await fetchSignedCopy(A1, T, true)).toEqual({ ok: false });
    }
    f.invoke.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchSignedCopy(A1, T, true)).toEqual({ ok: false });
  });

  it("names the saved file after the agreement, without path or control characters", () => {
    expect(signedCopyFilename("Website build agreement")).toBe("Website build agreement (signed).pdf");
    expect(signedCopyFilename("../../etc/passwd\n")).toBe("etcpasswd (signed).pdf");
    expect(signedCopyFilename("***")).toBe("agreement (signed).pdf");
  });
});
