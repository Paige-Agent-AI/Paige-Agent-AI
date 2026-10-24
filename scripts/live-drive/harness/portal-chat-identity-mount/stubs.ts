// Deterministic data boundary for the customer portal chat identity harness (E09 CURA round 2).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera").
// The signed-in customer portal on the deployed app is a separate, owed check (§32/§70.1).
//
// The customer frame is what client_portal_frame returns, already validated (readClientPortalFrame's output):
//   ?access=ready    a customer of Northwind Studio; ?agent=Ava names the business's agent, otherwise none (Cura)
//   ?access=inactive no customer relationship and no staff standing (a person whose access ended)
// ?push=1 lets the notifications prompt ask (push supported, never asked before).
const params = new URLSearchParams(window.location.search);
const access = params.get("access") === "inactive" ? "inactive" : "ready";
const agent = params.get("agent");

export const TENANT = "e0900000-0000-4000-8000-00000000b011";
const USER = { id: "e0900000-0000-4000-8000-00000000c011", email: "jordan.rivera@example.test", user_metadata: {} };
const BRAND = { tenant_id: TENANT, tenant_name: "Northwind Studio", tenant_slug: "northwind-studio", logo_url: null, primary_color: "#26483e", support_email: null };
const FRAME = {
  actorId: USER.id,
  profile: {
    id: "e0900000-0000-4000-8000-00000000a011", tenant_id: TENANT, linked_user_id: USER.id,
    first_name: "Jordan", last_name: "Rivera", entity_name: null, street_address: null, city: null, state: null, zip_code: null,
    onboarding_stage: null, is_signup_contact: false, paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null,
    updated_at: null, email: USER.email, phone: null, contact_methods: [],
  },
  brand: BRAND,
  config: agent ? { assistant: { display_name: agent } } : {},
};

export const harnessUser = USER;

export function useClientPortalFrame(actorId: string | null, enabled = true) {
  const on = enabled && !!actorId;
  return {
    phase: !on ? "not-client" : access === "ready" ? "ready" : "not-client",
    frame: on && access === "ready" ? FRAME : null,
    checking: false, epoch: 0, reload: async () => undefined,
  };
}
// Slice 7 (#2376) made CustomerAccessGate the one frame reader and the chat/home read its answer through
// useSharedClientPortalFrame. Without the gate mounted, the shared hook falls back to its own reader, so here it is
// the same stubbed answer; the provider is a pass-through (AppShell's gate module is in the import graph).
export function useSharedClientPortalFrame(actorId: string | null, enabled = true) {
  return useClientPortalFrame(actorId, enabled);
}
export function ClientPortalFrameProvider({ children }: { value: unknown; children?: unknown }) {
  return children as never;
}
export function usePortalStaffStanding(_userId: string | null | undefined, enabled: boolean) {
  return enabled ? { loading: false, staff: false } : { loading: false, staff: null };
}
export async function readPortalStaffStanding() { return false; }
export function clearPortalStaffStanding() { /* harness */ }
export async function readCustomerChat() { return { threadId: "e0900000-0000-4000-8000-00000000d011", messages: [] }; }

export function usePushNotifications() {
  return {
    isSupported: true, isIOS: false, isPWAInstalled: false, isSubscribed: false, permission: "default",
    subscribe: async () => true, unsubscribe: async () => true, dismissPrompt: async () => undefined,
    shouldShowPrompt: async () => params.get("push") === "1",
  };
}
export function usePaigeMemory() {
  return { extractDocumentSummary: () => null, getSessionDocumentContext: () => undefined, trackActivity: () => undefined, generateSessionSummary: async () => undefined, resetSession: () => undefined };
}
export function useChatDocumentUpload() {
  return { attachedDoc: null, isProcessingFile: false, isDragOver: false, fileInputRef: { current: null }, handleFileSelect: () => undefined, handleDragOver: () => undefined, handleDragLeave: () => undefined, handleDrop: () => undefined, removeAttachment: () => undefined, openFilePicker: () => undefined, setAttachedDoc: () => undefined };
}
export function useClientChatContext() { return { contextBlock: "", isLoading: false, hasCreditData: false }; }
export function useProfileSnapshot() { return { snapshot: {}, refresh: () => undefined }; }
export function trackEvent() { return Promise.resolve(); }
export function useBeforeUnloadGuard() { return undefined; }

