import {it,expect} from "vitest";
import {getSpineCapability,validateSpineRegistry} from "../../supabase/functions/_shared/paige-spine/registry.ts";
import {BUSINESS_METRIC_SPINE} from "../../supabase/functions/_shared/analytics-metrics/read.ts";
it("fresh-main metric composition only declares its incumbent member Chat admission",()=>{
 const actual=getSpineCapability("analytics.metric_read");
 expect(actual).toEqual({...BUSINESS_METRIC_SPINE,action:{...BUSINESS_METRIC_SPINE.action,seatAuthority:"member"}});
 expect(validateSpineRegistry([actual!])).toEqual([]);
 expect(actual?.action).toMatchObject({classification:"read",riskPolicyKey:"read_only",approvalAuthority:"none",executor:"public.issue_analytics_evidence_bundle"});
});