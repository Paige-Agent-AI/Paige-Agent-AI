import {act, StrictMode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {useClientDocuments} from "./useClientDocuments";

const f=vi.hoisted(()=>({user:{id:"e0914000-0000-0000-0000-000000000001"} as {id:string}|null,
 rpc:vi.fn(),read:vi.fn(),from:vi.fn(),upload:vi.fn(),download:vi.fn(),sign:vi.fn(),getUser:vi.fn(),list:vi.fn(),
 listener:null as null|((event:string,session:{user:{id:string}}|null)=>void),
 rows:[] as Record<string,unknown>[],reserved:null as Record<string,unknown>|null,object:false,befores:[] as unknown[]}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{
 auth:{getUser:()=>f.getUser(),onAuthStateChange:(cb:typeof f.listener)=>{f.listener=cb;return{data:{subscription:{unsubscribe:vi.fn()}}};}},
 rpc:(...a:unknown[])=>f.rpc(...a),from:(...a:unknown[])=>f.from(...a),
 storage:{from:()=>({upload:(...a:unknown[])=>f.upload(...a),download:(...a:unknown[])=>f.download(...a),createSignedUrl:(...a:unknown[])=>f.sign(...a)})},
 channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:vi.fn(),
}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const actor="e0914000-0000-0000-0000-000000000001",tenant="e0924000-0000-0000-0000-000000000001",contact="e0934000-0000-0000-0000-000000000001";
const profile=()=>({id:contact,tenant_id:tenant,linked_user_id:actor,first_name:"Test",last_name:"Customer",entity_name:null,street_address:null,city:null,state:null,zip_code:null,onboarding_stage:"completed",is_signup_contact:false,paige_shared_context_consent:false,paige_shared_context_consent_updated_at:null,updated_at:"2026-01-01T00:00:00Z",email:"customer@tests.invalid",phone:null,contact_methods:[]});
const row=(id="e0944000-0000-0000-0000-000000000001")=>({id,tenant_id:tenant,contact_id:contact,uploaded_by_user_id:actor,storage_path:`${tenant}/${contact}/shared/${id}`,original_filename:"Preparation.pdf",mime_type:"application/pdf",size_bytes:4,visibility:"shared",upload_state:"ready",created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"});
/** The client_portal_documents row for a stored file row — exactly the 9 keys the server projects. */
const listed=(r:Record<string,unknown>)=>({id:r.id,filename:r.original_filename,mime_type:r.mime_type,size_bytes:r.size_bytes,
 source:r.visibility==="client_upload"?"you":"business",state:r.upload_state,shared_at:r.visibility==="shared"?"2026-01-01T00:00:00Z":null,created_at:r.created_at,storage_path:r.storage_path});
const envelope=(rows:Record<string,unknown>[],more=false)=>({tenant_id:tenant,client_id:contact,summary:{shared:rows.filter(r=>r.visibility==="shared").length,from_you:rows.filter(r=>r.visibility==="client_upload").length},files:rows.map(listed),has_more:more});
const file=()=>new File(["test"],"Preparation.pdf",{type:"application/pdf"});
let state:ReturnType<typeof useClientDocuments>,root:Root,host:HTMLDivElement;
function Probe(){state=useClientDocuments();return <output>{JSON.stringify(state)}</output>;}
const flush=async()=>act(async()=>{for(let i=0;i<60;i++)await Promise.resolve();});
const mount=async(strict=false)=>{await act(async()=>root.render(strict?<StrictMode><Probe/></StrictMode>:<Probe/>));await flush();};
function defer<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
beforeEach(()=>{vi.clearAllMocks();f.user={id:actor};f.listener=null;f.rows=[row()];f.reserved=null;f.object=false;f.befores=[];
 f.getUser.mockImplementation(async()=>({data:{user:f.user},error:null}));
 f.read.mockImplementation(async()=>({data:f.reserved,error:null}));
 f.list.mockImplementation(async()=>({data:envelope(f.rows),error:null}));
 f.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,maybeSingle:()=>f.read(true)};return q;});
 f.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==="client_portal_self_profile")return{data:profile(),error:null};
  if(name==="client_portal_documents"){f.befores.push(args.p_before);return f.list(args);}
  if(name==="client_portal_begin_file_upload"){
   f.reserved??={...row(String(args.p_file_id)),storage_path:`${tenant}/${contact}/client_upload/${actor}/${args.p_file_id}`,visibility:"client_upload",upload_state:"pending"};
   return{data:f.reserved,error:null};
  }
  if(name==="client_portal_file_upload_status")return{data:{file:f.reserved,object_verified:f.object},error:null};
  if(name==="client_portal_finish_file_upload"){if(f.reserved)f.reserved={...f.reserved,upload_state:"ready"};return{data:f.reserved,error:null};}
  throw Error("Unexpected RPC");
 });
 f.upload.mockImplementation(async()=>{f.object=true;return{data:{path:"stored"},error:null};});
 f.download.mockResolvedValue({data:new Blob(["test"]),error:null});
 f.sign.mockImplementation(async(path:string,expires:number,options?:{download?:string})=>({data:{signedUrl:`https://storage.invalid/${path}?e=${expires}${options?.download?`&download=${options.download}`:""}`},error:null}));
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});

