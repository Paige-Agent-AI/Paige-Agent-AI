// The adapter, EXECUTED — not grepped.
//
// WHY THIS FILE EXISTS. `catalog-offers.contract.test.tsx` mocks `useCatalogOffers` outright, so
// every claim it makes about the read is a `toContain` over the adapter's own source. An
// adversarial review of the pushed diff proved what that can miss: the membership read asked for
// `tenant_members.tenant_role`, but the COLUMN is `role` (`tenant_role` is the enum type's name).
// PostgREST would have answered 42703, the error was not triaged, and `canManage` would have been
// `false` for every owner in every tenant — silently, while 24 tests stayed green and `tsc` stayed
// clean, because a `toContain("tenant_members")` passes whatever the column is called.
//
// So this file drives the real hook against a fake client that RECORDS the query it was given, and
// asserts the query shape and the resolved authority. A column rename, a dropped filter, or a
// swallowed error turns it red.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Call = { table: string; select: string; eq: Array<[string, unknown]>; single: boolean; orders: string[]; filter?: [string,string,string]; range?: number[]; ilike?: [string,string]; inside?: [string,readonly string[]] };

const calls: Call[] = [];
/** Per-table canned results, keyed by table name. */
let results: Record<string, { data: unknown; error: unknown }> = {};
let tenant: { activeTenantId: string | null; accountContextLoading: boolean };
let currentUserId: string | null;
let mutationResult: {data:unknown;error:{message:string;code?:string}|null}={data:{},error:null};
const subscriptions: Array<{filter:string;table:string;event:string;callback:()=>void}>=[];
const removedChannels: unknown[]=[];
let options: import("./useCatalogOffers").CatalogOffersOptions | undefined;
let respond: ((call: Call) => unknown) | null = null;

function makeChain(table: string) {
  const call: Call = { table, select: "", eq: [], single: false, orders: [] };
  const chain: Record<string, unknown> = {};
  const settle = () => respond?.(call) ?? results[table] ?? { data: [], error: null };
  chain.select = (cols: string) => { call.select = cols; calls.push(call); return chain; };
  chain.eq = (k: string, v: unknown) => { call.eq.push([k, v]); return chain; };
  chain.order = (column: string) => { call.orders.push(column); return chain; };
  chain.filter = (column: string, operator: string, value: string) => { call.filter = [column, operator, value]; return chain; };
  chain.range = (from: number,to: number) => { call.range = [from,to]; return chain; };
  chain.ilike = (column: string,value: string) => { call.ilike = [column,value]; return chain; };
  chain.in = (column: string,value: readonly string[]) => { call.inside = [column,value]; return chain; };
  chain.limit = () => chain;
  chain.maybeSingle = () => { call.single = true; return Promise.resolve(settle()); };
  // Awaiting the chain itself resolves the query, as supabase-js does.
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(settle()).then(resolve, reject);
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeChain(table),
    rpc: async()=>mutationResult,
    channel:()=>{const channel={on:(_kind:string,config:{filter:string;table:string;event:string},callback:()=>void)=>{subscriptions.push({...config,callback});return channel},subscribe:()=>channel};return channel},
    removeChannel:async(channel:unknown)=>{removedChannels.push(channel)},
    auth: { getUser: async () => ({ data: { user: currentUserId ? { id: currentUserId } : null } }) },
  },
}));

vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => tenant }));

const { useCatalogOffers } = await import("./useCatalogOffers");

let host: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useCatalogOffers> | null = null;
const renders: Array<ReturnType<typeof useCatalogOffers>> = [];

function Probe() {
  latest = useCatalogOffers(options);
  // Every render is recorded, not only the last one. `act()` flushes effects before it returns, so
  // a single `latest` read after `act` reflects the state the effect already corrected — which is
  // exactly the paint a synchronous-guard test needs to inspect. The first version of this guard
  // read `latest` and passed with the defect reintroduced.
  renders.push(latest);
  return null;
}

