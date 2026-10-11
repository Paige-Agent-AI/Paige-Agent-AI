import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
import { executeLifecycle, readLifecycleOutcome, readLifecycleAuthority, parseLifecycleReceipt, parseAccountDeletionPreview } from './accountControls';
const target='test-tenant-a', operation='test-operation-a';
const receipt={tenant_id:target,operation_id:operation,state:'deleted',account_count:1};
beforeEach(()=>vi.resetAllMocks());
describe('canonical account lifecycle client outcomes',()=>{
 it('deletion requires a matching durable receipt AND authoritative account absence',async()=>{
  h.rpc.mockResolvedValueOnce({data:receipt}).mockResolvedValueOnce({data:receipt}).mockResolvedValueOnce({error:{code:'P0002',message:'Account absent'}});
  expect(await executeLifecycle(target,'delete',operation,'Example Solo','fresh-version')).toEqual(receipt);
  expect(h.rpc.mock.calls.map(c=>c[0])).toEqual(['operator_delete_archived_account','operator_read_archive_receipt','operator_read_account_details']);
  expect(h.rpc.mock.calls[0][1]).toEqual({_tenant_id:target,_operation_id:operation,_expected_version:'fresh-version',_confirmation_name:'Example Solo'});
 });
 it('permission refusal or transport failure during absence readback cannot claim success',async()=>{
  for(const code of ['42501','PGRST202']) {
   h.rpc.mockResolvedValueOnce({data:receipt}).mockResolvedValueOnce({error:{code,message:'Read refused'}});
   await expect(readLifecycleOutcome(target,operation,'delete')).rejects.toThrow();
  }
 });
 it('does not mistake an existing account for completed deletion',async()=>{
  h.rpc.mockResolvedValueOnce({data:receipt}).mockResolvedValueOnce({data:{id:target,name:'Example Solo',status:'canceled',account_type:'standalone',version:'v'}});
  await expect(readLifecycleOutcome(target,operation,'delete')).rejects.toThrow('absence');
 });
 it('archive receipt must agree with the archive identity on the canonical tenant',async()=>{
  h.rpc.mockResolvedValueOnce({data:{...receipt,state:'archived'}}).mockResolvedValueOnce({data:{id:target,name:'Example Solo',status:'canceled',account_type:'standalone',version:'v',archived_at:'2026-01-01',archive_operation_id:'other-operation'}});
  await expect(readLifecycleOutcome(target,operation,'archive')).rejects.toThrow('differs');
 });
 it('only strict boolean server answers expose lifecycle authority, per action class',async()=>{
  // ANT-47: archive and permanent-delete are separate server predicates. A delegated
  // archive-only tier answers {archive:true,delete:false}; an administrator both true.
  h.rpc.mockResolvedValueOnce({data:true}).mockResolvedValueOnce({data:false});
  await expect(readLifecycleAuthority()).resolves.toEqual({archive:true,delete:false});
  h.rpc.mockResolvedValueOnce({data:true}).mockResolvedValueOnce({data:true});
  await expect(readLifecycleAuthority()).resolves.toEqual({archive:true,delete:true});
  for(const bad of [null,{},'true',1,undefined]) {
   h.rpc.mockResolvedValueOnce({data:bad}).mockResolvedValueOnce({data:true});
   await expect(readLifecycleAuthority()).rejects.toThrow('authority could not be verified');
  }
 });
 it('a failed authority predicate answer is an error, never a silent grant or denial',async()=>{
  h.rpc.mockResolvedValueOnce({error:{code:'PGRST202',message:'Not deployed'}}).mockResolvedValueOnce({data:true});
  await expect(readLifecycleAuthority()).rejects.toThrow();
  expect(h.rpc.mock.calls.map(c=>c[0])).toEqual(['operator_can_archive_accounts','operator_can_permanently_delete_accounts']);
 });
 it('wrong scope, duplicate accounts, forged receipt and ready-with-blockers fail closed',()=>{
  for(const r of [{...receipt,tenant_id:'other'}, {...receipt,operation_id:'other'}, {...receipt,state:'failed'}, {...receipt,account_count:0}]) expect(()=>parseLifecycleReceipt(target,operation,r)).toThrow();
  const account={id:target,name:'Example Solo',account_type:'standalone'};
  for(const r of [{accounts:[account,account],blockers:[],execution_available:false}, {accounts:[account],blockers:['Unresolved provider'],execution_available:true,version:'v'}]) expect(()=>parseAccountDeletionPreview(target,{tenant_id:target,...r})).toThrow();
 });
});