it("lists through the closed client_portal_documents read, never the file table or raw CRM",async()=>{await mount();expect(state.phase).toBe("ready");expect(state.files).toHaveLength(1);expect(state.files[0].source).toBe("business");expect(state.summary).toEqual({shared:1,from_you:0});expect(f.rpc).toHaveBeenCalledWith("client_portal_documents",{p_tenant_id:tenant,p_limit:50,p_before:null});expect(f.from).not.toHaveBeenCalled();expect(f.befores).toEqual([null]);});
it("distinguishes successful empty records from a failed read",async()=>{f.rows=[];await mount();expect(state.phase).toBe("ready");expect(state.files).toEqual([]);f.list.mockResolvedValue({data:null,error:{code:"503"}});await act(async()=>state.refresh());expect(state.phase).toBe("error");expect(state.files).toEqual([]);});
it.each(["tenant","client","extra key","description","uploader","pending shared","foreign path"])("refuses a list with %s",async(which)=>{const page:Record<string,unknown>=envelope([row()]);const file=(page.files as Record<string,unknown>[])[0];
 if(which==="tenant")page.tenant_id="e0924000-0000-0000-0000-000000000002";if(which==="client")page.client_id="e0934000-0000-0000-0000-000000000002";
 if(which==="extra key")page.next_before=null;if(which==="description")file.description="private";if(which==="uploader")file.uploaded_by_user_id=actor;
 if(which==="pending shared")file.state="pending";if(which==="foreign path")file.storage_path=`e0924000-0000-0000-0000-000000000002/${contact}/shared/x`;
 f.list.mockResolvedValue({data:page,error:null});await mount();expect(state.phase).toBe("error");expect(state.files).toEqual([]);});
