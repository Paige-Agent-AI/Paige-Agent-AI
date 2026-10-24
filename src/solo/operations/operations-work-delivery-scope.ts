import type{PlanItem}from"@/hooks/usePlanList";
import{parseStaffSubmissions,type StaffDeliveryScope}from"./operations-delivery-staff";
/** Candidate source binding only; actual session/item/client/source authorization stays server-owned. */
export function planningWorkDeliveryScope(item:PlanItem,actorId:string,tenantId:string):StaffDeliveryScope|null{
 if(item.tenant_id!==tenantId||!item.plan_id||!item.contact_id||!item.updated_at||item.status==="cancelled")return null;
 const scope={actorId,tenantId,workItemId:item.id,planId:item.plan_id,clientId:item.contact_id,workUpdatedAt:item.updated_at};
 return parseStaffSubmissions({work_item_id:item.id,submissions:[]},scope)!==null?scope:null;
}
