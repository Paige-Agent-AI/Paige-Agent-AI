import {describe,expect,it} from "vitest";
import {PostgrestClient} from "@supabase/postgrest-js";
import {isClientPortalBusinessId,withClientPortalBusiness} from "./client-portal-scope";
const a = "e0925000-0000-0000-0000-000000000001";
const b = "e0925000-0000-0000-0000-000000000002";
describe("original SDK request business hint", () => {
  it.each([undefined,"", "tenant", " "+a, a.toUpperCase(), null, {}, 12])("rejects malformed hint %s", value => {
    expect(isClientPortalBusinessId(value)).toBe(false);
  });
  it("rejects invalid hints before awaiting a request", () => {
    let called = false; const request = {setHeader() {called = true; return this;}};
    expect(() => withClientPortalBusiness(request,"invalid")).toThrow("Customer business could not be checked");
    expect(called).toBe(false); expect(withClientPortalBusiness(request,null)).toBe(request);
  });
  it("captures independent original PostgREST headers without mutating later/unscoped requests", async () => {
    const seen: Array<string | null> = [];
    const client = new PostgrestClient("https://tests.invalid/rest/v1", {fetch: async (_url,init) => {
      seen.push(new Headers(init?.headers).get("x-client-portal-business"));
      return new Response("null",{status:200,headers:{"Content-Type":"application/json"}});
    }});
    const first = withClientPortalBusiness(client.rpc("client_portal_frame"),a);
    const second = withClientPortalBusiness(client.rpc("client_portal_frame"),b);
    const bare = withClientPortalBusiness(client.rpc("client_portal_frame"),null);
    await second; await first; await bare;
    expect(seen).toEqual([b,a,null]);
  });
});
