import {expect,it} from "vitest";
import {createClient} from "@supabase/supabase-js";
it("the original Storage SDK pins each captured actor while shared Auth changes and adds no business header",async()=>{
 let shared="synthetic-current-a";
 const seen:Array<{path:string;authorization:string|null;business:string|null;upsert:string|null}>=[];
 const client=createClient("https://storage.tests.invalid","synthetic-public-key",{accessToken:async()=>shared,global:{fetch:async(url,init)=>{
  const headers=new Headers(init?.headers);const path=String(url);seen.push({path,authorization:headers.get("Authorization"),business:headers.get("x-client-portal-business"),upsert:headers.get("x-upsert")});
  return new Response(JSON.stringify(path.includes("/sign/")?{signedURL:"/object/sign/client-files/test?token=synthetic"}:{Id:"synthetic-object",Key:"client-files/test"}),{status:200,headers:{"Content-Type":"application/json"}});
 }}});
 const original=client.storage.from("client-files").setHeader("Authorization","Bearer synthetic-captured-a");
 shared="synthetic-current-b";
 const next=client.storage.from("client-files").setHeader("Authorization","Bearer synthetic-captured-b");
 const b=await next.createSignedUrl("test-tenant-b/test-client/file.pdf",60);
 const a=await original.createSignedUrl("test-tenant-a/test-client/file.pdf",60,{download:"file.pdf"});
 const upload=await original.upload("test-tenant-a/test-client/upload.pdf",new Uint8Array([1,2,3]),{contentType:"application/pdf",upsert:false});
 await client.storage.from("client-files").createSignedUrl("test-tenant-b/test-client/default.pdf",60);
 expect([b.error,a.error,upload.error]).toEqual([null,null,null]);
 expect(seen.map(r=>r.authorization)).toEqual(["Bearer synthetic-captured-b","Bearer synthetic-captured-a","Bearer synthetic-captured-a","Bearer synthetic-current-b"]);
 expect(seen.every(r=>r.business===null)).toBe(true);expect(seen[2].upsert).toBe("false");
});
