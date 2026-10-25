import {preparePortalRequestPublication,type PortalPublicationScope} from './client-portal-request-publication.ts';

type Dependencies=Parameters<typeof preparePortalRequestPublication>[0];
type PreparedSource=Extract<Awaited<ReturnType<typeof preparePortalRequestPublication>>,{outcome:'prepared'}>;
export type PortalRequestCommandPreparation={state:'unavailable'}|{
 state:'already_shared';workId:string;customerActionId:string;
}|{state:'prepared';args:PreparedSource['args'];summary:string};

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const same=(value:Record<string,unknown>,captured:Record<string,unknown>)=>Object.keys(value).length===Object.keys(captured).length
 &&Object.keys(captured).every(key=>value[key]===captured[key]);

/** Source -> presentation for the ORIGINAL common approval gate. Not an issuer,
 * approval, claim, executor or registered tool. The caller must render the whole
 * summary as plain text and keep source words untrusted in model context.
 * Fingerprint/consumption/receipt identity remain the incumbent gate's job.
 */
export async function preparePortalRequestCommand(
 deps:Dependencies,scope:PortalPublicationScope,input:unknown,
):Promise<PortalRequestCommandPreparation>{
 const unavailable=():PortalRequestCommandPreparation=>({state:'unavailable'});
 try{
  if(!object(scope)||!object(input))return unavailable();
  const capturedScope={...scope},capturedInput={...input};
  const current=()=>deps.current()&&same(scope,capturedScope)&&same(input,capturedInput);
  const source=await preparePortalRequestPublication({...deps,current},scope,input);
  // The enclosing await is another continuation. The inner helper's final Auth
  // check alone cannot prove this caller's scope survived that boundary.
  if(!current()||!source.success)return unavailable();
  if(source.outcome==='already_shared')return {state:'already_shared',workId:source.work_id,customerActionId:source.customer_action_id};
  const args=source.args;
  const summary=`Share this saved request in the customer's Portal.\n\nCustomer record: ${args.contact_id}\nPortal recipient: ${args.recipient_user_id}\nSaved work: ${args.work_id}\nExact version: ${args.version}\n\nTitle\n${args.title}\n\nRequest\n${args.body}\n\nThis shares one request. It does not mark the work complete or confirm that the customer has read it.`;
  return {state:'prepared',args,summary};
 }catch{return unavailable();}
}
