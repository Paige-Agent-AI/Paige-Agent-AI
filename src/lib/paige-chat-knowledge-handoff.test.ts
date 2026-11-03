import {webcrypto} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createChatKnowledgeHandoff} from './paige-chat-knowledge-handoff';
import type {ChatKnowledgePort} from './paige-chat-knowledge-service';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actorId=id(1),tenantId=id(2),threadId=id(3);
function file(name:string,text:string){
  const bytes=new TextEncoder().encode(text),value=new File([bytes],name,{type:'text/plain'});
  Object.defineProperty(value,'arrayBuffer',{configurable:true,value:async()=>bytes.buffer.slice(0)});
  return value;
}
function fixture(){
  let live=true,sourceLive=true,loseStage=false,losePublication=false,stageAbsent=false;
  const calls:{name:string;args:Record<string,unknown>}[]=[],intakes=new Map<string,unknown>(),publications=new Map<string,unknown>();
  const port:ChatKnowledgePort={getScope:async()=>({actorId,tenantId}),rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='stage_paige_chat_knowledge_intake'){
      const reference={schemaVersion:1,phase:'intake',actorId,tenantId,threadId,turnId:null,
        documentId:args._document_id,documentRevision:1,sourceRevision:1,sourceSha256:args._source_sha256,
        extractionWorkId:args._extraction_work_id,extractionIntentId:args._extraction_intent_id,linkRevision:1};
      const result={status:'recorded',current:true,reference,currentDocumentRevision:1,extractionStatus:'succeeded'};
      if(!stageAbsent)intakes.set(String(args._extraction_work_id),result);
      if(loseStage)throw Error('lost stage acknowledgment');
      return {data:result,error:null};
    }
    if(name==='inspect_paige_chat_knowledge_intake')return {data:intakes.get(String(args._extraction_work_id))??{status:'absent_at_read'},error:null};
    if(name==='save_paige_chat_knowledge_link'){
      // Original native publication Work starts at revision0, independently of intake revision1.
      if(!publications.has(String(args._publication_work_id))&&args._expected_link_revision!==0)return {data:null,error:{code:'40001',message:'CHAT_KNOWLEDGE_LINK_CONFLICT'}};
      const paired=[...intakes.values()].find(value=>(value as {reference:{documentId:unknown}}).reference.documentId===args._document_id) as {reference:{extractionWorkId:string}};
      const reference={schemaVersion:1,actorId,tenantId,threadId,turnId:null,documentId:args._document_id,
        documentRevision:args._document_revision,sourceSha256:args._source_sha256,textSha256:'b'.repeat(64),
        extractionWorkId:paired.reference.extractionWorkId,extractionIntentId:args._extraction_intent_id,publicationWorkId:args._publication_work_id,
        publicationIntentId:id(30),generationId:args._publication_work_id,publicationOutcome:'capability_succeeded',linkRevision:1};
      const result={status:'recorded',current:true,reference};publications.set(String(args._publication_work_id),result);
      if(losePublication)throw Error('lost publication acknowledgment');
      return {data:result,error:null};
    }
    if(name==='inspect_paige_chat_knowledge_link')return {data:publications.get(String(args._publication_work_id))??{status:'absent_at_read'},error:null};
    throw Error('Unexpected effect '+name);
  }};
  const files=[file('first.txt','first agreement'),file('second.txt','second agreement')];
  const changed=vi.fn();
  const host=createChatKnowledgeHandoff(port,{actorId,tenantId,threadId:null,isCurrent:()=>live},files,changed,()=>true);
  const ack=(index=0)=>({reference:{tenantId,documentId:id(20+index),workId:id(10+index),intentId:id(40+index),revision:1},status:'succeeded' as const,replayed:false});
  const context=(index=0)=>({selectionIndex:index,isCurrent:()=>sourceLive});
  const pub=(index=0)=>({tenantId,documentId:id(20+index),revision:3,workId:id(50+index),generationId:id(50+index),outcome:'capability_succeeded' as const});
  return {port,files,host,calls,ack,context,pub,intakes,publications,changed,
    retire:()=>{live=false;},retireSource:()=>{sourceLive=false;},
    loseStage:(absent=false)=>{loseStage=true;stageAbsent=absent;},
    restoreStage:()=>{loseStage=false;stageAbsent=false;},losePublication:()=>{losePublication=true;}};
}
beforeEach(()=>vi.stubGlobal('crypto',webcrypto));
afterEach(()=>vi.unstubAllGlobals());
describe('original Chat Knowledge observer handoff',()=>{
  it('has no effect until the original extraction observer acknowledges a selected file',()=>{
    const f=fixture();expect(f.calls).toEqual([]);expect(f.host.getRows()).toEqual([]);
  });
  it('keeps both original file hashes/work identities in one native first-value conversation',async()=>{
    const f=fixture();await Promise.all([f.host.acknowledgeExtraction(f.ack(0),f.context(0)),f.host.acknowledgeExtraction(f.ack(1),f.context(1))]);
    const writes=f.calls.filter(c=>c.name==='stage_paige_chat_knowledge_intake');
    expect(writes).toHaveLength(2);expect(writes.map(c=>c.args._thread_id)).toEqual([null,threadId]);
    expect(writes.map(c=>c.args._extraction_work_id)).toEqual([id(10),id(11)]);
    expect(writes[0].args._source_sha256).not.toEqual(writes[1].args._source_sha256);
    expect(f.host.getRows().map(r=>r.phase)).toEqual(['reading_linked','reading_linked']);
  });
  it('queues a quick publication behind its actual native intake without inventing a message',async()=>{
    const f=fixture();await Promise.all([f.host.acknowledgeExtraction(f.ack(),f.context()),f.host.verifyPublication(f.pub(),f.context())]);
    const write=f.calls.find(c=>c.name==='save_paige_chat_knowledge_link')!;
    expect(write.args._thread_id).toBe(threadId);expect(write.args._turn_id).toBeNull();
    expect(write.args._extraction_intent_id).toBe(id(40));expect(write.args._expected_link_revision).toBe(0);
    expect(f.host.getRows()[0].phase).toBe('published_linked');
  });
  it('does not attach a different document publication to the selected file',async()=>{
    const f=fixture();await f.host.acknowledgeExtraction(f.ack(),f.context());
    await f.host.verifyPublication({...f.pub(),documentId:id(99)},f.context());
    expect(f.calls.some(c=>c.name==='save_paige_chat_knowledge_link')).toBe(false);
  });
  it('requires a per-file index for a bulk observer',async()=>{
    const f=fixture();await expect(f.host.acknowledgeExtraction(f.ack(),{isCurrent:()=>true})).rejects.toThrow('Selection changed');
    expect(f.calls).toEqual([]);
  });
  it('permanently withholds an old workspace result and starts no native annotation',async()=>{
    const f=fixture();f.retire();await f.host.acknowledgeExtraction(f.ack(),f.context());expect(f.calls).toEqual([]);
  });
  it('rechecks the actual actor before dispatching the original native writer',async()=>{
    const f=fixture();f.port.getScope=async()=>({actorId:id(90),tenantId});
    await f.host.acknowledgeExtraction(f.ack(),f.context());expect(f.calls).toEqual([]);
    expect(f.host.getRows()[0].phase).toBe('link_unconfirmed');
  });
  it('does not dispatch after its source closes during original-byte capture',async()=>{
    const f=fixture();Object.defineProperty(f.files[0],'arrayBuffer',{configurable:true,value:async()=>{f.retireSource();return new Uint8Array([1]).buffer;}});
    await f.host.acknowledgeExtraction(f.ack(),f.context());expect(f.calls).toEqual([]);
  });
  it('inspects a committed intake after a lost response without starting it twice',async()=>{
    const f=fixture();f.loseStage();await f.host.acknowledgeExtraction(f.ack(),f.context());
    expect(f.host.getRows()[0].phase).toBe('link_unconfirmed');
    await f.host.inspect();expect(f.host.getRows()[0].phase).toBe('reading_linked');
    expect(f.calls.filter(c=>c.name==='stage_paige_chat_knowledge_intake')).toHaveLength(1);
  });
  it('does not fork a new conversation for the second file while the first thread is unknown',async()=>{
    const f=fixture();f.loseStage();await f.host.acknowledgeExtraction(f.ack(0),f.context(0));
    f.restoreStage();await f.host.acknowledgeExtraction(f.ack(1),f.context(1));
    expect(f.calls.filter(c=>c.name==='stage_paige_chat_knowledge_intake')).toHaveLength(1);
    expect(f.host.getRows()[1].phase).toBe('link_unconfirmed');
    await f.host.inspect();expect(f.host.getThreadId()).toBe(threadId);
    expect(f.host.getRows()[1].phase).toBe('link_absent');
    await f.host.retryIntake(1);
    const writes=f.calls.filter(c=>c.name==='stage_paige_chat_knowledge_intake');
    expect(writes).toHaveLength(2);expect(writes[1].args._thread_id).toBe(threadId);
    expect(f.host.getRows().map(r=>r.phase)).toEqual(['reading_linked','reading_linked']);
  });
  it('requires inspection and an explicit same-operation retry after absence',async()=>{
    const f=fixture();f.loseStage(true);await f.host.acknowledgeExtraction(f.ack(),f.context());
    await f.host.retryIntake(0);expect(f.calls.filter(c=>c.name==='stage_paige_chat_knowledge_intake')).toHaveLength(1);
    await f.host.inspect();expect(f.host.getRows()[0].phase).toBe('link_absent');
    f.restoreStage();await f.host.retryIntake(0);
    const writes=f.calls.filter(c=>c.name==='stage_paige_chat_knowledge_intake');
    expect(writes).toHaveLength(2);expect(writes[1].args).toEqual(writes[0].args);
    expect(f.host.getRows()[0].phase).toBe('reading_linked');
  });
  it('reconciles committed publication first and never uploads or publishes again',async()=>{
    const f=fixture();await f.host.acknowledgeExtraction(f.ack(),f.context());f.losePublication();
    await f.host.verifyPublication(f.pub(),f.context());await f.host.inspect();
    expect(f.host.getRows()[0].phase).toBe('published_linked');
    expect(f.calls.filter(c=>c.name==='save_paige_chat_knowledge_link')).toHaveLength(1);
    expect(f.calls.every(c=>/^(stage|inspect|save)_paige_chat_knowledge_/.test(c.name))).toBe(true);
  });
  it('does not relabel a revoked or changed original source as a current link',async()=>{
    const f=fixture();await f.host.acknowledgeExtraction(f.ack(),f.context());
    f.intakes.set(id(10),{status:'recorded',current:false,reason:'source_unavailable_or_changed'});
    await f.host.inspect();expect(f.host.getRows()[0].phase).toBe('link_unconfirmed');
    await f.host.retryIntake(0);expect(f.calls.filter(c=>c.name==='stage_paige_chat_knowledge_intake')).toHaveLength(1);
  });
});


it('keeps intake and publication revisions separate for every file in a bulk selection',async()=>{
 const f=fixture();await Promise.all([f.host.acknowledgeExtraction(f.ack(0),f.context(0)),f.host.acknowledgeExtraction(f.ack(1),f.context(1))]);
 await Promise.all([f.host.verifyPublication(f.pub(0),f.context(0)),f.host.verifyPublication(f.pub(1),f.context(1))]);
 expect(f.host.getRows().map(row=>row.phase)).toEqual(['published_linked','published_linked']);
 const writes=f.calls.filter(c=>c.name==='save_paige_chat_knowledge_link');expect(writes).toHaveLength(2);
 expect(writes.map(c=>c.args._expected_link_revision)).toEqual([0,0]);expect(writes.map(c=>c.args._publication_work_id)).toEqual([id(50),id(51)]);
 expect(f.calls.filter(c=>c.name==='stage_paige_chat_knowledge_intake')).toHaveLength(2);
});
