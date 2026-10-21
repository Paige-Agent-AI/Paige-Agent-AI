import {describe,expect,it,vi} from 'vitest';
import {commitCuraKnowledgeShare,curaShareMatches,prepareCuraKnowledgeShare,readCuraKnowledge,readCuraKnowledgeDraft,
 type CuraKnowledgeSource,type CuraShareProposal} from './cura-knowledge';

const actor='b3b10100-0000-4000-8000-000000000001',tenant='b3b10200-0000-4000-8000-000000000001';
const foreign='b3b10200-0000-4000-8000-000000000002',doc='b3b10300-0000-4000-8000-000000000001';
const generation='b3b10400-0000-4000-8000-000000000001',shareId='b3b10500-0000-4000-8000-000000000001';
const operation='b3b10600-0000-4000-8000-000000000001',scope={actor,tenant},fingerprint='a'.repeat(64);
const from='2026-11-01T09:00:00.000001Z',until='2026-11-15T17:00:00Z',now='2026-10-21T12:00:00Z';
const terms={kind:'faq' as const,validFrom:from,validUntil:until};
const proposal=():CuraShareProposal=>({tenant_id:tenant,audience:'business',document_id:doc,available:true,customer_kind:'faq',
 valid_from:from,valid_until:until,expected_share_revision:0,proposal_hash:'b'.repeat(64),source_fingerprint:fingerprint,
 document_revision:1,generation_id:generation,source:'paste',title:'Welcome FAQ',preview:'The introduction lasts 30 minutes.',preview_truncated:false,already_shared:false});
const source=():CuraKnowledgeSource=>({document_id:doc,document_revision:1,title:'Welcome FAQ',source_state:'prepared',pending_review:false,
 source_fingerprint:fingerprint,generation_id:generation,share:null,share_state:'not_shared',updated_at:now});
const envelope=(documents:unknown[]=[source()])=>({tenant_id:tenant,audience:'business',as_of:now,documents,next_offset:documents.length,has_more:false});
const client=(data:unknown)=>({rpc:vi.fn(async(_name:string,_args:Record<string,unknown>)=>({data,error:null}))});
const receipt=()=>({tenant_id:tenant,audience:'business',document_id:doc,share_id:shareId,receipt_id:operation,replayed:false,changed:true,
 original_revision:1,current_revision:1,customer_kind:'faq',valid_from:from,valid_until:until});
const granted=():CuraKnowledgeSource=>({...source(),share_state:'scheduled',share:{share_id:shareId,share_revision:1,document_revision:1,
 generation_id:generation,source_fingerprint:fingerprint,customer_kind:'faq',valid_from:from,valid_until:until,
 state:'scheduled',granted_at:now,revoked_at:null,receipt_id:operation}});

