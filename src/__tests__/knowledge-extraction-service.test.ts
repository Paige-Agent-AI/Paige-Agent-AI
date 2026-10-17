// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { submitKnowledgeExtraction, readKnowledgeExtractionReview, readKnowledgeExtractionStatus, readKnowledgeExtractionForDocument, readKnowledgePublicationForDocument, type ExtractionInput, type ExtractionReference } from '@/lib/knowledge-extraction-service';
const tenant='11111111-1111-4111-8111-111111111111';
const intent='22222222-2222-4222-8222-222222222222';
const doc='33333333-3333-4333-8333-333333333333';
const work='44444444-4444-4444-8444-444444444444';
const other='55555555-5555-4555-8555-555555555555';
const input:ExtractionInput={intent_id:intent,title:'Source',kind:'paste',content:'<script>untrusted plain source</script>'};
const scope=()=>({tenantId:tenant,isCurrent:vi.fn(()=>true)});
const ref:ExtractionReference={tenantId:tenant,intentId:intent,documentId:doc,workId:work,revision:1};
const accepted={ok:true,work_id:work,document_id:doc,revision:1,status:'claimed',replayed:false};
const pending={schema_version:1,extracted_content:input.content,reviewed_content:null,extraction_version:'utf8-v1',coverage:'complete'};
const review={tenant_id:tenant,document_id:doc,revision:2,record_state:'draft',source_coverage:'unknown',source_binding:null,pending_review:pending,extraction_work_id:work,extraction_source_binding:null};
const status={work_id:work,capability_key:'knowledge.extract',work_kind:'knowledge_extract',work_status:'succeeded',attempt_count:1,max_attempts:3,blocked_reason:null,error_code:null,safe_summary:'Ready for review. Nothing has been published.',created_at:'2026-09-30T12:00:00Z',updated_at:'2026-09-30T12:01:00Z',settled_at:'2026-09-30T12:01:00Z'};
const binding={bucket:'tenant-knowledge',object_id:other,object_name:tenant+'/source.txt',sha256:'a'.repeat(64),byte_size:12,mime_type:'text/plain',bound_at:'2026-09-30T12:00:00Z'};
function client(){return {functions:{invoke:vi.fn().mockResolvedValue({data:accepted,error:null})},rpc:vi.fn().mockImplementation(async(name:string)=>({data:name==='read_tenant_knowledge_review'?review:[status],error:null}))};}
describe('frozen native extraction submit contract',()=>{
 it('submits once with expected tenant and returns references without publication or receipt claims',async()=>{const c=client();expect(await submitKnowledgeExtraction(c,scope(),input)).toEqual({reference:ref,status:'claimed',replayed:false});expect(c.functions.invoke).toHaveBeenCalledExactlyOnceWith('kb-extract-submit',{body:{...input,expected_tenant:tenant}});expect(c.rpc).not.toHaveBeenCalled();});
 it('accepts an explicit same-intent replay without a revision field',async()=>{const c=client();c.functions.invoke.mockResolvedValue({data:{...accepted,revision:undefined,replayed:true,status:'succeeded'},error:null});const r=await submitKnowledgeExtraction(c,scope(),input);expect(r.reference).toEqual({...ref,revision:undefined});expect(r.status).toBe('succeeded');expect(r).not.toHaveProperty('published');expect(r).not.toHaveProperty('receipt');expect(c.functions.invoke).toHaveBeenCalledTimes(1);});
 it('passes a replacement CAS only with its matching document',async()=>{const c=client();c.functions.invoke.mockResolvedValue({data:{...accepted,revision:5},error:null});await submitKnowledgeExtraction(c,scope(),{...input,doc_id:doc,expected_revision:4});expect(c.functions.invoke.mock.calls[0][1].body).toMatchObject({doc_id:doc,expected_revision:4});});
 it.each(['txt','md','markdown','csv','json'])('accepts a tenant-bound %s object reference',async(ext)=>{const c=client();await submitKnowledgeExtraction(c,scope(),{intent_id:intent,title:'File',kind:'file',path:tenant+'/source.'+ext});expect(c.functions.invoke).toHaveBeenCalledTimes(1);});
 it.each([
  {kind:'url',content:undefined,path:'https://example.com'}, {kind:'file',content:undefined,path:tenant+'/scan.pdf'},
  {kind:'file',content:undefined,path:other+'/source.txt'}, {kind:'file',content:undefined,path:tenant+'/../source.txt'},
  {kind:'file',content:undefined,path:tenant+'/%2e.txt'}, {kind:'file',path:tenant+'/source.txt'},
  {content:''},{content:'\0bad'},{content:'a'.repeat(480001)},{content:'\u0001'.repeat(400000)},
  {title:'   '},{title:'a'.repeat(301)},{intent_id:'not-a-uuid'},{doc_id:doc},{expected_revision:2},{doc_id:doc,expected_revision:0},{share_to_network:true},
 ])('rejects invalid input before I/O %j',async(patch)=>{const c=client();await expect(submitKnowledgeExtraction(c,scope(),{...input,...patch} as ExtractionInput)).rejects.toMatchObject({code:'EXTRACTION_INPUT_INVALID',submissionUncertain:false});expect(c.functions.invoke).not.toHaveBeenCalled();});
 it.each([null,{}, {...accepted,ok:false},{...accepted,work_id:'bad'},{...accepted,document_id:'bad'},{...accepted,revision:undefined},{...accepted,revision:2},{...accepted,status:'published'},{...accepted,status:'succeeded'}])('rejects ambiguous acknowledgement %j without retry',async(data)=>{const c=client();c.functions.invoke.mockResolvedValue({data,error:null});await expect(submitKnowledgeExtraction(c,scope(),input)).rejects.toMatchObject({submissionUncertain:true});expect(c.functions.invoke).toHaveBeenCalledTimes(1);});
 it('refuses a wrong replacement identity',async()=>{const c=client();c.functions.invoke.mockResolvedValue({data:{...accepted,document_id:other},error:null});await expect(submitKnowledgeExtraction(c,scope(),{...input,doc_id:doc,expected_revision:1})).rejects.toMatchObject({submissionUncertain:true});});
 it.each(['throw','error'])('never retries ambiguous %s',async(mode)=>{const c=client();if(mode==='throw')c.functions.invoke.mockRejectedValue(Error('connection lost'));else c.functions.invoke.mockResolvedValue({data:null,error:{message:'unavailable'}});await expect(submitKnowledgeExtraction(c,scope(),input)).rejects.toMatchObject({code:'EXTRACTION_SUBMISSION_UNKNOWN',submissionUncertain:true});expect(c.functions.invoke).toHaveBeenCalledTimes(1);});
 it('preserves the repaired explicit unknown acknowledgement without retry',async()=>{const c=client();c.functions.invoke.mockResolvedValue({data:{ok:false,error:'submission_outcome_unknown',intent_id:intent,reconciliation:'replay_same_intent'},error:null});await expect(submitKnowledgeExtraction(c,scope(),input)).rejects.toMatchObject({code:'EXTRACTION_SUBMISSION_UNKNOWN',submissionUncertain:true});expect(c.functions.invoke).toHaveBeenCalledTimes(1);});
 it.each([{intent_id:other},{reconciliation:'new_intent'}])('refuses an unknown acknowledgement with mismatched reconciliation %j',async(patch)=>{const c=client();c.functions.invoke.mockResolvedValue({data:{ok:false,error:'submission_outcome_unknown',intent_id:intent,reconciliation:'replay_same_intent',...patch},error:null});await expect(submitKnowledgeExtraction(c,scope(),input)).rejects.toMatchObject({code:'EXTRACTION_RESPONSE_INVALID',submissionUncertain:true});expect(c.functions.invoke).toHaveBeenCalledTimes(1);});
 it('refuses a stale scope before sending',async()=>{const c=client();const s=scope();s.isCurrent.mockReturnValue(false);await expect(submitKnowledgeExtraction(c,s,input)).rejects.toMatchObject({code:'EXTRACTION_SCOPE_CHANGED'});expect(c.functions.invoke).not.toHaveBeenCalled();});
 it('fences an old incarnation after acknowledgement, even when tenant is A again',async()=>{const c=client(),s=scope();c.functions.invoke.mockImplementation(async()=>{s.isCurrent.mockReturnValue(false);return {data:accepted,error:null};});await expect(submitKnowledgeExtraction(c,s,input)).rejects.toMatchObject({code:'EXTRACTION_SCOPE_CHANGED',submissionUncertain:true});expect(c.functions.invoke).toHaveBeenCalledTimes(1);});
});
describe('exact extraction review read',()=>{
 it('keeps supported source text plain and drops unsolicited receipt/publication fields',async()=>{const c=client();c.rpc.mockResolvedValue({data:{...review,published:true,receipt:'recorded'},error:null});const r=await readKnowledgeExtractionReview(c,scope(),ref);expect(r.pending_review?.extracted_content).toBe(input.content);expect(r.source_coverage).toBe('unknown');expect(r.phase).toBe('awaiting_review');expect(r).not.toHaveProperty('published');expect(r).not.toHaveProperty('receipt');expect(c.rpc).toHaveBeenCalledExactlyOnceWith('read_tenant_knowledge_review',{p_expected_tenant:tenant,p_doc_id:doc});});
 it('preserves canonical replacement and original binding separately from extraction binding',async()=>{const c=client();c.rpc.mockResolvedValue({data:{...review,record_state:'canonical',source_binding:binding,extraction_source_binding:{...binding,object_name:tenant+'/replacement.md'}},error:null});const r=await readKnowledgeExtractionReview(c,scope(),ref);expect(r.record_state).toBe('canonical');expect(r.source_binding?.object_name).not.toBe(r.extraction_source_binding?.object_name);});
 it('accepts a missing pending review without calling it complete',async()=>{const c=client();c.rpc.mockResolvedValue({data:{...review,pending_review:null},error:null});const r=await readKnowledgeExtractionReview(c,scope(),ref);expect(r.pending_review).toBeNull();expect(r.phase).toBe('review_unavailable');});
 it.each([{tenant_id:other},{document_id:other},{extraction_work_id:other},{revision:0},{revision:undefined},{record_state:'published'},{source_coverage:'indexed'}, {pending_review:{}},{pending_review:{...pending,schema_version:2}},{pending_review:{...pending,extracted_content:'a'.repeat(480001)}},{pending_review:{...pending,reviewed_content:42}},{pending_review:{...pending,coverage:'full'}},{source_binding:{...binding,object_name:other+'/source.txt'}},{extraction_source_binding:{...binding,sha256:'bad'}}])('fails closed on review mismatch %j',async(patch)=>{const c=client();c.rpc.mockResolvedValue({data:{...review,...patch},error:null});await expect(readKnowledgeExtractionReview(c,scope(),ref)).rejects.toMatchObject({code:'EXTRACTION_RESPONSE_INVALID'});expect(c.rpc).toHaveBeenCalledTimes(1);});
 it('rejects a caller reference from another workspace without I/O',async()=>{const c=client();await expect(readKnowledgeExtractionReview(c,scope(),{...ref,tenantId:other})).rejects.toThrow();expect(c.rpc).not.toHaveBeenCalled();});
 it('refuses late review data',async()=>{const c=client(),s=scope();c.rpc.mockImplementation(async()=>{s.isCurrent.mockReturnValue(false);return {data:review,error:null};});await expect(readKnowledgeExtractionReview(c,s,ref)).rejects.toMatchObject({code:'EXTRACTION_SCOPE_CHANGED'});});
});
describe('existing durable status with exact review association',()=>{
 it('reads an original server work without inventing a submission intent',async()=>{const c=client();const {intentId: _intent,...readRef}=ref;expect(await readKnowledgeExtractionStatus(c,scope(),readRef)).toEqual(status);expect(c.functions.invoke).not.toHaveBeenCalled();});
 it('checks the source/work binding before reading status',async()=>{const c=client();expect(await readKnowledgeExtractionStatus(c,scope(),ref)).toEqual(status);expect(c.rpc.mock.calls.map(c=>c[0])).toEqual(['read_tenant_knowledge_review','get_paige_durable_work']);expect(c.rpc.mock.calls[1][1]).toEqual({_work_id:work});});
 it.each(['claimed','succeeded','failed','blocked','cancelled','expired','outcome_unknown'])('preserves actual %s status without deriving publication',async(work_status)=>{const c=client();c.rpc.mockResolvedValueOnce({data:review,error:null}).mockResolvedValueOnce({data:[{...status,work_status,blocked_reason:work_status==='blocked'?'authority_changed':null}],error:null});expect((await readKnowledgeExtractionStatus(c,scope(),ref)).work_status).toBe(work_status);});
 it.each([[],[status,status],[{...status,work_id:other}],[{...status,capability_key:'knowledge.publish'}],[{...status,work_kind:'document'}],[{...status,work_status:'published'}],[{...status,attempt_count:0}],[{...status,max_attempts:26}],[{...status,blocked_reason:'unexpected'}],[{...status,updated_at:'yesterday'}]])('refuses unavailable/malformed status %j',async(data)=>{const c=client();c.rpc.mockResolvedValueOnce({data:review,error:null}).mockResolvedValueOnce({data,error:null});await expect(readKnowledgeExtractionStatus(c,scope(),ref)).rejects.toThrow();expect(c.rpc).toHaveBeenCalledTimes(2);});
 it('does not request job status after review association mismatch',async()=>{const c=client();c.rpc.mockResolvedValue({data:{...review,extraction_work_id:other},error:null});await expect(readKnowledgeExtractionStatus(c,scope(),ref)).rejects.toThrow();expect(c.rpc).toHaveBeenCalledTimes(1);});
 it('refuses scope change between review and job response',async()=>{const c=client(),s=scope();c.rpc.mockResolvedValueOnce({data:review,error:null}).mockImplementationOnce(async()=>{s.isCurrent.mockReturnValue(false);return {data:[status],error:null};});await expect(readKnowledgeExtractionStatus(c,s,ref)).rejects.toMatchObject({code:'EXTRACTION_SCOPE_CHANGED'});});
 it('does not retry an unavailable read',async()=>{const c=client();c.rpc.mockRejectedValue(Error('offline'));await expect(readKnowledgeExtractionStatus(c,scope(),ref)).rejects.toMatchObject({code:'EXTRACTION_READ_UNAVAILABLE'});expect(c.rpc).toHaveBeenCalledTimes(1);expect(c.functions.invoke).not.toHaveBeenCalled();});
});
describe('existing document review discovery',()=>{
 it('discovers only the exact native document/work/revision without dispatch',async()=>{const c=client();const r=await readKnowledgeExtractionForDocument(c,scope(),doc,2);expect(r.extraction_work_id).toBe(work);expect(r.pending_review?.extracted_content).toBe(input.content);expect(c.rpc).toHaveBeenCalledExactlyOnceWith('read_tenant_knowledge_review',{p_expected_tenant:tenant,p_doc_id:doc});expect(c.functions.invoke).not.toHaveBeenCalled();expect(r).not.toHaveProperty('intentId');});
 it('accepts the native idle projection only with no work and no pending review',async()=>{const c=client();c.rpc.mockResolvedValue({data:{...review,extraction_work_id:null,pending_review:null},error:null});const r=await readKnowledgeExtractionForDocument(c,scope(),doc,2);expect(r.extraction_work_id).toBeNull();expect(r.phase).toBe('review_unavailable');});
 it.each([{tenant_id:other},{document_id:other},{revision:1},{revision:3},{extraction_work_id:'invalid'},{extraction_work_id:null},{pending_review:{...pending,coverage:'invented'}},{source_binding:{...binding,object_name:other+'/x.txt'}}])('refuses stale or contradictory discovery %j',async(patch)=>{const c=client();c.rpc.mockResolvedValue({data:{...review,...patch},error:null});await expect(readKnowledgeExtractionForDocument(c,scope(),doc,2)).rejects.toMatchObject({code:'EXTRACTION_RESPONSE_INVALID'});expect(c.rpc).toHaveBeenCalledTimes(1);expect(c.functions.invoke).not.toHaveBeenCalled();});
 it('refuses discovery after scope retirement and never dispatches',async()=>{const c=client(),s=scope();c.rpc.mockImplementation(async()=>{s.isCurrent.mockReturnValue(false);return {data:review,error:null};});await expect(readKnowledgeExtractionForDocument(c,s,doc,2)).rejects.toMatchObject({code:'EXTRACTION_SCOPE_CHANGED'});expect(c.functions.invoke).not.toHaveBeenCalled();});
 it.each(['throw','error'])('keeps %s discovery unavailable without retry',async(mode)=>{const c=client();if(mode==='throw')c.rpc.mockRejectedValue(Error('offline'));else c.rpc.mockResolvedValue({data:null,error:{code:'42501'}});await expect(readKnowledgeExtractionForDocument(c,scope(),doc,2)).rejects.toMatchObject({code:'EXTRACTION_READ_UNAVAILABLE'});expect(c.rpc).toHaveBeenCalledTimes(1);expect(c.functions.invoke).not.toHaveBeenCalled();});
});
describe('native publication association recovery', () => {
 const publication = { contract_version:1, association:'not_submitted', work_id:null, work_status:null, generation_id:null, outcome:null };
 const saved = { ...review, revision:3, pending_review:{...pending,reviewed_content:'Saved exact text'}, publication };
 const pub = '66666666-6666-4666-8666-666666666666';
 it('retains exact native not-submitted proof only for a saved review', async () => {
  const c=client(); c.rpc.mockResolvedValue({data:saved,error:null});
  const actual=await readKnowledgeExtractionForDocument(c,scope(),doc,3);
  expect(actual).toHaveProperty('publication',publication);
  expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it.each(['claimed','expired','blocked','outcome_unknown','failed','cancelled'])('retains the native %s publication reference without claiming promotion', async work_status => {
  const c=client(); c.rpc.mockResolvedValue({data:{...saved,publication:{...publication,association:'matched',work_id:pub,work_status}},error:null});
  const actual=await readKnowledgeExtractionForDocument(c,scope(),doc,3);
  expect(actual).toHaveProperty('publication',{...publication,association:'matched',work_id:pub,work_status});
  expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it('validates native published proof after extraction/reference clear', async () => {
  const c=client(); c.rpc.mockResolvedValue({data:{...saved,revision:4,record_state:'canonical',pending_review:null,extraction_work_id:null,publication:{...publication,association:'matched',work_id:pub,work_status:'succeeded',generation_id:pub,outcome:'capability_completed_unrecorded'}},error:null});
  expect(await readKnowledgeExtractionForDocument(c,scope(),doc,4)).toHaveProperty('publication.outcome','capability_completed_unrecorded');
 });
 it.each(['association','work_status','outcome'].flatMap(field =>
  [[field === 'association' ? 'not_submitted' : field === 'work_status' ? 'claimed' : 'capability_completed_unrecorded'], {}, null, 42, true]
   .map(value => ({field,value}))))('refuses non-string publication enum $field=$value without writes', async ({field,value}) => {
  const base = field === 'association' ? saved : field === 'work_status'
   ? {...saved,publication:{...publication,association:'matched',work_id:pub,work_status:'claimed'}}
   : {...saved,revision:4,record_state:'canonical',pending_review:null,extraction_work_id:null,publication:{...publication,association:'matched',work_id:pub,work_status:'succeeded',generation_id:pub,outcome:'capability_completed_unrecorded'}};
  const c=client();c.rpc.mockResolvedValue({data:{...base,publication:{...base.publication,[field]:value}},error:null});
  await expect(readKnowledgeExtractionForDocument(c,scope(),doc,base.revision)).rejects.toMatchObject({code:'EXTRACTION_RESPONSE_INVALID'});
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith('read_tenant_knowledge_review',{p_expected_tenant:tenant,p_doc_id:doc});
  expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it.each([
  {contract_version:2},{association:'published'},{association:'not_submitted',work_id:pub},
  {association:'matched',work_id:'bad',work_status:'claimed'},
  {association:'matched',work_id:pub,work_status:'succeeded',generation_id:pub,outcome:'capability_succeeded'},
  {association:'matched',work_id:pub,work_status:'claimed',generation_id:pub},
  {association:'unavailable',work_id:pub},{outcome:'capability_succeeded'},
 ])('refuses malformed or conflicting pending association %j', async patch => {
  const c=client();c.rpc.mockResolvedValue({data:{...saved,publication:{...publication,...patch}},error:null});
  await expect(readKnowledgeExtractionForDocument(c,scope(),doc,3)).rejects.toMatchObject({code:'EXTRACTION_RESPONSE_INVALID'});
  expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it('does not infer publication authority from an unsolicited top-level label', async()=>{
  const c=client();c.rpc.mockResolvedValue({data:{...saved,publication:undefined,published:true},error:null});
  const actual=await readKnowledgeExtractionForDocument(c,scope(),doc,3);
  expect(actual).not.toHaveProperty('publication');expect(actual).not.toHaveProperty('published');
 });
 it('retains verified legacy idle for explicit source input without inventing a saved review',async()=>{
  const c=client();c.rpc.mockResolvedValue({data:{...review,record_state:'canonical',pending_review:null,extraction_work_id:null,publication},error:null});
  const actual=await readKnowledgeExtractionForDocument(c,scope(),doc,2);
  expect(actual.publication?.association).toBe('not_submitted');expect(actual.pending_review).toBeNull();expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it('rejects noncanonical idle publication proof',async()=>{
  const c=client();c.rpc.mockResolvedValue({data:{...review,pending_review:null,extraction_work_id:null,publication},error:null});
  await expect(readKnowledgeExtractionForDocument(c,scope(),doc,2)).rejects.toMatchObject({code:'EXTRACTION_RESPONSE_INVALID'});
 });
 const publicationRef={tenantId:tenant,documentId:doc,extractionWorkId:work,revision:3,workId:pub};
 const active={...saved,publication:{...publication,association:'matched',work_id:pub,work_status:'outcome_unknown'}};
 const promoted={...saved,revision:4,record_state:'canonical',pending_review:null,extraction_work_id:null,publication:{...publication,association:'matched',work_id:pub,work_status:'succeeded',generation_id:pub,outcome:'capability_succeeded'}};
 it('reads original uncertain publication through exact document association, never generic status',async()=>{
  const c=client();c.rpc.mockResolvedValue({data:active,error:null});
  expect(await readKnowledgePublicationForDocument(c,scope(),publicationRef)).toHaveProperty('publication.work_id',pub);
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith('read_tenant_knowledge_review',{p_expected_tenant:tenant,p_doc_id:doc});expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it('recovers lost acknowledgement by discovering native work without an invented intent',async()=>{
  const c=client();c.rpc.mockResolvedValue({data:active,error:null});
  expect(await readKnowledgePublicationForDocument(c,scope(),{...publicationRef,workId:undefined})).toHaveProperty('publication.work_id',pub);
  expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it('accepts only the source-qualified next canonical generation',async()=>{
  const c=client();c.rpc.mockResolvedValue({data:promoted,error:null});
  expect(await readKnowledgePublicationForDocument(c,scope(),publicationRef)).toHaveProperty('publication.generation_id',pub);
 });
 it.each([{tenant_id:other},{document_id:other},{revision:2},{revision:4},{extraction_work_id:other},{pending_review:{...pending,reviewed_content:null}},
  {publication:{...active.publication,work_id:other}}])('refuses current publication reference drift %j',async patch=>{
  const c=client();c.rpc.mockResolvedValue({data:{...active,...patch},error:null});
  await expect(readKnowledgePublicationForDocument(c,scope(),publicationRef)).rejects.toMatchObject({code:'EXTRACTION_RESPONSE_INVALID'});expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it.each([{revision:3},{revision:5},{publication:{...promoted.publication,generation_id:other}},
  {publication:{...promoted.publication,outcome:'published'}},{publication:undefined}])('refuses stale, advanced or unproven promoted state %j',async patch=>{
  const c=client();c.rpc.mockResolvedValue({data:{...promoted,...patch},error:null});
  await expect(readKnowledgePublicationForDocument(c,scope(),publicationRef)).rejects.toMatchObject({code:'EXTRACTION_RESPONSE_INVALID'});
 });
 it('fences retired actor/workspace incarnation after read',async()=>{
  const c=client(),s=scope();c.rpc.mockImplementation(async()=>{s.isCurrent.mockReturnValue(false);return {data:promoted,error:null};});
  await expect(readKnowledgePublicationForDocument(c,s,publicationRef)).rejects.toMatchObject({code:'EXTRACTION_SCOPE_CHANGED'});expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it('retains a known current-generation uncertain work reference without inventing a cleared extraction',async()=>{
  const c=client();c.rpc.mockResolvedValue({data:{...promoted,publication:{...active.publication}},error:null});
  const current={tenantId:tenant,documentId:doc,revision:4,workId:pub};
  expect(await readKnowledgePublicationForDocument(c,scope(),current)).toHaveProperty('publication.work_status','outcome_unknown');
  expect(c.functions.invoke).not.toHaveBeenCalled();
 });
 it.each([{workId:undefined},{revision:3},{workId:other}])('refuses an incomplete or stale current-generation reference %j',async patch=>{
  const c=client();c.rpc.mockResolvedValue({data:promoted,error:null});
  await expect(readKnowledgePublicationForDocument(c,scope(),{tenantId:tenant,documentId:doc,revision:4,workId:pub,...patch})).rejects.toMatchObject({code:'EXTRACTION_RESPONSE_INVALID'});
  expect(c.functions.invoke).not.toHaveBeenCalled();
 });
});