async function run() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<Probe />); });
  // let the async effect settle
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const call = (table: string) => calls.find((c) => c.table === table);

beforeEach(() => {
  options = undefined;
  subscriptions.length=0;removedChannels.length=0;mutationResult={data:{},error:null};
  respond = null;
  calls.length = 0;
  renders.length = 0;
  latest = null;
  currentUserId = "user-1";
  tenant = { activeTenantId: "tenant-1", accountContextLoading: false };
  results = {
    tenant_products: { data: [], error: null },
    tenant_prices: { data: [], error: null },
    tenant_members: { data: { role: "owner" }, error: null },
  };
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("useCatalogOffers — the query it actually issues", () => {
  it("asks tenant_members for the column that exists, scoped to the caller and an active seat", async () => {
    await run();
    const members = call("tenant_members");
    expect(members).toBeDefined();
    // `role` is the column. `tenant_role` is the ENUM TYPE — asking for it returns 42703.
    expect(members!.select).toBe("role");
    expect(members!.select).not.toContain("tenant_role");
    expect(members!.eq).toEqual(
      expect.arrayContaining([["tenant_id", "tenant-1"], ["user_id", "user-1"], ["status", "active"]]),
    );
    expect(members!.single).toBe(true);
  });

  it("scopes the offer and price reads to the resolved tenant", async () => {
    await run();
    expect(call("tenant_products")!.eq).toEqual([["tenant_id", "tenant-1"]]);
    expect(call("tenant_prices")!.eq).toEqual([["tenant_id", "tenant-1"]]);
  });

  it("selects the offer columns the surface renders", async () => {
    await run();
    const select = call("tenant_products")!.select;
    for (const column of ["offer_kind", "summary", "delivery_shape", "price_presentation", "customer_action", "category"]) {
      expect(select).toContain(column);
    }
    expect(call("tenant_prices")!.select).toContain("installments_total");
  });
});

describe("useCatalogOffers — resolved authority", () => {
  it("grants manage to an owner", async () => {
    results.tenant_members = { data: { role: "owner" }, error: null };
    await run();
    expect(latest!.canManage).toBe(true);
    expect(latest!.authorityUnknown).toBe(false);
  });

  it("grants manage to an admin", async () => {
    results.tenant_members = { data: { role: "admin" }, error: null };
    await run();
    expect(latest!.canManage).toBe(true);
  });

  it("withholds manage from a plain member", async () => {
    results.tenant_members = { data: { role: "member" }, error: null };
    await run();
    expect(latest!.canManage).toBe(false);
    expect(latest!.authorityUnknown).toBe(false);
  });

  it("does not claim 'you may not edit' when the authority read itself failed", async () => {
    results.tenant_members = { data: null, error: { code: "42703", message: "column does not exist" } };
    await run();
    expect(latest!.canManage).toBe(false);
    // The distinction that matters: unknown is not the same as denied.
    expect(latest!.authorityUnknown).toBe(true);
    // …and the offers still load; a failed authority read must not blank the catalog.
    expect(latest!.phase).toBe("ready");
  });
});

describe("useCatalogOffers — identity and failure", () => {
  it("reads nothing at all until the account context resolves", async () => {
    tenant = { activeTenantId: null, accountContextLoading: true };
    await run();
    expect(latest!.phase).toBe("resolving");
    expect(calls).toHaveLength(0);
  });

  it("reads nothing and reports unavailable when there is no tenant", async () => {
    tenant = { activeTenantId: null, accountContextLoading: false };
    await run();
    expect(latest!.phase).toBe("unavailable");
    expect(calls).toHaveLength(0);
  });

  it("falls back to the base columns only on an undefined-column error", async () => {
    let attempt = 0;
    results.tenant_products = { data: [], error: { code: "42703", message: "column does not exist" } };
    const original = results.tenant_products;
    // Second attempt succeeds with the base shape.
    Object.defineProperty(results, "tenant_products", {
      configurable: true,
      get() { attempt += 1; return attempt === 1 ? original : { data: [], error: null }; },
    });
    await run();
    expect(latest!.phase).toBe("ready");
    expect(latest!.fieldsUnavailable).toBe(true);
    const productReads = calls.filter((c) => c.table === "tenant_products");
    expect(productReads).toHaveLength(2);
    expect(productReads[1].select).not.toContain("offer_kind");
  });

  it("does NOT retry on an undefined-table error — that is a real failure", async () => {
    results.tenant_products = { data: null, error: { code: "42P01", message: 'relation "x" does not exist' } };
    await run();
    expect(latest!.phase).toBe("error");
    expect(calls.filter((c) => c.table === "tenant_products")).toHaveLength(1);
  });
});

describe("useCatalogOffers — what it makes of a row", () => {
  it("never reads product_type as the commercial kind", async () => {
    results.tenant_products = {
      data: [{ id: "o1", name: "Monthly Advisory", status: "active", product_type: "recurring", offer_kind: null }],
      error: null,
    };
    await run();
    const offer = latest!.offers[0];
    expect(offer.billingCadence).toBe("recurring");
    // The record does not say what kind it is, so neither does the adapter.
    expect(offer.kind).toBeNull();
  });

  it("carries the recorded kind through when the tenant stated it", async () => {
    results.tenant_products = {
      data: [{ id: "o1", name: "Fade", status: "active", product_type: "one_time", offer_kind: "service" }],
      error: null,
    };
    await run();
    expect(latest!.offers[0].kind).toBe("service");
  });

  it("says an unreadable status is unread rather than relabelling it a draft", async () => {
    // It used to coerce to "draft". Safe — a draft is shown to nobody — but it ASSERTED a state
    // the record does not prove, which is the same class of lie as a price the record does not
    // prove. A value this build has no reading for now reads as exactly that.
    results.tenant_products = { data: [{ id: "o1", name: "X", status: "nonsense" }], error: null };
    await run();
    expect(latest!.offers[0].availability).toBe("unrecognised");
  });

  it("still claims no conflict for a state it cannot read", async () => {
    // `conflictOf` fires only on "active", so an unreadable state asserts nothing about whether
    // the offer is sellable — which is the point of not calling it a draft OR an active offer.
    results.tenant_products = {
      data: [{ id: "o1", name: "X", status: "future_state", price_presentation: "fixed" }],
      error: null,
    };
    await run();
    expect(latest!.offers[0].availability).toBe("unrecognised");
  });

  it("narrows an unreadable plan kind instead of passing it through raw", async () => {
    // `kind` was the ONE classified field the adapter did not allow-list. An unmapped value reached
    // the surface, produced no sub-label, and fell through to the presentation fallback — printing
    // "Fixed amount" over a per-period figure. Only tenant_prices_kind_check stood in the way: a
    // DATABASE constraint guarding a rendering decision, with nothing linking the two.
    results.tenant_products = { data: [{ id: "o1", name: "X", status: "active" }], error: null };
    results.tenant_prices = {
      data: [
        { id: "p1", product_id: "o1", unit_amount: 9900, kind: "subscription", billing_interval: "month", active: true },
        { id: "p2", product_id: "o1", unit_amount: 9900, kind: "constructor", billing_interval: "month", active: true },
        { id: "p3", product_id: "o1", unit_amount: 9900, kind: "recurring", billing_interval: "month", active: true },
      ],
      error: null,
    };
    await run();
    const kinds = latest!.offers[0].prices.map((p) => p.kind);
    expect(kinds).toEqual([null, null, "recurring"]);
  });

  it("stops showing the previous tenant's offers on the render the tenant changes", async () => {
    // `switchTenant` changes `activeTenantId` IN PLACE for an operator session, and `GrowthHub` is
    // keyed by route rather than tenant, so the hook is NOT remounted. `setState` inside the effect
    // runs after paint, so without a synchronous guard the first render after the switch still
    // returns the previous workspace's `ready` offers — another tenant's names, descriptions and
    // prices under the newly selected workspace, for one paint.
    results.tenant_products = { data: [{ id: "o1", name: "Tenant One Programme", status: "active" }], error: null };
    await run();
    expect(latest!.tenantId).toBe("tenant-1");
    expect(latest!.offers.map((o) => o.name)).toEqual(["Tenant One Programme"]);

    // Re-render under the new tenant and inspect the FIRST render that followed — the single paint
    // between the tenant changing and the effect correcting the state. Reading the final value
    // instead would inspect the already-corrected state and pass either way.
    const before = renders.length;
    tenant = { activeTenantId: "tenant-2", accountContextLoading: false };
    act(() => { root.render(<Probe />); });

    const firstPaint = renders[before];
    expect(firstPaint).toBeDefined();
    expect(firstPaint.tenantId).toBe("tenant-2");
    expect(firstPaint.offers).toEqual([]);
    expect(firstPaint.phase).toBe("loading");
    expect(firstPaint.canManage).toBe(false);
    // And it must never have shown the other workspace's record, on any paint after the switch.
    for (const paint of renders.slice(before)) {
      expect(paint.offers.map((o) => o.name)).not.toContain("Tenant One Programme");
    }
  });

  it("reports resolving, not loading, when the account context itself is still resolving", async () => {
    await run();
    const before = renders.length;
    tenant = { activeTenantId: null, accountContextLoading: true };
    act(() => { root.render(<Probe />); });
    expect(renders[before].phase).toBe("resolving");
    expect(renders[before].offers).toEqual([]);
  });

  it("keeps every recorded plan rather than collapsing to one", async () => {
    results.tenant_products = { data: [{ id: "o1", name: "Program", status: "active" }], error: null };
    results.tenant_prices = {
      data: [
        { id: "p1", product_id: "o1", unit_amount: 50000, kind: "installment", installments_total: 6, active: true },
        { id: "p2", product_id: "o1", unit_amount: 300000, kind: "one_time", active: true },
      ],
      error: null,
    };
    await run();
    expect(latest!.offers[0].prices).toHaveLength(2);
    expect(latest!.offers[0].prices[0].installmentsTotal).toBe(6);
  });
});


const product = (id: string) => ({ id, name: id, status: "draft", product_type: "one_time" });
describe("optional Sales offer window", () => {
  it("keeps no-argument Catalog requests and result shape compatible", async () => {
    await run();
    expect(call("tenant_products")?.range).toBeUndefined();
    expect(call("tenant_products")?.orders).toEqual(["name"]);
    expect(call("tenant_prices")?.inside).toBeUndefined();
    expect(latest!.hasMore).toBe(false);
    expect(latest!.referencedOffers).toEqual([]);
  });
  it("bounds pages with one sentinel, literal search, exact references and just their prices", async () => {
    options = { search: "  50%_off\\sale  ", page: 1, pageSize: 2, referenceIds: ["selected", "selected"] };
    respond = (query) => query.table === "tenant_products"
      ? { data: query.inside ? [product("selected")] : [product("p1"),product("p2"),product("sentinel")], error: null } : undefined;
    await run();
    const page = calls.find(c => c.table === "tenant_products" && !c.inside)!;
    const refs = calls.find(c => c.table === "tenant_products" && c.inside)!;
    expect(page.range).toEqual([2,4]);
    expect(page.orders).toEqual(["name","id"]);
    expect(page.ilike).toEqual(["name", "%50\\%\\_off\\\\sale%"]);
    expect(refs.inside).toEqual(["id",["selected"]]);
    expect(refs.ilike).toBeUndefined();
    expect(refs.eq).toContainEqual(["tenant_id","tenant-1"]);
    expect(call("tenant_prices")?.inside).toEqual(["product_id",["p1","p2","selected"]]);
    expect(latest!.offers.map(o=>o.id)).toEqual(["p1","p2"]);
    expect(latest!.referencedOffers.map(o=>o.id)).toEqual(["selected"]);
    expect(latest!.hasMore).toBe(true);
  });
  it("skips a price read for an empty optional window", async () => {
    options = {};
    await run();
    expect(call("tenant_prices")).toBeUndefined();
    expect(latest!.phase).toBe("ready");
  });
  it("preserves the exact window and references through missing-column fallback", async () => {
    options = { search: "alpha", page: 2, pageSize: 5, referenceIds:["selected"] };
    respond = query => query.table === "tenant_products" ? query.select.includes("summary")
      ? {data:null,error:{code:"42703"}} : {data:query.inside ? [product("selected")] : [],error:null} : undefined;
    await run();
    const pages=calls.filter(c=>c.table === "tenant_products" && !c.inside);
    expect(pages.map(c=>c.range)).toEqual([[10,15],[10,15]]);
    expect(pages.map(c=>c.ilike)).toEqual([["name","%alpha%"],["name","%alpha%"]]);
    expect(latest!.referencedOffers[0].id).toBe("selected");
    expect(latest!.fieldsUnavailable).toBe(true);
  });
  it("suppresses the old query on first paint and ignores its late response", async () => {
    options={search:"old",pageSize:5};
    let release!: (value: unknown)=>void;
    respond=query=>query.table === "tenant_products" && query.ilike?.[1] === "%old%"
      ? new Promise(resolve=>{release=resolve;}) : query.table === "tenant_products" ? {data:[product("new")],error:null} : undefined;
    await run();
    options={search:"new",pageSize:5};renders.length=0;
    await act(async()=>{root.render(<Probe/>);});
    expect(renders[0].phase).toBe("loading");expect(renders[0].offers).toEqual([]);
    await act(async()=>{release({data:[product("old")],error:null});});
    expect(latest!.offers.map(o=>o.id)).toEqual(["new"]);
  });
  it("clears references and authority synchronously while account context resolves", async () => {
    options={referenceIds:["selected"]};
    respond=query=>query.table === "tenant_products" ? {data:[product("selected")],error:null} : undefined;
    await run();renders.length=0;
    tenant={...tenant,accountContextLoading:true};
    await act(async()=>{root.render(<Probe/>);});
    expect(renders[0].phase).toBe("resolving");expect(renders[0].offers).toEqual([]);
    expect(renders[0].referencedOffers).toEqual([]);expect(renders[0].canManage).toBe(false);
  });
});


it("removes previously ready offers and references on the first changed-query render", async () => {
  options={search:"old",referenceIds:["selected"]};
  respond=query=>query.table === "tenant_products" ? {data:[product(query.inside ? "selected" : "old")],error:null} : undefined;
  await run();expect(latest!.offers[0].id).toBe("old");
  options={search:"new",referenceIds:["other"]};
  respond=query=>query.table === "tenant_products" ? new Promise(()=>{}) : undefined;
  renders.length=0;
  await act(async()=>{root.render(<Probe/>);});
  expect(renders[0].phase).toBe("loading");expect(renders[0].offers).toEqual([]);expect(renders[0].referencedOffers).toEqual([]);
});
it("bounds reference inputs and treats equivalent query options as the same read", async () => {
  const ids=Array.from({length:205},(_,i)=>`ref-${String(i).padStart(3,"0")}`);
  options={page:-2,pageSize:500,referenceIds:[...ids,...ids]};
  await run();
  expect(call("tenant_products")?.range).toEqual([0,50]);
  expect(calls.find(c=>c.table === "tenant_products" && c.inside)?.inside?.[1]).toHaveLength(200);
  const before=calls.length;
  options={page:0,pageSize:50,referenceIds:[...ids].reverse()};
  await act(async()=>{root.render(<Probe/>);});
  expect(calls.length).toBe(before);
});
it("fails the window honestly if reference lookup fails instead of claiming the selected record is missing", async () => {
  options={referenceIds:["selected"]};
  respond=query=>query.table === "tenant_products" && query.inside ? {data:null,error:{code:"42501"}} : undefined;
  await run();expect(latest!.phase).toBe("error");expect(latest!.referencedOffers).toEqual([]);expect(call("tenant_prices")).toBeUndefined();
});

it("searches a literal asterisk without PostgREST wildcard expansion or regex injection", async () => {
  options={search:"A*(B)+[C].?",pageSize:5};
  await run();
  const query=call("tenant_products")!;
  expect(query.ilike).toBeUndefined();
  expect(query.filter).toEqual(["name","imatch",String.raw`A\*\(B\)\+\[C\]\.\?`]);
  expect(query.range).toEqual([0,5]);
  expect(query.eq).toContainEqual(["tenant_id","tenant-1"]);
});

describe('useCatalogOffers — shared freshness',()=>{
  it('revalidates an already mounted reader when its tenant Catalog changes',async()=>{
    await run();const before=calls.filter(c=>c.table==='tenant_products').length;
    await act(async()=>{window.dispatchEvent(new CustomEvent('paige:catalog-offers-changed',{detail:{tenantId:'tenant-1'}}));await Promise.resolve();});
    expect(calls.filter(c=>c.table==='tenant_products').length).toBeGreaterThan(before);
  });
  it('ignores a different workspace invalidation',async()=>{
    await run();const before=calls.filter(c=>c.table==='tenant_products').length;
    await act(async()=>{window.dispatchEvent(new CustomEvent('paige:catalog-offers-changed',{detail:{tenantId:'tenant-2'}}));await Promise.resolve();});
    expect(calls.filter(c=>c.table==='tenant_products').length).toBe(before);
  });
  it('revalidates on window focus without replacing the query scope',async()=>{
    options={search:'Service',page:0,pageSize:5};await run();const before=calls.filter(c=>c.table==='tenant_products').length;
    await act(async()=>{window.dispatchEvent(new Event('focus'));await Promise.resolve();});
    expect(calls.filter(c=>c.table==='tenant_products').length).toBeGreaterThan(before);
    expect(calls.filter(c=>c.table==='tenant_products').every(c=>c.eq.some(([key,value])=>key==='tenant_id'&&value==='tenant-1'))).toBe(true);
  });
});


describe('useCatalogOffers — mutation and subscription freshness',()=>{
  it('successful writer refreshes both mounted canonical readers',async()=>{
    function Pair(){latest=useCatalogOffers();useCatalogOffers({pageSize:5});return null}
    await run();await act(async()=>{root.render(<Pair/>)});const before=calls.filter(c=>c.table==='tenant_products').length;
    await act(async()=>{await latest!.setOfferStatus('offer-id','active',null)});
    expect(calls.filter(c=>c.table==='tenant_products').length).toBeGreaterThanOrEqual(before+2);
  });
  it('failed mutation does not broadcast a false Catalog update',async()=>{
    await run();mutationResult={data:null,error:{message:'Save refused'}};const before=calls.filter(c=>c.table==='tenant_products').length;
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    try{await act(async()=>{const result=await latest!.setOfferStatus('offer-id','active',null);expect(result.ok).toBe(false)});expect(calls.filter(c=>c.table==='tenant_products').length).toBe(before)}finally{log.mockRestore()}
  });
  it('subscribes narrowly and refetches canonical facts rather than event payloads',async()=>{
    await run();expect(subscriptions).toHaveLength(4);expect(subscriptions.every(s=>s.filter==='tenant_id=eq.tenant-1')).toBe(true);expect(subscriptions.map(s=>s.table)).toEqual(['tenant_products','tenant_products','tenant_prices','tenant_prices']);
    const before=calls.filter(c=>c.table==='tenant_products').length;await act(async()=>{subscriptions[0].callback();await Promise.resolve()});expect(calls.filter(c=>c.table==='tenant_products').length).toBeGreaterThan(before);
    tenant={activeTenantId:'tenant-2',accountContextLoading:false};await act(async()=>{root.render(<Probe/>)});expect(removedChannels.length).toBeGreaterThan(0);expect(subscriptions.slice(-4).every(s=>s.filter==='tenant_id=eq.tenant-2')).toBe(true);
  });
});
