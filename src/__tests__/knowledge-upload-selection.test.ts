// @vitest-environment node
import {expect,it} from 'vitest';
import {prepareKnowledgeUploadSelection,prepareKnowledgeReplacementUpload} from '@/lib/knowledge-extraction-service';
const tenant='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const scope=()=>({tenantId:tenant,isCurrent:()=>true});
const pdf=()=>({name:'Agreement.pdf',mime:'application/pdf',bytes:new TextEncoder().encode('%PDF-1.4 synthetic')});
it('retains the same original path and intent after reload/reselection without a local ledger',async()=>{const first=await prepareKnowledgeUploadSelection(scope(),actor,[pdf()]);const later=await prepareKnowledgeUploadSelection(scope(),actor,[pdf()]);expect(first[0]).toMatchObject({phase:'prepared',name:'Agreement.pdf'});expect(later[0]).toEqual(first[0]);expect(first[0].source.path.startsWith(tenant+'/'+actor+'/')).toBe(true);});
it('isolates duplicates and unsupported files without blocking permitted originals',async()=>{const rows=await prepareKnowledgeUploadSelection(scope(),actor,[pdf(),pdf(),{name:'macro.exe',mime:'application/octet-stream',bytes:new Uint8Array([1,2])},{name:'Notes.txt',mime:'text/plain',bytes:new TextEncoder().encode('Client notes')}]);expect(rows.map(r=>r.phase)).toEqual(['prepared','duplicate','refused','prepared']);expect(rows[1].duplicateOf).toBe(0);});
it('different actor or bytes cannot adopt another upload identity',async()=>{const a=await prepareKnowledgeUploadSelection(scope(),actor,[pdf()]);const b=await prepareKnowledgeUploadSelection(scope(),'33333333-3333-4333-8333-333333333333',[pdf()]);const changed=pdf();changed.bytes[changed.bytes.length-1]^=1;const c=await prepareKnowledgeUploadSelection(scope(),actor,[changed]);expect(a[0].intentId).not.toBe(b[0].intentId);expect(a[0].source.path).not.toBe(c[0].source.path);});
it('snapshots the complete selection before hashing awaits',async()=>{const files=[pdf(),{name:'Notes.txt',mime:'text/plain',bytes:new TextEncoder().encode('Original')}];const result=prepareKnowledgeUploadSelection(scope(),actor,files);files[1].bytes.fill(0);expect((await result)[1].source.bytes).toEqual(new TextEncoder().encode('Original'));});
it('rejects excessive groups before reading or uploading',async()=>{await expect(prepareKnowledgeUploadSelection(scope(),actor,Array.from({length:21},pdf))).rejects.toMatchObject({code:'EXTRACTION_INPUT_INVALID'});});
it('does not return a prepared selection to a retired workspace',async()=>{let current=true;const pending=prepareKnowledgeUploadSelection({tenantId:tenant,isCurrent:()=>current},actor,[pdf()]);current=false;await expect(pending).rejects.toMatchObject({code:'EXTRACTION_SCOPE_CHANGED'});});
it('does not reuse a native intent with a changed title or normalized source MIME',async()=>{const a=await prepareKnowledgeUploadSelection(scope(),actor,[pdf()]);const renamed=await prepareKnowledgeUploadSelection(scope(),actor,[{...pdf(),name:'Renamed agreement.pdf'}]);expect(renamed[0].intentId).not.toBe(a[0].intentId);const text={name:'Notes.txt',mime:'text/plain',bytes:new TextEncoder().encode('Notes')};const plain=await prepareKnowledgeUploadSelection(scope(),actor,[text]);const csv=await prepareKnowledgeUploadSelection(scope(),actor,[{...text,mime:'text/csv'}]);expect(csv[0].intentId).not.toBe(plain[0].intentId);});

const replacement={tenantId:tenant,documentId:'44444444-4444-4444-8444-444444444444',revision:3};
it('binds replacement upload identity to the exact document, revision and reviewed title',async()=>{
 const a=await prepareKnowledgeReplacementUpload(scope(),actor,replacement,pdf(),'Reviewed agreement');
 const again=await prepareKnowledgeReplacementUpload(scope(),actor,replacement,pdf(),'Reviewed agreement');
 expect(a).toEqual(again);expect(a.phase).toBe('prepared');
 for(const target of [{...replacement,revision:4},{...replacement,documentId:actor}])expect((await prepareKnowledgeReplacementUpload(scope(),actor,target,pdf(),'Reviewed agreement')).intentId).not.toBe(a.intentId);
 expect((await prepareKnowledgeReplacementUpload(scope(),actor,replacement,pdf(),'Another title')).intentId).not.toBe(a.intentId);
 expect(a.intentId).not.toBe((await prepareKnowledgeUploadSelection(scope(),actor,[pdf()]))[0].intentId);
});
it('refuses a foreign replacement target before file preparation',async()=>{await expect(prepareKnowledgeReplacementUpload(scope(),actor,{...replacement,tenantId:actor},pdf(),'Agreement')).rejects.toMatchObject({code:'EXTRACTION_INPUT_INVALID'});});
it('snapshots replacement identity before asynchronous hashing',async()=>{const target={...replacement};const work=prepareKnowledgeReplacementUpload(scope(),actor,target,pdf(),'Agreement');target.documentId=actor;target.revision=99;expect(await work).toEqual(await prepareKnowledgeReplacementUpload(scope(),actor,replacement,pdf(),'Agreement'));});
