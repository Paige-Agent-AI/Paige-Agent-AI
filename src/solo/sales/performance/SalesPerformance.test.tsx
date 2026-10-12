import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesPerformance } from "./SalesPerformance";
import type { SalesMetricBundle, SalesPerformanceProps } from "./types";
import type { AnalyticsEvidenceBundle } from "../../data/useAnalyticsEvidence";
import { performanceDate } from "./format";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});
const mount=(p:SalesPerformanceProps)=>act(()=>root.render(<SalesPerformance {...p}/>));
const click=(name:string)=>act(()=>{const button=[...document.querySelectorAll("button")].find(node=>node.getAttribute("aria-label")===name||node.textContent?.trim()===name);if(!button)throw Error(`Missing button ${name}`);button.click();});
const metric = (key: string, amounts?: {currency:string;amount_minor:string;record_count:number}[]): SalesMetricBundle => ({
  metric_key:key,metric_version:"1.0.0",owner_department:"sales",label:key,definition:"Canonical source definition",formula:"Server-defined formula",range:{start:"2026-09-01T00:00:00Z",end:"2026-10-01T00:00:00Z",bounds:"[start,end)",timezone:"UTC",semantics:key.includes("current")||key.includes("open_value")?"current_snapshot":"event_timestamp_cohort"},dimensions:{},values:amounts?{kind:"currency_totals",by_currency:amounts,breakdown:[]}:{kind:"count",count:7},unit:amounts?"currency_minor_units":"count",source_refs:["deals"],as_of:"2026-10-07T12:00:00Z",freshness:{queried_at:"2026-10-07T12:00:00Z",source_updated_through:null},coverage:{state:"complete",candidate_count:7,contributing_count:7,excluded_count:0},exclusions:[],truth_state:"LIVE",caveats:[],source_revision_ref:"source-revision",evidence_ref:null,evidence_state:"shared_issuance_required"
});
const props = (patch: Partial<SalesPerformanceProps> = {}): SalesPerformanceProps => ({metrics:[],phase:"ready",range:"month",workspaceEpoch:"workspace-a",onRangeChange:vi.fn(),onRetry:vi.fn(),onNavigate:vi.fn(),...patch});
const funnel:AnalyticsEvidenceBundle={metric:{id:"sales_funnel.created_deals_by_current_stage",version:"1.0.0",label:"Current stages",definition:"Created-period current-stage cohort",formula:"Server stage count"},range:{key:"last_30_days",start:"2026-09-01T00:00:00Z",end:"2026-10-01T00:00:00Z"},source_references:[],contributing_record_count:4,coverage:{state:"complete",candidate_count:4,contributing_count:4,excluded_count:0},exclusions:[],freshness:{queried_at:"2026-10-07T12:00:00Z",source_updated_through:null},truth_state:"LIVE",account_epoch_ref:"test-epoch",source_revision_ref:"test-stage-revision",reference_expires_at:new Date(Date.now()+86_400_000).toISOString(),values:{kind:"sales_funnel_stages",pipeline_label:null,stages:[{stage_key:"test-stage",label:"Proposal",stage_type:"open",order:1,count:4}]},caveats:[]};
describe("Sales Performance canonical presentation",()=>{
  it("carries the current Solo theme into the portalled evidence drawer",()=>{
    host.setAttribute("data-pg","light");
    mount(props({metrics:[metric("sales.opportunities.created")]}));
    click("Inspect opportunities created");
    expect(document.querySelector('[role="dialog"]')?.getAttribute("data-pg")).toBe("light");
    expect(document.querySelector('[role="dialog"]')?.classList.contains("paige-solo")).toBe(true);
  });
  it("renders supplied currency figures independently without a combined total",()=>{
    mount(props({metrics:[metric("sales.pipeline.open_value",[{currency:"USD",amount_minor:"18400000",record_count:3},{currency:"EUR",amount_minor:"2800000",record_count:2}])]}));
    expect(host.textContent).toContain("$184,000.00");
    expect(host.textContent).toContain("€28,000.00");
    expect(host.textContent).not.toContain("$212,000.00");
  });
  it("does not substitute zero for an unavailable or unresolved measure",()=>{
    mount(props({phase:"unavailable"}));
    expect(host.textContent).toMatch(/shared metric reader/i);
    expect(host.textContent).not.toContain("0%");
    expect(host.textContent).not.toContain("$0.00");
  });
  it("hides previous figures while a scope is loading or denied",()=>{
    mount(props({metrics:[metric("sales.opportunities.created")],phase:"loading"}));
    expect(host.querySelector(".sp-activity")).toBeNull();
    mount(props({metrics:[metric("sales.opportunities.created")],phase:"denied"}));
    expect(host.querySelector(".sp-activity")).toBeNull();
    expect(host.textContent).toMatch(/access is restricted/i);
  });
  it("requests a new server range instead of recomputing a period locally",()=>{
    const p=props();mount(p);
    act(()=>{const select=host.querySelector("select")!;select.value="year";select.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(p.onRangeChange).toHaveBeenCalledWith("year");
  });
  it("shows source coverage and absent issuance without inventing an opaque reference",()=>{
    const m=metric("sales.opportunities.created");m.truth_state="PARTIAL";m.coverage.excluded_count=2;
    mount(props({metrics:[m]}));
    click("Inspect opportunities created");
    expect(document.body.textContent).toContain("Canonical source definition");
    expect(document.body.textContent).toMatch(/shared evidence issuance is pending/i);
    expect(document.body.textContent).toContain("2 excluded");
  });
  it("keeps future missing producers visible without false rates",()=>{
    mount(props());click("Data health");
    expect(host.textContent).toContain("Speed-to-lead");expect(host.textContent).toMatch(/first legitimate outreach/i);expect(host.textContent).not.toContain("0%");
  });
  it("passes actionable navigation to canonical Sales instead of embedding editing",()=>{
    const p=props({metrics:[metric("sales.receivables.overdue_current",[{currency:"USD",amount_minor:"730000",record_count:2}])]});mount(p);
    click("Open Collections");expect(p.onNavigate).toHaveBeenCalledWith({tab:"payments",query:"view=collections"});
  });
  it("renders chart marks on initial mount and remount without an activation click",()=>{
    mount(props({stageFunnel:funnel,stagePhase:"ready"}));
    expect(host.querySelectorAll(".sp-stage-bar")).toHaveLength(1);
    const first=host.querySelector(".sp-stage-bar");
    act(()=>root.unmount());root=createRoot(host);mount(props({stageFunnel:funnel,stagePhase:"ready"}));
    expect(host.querySelector(".sp-stage-bar")).toBeTruthy();expect(host.querySelector(".sp-stage-bar")).not.toBe(first);
  });
  it("never presents the prior range stage chart after a reporting-period change",()=>{
    mount(props({stageFunnel:funnel,stagePhase:"ready"}));expect(host.querySelector(".sp-stage-bar")).toBeTruthy();
    mount(props({range:"year",stageFunnel:funnel,stagePhase:"loading"}));expect(host.querySelector(".sp-stage-bar")).toBeNull();
  });
  it("labels the stage chart with its actual independent bounds rather than the money period",()=>{
    mount(props({range:"year",stageFunnel:funnel,stagePhase:"ready"}));
    const label=host.querySelector(".sp-stage-scope")?.textContent;
    expect(label).toContain(performanceDate(funnel.range.start));
    expect(label).toContain(performanceDate(funnel.range.end));
    expect(label).toContain("exclusive");
    expect(label).not.toContain("selected period");
    expect(host.textContent).toContain("Stage cohort has its own dates");
  });
  it("supports keyboard stage evidence without historical conversion claims",()=>{
    mount(props({stageFunnel:funnel,stagePhase:"ready"}));
    act(()=>host.querySelector(".sp-stage-column")!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
    expect(document.body.textContent).toContain("Created-period current-stage cohort");
    expect(document.body.textContent).toContain("not historical stage conversion");
  });
  it("drops the previous workspace disclosure during workspace switching",()=>{
    mount(props({metrics:[metric("sales.opportunities.created")]}));click("Inspect opportunities created");
    expect(document.querySelector(".sp-evidence")).toBeTruthy();
    mount(props({workspaceEpoch:"workspace-b",phase:"loading",metrics:[metric("sales.opportunities.created")]}));
    expect(document.querySelector(".sp-evidence")).toBeNull();expect(host.querySelector(".sp-activity")).toBeNull();
  });
  it("preserves unavailable metadata with null values without showing a fake zero",()=>{
    const m=metric("sales.opportunities.created");m.values=null;m.truth_state="UNAVAILABLE";m.coverage={state:"unavailable",candidate_count:7,contributing_count:0,excluded_count:7};m.exclusions=[{reason:"missing_currency",count:7}];m.caveats=["Currency records incomplete."];m.evidence_ref="test-unavailable-reference";
    mount(props({metrics:[m]}));click("Inspect opportunities created");
    expect(document.body.textContent).toContain("7 excluded");expect(document.body.textContent).toContain("Currency records incomplete.");expect(document.body.textContent).toContain("test-unavailable-reference");expect(document.body.textContent).not.toContain("$0.00");
    click("Close");click("Money");expect(host.textContent).not.toContain("$0.00");
  });
  it.each(["source_revision_ref","evidence_ref"] as const)("closes a metric disclosure when its exact %s changes",field=>{
    const m=metric("sales.opportunities.created");m.evidence_ref="test-reference-a";
    mount(props({metrics:[m]}));click("Inspect opportunities created");expect(document.querySelector(".sp-evidence")).toBeTruthy();
    mount(props({metrics:[{...m,[field]:"changed-exact-identity"}]}));expect(document.querySelector(".sp-evidence")).toBeNull();
  });
  it.each(["source","reference","unavailable"])("closes stage disclosure on %s change",change=>{
    mount(props({stageFunnel:funnel,stagePhase:"ready",stageEvidenceRef:"test-stage-ref-a"}));click("Inspect stage evidence");expect(document.querySelector(".sp-evidence")).toBeTruthy();
    mount(props({stageFunnel:change==="source"?{...funnel,source_revision_ref:"changed-stage-source"}:funnel,stagePhase:change==="unavailable"?"unavailable":"ready",stageEvidenceRef:change==="reference"?"test-stage-ref-b":"test-stage-ref-a"}));
    expect(document.querySelector(".sp-evidence")).toBeNull();
  });
  it("expires stage evidence and its open disclosure without another click",()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    const expiring={...funnel,reference_expires_at:new Date(Date.now()+100).toISOString()};
    mount(props({stageFunnel:expiring,stagePhase:"ready",stageEvidenceRef:"test-stage-ref"}));click("Inspect stage evidence");
    act(()=>vi.advanceTimersByTime(101));
    expect(host.querySelector(".sp-stage-bar")).toBeNull();expect(document.querySelector(".sp-evidence")).toBeNull();
  });
  it("expires a metric value and disclosure while a revalidation response is pending",()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    const m=metric("sales.opportunities.created");m.evidence_ref="test-expiring-ref";m.reference_expires_at=new Date(Date.now()+100).toISOString();
    mount(props({metrics:[m]}));click("Inspect opportunities created");
    act(()=>vi.advanceTimersByTime(101));
    expect(document.querySelector(".sp-evidence")).toBeNull();
    expect([...host.querySelectorAll(".sp-activity strong")].map(node=>node.textContent)).not.toContain("7");
  });
});
