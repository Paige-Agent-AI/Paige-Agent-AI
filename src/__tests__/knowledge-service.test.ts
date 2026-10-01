// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {readKnowledge,updateKnowledgeMetadata} from '../lib/knowledge-service';
const doc={id:'doc-a',tenant_id:'tenant-a',revision:2,title:'Updated',summary:null,category:null,tags:[],source:'paste',source_url:null,chunk_count:0,created_at:'2026-09-30',updated_at:'2026-09-30'};
function client(data: unknown,error: {message:string;code?:string}|null=null) { return {rpc:vi.fn().mockResolvedValue({data,error})}; }
describe('canonical Knowledge adapter',()=>{
 it('refuses unresolved workspace without requesting',async()=>{const c=client(null);await expect(readKnowledge(c,'')).rejects.toThrow('Select a workspace');expect(c.rpc).not.toHaveBeenCalled();});
 it('binds and returns the requested page',async()=>{const c=client({tenant_id:'tenant-a',documents:[doc]});expect(await readKnowledge(c,'tenant-a',{offset:50})).toEqual([doc]);expect(c.rpc).toHaveBeenCalledWith('read_tenant_knowledge',expect.objectContaining({p_expected_tenant:'tenant-a',p_offset:50}));});
 it('rejects a wrong-tenant row even in a scoped envelope',async()=>{await expect(readKnowledge(client({tenant_id:'tenant-a',documents:[{...doc,tenant_id:'tenant-b'}]}),'tenant-a')).rejects.toThrow('requested workspace');});
 it('preserves completed-unrecorded instead of retrying mutation',async()=>{const c=client({tenant_id:'tenant-a',document:doc,outcome:'capability_completed_unrecorded',run_id:'run'});expect((await updateKnowledgeMetadata(c,'tenant-a','doc-a',1,{title:'Updated'})).outcome).toBe('capability_completed_unrecorded');expect(c.rpc).toHaveBeenCalledTimes(1);});
 it('preserves revision conflict and makes no retry',async()=>{const c=client(null,{message:'KNOWLEDGE_REVISION_CONFLICT',code:'40001'});await expect(updateKnowledgeMetadata(c,'tenant-a','doc-a',1,{title:'Updated'})).rejects.toMatchObject({code:'40001'});expect(c.rpc).toHaveBeenCalledTimes(1);});
 it('rejects zero-change success',async()=>{const c=client({tenant_id:'tenant-a',document:{...doc,revision:1},outcome:'capability_succeeded',run_id:'run'});await expect(updateKnowledgeMetadata(c,'tenant-a','doc-a',1,{title:'Updated'})).rejects.toThrow('saved revision');});
 it('does not manufacture success after transport rejection',async()=>{const c={rpc:vi.fn().mockRejectedValue(new Error('lost acknowledgement'))};await expect(updateKnowledgeMetadata(c,'tenant-a','doc-a',1,{title:'Updated'})).rejects.toThrow('lost acknowledgement');expect(c.rpc).toHaveBeenCalledTimes(1);});
});
