// The client-agreements adapter, EXECUTED — not grepped.
//
// `sales-ops.contract.test.tsx` mocks this hook outright so it can prove the SURFACE. That leaves
// the query shape unproven, so this file drives the REAL hook against a client that RECORDS what it
// was asked for. A dropped tenant filter, a renamed column, a swallowed error, a draft that forgets
// which workspace it was opened in, or a readable flag modelled on the wrong signal turns it red.
//
// The pattern and its reason come from the sibling file: a static `toContain("clients")` passes
// whatever the columns are called and whatever the filter is, so it proves nothing that matters.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Call = { table: string; select: string; eq: Array<[string, unknown]>; single: boolean; limit: number | null };
type Rpc = { fn: string; args: Record<string, unknown> };

const calls: Call[] = [];
const rpcs: Rpc[] = [];
let results: Record<string, { data: unknown; error: unknown }> = {};
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
let rpcOverride: (() => Promise<{ data: unknown; error: unknown }>) | null = null;
let tenant: { activeTenantId: string | null; accountContextLoading: boolean };
let currentUserId: string | null;

function makeChain(table: string) {
  const call: Call = { table, select: "", eq: [], single: false, limit: null };
  const chain: Record<string, unknown> = {};
  const settle = () => results[table] ?? { data: [], error: null };
  chain.select = (cols: string) => { call.select = cols; calls.push(call); return chain; };
  chain.eq = (k: string, v: unknown) => { call.eq.push([k, v]); return chain; };
  chain.order = () => chain;
  chain.limit = (n: number) => { call.limit = n; return chain; };
  chain.maybeSingle = () => { call.single = true; return Promise.resolve(settle()); };
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(settle()).then(resolve, reject);
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeChain(table),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return rpcOverride ? rpcOverride() : Promise.resolve(rpcResult);
    },
    auth: { getUser: async () => ({ data: { user: currentUserId ? { id: currentUserId } : null } }) },
  },
}));

vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => tenant }));

const { useSoloAgreements } = await import("./useSoloAgreements");

let host: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useSoloAgreements> | null = null;
const renders: Array<ReturnType<typeof useSoloAgreements>> = [];

function Probe() {
  latest = useSoloAgreements();
  renders.push(latest);
  return null;
}

async function run() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<Probe />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const call = (table: string) => calls.find((c) => c.table === table);

const AGREEMENT_ROW = {
  id: "a1",
  contact_id: "c1",
  offer_id: "o1",
  title: null,
  notes: "Renewed after the pilot",
  term_kind: "recurring",
  billing_interval: "month",
  interval_count: 1,
  installments_total: null,
  payment_schedule: null,
  price_basis: "negotiated",
  agreed_amount_minor: 250000,
  agreed_currency: "usd",
  catalog_price_snapshot_minor: 300000,
  catalog_price_snapshot_currency: "usd",
  catalog_price_snapshot_at: "2026-09-01T10:00:00Z",
  starts_on: "2026-09-01",
  renews_on: "2026-10-01",
  ends_on: null,
  status: "active",
  updated_at: "2026-09-01T10:00:00Z",
};

// The picker reads each contact's primary email through its contact methods, filtered to it.
const CLIENT_ROWS = [
  { id: "c1", first_name: "Jordan", last_name: "Avery", entity_name: null, entity_type: null, client_contact_methods: [{ id: "m1", kind: "email", value: "j@example.test", label: null, is_primary: true, position: 0 }] },
  { id: "c2", first_name: null, last_name: null, entity_name: "Meridian Advisory", entity_type: "llc", client_contact_methods: [] },
  { id: "c3", first_name: null, last_name: null, entity_name: null, entity_type: null, client_contact_methods: [{ id: "m3", kind: "email", value: "only-an-address@example.test", label: "Work", is_primary: true, position: 0 }] },
];

