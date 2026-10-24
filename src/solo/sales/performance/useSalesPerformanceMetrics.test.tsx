import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { salesMetricRange, useSalesPerformanceMetrics } from "./useSalesPerformanceMetrics";
const { rpc, auth } = vi.hoisted(() => ({ rpc: vi.fn(), auth: { listener: (() => {}) as (event?: string) => void } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, auth: { onAuthStateChange: (listener:(event?: string)=>void) => { auth.listener=listener; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const A = "a3400000-0000-4000-8000-000000000011", B = "a3400000-0000-4000-8000-000000000022";
function response(args: Record<string,string>) {
  const capturedAt = new Date().toISOString();
  const money = /pipeline|receivables|cash|allocations|issued_amount/.test(args.p_metric_key);
  const overdue = args.p_metric_key === "sales.receivables.overdue_current";
  return { metric_key: args.p_metric_key, metric_version: args.p_metric_version, owner_department: "sales", label: "Recorded sales", definition: "Canonical records", formula: "Server computation", range: {key: args.p_range_key,start: args.p_range_start,end: args.p_range_end,bounds:"[start,end)",timezone:"UTC",semantics:"current_snapshot"},dimensions:{},values: money ? {kind:"currency_totals",by_currency:[{currency:"usd",amount_minor:"50000",record_count:1}],breakdown:[]} : {kind:"count",count:1},unit:money?"currency_minor":"count",source_refs:["public.deals"],as_of:capturedAt,freshness:{queried_at:capturedAt,source_updated_through:null},coverage:{state:"complete",candidate_count:1,contributing_count:1,excluded_count:0},exclusions:[],truth_state:"LIVE",caveats:[],source_revision_ref:`sr_v1_${"a".repeat(64)}`,account_epoch:args.p_account_epoch,account_epoch_ref:`ae_v1_${"b".repeat(64)}`,evidence_ref:`aneb_v1_${"c".repeat(64)}`,reference_expires_at:new Date(Date.now()+900000).toISOString(), ...(overdue ? {source_refs:["public.paige_invoices","public.tenant_business_time_zones"],business_time_zone:{state:"configured" as const,zone:"UTC",set_at:new Date(Date.now()-86400000).toISOString(),as_of_date:capturedAt.slice(0,10)}} : {}) };
}
function Probe({epoch,range="month"}:{epoch:string|null;range?:"month"|"week"}) { const read=useSalesPerformanceMetrics(epoch,range); return <output>{read.phase}:{read.metrics.length}:{read.metrics[0]?.evidence_ref ?? "none"}</output>; }
beforeEach(()=>{rpc.mockReset();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});
async function render(epoch:string|null,range:"month"|"week"="month") { await act(async()=>{root.render(<Probe epoch={epoch} range={range}/>);}); }
describe("Sales shared metric consumer",()=>{
  it("requests business-calendar overdue 1.1.0 without changing the other ten metric identities",async()=>{
    rpc.mockImplementation(async(_name,args)=>({data:response(args),error:null}));
    await render(A);
    expect(rpc).toHaveBeenCalledTimes(11);
    for(const [,args] of rpc.mock.calls) {
      expect(args.p_metric_version).toBe(args.p_metric_key === "sales.receivables.overdue_current" ? "1.1.0" : "1.0.0");
      expect(args.p_account_epoch).toBe(A);
      expect(args.p_dimensions).toEqual({});
    }
  });
  it("rejects legacy overdue evidence without silently reinterpreting its version",async()=>{
    rpc.mockImplementation(async(_name,args)=>({data:args.p_metric_key==="sales.receivables.overdue_current"?{...response(args),metric_version:"1.0.0"}:response(args),error:null}));
    await render(A);expect(host.textContent).toContain("ready:10");
    expect(rpc.mock.calls.find(([,args])=>args.p_metric_key==="sales.receivables.overdue_current")?.[1].p_metric_version).toBe("1.1.0");
  });
  it.each(["missing","invalid"] as const)("keeps %s calendar evidence as a measured unavailable result",async state=>{
    rpc.mockImplementation(async(_name,args)=>({data:args.p_metric_key==="sales.receivables.overdue_current"?{...response(args),values:null,truth_state:"UNAVAILABLE",coverage:{state:"unavailable",candidate_count:1,contributing_count:0,excluded_count:1,reason:`business_time_zone_${state}`},exclusions:[{reason:`business_time_zone_${state}`,count:1}],business_time_zone:{state,zone:null,set_at:state==="missing"?null:"2026-09-01T00:00:00Z",as_of_date:null}}:response(args),error:null}));
    await render(A);expect(host.textContent).toContain("ready:11");
  });
  it("preserves the Supabase client receiver for every metric RPC, including empty workspaces",async()=>{
    rpc.mockImplementation(async function(this: { rpc?: unknown } | undefined,_name,args){
      if(this?.rpc!==rpc)throw new TypeError("RPC requires its client receiver");
      const result=response(args);
      result.values=result.values.kind==="count"?{kind:"count",count:0}:{kind:"currency_totals",by_currency:[],breakdown:[]};
      result.coverage={state:"complete",candidate_count:0,contributing_count:0,excluded_count:0};
      return {data:result,error:null};
    });
    await render(A);expect(host.textContent).toContain("ready:11");
    await render(B);expect(host.textContent).toContain("ready:11");
    expect(rpc).toHaveBeenCalledTimes(22);
  });
  it("issues eleven exact authenticated reads automatically on mount and fresh mount",async()=>{
    rpc.mockImplementation(async(_name,args)=>({data:response(args),error:null}));
    await render(A);expect(rpc).toHaveBeenCalledTimes(11);expect(host.textContent).toContain("ready:11");
    expect(rpc.mock.calls[0][1]).toMatchObject({p_account_epoch:A,p_metric_version:"1.0.0",p_dimensions:{}});
    act(()=>root.unmount());root=createRoot(host);await render(A);expect(rpc).toHaveBeenCalledTimes(22);
  });
  it("clears workspace data synchronously and rejects a late prior workspace response",async()=>{
    const pending: Array<()=>void>=[];
    rpc.mockImplementation((_name,args)=>new Promise(resolve=>pending.push(()=>resolve({data:response(args),error:null}))));
    await render(A);await render(B);expect(host.textContent).toBe("loading:0:none");
    await act(async()=>{pending.slice(0,11).forEach(done=>done());});expect(host.textContent).toBe("loading:0:none");
    await act(async()=>{pending.slice(11).forEach(done=>done());});expect(host.textContent).toContain("ready:11");
  });
  it("fails closed for a foreign epoch or unauthorized actor",async()=>{
    rpc.mockImplementation(async(_name,args)=>({data:{...response(args),account_epoch:B},error:null}));
    await render(A);expect(host.textContent).toBe("error:0:none");
    rpc.mockResolvedValue({data:null,error:{code:"42501"}});await render(B);expect(host.textContent).toBe("denied:0:none");
  });
  it("requests new period evidence without retaining old figures",async()=>{
    rpc.mockImplementation(async(_name,args)=>({data:response(args),error:null}));await render(A);await render(A,"week");
    expect(rpc).toHaveBeenCalledTimes(22);expect(rpc.mock.calls[11][1].p_range_key).toBe("week");
  });
  it("does not issue when the canonical workspace is unresolved",async()=>{await render(null);expect(rpc).not.toHaveBeenCalled();expect(host.textContent).toBe("unavailable:0:none");});
  it("preserves successful unavailable evidence instead of manufacturing a read failure",async()=>{
    rpc.mockImplementation(async(_name,args)=>({data:{...response(args),truth_state:"UNAVAILABLE",values:null,coverage:{state:"unavailable",candidate_count:1,contributing_count:0,excluded_count:1},exclusions:[{reason:"missing_source",count:1}],caveats:["Source coverage is incomplete."]},error:null}));
    await render(A);expect(host.textContent).toContain("ready:11");
  });
  it("invalidates same-workspace figures and late results when the authenticated actor changes",async()=>{
    rpc.mockImplementation(async(_name,args)=>({data:response(args),error:null}));await render(A);expect(host.textContent).toContain("ready:11");
    const pending: Array<()=>void>=[];rpc.mockImplementation((_name,args)=>new Promise(resolve=>pending.push(()=>resolve({data:response(args),error:null}))));
    await act(async()=>auth.listener());expect(host.textContent).toBe("loading:0:none");expect(rpc).toHaveBeenCalledTimes(22);
  });
  it("uses exact completed UTC day bounds for date cohorts",()=>{expect(salesMetricRange("week",new Date("2026-10-07T19:42:00Z"))).toEqual({start:"2026-09-30T00:00:00.000Z",end:"2026-10-07T00:00:00.000Z"});});
});

function referenceReads(adjust?: (row: ReturnType<typeof response>, index: number) => void) {
  const rows = new Map<string, ReturnType<typeof response>>();
  let issued = 0;
  const read = async (name: string, args: Record<string, string>) => {
    if (name === "issue_analytics_evidence_bundle") {
      const row = response(args);
      row.evidence_ref = `aneb_v1_${(++issued).toString(16).padStart(64, "0")}`;
      adjust?.(row, issued);
      rows.set(row.evidence_ref, structuredClone(row));
      return { data: row, error: null };
    }
    if (name === "resolve_analytics_evidence_reference") {
      const row = rows.get(args.p_evidence_ref);
      return { data: row ? structuredClone(row) : null, error: row ? null : { code: "42501" } };
    }
    throw new Error("Unexpected metric RPC");
  };
  rpc.mockImplementation(read);
  return { rows, read, issued: () => issued };
}
const resolveCount = () => rpc.mock.calls.filter(([name]) => name === "resolve_analytics_evidence_reference").length;

describe("existing metric references across a Sales-to-Finance review", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T19:42:00Z")); });

  it.each(["pending", "completed"] as const)("does not supersede the original %s issuance on the subscription's initial-session notice", async timing => {
    // Model the native contract: another issuance of the same metric revokes its old reference.
    const latest = new Map<string, string>();
    const port = referenceReads(row => {
      const previous = latest.get(row.metric_key);
      if (previous) port.rows.delete(previous);
      latest.set(row.metric_key, row.evidence_ref);
    });
    const pending: Array<() => void> = [];
    if (timing === "pending") rpc.mockImplementation((name, args) => name === "issue_analytics_evidence_bundle"
      ? port.read(name, args).then(result => new Promise(resolve => pending.push(() => resolve(result))))
      : port.read(name, args));
    await render(A);
    const original = [...port.rows.keys()][0];
    expect(port.issued()).toBe(11);
    await act(async () => { auth.listener("INITIAL_SESSION"); });
    expect(port.issued()).toBe(11);
    expect(port.rows.has(original)).toBe(true);
    await act(async () => { pending.forEach(done => done()); });
    expect(host.textContent).toBe(`ready:11:${original}`);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(resolveCount()).toBe(11);
    expect(port.issued()).toBe(11);
    expect(host.textContent).toBe(`ready:11:${original}`);
  });

  it.each(["SIGNED_OUT", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"])("still retires pending references on %s", async event => {
    const port = referenceReads();
    await render(A);
    const pending: Array<() => void> = [];
    rpc.mockImplementation((name, args) => name === "resolve_analytics_evidence_reference"
      ? new Promise(resolve => pending.push(() => { void port.read(name, args).then(resolve); }))
      : Promise.resolve({ data: null, error: { code: "42501" } }));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(pending).toHaveLength(11);
    await act(async () => { auth.listener(event); });
    expect(host.textContent).toBe("denied:0:none");
    await act(async () => { pending.forEach(done => done()); });
    expect(host.textContent).toBe("denied:0:none");
    expect(port.issued()).toBe(11);
  });

  it("keeps an unchanged original reference after the automatic sixty-second read", async () => {
    const port = referenceReads();
    await render(A);
    const before = host.textContent;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(port.issued()).toBe(11);
    expect(resolveCount()).toBe(11);
    expect(host.textContent).toBe(before);
  });

  it("clears figures while foreground reference verification is pending, then restores the same reference", async () => {
    const port = referenceReads();
    await render(A);
    const before = host.textContent;
    const pending: Array<() => void> = [];
    rpc.mockImplementation((name, args) => name === "resolve_analytics_evidence_reference"
      ? new Promise(resolve => pending.push(() => { void port.read(name, args).then(resolve); }))
      : port.read(name, args));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(host.textContent).toBe("loading:0:none");
    expect(pending).toHaveLength(11);
    expect(port.issued()).toBe(11);
    await act(async () => { pending.forEach(done => done()); });
    expect(host.textContent).toBe(before);
  });

  it("keeps a refused reference refused across automatic reads instead of silently issuing a substitute", async () => {
    const port = referenceReads();
    await render(A);
    rpc.mockImplementation((name, args) => name === "resolve_analytics_evidence_reference"
      ? Promise.resolve({ data: null, error: { code: "42501" } }) : port.read(name, args));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(host.textContent).toBe("denied:0:none");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(host.textContent).toBe("denied:0:none");
    expect(port.issued()).toBe(11);
    expect(resolveCount()).toBe(22);
  });

  it.each(["reference", "revision", "as-of", "expiry"] as const)("refuses a resolver response that changes the original %s identity", async changed => {
    const port = referenceReads();
    await render(A);
    rpc.mockImplementation(async (name, args) => {
      const result = await port.read(name, args);
      if (name !== "resolve_analytics_evidence_reference" || !result.data) return result;
      return { ...result, data: { ...result.data,
        ...(changed === "reference" ? { evidence_ref: `aneb_v1_${"f".repeat(64)}` } : {}),
        ...(changed === "revision" ? { source_revision_ref: `sr_v1_${"e".repeat(64)}` } : {}),
        ...(changed === "as-of" ? { as_of: "2026-10-07T19:41:59Z", freshness: { ...result.data.freshness, queried_at: "2026-10-07T19:41:59Z" } } : {}),
        ...(changed === "expiry" ? { reference_expires_at: new Date(Date.now() + 1_000_000).toISOString() } : {}),
      } };
    });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(host.textContent).toBe("error:0:none");
    expect(port.issued()).toBe(11);
  });

  it("rechecks the same reference after a transport failure without renewing its authority or expiry", async () => {
    const port = referenceReads();
    await render(A);
    const before = host.textContent;
    rpc.mockImplementation((name, args) => name === "resolve_analytics_evidence_reference"
      ? Promise.resolve({ data: null, error: { code: "FETCH_FAILED" } }) : port.read(name, args));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(host.textContent).toBe("error:0:none");
    expect(port.issued()).toBe(11);
    rpc.mockImplementation(port.read);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(host.textContent).toBe(before);
    expect(port.issued()).toBe(11);
  });

  it("requires a fresh authorized UI read after refusal and still honors current issuer denial", async () => {
    const port = referenceReads();
    function ExplicitRead() {
      const read = useSalesPerformanceMetrics(A, "month");
      return <><output>{read.phase}:{read.metrics.length}:{read.metrics[0]?.evidence_ref ?? "none"}</output><button onClick={read.retry}>Refresh verified metrics</button></>;
    }
    await act(async () => { root.render(<ExplicitRead />); });
    const original = host.querySelector("output")?.textContent;
    let issuerDenied = true;
    rpc.mockImplementation((name, args) => name === "resolve_analytics_evidence_reference" || issuerDenied
      ? Promise.resolve({ data: null, error: { code: "42501" } }) : port.read(name, args));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(host.querySelector("output")?.textContent).toBe("denied:0:none");
    expect(port.issued()).toBe(11);
    await act(async () => { host.querySelector("button")?.click(); });
    expect(host.querySelector("output")?.textContent).toBe("denied:0:none");
    expect(port.issued()).toBe(11);
    issuerDenied = false;
    await act(async () => { host.querySelector("button")?.click(); });
    expect(host.querySelector("output")?.textContent).toContain("ready:11:");
    expect(host.querySelector("output")?.textContent).not.toBe(original);
    expect(port.issued()).toBe(22);
  });

  it("renews only the reference that actually expired while resolving the other ten", async () => {
    const port = referenceReads((row, index) => { if (index === 1) row.reference_expires_at = new Date(Date.now() + 50_000).toISOString(); });
    await render(A);
    const before = host.textContent;
    await act(async () => { await vi.advanceTimersByTimeAsync(50_000); });
    expect(port.issued()).toBe(12);
    expect(resolveCount()).toBe(10);
    expect(host.textContent).toContain("ready:11:");
    expect(host.textContent).not.toBe(before);
  });

  it("does not publish early results that expired while the final reference was still being checked", async () => {
    const port = referenceReads(row => { row.reference_expires_at = new Date(Date.now() + 50_000).toISOString(); });
    await render(A);
    let finish: (() => void) | undefined;
    const last = [...port.rows.keys()].at(-1);
    rpc.mockImplementation((name, args) => name === "resolve_analytics_evidence_reference" && args.p_evidence_ref === last
      ? new Promise(resolve => { finish = () => { void port.read(name, args).then(resolve); }; }) : port.read(name, args));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(host.textContent).toBe("loading:0:none");
    await act(async () => { await vi.advanceTimersByTimeAsync(50_000); });
    expect(finish).toBeDefined();
    await act(async () => { finish?.(); });
    expect(host.textContent).toBe("error:0:none");
    expect(port.issued()).toBe(11);
  });

  it.each(["workspace", "authentication", "period"] as const)("retires pending reference replies when the %s changes", async changed => {
    const port = referenceReads();
    await render(A);
    const pending: Array<() => void> = [];
    rpc.mockImplementation((name, args) => name === "resolve_analytics_evidence_reference"
      ? new Promise(resolve => pending.push(() => { void port.read(name, args).then(resolve); }))
      : port.read(name, args));
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(pending).toHaveLength(11);
    if (changed === "workspace") await render(B);
    else if (changed === "period") await render(A, "week");
    else await act(async () => { auth.listener(); });
    expect(port.issued()).toBe(22);
    const current = host.textContent;
    expect(current).toContain("ready:11:");
    await act(async () => { pending.forEach(done => done()); });
    expect(host.textContent).toBe(current);
    expect(port.issued()).toBe(22);
  });
});
