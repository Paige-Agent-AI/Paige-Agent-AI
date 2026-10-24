// @vitest-environment node
import {expect,it} from 'vitest';
import {COLLECTION_ACTIONS,parseCollectionCommand} from '../../supabase/functions/_shared/sales-collections/contract';
import {classifyAction} from '../../supabase/functions/_shared/action-risk';
import {SALES_COLLECTION_KIT_BY_ACTION,SALES_COLLECTION_CAPABILITIES} from '../../supabase/functions/_shared/paige-spine/domains/sales_collections';
import {decideDeclaredCapability} from '../../supabase/functions/_shared/capability-kit/decision';
import {dispatchSalesCollectionsChat,SALES_COLLECTIONS_TOOLS} from '../../supabase/functions/_shared/sales-collections-chat';

const id=(n:number)=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const capability='sales_effectuate_commercial_terms';
const command={action:'collection.effectuate_terms',agreement_id:id(5),expected_version:3,
 expected_updated_at:'2026-10-15T05:17:00.123456+00:00',signing_id:id(4),signing_version:4,
 invoice_id:id(6),invoice_draft_version:2,payload_digest:'a'.repeat(64),sealed_sha256:'b'.repeat(64)};
const args={command,operation_id:id(7),expected_tenant_id:id(1),approval_subject:`collection.effectuate_terms:${id(5)}`};
const input={caller:{authenticated:true,userId:id(8),principal:'person',tenantId:id(1),tenantSource:'server',door:'other',access:{allowed:true,reason:'Existing owner/admin check'}},
 capability:{id:capability,effect:'mutate',outcomeChannel:'record_capability_run',availability:'needs_approval'},approval:{autonomyLane:'confirm'},requestArgs:args} as const;

it('routes the native exact-source command through the existing Collections contract without losing microseconds',()=>{
 expect(parseCollectionCommand(command)).toEqual(command);
 expect(Object.entries(COLLECTION_ACTIONS).find(([action])=>action===command.action)?.[1]).toBe(capability);
 expect(classifyAction(capability)).toBe('high');
});

it('does not create a competing Chat or Live execution owner for the owner-review act',()=>{
 const declaration=SALES_COLLECTION_CAPABILITIES.find(item=>item.key==='sales_collections.effectuate_terms');
 expect(declaration).toBeDefined();
 expect(declaration).toMatchObject({chatBinding:'UNAVAILABLE',mindBinding:'UNAVAILABLE',maturity:'PARTIAL'});
 expect(declaration?.outcome?.kinds).toEqual(['commercial_terms_effectuated','refused','outcome_unknown']);
 expect(declaration?.action?.chatTool).toBeUndefined();
});

it('the actual legacy Chat dispatcher cannot advertise or smuggle the new owner-only action',async()=>{
 expect(SALES_COLLECTIONS_TOOLS.map(tool=>tool.function.name)).not.toContain(capability);
 const unavailable=()=>{throw Error('A non-admitted Chat action must touch no execution or approval port');};
 const dependencies={admin:{from:unavailable},caller:{rpc:async()=>unavailable(),functions:{invoke:async()=>unavailable()}}};
 const context={tenantId:id(1),userId:id(8),toolName:capability,args:{},approved:new Set<string>(),sameToolCalls:0,
  turn:{thread_id:null,user_turn_ordinal:1,user_turn:'Synthetic non-admitted commercial request'}};
 expect((await dispatchSalesCollectionsChat(context,dependencies)).content).toEqual({success:false,error:'Collection action unavailable.'});
 expect((await dispatchSalesCollectionsChat({...context,toolName:'sales_save_collection_terms',args:command},dependencies)).content)
  .toEqual({success:false,error:'Invalid collection request.'});
});

it('uses the real Kit gate: prepare/recovery never executes from an auto setting, while approval uses the stored exact source',()=>{
 const declared=Object.entries(SALES_COLLECTION_KIT_BY_ACTION).find(([key])=>key===capability)?.[1];
 expect(declared).toBeDefined();if(!declared)return;
 for(const autonomyLane of ['confirm','auto'] as const){
  expect(decideDeclaredCapability(declared,{...input,approval:{autonomyLane}}).kind).toBe('propose');
 }
 expect(decideDeclaredCapability(declared,{...input,approval:{autonomyLane:'off'}}).kind).toBe('refuse');
 expect(decideDeclaredCapability(declared,{...input,caller:{...input.caller,authenticated:false}}).kind).toBe('refuse');
 const stored={...args,command:{...command,sealed_sha256:'c'.repeat(64)}};
 const decision=decideDeclaredCapability(declared,{...input,approval:{autonomyLane:'confirm',claimedFor:capability,claimedArgs:stored}});
 expect(decision.kind).toBe('execute');if(decision.kind==='execute')expect(decision.args).toEqual(stored);
});
