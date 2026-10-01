import { describe, it, expect, vi } from 'vitest';
import { executeKnowledgeTool, normalizeKnowledgeArgs } from '../../supabase/functions/_shared/knowledge-tenant-brain';
import { classifySpentApproval, sayWhatTheCardSays, buildApprovalOutcome } from '../../supabase/functions/_shared/approval-outcome';
import { confirmFingerprint } from '../../supabase/functions/_shared/confirm-fingerprint';
const tenant='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
const row={id,tenant_id:tenant,revision:2,title:'Guide',summary:null,category:null,tags:[],source:'paste',source_url:null,chunk_count:1,content:'private'};
const port=(data:unknown,error:unknown=null)=>({rpc:vi.fn().mockResolvedValue({data,error})});
describe('governed Knowledge adapter',()=>{
 it('rejects model scope/consent and empty or unbounded patch',()=>{
  for(const extra of [{tenant_id:tenant},{actor_id:id},{approved:true},{consent:true}]) expect(()=>normalizeKnowledgeArgs('knowledge_delete',{document_id:id,expected_revision:2,...extra})).toThrow();
  expect(()=>normalizeKnowledgeArgs('knowledge_update',{document_id:id,expected_revision:2,patch:{}})).toThrow();
 });
 it('normalizes exact title before fingerprint while preserving other metadata',()=>expect(normalizeKnowledgeArgs('knowledge_update',{document_id:id,expected_revision:2,patch:{title:' Guide ',summary:' context '},confirm:true})).toEqual({document_id:id,expected_revision:2,patch:{title:'Guide',summary:' context '},confirm:true}));
 it('uses caller-scoped RPC and bounds contextual detail',async()=>{
  const caller=port({tenant_id:tenant,documents:[{...row,content:'x'.repeat(20000)}]});
  const result=await executeKnowledgeTool({caller,expectedTenantId:tenant,tool:'knowledge_read',args:{document_id:id}});
  expect(caller.rpc).toHaveBeenCalledWith('read_tenant_knowledge',expect.objectContaining({p_expected_tenant:tenant,p_doc_id:id}));
  expect(result.success).toBe(true);expect(JSON.stringify(result).length).toBeLessThan(16000);expect(JSON.stringify(result)).toContain('truncated');
 });
 it('never returns another tenant document',async()=>{
  const result=await executeKnowledgeTool({caller:port({tenant_id:tenant,documents:[{...row,tenant_id:id}]}),expectedTenantId:tenant,tool:'knowledge_read',args:{}});
  expect(result.success).toBe(false);expect(JSON.stringify(result)).not.toContain('private');
 });
 it('preserves committed change with missing receipt without another write',async()=>{
  const caller=port({tenant_id:tenant,document:{...row,revision:3},outcome:'capability_completed_unrecorded',run_id:id});
  const result=await executeKnowledgeTool({caller,expectedTenantId:tenant,tool:'knowledge_update',args:{document_id:id,expected_revision:2,patch:{title:'Guide'}}});
  expect(result).toMatchObject({success:false,verified:true,railRecorded:false});expect(caller.rpc).toHaveBeenCalledTimes(1);
 });
 it.each(['KNOWLEDGE_REVISION_CONFLICT','KNOWLEDGE_FORBIDDEN','KNOWLEDGE_SCOPE_CHANGED'])('reports explicit refusal %s without retry',async(code)=>{
  const caller=port(null,{message:code,code:code==='KNOWLEDGE_REVISION_CONFLICT'?'40001':'42501'});
  expect(await executeKnowledgeTool({caller,expectedTenantId:tenant,tool:'knowledge_delete',args:{document_id:id,expected_revision:2}})).toMatchObject({success:false,mutationMayHavePersisted:false,code});expect(caller.rpc).toHaveBeenCalledTimes(1);
 });
 it('treats missing acknowledgement as uncertain, not unsaved',async()=>{
  const caller=port(null,{message:'network lost'});
  expect(await executeKnowledgeTool({caller,expectedTenantId:tenant,tool:'knowledge_delete',args:{document_id:id,expected_revision:2}})).toMatchObject({success:false,mutationMayHavePersisted:true});expect(caller.rpc).toHaveBeenCalledTimes(1);
 });
 it('requires verified canonical deletion and separately reports retained source',async()=>{
  const caller=port({tenant_id:tenant,document_id:id,deleted_revision:2,document_absent:true,chunks_absent:true,run_id:id,outcome:'capability_succeeded',source_cleanup:{status:'not_attempted',reason:'canonical_source_binding_unavailable'}});
  expect(await executeKnowledgeTool({caller,expectedTenantId:tenant,tool:'knowledge_delete',args:{document_id:id,expected_revision:2}})).toMatchObject({success:true,verified:true,railRecorded:true,source_cleanup:{status:'not_attempted'}});
 });
 it('binds normalized document revision and patch to the existing fingerprint',async()=>{
  const args={document_id:id,expected_revision:2,patch:{title:' Guide '}};
  const fp=await confirmFingerprint('knowledge_update',normalizeKnowledgeArgs('knowledge_update',args));
  expect(await confirmFingerprint('knowledge_update',normalizeKnowledgeArgs('knowledge_update',{...args,patch:{title:'Guide'},confirm:true}))).toBe(fp);
  for(const changed of [{...args,expected_revision:3},{...args,document_id:tenant},{...args,patch:{title:'Other'}}]) expect(await confirmFingerprint('knowledge_update',normalizeKnowledgeArgs('knowledge_update',changed))).not.toBe(fp);
 });
 it.each([null,{}, {tenant_id:tenant}, {tenant_id:tenant,document_id:id,deleted_revision:2,document_absent:true,chunks_absent:false,outcome:'capability_succeeded',run_id:id}])('malformed delete receipt stays uncertain',async(data)=>{
  expect(await executeKnowledgeTool({caller:port(data),expectedTenantId:tenant,tool:'knowledge_delete',args:{document_id:id,expected_revision:2}})).toMatchObject({success:false,verified:false,mutationMayHavePersisted:true});
 });
 it('rejects contradictory update readback',async()=>{
  expect(await executeKnowledgeTool({caller:port({tenant_id:tenant,document:{...row,revision:3,title:'Other'},outcome:'capability_succeeded',run_id:id}),expectedTenantId:tenant,tool:'knowledge_update',args:{document_id:id,expected_revision:2,patch:{title:'Guide'}}})).toMatchObject({success:false,mutationMayHavePersisted:true});
 });
 it('bounds a metadata-heavy detail without losing its identity',async()=>{
  const result=await executeKnowledgeTool({caller:port({tenant_id:tenant,documents:[{...row,content:'x'.repeat(20000),summary:'s'.repeat(2000),tags:Array(20).fill('t'.repeat(60)),source_url:'u'.repeat(1000)}]}),expectedTenantId:tenant,tool:'knowledge_read',args:{document_id:id}});
  expect(result.success).toBe(true);expect(JSON.stringify(result).length).toBeLessThan(16000);expect(result.documents).toHaveLength(1);
 });

 it('preserves verified-but-unrecorded truth through the spent approval classifier',async()=>{
  const result=await executeKnowledgeTool({caller:port({tenant_id:tenant,document:{...row,revision:3},outcome:'capability_completed_unrecorded',run_id:id}),expectedTenantId:tenant,tool:'knowledge_update',args:{document_id:id,expected_revision:2,patch:{title:'Guide'}}});
  const content=sayWhatTheCardSays(JSON.stringify(result),{reportsKnowledge:true});
  expect(JSON.parse(content).outcome_unknown).not.toBe(true);
  const classified=classifySpentApproval(content,{reportsKnowledge:true});
  expect(classified).toEqual({outcome:'ran',reason:'completed_unrecorded'});
  expect(buildApprovalOutcome([{fingerprint:'test',...classified}]).note).toContain('activity record is missing');
 });
 it('known canonical SQL rollback stays not-run after spent approval',async()=>{
  const result=await executeKnowledgeTool({caller:port(null,{code:'40001',message:'KNOWLEDGE_REVISION_CONFLICT'}),expectedTenantId:tenant,tool:'knowledge_delete',args:{document_id:id,expected_revision:2}});
  expect(result.not_applied).toBe(true);
  expect(classifySpentApproval(sayWhatTheCardSays(JSON.stringify(result)),{reportsKnowledge:true})).toEqual({outcome:'not_run',reason:'failed'});
 });
 it('a refusal-shaped transport error without SQLSTATE does not prove rollback',async()=>{
  const result=await executeKnowledgeTool({caller:port(null,{message:'KNOWLEDGE_REVISION_CONFLICT'}),expectedTenantId:tenant,tool:'knowledge_delete',args:{document_id:id,expected_revision:2}});
  expect(result).toMatchObject({mutationMayHavePersisted:true});expect(result.not_applied).not.toBe(true);
 });
 it('only the canonical Knowledge opt-in may interpret the verified receipt outcome',()=>{
  const raw=JSON.stringify({success:false,verified:true,railRecorded:false,outcome:'capability_completed_unrecorded'});
  expect(classifySpentApproval(raw)).toMatchObject({outcome:'unconfirmed'});
  expect(classifySpentApproval(JSON.stringify({...JSON.parse(raw),outcome_unknown:true}),{reportsKnowledge:true})).toMatchObject({outcome:'unconfirmed'});
 });

});
