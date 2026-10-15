import {decideDeclaredOrdinaryCapability} from '../capability-kit/decision.ts';
import {type GovernedApproval,type GovernedCaller,type GovernedCapability} from '../paige-spine/governedExecution.ts';
import {parseCommercialDraftCommand} from './draft-command.ts';
import {commercialDraftWorkOrder,validateStoredDraftWorkOrder} from './draft-work-order.ts';
import {SALES_DRAFT_CREATE,SALES_DRAFT_REVISE} from './draft-capabilities.ts';

const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
/** Input facts are server-adapter assertions, exactly like the shared gate. The endpoint MUST
 * authenticate/re-resolve tenant/member/status/lane and atomically redeem the canonical approval.
 * This module does not authenticate, mint/claim approval, execute SQL or prove availability. */
export async function admitCommercialDraft(input:{
 caller:GovernedCaller;availability:GovernedCapability['availability'];approval:GovernedApproval;
 operationId:string;intent:unknown;catalogPrices?:unknown;
}){
 if(!input.availability||input.availability==='unknown')throw new TypeError('DRAFT_AVAILABILITY_UNRESOLVED');
 const intent=parseCommercialDraftCommand(input.intent);
 const declaration=intent.action==='invoice.draft_create'?SALES_DRAFT_CREATE:SALES_DRAFT_REVISE;
 const capability=declaration.governance.actionRiskKey!;
 const scope={tenantId:input.caller.tenantId??'',actorId:input.caller.userId??'',operationId:input.operationId};
 // Do not generate/create a work order for an unauthenticated or unscoped caller. The shared
 // gate remains the source of its refusal, including every door and current autonomy lane.
 const validScope=!!input.caller.authenticated&&!!input.caller.tenantId&&!!input.caller.userId&&input.caller.tenantSource==='server';
 const command=validScope?await commercialDraftWorkOrder(intent,scope,input.catalogPrices):null;
 if(validScope&&(intent.draft.items as {price_id:string|null}[]).some(v=>v.price_id!==null)&&input.catalogPrices===undefined)throw new TypeError('CATALOG_PRICE_REVIEW_REQUIRED');
 const requestArgs={expected_tenant_id:input.caller.tenantId,operation_id:input.operationId,command};
 const decision=decideDeclaredOrdinaryCapability(declaration,{caller:input.caller,capability:{id:capability,effect:'mutate',outcomeChannel:declaration.receipt.recorder,availability:input.availability},approval:input.approval,requestArgs});
 if(decision.kind!=='execute')return {capability,declaration,decision,execution:null};
 const args=decision.args;
 if(!object(args)||args.expected_tenant_id!==scope.tenantId||args.operation_id!==scope.operationId)throw new TypeError('DRAFT_APPROVAL_SCOPE_INVALID');
 const decided=await validateStoredDraftWorkOrder(args.command,scope);
 if(decided.action!==intent.action)throw new TypeError('DRAFT_APPROVAL_ACTION_INVALID');
 return {capability,declaration,decision,execution:{expected_tenant_id:scope.tenantId,operation_id:scope.operationId,command:decided}};
}
