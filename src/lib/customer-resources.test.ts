import {describe, it, expect, vi} from 'vitest';
import {listCustomerResources, readCustomerResource, listOwnerResourceShares, prepareResourceShare, commitResourceShare,
  type CustomerResource, type ResourceRpc} from './customer-resources';

const scope={actor:'e0911000-0000-4000-8000-000000000001',tenant:'e0921000-0000-4000-8000-000000000001',contact:'e0931000-0000-4000-8000-000000000001'};
const doc='e0941000-0000-4000-8000-000000000001',share='e0951000-0000-4000-8000-000000000001',operation='e0961000-0000-4000-8000-000000000001';
const resource:CustomerResource={share_id:share,share_revision:2,source_fingerprint:'a'.repeat(64),document_id:doc,document_revision:3,generation_id:null,title:'Shared program guide',content:null,content_truncated:false};
const list=()=>({actor_id:scope.actor,tenant_id:scope.tenant,contact_id:scope.contact,sources:[{...resource}],next_offset:1,page_may_continue:false});
const page=()=>({actor_id:scope.actor,tenant_id:scope.tenant,contact_id:scope.contact,source_ref:{share_id:share,share_revision:2,source_fingerprint:'a'.repeat(64)},
  document:{id:doc,revision:3,generation_id:null,title:resource.title},content:'A😀B',offset:0,next_offset:3,total_characters:3,has_more:false});
const ownerRow=()=>({...resource,content:undefined,content_truncated:undefined,granted_at:'2026-10-17T00:00:00Z',revoked_at:null,receipt_id:operation,currently_available:true});
const proposal=()=>({tenant_id:scope.tenant,contact_id:scope.contact,document_id:doc,available:true,expected_share_revision:2,proposal_hash:'b'.repeat(64),source_fingerprint:'a'.repeat(64),
  document_revision:3,generation_id:null,title:resource.title,preview:'Saved public program excerpt.',preview_truncated:true,already_shared:false});
