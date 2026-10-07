import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { salesMetricRange, useSalesPerformanceMetrics } from "./useSalesPerformanceMetrics";
const { rpc, auth } = vi.hoisted(() => ({ rpc: vi.fn(), auth: { listener: (() => {}) as () => void } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, auth: { onAuthStateChange: (listener:()=>void) => { auth.listener=listener; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const A = "a3400000-0000-4000-8000-000000000011", B = "a3400000-0000-4000-8000-000000000022";
function response(args: Record<string,string>) {
  const capturedAt = new Date().toISOString();
  const money = /pipeline|receivables|cash|allocations|issued_amount/.test(args.p_metric_key);
  return { metric_key: args.p_metric_key, metric_version: "1.0.0", owner_department: "sales", label: "Recorded sales", definition: "Canonical records", formula: "Server computation", range: {key: args.p_range_key,start: args.p_range_start,end: args.p_range_end,bounds:"[start,end)",timezone:"UTC",semantics:"current_snapshot"},dimensions:{},values: money ? {kind:"currency_totals",by_currency:[{currency:"usd",amount_minor:"50000",record_count:1}],breakdown:[]} : {kind:"count",count:1},unit:money?"currency_minor":"count",source_refs:["public.deals"],as_of:capturedAt,freshness:{queried_at:capturedAt,source_updated_through:null},coverage:{state:"complete",candidate_count:1,contributing_count:1,excluded_count:0},exclusions:[],truth_state:"LIVE",caveats:[],source_revision_ref:`sr_v1_${"a".repeat(64)}`,account_epoch:args.p_account_epoch,account_epoch_ref:`ae_v1_${"b".repeat(64)}`,evidence_ref:`aneb_v1_${"c".repeat(64)}`,reference_expires_at:new Date(Date.now()+900000).toISOString() };
}
function Probe({epoch,range="month"}:{epoch:string|null;range?:"month"|"week"}) { const read=useSalesPerformanceMetrics(epoch,range); return <output>{read.phase}:{read.metrics.length}:{read.metrics[0]?.evidence_ref ?? "none"}</output>; }
beforeEach(()=>{rpc.mockReset();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(epoch:string|null,range:"month"|"week"="month") { await act(async()=>{root.render(<Probe epoch={epoch} range={range}/>);}); }
describe("Sales shared metric consumer",()=>{
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
