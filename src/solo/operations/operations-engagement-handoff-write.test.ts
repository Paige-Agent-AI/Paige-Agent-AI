import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc:vi.fn(),session:vi.fn(),from:vi.fn(),select:vi.fn(),eq:vi.fn(),one:vi.fn(),many:vi.fn() }));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:mock.rpc,from:mock.from,auth:{getSession:mock.session}}}));
import { prepareEngagementHandoff } from "./operations-engagement-handoff";
import { writeEngagementHandoff } from "./operations-engagement-handoff-write";
const id=(n:number)=>`eb810000-0000-4000-8000-${n.toString().padStart(12,"0")}`;
const scope={actorId:id(1),tenantId:id(2),contactId:id(3),commercialTermsId:id(4),offerId:id(5),termsUpdatedAt:"2026-10-09T12:00:00Z",commercialStatus:"active"};
const evidence={tenantId:id(2),agreementId:id(6),contactId:id(3),commercialTermsId:id(4),offerId:id(5),version:3,status:"completed",completedAt:scope.termsUpdatedAt,contentSha256:"a".repeat(64),sealedSha256:"b".repeat(64),sealedCopyRecorded:true};
const request=prepareEngagementHandoff(scope,evidence,{title:"Launch",summary:null,ownerUserId:id(1),startsOn:"2026-10-09",endsOn:"2026-10-20",milestones:[{title:"Review",assignedToUserId:id(7),priority:"normal"}]},id(8),[id(1),id(7)])!;
const source={agreement_id:id(6),commercial_terms_id:id(4),offer_id:id(5),contact_id:id(3),version:3,request_id:id(8),content_sha256:evidence.contentSha256,sealed_sha256:evidence.sealedSha256,terms_updated_at:scope.termsUpdatedAt};
const project={id:id(9),tenant_id:id(2),title:"Launch",summary:null,owner_user_id:id(1),starts_on:request.p_starts_on,ends_on:request.p_ends_on,metadata:{operations_engagement:source}};
const step={id:id(10),tenant_id:id(2),plan_id:id(9),item_type:"milestone",title:"Review",summary:null,assigned_to_user_id:id(7),priority:"normal",due_at:null,contact_id:id(3),metadata:{operations_engagement:{agreement_id:id(6),commercial_terms_id:id(4),version:3}}};
beforeEach(()=>{
 vi.resetAllMocks();mock.session.mockResolvedValue({data:{session:{user:{id:id(1)}}},error:null});
 mock.rpc.mockResolvedValue({data:{ok:true,actor_id:id(1),tenant_id:id(2),plan_id:id(9),milestone_ids:[id(10)],replayed:false,client_accepted:false},error:null});
 mock.from.mockReturnValue({select:mock.select});mock.select.mockReturnValue({eq:mock.eq});mock.eq.mockReturnValue({eq:mock.eq,in:mock.many,maybeSingle:mock.one});
 mock.one.mockResolvedValue({data:project,error:null});mock.many.mockResolvedValue({data:[step],error:null});
});
it("verifies original project and assigned milestones only after independent caller readback",async()=>{
 expect(await writeEngagementHandoff(request)).toEqual({kind:"verified",planId:id(9),milestoneIds:[id(10)],replayed:false});
 expect(mock.rpc).toHaveBeenCalledWith("operations_engagement_handoff",request);expect(mock.eq).toHaveBeenCalledWith("tenant_id",id(2));
});
it("actor switch before execution cannot write",async()=>{
 mock.session.mockResolvedValue({data:{session:{user:{id:id(11)}}},error:null});
 expect((await writeEngagementHandoff(request)).kind).toBe("refused");expect(mock.rpc).not.toHaveBeenCalled();
});
it("late actor switch cannot verify a write",async()=>{
 mock.session.mockResolvedValueOnce({data:{session:{user:{id:id(1)}}},error:null}).mockResolvedValueOnce({data:{session:{user:{id:id(11)}}},error:null});
 expect((await writeEngagementHandoff(request)).kind).toBe("uncertain");
});
it.each(["42501","22023","23514","40001"])("preserves source or authority refusal %s",async code=>{
 mock.rpc.mockResolvedValue({data:null,error:{code}});expect((await writeEngagementHandoff(request)).kind).toBe("refused");expect(mock.from).not.toHaveBeenCalled();
});
it("lost response is unknown and never automatically replayed",async()=>{
 mock.rpc.mockRejectedValue(new Error("lost"));expect((await writeEngagementHandoff(request)).kind).toBe("uncertain");expect(mock.rpc).toHaveBeenCalledOnce();
});
it("foreign acknowledgement cannot select its project",async()=>{
 mock.rpc.mockResolvedValue({data:{ok:true,actor_id:id(1),tenant_id:id(11)},error:null});
 expect((await writeEngagementHandoff(request)).kind).toBe("uncertain");expect(mock.from).not.toHaveBeenCalled();
});
it.each(["tenant_id","title","owner_user_id"])("mismatched project %s is not verified",async field=>{
 mock.one.mockResolvedValue({data:{...project,[field]:"changed"},error:null});expect((await writeEngagementHandoff(request)).kind).toBe("uncertain");
});
it.each(["commercial_terms_id","version","request_id","content_sha256"])("mismatched source %s is not verified",async field=>{
 mock.one.mockResolvedValue({data:{...project,metadata:{operations_engagement:{...source,[field]:"changed"}}},error:null});expect((await writeEngagementHandoff(request)).kind).toBe("uncertain");
});
it.each(["tenant_id","plan_id","assigned_to_user_id","contact_id","title"])("mismatched milestone %s is not verified",async field=>{
 mock.many.mockResolvedValue({data:[{...step,[field]:"changed"}],error:null});expect((await writeEngagementHandoff(request)).kind).toBe("uncertain");
});
it("missing or unavailable milestones remain unconfirmed",async()=>{
 mock.many.mockResolvedValue({data:[],error:null});expect((await writeEngagementHandoff(request)).kind).toBe("uncertain");
});
