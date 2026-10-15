import type { Plan, PlanItem } from "@/hooks/usePlanList";
import { operationsBundleMatchesTenant } from "./operations-source-contract";
export type EngagementProject = { project: Plan; signingId: string; version: number };
/** Read a source-owned relationship from the existing scoped Planning result, without another store. */
export function inspectEngagementProject(plans: Plan[],items: PlanItem[],scope:{tenantId:string;contactId:string;termsId:string;offerId:string}) {
 if(!operationsBundleMatchesTenant(plans,items,scope.tenantId))return {kind:"unavailable" as const,link:null};
 const matches:EngagementProject[]=[];
 for(const project of plans){
  const metadata=(project as Plan & {metadata?:unknown}).metadata;
  if(!metadata||typeof metadata!=="object"||Array.isArray(metadata))continue;
  const source=(metadata as Record<string,unknown>).operations_engagement;
  if(!source||typeof source!=="object"||Array.isArray(source))continue;
  const ref=source as Record<string,unknown>;
  if(ref.commercial_terms_id!==scope.termsId)continue;
  if(ref.contact_id!==scope.contactId||ref.offer_id!==scope.offerId||typeof ref.agreement_id!=="string"
   ||!ref.agreement_id||!Number.isSafeInteger(ref.version)||Number(ref.version)<1)return {kind:"unavailable" as const,link:null};
  matches.push({project,signingId:ref.agreement_id,version:ref.version as number});
 }
 if(matches.length>1)return {kind:"unavailable" as const,link:null};
 return matches.length===1?{kind:"linked" as const,link:matches[0]}:{kind:"not_shown" as const,link:null};
}
