import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc:vi.fn(),session:vi.fn(),from:vi.fn(),select:vi.fn(),eq:vi.fn(),one:vi.fn(),many:vi.fn(),contains:vi.fn() }));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:mock.rpc,from:mock.from,auth:{getSession:mock.session}}}));
import { prepareEngagementHandoff } from "./operations-engagement-handoff";
import { inspectOriginalHandoff } from "./operations-handoff-recovery";
const id=(n:number)=>`eb810000-0000-4000-8000-${n.toString().padStart(12,"0")}`;
const scope={actorId:id(1),tenantId:id(2),contactId:id(3),commercialTermsId:id(4),offerId:id(5),termsUpdatedAt:"2026-10-09T12:00:00Z",commercialStatus:"active"};
const evidence={tenantId:id(2),agreementId:id(6),contactId:id(3),commercialTermsId:id(4),offerId:id(5),version:3,status:"completed",completedAt:scope.termsUpdatedAt,contentSha256:"a".repeat(64),sealedSha256:"b".repeat(64),sealedCopyRecorded:true};
const request=prepareEngagementHandoff(scope,evidence,{title:"Launch",summary:null,ownerUserId:id(1),startsOn:"2026-10-09",endsOn:"2026-10-20",milestones:[{title:"Review",assignedToUserId:id(7),priority:"normal"}]},id(8),[id(1),id(7)])!;
const source={agreement_id:id(6),commercial_terms_id:id(4),offer_id:id(5),contact_id:id(3),version:3,request_id:id(8),content_sha256:evidence.contentSha256,sealed_sha256:evidence.sealedSha256,terms_updated_at:scope.termsUpdatedAt,milestone_ids:[id(10)]};
const project={id:id(9),tenant_id:id(2),title:"Launch",summary:null,owner_user_id:id(1),starts_on:request.p_starts_on,ends_on:request.p_ends_on,metadata:{operations_engagement:source}};
const step={id:id(10),tenant_id:id(2),plan_id:id(9),item_type:"milestone",title:"Review",summary:null,assigned_to_user_id:id(7),priority:"normal",due_at:null,contact_id:id(3),metadata:{operations_engagement:{agreement_id:id(6),commercial_terms_id:id(4),version:3}}};
beforeEach(()=>{
 vi.resetAllMocks();mock.session.mockResolvedValue({data:{session:{user:{id:id(1)}}},error:null});
 mock.rpc.mockResolvedValue({data:{ok:true,actor_id:id(1),tenant_id:id(2),plan_id:id(9),milestone_ids:[id(10)],replayed:false,client_accepted:false},error:null});
 mock.from.mockReturnValue({select:mock.select});mock.select.mockReturnValue({eq:mock.eq});mock.eq.mockReturnValue({eq:mock.eq,in:mock.many,contains:mock.contains,maybeSingle:mock.one});mock.contains.mockReturnValue({maybeSingle:mock.one});
 mock.one.mockResolvedValue({data:project,error:null});mock.many.mockResolvedValue({data:[step],error:null});
});

it("recovers original persisted work without a write or automatic retry",async()=>{
 expect(await inspectOriginalHandoff(request)).toEqual({kind:"verified",planId:id(9),milestoneIds:[id(10)]});
 expect(mock.rpc).not.toHaveBeenCalled();expect(mock.contains).toHaveBeenCalledWith("metadata",{operations_engagement:{request_id:id(8),agreement_id:id(6)}});
});
it("missing readable project never proves earlier transaction failed",async()=>{
 mock.one.mockResolvedValue({data:null,error:null});expect(await inspectOriginalHandoff(request)).toMatchObject({kind:"not_found"});expect(mock.rpc).not.toHaveBeenCalled();
});
it("actor change refuses recovery",async()=>{
 mock.session.mockResolvedValue({data:{session:{user:{id:id(11)}}},error:null});expect((await inspectOriginalHandoff(request)).kind).toBe("refused");expect(mock.from).not.toHaveBeenCalled();
});
it("late actor change cannot verify recovered work",async()=>{
 mock.session.mockResolvedValueOnce({data:{session:{user:{id:id(1)}}},error:null}).mockResolvedValueOnce({data:{session:{user:{id:id(11)}}},error:null});expect((await inspectOriginalHandoff(request)).kind).toBe("unavailable");
});
it.each(["agreement_id","request_id","version","commercial_terms_id","contact_id","offer_id","sealed_sha256"])("mismatched original source %s never verifies",async field=>{
 mock.one.mockResolvedValue({data:{...project,metadata:{operations_engagement:{...source,[field]:"changed"}}},error:null});expect((await inspectOriginalHandoff(request)).kind).toBe("unavailable");
});
it("duplicate original milestone identity refuses recovery",async()=>{
 mock.one.mockResolvedValue({data:{...project,metadata:{operations_engagement:{...source,milestone_ids:[id(10),id(10)]}}},error:null});expect((await inspectOriginalHandoff(request)).kind).toBe("unavailable");
});
it.each(["tenant_id","plan_id","contact_id","assigned_to_user_id"])("mismatched current work %s remains unconfirmed",async field=>{
 mock.many.mockResolvedValue({data:[{...step,[field]:"changed"}],error:null});expect((await inspectOriginalHandoff(request)).kind).toBe("unavailable");
});
it("reader outage does not activate work",async()=>{
 mock.one.mockRejectedValue(new Error("offline"));expect((await inspectOriginalHandoff(request)).kind).toBe("unavailable");expect(mock.rpc).not.toHaveBeenCalled();
});