/** Every table read resolves empty (no tiles' counts, no notifications, no avatar, no authored playbook). */
function chain(): unknown {
  const result = { data: [], error: null, count: 0 };
  const single = { data: null, error: null };
  const proxy: unknown = new Proxy({}, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve(single);
      return () => proxy;
    },
  });
  return proxy;
}
export const supabase = {
  rpc: (name: string, args: Record<string,unknown>={}) => {
    if(params.get("files")==="1")return fileRequest(()=>fileRpc(name,args));
    if (name === "get_client_portal_brand") return Promise.resolve({ data: access === "ready" ? [BRAND] : [], error: null });
    if (name === "get_client_portal_config") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: null });
  },
  from: (name:string) => params.get("files")==="1"?fileTable(name):chain(),
  auth: {
    getUser: async () => ({ data: { user: USER }, error: null }),
    getSession: async () => ({ data: { session: { user: USER, access_token: "harness" } }, error: null }),
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      queueMicrotask(() => cb("INITIAL_SESSION", { user: USER }));
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signOut: async () => ({ error: null }),
  },
  channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => undefined }; return c; },
  removeChannel: () => undefined,
  functions: { invoke: async () => ({ data: null, error: null }) },
  storage: { from: () => params.get("files")==="1"?fileStorage():({ getPublicUrl: () => ({ data: { publicUrl: "" } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
};

// DashboardModeContext: a customer, never staff.
export const useDashboardMode = () => ({ isAdmin: false, mode: "client", setMode: () => undefined, loading: false });
export function DashboardModeProvider({ children }: { children: unknown }) { return children; }

// Existing render transport only: synthetic private file/native/message boundary.
// No production request, provider, activation or customer identity is used.
const THREAD="e0900000-0000-4000-8000-00000000d011";
const fixtureKey="e09-cura-file-render-fixture-v1";
type Row=Record<string,unknown>;
const saved: {rows:Row[];turns:Row[];latest:string|null}=JSON.parse(localStorage.getItem(fixtureKey)??'{"rows":[],"turns":[],"latest":null}');
const objects=new Map<string,Blob>();
const save=()=>localStorage.setItem(fixtureKey,JSON.stringify(saved));
const privateScope={actor_id:USER.id,profile:FRAME.profile,brand:BRAND,config:FRAME.config};
function fileRequest(read:()=>unknown){const q={setHeader:()=>q,abortSignal:()=>q,returns:()=>q,then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve().then(read).then(resolve,reject)};return q;}
let fixtureFinishInterrupted=false;
function fileRpc(name:string,args:Row){
 console.info("E09 file fixture native",name);
 if(name==="client_portal_frame")return {data:privateScope,error:null};
 if(name==="client_portal_self_profile")return {data:FRAME.profile,error:null};
 if(name==="paige_chat_thread_create")return {data:THREAD,error:null};
 if(name==="client_portal_chat_files")return {data:{tenant_id:TENANT,client_id:FRAME.profile.id,files:saved.rows.slice(0,Number(args.p_limit??50)),has_more:saved.rows.length>Number(args.p_limit??50)},error:null};
 if(name==="client_portal_begin_chat_file_upload"){
  let row=saved.rows.find(r=>r.id===args.p_file_id);if(!row){const now=new Date().toISOString();row={id:args.p_file_id,tenant_id:TENANT,contact_id:FRAME.profile.id,uploaded_by_user_id:USER.id,
   storage_path:TENANT+"/"+FRAME.profile.id+"/client_upload/"+USER.id+"/"+args.p_file_id,original_filename:args.p_filename,mime_type:args.p_mime_type,size_bytes:args.p_size_bytes,
   visibility:"client_upload",upload_state:"pending",created_at:now,updated_at:now,customer_chat_thread_id:THREAD};saved.rows.push(row);save();}return {data:row,error:null};}
 if(name==="client_portal_chat_file_status"){const row=saved.rows.find(r=>r.id===args.p_file_id);return {data:{file:row??null,object_verified:!!row&&(row.upload_state==="ready"||objects.has(String(row.storage_path)))},error:null};}
 if(name==="client_portal_finish_file_upload"){if(params.get("fileCase")==="uncertain"&&!fixtureFinishInterrupted){fixtureFinishInterrupted=true;return {data:null,error:{message:"Synthetic lost finish acknowledgement"}};}const row=saved.rows.find(r=>r.id===args.p_file_id);if(row&&objects.has(String(row.storage_path))){row.upload_state="ready";save();return {data:row,error:null};}return {data:null,error:{message:"Synthetic transfer incomplete"}};}
 if(name==="get_client_portal_brand")return {data:[BRAND],error:null};
 return {data:null,error:null};
}
function fileTable(name:string){const filters:Row={},selected:string[]=[];let ids:string[]|null=null;
 const result=()=>({data:name==="paige_chat_threads"?{id:THREAD,caller_user_id:USER.id,contact_id:FRAME.profile.id,tenant_id:TENANT,lens:"client",interactive_latest_intent:saved.latest}
  :name==="paige_chat_turns"?[...saved.turns].reverse():name==="client_files"?ids?saved.rows.filter(r=>ids!.includes(String(r.id))):saved.rows.find(r=>r.id===filters.id)??null:[],error:null});
 const q={select:(value:string)=>{selected.push(value);return q;},returns:()=>q,eq:(k:string,v:unknown)=>{filters[k]=v;return q;},filter:()=>q,is:()=>q,order:()=>q,limit:()=>q,
  in:(_key:string,value:string[])=>{ids=value;return q;},setHeader:()=>q,abortSignal:()=>q,maybeSingle:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};return q;}
function fileStorage(){const q={setHeader:()=>q,getPublicUrl:()=>({data:{publicUrl:""}}),upload:async(path:string,file:File)=>{objects.set(path,file);return {data:{path},error:null};},
 createSignedUrl:async()=>{console.info("E09 file fixture link");return {data:{signedUrl:"/harness-file.txt"},error:null};}};return q;}
if(params.get("files")==="1"){
 const original=window.fetch.bind(window);window.fetch=async(input,init)=>{
  if(String(input)!=="http://harness.invalid/functions/v1/paige-ai-chat")return original(input,init);
  const body=JSON.parse(String(init?.body));if(body.interactive?.kind==="status")return new Response(JSON.stringify({executor_active:false,settled:true}));
  saved.latest=body.requestIntentId;const ids:unknown=body.customerFileIds;
  saved.turns.push({id:crypto.randomUUID(),role:"user",content:body.messages[0].content,request_intent_id:body.requestIntentId,customer_file_ids:ids??null});
  saved.turns.push({id:crypto.randomUUID(),role:"assistant",content:"Local test reply. Your selected files are attached to this saved conversation. This is a synthetic interface check, not a live CURA document analysis.",request_intent_id:body.requestIntentId,customer_file_ids:null});save();
  return new Response('data: {"choices":[{"delta":{"content":"Local test reply. Files attached."}}]}\n\ndata: [DONE]\n\n',{headers:{"Content-Type":"text/event-stream"}});};
}

export function useExistingClientPortalFrame(){return useClientPortalFrame(USER.id,true);}
