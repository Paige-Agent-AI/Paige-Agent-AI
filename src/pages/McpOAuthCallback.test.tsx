import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
const h=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{functions:{invoke:h.invoke}}}));
import McpOAuthCallback from "./McpOAuthCallback";
import { armOAuthReturn } from "@/solo/data/oauthReturn";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|null=null;let host:HTMLDivElement;let location={pathname:"",search:""};
function Location(){const value=useLocation();location=value;return null;}
async function render(data:unknown){
  armOAuthReturn("/solo/test-account/settings/integrations");
  h.invoke.mockResolvedValue({data,error:null});host=document.createElement("div");root=createRoot(host);
  await act(async()=>root!.render(<StrictMode><MemoryRouter initialEntries={["/oauth/mcp/callback?code=fixture-code&state=fixture-state"]}>
    <Location/><Routes><Route path="/oauth/mcp/callback" element={<McpOAuthCallback/>}/>
      <Route path="/solo/test-account/settings/integrations" element={<p>Integration settings</p>}/></Routes>
  </MemoryRouter></StrictMode>));
}
afterEach(()=>{act(()=>root?.unmount());root=null;h.invoke.mockReset();window.sessionStorage.clear();});
describe("original MCP OAuth callback recovery",()=>{
  it("keeps a lost save response unconfirmed, clears callback values and offers current-state inspection without replay",async()=>{
    await render({error:"oauth_store_unconfirmed"});
    expect(host.textContent).toContain("final status could not be confirmed");
    expect(host.querySelector("h1")?.textContent).toBe("Connection status unconfirmed");
    expect(host.textContent).not.toContain("Saved, but not working yet");
    expect(location.search).toBe("");expect(location.pathname).toBe("/oauth/mcp/callback");
    expect(h.invoke).toHaveBeenCalledTimes(1);
    await act(async()=>host.querySelector("button")!.click());
    expect(host.textContent).toContain("Integration settings");expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("fixture-code");
  });
  it("returns only a provider-probed connection to its original safe settings path",async()=>{
    await render({ok:true,status:"connected"});
    expect(location.pathname).toBe("/solo/test-account/settings/integrations");
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it("keeps a stored but failed probe separate from connected and from an uncertain save",async()=>{
    await render({ok:true,status:"error",code:"mcp_http_error"});
    expect(host.textContent).toContain("Saved, but not working yet");
    expect(location.pathname).toBe("/oauth/mcp/callback");expect(h.invoke).toHaveBeenCalledTimes(1);
  });
});
