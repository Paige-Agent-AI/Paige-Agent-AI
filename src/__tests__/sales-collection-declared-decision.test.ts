import {describe,it,expect} from 'vitest';
import {decideDeclaredCapability} from '../../supabase/functions/_shared/capability-kit/decision';
import {SALES_COLLECTION_KIT_BY_ACTION,SALES_COLLECTION_CAPABILITIES} from '../../supabase/functions/_shared/paige-spine/domains/sales_collections';
import {SALES_INVOICE_CAPABILITIES} from '../../supabase/functions/_shared/paige-spine/domains/sales_invoice';
const tenant='33333333-3333-4333-8333-333333333333';
const requestArgs={command:{action:'collection.commit_import',batch_id:'11111111-1111-4111-8111-111111111111',expected_digest:'a'.repeat(64)},operation_id:'22222222-2222-4222-8222-222222222222',expected_tenant_id:tenant,approval_subject:'collection.commit_import:11111111-1111-4111-8111-111111111111'};
const input={caller:{authenticated:true,userId:'44444444-4444-4444-8444-444444444444',principal:'person',tenantId:tenant,tenantSource:'server',door:'other',access:{allowed:true,reason:'Checked owner/admin'}},capability:{id:'sales_commit_collection_import',effect:'mutate',outcomeChannel:'record_capability_run',availability:'needs_approval'},approval:{autonomyLane:'confirm'},requestArgs} as const;
describe('Collections canonical governance',()=>{
 it('retains exactly one canonical Chat owner for receipt and reversal actions',()=>{
  const tools=[...SALES_INVOICE_CAPABILITIES,...SALES_COLLECTION_CAPABILITIES].map(c=>c.action?.chatTool).filter(Boolean);
  expect(tools.filter(t=>t==='sales_record_manual_payment')).toHaveLength(1);
  expect(tools.filter(t=>t==='sales_reverse_manual_payment')).toHaveLength(1);
  expect(new Set(tools).size).toBe(tools.length);
 });
 it('describes the real approval envelope and import digest, not a bare browser command',()=>{
  const declaration=SALES_COLLECTION_KIT_BY_ACTION.sales_commit_collection_import;
  expect(declaration.input.required).toEqual(['command','operation_id','expected_tenant_id','approval_subject']);
  const command=declaration.input.properties.command;
  expect(command).toMatchObject({type:'object',additionalProperties:false,required:['action','batch_id','expected_digest']});
 });
 it('a financial import never gains autonomous execution from a declaration or auto setting',()=>{
  const declaration=SALES_COLLECTION_KIT_BY_ACTION.sales_commit_collection_import;
  expect(decideDeclaredCapability(declaration,input).kind).not.toBe('execute');
  expect(decideDeclaredCapability(declaration,{...input,approval:{autonomyLane:'auto'}}).kind).not.toBe('execute');
  expect(()=>decideDeclaredCapability(declaration,{...input,capability:{...input.capability,id:'sales_save_collection_terms'}})).toThrow();
 });
 it('execution uses the server stored approval command rather than changed request facts',()=>{
  const stored={...requestArgs,command:{...requestArgs.command,expected_digest:'b'.repeat(64)}};
  const result=decideDeclaredCapability(SALES_COLLECTION_KIT_BY_ACTION.sales_commit_collection_import,{...input,approval:{autonomyLane:'confirm',claimedFor:'sales_commit_collection_import',claimedArgs:stored}});
  expect(result.kind).toBe('execute');if(result.kind==='execute')expect(result.args).toEqual(stored);
 });
});