describe('original staged Knowledge draft recovery',()=>{
 const work='b3b10700-0000-4000-8000-000000000001';
 const pending={schema_version:1,extracted_content:'Original extracted answer',reviewed_content:'Saved approved answer',extraction_version:'native-v1',coverage:'complete'};
 const staged={title:'Saved FAQ title',summary:'Saved summary',category:'Services',tags:['approved','welcome']};
 const draft=()=>({...source(),source_state:'draft' as const,pending_review:true,generation_id:null});
 const review=()=>({tenant_id:tenant,document_id:doc,revision:1,record_state:'draft',source_coverage:'complete',source_binding:null,extraction_source_binding:null,extraction_work_id:work,pending_review:pending,
  publication:{contract_version:1,association:'not_submitted',work_id:null,work_status:null,generation_id:null,outcome:null}});
 const detail=()=>({contract_version:1,tenant_id:tenant,document_id:doc,revision:1,title:'Saved FAQ title',record_state:'draft',extraction_work_id:work,review_available:true,
  work:{work_id:work,work_kind:'knowledge_extract',capability_key:'knowledge.extract'},pending_review:{coverage:'complete',extraction_version:'native-v1',reviewed_content:pending.reviewed_content,extracted_content:pending.extracted_content,schema_version:1},pending_review_metadata:staged});
 const port=(patch:Record<string,unknown>={})=>({functions:{invoke:vi.fn()},rpc:vi.fn(async(name:string,_args:Record<string,unknown>)=>({data:name==='read_tenant_knowledge_review'?review():{...detail(),...patch},error:null}))});
 it('restores the original draft, exact work/revision and staged metadata without a new submission',async()=>{
  const c=port();expect(await readCuraKnowledgeDraft(c,scope,draft(),()=>true)).toEqual({id:doc,tenant_id:tenant,revision:1,title:staged.title,content:pending.reviewed_content,summary:staged.summary,category:staged.category,tags:staged.tags});
  expect(c.rpc.mock.calls.map(call=>call[0])).toEqual(['read_tenant_knowledge_review','read_tenant_knowledge_pending']);expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it.each([{tenant_id:foreign},{document_id:foreign},{revision:2},{extraction_work_id:foreign},{record_state:'canonical'},
  {pending_review:{...pending,reviewed_content:'Another saved answer'}},{pending_review_metadata:{...staged,tags:['x'.repeat(61)]}},{pending_review_metadata:{...staged,internal_owner:actor}}])('refuses contradictory staged recovery %j',async patch=>{
  const c=port(patch);await expect(readCuraKnowledgeDraft(c,scope,draft(),()=>true)).rejects.toThrow();expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it('does not adopt draft content after the original incarnation retires',async()=>{
  let current=true;const c=port();c.rpc.mockImplementationOnce(async()=>{current=false;return{data:review(),error:null};});
  await expect(readCuraKnowledgeDraft(c,scope,draft(),()=>current)).rejects.toThrow();expect(c.rpc).toHaveBeenCalledTimes(1);
 });
});

describe('original CURA Knowledge RPC consumer',()=>{
 it('reads only the bounded native publisher inventory, preserving the SDK receiver',async()=>{
  const c=client(envelope());expect((await readCuraKnowledge(c,scope)).documents).toEqual([source()]);
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith('read_client_portal_business_knowledge',{p_tenant_id:tenant,p_document_id:null,p_query:'',p_limit:20,p_offset:0});
 });
 it('narrows the exact original document for readback',async()=>{const c=client(envelope());await readCuraKnowledge(c,scope,{documentId:doc});expect(c.rpc.mock.calls[0][1]).toMatchObject({p_document_id:doc});});
 it('refuses invalid local scope before issuing any call',async()=>{const c=client(envelope());await expect(readCuraKnowledge(c,{actor:'',tenant})).rejects.toThrow();expect(c.rpc).not.toHaveBeenCalled();});
 it.each([
  ['another tenant',{...envelope(),tenant_id:foreign}],
  ['customer audience',{...envelope(),audience:'contact'}],
  ['extra private field',{...envelope(),content:'private'}],
  ['missing freshness',{...envelope(),as_of:undefined}],
  ['invalid next offset',{...envelope(),next_offset:2}],
  ['invented continuation',{...envelope(),has_more:true}],
  ['duplicate documents',envelope([source(),source()])],
  ['prepared without generation',envelope([{...source(),generation_id:null}])],
  ['private pending content',envelope([{...source(),pending_review_text:'private'}])],
  ['invented sharing',envelope([{...source(),share_state:'shared'}])],
  ['contradictory native share',envelope([{...granted(),share_state:'withdrawn'}])],
 ])('refuses %s',async(_name,data)=>{await expect(readCuraKnowledge(client(data),scope)).rejects.toThrow();});
 it('does not adopt another source in exact-operation recovery',async()=>{await expect(readCuraKnowledge(client(envelope()),scope,{documentId:foreign})).rejects.toThrow();});
 it('prepares one exact version/audience/window through the incumbent writer',async()=>{
  const c=client(proposal()),p=await prepareCuraKnowledgeShare(c,scope,doc,true,terms);expect(Object.isFrozen(p)).toBe(true);
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith('prepare_client_portal_business_knowledge_share',{
   p_tenant_id:tenant,p_document_id:doc,p_available:true,p_customer_kind:'faq',p_valid_from:from,p_valid_until:until});
 });
 it('accepts equivalent native ISO offsets without dropping microseconds',async()=>{
  const p={...proposal(),valid_from:'2026-11-01T10:00:00.000001+01:00',valid_until:'2026-11-15T17:00:00+00:00'};
  await expect(prepareCuraKnowledgeShare(client(p),scope,doc,true,terms)).resolves.toMatchObject({valid_from:p.valid_from});
 });
 it.each([
  ['foreign proposal',{...proposal(),tenant_id:foreign}],
  ['wrong version source',{...proposal(),document_id:foreign}],
  ['changed kind',{...proposal(),customer_kind:'promotion'}],
  ['changed microsecond',{...proposal(),valid_from:'2026-11-01T09:00:00.000002Z'}],
  ['unpinned source',{...proposal(),generation_id:null}],
  ['private source metadata',{...proposal(),created_by:actor}],
 ])('refuses prepared %s',async(_name,data)=>{await expect(prepareCuraKnowledgeShare(client(data),scope,doc,true,terms)).rejects.toThrow();});
 it('refuses an inverted validity window before any preparation',async()=>{const c=client(proposal());await expect(prepareCuraKnowledgeShare(c,scope,doc,true,{...terms,validUntil:from})).rejects.toThrow();expect(c.rpc).not.toHaveBeenCalled();});
 it('withdrawal carries the original terms even if the source is stale',async()=>{
  const p={...proposal(),available:false,expected_share_revision:1,title:null,source:null,preview:null};
  await expect(prepareCuraKnowledgeShare(client(p),scope,doc,false,{kind:'information',validFrom:null,validUntil:null})).resolves.toEqual(p);
 });
 it('does not treat a missing share as a withdrawal proposal',async()=>{
  const p={...proposal(),available:false,title:null,source:null,preview:null};await expect(prepareCuraKnowledgeShare(client(p),scope,doc,false,terms)).rejects.toThrow();
 });
 it('commits one original proposal/operation and requires its exact receipt',async()=>{
  const c=client(receipt());expect(await commitCuraKnowledgeShare(c,scope,proposal(),operation)).toEqual({shareId,receiptId:operation,replayed:false,revision:1});
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith('set_client_portal_business_knowledge_share',{
   p_tenant_id:tenant,p_document_id:doc,p_available:true,p_customer_kind:'faq',p_valid_from:from,p_valid_until:until,
   p_expected_share_revision:0,p_proposal_hash:'b'.repeat(64),p_operation_id:operation});
 });
 it.each([
  ['another operation',{...receipt(),receipt_id:foreign}],
  ['another tenant',{...receipt(),tenant_id:foreign}],
  ['another document',{...receipt(),document_id:foreign}],
  ['wrong revision',{...receipt(),current_revision:2}],
  ['contradictory replay',{...receipt(),replayed:true}],
  ['changed window',{...receipt(),valid_until:'2026-11-15T17:00:00.000001Z'}],
 ])('does not accept %s as saved',async(_name,data)=>{const c=client(data);await expect(commitCuraKnowledgeShare(c,scope,proposal(),operation)).rejects.toThrow();expect(c.rpc).toHaveBeenCalledTimes(1);});
 it('does not retry a lost mutation acknowledgement',async()=>{
  const c=client(null);c.rpc.mockRejectedValue(Error('connection lost'));await expect(commitCuraKnowledgeShare(c,scope,proposal(),operation)).rejects.toThrow('connection lost');expect(c.rpc).toHaveBeenCalledTimes(1);
 });
 it('reconciles only the original operation, even after a later source change',()=>{
  const row={...granted(),document_revision:2,source_fingerprint:'c'.repeat(64),share_state:'source_changed' as const};row.share={...row.share!,state:'source_changed'};
  expect(curaShareMatches(row,proposal(),operation)).toBe(true);expect(curaShareMatches(row,proposal(),foreign)).toBe(false);
  expect(curaShareMatches({...row,share:{...row.share!,share_revision:2}},proposal(),operation)).toBe(false);
 });
});
