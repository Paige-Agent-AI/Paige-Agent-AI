import {beforeEach,afterEach,expect,it,vi} from "vitest";
const h=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],rpc:vi.fn(),invoke:vi.fn(),queries:[] as unknown[][]}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:h.rpc,functions:{invoke:h.invoke},from:(table:string)=>{
  const filters:Array<(r:Record<string,unknown>)=>boolean>=[],seen:unknown[]=[table];h.queries.push(seen);let single=false,cap=Infinity;
  const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);seen.push(["eq",k,v]);return q;},neq:(k:string,v:unknown)=>{filters.push(r=>r[k]!==v);return q;},
    in:(k:string,v:unknown[])=>{filters.push(r=>v.includes(r[k]));seen.push(["in",k,v]);return q;},order:()=>q,
    contains:(k:string,v:Record<string,unknown>)=>{filters.push(r=>Object.entries(v).every(([key,value])=>(r[k] as Record<string,unknown>)?.[key]===value));seen.push(["contains",k,v]);return q;},
    limit:(v:number)=>{cap=v;return q;},maybeSingle:()=>{single=true;return q;},then:(resolve:(x:unknown)=>unknown)=>Promise.resolve({data:single?h.rows.find(r=>filters.every(f=>f(r)))??null:h.rows.filter(r=>filters.every(f=>f(r))).slice(0,cap),error:null}).then(resolve)};return q;
}}}));
const {saveSocialDraft,recoverSocialDraft,pendingSocialDraft,readSocialDesk,checkSocialPerformance}=await import("./social-publishing-data");
const T="11111111-1111-4111-8111-111111111111",P="22222222-2222-4222-8222-222222222222",A="33333333-3333-4333-8333-333333333333";
const row={id:P,tenant_id:T,kind:"text",channel:"social_post",status:"draft",title:"Original",body:"Saved",updated_at:"2026-11-13T12:00:00Z",image_url:null,size:null,brief:null,meta:{media_content_ids:[A]}};
beforeEach(()=>{sessionStorage.clear();h.queries=[];h.rows=[row];h.rpc.mockReset().mockResolvedValue({data:P,error:null});h.invoke.mockReset();});
afterEach(()=>vi.restoreAllMocks());
it("an ambiguous committed create is recovered by its original tenant/key without replaying the writer",async()=>{
 h.rpc.mockImplementation(async(fn,args)=>{h.rows.push({...row,meta:args.p_meta});return {data:null,error:{message:"transport lost"}};});
 await expect(saveSocialDraft(T,{title:"One",caption:"Caption",mediaIds:[]},null)).rejects.toThrow("could not be confirmed");
 expect(pendingSocialDraft(T)).toBeTruthy();h.rows=h.rows.slice(1);
 expect((await recoverSocialDraft(T))?.id).toBe(P);expect(h.rpc).toHaveBeenCalledTimes(1);expect(pendingSocialDraft(T)).toBeNull();
});
it("never retries an unconfirmed create when lookup has no row yet",async()=>{
 h.rpc.mockResolvedValue({data:null,error:{message:"timeout"}});await expect(saveSocialDraft(T,{title:"One",caption:"Caption",mediaIds:[]},null)).rejects.toThrow();
 expect(await recoverSocialDraft(T)).toBeNull();await expect(saveSocialDraft(T,{title:"Another",caption:"Caption",mediaIds:[]},null)).rejects.toThrow("previous draft save");expect(h.rpc).toHaveBeenCalledTimes(1);
});
it("a matching recovery key from another tenant is not adopted",async()=>{
 sessionStorage.setItem(`paige:social-draft-save:${T}`,"original-key");h.rows=[{...row,tenant_id:"foreign",meta:{social_draft_key:"original-key"}}];
 expect(await recoverSocialDraft(T)).toBeNull();expect(pendingSocialDraft(T)).toBe("original-key");expect(h.rpc).not.toHaveBeenCalled();
});
it("fails before creation when the recovery marker cannot be persisted",async()=>{
 vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("storage unavailable");});
 await expect(saveSocialDraft(T,{title:"One",caption:"Caption",mediaIds:[]},null)).rejects.toThrow();expect(h.rpc).not.toHaveBeenCalled();
});
it("updates the original piece id through the original writer, retaining literal caption and metadata",async()=>{
 await saveSocialDraft(T,{title:"Revised",caption:"Literal *caption*",mediaIds:[A]},row);
 expect(h.rpc).toHaveBeenCalledWith("save_marketing_content",expect.objectContaining({p_id:P,p_tenant_id:T,p_body:"Literal *caption*",p_channel:"social_post",p_meta:{media_content_ids:[A]}}));
});
it("read-only members never query the protected original library",async()=>{
 h.rpc.mockResolvedValue({data:[],error:null});expect((await readSocialDesk(T,false,null)).posts).toEqual([]);expect(h.queries).toEqual([]);
});
it("performance goes only through the original post/receipt action",async()=>{
 h.invoke.mockResolvedValue({data:{state:"performance",publication_id:A},error:null});await checkSocialPerformance(T,P,A);
 expect(h.invoke).toHaveBeenCalledWith("social-publish-command",{body:{action:"performance",expected_tenant_id:T,content_id:P,publication_id:A}});expect(h.rpc).not.toHaveBeenCalled();
});
