import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const resizeCallbacks: Array<ResizeObserverCallback> = [];

class HarnessResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
  disconnect() {}
  observe() {}
  unobserve() {}
}

vi.stubGlobal("ResizeObserver", HarnessResizeObserver);
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn(), useLocation: () => ({ pathname: "/app" }) };
});
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/playbook", () => ({
  usePlaybook: () => ({ persona: { greeting: "Harness greeting", name: "Paige", role: "AI COO" }, quickActions: [] }),
}));
const portalFixture=vi.hoisted(()=>({phase:"not-client",frame:null as unknown,checking:false,
  read:vi.fn(),outcome:vi.fn(),reload:vi.fn(),summary:vi.fn()}));
const memoryFixture = vi.hoisted(() => ({
  actor: "d2000000-0000-4000-8000-000000000001", tenant: "d2100000-0000-4000-8000-000000000001" as string | null,
  loading: false, scope: vi.fn(), session: vi.fn(), auth: vi.fn(), unsubscribe:vi.fn(),
  authChange:null as null|((event:string,session:{user:{id:string}}|null)=>void),
  context: { block: "", loading: false, hasCreditData: false },
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: memoryFixture.tenant, loading: memoryFixture.loading }) }));
const staffFixture = vi.hoisted(() => ({ isAdmin: true, loading: false }));
// The not-client branch is the owner's chat; only staff reach it (owner ruling 2026-10-19).
vi.mock("@/contexts/DashboardModeContext", () => ({ useDashboardMode: () => ({ ...staffFixture, mode: "client", setMode: () => {} }) }));
// Round 2: the not-client gate asks staff STANDING (any staff role, membership, owned tenant, agency seat), not the
// "admin" role alone. The fixture drives it: isAdmin true = staff, false = not staff.
vi.mock("@/lib/portal/portalStaffStanding", () => ({ usePortalStaffStanding: (_id: string, enabled: boolean) => enabled ? { loading: staffFixture.loading, staff: staffFixture.loading ? null : staffFixture.isAdmin } : { loading: false, staff: null } }));
vi.mock("@/hooks/useClientPortalFrame", () => ({useClientPortalFrame: () => portalFixture, useSharedClientPortalFrame: () => portalFixture, useExistingClientPortalFrame: () => null}));
vi.mock("@/lib/customer-chat",()=>({readCustomerChat:(...args:unknown[])=>portalFixture.read(...args),readCustomerChatOutcome:(...args:unknown[])=>portalFixture.outcome(...args)}));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({ brand: null, loading: false }) }));
vi.mock("@/hooks/useClientChatContext", () => ({
  useClientChatContext: () => ({ contextBlock: memoryFixture.context.block, isLoading: memoryFixture.context.loading, hasCreditData: memoryFixture.context.hasCreditData }),
}));
vi.mock("@/hooks/useProfileSnapshot", () => ({ useProfileSnapshot: () => ({ snapshot: {}, refresh: vi.fn() }) }));
vi.mock("@/hooks/useBeforeUnloadGuard", () => ({ useBeforeUnloadGuard: () => undefined }));
vi.mock("@/hooks/useAnalytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/hooks/usePaigeMemory", () => ({
  usePaigeMemory: (scope: unknown) => {
    memoryFixture.scope(scope);
    return {
      extractDocumentSummary: vi.fn(), getSessionDocumentContext: vi.fn(() => ""), trackActivity: vi.fn(),
      generateSessionSummary: portalFixture.summary, resetSession: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/useChatDocumentUpload", async () => ({
  ...await vi.importActual<typeof import("@/hooks/useChatDocumentUpload")>("@/hooks/useChatDocumentUpload"),
  useChatDocumentUpload: () => ({
    attachedDoc: null, isProcessingFile: false, isDragOver: false, fileInputRef: { current: null },
    handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
    removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => <button type="button">Dictate</button> }));
const f = vi.hoisted(() => ({
  user: vi.fn(), session: vi.fn(), reply: vi.fn(),
  native: [] as {name: string; args: Record<string, unknown>; headers: Record<string, string>}[],
  storage: [] as {kind: string; path: string; headers: Record<string, string>; options?: unknown}[],
  columns: [] as string[], channels: [] as string[], rows: new Map<string, Record<string, unknown>>(), objects: new Set<string>(),
  listeners: new Set<(event: string, session: {user: {id: string}} | null) => void>(),
}));
vi.mock("@/integrations/supabase/client", () => ({supabase: {
  auth: {getUser: () => f.user(), getSession: () => f.session(), onAuthStateChange: (cb: never) => {
    f.listeners.add(cb); return {data: {subscription: {unsubscribe: () => f.listeners.delete(cb)}}};
  }},
  rpc: (name: string, args: Record<string, unknown> = {}) => {
    const headers: Record<string, string> = {};
    const q = {setHeader: (key: string, value: string) => {headers[key] = value; return q;},
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve().then(() => {
        f.native.push({name, args, headers: {...headers}}); return f.reply(name, args);
      }).then(resolve, reject)};
    return q;
  },
  from: () => {
    const filters: Record<string, unknown> = {};
    const q = {select: (columns: string) => {f.columns.push(columns); return q;},
      eq: (key: string, value: unknown) => {filters[key] = value; return q;},
      setHeader: () => q, maybeSingle: () => q,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({data: f.rows.get(String(filters.id)) ?? null, error: null}).then(resolve)};
    return q;
  },
  storage: {from: () => {
    const headers: Record<string, string> = {};
    const q = {setHeader: (key: string, value: string) => {headers[key] = value; return q;},
      upload: async (path: string, _file: File, options: unknown) => {
        f.storage.push({kind: "upload", path, headers: {...headers}, options}); f.objects.add(path);
        return {data: {path}, error: null};
      },
      createSignedUrl: async (path: string, _seconds: number, options?: unknown) => {
        f.storage.push({kind: "sign", path, headers: {...headers}, options});
        return {data: {signedUrl: "https://storage.tests.invalid/private"}, error: null};
      }};
    return q;
  }},
  channel: (name: string) => {f.channels.push(name); const q = {on: () => q, subscribe: () => q}; return q;}, removeChannel: vi.fn(),
}}));


// These tests mount the ORIGINAL host, picker, attachment hook and Documents
// lifecycle together. Only Auth/native/Storage/history transports are synthetic.
// No production customer, provider, file upload or model reading is proved.
import {PaigeChat} from './PaigeChat';
import {CustomerIdentityProvider, type CustomerIdentityState} from '@/lib/portal/customerIdentity';
import {portalDocumentFromUpload, type ClientDocument} from '@/lib/client-portal-documents';
const actor = "e0992000-0000-4000-8000-000000000001", tenant = "e0992000-0000-4000-8000-000000000002";
const contact = "e0992000-0000-4000-8000-000000000003", thread = "e0992000-0000-4000-8000-000000000004";
const otherThread = "e0992000-0000-4000-8000-000000000005";
const profile = () => ({id: contact, tenant_id: tenant, linked_user_id: actor, first_name: "Test", last_name: "Customer",
  entity_name: null, street_address: null, city: null, state: null, zip_code: null, onboarding_stage: "completed",
  is_signup_contact: false, paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null,
  updated_at: "2026-01-01T00:00:00Z", email: "customer@tests.invalid", phone: null, contact_methods: []});
const frameState = (): CustomerIdentityState => ({phase: "ready", frame: {
  actorId: actor, profile: profile(), brand: {tenant_name: "Test Practice"}, config: {},
} as never});

let host: HTMLDivElement, root: Root;
const flush=async()=>{for(let i=0;i<350;i++)await Promise.resolve();};
const render=()=>act(async()=>{
  const frame=portalFixture.frame as NonNullable<CustomerIdentityState['frame']>;
  root.render(<CustomerIdentityProvider state={{phase:portalFixture.phase as CustomerIdentityState['phase'],frame,accessChecking:portalFixture.checking}}>
    <PaigeChat user={{id:frame.actorId,user_metadata:{}} as never} session={null}/>
  </CustomerIdentityProvider>);await flush();
});
const picker=()=>host.querySelector<HTMLInputElement>('input[aria-label="Choose private files for this message"]')!;
const send=()=>host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
const choose=(input:HTMLInputElement)=>act(()=>{
  Object.defineProperty(input,'files',{configurable:true,value:[new File(['one'],'Juniper.pdf',{type:'application/pdf'}),new File(['two'],'Cedar.pdf',{type:'application/pdf'})]});
  input.dispatchEvent(new Event('change',{bubbles:true}));
});
const recheck=async()=>{portalFixture.checking=true;await render();portalFixture.checking=false;await render();};
beforeEach(()=>{
  vi.stubGlobal("ResizeObserver", HarnessResizeObserver);
  vi.clearAllMocks(); f.native = []; f.storage = []; f.columns = []; f.channels = []; f.rows.clear(); f.objects.clear(); f.listeners.clear();
  f.user.mockResolvedValue({data: {user: {id: actor}}, error: null});
  f.session.mockResolvedValue({data: {session: {user: {id: actor}, access_token: "synthetic-private-file"}}, error: null});
  f.reply.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "client_portal_self_profile") return {data: profile(), error: null};
    if (name === "client_portal_chat_files") {
      const rows = [...f.rows.values()], limit = Number(args.p_limit ?? 50);
      return {data: {tenant_id: tenant, client_id: contact, files: rows.slice(0, limit), has_more: rows.length > limit}, error: null};
    }
    if (name === "client_portal_begin_chat_file_upload") {
      let row = f.rows.get(String(args.p_file_id));
      if (!row) {
        row = {id: args.p_file_id, tenant_id: tenant, contact_id: contact, uploaded_by_user_id: actor,
          storage_path: `${tenant}/${contact}/client_upload/${actor}/${args.p_file_id}`,
          original_filename: args.p_filename, mime_type: args.p_mime_type, size_bytes: args.p_size_bytes,
          visibility: "client_upload", upload_state: "pending", customer_chat_thread_id: args.p_thread_id,
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"};
        f.rows.set(String(args.p_file_id), row);
      }
      return {data: {...row}, error: null};
    }
    if (name === "client_portal_chat_file_status") {
      const row = f.rows.get(String(args.p_file_id));
      return {data: {file: row ? {...row} : null, object_verified: !!row && f.objects.has(String(row.storage_path))}, error: null};
    }
    if (name === "client_portal_finish_file_upload") {
      const row = f.rows.get(String(args.p_file_id)); if (row) row.upload_state = "ready";
      return {data: row ? {...row} : null, error: null};
    }
    throw Error("Unexpected synthetic native call " + name);
  });

  portalFixture.phase='ready';portalFixture.checking=false;portalFixture.frame=frameState().frame;
  portalFixture.read.mockReset().mockResolvedValue({threadId:thread,messages:[]});
  portalFixture.outcome.mockReset().mockResolvedValue({settled:true,executor_active:false});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe('original private file picker across host history and Documents lifetimes',()=>{
  it('retains a returning native bulk choice through the real Documents access recheck',async()=>{
    await render();const input=picker();expect(input.disabled).toBe(false);act(()=>input.click());
    let resolve!:(v:{threadId:string;messages:never[]})=>void;
    portalFixture.read.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    await recheck();choose(input);
    expect(host.querySelector('[aria-label="Selected private files"]')).toBeNull();
    await act(async()=>{resolve({threadId:thread,messages:[]});await flush();});
    const selected=host.querySelector('[aria-label="Selected private files"]')!;
    expect(selected).not.toBeNull();
    expect(selected.textContent).toContain('Juniper.pdf');expect(selected.textContent).toContain('Cedar.pdf');
    expect(f.storage).toEqual([]);expect(f.native.some(n=>n.name==='client_portal_begin_chat_file_upload')).toBe(false);
  });
  it('restores existing selected files after a same-thread recheck without uploading',async()=>{
    await render();const input=picker();act(()=>input.click());choose(input);await render();
    expect(host.textContent).toContain('Juniper.pdf');await recheck();
    expect(host.textContent).toContain('Juniper.pdf');expect(host.textContent).toContain('Cedar.pdf');
    expect(f.storage).toEqual([]);
  });
  it('a failed history read never admits sending the kept choice',async()=>{
    await render();const input=picker();act(()=>input.click());choose(input);
    portalFixture.read.mockRejectedValueOnce(new Error('Synthetic unavailable history'));await recheck();
    expect(send().disabled).toBe(true);expect(picker().disabled).toBe(true);
    expect(f.storage).toEqual([]);
  });
  it('a different native thread retires the old choice and late picker result',async()=>{
    await render();const input=picker();act(()=>input.click());choose(input);await render();act(()=>input.click());
    portalFixture.read.mockResolvedValueOnce({threadId:otherThread,messages:[]});await recheck();choose(input);await render();
    expect(host.querySelector('[aria-label="Selected private files"]')).toBeNull();expect(f.storage).toEqual([]);
  });
  it('a business change and return cannot revive the former native picker result',async()=>{
    await render();const original=portalFixture.frame as NonNullable<CustomerIdentityState['frame']>,input=picker();act(()=>input.click());
    portalFixture.frame={...original,profile:{...original.profile,tenant_id:'e0992000-0000-4000-8000-000000000099'}};
    await render();portalFixture.frame=original;await render();choose(input);await render();
    expect(host.querySelector('[aria-label="Selected private files"]')).toBeNull();expect(f.storage).toEqual([]);
  });
  it.each([true,false])('uses original native upload/readback before one Chat dispatch; exact receipt=%s',async exact=>{
    const sent=vi.fn(async(_url:unknown,options:RequestInit)=>{
      const payload=JSON.parse(String(options.body));
      expect([...f.rows.values()].every(row=>row.upload_state==='ready')).toBe(true);
      expect(f.storage.filter(s=>s.kind==='upload')).toHaveLength(2);
      const files=payload.customerFileIds.map((id:string)=>portalDocumentFromUpload(f.rows.get(id) as unknown as ClientDocument));
      portalFixture.read.mockResolvedValue({threadId:thread,messages:[{
        id:'e0992000-0000-4000-8000-000000000010',role:'user',content:'Read the selected files',
        requestIntentId:payload.requestIntentId,files:exact?files:[...files].reverse(),
      }]});
      return new Response('data: {"choices":[{"delta":{"content":"Synthetic file response"}}]}\n\ndata: [DONE]\n\n');
    });
    vi.stubGlobal('fetch',sent);await render();const input=picker();act(()=>input.click());choose(input);
    const composer=host.querySelector('textarea')!;
    act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(composer,'Read the selected files');composer.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(sent).not.toHaveBeenCalled();expect(f.storage).toEqual([]);
    await act(async()=>{send().click();await flush();});
    expect(sent).toHaveBeenCalledTimes(1);
    const payload=JSON.parse(String(sent.mock.calls[0][1].body));
    expect(payload.customerFileIds).toEqual([...f.rows.keys()]);
    for(const key of ['document','attachments','clientId','sessionDocumentContext'])expect(payload).not.toHaveProperty(key);
    expect(f.native.filter(n=>n.name==='client_portal_begin_chat_file_upload')).toHaveLength(2);
    expect(f.storage.filter(s=>s.kind==='upload').every(s=>(s.options as {upsert:boolean}).upsert===false)).toBe(true);
    expect(!!host.querySelector('[aria-label="Selected private files"]')).toBe(!exact);
    if(!exact)expect(send().disabled).toBe(true);
  });
});
