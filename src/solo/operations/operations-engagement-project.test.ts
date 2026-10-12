import { expect, it } from "vitest";
import type { Plan, PlanItem } from "@/hooks/usePlanList";
import { inspectEngagementProject } from "./operations-engagement-project";
const scope={tenantId:"tenant",contactId:"client",termsId:"terms",offerId:"offer"};
const provenance={commercial_terms_id:"terms",contact_id:"client",offer_id:"offer",agreement_id:"signing",version:3};
const project=(ref:unknown=provenance,tenant_id="tenant")=>({id:"project",tenant_id,items:[],metadata:{operations_engagement:ref}} as unknown as Plan);
it("reads an existing scoped Planning relationship without claiming client acceptance",()=>{
 const result=inspectEngagementProject([project()],[],scope);expect(result.kind).toBe("linked");expect(result.link?.signingId).toBe("signing");expect(result.link?.version).toBe(3);expect(result).not.toHaveProperty("clientAccepted");
});
it("absence from a bounded list is not proof no project exists",()=>expect(inspectEngagementProject([],[],scope).kind).toBe("not_shown"));
it("unrelated commercial terms remain unrelated",()=>expect(inspectEngagementProject([project({...provenance,commercial_terms_id:"other"})],[],scope).kind).toBe("not_shown"));
it.each([{contact_id:"foreign"},{offer_id:"foreign"},{agreement_id:""},{version:0},{version:1.5}])("refuses malformed or inconsistent source relationship %j",change=>expect(inspectEngagementProject([project({...provenance,...change})],[],scope).kind).toBe("unavailable"));
it("duplicate engagement relationships cannot become an arbitrary project",()=>expect(inspectEngagementProject([project(),{...project(),id:"second"}],[],scope).kind).toBe("unavailable"));
it("rejects a foreign project, even if another project looks valid",()=>expect(inspectEngagementProject([project(),project(provenance,"foreign")],[],scope).kind).toBe("unavailable"));
it("foreign loose or nested items invalidate the source bundle",()=>{
 expect(inspectEngagementProject([project()],[{tenant_id:"foreign"} as PlanItem],scope).kind).toBe("unavailable");
 expect(inspectEngagementProject([{...project(),items:[{tenant_id:"tenant",plan_id:"wrong"} as PlanItem]}],[],scope).kind).toBe("unavailable");
});
