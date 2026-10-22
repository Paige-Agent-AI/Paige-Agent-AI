import {expect,it,vi} from "vitest";
import {captureClientPortalAuthorization,withClientPortalBusiness} from "./client-portal-scope";
import {PostgrestClient} from "@supabase/postgrest-js";
import {createClient} from "@supabase/supabase-js";
const actor="e0917500-0000-4000-8000-000000000001";
const auth=()=>({getUser:vi.fn(async(_jwt?:string)=>({data:{user:{id:actor}},error:null as unknown})),
 getSession:vi.fn(async()=>({data:{session:{user:{id:actor},access_token:"synthetic-request-token"} as {user:{id:string};access_token:string}|null},error:null as unknown}))});
it("captures only the original verified actor's SDK session",async()=>{
 const source=auth();expect(await captureClientPortalAuthorization(source,actor,()=>true)).toBe("Bearer synthetic-request-token");
 expect(source.getUser).toHaveBeenCalledTimes(2);expect(source.getUser).toHaveBeenNthCalledWith(2,"synthetic-request-token");expect(source.getSession).toHaveBeenCalledTimes(1);
});
it("cached session identity cannot bless a bearer that verifies as another actor",async()=>{
 const source=auth();source.getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:null}).mockResolvedValueOnce({data:{user:{id:"other"}},error:null});
 await expect(captureClientPortalAuthorization(source,actor,()=>true)).rejects.toThrow("Customer session changed");
});
it("refuses another actual actor before reading a token",async()=>{
 const source=auth();source.getUser.mockResolvedValueOnce({data:{user:{id:"other"}},error:null});
 await expect(captureClientPortalAuthorization(source,actor,()=>true)).rejects.toThrow("Customer session changed");
 expect(source.getSession).not.toHaveBeenCalled();
});
it.each(["missing","changed","empty"])("refuses a %s session without returning a bearer",async kind=>{
 const source=auth();source.getSession.mockResolvedValueOnce({data:{session:kind==="missing"?null:{user:{id:kind==="changed"?"other":actor},access_token:kind==="empty"?"":"synthetic-other-token"}},error:null});
 await expect(captureClientPortalAuthorization(source,actor,()=>true)).rejects.toThrow("Customer session changed");
});
it("retired Auth completion cannot read a token",async()=>{
 let current=true;const source=auth();source.getUser.mockImplementationOnce(async()=>{current=false;return {data:{user:{id:actor}},error:null};});
 await expect(captureClientPortalAuthorization(source,actor,()=>current)).rejects.toThrow("Customer request changed");
 expect(source.getSession).not.toHaveBeenCalled();
});
it("retired session completion cannot return its bearer",async()=>{
 let current=true;const source=auth();source.getSession.mockImplementationOnce(async()=>{current=false;return {data:{session:{user:{id:actor},access_token:"synthetic-stale-token"}},error:null};});
 await expect(captureClientPortalAuthorization(source,actor,()=>current)).rejects.toThrow("Customer request changed");
});
it.each(["user","session"])("refuses the existing SDK %s error",async at=>{
 const source=auth();if(at==="user")source.getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:{message:"Synthetic failure"}});
 else source.getSession.mockResolvedValueOnce({data:{session:{user:{id:actor},access_token:"synthetic-request-token"}},error:{message:"Synthetic failure"}});
 await expect(captureClientPortalAuthorization(source,actor,()=>true)).rejects.toThrow("Customer session changed");
});
it("captured native requests do not borrow later shared headers",async()=>{
 const seen:Array<{business:string|null;authorization:string|null}>=[];
 const client=new PostgrestClient("https://tests.invalid/rest/v1",{headers:{Authorization:"Bearer synthetic-shared"},fetch:async(_url,init)=>{
  const headers=new Headers(init?.headers);seen.push({business:headers.get("x-client-portal-business"),authorization:headers.get("Authorization")});
  return new Response("null",{status:200,headers:{"Content-Type":"application/json"}});
 }});
 const a="e0927500-0000-4000-8000-000000000001",b="e0927500-0000-4000-8000-000000000002";
 const first=withClientPortalBusiness(client.rpc("client_portal_conversation"),a).setHeader("Authorization","Bearer synthetic-a");
 const second=withClientPortalBusiness(client.rpc("client_portal_conversation"),b).setHeader("Authorization","Bearer synthetic-b");
 await second;await first;await client.rpc("client_portal_conversation");
 expect(seen).toEqual([{business:b,authorization:"Bearer synthetic-b"},{business:a,authorization:"Bearer synthetic-a"},{business:null,authorization:"Bearer synthetic-shared"}]);
});
it("the original Supabase transport preserves captured actors when its current token changes",async()=>{
 let sharedToken="synthetic-initial";const seen:Array<{business:string|null;authorization:string|null}>=[];
 const client=createClient("https://tests.invalid","synthetic-public-key",{accessToken:async()=>sharedToken,
  global:{fetch:async(_url,init)=>{const headers=new Headers(init?.headers);seen.push({business:headers.get("x-client-portal-business"),authorization:headers.get("Authorization")});
   return new Response("null",{status:200,headers:{"Content-Type":"application/json"}});}}});
 const a="e0927500-0000-4000-8000-000000000001",b="e0927500-0000-4000-8000-000000000002";
 const first=withClientPortalBusiness(client.rpc("client_portal_conversation"),a).setHeader("Authorization","Bearer synthetic-captured-a");
 const second=withClientPortalBusiness(client.rpc("client_portal_conversation"),b).setHeader("Authorization","Bearer synthetic-captured-b");
 sharedToken="synthetic-new-login";await second;await first;await client.rpc("client_portal_conversation");
 expect(seen).toEqual([{business:b,authorization:"Bearer synthetic-captured-b"},{business:a,authorization:"Bearer synthetic-captured-a"},{business:null,authorization:"Bearer synthetic-new-login"}]);
});
