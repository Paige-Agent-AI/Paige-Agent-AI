// @vitest-environment jsdom
import {webcrypto} from 'node:crypto';
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

const api=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),prepare:vi.fn(),upload:vi.fn(),submit:vi.fn(),read:vi.fn(),draft:vi.fn(),extraction:vi.fn()}));
const identity=vi.hoisted(()=>({activeTenantId:'00000000-0000-4000-8000-000000000002',activeUserId:'00000000-0000-4000-8000-000000000001',loading:false,accountContextStatus:'ready'}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>identity}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:api.getUser},rpc:api.rpc,storage:{from:()=>({})}}}));
vi.mock('@/lib/knowledge-extraction-service',async original=>({...await original<typeof import('@/lib/knowledge-extraction-service')>(),
  prepareKnowledgeUploadSelection:api.prepare,uploadKnowledgeFileOnce:api.upload,submitKnowledgeExtraction:api.submit,
  readKnowledgeDraftForDocument:api.draft,readKnowledgeExtractionForDocument:api.extraction}));
vi.mock('@/lib/knowledge-service',async original=>({...await original<typeof import('@/lib/knowledge-service')>(),readKnowledge:api.read}));
import {ChatKnowledgeDocuments} from './ChatKnowledgeDocuments';
import {saveComposerKnowledgeIntake,readComposerKnowledgeIntake,clearComposerKnowledgeIntake,setComposerDraftSessionScope} from '@/lib/paigeComposerScopeState';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actorId=id(1),tenantId=id(2),threadId=id(3),names=['First agreement.txt','Second agreement.txt'];
const originalDraft={tenantId,userId:actorId,conversationId:'new-chat',focusedClientId:'none',focusedBusinessMissionId:'none'};
let host:HTMLDivElement,root:Root,loseStage:boolean,loseLink:boolean,rejectBeforeCommit:boolean;
const nativeIntakes=new Map<string,unknown>(),nativePublications=new Map<string,unknown>(),adopt=vi.fn();
const file=(name:string,text:string)=>{
  const bytes=new TextEncoder().encode(text),f=new File([bytes],name,{type:'text/plain'});
  Object.defineProperty(f,'arrayBuffer',{value:async()=>bytes.buffer.slice(0)});return f;
};
const settle=async()=>{await new Promise(r=>setTimeout(r,25));};
const render=async(existing:string|null=null)=>{await act(async()=>{root.render(<MemoryRouter><ChatKnowledgeDocuments
  actorId={actorId} tenantId={tenantId} threadId={existing} originEpoch="original-chat-incarnation" account="1000001" disabled={false}
  recoveryIntake={readComposerKnowledgeIntake(originalDraft)}
  onBeforeFirstValue={input=>saveComposerKnowledgeIntake(originalDraft,input)}
  onAdoptThread={(id,epoch)=>{adopt(id,epoch);const pending=readComposerKnowledgeIntake(originalDraft);if(pending)clearComposerKnowledgeIntake(originalDraft,pending.extractionWorkId);}}/></MemoryRouter>);await settle();});};