const receipt=()=>({tenant_id:scope.tenant,contact_id:scope.contact,document_id:doc,share_id:share,receipt_id:operation,replayed:false,changed:true,original_revision:3,current_revision:3,currently_available:true});
function client(value:unknown):ResourceRpc {return {rpc:vi.fn(async()=>({data:value,error:null}))};}
describe('canonical customer resource client',()=>{
  it('uses the existing SDK receiver and requests metadata without retrieving private Knowledge or prompt content',async()=>{
    const sdk={marker:true,async rpc(name:string,args:Record<string,unknown>){expect(this.marker).toBe(true);expect(name).toBe('client_portal_knowledge_context');expect(args.p_include_content).toBe(false);expect(args.p_tenant_id).toBe(scope.tenant);return {data:list(),error:null};}};
    expect((await listCustomerResources(sdk,scope)).resources).toEqual([resource]);
  });
  it.each(['actor_id','tenant_id','contact_id'])('rejects a foreign %s before exposing a list',async key=>{
    const value=list();value[key as keyof typeof value]='e0991000-0000-4000-8000-000000000009' as never;
    await expect(listCustomerResources(client(value),scope)).rejects.toThrow('CUSTOMER_RESOURCE_RESPONSE_INVALID');
  });
  it.each(['private_url','content','extraction_input'])('refuses unexpected source field %s',async key=>{
    const value=list();value.sources[0]={...resource,[key]:'PRIVATE'};
    await expect(listCustomerResources(client(value),scope)).rejects.toThrow();
  });
  it('refuses duplicate grants, a false next offset and fabricated continuation',async()=>{
    for(const value of [{...list(),sources:[resource,resource],next_offset:2},{...list(),next_offset:20},{...list(),page_may_continue:true}])
      await expect(listCustomerResources(client(value),scope)).rejects.toThrow();
  });
  it('uses native Unicode offsets rather than UTF-16 string length',async()=>{
    const sdk=client(page());expect((await readCustomerResource(sdk,scope,resource)).next_offset).toBe(3);
    expect(sdk.rpc).toHaveBeenCalledWith('client_portal_knowledge_document',expect.objectContaining({p_share_id:share,p_share_revision:2,p_source_fingerprint:'a'.repeat(64),p_offset:0,p_limit:12000}));
  });
  it.each([
    {source_ref:{share_id:share,share_revision:1,source_fingerprint:'a'.repeat(64)}},
    {source_ref:{share_id:share,share_revision:2,source_fingerprint:'b'.repeat(64)}},
    {source_ref:{share_id:share,share_revision:2,source_fingerprint:'a'.repeat(64),private_url:'https://private.test'}},
    {document:{id:doc,revision:4,generation_id:null,title:'Changed version'}},
    {document:{id:doc,revision:3,generation_id:null,title:'Guide',metadata:'private'}},
    {next_offset:4},{has_more:true},{content:'A'.repeat(12001),next_offset:12001,total_characters:12001},
  ])('rejects changed/extra or inconsistent resource fields %#',async patch=>{
    await expect(readCustomerResource(client({...page(),...patch}),scope,resource)).rejects.toThrow();
  });
  it('accepts honest EOF and refuses non-progressing continuation',async()=>{
    expect((await readCustomerResource(client({...page(),content:'',offset:3,next_offset:3}),scope,resource,3)).has_more).toBe(false);
    await expect(readCustomerResource(client({...page(),content:'',next_offset:0,has_more:true}),scope,resource)).rejects.toThrow();
  });
  it('propagates native denial without fallback or a second read',async()=>{
    const sdk={rpc:vi.fn(async()=>({data:null,error:{code:'42501'}}))};
    await expect(readCustomerResource(sdk,scope,resource)).rejects.toThrow('42501');expect(sdk.rpc).toHaveBeenCalledTimes(1);
  });
  it('decodes actual owner share receipts without content/private source fields',async()=>{
    const {content:_,content_truncated:__,...row}=ownerRow();
    expect((await listOwnerResourceShares(client({tenant_id:scope.tenant,contact_id:scope.contact,shares:[row],next_offset:1,page_may_continue:false}),scope)).shares[0].receipt_id).toBe(operation);
    await expect(listOwnerResourceShares(client({tenant_id:scope.tenant,contact_id:scope.contact,shares:[{...row,private_url:'https://private.test'}],next_offset:1,page_may_continue:false}),scope)).rejects.toThrow();
  });
  it('freezes a scope-bound current version proposal and sends one exact native operation',async()=>{
    const prepared=await prepareResourceShare(client(proposal()),scope,doc,true);expect(Object.isFrozen(prepared)).toBe(true);
    const sdk=client(receipt());expect((await commitResourceShare(sdk,scope,prepared,operation)).receipt_id).toBe(operation);
    expect(sdk.rpc).toHaveBeenCalledTimes(1);expect(sdk.rpc).toHaveBeenCalledWith('set_client_portal_knowledge_share',{
      p_tenant_id:scope.tenant,p_contact_id:scope.contact,p_document_id:doc,p_available:true,p_expected_share_revision:2,p_proposal_hash:'b'.repeat(64),p_operation_id:operation,
    });
  });
  it('permits withdrawal review after source retirement without inventing a preview',async()=>{
    const value={...proposal(),available:false,title:null,preview:null,preview_truncated:false,already_shared:false};
    expect((await prepareResourceShare(client(value),scope,doc,false)).preview).toBeNull();
    await expect(prepareResourceShare(client({...value,preview:'Private source fallback'}),scope,doc,false)).rejects.toThrow();
  });
  it.each([{receipt_id:share},{document_id:share},{current_revision:4},{changed:false},{source_url:'https://private.test'}])('never confirms a mismatched saved receipt %#',async patch=>{
    await expect(commitResourceShare(client({...receipt(),...patch}),scope,proposal(),operation)).rejects.toThrow();
  });
  it('never retries transport ambiguity or changes its operation identity',async()=>{
    const sdk={rpc:vi.fn(async()=>{throw Error('acknowledgement lost');})};
    await expect(commitResourceShare(sdk,scope,proposal(),operation)).rejects.toThrow('acknowledgement lost');expect(sdk.rpc).toHaveBeenCalledTimes(1);
  });
  it('does not dispatch a proposal into a different customer or business scope',async()=>{
    const sdk=client(receipt());await expect(commitResourceShare(sdk,{...scope,contact:share},proposal(),operation)).rejects.toThrow();expect(sdk.rpc).not.toHaveBeenCalled();
  });
});
