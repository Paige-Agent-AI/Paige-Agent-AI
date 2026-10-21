import { describe,it,expect,vi } from 'vitest';
import { confirmFingerprint } from '../../supabase/functions/_shared/confirm-fingerprint';
import { readOriginalCuraPreparationHistory } from '../../supabase/functions/_shared/paige-turn/interactive-cura-history';
const id=(n:string)=>'e0c30100-0000-4000-8000-'+n.padStart(12,'0');
const actor=id('1'),tenant=id('2'),thread=id('3'),intent=id('4'),turn=id('5'),nonce=id('6'),proposal=id('7'),work=id('8'),doc=id('9');
async function fixture(){
 const args={purpose:'cura_customer_knowledge',title:'Program FAQ',content:'Private approved reference.',confirm:false};
 const act=await confirmFingerprint('save_to_knowledge_base',args);
 const fingerprint=await confirmFingerprint('save_to_knowledge_base',{intent:act,tenant,thread,client:null});
 const token=fingerprint+':'+nonce;
 const threadRow:any={id:thread,tenant_id:tenant,caller_user_id:actor,audience:'workspace',is_archived:false};
 const turnRow:any={id:turn,thread_id:thread,role:'assistant',created_at:'2026-10-21T12:00:01.000001Z',interactive_intent_id:intent,
  interactive_actor_id:actor,interactive_tenant_id:tenant,interactive_terminal_state:'WAIT_APPROVAL',bundle_ref:{turn_state:{v:1,state:'WAIT_APPROVAL'},
   interactive:{request_intent_id:intent,effects:[{tool:'save_to_knowledge_base',outcome:'approval_required'},{tool:'crm_add_note',outcome:'outcome_unknown'}]},
   paige_confirm:[{tool:'save_to_knowledge_base',fingerprint:token}]}};
 const row:any={id:proposal,user_id:actor,tenant_id:tenant,thread_id:thread,scoped_client_id:null,tool_name:'save_to_knowledge_base',args,
  fingerprint,issued_in_request:nonce,server_issued_at:'2026-10-21T12:00:00Z',created_at:'2026-10-21T12:00:00Z',
  consumed_at:'2026-10-21T12:00:02Z',expires_at:'2026-10-21T12:15:00Z'};
 const native:any={contract_version:1,tenant_id:tenant,availability:'available',preparation_recorded:true,retry_authorized:false,
  work_id:work,work_status:'outcome_unknown',source_document_id:doc,current_document_revision:2,work_updated_at:'2026-10-21T12:00:03Z'};
 const state={actor,tenant,current:true,failTable:'',members:true,proposalReads:0,threadReads:0,turnReads:0};
 let beforeRead:undefined|((table:string,count:number)=>void);
 const writes:string[]=[],queries:Array<{table:string;filters:any[]}>=[];
 const from=(table:string)=>{
  const filters:any[]=[],query:any={select:()=>query,eq:(key:string,value:unknown)=>{filters.push(['eq',key,value]);return query;},
   not:(key:string,op:string,value:unknown)=>{filters.push(['not',key,op,value]);return query;},limit:()=>query,
   maybeSingle:async()=>{const result=await read();return {data:(result.data as any[])?.[0]??null,error:result.error};},then:(resolve:any,reject:any)=>read().then(resolve,reject)};
  async function read(){
   queries.push({table,filters:structuredClone(filters)});
   const count=table==='paige_pending_confirmations'?++state.proposalReads:table==='paige_chat_threads'?++state.threadReads:++state.turnReads;
   beforeRead?.(table,count);
   if(state.failTable===table)return {data:null,error:{message:'unavailable'}};
   const candidate=table==='paige_chat_threads'?threadRow:table==='paige_chat_turns'?turnRow:row;
   const selected=filters.every(([op,key,a,b])=>op==='eq'?candidate[key]===a:!(a==='is'&&candidate[key]===b));
   return {data:selected?[structuredClone(candidate)]:[],error:null};
  }
  return query;
 };
 const rpc=vi.fn(async(name:string)=>{
  if(name==='is_platform_owner')return {data:false,error:null};
  if(name==='is_tenant_member')return {data:state.members,error:null};
  if(name==='read_cura_knowledge_preparation')return {data:structuredClone(native),error:null};
  writes.push(name);throw Error('No other RPC allowed');
 });
 const caller:any={from,rpc,auth:{getUser:vi.fn(async()=>({data:{user:{id:state.actor}},error:null}))},
  readActiveTenant:vi.fn(async()=>({data:{active_tenant_id:state.tenant},error:null}))};
 const service:any={from,rpc:vi.fn(()=>{writes.push('service RPC');throw Error('No service RPC');})};
 const input={actorId:actor,tenantId:tenant,threadId:thread,intentId:intent,turnId:turn,caller,service,current:()=>state.current};
 return {args,row,threadRow,turnRow,native,state,caller,service,input,writes,queries,rpc,setBeforeRead:(f:typeof beforeRead)=>{beforeRead=f;}};
}
describe('original CURA approval observation',()=>{
 it('returns only exact recorded preparation; another uncertain effect stays unsettled',async()=>{
  const f=await fixture(),result=await readOriginalCuraPreparationHistory(f.input);
  expect(result).toMatchObject({status:'recorded_preparation',origin_intent_id:intent,settles_interrupted_turn:false,retry_authorized:false,
   confirmations_restored:false,new_effect_possible:false,preparations:[{work_id:work,work_status:'outcome_unknown',knowledge_doc_id:doc,current_document_revision:2}]});
  expect(JSON.stringify(result)).not.toMatch(/Private approved reference|Program FAQ|fingerprint|issued_in_request|args|proposal/);
  expect(f.writes).toEqual([]);expect(f.state.proposalReads).toBe(2);
 });
 for(const [name,mutate] of [
  ['wrong business',(f:any)=>{f.input.tenantId=id('99');}],['wrong actor',(f:any)=>{f.input.actorId=id('99');}],
  ['customer audience',(f:any)=>{f.threadRow.audience='customer';}],['archived thread',(f:any)=>{f.threadRow.is_archived=true;}],
  ['wrong origin intent',(f:any)=>{f.turnRow.interactive_intent_id=id('99');}],['wrong receipt actor',(f:any)=>{f.turnRow.interactive_actor_id=id('99');}],
  ['invented origin',(f:any)=>{f.turnRow.interactive_terminal_state='FINAL';}],['missing approval effect',(f:any)=>{f.turnRow.bundle_ref.interactive.effects=[];}],
  ['duplicate card',(f:any)=>{f.turnRow.bundle_ref.paige_confirm.push({...f.turnRow.bundle_ref.paige_confirm[0]});}],
  ['bare token',(f:any)=>{f.turnRow.bundle_ref.paige_confirm[0].fingerprint=f.row.fingerprint;}],
  ['unconsumed row',(f:any)=>{f.row.consumed_at=null;}],['unsigned row',(f:any)=>{f.row.server_issued_at=null;}],
  ['changed frozen text',(f:any)=>{f.row.args.content='Substituted text';}],['changed purpose',(f:any)=>{f.row.args.purpose='private';}],
  ['consumed before origin',(f:any)=>{f.row.consumed_at='2026-10-21T12:00:01.000000Z';}],
  ['consumed after expiry',(f:any)=>{f.row.consumed_at='2026-10-21T12:15:01Z';}],
  ['missing native work',(f:any)=>{Object.assign(f.native,{availability:'unavailable',preparation_recorded:null});}],
  ['foreign native metadata',(f:any)=>{f.native.tenant_id=id('99');}],
  ['membership gone',(f:any)=>{f.state.members=false;}],['malformed client scope',(f:any)=>{f.row.scoped_client_id='client';}],
 ] as const)it('withholds '+name,async()=>{const f=await fixture();mutate(f);expect(await readOriginalCuraPreparationHistory(f.input)).toEqual({v:1,status:'unavailable'});expect(f.writes).toEqual([]);});
 it('pins the original stable approved act, never a new transport intent',async()=>{
  const f=await fixture();await readOriginalCuraPreparationHistory(f.input);
  const first=f.rpc.mock.calls.find(c=>c[0]==='read_cura_knowledge_preparation');
  expect(first).toBeDefined();expect(f.queries.filter(q=>q.table==='paige_pending_confirmations').every(q=>q.filters.some(x=>x[1]==='issued_in_request'&&x[2]===nonce))).toBe(true);
 });
 for(const table of ['paige_chat_threads','paige_chat_turns','paige_pending_confirmations'])it('withholds changed '+table+' after observation',async()=>{
  const f=await fixture();f.setBeforeRead((name,count)=>{if(name===table&&count===2){if(name==='paige_chat_threads')f.threadRow.is_archived=true;else if(name==='paige_chat_turns')f.turnRow.bundle_ref.turn_state.state='FINAL';else f.row.args.content='Changed after observation';}});
  expect(await readOriginalCuraPreparationHistory(f.input)).toEqual({v:1,status:'unavailable'});expect(f.writes).toEqual([]);
 });
 it('withholds a late actor change at final scope validation',async()=>{
  const f=await fixture();f.setBeforeRead((table,count)=>{if(table==='paige_chat_turns'&&count===2)f.state.actor=id('99');});
  expect(await readOriginalCuraPreparationHistory(f.input)).toEqual({v:1,status:'unavailable'});
 });
 it('withdrawal is sticky across awaited reads',async()=>{
  const f=await fixture();f.setBeforeRead((table,count)=>{if(table==='paige_pending_confirmations'&&count===1)f.state.current=false;});
  expect(await readOriginalCuraPreparationHistory(f.input)).toEqual({v:1,status:'unavailable'});expect(f.rpc.mock.calls.some(c=>c[0]==='read_cura_knowledge_preparation')).toBe(false);
 });
 it('read failure never grants retry, restores approval or returns private payload',async()=>{
  const f=await fixture();f.state.failTable='paige_pending_confirmations';
  expect(await readOriginalCuraPreparationHistory(f.input)).toEqual({v:1,status:'unavailable'});expect(f.writes).toEqual([]);
 });
});
