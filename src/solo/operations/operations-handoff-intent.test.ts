import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareEngagementHandoff } from "./operations-engagement-handoff";
import { retainPendingHandoff,readPendingHandoff,clearPendingHandoff } from "./operations-handoff-intent";
const id=(n:number)=>`eb810000-0000-4000-8000-${n.toString().padStart(12,"0")}`;
const scope={actorId:id(1),tenantId:id(2),contactId:id(3),commercialTermsId:id(4),offerId:id(5),termsUpdatedAt:"2026-10-09T12:00:00Z",commercialStatus:"active"};
const evidence={tenantId:id(2),agreementId:id(6),contactId:id(3),commercialTermsId:id(4),offerId:id(5),version:3,status:"completed",completedAt:scope.termsUpdatedAt,contentSha256:"a".repeat(64),sealedSha256:"b".repeat(64),sealedCopyRecorded:true};
const request=prepareEngagementHandoff(scope,evidence,{title:"Launch",summary:null,ownerUserId:id(1),startsOn:"2026-10-09",endsOn:"2026-10-20",milestones:[{title:"Review",assignedToUserId:id(7),priority:"normal"}]},id(8),[id(1),id(7)])!;

beforeEach(()=>sessionStorage.clear());
afterEach(()=>vi.restoreAllMocks());
it("retains only original recovery intent in the current tab",()=>{
 expect(retainPendingHandoff(request)).toBe(true);expect(readPendingHandoff(id(1),id(2),id(6))).toEqual({kind:"valid",request});
});
it("another actor, tenant or engagement cannot retrieve this intent",()=>{
 retainPendingHandoff(request);expect(readPendingHandoff(id(11),id(2),id(6))).toEqual({kind:"absent"});expect(readPendingHandoff(id(1),id(11),id(6))).toEqual({kind:"absent"});expect(readPendingHandoff(id(1),id(2),id(11))).toEqual({kind:"absent"});
});
it("clearing verified intent preserves other account intents",()=>{
 retainPendingHandoff(request);retainPendingHandoff({...request,p_expected_tenant_id:id(11)});clearPendingHandoff(id(1),id(2),id(6));expect(readPendingHandoff(id(1),id(2),id(6))).toEqual({kind:"absent"});expect(readPendingHandoff(id(1),id(11),id(6))).toHaveProperty("kind","valid");
});
it.each(["not json",JSON.stringify({...request,p_expected_actor_id:id(11)}),JSON.stringify({...request,p_request_id:"invalid"}),JSON.stringify({...request,p_milestones:[]})])("corrupt or foreign intent never becomes a request %s",raw=>{
 sessionStorage.setItem(`paige:operations-handoff-intent:${id(1)}:${id(2)}:${id(6)}`,raw);expect(readPendingHandoff(id(1),id(2),id(6))).toEqual({kind:"blocked"});
});
it("does not propagate unexpected private fields",()=>{
 sessionStorage.setItem(`paige:operations-handoff-intent:${id(1)}:${id(2)}:${id(6)}`,JSON.stringify({...request,body_markdown:"private"}));expect(readPendingHandoff(id(1),id(2),id(6))).toEqual({kind:"valid",request});
});

it("an empty stored value remains blocked rather than absent",()=>{
 sessionStorage.setItem(`paige:operations-handoff-intent:${id(1)}:${id(2)}:${id(6)}`,"");expect(readPendingHandoff(id(1),id(2),id(6))).toEqual({kind:"blocked"});
});
it("inaccessible storage preserves the submission lock",()=>{
 vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("Denied");});expect(readPendingHandoff(id(1),id(2),id(6))).toEqual({kind:"blocked"});
});
it("failure to retain intent prevents submission",()=>{
 vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("Quota");});expect(retainPendingHandoff(request)).toBe(false);
});
it("failed clearing cannot claim the original intent was removed",()=>{
 retainPendingHandoff(request);vi.spyOn(Storage.prototype,"removeItem").mockImplementation(()=>{throw new Error("Denied");});expect(clearPendingHandoff(id(1),id(2),id(6))).toBe(false);expect(readPendingHandoff(id(1),id(2),id(6))).toHaveProperty("kind","valid");
});