const click=async(text:string)=>{
  const button=[...document.body.querySelectorAll<HTMLButtonElement>('button')].find(b=>!b.querySelector('.sr-only')&&(b.textContent===text||b.getAttribute('aria-label')===text));
  expect(button).toBeTruthy();await act(async()=>{button!.click();await settle();});
};
const choose=async(files:File[])=>{await act(async()=>{
  const input=document.querySelector<HTMLInputElement>('input[aria-label="Choose Knowledge documents"]')!;
  Object.defineProperty(input,'files',{configurable:true,value:files});input.dispatchEvent(new Event('change',{bubbles:true}));await settle();
});};
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('crypto',webcrypto);nativeIntakes.clear();nativePublications.clear();adopt.mockReset();loseStage=false;loseLink=false;rejectBeforeCommit=false;
  identity.activeTenantId=tenantId;identity.activeUserId=actorId;identity.loading=false;identity.accountContextStatus='ready';
  setComposerDraftSessionScope({kind:'clear'});sessionStorage.clear();setComposerDraftSessionScope({kind:'ready',tenantId,userId:actorId});
  api.getUser.mockReset();api.getUser.mockResolvedValue({data:{user:{id:actorId}},error:null});
  api.read.mockReset();api.read.mockResolvedValue([]);
  api.extraction.mockReset();
  api.draft.mockReset();api.draft.mockImplementation(async(_c,_s,doc:string,revision:number)=>({id:doc,tenant_id:tenantId,revision,
    title:names[Number(doc.slice(-12))-20],content:'',summary:null,category:null,tags:[]}));
  api.prepare.mockReset();api.prepare.mockImplementation(async(_s,_a,inputs:{name:string;mime:string;bytes:Uint8Array}[])=>inputs.map((input,index)=>({phase:'prepared',
    name:input.name,intentId:id(40+index),source:{path:`${tenantId}/original-${index}`,name:input.name,mime:input.mime,bytes:input.bytes}})));
  api.upload.mockReset();api.upload.mockImplementation(async(_c,_s,source)=>({phase:'stored',path:source.path}));
  api.submit.mockReset();api.submit.mockImplementation(async(_c,_s,input)=>{
    const index=Number(input.intent_id.slice(-12))-40;
    return {reference:{tenantId,documentId:id(20+index),workId:id(10+index),intentId:input.intent_id,revision:1},status:'claimed',replayed:false};
  });
  api.rpc.mockReset();api.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
    if(name==='stage_paige_chat_knowledge_intake'){
      const result={status:'recorded',current:true,reference:{schemaVersion:1,phase:'intake',actorId,tenantId,threadId,turnId:null,
        documentId:args._document_id,documentRevision:1,sourceRevision:1,sourceSha256:args._source_sha256,
        extractionWorkId:args._extraction_work_id,extractionIntentId:args._extraction_intent_id,linkRevision:1},
        currentDocumentRevision:1,extractionStatus:'claimed'};
      if(!rejectBeforeCommit)nativeIntakes.set(String(args._extraction_work_id),result);
      if(loseStage)throw Error('Acknowledgment lost after commit');
      return {data:result,error:null};
    }
    if(name==='inspect_paige_chat_knowledge_intake')return {data:nativeIntakes.get(String(args._extraction_work_id))??{status:'absent_at_read'},error:null};
    if(name==='save_paige_chat_knowledge_link'){
      const result={status:'recorded',current:true,reference:{schemaVersion:1,actorId,tenantId,threadId,turnId:null,
        documentId:args._document_id,documentRevision:args._document_revision,sourceSha256:args._source_sha256,textSha256:'b'.repeat(64),
        extractionWorkId:id(10),extractionIntentId:args._extraction_intent_id,publicationWorkId:args._publication_work_id,
        publicationIntentId:id(60),generationId:args._publication_work_id,publicationOutcome:'capability_succeeded',linkRevision:2}};
      nativePublications.set(String(args._publication_work_id),result);if(loseLink)throw Error('Link committed; acknowledgment lost');
      return{data:result,error:null};
    }
    if(name==='inspect_paige_chat_knowledge_link')return{data:nativePublications.get(String(args._publication_work_id))??{status:'absent_at_read'},error:null};
    if(name==='list_paige_chat_knowledge_links')return {data:{items:nativePublications.size?[...nativePublications.values()]:[...nativeIntakes.values()],nextCursor:null},error:null};
    throw Error('Unexpected native operation '+name);
  });
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

