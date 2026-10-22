import { confirmFingerprint } from '../confirm-fingerprint.ts';
import { bindKnowledgeIngestScope, type KnowledgeScopeCaller } from '../knowledge-ingest-scope.ts';
import { CURA_TEACH_PURPOSE, observeCuraKnowledgePreparation } from '../cura-knowledge-teaching.ts';
import { parseScopedToken } from './resume.ts';
import type { ApprovalRecoveryDb } from './interactive-approval.ts';

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const stable=(v:unknown):string=>JSON.stringify(v,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const precise=(v:unknown)=>{
 const m=typeof v==='string'?/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(v):null;
 return m&&Number.isFinite(Date.parse(v as string))?[Date.parse(v as string),Number((m[1]??'').padEnd(6,'0').slice(3))]:null;
};
const notAfter=(a:unknown,b:unknown)=>{const x=precise(a),y=precise(b);return !!x&&!!y&&(x[0]<y[0]||x[0]===y[0]&&x[1]<=y[1]);};

/** Original record projection only. Never restores/claims an approval, dispatches
 * preparation, replays work, writes a turn or settles any interrupted effect. */
export async function readOriginalCuraPreparationHistory(input:{
 actorId:string;tenantId:string|null;threadId:string;intentId:string;turnId:string;
 caller:ApprovalRecoveryDb&KnowledgeScopeCaller;service:ApprovalRecoveryDb;current():boolean;
}){
 const unavailable=()=>({v:1 as const,status:'unavailable' as const});
 let withdrawn=false;
 try{
  const {actorId,tenantId,threadId,intentId,turnId,caller,service}=input;
  const currentCallback=input.current;
  const current=()=>{try{withdrawn ||= currentCallback()!==true;}catch{withdrawn=true;}return !withdrawn;};
  if(![actorId,tenantId,threadId,intentId,turnId].every(uuid)||!current())return unavailable();
  const boundary=await bindKnowledgeIngestScope(caller,tenantId!);
  if(boundary.userId!==actorId||!current())return unavailable();
  const readThread=()=>caller.from('paige_chat_threads').select('id,tenant_id,caller_user_id,audience,is_archived')
   .eq('id',threadId).eq('tenant_id',tenantId).eq('caller_user_id',actorId).maybeSingle();
  const readTurn=()=>caller.from('paige_chat_turns')
   .select('id,thread_id,role,created_at,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state,bundle_ref')
   .eq('id',turnId).eq('thread_id',threadId).eq('interactive_intent_id',intentId).maybeSingle();
  const ownThread=(r:unknown)=>object(r)&&r.id===threadId&&r.tenant_id===tenantId&&r.caller_user_id===actorId&&r.audience==='workspace'&&r.is_archived===false;
  const thread=await readThread();if(!current()||thread.error||!ownThread(thread.data))return unavailable();
  const original=await readTurn(),turn=original.data;
  if(!current()||original.error||!object(turn)||turn.id!==turnId||turn.thread_id!==threadId||turn.role!=='assistant'
   ||turn.interactive_intent_id!==intentId||turn.interactive_actor_id!==actorId||turn.interactive_tenant_id!==tenantId
   ||turn.interactive_terminal_state!=='WAIT_APPROVAL'||!precise(turn.created_at)||!object(turn.bundle_ref))return unavailable();
  const bundle=turn.bundle_ref;
  if(!object(bundle.turn_state)||bundle.turn_state.v!==1||bundle.turn_state.state!=='WAIT_APPROVAL'
   ||!object(bundle.interactive)||bundle.interactive.request_intent_id!==intentId
   ||!Array.isArray(bundle.interactive.effects)||bundle.interactive.effects.length>20
   ||!Array.isArray(bundle.paige_confirm)||bundle.paige_confirm.length<1||bundle.paige_confirm.length>10)return unavailable();
  const cards=bundle.paige_confirm.filter(card=>object(card)&&card.tool==='save_to_knowledge_base');
  if(!cards.length)return unavailable();
  const seen=new Set<string>(),snapshots:Array<{read:()=>PromiseLike<{data:unknown;error:unknown}>;row:Record<string,unknown>}> = [];
  const preparations:Array<Record<string,unknown>>=[];
  for(const card of cards){
   if(!current()||!object(card)||typeof card.fingerprint!=='string'||seen.has(card.fingerprint))return unavailable();
   const parsed=parseScopedToken(card.fingerprint);
   if(!parsed||!bundle.interactive.effects.some(effect=>object(effect)&&effect.tool==='save_to_knowledge_base'&&effect.outcome==='approval_required'))return unavailable();
   seen.add(card.fingerprint);
   const read=()=>service.from('paige_pending_confirmations')
    .select('id,user_id,tenant_id,thread_id,scoped_client_id,tool_name,args,fingerprint,issued_in_request,server_issued_at,created_at,expires_at,consumed_at')
    .eq('user_id',actorId).eq('tenant_id',tenantId).eq('thread_id',threadId).eq('tool_name','save_to_knowledge_base')
    .eq('fingerprint',parsed.fingerprint).eq('issued_in_request',parsed.nonce).not('server_issued_at','is',null).not('consumed_at','is',null).limit(2);
   const selected=await read();
   if(!current()||selected.error||!Array.isArray(selected.data)||selected.data.length!==1)return unavailable();
   const row=selected.data[0];
   if(!object(row)||!uuid(row.id)||row.user_id!==actorId||row.tenant_id!==tenantId||row.thread_id!==threadId
    ||row.tool_name!=='save_to_knowledge_base'||row.fingerprint!==parsed.fingerprint||row.issued_in_request!==parsed.nonce
    ||!(row.scoped_client_id===null||uuid(row.scoped_client_id))||!object(row.args)||!precise(row.consumed_at)
    ||!notAfter(row.server_issued_at,turn.created_at)||!notAfter(row.created_at,turn.created_at)
    ||!notAfter(turn.created_at,row.consumed_at)||!notAfter(row.consumed_at,row.expires_at))return unavailable();
   if(row.args.purpose!==CURA_TEACH_PURPOSE)continue;
   const act=await confirmFingerprint('save_to_knowledge_base',row.args);
   const fingerprint=await confirmFingerprint('save_to_knowledge_base',{intent:act,tenant:tenantId,thread:threadId,client:row.scoped_client_id});
   if(!current()||fingerprint!==parsed.fingerprint)return unavailable();
   const observed=await observeCuraKnowledgePreparation({actorId,tenantId:tenantId!,threadId,requestIntentId:intentId,approvedAct:card.fingerprint},row.args,caller);
   if(!current()||observed.preparation_recorded!==true||observed.availability!=='available')return unavailable();
   preparations.push({tool:'save_to_knowledge_base',preparation_recorded:true,work_id:observed.work_id,work_status:observed.work_status,
    knowledge_doc_id:observed.knowledge_doc_id,current_document_revision:observed.current_document_revision,work_updated_at:observed.work_updated_at});
   snapshots.push({read,row});
  }
  if(!preparations.length)return unavailable();
  for(const snapshot of snapshots){const latest=await snapshot.read();if(!current()||latest.error||!Array.isArray(latest.data)||latest.data.length!==1||stable(latest.data[0])!==stable(snapshot.row))return unavailable();}
  const finalThread=await readThread();if(!current()||finalThread.error||!ownThread(finalThread.data))return unavailable();
  const finalTurn=await readTurn();if(!current()||finalTurn.error||stable(finalTurn.data)!==stable(turn))return unavailable();
  await boundary.assert();if(!current())return unavailable();
  return {v:1 as const,status:'recorded_preparation' as const,thread_id:threadId,turn_id:turnId,origin_intent_id:intentId,tenant_id:tenantId!,
   historical:true as const,retry_authorized:false as const,confirmations_restored:false as const,new_effect_possible:false as const,
   settles_interrupted_turn:false as const,preparations};
 }catch{return unavailable();}
}
