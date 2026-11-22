// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { zernioSocialAdapter } from "../../supabase/functions/_shared/social-provider/zernio.ts";
const input={providerProfileKey:"ps_0123456789abcdef0123456789abcdef01234567",providerAccountId:"account-own",platform:"threads",requestId:"request-own",postId:"native-own"};
const platform={platform:"threads",accountId:"account-own",platformPostId:"native-own",syncStatus:"synced",analytics:{views:0,likes:2,comments:null,shares:4,impressions:999,lastUpdated:"2026-11-13T16:00:00Z"}};
function serve(body:unknown,status=200) {
  const calls:string[]=[];vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
    calls.push(String(url));expect(init?.method??"GET").toBe("GET");
    return String(url).includes("/profiles?")?Response.json({profiles:[{_id:"profile-own",externalId:input.providerProfileKey}]}):Response.json(body,{status});
  }));return calls;
}
beforeEach(()=>vi.stubGlobal("Deno",{env:{get:(k:string)=>k==="ZERNIO_API_KEY"?"test-key":undefined},resolveDns:vi.fn().mockResolvedValue(["8.8.8.8"])}));
afterEach(()=>vi.unstubAllGlobals());
it("reads the exact original provider/account/post and retains actual zero while omitting absent/irrelevant counters",async()=>{
  const calls=serve({postId:"external-own",latePostId:input.requestId,syncStatus:"synced",analytics:{likes:9999},platformAnalytics:[platform]});
  expect(await zernioSocialAdapter.readPerformance!(input)).toEqual({state:"available",metrics:{views:0,likes:2,shares:4},measured_at:"2026-11-13T16:00:00Z"});
  const q=new URL(calls[1]).searchParams;expect(q.get("postId")).toBe(input.requestId);expect(q.get("accountId")).toBe(input.providerAccountId);expect(q.get("profileId")).toBe("profile-own");expect(q.get("platform")).toBe("threads");
});
it.each([{accountId:"foreign"},{platformPostId:"foreign"},{platform:"instagram"}])("rejects a response from a different exact source %j",async over=>{
  serve({postId:input.requestId,syncStatus:"synced",platformAnalytics:[{...platform,...over}]});
  expect(await zernioSocialAdapter.readPerformance!(input)).toEqual({state:"error",metrics:{},measured_at:null});
});
it("does not use cross-account totals or invent zeros when the platform is pending",async()=>{
  serve({postId:input.requestId,syncStatus:"pending",analytics:{views:99},platformAnalytics:[]},202);
  expect(await zernioSocialAdapter.readPerformance!(input)).toEqual({state:"pending",metrics:{},measured_at:null});
});
it.each([[402,"unsupported"],[404,"pending"],[424,"error"],[503,"error"]])("preserves refusal %s as %s without mutation or retries",async(status,state)=>{
  const calls=serve({error:"raw sensitive provider error"},Number(status));
  expect(await zernioSocialAdapter.readPerformance!(input)).toEqual({state,metrics:{},measured_at:null});expect(calls).toHaveLength(2);
});
it("requires the response's original request linkage, even with a matching native post",async()=>{
  serve({postId:"foreign-request",syncStatus:"synced",platformAnalytics:[platform]});
  expect(await zernioSocialAdapter.readPerformance!(input)).toMatchObject({state:"error",metrics:{}});
});