it('opens the current new-chat source destination without creating a thread or sending a turn',async()=>{
  await render();await click('Knowledge documents');
  expect(document.body.textContent).toContain('Knowledge in this chat');
  expect(api.rpc).not.toHaveBeenCalled();expect(api.upload).not.toHaveBeenCalled();expect(adopt).not.toHaveBeenCalled();
});
it('passes both original files through the existing bulk review and annotates their distinct native works',async()=>{
  await render();await click('Knowledge documents');const files=[file(names[0],'First source'),file(names[1],'Second source')];
  await choose(files);
  expect(document.body.textContent).toContain(names[0]);expect(document.body.textContent).toContain(names[1]);
  expect(api.upload).not.toHaveBeenCalled();
  await click('Upload and read files');await act(settle);
  expect(api.upload).toHaveBeenCalledTimes(2);expect(api.submit).toHaveBeenCalledTimes(2);
  const stages=api.rpc.mock.calls.filter(([name])=>name==='stage_paige_chat_knowledge_intake');
  expect(stages).toHaveLength(2);expect(stages.map(([,args])=>args._extraction_work_id)).toEqual([id(10),id(11)]);
  expect(stages.map(([,args])=>args._thread_id)).toEqual([null,threadId]);
  expect(stages[0][1]._source_sha256).not.toBe(stages[1][1]._source_sha256);
  // The original constructor's one thread is adopted only on leaving the flow.
  expect(adopt).not.toHaveBeenCalled();await click('Close');await click('Close');
  expect(adopt).toHaveBeenCalledExactlyOnceWith(threadId,'original-chat-incarnation');
});
it('reopens the native conversation inventory after component destruction without re-uploading',async()=>{
  await render();await click('Knowledge documents');await choose([file(names[0],'First source')]);await click('Upload and read files');await act(settle);
  await act(async()=>root.unmount());root=createRoot(host);await render(threadId);await click('Knowledge documents');
  expect(document.body.textContent).toContain(names[0]);expect(api.upload).toHaveBeenCalledTimes(1);expect(api.submit).toHaveBeenCalledTimes(1);
  expect(api.rpc.mock.calls.some(([name,args])=>name==='list_paige_chat_knowledge_links'&&args._thread_id===threadId)).toBe(true);
});
it('reconciles an acknowledged file with a lost Chat annotation response instead of uploading it twice',async()=>{
  loseStage=true;await render();await click('Knowledge documents');await choose([file(names[0],'First source')]);await click('Upload and read files');await act(settle);
  await click('Close');expect(document.body.textContent).toContain('Conversation link unconfirmed');
  await click('Inspect conversation links');await act(settle);
  expect(document.body.textContent).toContain('Reading saved with this chat');
  expect(api.rpc.mock.calls.filter(([name])=>name==='stage_paige_chat_knowledge_intake')).toHaveLength(1);
  expect(api.upload).toHaveBeenCalledTimes(1);expect(api.submit).toHaveBeenCalledTimes(1);
});
it('masks an observed workspace departure and never revives its open source on A to B to A',async()=>{
  await render();await click('Knowledge documents');await choose([file(names[0],'Private synthetic source')]);
  identity.activeTenantId=id(90);await render();expect(document.body.textContent).toContain('Workspace changed');
  expect(document.body.textContent).not.toContain(names[0]);identity.activeTenantId=tenantId;await render();
  expect(document.body.textContent).toContain('Workspace changed');expect(api.upload).not.toHaveBeenCalled();expect(api.submit).not.toHaveBeenCalled();
});
it('inspects a lost saved-publication link before allowing another link write',async()=>{
  await render(threadId);await click('Knowledge documents');await choose([file(names[0],'First source')]);await click('Upload and read files');await act(settle);await click('Close');
  api.extraction.mockResolvedValue({record_state:'canonical',pending_review:null,revision:3,
    publication:{association:'matched',work_status:'succeeded',work_id:id(50),generation_id:id(50),outcome:'capability_succeeded'}});
  await click('Open original reading');loseLink=true;await click('Link saved text to this chat');
  const buttons=()=>[...document.querySelectorAll('button')].map(b=>b.textContent);
  expect(buttons()).not.toContain('Link saved text to this chat');expect(buttons()).toContain('Inspect saved text link');
  await click('Inspect saved text link');
  expect(api.rpc.mock.calls.filter(([name])=>name==='save_paige_chat_knowledge_link')).toHaveLength(1);
  expect(api.rpc.mock.calls.some(([name])=>name==='inspect_paige_chat_knowledge_link')).toBe(true);
  expect(api.upload).toHaveBeenCalledTimes(1);expect(api.submit).toHaveBeenCalledTimes(1);
  const link=[...document.querySelectorAll<HTMLAnchorElement>('a')].find(a=>a.textContent==='Open editable saved text');
  expect(link).toBeTruthy();await act(async()=>{link!.click();await settle();});
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('retains and inspects the first native Work after lost acknowledgment, outer close and remount',async()=>{
  loseStage=true;await render();await click('Knowledge documents');await choose([file(names[0],'First source')]);await click('Upload and read files');await act(settle);
  expect(readComposerKnowledgeIntake(originalDraft)?.extractionWorkId).toBe(id(10));
  await click('Close');await click('Close');expect(adopt).not.toHaveBeenCalled();
  await act(async()=>root.unmount());root=createRoot(host);await render();await click('Knowledge documents');
  expect(api.rpc.mock.calls.some(([name,args])=>name==='inspect_paige_chat_knowledge_intake'&&args._extraction_work_id===id(10))).toBe(true);
  await click('Close');expect(adopt).toHaveBeenCalledExactlyOnceWith(threadId,'original-chat-incarnation');
  expect(readComposerKnowledgeIntake(originalDraft)).toBeNull();
  expect(api.rpc.mock.calls.filter(([name])=>name==='stage_paige_chat_knowledge_intake')).toHaveLength(1);
  expect(api.upload).toHaveBeenCalledTimes(1);expect(api.submit).toHaveBeenCalledTimes(1);
});
it('keeps an absent-at-read constructor guarded until an explicit same-operation retry',async()=>{
  loseStage=true;rejectBeforeCommit=true;await render();await click('Knowledge documents');await choose([file(names[0],'First source')]);await click('Upload and read files');await act(settle);
  await click('Close');await click('Close');await act(async()=>root.unmount());root=createRoot(host);await render();await click('Knowledge documents');
  expect(readComposerKnowledgeIntake(originalDraft)?.extractionWorkId).toBe(id(10));
  expect(api.rpc.mock.calls.filter(([name])=>name==='stage_paige_chat_knowledge_intake')).toHaveLength(1);
  loseStage=false;rejectBeforeCommit=false;await click('Link stored reading');
  const stages=api.rpc.mock.calls.filter(([name])=>name==='stage_paige_chat_knowledge_intake');
  expect(stages).toHaveLength(2);expect(stages[1][1]).toEqual(stages[0][1]);
  await click('Close');expect(adopt).toHaveBeenCalledExactlyOnceWith(threadId,'original-chat-incarnation');
  expect(api.upload).toHaveBeenCalledTimes(1);expect(api.submit).toHaveBeenCalledTimes(1);
});
it('does not create a native conversation when the original recovery cache cannot retain its reference',async()=>{
  await render();await click('Knowledge documents');await choose([file(names[0],'First source')]);
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Storage unavailable');});
  await click('Upload and read files');await act(settle);
  expect(api.rpc.mock.calls.some(([name])=>name==='stage_paige_chat_knowledge_intake')).toBe(false);
  expect(api.upload).toHaveBeenCalledTimes(1);expect(api.submit).toHaveBeenCalledTimes(1);
  expect(readComposerKnowledgeIntake(originalDraft)).toBeNull();
});
