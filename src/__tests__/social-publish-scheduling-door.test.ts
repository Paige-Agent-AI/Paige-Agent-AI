import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { world, MINE, PIECE, PUBLICATION, USER, publishBody } from "./social-publish-door.world";
import { socialScheduleChoices } from "../../supabase/functions/_shared/social-publish-command/schedule";
const schedule=socialScheduleChoices("2027-01-02T10:00","UTC")[0],next=socialScheduleChoices("2027-01-03T10:00","UTC")[0];
const args={content_id:PIECE,content_revision:"2026-10-20T10:00:00Z",platform:"instagram",caption:"Original exact caption",account_id:"66666666-6666-4666-8666-666666666666",
 connection_id:"55555555-5555-4555-8555-555555555555",channel_id:null,channel_label:"Northfield Coaching (main)",connection_generation:"2026-10-20T10:00:00Z",schedule:JSON.stringify(schedule),schedule_version:1,approved_by:USER};
const row=()=>({id:PUBLICATION,tenant_id:MINE,content_id:PIECE,platform:"instagram",status:"scheduled",connection_id:args.connection_id,confirmation_id:"99999999-9999-4999-8999-999999999999",provider_request_id:"original-job",request_args:{...args},provider_response:{schedule:{current:schedule,version:1,state:"scheduled"}}});
const change=(operation="reschedule",over:Record<string,unknown>={})=>({action:operation,expected_tenant_id:MINE,content_id:PIECE,publication_id:PUBLICATION,publication_version:1,...(operation==="reschedule"?{schedule:next}:{}),...over});
beforeEach(()=>vi.spyOn(Date,"now").mockReturnValue(Date.parse("2027-01-01T00:00Z")));
afterEach(()=>vi.restoreAllMocks());
describe("original Social future-instruction approval and same-job controls",()=>{
 it("stores the exact future instruction in the one original proposal and returns scheduled separately from published",async()=>{
  const w=world({createPost:i=>({kind:"scheduled",requestId:"original-job",scheduledFor:i.schedule!.scheduled_for,timezone:i.schedule!.timezone,version:1})});
  const body=publishBody({expected_tenant_id:MINE,schedule});const prepared=await w.call(body);
  expect(prepared.body.state).toBe("approval_required");expect(w.seen.createPost).toHaveLength(0);
  expect(w.tables.paige_pending_confirmations[0].args).toMatchObject({schedule:JSON.stringify(schedule),schedule_version:1,connection_generation:args.connection_generation});
  expect(prepared.body.preview).toMatchObject({schedule});
  const accepted=await w.call({...body,approved_fingerprint:(prepared.body.approval as Record<string,unknown>).fingerprint});
  expect(accepted.body).toMatchObject({state:"scheduled",publication_id:PUBLICATION,schedule});expect(accepted.body).not.toHaveProperty("post_url");
  expect(w.seen.createPost).toHaveLength(1);expect(w.tables.content_publications).toHaveLength(1);
  expect((await w.call(body)).body.code).toBe("RETRY_PENDING_RECONCILIATION");expect(w.seen.createPost).toHaveLength(1);
 });
 it("cannot spend an immediate approval on a scheduled instruction, or alter an approved time",async()=>{
  for(const first of [undefined,schedule]){const w=world(),body=publishBody({expected_tenant_id:MINE,...(first?{schedule:first}:{})}),p=await w.call(body);
   await w.call({...body,schedule:next,approved_fingerprint:(p.body.approval as Record<string,unknown>).fingerprint});expect(w.seen.createPost).toHaveLength(0);}
 });
 it("rejects a DST gap, forged offset, past time and expired approval-time window before dispatch",async()=>{
  for(const bad of [{...schedule,scheduled_for:"2026-01-01T00:00:00.000Z"},{...schedule,offset_minutes:60},{...schedule,civil_time:"2027-03-14T02:30",timezone:"America/New_York"}]){
   const w=world();expect((await w.call(publishBody({schedule:bad}))).body.code).toBe("SCHEDULE_INVALID");expect(w.seen.createPost).toHaveLength(0);expect(w.tables.paige_pending_confirmations).toHaveLength(0);}
  const w=world({onBind:()=>vi.mocked(Date.now).mockReturnValue(Date.parse(schedule.scheduled_for))}),body=publishBody({schedule}),p=await w.call(body);
  await w.call({...body,approved_fingerprint:(p.body.approval as Record<string,unknown>).fingerprint});expect(w.seen.createPost).toHaveLength(0);
 });
 it("changes only the same job after a fresh exact approval and rejects an old version",async()=>{
  const w=world({tables:{content_publications:[row()]}}),p=await w.call(change());expect(p.body.state).toBe("approval_required");expect(w.seen.updateSchedule).toHaveLength(0);
  const accepted=await w.call(change("reschedule",{approved_fingerprint:(p.body.approval as Record<string,unknown>).fingerprint}));
  expect(accepted.body).toMatchObject({state:"scheduled",publication_id:PUBLICATION,schedule_version:2,schedule:next});
  expect(w.seen.updateSchedule[0]).toMatchObject({providerId:"original-job",version:1});expect(w.seen.createPost).toHaveLength(0);
  expect(w.tables.content_publications[0].request_args).toEqual(args);
  expect((await w.call(change())).body.code).toBe("SCHEDULE_CHANGED");expect(w.seen.updateSchedule).toHaveLength(1);
 });
 it("requires a separate cancellation approval and never infers cancellation from local state",async()=>{
  const w=world({tables:{content_publications:[row()]}}),p=await w.call(change("cancel_schedule"));expect(w.seen.updateSchedule).toHaveLength(0);
  expect((await w.call(change("cancel_schedule",{approved_fingerprint:(p.body.approval as Record<string,unknown>).fingerprint}))).body.state).toBe("cancelled");
  expect(w.seen.updateSchedule[0].input.cancelSchedule).toBe(true);expect(w.seen.createPost).toHaveLength(0);
 });
 it("preserves a lost edit as UNKNOWN and reconciles only the original same-ID job",async()=>{
  const w=world({tables:{content_publications:[row()]},updateSchedule:()=>({kind:"unknown",requestId:"original-job",reason:"lost"}),readPost:i=>({kind:"scheduled",requestId:"original-job",scheduledFor:i.schedule!.scheduled_for,timezone:i.schedule!.timezone,version:i.scheduleVersion!})}),p=await w.call(change());
  expect((await w.call(change("reschedule",{approved_fingerprint:(p.body.approval as Record<string,unknown>).fingerprint}))).body.state).toBe("outcome_unknown");
  expect((await w.call(change())).body.code).toBe("SCHEDULE_CHANGED");
  expect((await w.call({action:"reconcile",content_id:PIECE,publication_id:PUBLICATION})).body.state).toBe("scheduled");
  expect(w.seen.readPost[0]).toMatchObject({providerId:"original-job",input:{schedule:next,scheduleVersion:2}});expect(w.seen.updateSchedule).toHaveLength(1);expect(w.seen.createPost).toHaveLength(0);
 });
 it("refuses stale connection generation/current authority and rechecks just before the provider mutation",async()=>{
  const rotated=row();rotated.request_args.connection_generation="2026-10-19T00:00:00Z";
  for(const w of [world({tables:{content_publications:[rotated]}}),world({admin:false,tables:{content_publications:[row()]}})]){await w.call(change());expect(w.seen.updateSchedule).toHaveLength(0);expect(w.tables.paige_pending_confirmations).toHaveLength(0);}
  const w=world({tables:{content_publications:[row()]},onScheduleClaim:tables=>{tables.paige_social_connections[0].status="disconnected";}}),p=await w.call(change());
  expect((await w.call(change("reschedule",{approved_fingerprint:(p.body.approval as Record<string,unknown>).fingerprint}))).body.state).toBe("outcome_unknown");expect(w.seen.updateSchedule).toHaveLength(0);
 });
 it("reports an already-published original post without calling its cancellation successful",async()=>{
  const w=world({tables:{content_publications:[row()]},updateSchedule:()=>({kind:"published",requestId:"original-job",results:[{platform:"instagram",success:true,postId:"already-live",postUrl:"https://instagram.com/p/already-live",error:null}]})}),p=await w.call(change("cancel_schedule"));
  const result=await w.call(change("cancel_schedule",{approved_fingerprint:(p.body.approval as Record<string,unknown>).fingerprint}));
  expect(result.body).toMatchObject({ok:false,state:"published",schedule_change_applied:false,publication_id:PUBLICATION});expect(result.body.error).toContain("schedule change was not confirmed");expect(w.seen.createPost).toHaveLength(0);
 });
});
