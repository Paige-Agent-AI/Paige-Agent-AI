// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { zernioSocialAdapter } from "../../supabase/functions/_shared/social-provider/zernio";
import { socialScheduleChoices } from "../../supabase/functions/_shared/social-publish-command/schedule";
const target={providerProfileKey:"ps_0123456789abcdef0123456789abcdef01234567",providerAccountId:"account-own",platform:"threads",channelId:null,text:"Exact approved post",externalId:"77777777-7777-4777-8777-777777777777",scheduledMedia:[]};
const schedule=socialScheduleChoices("2027-01-02T10:00","UTC")[0],next=socialScheduleChoices("2027-01-03T10:00","UTC")[0];
const post=(over:Record<string,unknown>={})=>({_id:"request-own",status:"scheduled",content:target.text,scheduledFor:schedule.scheduled_for,timezone:"UTC",
  platforms:[{platform:"threads",accountId:target.providerAccountId,status:"pending"}],metadata:{paigePublicationId:target.externalId,paigeScheduleVersion:1},...over});
function serve(handler:(method:string,index:number)=>unknown|Promise<unknown>){
 const calls:Array<{url:string;init?:RequestInit}>=[];vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(url),init});return Response.json(await handler(init?.method??"GET",calls.length));
 }));return calls;
}
beforeEach(()=>{vi.spyOn(Date,"now").mockReturnValue(Date.parse("2027-01-01T00:00Z"));vi.stubGlobal("Deno",{env:{get:(k:string)=>k==="ZERNIO_API_KEY"?"test-key":undefined},resolveDns:vi.fn().mockResolvedValue(["8.8.8.8"])});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it("creates one exact future instruction and accepts only its same-ID readback",async()=>{
 const calls=serve(()=>({post:post()})),fresh=vi.fn(async()=>{});
 expect(await zernioSocialAdapter.createPost({...target,schedule,beforePublish:fresh})).toEqual({kind:"scheduled",requestId:"request-own",scheduledFor:schedule.scheduled_for,timezone:"UTC",version:1,scheduledMedia:[]});
 expect(calls.map(c=>c.init?.method??"GET")).toEqual(["POST","GET"]);
 const body=JSON.parse(String(calls[0].init?.body));expect(body.scheduledFor).toBe(schedule.scheduled_for);expect(body.timezone).toBe("UTC");expect(body).not.toHaveProperty("publishNow");
 expect(new Headers(calls[0].init?.headers).get("Idempotency-Key")).toBe(target.externalId);expect(fresh).toHaveBeenCalledOnce();
});
it.each([{scheduledFor:next.scheduled_for},{timezone:"America/New_York"},{content:"Changed caption"},{metadata:{paigePublicationId:target.externalId,paigeScheduleVersion:99}},{platforms:[{platform:"threads",accountId:"foreign",status:"pending"}]}])("does not call a mismatched receipt scheduled: %j",async over=>{
 serve((method)=>({post:post(method==="GET"?over:{})}));expect(await zernioSocialAdapter.createPost({...target,schedule})).toMatchObject({kind:"unknown"});
});
it("rejects stale future times before any call and rechecks after preparation",async()=>{
 const calls=serve(()=>({post:post()}));
 vi.mocked(Date.now).mockReturnValue(Date.parse(schedule.scheduled_for));await expect(zernioSocialAdapter.createPost({...target,schedule})).rejects.toMatchObject({code:"schedule_time_expired"});expect(calls).toEqual([]);
 vi.mocked(Date.now).mockReturnValue(Date.parse("2027-01-01T00:00Z"));await expect(zernioSocialAdapter.createPost({...target,schedule,beforePublish:async()=>{vi.mocked(Date.now).mockReturnValue(Date.parse(schedule.scheduled_for));}})).rejects.toMatchObject({code:"schedule_time_expired"});expect(calls).toEqual([]);
});
it("reschedules using only PUT of the same job and a new reviewed version, followed by GET",async()=>{
 const calls=serve((_,index)=>({post:index<3?post():post({scheduledFor:next.scheduled_for,metadata:{paigePublicationId:target.externalId,paigeScheduleVersion:2}})}));
 expect(await zernioSocialAdapter.updateSchedule!({...target,schedule:next,scheduleVersion:2},"request-own",1,"88888888-8888-4888-8888-888888888888",schedule)).toMatchObject({kind:"scheduled",version:2,scheduledFor:next.scheduled_for});
 expect(calls.map(c=>c.init?.method??"GET")).toEqual(["GET","PUT","GET"]);expect(calls.every(c=>c.url.endsWith("/posts/request-own"))).toBe(true);
 const body=JSON.parse(String(calls[1].init?.body));expect(body).toMatchObject({scheduledFor:next.scheduled_for,isDraft:false});expect(body).not.toHaveProperty("content");expect(body).not.toHaveProperty("mediaItems");
});
it("stops the original schedule through verified draft readback and never deletes or recreates",async()=>{
 const calls=serve((_,index)=>({post:index<3?post():post({status:"draft",metadata:{paigePublicationId:target.externalId,paigeScheduleVersion:2}})}));
 expect(await zernioSocialAdapter.updateSchedule!({...target,schedule,scheduleVersion:2,cancelSchedule:true},"request-own",1,"88888888-8888-4888-8888-888888888888",schedule)).toMatchObject({kind:"cancelled",version:2});
 expect(calls.map(c=>c.init?.method??"GET")).toEqual(["GET","PUT","GET"]);expect(JSON.parse(String(calls[1].init?.body)).isDraft).toBe(true);
});
it("keeps a lost change UNKNOWN and does not replay; a later explicit GET can reconcile",async()=>{
 const calls=serve((method)=>{if(method==="PUT")throw Error("lost");return {post:post()};});
 expect(await zernioSocialAdapter.updateSchedule!({...target,schedule:next,scheduleVersion:2},"request-own",1,"88888888-8888-4888-8888-888888888888",schedule)).toMatchObject({kind:"unknown",requestId:"request-own"});
 expect(calls.map(c=>c.init?.method??"GET")).toEqual(["GET","PUT"]);
 const reads=serve(()=>({post:post({scheduledFor:next.scheduled_for,metadata:{paigePublicationId:target.externalId,paigeScheduleVersion:2}})}));
 expect(await zernioSocialAdapter.readPost({...target,schedule:next,scheduleVersion:2},"request-own")).toMatchObject({kind:"scheduled",version:2});expect(reads.map(c=>c.init?.method??"GET")).toEqual(["GET"]);
});
it("refuses an altered, due or already-started job and reports a publication race honestly",async()=>{
 const calls=serve(()=>({post:post({status:"publishing"})}));expect(await zernioSocialAdapter.updateSchedule!({...target,schedule:next,scheduleVersion:2},"request-own",1,"88888888-8888-4888-8888-888888888888",schedule)).toMatchObject({kind:"unknown"});expect(calls).toHaveLength(1);
 const race=serve((_,index)=>({post:index<3?post():post({status:"published",platforms:[{platform:"threads",accountId:target.providerAccountId,status:"published",platformPostId:"native-own",platformPostUrl:"https://www.threads.com/@fixture/post/one"}]})}));
 expect(await zernioSocialAdapter.updateSchedule!({...target,schedule,scheduleVersion:2,cancelSchedule:true},"request-own",1,"88888888-8888-4888-8888-888888888888",schedule)).toMatchObject({kind:"published"});expect(race).toHaveLength(3);
});
it("rejects changed or added media on the existing job before any schedule update",async()=>{
 const calls=serve(()=>({post:post({mediaItems:[{type:"image",url:"https://media.zernio.com/unapproved.png"}]})}));
 expect(await zernioSocialAdapter.updateSchedule!({...target,schedule:next,scheduleVersion:2},"request-own",1,"88888888-8888-4888-8888-888888888888",schedule)).toMatchObject({kind:"unknown"});expect(calls.map(c=>c.init?.method??"GET")).toEqual(["GET"]);
 expect(await zernioSocialAdapter.readPost({...target,schedule,scheduleVersion:1},"request-own")).toMatchObject({kind:"unknown"});
});
it("binds exact uploaded media URLs to the future job and retains that proof if readback differs",async()=>{
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10]),asset={type:"image" as const,contentType:"image/png",size:bytes.length,altText:"Approved image",readBytes:async()=>bytes};
 const uploaded={type:"image",url:"https://media.zernio.com/temp/approved.png",altText:"Approved image"};let changed=false;
 vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(String(url).endsWith("/media/presign"))return Response.json({uploadUrl:"https://test-bucket.r2.cloudflarestorage.com/temp/approved.png?X-Amz-Signature=sample",publicUrl:uploaded.url,key:"temp/approved.png",expiresIn:3600});
  if(String(url).includes("cloudflarestorage.com"))return new Response(null,{status:200});
  return Response.json({post:post({mediaItems:[changed?{...uploaded,url:"https://media.zernio.com/changed.png"}:uploaded]})});
 }));
 expect(await zernioSocialAdapter.createPost({...target,schedule,media:[asset],beforePublish:async()=>{}})).toMatchObject({kind:"scheduled",scheduledMedia:[uploaded]});
 changed=true;expect(await zernioSocialAdapter.createPost({...target,schedule,media:[asset],beforePublish:async()=>{}})).toMatchObject({kind:"unknown",scheduledMedia:[uploaded]});
});
it.each([undefined,"999999999999999999"])("refuses a missing or changed pinned Discord channel before PUT and during readback: %s",async channel=>{
 const discord={...target,platform:"discord",channelId:"111111111111111111",schedule:next,scheduleVersion:2};
 const entry={platform:"discord",accountId:target.providerAccountId,status:"pending",...(channel?{platformSpecificData:{channelId:channel}}:{})};
 const calls=serve((_,index)=>({post:post({scheduledFor:index<3?schedule.scheduled_for:next.scheduled_for,platforms:[entry],metadata:{paigePublicationId:target.externalId,paigeScheduleVersion:index<3?1:2}})}));
 expect(await zernioSocialAdapter.updateSchedule!(discord,"request-own",1,"88888888-8888-4888-8888-888888888888",schedule)).toMatchObject({kind:"unknown"});
 expect(calls.map(c=>c.init?.method??"GET")).toEqual(["GET"]);
 expect(await zernioSocialAdapter.readPost({...discord,schedule,scheduleVersion:1},"request-own")).toMatchObject({kind:"unknown"});
});
it("accepts the exact original Discord channel on same-job future readback",async()=>{
 const discord={...target,platform:"discord",channelId:"111111111111111111",schedule:next,scheduleVersion:2};
 const calls=serve((_,index)=>({post:post({scheduledFor:index<3?schedule.scheduled_for:next.scheduled_for,
  platforms:[{platform:"discord",accountId:target.providerAccountId,status:"pending",platformSpecificData:{channelId:discord.channelId}}],
  metadata:{paigePublicationId:target.externalId,paigeScheduleVersion:index<3?1:2}})}));
 expect(await zernioSocialAdapter.updateSchedule!(discord,"request-own",1,"88888888-8888-4888-8888-888888888888",schedule)).toMatchObject({kind:"scheduled",version:2});
 expect(calls.map(c=>c.init?.method??"GET")).toEqual(["GET","PUT","GET"]);
});
it.each([{scheduledFor:"2027-01-04T10:00:00.000Z"},{customContent:"Unapproved caption"},{customMedia:[{type:"image",url:"https://media.zernio.com/unapproved.png"}]},{platformSpecificData:{firstComment:"Unapproved additional message"}}])("refuses divergent effective per-target instructions before PUT and on readback: %j",async override=>{
 const entry={platform:"threads",accountId:target.providerAccountId,status:"pending",...override};
 const calls=serve((_,index)=>({post:post({scheduledFor:index<3?schedule.scheduled_for:next.scheduled_for,platforms:[entry],metadata:{paigePublicationId:target.externalId,paigeScheduleVersion:index<3?1:2}})}));
 expect(await zernioSocialAdapter.updateSchedule!({...target,schedule:next,scheduleVersion:2},"request-own",1,"88888888-8888-4888-8888-888888888888",schedule)).toMatchObject({kind:"unknown"});
 expect(calls.map(c=>c.init?.method??"GET")).toEqual(["GET"]);
 expect(await zernioSocialAdapter.readPost({...target,schedule,scheduleVersion:1},"request-own")).toMatchObject({kind:"unknown"});
});
it("does not PUT a new root time while retaining an existing platform time override",async()=>{
 const calls=serve(()=>({post:post({platforms:[{platform:"threads",accountId:target.providerAccountId,status:"pending",scheduledFor:schedule.scheduled_for}]})}));
 expect(await zernioSocialAdapter.updateSchedule!({...target,schedule:next,scheduleVersion:2},"request-own",1,"88888888-8888-4888-8888-888888888888",schedule)).toMatchObject({kind:"unknown"});expect(calls).toHaveLength(1);
});
it.each(["create","read","change"])("does not accept unapproved root recycling as one future instruction: %s",async operation=>{
 const calls=serve((_,index)=>({post:post({recycling:{gap:1,gapFreq:"week",expireCount:3},
  scheduledFor:index<3?schedule.scheduled_for:next.scheduled_for,metadata:{paigePublicationId:target.externalId,paigeScheduleVersion:index<3?1:2}})}));
 const outcome=operation==="create"?await zernioSocialAdapter.createPost({...target,schedule}):operation==="read"?await zernioSocialAdapter.readPost({...target,schedule,scheduleVersion:1},"request-own")
  :await zernioSocialAdapter.updateSchedule!({...target,schedule:next,scheduleVersion:2},"request-own",1,"88888888-8888-4888-8888-888888888888",schedule);
 expect(outcome).toMatchObject({kind:"unknown"});
 if(operation==="change")expect(calls.map(c=>c.init?.method??"GET")).toEqual(["GET"]);
});
