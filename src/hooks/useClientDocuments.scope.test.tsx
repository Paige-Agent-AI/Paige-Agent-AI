import {act, StrictMode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {useClientDocuments} from "./useClientDocuments";

const f=vi.hoisted(()=>({user:{id:"e0914000-0000-0000-0000-000000000001"} as {id:string}|null,
 rpc:vi.fn(),read:vi.fn(),from:vi.fn(),upload:vi.fn(),download:vi.fn(),getUser:vi.fn(),
 listener:null as null|((event:string,session:{user:{id:string}}|null)=>void),
 rows:[] as Record<string,unknown>[],reserved:null as Record<string,unknown>|null,object:false,ranges:[] as number[][]}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{
 auth:{getUser:()=>f.getUser(),onAuthStateChange:(cb:typeof f.listener)=>{f.listener=cb;return{data:{subscription:{unsubscribe:vi.fn()}}};}},
 rpc:(...a:unknown[])=>f.rpc(...a),from:(...a:unknown[])=>f.from(...a),
 storage:{from:()=>({upload:(...a:unknown[])=>f.upload(...a),download:(...a:unknown[])=>f.download(...a)})},
 channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:vi.fn(),
}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const actor="e0914000-0000-0000-0000-000000000001",tenant="e0924000-0000-0000-0000-000000000001",contact="e0934000-0000-0000-0000-000000000001";
const profile=()=>({id:contact,tenant_id:tenant,linked_user_id:actor,first_name:"Test",last_name:"Customer",entity_name:null,street_address:null,city:null,state:null,zip_code:null,onboarding_stage:"completed",is_signup_contact:false,paige_shared_context_consent:false,paige_shared_context_consent_updated_at:null,updated_at:"2026-01-01T00:00:00Z",email:"customer@tests.invalid",phone:null,contact_methods:[]});
const row=(id="e0944000-0000-0000-0000-000000000001")=>({id,tenant_id:tenant,contact_id:contact,uploaded_by_user_id:actor,storage_path:`${tenant}/${contact}/shared/${id}`,original_filename:"Preparation.pdf",mime_type:"application/pdf",size_bytes:4,visibility:"shared",upload_state:"ready",created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"});
const file=()=>new File(["test"],"Preparation.pdf",{type:"application/pdf"});
let state:ReturnType<typeof useClientDocuments>,root:Root,host:HTMLDivElement;
function Probe(){state=useClientDocuments();return <output>{JSON.stringify(state)}</output>;}
const flush=async()=>act(async()=>{for(let i=0;i<60;i++)await Promise.resolve();});
const mount=async(strict=false)=>{await act(async()=>root.render(strict?<StrictMode><Probe/></StrictMode>:<Probe/>));await flush();};
function defer<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
beforeEach(()=>{vi.clearAllMocks();f.user={id:actor};f.listener=null;f.rows=[row()];f.reserved=null;f.object=false;f.ranges=[];
 f.getUser.mockImplementation(async()=>({data:{user:f.user},error:null}));
 f.read.mockImplementation(async(single:boolean)=>({data:single?f.reserved:f.rows,error:null}));
 f.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,range:(a:number,b:number)=>{f.ranges.push([a,b]);return f.read(false);},maybeSingle:()=>f.read(true)};return q;});
 f.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==="client_portal_self_profile")return{data:profile(),error:null};
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
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});

it("reads a closed native relationship projection without raw CRM",async()=>{await mount();expect(state.phase).toBe("ready");expect(state.files).toHaveLength(1);expect(f.from).toHaveBeenCalledWith("client_files");expect(f.from).not.toHaveBeenCalledWith("clients");expect(f.ranges).toEqual([[0,49]]);});
it("distinguishes successful empty records from a failed read",async()=>{f.rows=[];await mount();expect(state.phase).toBe("ready");expect(state.files).toEqual([]);f.read.mockResolvedValue({data:null,error:{code:"503"}});await act(async()=>state.refresh());expect(state.phase).toBe("error");expect(state.files).toEqual([]);});
it.each(["tenant","contact","internal","payload"])("rejects an inconsistent %s result",async(which)=>{const r:Record<string,unknown>=row();if(which==="tenant")r.tenant_id="foreign";if(which==="contact")r.contact_id="foreign";if(which==="internal")r.visibility="internal";if(which==="payload")r.description="private";f.rows=[r];await mount();expect(state.phase).toBe("error");expect(state.files).toEqual([]);});
it("retires revoked access before reading documents",async()=>{f.rpc.mockResolvedValue({data:null,error:null});await mount();expect(state.phase).toBe("unavailable");expect(f.from).not.toHaveBeenCalled();});
it("does not expose a late read after sign-out and return",async()=>{const pending=defer<{data:Record<string,unknown>[];error:null}>();f.read.mockReturnValueOnce(pending.promise);await mount();f.user=null;act(()=>f.listener?.("SIGNED_OUT",null));f.user={id:actor};act(()=>f.listener?.("SIGNED_IN",{user:f.user!}));await flush();pending.resolve({data:[row("e0944000-0000-0000-0000-000000000099")],error:null});await flush();expect(state.files[0].id).toBe(row().id);expect(state.epoch).toBeGreaterThan(0);});
it("preserves scope and selection lifetime on the file-picker focus return",async()=>{await mount();const epoch=state.epoch;act(()=>window.dispatchEvent(new Event("focus")));expect(state.phase).toBe("ready");await flush();expect(state.epoch).toBe(epoch);expect(state.phase).toBe("ready");});
it("works after StrictMode effect cleanup without accepting the old lifetime",async()=>{await mount(true);expect(state.phase).toBe("ready");expect(state.isCurrent(state.epoch)).toBe(true);expect(await state.retrieve(state.files[0])).toBeInstanceOf(Blob);});
it("pages fifty records and deduplicates repeated records",async()=>{f.rows=Array.from({length:50},(_,i)=>row(`e0944000-0000-0000-0000-${String(i+1).padStart(12,"0")}`));await mount();expect(state.more).toBe(true);f.rows=[row(),row("e0944000-0000-0000-0000-000000000051")];await act(async()=>state.refresh(true));expect(state.files).toHaveLength(51);expect(f.ranges.at(-1)).toEqual([50,99]);expect(state.more).toBe(false);});
it("confirms the saved upload through actual status and independent metadata readback",async()=>{await mount();await act(async()=>state.transfer(file()));expect(state.upload.kind).toBe("saved");expect(f.upload).toHaveBeenCalledWith(f.reserved!.storage_path,expect.any(File),{contentType:"application/pdf",upsert:false});expect(f.rpc).toHaveBeenCalledWith("client_portal_begin_file_upload",expect.objectContaining({p_expected_client_id:contact,p_tenant_id:tenant}));expect(f.read).toHaveBeenCalledWith(true);expect(state.files[0].visibility).toBe("client_upload");});
it("never starts an upload after the actual subject changes",async()=>{await mount();f.user={id:"e0914000-0000-0000-0000-000000000002"};await act(async()=>state.transfer(file()));expect(state.phase).toBe("unavailable");expect(f.rpc.mock.calls.some(([n])=>n==="client_portal_begin_file_upload")).toBe(false);expect(f.upload).not.toHaveBeenCalled();});
it("does not report saved from the writer acknowledgement alone",async()=>{await mount();f.read.mockImplementation(async(single:boolean)=>({data:single?null:f.rows,error:null}));await act(async()=>state.transfer(file()));expect(state.upload.kind).toBe("uncertain");expect(state.files.every(r=>r.visibility==="shared")).toBe(true);});
it("holds an unknown transfer, checks read-only and retries the same ID without overwriting",async()=>{await mount();f.upload.mockResolvedValueOnce({data:null,error:{message:"connection lost"}});await act(async()=>state.transfer(file()));expect(state.upload.kind).toBe("uncertain");const count=f.rpc.mock.calls.length;await act(async()=>state.transfer(file()));expect(f.rpc.mock.calls.length).toBe(count);await act(async()=>state.checkUpload());expect(state.upload.kind).toBe("retry");await act(async()=>state.transfer(file()));expect(state.upload.kind).toBe("saved");const ids=f.rpc.mock.calls.filter(([n])=>n==="client_portal_begin_file_upload").map(([,a])=>a.p_file_id);expect(new Set(ids).size).toBe(1);});
it("recovers a lost final acknowledgement without a second transfer or finalize",async()=>{await mount();const canonical=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(...args:unknown[])=>{const result=await canonical(...args);if(args[0]==="client_portal_finish_file_upload")throw Error("reply lost");return result;});await act(async()=>state.transfer(file()));expect(state.upload.kind).toBe("uncertain");await act(async()=>state.checkUpload());expect(state.upload.kind).toBe("saved");expect(f.upload).toHaveBeenCalledTimes(1);expect(f.rpc.mock.calls.filter(([n])=>n==="client_portal_finish_file_upload")).toHaveLength(1);});
it("stops local waiting and ignores the late reply before any further write",async()=>{await mount();const pending=defer<{data:null;error:null}>();const canonical=f.rpc.getMockImplementation()!;f.rpc.mockImplementation((name:string,...args:unknown[])=>name==="client_portal_begin_file_upload"?pending.promise:canonical(name,...args));let job!:Promise<void>;act(()=>{job=state.transfer(file());});await flush();act(()=>state.stopWaiting());expect(state.upload.kind).toBe("uncertain");pending.resolve({data:null,error:null});await act(async()=>job);expect(state.upload.kind).toBe("uncertain");expect(f.upload).not.toHaveBeenCalled();expect(f.rpc.mock.calls.some(([n])=>n==="client_portal_finish_file_upload")).toBe(false);});
it("clears a late download after subject/session retirement",async()=>{await mount();const pending=defer<{data:Blob;error:null}>();f.download.mockReturnValue(pending.promise);const operation=state.retrieve(state.files[0]);await flush();f.user=null;act(()=>f.listener?.("SIGNED_OUT",null));pending.resolve({data:new Blob(["private"]),error:null});expect(await operation).toBeNull();expect(state.files).toEqual([]);});
it("preserves earlier authorized uploader history without treating it as a new own upload",async()=>{f.rows=[{...row(),visibility:"client_upload",uploaded_by_user_id:"e0914000-0000-0000-0000-000000000002"}];await mount();expect(state.phase).toBe("ready");await act(async()=>state.checkUpload(state.files[0]));expect(state.upload.kind).toBe("idle");});
it("bounds a stalled read and does not substitute an empty success",async()=>{vi.useFakeTimers();f.getUser.mockReturnValue(new Promise(()=>{}));await mount();await act(async()=>vi.advanceTimersByTimeAsync(20_001));expect(state.phase).toBe("error");expect(state.reading).toBe(false);});
