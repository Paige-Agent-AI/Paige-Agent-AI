import { describe, expect, it } from "vitest";
import { prepareEngagementHandoff, normalizeHandoffAcknowledgement, type HandoffDraft } from "./operations-engagement-handoff";
const id = (n: number) => `eb810000-0000-4000-8000-${n.toString().padStart(12,"0")}`;
const scope = { actorId: id(1), tenantId: id(2), contactId: id(3), commercialTermsId: id(4), offerId: id(5),
  termsUpdatedAt: "2026-10-09T12:00:00Z", commercialStatus: "active" };
const evidence = { tenantId: id(2), agreementId: id(6), contactId: id(3), commercialTermsId: id(4), offerId: id(5),
  version: 3, status: "completed", completedAt: "2026-10-09T12:00:00Z", contentSha256: "a".repeat(64),
  sealedSha256: "b".repeat(64), sealedCopyRecorded: true };
const draft: HandoffDraft = { title: "  Prepare launch  ", summary: "Reviewed scope", ownerUserId: id(1),
  startsOn: "2026-10-09", endsOn: "2026-10-20", milestones: [{ title: " Review ", assignedToUserId: id(7), priority: "high" }] };
const prepare = (patch: Partial<HandoffDraft> = {}) => prepareEngagementHandoff(scope,evidence,{...draft,...patch},id(8),[id(1),id(7)]);
describe("reviewed engagement handoff preparation", () => {
  it("preserves frozen Sales CAS and reviewed canonical milestone scope", () => {
    expect(prepare()).toMatchObject({p_agreement_id:id(6),p_expected_version:3,p_expected_terms_updated_at:scope.termsUpdatedAt,
      p_title:"Prepare launch",p_request_id:id(8),p_milestones:[{title:"Review",due_at:null,assigned_to_user_id:id(7),priority:"high"}]});
    expect(prepare()).not.toHaveProperty("clientAccepted");
  });
  it.each([{title:" "},{ownerUserId:id(9)},{startsOn:"2026-02-30"},{endsOn:"2026-10-08"},{milestones:[]},
    {milestones:[{...draft.milestones[0],assignedToUserId:id(9)}]},
    {milestones:[{...draft.milestones[0],dueAt:"2026-10-10T12:00:00"}]},
    {milestones:[{...draft.milestones[0],dueAt:"2026-02-30T12:00:00Z"}]},
    {milestones:[{...draft.milestones[0],dueAt:"2026-10-10T24:00:00Z"}]}])("rejects unreviewable scope %j",patch => expect(prepare(patch)).toBeNull());
  it.each([{status:"draft"},{sealedCopyRecorded:false},{sealedSha256:null},{contactId:id(9)},{version:0}])("rejects ineligible signing %j",patch => {
    expect(prepareEngagementHandoff(scope,{...evidence,...patch},draft,id(8),[id(1),id(7)])).toBeNull();
  });
  it("refuses paused commercial terms and unknown Team", () => {
    expect(prepareEngagementHandoff({...scope,commercialStatus:"paused"},evidence,draft,id(8),[id(1),id(7)])).toBeNull();
    expect(prepareEngagementHandoff(scope,evidence,draft,id(8),[])).toBeNull();
  });
});
const response = {ok:true,actor_id:id(1),tenant_id:id(2),plan_id:id(9),milestone_ids:[id(10)],replayed:false,client_accepted:false};
const normalize = (v: unknown) => normalizeHandoffAcknowledgement(v,id(1),id(2),1);
describe("handoff acknowledgement does not invent outcomes", () => {
  it("requires later canonical readback and retains replay identity", () => {
    expect(normalize({...response,replayed:true,private_payload:"discard"})).toEqual({planId:id(9),milestoneIds:[id(10)],replayed:true,clientAccepted:false,readbackVerified:false});
  });
  it.each([{ok:false},{actor_id:id(7)},{tenant_id:id(7)},{client_accepted:true},{client_accepted:undefined},
    {plan_id:"invalid"},{milestone_ids:[]},{milestone_ids:["invalid"]},{replayed:"false"}])("refuses misleading acknowledgement %j",patch => expect(normalize({...response,...patch})).toBeNull());
  it("rejects duplicate milestone identity", () => {
    expect(normalizeHandoffAcknowledgement({...response,milestone_ids:[id(10),id(10)]},id(1),id(2),2)).toBeNull();
  });
});