it("treats a lost relationship on the list read as unavailable, not empty",async()=>{f.list.mockResolvedValue({data:null,error:null});await mount();expect(state.phase).toBe("unavailable");});
it("retires revoked access before reading documents",async()=>{f.rpc.mockResolvedValue({data:null,error:null});await mount();expect(state.phase).toBe("unavailable");expect(f.list).not.toHaveBeenCalled();});
it("does not expose a late read after sign-out and return",async()=>{const pending=defer<{data:Record<string,unknown>;error:null}>();f.list.mockReturnValueOnce(pending.promise);await mount();f.user=null;act(()=>f.listener?.("SIGNED_OUT",null));f.user={id:actor};act(()=>f.listener?.("SIGNED_IN",{user:f.user!}));await flush();pending.resolve({data:envelope([row("e0944000-0000-0000-0000-000000000099")]),error:null});await flush();expect(state.files[0].id).toBe(row().id);expect(state.epoch).toBeGreaterThan(0);});
it("preserves scope and selection lifetime on the file-picker focus return",async()=>{await mount();const epoch=state.epoch;act(()=>window.dispatchEvent(new Event("focus")));expect(state.phase).toBe("ready");await flush();expect(state.epoch).toBe(epoch);expect(state.phase).toBe("ready");});
it("works after StrictMode effect cleanup without accepting the old lifetime",async()=>{await mount(true);expect(state.phase).toBe("ready");expect(state.isCurrent(state.epoch)).toBe(true);expect((await state.retrieve(state.files[0]))?.view).toContain("e=60");});
it("mints one-minute signed links — a view link and a download under the file's own name — never a blob",async()=>{await mount();const links=await state.retrieve(state.files[0]);const path=state.files[0].storage_path;expect(f.sign).toHaveBeenCalledWith(path,60);expect(f.sign).toHaveBeenCalledWith(path,60,{download:"Preparation.pdf"});expect(links?.download).toContain("download=Preparation.pdf");expect(links!.expiresAt-Date.now()).toBeLessThanOrEqual(60_000);expect(f.download).not.toHaveBeenCalled();});
it("never signs a path the list did not return",async()=>{await mount();expect(await state.retrieve({...state.files[0],storage_path:`${tenant}/${contact}/internal/other`})).toBeNull();expect(f.sign).not.toHaveBeenCalled();});
it("reports a signing refusal instead of an empty link",async()=>{await mount();f.sign.mockResolvedValue({data:null,error:{message:"Object not found"}});await expect(state.retrieve(state.files[0])).rejects.toThrow(/could not be opened/);});
it("pages fifty records by the oldest shown, and deduplicates repeated records",async()=>{f.rows=Array.from({length:50},(_,i)=>({...row(`e0944000-0000-0000-0000-${String(i+1).padStart(12,"0")}`),created_at:`2026-01-01T00:00:${String(59-i).padStart(2,"0")}Z`}));f.list.mockImplementation(async()=>({data:envelope(f.rows,true),error:null}));await mount();expect(state.more).toBe(true);f.rows=[{...row(),created_at:"2026-01-01T00:00:59Z"},row("e0944000-0000-0000-0000-000000000051")];f.list.mockImplementation(async()=>({data:envelope(f.rows,false),error:null}));await act(async()=>state.refresh(true));expect(state.files).toHaveLength(51);expect(f.befores.at(-1)).toBe("2026-01-01T00:00:10Z");expect(state.more).toBe(false);});
it("confirms the saved upload through actual status and independent metadata readback",async()=>{await mount();await act(async()=>state.transfer(file()));expect(state.upload.kind).toBe("saved");expect(f.upload).toHaveBeenCalledWith(f.reserved!.storage_path,expect.any(File),{contentType:"application/pdf",upsert:false});expect(f.rpc).toHaveBeenCalledWith("client_portal_begin_file_upload",expect.objectContaining({p_expected_client_id:contact,p_tenant_id:tenant}));expect(f.read).toHaveBeenCalledWith(true);expect(state.files[0]).toMatchObject({source:"you",state:"ready"});});
it("never starts an upload after the actual subject changes",async()=>{await mount();f.user={id:"e0914000-0000-0000-0000-000000000002"};await act(async()=>state.transfer(file()));expect(state.phase).toBe("unavailable");expect(f.rpc.mock.calls.some(([n])=>n==="client_portal_begin_file_upload")).toBe(false);expect(f.upload).not.toHaveBeenCalled();});
it("does not report saved from the writer acknowledgement alone",async()=>{await mount();f.read.mockImplementation(async()=>({data:null,error:null}));await act(async()=>state.transfer(file()));expect(state.upload.kind).toBe("uncertain");expect(state.files.every(r=>r.source==="business")).toBe(true);});
it("holds an unknown transfer, checks read-only and retries the same ID without overwriting",async()=>{await mount();f.upload.mockResolvedValueOnce({data:null,error:{message:"connection lost"}});await act(async()=>state.transfer(file()));expect(state.upload.kind).toBe("uncertain");const count=f.rpc.mock.calls.length;await act(async()=>state.transfer(file()));expect(f.rpc.mock.calls.length).toBe(count);await act(async()=>state.checkUpload());expect(state.upload.kind).toBe("retry");await act(async()=>state.transfer(file()));expect(state.upload.kind).toBe("saved");const ids=f.rpc.mock.calls.filter(([n])=>n==="client_portal_begin_file_upload").map(([,a])=>a.p_file_id);expect(new Set(ids).size).toBe(1);});
it("recovers a lost final acknowledgement without a second transfer or finalize",async()=>{await mount();const canonical=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(...args:unknown[])=>{const result=await canonical(...args);if(args[0]==="client_portal_finish_file_upload")throw Error("reply lost");return result;});await act(async()=>state.transfer(file()));expect(state.upload.kind).toBe("uncertain");await act(async()=>state.checkUpload());expect(state.upload.kind).toBe("saved");expect(f.upload).toHaveBeenCalledTimes(1);expect(f.rpc.mock.calls.filter(([n])=>n==="client_portal_finish_file_upload")).toHaveLength(1);});
it("stops local waiting and ignores the late reply before any further write",async()=>{await mount();const pending=defer<{data:null;error:null}>();const canonical=f.rpc.getMockImplementation()!;f.rpc.mockImplementation((name:string,...args:unknown[])=>name==="client_portal_begin_file_upload"?pending.promise:canonical(name,...args));let job!:Promise<void>;act(()=>{job=state.transfer(file());});await flush();act(()=>state.stopWaiting());expect(state.upload.kind).toBe("uncertain");pending.resolve({data:null,error:null});await act(async()=>job);expect(state.upload.kind).toBe("uncertain");expect(f.upload).not.toHaveBeenCalled();expect(f.rpc.mock.calls.some(([n])=>n==="client_portal_finish_file_upload")).toBe(false);});
it("clears a late link after subject/session retirement",async()=>{await mount();const pending=defer<{data:{signedUrl:string};error:null}>();f.sign.mockReturnValue(pending.promise);const operation=state.retrieve(state.files[0]);await flush();f.user=null;act(()=>f.listener?.("SIGNED_OUT",null));pending.resolve({data:{signedUrl:"https://storage.invalid/private"},error:null});expect(await operation).toBeNull();expect(state.files).toEqual([]);});
it("never offers recovery on a file the business shared",async()=>{await mount();expect(state.files[0].source).toBe("business");await act(async()=>state.checkUpload(state.files[0]));expect(state.upload.kind).toBe("idle");});
it("bounds a stalled read and does not substitute an empty success",async()=>{vi.useFakeTimers();f.getUser.mockReturnValue(new Promise(()=>{}));await mount();await act(async()=>vi.advanceTimersByTimeAsync(20_001));expect(state.phase).toBe("error");expect(state.reading).toBe(false);});