beforeEach(() => {
  rpcOverride = null;
  calls.length = 0;
  rpcs.length = 0;
  renders.length = 0;
  latest = null;
  currentUserId = "user-1";
  tenant = { activeTenantId: "tenant-1", accountContextLoading: false };
  rpcResult = { data: { id: "a1" }, error: null };
  results = {
    tenant_client_agreements: { data: [AGREEMENT_ROW], error: null },
    clients: { data: CLIENT_ROWS, error: null },
    tenant_members: { data: { role: "owner" }, error: null },
  };
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("useSoloAgreements — what it actually asks the database for", () => {
  it("scopes EVERY read to the active tenant", async () => {
    await run();
    // Not one of these is redundant with RLS. `is_platform_owner()` is a disjunct in both the
    // restrictive isolation policy on `clients` and in `clients_admins_full`, so an operator
    // acting inside a tenant would otherwise be offered every client on the platform.
    for (const table of ["tenant_client_agreements", "clients", "tenant_members"]) {
      expect(call(table)?.eq, `${table} must be tenant-scoped`).toContainEqual(["tenant_id", "tenant-1"]);
    }
  });

  it("asks for the client columns the canonical display name is built from", async () => {
    await run();
    const select = call("clients")?.select ?? "";
    // `entity_type` and the email are NOT droppable. `clientName()` uses entity_type for the
    // business-vs-person precedence and the email as the last-resort fallback, so dropping either
    // makes Sales render a different name than Clients for the same row (§57).
    for (const column of ["id", "first_name", "last_name", "entity_name", "entity_type", "client_contact_methods("]) {
      expect(select).toContain(column);
    }
    // The email is the contact's PRIMARY address from its contact methods — never the retired
    // `clients.email` column — and the embed is narrowed to exactly that one address.
    expect(select).not.toMatch(/(^|,)\s*email\s*(,|$)/);
    expect(call("clients")?.eq).toContainEqual(["client_contact_methods.kind", "email"]);
    expect(call("clients")?.eq).toContainEqual(["client_contact_methods.is_primary", true]);
    // And nothing beyond identity. A picker has no business reading phone, address or notes.
    for (const forbidden of ["phone", "street_address", "current_notes", "funding_goal", "lead_score"]) {
      expect(select).not.toContain(forbidden);
    }
  });

  it("composes the display name by the same precedence the Clients surface uses", async () => {
    await run();
    const names = latest!.clients.map((c) => c.name);
    // A person with no company keeps their own name; a company row with an entity_type shows the
    // company. Diverging from `useTenantRelationshipsData.clientName` here is the §57 defect.
    expect(names).toEqual(["Jordan Avery", "Meridian Advisory", "only-an-address@example.test"]);
  });

  it("reads the agreement row back without inventing a figure", async () => {
    await run();
    const row = latest!.agreements[0];
    expect(row.agreedAmountMinor).toBe(250000);
    expect(row.agreedCurrency).toBe("usd");
    // The snapshot is carried separately and never merged into the agreed figure — the whole
    // point of the pair is that they can differ.
    expect(row.catalogSnapshotMinor).toBe(300000);
    expect(row.status).toBe("active");
  });

  it("NAMES a status this build cannot read instead of coercing it to a state", async () => {
    results.tenant_client_agreements = { data: [{ ...AGREEMENT_ROW, status: "renegotiating" }], error: null };
    await run();
    // Coercing to "draft" would assert a commercial state the record does not prove.
    expect(latest!.agreements[0].status).toBe("unrecognised");
  });

  it("derives clientsReadable from AUTHORITY, because a denied read is not an error", async () => {
    // THE SHIPPED LESSON, one table over. `clients` GRANTs SELECT to authenticated and gates on
    // RLS, and RLS FILTERS ROWS — a plain member gets 200, [], and NO error. This fixture is
    // therefore the real denial shape; `{error: {code: "42501"}}` is an input this configuration
    // cannot produce, and writing the test that way is how the same flag shipped unreachable on
    // `ordersReadable`.
    results.clients = { data: [], error: null };
    results.tenant_members = { data: { role: "member" }, error: null };
    await run();
    expect(latest!.canManage).toBe(false);
    expect(latest!.clientsReadable).toBe(false);
    expect(latest!.clients).toEqual([]);
  });

  it("does not tell a caller who CAN see rows that their successful read failed", async () => {
    // A coach satisfies `clients_coaches_assigned` without holding a tenant_members admin role.
    // Authority alone would mark this unreadable while rows are visibly present.
    results.tenant_members = { data: { role: "coach" }, error: null };
    await run();
    expect(latest!.canManage).toBe(false);
    expect(latest!.clientsReadable).toBe(true);
  });

  it("sends the draft's OWN workspace as the expected tenant, never the current one", async () => {
    await run();
    await act(async () => {
      await latest!.saveAgreement({
        tenantId: "tenant-OPENED-IN",
        id: null,
        contactId: "c1",
        offerId: "o1",
        termKind: "recurring",
        priceBasis: "negotiated",
        catalogPriceId: null,
        agreedAmountMinor: 250000,
        agreedCurrency: "usd",
        billingInterval: "month",
        intervalCount: 1,
        installmentsTotal: null,
        paymentSchedule: null,
        startsOn: "2026-09-01",
        renewsOn: null,
        endsOn: null,
        title: null,
        notes: null,
        expectedUpdatedAt: null,
      });
    });
    const sent = rpcs.find((r) => r.fn === "save_client_agreement");
    expect(sent).toBeTruthy();
    // If this ever becomes `activeTenantId`, the server's refusal guard can never fire — the
    // caller would keep agreeing with itself. That exact mistake shipped once on save_solo_offer.
    expect(sent!.args._expected_tenant_id).toBe("tenant-OPENED-IN");
    expect(sent!.args._contact_id).toBe("c1");
    expect(sent!.args._offer_id).toBe("o1");
  });

  it("never sends a catalog AMOUNT — only an id the server resolves itself", async () => {
    await run();
    await act(async () => {
      await latest!.saveAgreement({
        tenantId: "tenant-1", id: null, contactId: "c1", offerId: "o1",
        termKind: "one_time", priceBasis: "catalog", catalogPriceId: "price-1",
        agreedAmountMinor: null, agreedCurrency: null, billingInterval: null, intervalCount: null,
        installmentsTotal: null, paymentSchedule: null, startsOn: "2026-09-01",
        renewsOn: null, endsOn: null, title: null, notes: null, expectedUpdatedAt: null,
      });
    });
    const sent = rpcs.find((r) => r.fn === "save_client_agreement")!;
    expect(sent.args._catalog_price_id).toBe("price-1");
    // There is no parameter through which a browser could state what the catalog charged. The
    // server reads it off tenant_prices, which is what makes the snapshot evidence.
    expect(Object.keys(sent.args)).not.toContain("_catalog_amount_minor");
    expect(Object.keys(sent.args)).not.toContain("_catalog_price_snapshot_minor");
  });

  it("reports a concurrent write as STALE, so the surface offers reload and not retry", async () => {
    await run();
    rpcResult = { data: null, error: { code: "40001", message: "someone else changed this agreement" } };
    let outcome: { ok: boolean; stale?: boolean } | null = null;
    await act(async () => {
      outcome = await latest!.setAgreementStatus("a1", "active", "2026-09-01T10:00:00Z", "tenant-1");
    });
    expect(outcome!.ok).toBe(false);
    // Retrying a 40001 would overwrite whoever else saved. The flag is what stops the surface
    // offering that.
    expect(outcome!.stale).toBe(true);
  });

  it("keeps agreement readability separate from client readability — the coach case", async () => {
    // A coach satisfies `clients_coaches_assigned` on their ASSIGNED clients, so the client read
    // succeeds. The agreements read is row-filtered to that same subset, so it can legitimately
    // come back empty while the workspace holds twelve. Proxying one flag off the other tells that
    // coach "Nothing recorded yet" — a definite claim about rows they were never shown.
    results.tenant_members = { data: { role: "coach" }, error: null };
    results.tenant_client_agreements = { data: [], error: null };
    await run();
    expect(latest!.clientsReadable).toBe(true);
    expect(latest!.agreementsReadable).toBe(false);
  });

  it("sends the tenant the ROW was loaded against when changing its state", async () => {
    await run();
    await act(async () => {
      await latest!.setAgreementStatus("a1", "paused", null, "tenant-LOADED-AGAINST");
    });
    const sent = rpcs.find((r) => r.fn === "set_client_agreement_status")!;
    // If this becomes `activeTenantId`, the server's refusal guard can never fire.
    expect(sent.args._expected_tenant_id).toBe("tenant-LOADED-AGAINST");
  });

  it("refuses to read anything at all without a resolved workspace", async () => {
    tenant = { activeTenantId: null, accountContextLoading: false };
    await run();
    expect(latest!.phase).toBe("unavailable");
    expect(calls).toHaveLength(0);
  });

  it("shows the NEW workspace as loading on the switch paint, never the old one's amounts", async () => {
    await run();
    expect(latest!.agreements).toHaveLength(1);
    // `switchTenant` changes activeTenantId IN PLACE without remounting, and setState inside the
    // effect runs after paint. Without the synchronous guard this paint would render the previous
    // workspace's client names bound to its negotiated amounts.
    tenant = { activeTenantId: "tenant-2", accountContextLoading: false };
    // The FIRST paint after the switch is the one under test. `act()` flushes effects before it
    // returns, so the LAST render already reflects the corrected state — reading that would assert
    // nothing about the guard, which is precisely the frame the guard exists for.
    renders.length = 0;
    await act(async () => { root.render(<Probe />); });
    const switchPaint = renders[0];
    expect(switchPaint.tenantId).toBe("tenant-2");
    expect(switchPaint.phase).toBe("loading");
    expect(switchPaint.agreements).toHaveLength(0);
    expect(switchPaint.clients).toHaveLength(0);
  });

  it("treats a failed agreement read as an error, not as an empty book", async () => {
    results.tenant_client_agreements = { data: null, error: { message: "boom" } };
    await run();
    expect(latest!.phase).toBe("error");
    expect(latest!.agreements).toEqual([]);
  });
});


describe("write interruption and safe failure", () => {
  it("contains rejected transport errors without exposing internal details", async () => {
    await run();
    rpcOverride = async () => { throw new Error("private_table secret_payload"); };
    let outcome: { ok: boolean; message?: string } | undefined;
    await act(async () => { outcome = await latest!.setAgreementStatus("a1", "paused", null, "tenant-1"); });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain("Refresh");
    expect(outcome?.message).not.toMatch(/private_table|secret_payload/);
  });

  it("does not refresh or report success for a write completed after a workspace round trip", async () => {
    await run();
    let settle!: (value: { data: unknown; error: unknown }) => void;
    rpcOverride = () => new Promise((resolve) => { settle = resolve; });
    const pending = latest!.setAgreementStatus("a1", "paused", null, "tenant-1");
    tenant = { activeTenantId: "tenant-2", accountContextLoading: false };
    await act(async () => { root.render(<Probe />); });
    tenant = { activeTenantId: "tenant-1", accountContextLoading: false };
    await act(async () => { root.render(<Probe />); });
    const readsBefore = calls.length;
    let outcome: { ok: boolean; message?: string } | undefined;
    await act(async () => { settle({ data: { id: "old-result" }, error: null }); outcome = await pending; });
    expect(outcome?.ok).toBe(false);
    expect(calls.length).toBe(readsBefore);
    expect(outcome).not.toHaveProperty("result");
  });

  it("clears records and authority on the first resolving render even when the tenant id remains", async () => {
    await run();
    renders.length = 0;
    tenant = { activeTenantId: "tenant-1", accountContextLoading: true };
    await act(async () => { root.render(<Probe />); });
    expect(renders[0].phase).toBe("resolving");
    expect(renders[0].canManage).toBe(false);
    expect(renders[0].agreements).toEqual([]);
  });
});


it("does not treat an empty write response as confirmation", async () => {
  await run();
  rpcResult = { data: null, error: null };
  let outcome: { ok: boolean; message?: string } | undefined;
  await act(async () => { outcome = await latest!.setAgreementStatus("a1", "paused", null, "tenant-1"); });
  expect(outcome?.ok).toBe(false);
  expect(outcome?.message).toContain("could not be confirmed");
});


it("contains an agreement-save rejection and withholds a late successful agreement save", async () => {
  await run();
  const draft = {
    tenantId: "tenant-1", id: null, contactId: "c1", offerId: "o1",
    termKind: "one_time" as const, priceBasis: "catalog" as const, catalogPriceId: "price-1",
    agreedAmountMinor: null, agreedCurrency: null, billingInterval: null, intervalCount: null,
    installmentsTotal: null, paymentSchedule: null, startsOn: "2026-09-01",
    renewsOn: null, endsOn: null, title: null, notes: null, expectedUpdatedAt: null,
  };
  rpcOverride = async () => { throw new Error("private document contents"); };
  let rejected: { ok: boolean; message?: string } | undefined;
  await act(async () => { rejected = await latest!.saveAgreement(draft); });
  expect(rejected?.ok).toBe(false);
  expect(rejected?.message).toContain("could not be confirmed");
  expect(rejected?.message).not.toContain("private document");
  let settle!: (value: { data: unknown; error: unknown }) => void;
  rpcOverride = () => new Promise((resolve) => { settle = resolve; });
  const pending = latest!.saveAgreement(draft);
  tenant = { activeTenantId: "tenant-2", accountContextLoading: false };
  await act(async () => { root.render(<Probe />); });
  const readsBefore = calls.length;
  let outcome: { ok: boolean } | undefined;
  await act(async () => { settle({ data: { id: "old-result" }, error: null }); outcome = await pending; });
  expect(outcome?.ok).toBe(false);
  expect(outcome).not.toHaveProperty("result");
  expect(calls.length).toBe(readsBefore);
});
