import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({listener:((_event?:string)=>{}),removeQueries:vi.fn(),mounts:0,actor:"first"}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{onAuthStateChange:(listener:(event?:string)=>void)=>{mocks.listener=listener;return{data:{subscription:{unsubscribe:()=>{}}}};}}}}));
vi.mock("@tanstack/react-query",()=>({useQueryClient:()=>({removeQueries:mocks.removeQueries})}));
vi.mock("./useSalesPerformanceMetrics",()=>({useSalesPerformanceMetrics:()=>({metrics:[],phase:"ready",retry:()=>{},unavailableKeys:{}})}));
vi.mock("../../data/useAnalyticsEvidence",()=>({useAnalyticsEvidence:()=>{const[actor]=React.useState(()=>{mocks.mounts++;return mocks.actor;});return{bundle:{actor},loading:false,isError:false,retry:()=>{}};}}));
vi.mock("./SalesPerformance",()=>({SalesPerformance:({stageFunnel}:{stageFunnel:{actor:string}})=><output>{stageFunnel.actor}</output>}));
import { SalesPerformanceWorkspace } from "./SalesPerformanceWorkspace";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{mocks.removeQueries.mockClear();mocks.mounts=0;mocks.actor="first";});
it("keeps the mounted consumers and original reference cache on INITIAL_SESSION",async()=>{
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(<SalesPerformanceWorkspace epoch="test-workspace" onNavigate={()=>{}}/>));
  await act(async()=>mocks.listener("INITIAL_SESSION"));
  expect(host.textContent).toBe("first");expect(mocks.mounts).toBe(1);expect(mocks.removeQueries).not.toHaveBeenCalled();
 } finally {act(()=>root.unmount());host.remove();}
});
it.each(["SIGNED_OUT","SIGNED_IN","TOKEN_REFRESHED","USER_UPDATED"])("clears actor-bound caches and remounts consumers on %s",async event=>{
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(<SalesPerformanceWorkspace epoch="test-workspace" onNavigate={()=>{}}/>));
  mocks.actor="second";await act(async()=>mocks.listener(event));
  expect(host.textContent).toBe("second");expect(mocks.mounts).toBe(2);expect(mocks.removeQueries).toHaveBeenCalledTimes(1);
 } finally {act(()=>root.unmount());host.remove();}
});
it("remounts the legacy stage consumer and removes actor-bound caches on same-workspace auth change",async()=>{
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(<SalesPerformanceWorkspace epoch="test-workspace" onNavigate={()=>{}}/>));
 expect(host.textContent).toBe("first");mocks.actor="second";await act(async()=>mocks.listener());
 expect(host.textContent).toBe("second");expect(mocks.mounts).toBe(2);
 const predicate=mocks.removeQueries.mock.calls[0][0].predicate;
 expect(predicate({queryKey:["analytics-evidence","metric","month","test-workspace"]})).toBe(true);
 expect(predicate({queryKey:["analytics-evidence-revalidation","metric","month","test-workspace","ref"]})).toBe(true);
 expect(predicate({queryKey:["analytics-evidence","metric","month","other-workspace"]})).toBe(false);
 act(()=>root.unmount());host.remove();
});
