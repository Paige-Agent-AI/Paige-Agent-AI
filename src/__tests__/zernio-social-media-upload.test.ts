// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zernioSocialAdapter } from "../../supabase/functions/_shared/social-provider/zernio.ts";
const bytes = new Uint8Array([137, 80, 78, 71, 255, 0, 254, 128]);
const target = { providerProfileKey: "ps_0123456789abcdef0123456789abcdef01234567", providerAccountId: "66b2e19d8c3f5a7e9d0b1c2d",
  platform: "threads", channelId: null, text: "A saved image.", externalId: "77777777-7777-4777-8777-777777777777", beforePublish: async()=>{} };
const media = () => ({type:"image" as const,contentType:"image/png",size:bytes.length,altText:"Original sample",readBytes:vi.fn().mockResolvedValue(bytes)});
const presign = {uploadUrl:"https://test-bucket.r2.cloudflarestorage.com/temp/test.png?X-Amz-Signature=sample",publicUrl:"https://media.zernio.com/temp/test.png",key:"temp/test.png",expiresIn:3600};
function serve(over: Partial<typeof presign> = {}, uploadStatus=200, postStatus=201) {
  const calls: Array<{url:string;init:RequestInit|undefined}> = [];
  vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
    const address=String(url);calls.push({url:address,init});
    if(address.endsWith("/media/presign")) return Response.json({...presign,...over});
    if(address.includes("cloudflarestorage.com")) return new Response(null,{status:uploadStatus});
    return Response.json({post:{_id:"66b2e19d8c3f5a7e9d0b1c9f",status:"publishing",platforms:[{platform:"threads",accountId:target.providerAccountId,status:"processing"}]}},{status:postStatus});
  }));return calls;
}
beforeEach(()=>vi.stubGlobal("Deno",{env:{get:(k:string)=>k==="ZERNIO_API_KEY"?"zk_test":undefined},resolveDns:vi.fn().mockResolvedValue(["8.8.8.8"])}));
afterEach(()=>vi.unstubAllGlobals());
describe("media upload in the original Zernio publication adapter",()=>{
  it("uploads exact approved bytes and sends only the provider URL on the original once-only post",async()=>{
    const calls=serve(),m=media();
    expect(await zernioSocialAdapter.createPost({...target,media:[m]})).toMatchObject({kind:"processing"});
    expect(calls.map(c=>c.init?.method)).toEqual(["POST","PUT","POST"]);
    expect(calls[1].init?.body).toEqual(bytes);
    expect(new Headers(calls[1].init?.headers).has("Authorization")).toBe(false);
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer zk_test");
    const post=JSON.parse(String(calls[2].init?.body));
    expect(post.mediaItems).toEqual([{url:presign.publicUrl,type:"image",altText:"Original sample"}]);
    expect(new Headers(calls[2].init?.headers).get("Idempotency-Key")).toBe(target.externalId);
    expect(post.platforms).toHaveLength(1);expect(post.platforms[0].accountId).toBe(target.providerAccountId);
    expect(m.readBytes).toHaveBeenCalledOnce();
  });
  it.each([
    {uploadUrl:"https://foreign.example/temp/test.png"},
    {uploadUrl:"https://test-bucket.r2.cloudflarestorage.com/another.png?X-Amz-Signature=sample"},
    {publicUrl:"https://foreign.example/temp/test.png"},
    {publicUrl:presign.publicUrl+"?secret=sample"},
    {key:"../test.png"}, {expiresIn:0},
  ])("refuses an unsafe upload/public reference before PUT or post %j",async over=>{
    const calls=serve(over);
    await expect(zernioSocialAdapter.createPost({...target,media:[media()]})).rejects.toMatchObject({code:"provider_media_unavailable"});
    expect(calls).toHaveLength(1);
  });
  it("does not create a post when the upload fails",async()=>{
    const calls=serve({},503);
    await expect(zernioSocialAdapter.createPost({...target,media:[media()]})).rejects.toMatchObject({code:"provider_media_unavailable"});
    expect(calls).toHaveLength(2);
  });
  it("refuses changed bytes before presign and preserves uncertain post results without another send",async()=>{
    const calls=serve({},200,503),m=media();m.readBytes.mockResolvedValueOnce(bytes.slice(0,2));
    await expect(zernioSocialAdapter.createPost({...target,media:[m]})).rejects.toMatchObject({code:"provider_media_unavailable"});
    expect(calls).toEqual([]);
    expect(await zernioSocialAdapter.createPost({...target,media:[media()]})).toMatchObject({kind:"unknown"});
    expect(calls.filter(c=>c.url.endsWith("/posts"))).toHaveLength(1);
  });
  it("refuses unsupported media destinations before reading bytes or provider calls",async()=>{
    const calls=serve(),m=media();
    await expect(zernioSocialAdapter.createPost({...target,platform:"instagram",media:[m]})).rejects.toMatchObject({code:"media_platform_unsupported"});
    expect(m.readBytes).not.toHaveBeenCalled();expect(calls).toEqual([]);
  });
  it("checks current authority after PUT and refuses before the social POST",async()=>{
    const calls=serve();
    const beforePublish=vi.fn(async()=>{expect(calls.map(c=>c.init?.method)).toEqual(["POST","PUT"]);throw Error("revoked");});
    await expect(zernioSocialAdapter.createPost({...target,media:[media()],beforePublish})).rejects.toMatchObject({code:"approval_context_changed"});
    expect(beforePublish).toHaveBeenCalledOnce();expect(calls.filter(c=>c.url.endsWith("/posts"))).toEqual([]);
  });
  it("refuses two Threads videos before bytes or provider effects",async()=>{
    const calls=serve(),m={...media(),type:"video" as const,contentType:"video/mp4"};
    await expect(zernioSocialAdapter.createPost({...target,media:[m,m]})).rejects.toMatchObject({code:"media_count_exceeded"});
    expect(m.readBytes).not.toHaveBeenCalled();expect(calls).toEqual([]);
  });
});
