// Real Messages controller and original reader/hook integration; child layout
// and writing surface are adapters. No browser geometry, Auth or database proof.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ClientsConversations from "./ClientsConversations";
const db=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),invoke:vi.fn(),getUser:vi.fn(),allowed:true,listIncludesRaw:false,contentWait:null as Promise<unknown>|null,refresh:[] as (()=>void)[]}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{from:db.from,rpc:db.rpc,functions:{invoke:db.invoke},auth:{getUser:db.getUser,onAuthStateChange:()=>({data:{subscription:{unsubscribe:vi.fn()}}})},
  channel:()=>{const c={on:(_kind:unknown,_options:unknown,cb:()=>void)=>{db.refresh.push(cb);return c;},subscribe:()=>c};return c;},removeChannel:vi.fn()}}));
vi.mock("@/hooks/useTenantContext",()=>({useTenantContext:()=>({activeTenantId:"11111111-1111-4111-8111-111111111111",activeUserId:"22222222-1111-4111-8111-111111111111",loading:false,accountContextLoading:false,accountContextStatus:"ready"})}));
vi.mock("@/lib/voice/VoiceDeviceProvider",()=>({useVoiceDevice:()=>null}));
vi.mock("@/components/ui/paige",()=>({useAgentPresence:()=>({expandRail:vi.fn()})}));
vi.mock("./conversations/ContactCardRail",()=>({ContactCardRail:()=>null}));
vi.mock("./conversations/LeadReplyDrafts",()=>({LeadReplyDrafts:()=>null}));
vi.mock("./conversations/ComposeThreadDialog",()=>({ComposeThreadDialog:()=>null}));
vi.mock("./conversations/shell/ConversationsRichComposer",()=>({ConversationsRichComposer:({value,onChange}:{value:string;onChange:(v:string)=>void})=><div data-composer-writing-surface="true"><textarea aria-label="Original message editor" value={value} onChange={e=>onChange(e.target.value)}/><button onClick={()=>onChange("LOCAL USER EDIT")}>Keep local edit</button></div>}));
vi.mock("./conversations/shell/ConversationsThreadList",()=>({ConversationsThreadList:({threads}:{threads:{key:string;lastPreview:string}[]})=><div>{threads.map(t=><p key={t.key}>{t.lastPreview}</p>)}</div>}));
vi.mock("@/components/planning/QuickAddDialog",()=>({QuickAddDialog:()=>null}));
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const [,,message,contact,connector,hub,turn,conversation,source,receipt,operation]=Array.from({length:11},(_,i)=>`${String(i+1).padStart(8,"0")}-1111-4111-8111-111111111111`);
// Keep the current tenant/actor exactly equal to the mocked native context.
const tenantId="11111111-1111-4111-8111-111111111111",actorId="22222222-1111-4111-8111-111111111111";
const threadKey=`contact:${tenantId}:${contact}`,version="2026-11-03T03:00:00.123456+00:00";
const client={id:contact,first_name:"Existing",last_name:"Contact",entity_name:null,client_contact_methods:[{kind:"email",value:"recipient@tests.invalid",is_primary:true}]};
const row={id:message,tenant_id:tenantId,thread_key:threadKey,contact_id:contact,connector_id:connector,channel_type:"email",direction:"outbound",status:"draft",subject:"Saved original",body_text:"PRIVATE ORIGINAL SAVED EMAIL",body_html:null,updated_at:version,attachments:[],action_id:null,provider_message_id:null,scheduled_for:null,created_at:version,sender:{address:"sender@tests.invalid"},recipients:[{address:"recipient@tests.invalid"}],clients:client};
const thread={id:turn,tenant_id:tenantId,thread_key:threadKey,contact_id:contact,snoozed_until:null,archived_at:null,labels:[],unread_count:0,last_message_at:version,last_direction:"outbound",clients:client};
const native=()=>db.allowed?{ok:true,id:message,contact_id:contact,thread_key:threadKey,channel:"email",direction:"outbound",status:"draft",subject:row.subject,saved_email_draft:{source:{message_id:message,updated_at:version},body_text:row.body_text,body_html:null}}:{ok:false,code:"MAILBOX_INACTIVE"};
const prepared=()=>({ok:true,tenant_id:tenantId,actor_id:actorId,turn_id:turn,conversation_id:conversation,source_message_id:source,message_id:hub,draft:{subject:row.subject,body:row.body_text,contact_id:contact,connector_id:connector,result:{message_id:message,updated_at:version,receipt_id:receipt,operation_id:operation}}});
let host:HTMLDivElement,root:Root;
async function flush(){for(let i=0;i<12;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});}
beforeEach(()=>{
  db.allowed=true;db.listIncludesRaw=false;db.contentWait=null;db.refresh=[];db.from.mockReset();db.rpc.mockReset();db.invoke.mockReset();db.getUser.mockResolvedValue({data:{user:{id:actorId}},error:null});
  Element.prototype.scrollIntoView=vi.fn();
  db.rpc.mockImplementation(async(name)=>({data:name==="current_user_tenant_id"?tenantId:name==="team_hub_email_draft"?prepared():name==="read_message_content"?db.contentWait?await db.contentWait:native():null,error:null}));
  db.from.mockImplementation(table=>{const filters:unknown[][]=[];const q:Record<string,unknown>={};
    const result=()=>({data:db.listIncludesRaw&&table==="messages"?[row]:db.listIncludesRaw&&table==="threads"?[thread]:table==="channel_connectors"?[{id:connector,channel_type:"email",provider:"gmail",display_name:"Original mailbox",from_address:"sender@tests.invalid",status:"active",active:true}]:[],error:null,count:table==="threads"?1:0});
    for(const method of ["select","eq","order","limit","not","is","or","gt","in","gte"])q[method]=(...args:unknown[])=>{filters.push([method,...args]);return q;};
    q.maybeSingle=async()=>({data:table==="messages"?row:table==="threads"?thread:null,error:null});
    q.then=(done:(v:unknown)=>unknown)=>Promise.resolve(result()).then(done);return q;
  });
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function mount(){await act(async()=>root.render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/solo/10000/clients/conversations?contact=${contact}&email_draft=${message}&hub_message=${hub}`]}><ClientsConversations/></MemoryRouter></QueryClientProvider>));await flush();}
it("authorized exact source outside both500-row windows opens the original editor and survives a revalidated refresh",async()=>{
  await mount();expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Original message editor"]')?.value).toBe(row.body_text);
  await act(async()=>{for(const refresh of db.refresh)refresh();});await flush();
  expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Original message editor"]')?.value).toBe(row.body_text);
  expect(db.rpc.mock.calls.filter(([name])=>name==="read_message_content").length).toBeGreaterThanOrEqual(4);expect(db.invoke).not.toHaveBeenCalled();
});
it("actual open→mailbox refusal→original refresh retires cached private message and editor, with no replacement",async()=>{
  await mount();expect(host.textContent).toContain(row.body_text);db.allowed=false;
  await act(async()=>{for(const refresh of db.refresh)refresh();});await flush();
  expect(host.textContent).not.toContain(row.body_text);expect(host.querySelector('textarea[aria-label="Original message editor"]')).toBeNull();
  expect(host.textContent).toContain("Original email unavailable");expect(db.invoke).not.toHaveBeenCalled();
});
it("a failed explicit Retry original draft cannot preserve or reinsert a previous private projection",async()=>{
  await mount();db.allowed=false;await act(async()=>{for(const refresh of db.refresh)refresh();});await flush();
  const retry=Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Retry original draft");expect(retry).toBeTruthy();
  await act(async()=>retry!.click());await flush();await act(async()=>{for(const refresh of db.refresh)refresh();});await flush();
  expect(host.textContent).not.toContain(row.body_text);expect(host.querySelector('textarea[aria-label="Original message editor"]')).toBeNull();
});
it("a broad envelope read cannot bypass the failed original mailbox reader on later refreshes",async()=>{
  await mount();db.allowed=false;db.listIncludesRaw=true;
  for(let i=0;i<2;i++){await act(async()=>{for(const refresh of db.refresh)refresh();});await flush();}
  expect(host.textContent).not.toContain(row.body_text);expect(host.querySelector('textarea[aria-label="Original message editor"]')).toBeNull();
});
it("a temporary unavailable read withholds local unsaved edits and restores them only after fresh same-actor source permission",async()=>{
  await mount();await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Keep local edit")!.click());
  db.allowed=false;await act(async()=>{for(const refresh of db.refresh)refresh();});await flush();
  expect(host.textContent).not.toContain("LOCAL USER EDIT");expect(host.querySelector('textarea[aria-label="Original message editor"]')).toBeNull();
  db.allowed=true;await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Retry original draft")!.click());await flush();
  expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Original message editor"]')?.value).toBe("LOCAL USER EDIT");expect(db.invoke).not.toHaveBeenCalled();
});
it("closing a delayed Retry cannot reveal the original editor before a later native refusal",async()=>{
  await mount();await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Keep local edit")!.click());
  db.allowed=false;await act(async()=>{for(const refresh of db.refresh)refresh();});await flush();
  let release!:(v:unknown)=>void;db.contentWait=new Promise(resolve=>{release=resolve;});
  await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Retry original draft")!.click());await flush();
  await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Close draft link")!.click());
  expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Original message editor"]')?.value??"").not.toContain("LOCAL USER EDIT");
  await act(async()=>release({ok:false,code:"MAILBOX_INACTIVE"}));await flush();
  expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Original message editor"]')?.value??"").not.toContain("LOCAL USER EDIT");expect(db.invoke).not.toHaveBeenCalled();
});
