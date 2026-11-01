// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {readKnowledgeDraftForDocument} from '@/lib/knowledge-extraction-service';
const tenant='11111111-1111-4111-8111-111111111111',doc='22222222-2222-4222-8222-222222222222',work='33333333-3333-4333-8333-333333333333';
const pending={schema_version:1,extracted_content:'Original',reviewed_content:null,extraction_version:'native-v1',coverage:'complete'};
function port(patch:Record<string,unknown>={}){const review={tenant_id:tenant,document_id:doc,revision:2,record_state:'draft',source_coverage:'complete',source_binding:null,extraction_source_binding:null,extraction_work_id:work,pending_review:pending};return {functions:{invoke:vi.fn()},rpc:vi.fn(async(name:string)=>({data:name==='read_tenant_knowledge_review'?review:{...review,contract_version:1,title:'Agreement',review_available:true,work:{work_id:work,work_kind:'knowledge_extract',capability_key:'knowledge.extract'},pending_review_metadata:null,...patch},error:null}))};}
const scope=()=>({tenantId:tenant,isCurrent:()=>true});
it('restores a draft through exactly the original two reads without an inventory row',async()=>{const c=port();expect(await readKnowledgeDraftForDocument(c,scope(),doc,2)).toMatchObject({id:doc,tenant_id:tenant,title:'Agreement',content:'Original',summary:null,category:null,tags:[]});expect(c.rpc.mock.calls.map(c=>c[0])).toEqual(['read_tenant_knowledge_review','read_tenant_knowledge_pending']);expect(c.functions.invoke).not.toHaveBeenCalled();});
it('preserves the existing codepoint metadata bounds',async()=>{const tag='😀'.repeat(60);expect(await readKnowledgeDraftForDocument(port({pending_review_metadata:{title:'Agreement',summary:null,category:null,tags:[tag]}}),scope(),doc,2)).toMatchObject({tags:[tag]});});
it.each([{revision:3},{record_state:'canonical'},{extraction_work_id:doc},{pending_review:{...pending,extracted_content:'Changed'}},{pending_review_metadata:{title:'Agreement',summary:null,category:null,tags:['😀'.repeat(61)]}}])('refuses changed or malformed draft data %j',async(patch)=>{await expect(readKnowledgeDraftForDocument(port(patch),scope(),doc,2)).rejects.toThrow();});
it('withholds a draft if its captured scope retires between the pending helper and public completion', async () => {
 const c=port();const original=c.rpc.getMockImplementation()!;let pendingStarted=false,active=true;
 c.rpc.mockImplementation(async(name:string)=>{if(name==='read_tenant_knowledge_pending')pendingStarted=true;return original(name);});
 const captured={tenantId:tenant,isCurrent:()=>{if(pendingStarted&&active)queueMicrotask(()=>{active=false;});return active;}};
 await expect(readKnowledgeDraftForDocument(c,captured,doc,2)).rejects.toMatchObject({code:'EXTRACTION_SCOPE_CHANGED'});
});
