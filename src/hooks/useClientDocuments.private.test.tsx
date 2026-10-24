import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {CustomerIdentityProvider, type CustomerIdentityState} from "@/lib/portal/customerIdentity";
import {useClientDocuments, type PrivateClientDocuments} from "./useClientDocuments";

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

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const actor = "e0992000-0000-4000-8000-000000000001", tenant = "e0992000-0000-4000-8000-000000000002";
const contact = "e0992000-0000-4000-8000-000000000003", thread = "e0992000-0000-4000-8000-000000000004";
const otherThread = "e0992000-0000-4000-8000-000000000005", fileId = "e0992000-0000-4000-8000-000000000006";
const profile = () => ({id: contact, tenant_id: tenant, linked_user_id: actor, first_name: "Test", last_name: "Customer",
  entity_name: null, street_address: null, city: null, state: null, zip_code: null, onboarding_stage: "completed",
  is_signup_contact: false, paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null,
  updated_at: "2026-01-01T00:00:00Z", email: "customer@tests.invalid", phone: null, contact_methods: []});
const frameState = (): CustomerIdentityState => ({phase: "ready", frame: {
  actorId: actor, profile: profile(), brand: {tenant_name: "Test Practice"}, config: {},
} as never});
const file = () => new File(["test"], "Notes.pdf", {type: "application/pdf"});
let host: HTMLDivElement, root: Root, state: PrivateClientDocuments;
const paints: {thread: string; files: string[]; upload: string | null}[] = [];
function Probe({currentThread}: {currentThread: string}) {
  state = useClientDocuments({kind: "customer_private", threadId: currentThread});
  paints.push({thread: currentThread, files: state.files.map(r => r.id), upload: state.upload.id});
  return null;
}
const flush = async () => {for (let n = 0; n < 250; n++) await Promise.resolve();};
const render = (currentThread = thread, identity: CustomerIdentityState | null = frameState()) => act(async () => {
  root.render(identity ? <CustomerIdentityProvider state={identity}><Probe currentThread={currentThread}/></CustomerIdentityProvider>
    : <Probe currentThread={currentThread}/>); await flush();
});
const deferred = <T,>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};};
beforeEach(() => {
  vi.clearAllMocks(); f.native = []; f.storage = []; f.columns = []; f.channels = []; f.rows.clear(); f.objects.clear(); f.listeners.clear(); paints.length = 0;
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
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {act(() => root.unmount()); host.remove();});

it("uses the same scoped Storage/finish writer with private preparation and status", async () => {
  await render(); expect(state.phase).toBe("ready"); expect(state.summary).toBeNull();
  let saved: string | undefined;
  await act(async () => {saved = await state.transfer(file(), fileId);});
  expect(saved).toBe(fileId); expect(state.upload.kind).toBe("saved");
  expect(state.upload.notice).toContain("privately"); expect(state.upload.notice).not.toContain("your team");
  expect(f.storage.filter(s => s.kind === "upload")).toEqual([expect.objectContaining({
    headers: {Authorization: "Bearer synthetic-private-file"}, options: {contentType: "application/pdf", upsert: false},
  })]);
  expect(f.native.filter(n => n.name === "client_portal_finish_file_upload")).toHaveLength(1);
  expect(f.native.filter(n => /chat_files|chat_file_status|begin_chat_file_upload/.test(n.name)).every(n =>
    n.args.p_thread_id === thread && n.args.p_tenant_id === tenant && n.headers["x-client-portal-business"] === tenant
    && n.headers.Authorization === "Bearer synthetic-private-file")).toBe(true);
  expect(f.native.some(n => n.name === "client_portal_documents" || n.name === "client_portal_begin_file_upload")).toBe(false);
  expect(f.columns.every(c => c.endsWith(",customer_chat_thread_id"))).toBe(true);
  expect(f.channels.every(name => name === `client-private-files-${contact}-${thread}`)).toBe(true);
});
it("never substitutes a staff or legacy session for a customer private frame", async () => {
  await render(thread, null); expect(state.phase).toBe("unavailable");
  await act(async () => state.transfer(file(), fileId)); expect(f.native).toEqual([]);
  await render(thread, {phase: "not-client", frame: null, staff: true});
  expect(state.phase).toBe("unavailable"); expect(f.native).toEqual([]);
});
it("refuses a missing private thread before native dispatch", async () => {
  await render("unverified-thread"); expect(state.phase).toBe("unavailable"); expect(f.native).toEqual([]);
});
it("native private gate refusal prevents a reservation or Storage request", async () => {
  const original = f.reply.getMockImplementation()!;
  f.reply.mockImplementation((name, args) => name === "client_portal_chat_files"
    ? {data: null, error: {code: "42501"}} : original(name, args));
  await render(); expect(state.phase).toBe("unavailable");
  await act(async () => state.transfer(file(), fileId));
  expect(f.native.some(n => n.name === "client_portal_begin_chat_file_upload")).toBe(false); expect(f.storage).toEqual([]);
});
it("a borrowed cached token cannot start native private reads", async () => {
  f.session.mockResolvedValue({data: {session: {user: {id: otherThread}, access_token: "synthetic-foreign"}}, error: null});
  await render(); expect(state.phase).not.toBe("ready"); expect(f.native).toEqual([]);
});
it("a session change during the private gate cannot start an upload without an Auth event", async () => {
  await render(); const original = f.reply.getMockImplementation()!;
  f.reply.mockImplementation((name, args) => {const result = original(name, args);
    if (name === "client_portal_chat_files") f.user.mockResolvedValue({data: {user: {id: otherThread}}, error: null});
    return result;
  });
  await act(async () => state.transfer(file(), fileId));
  expect(f.native.filter(n => n.name === "client_portal_begin_chat_file_upload")).toEqual([]);
  expect(f.storage).toEqual([]); expect(state.phase).toBe("unavailable");
});
it("a malformed ready-path reservation is not uploaded", async () => {
  const original = f.reply.getMockImplementation()!;
  f.reply.mockImplementation((name, args) => {const result = original(name, args);
    return name === "client_portal_begin_chat_file_upload" ? {...result, data: {...result.data, upload_state: "ready", storage_path: `${tenant}/foreign.pdf`}} : result;
  });
  await render(); await act(async () => state.transfer(file(), fileId));
  expect(state.upload.kind).toBe("uncertain"); expect(f.storage).toEqual([]);
});
it("retained callbacks from a former private thread cannot start work", async () => {
  await render(); const previous = state.transfer; await render(otherThread); await render(); const reads = f.native.length;
  await act(async () => previous(file(), fileId)); expect(f.native).toHaveLength(reads); expect(f.storage).toEqual([]);
});
it("a new thread's first paint hides old private files and upload identity", async () => {
  await render(); await act(async () => state.transfer(file(), fileId));
  const original = f.reply.getMockImplementation()!;
  f.reply.mockImplementation((name, args) => name === "client_portal_chat_files" && args.p_thread_id === otherThread
    ? new Promise(() => {}) : original(name, args));
  await render(otherThread);
  expect(paints.filter(p => p.thread === otherThread).every(p => p.files.length === 0 && p.upload === null)).toBe(true);
});
it("stopping an uncertain upload checks and resumes the same original file identity", async () => {
  await render(); const pending = deferred<unknown>(), original = f.reply.getMockImplementation()!;
  f.reply.mockImplementation((name, args) => {const result = original(name, args);
    return name === "client_portal_begin_chat_file_upload" ? pending.promise : result;
  });
  let operation!: ReturnType<typeof state.transfer>;
  act(() => {operation = state.transfer(file(), fileId);}); await act(flush);
  act(() => state.stopWaiting()); expect(state.upload.kind).toBe("uncertain");
  expect(state.upload.notice).not.toContain("your business");
  pending.resolve({data: {...f.rows.get(fileId)}, error: null}); await act(async () => {await operation; await flush();});
  expect(f.storage).toEqual([]); f.reply.mockImplementation(original);
  await act(async () => state.checkUpload()); expect(state.upload.kind).toBe("retry");
  await act(async () => state.transfer(file(), fileId)); expect(state.upload.kind).toBe("saved");
  expect(new Set(f.native.filter(n => n.name === "client_portal_begin_chat_file_upload").map(n => n.args.p_file_id))).toEqual(new Set([fileId]));
  expect(f.storage.filter(s => s.kind === "upload")).toHaveLength(1);
});
it("rechecks the original private gate before minting short-lived file links", async () => {
  await render(); await act(async () => state.transfer(file(), fileId)); const original = f.reply.getMockImplementation()!;
  f.reply.mockImplementation((name, args) => name === "client_portal_chat_files" ? {data: null, error: {code: "42501"}} : original(name, args));
  let links: unknown; await act(async () => {links = await state.retrieve(state.files[0]);});
  expect(links).toBeNull(); expect(f.storage.filter(s => s.kind === "sign")).toEqual([]);
  expect(state.files).toEqual([]);
});

it("returns the same verified saved identity after an uncertain finish", async () => {
  await render(); const original = f.reply.getMockImplementation()!;
  f.reply.mockImplementation((name, args) => {
    const result = original(name, args);
    return name === "client_portal_finish_file_upload" ? {data: null, error: {message: "transport interrupted"}} : result;
  });
  let saved: string | undefined;
  await act(async () => {saved = await state.transfer(file(), fileId);});
  expect(saved).toBeUndefined(); expect(state.upload.kind).toBe("uncertain");
  f.reply.mockImplementation(original);
  await act(async () => {saved = await state.checkUpload();});
  expect(saved).toBe(fileId); expect(state.upload.kind).toBe("saved");
  expect(f.storage.filter(s => s.kind === "upload")).toHaveLength(1);
  expect(f.native.filter(n => n.name === "client_portal_begin_chat_file_upload")).toHaveLength(1);
});

it("reopens an original own attachment outside the first file page using the original status authority",async()=>{
 await render();await act(async()=>state.transfer(file(),fileId));const row=state.files[0];expect(row).toBeTruthy();
 const original=f.reply.getMockImplementation()!;f.reply.mockImplementation((name,args)=>name==="client_portal_chat_files"&&args.p_limit===50
  ?{data:{tenant_id:tenant,client_id:contact,files:[],has_more:false},error:null}:original(name,args));
 await act(async()=>state.refresh());expect(state.files).toEqual([]);let links:unknown;
 await act(async()=>{links=await state.retrieve(row);});expect(links).toBeTruthy();expect(f.storage.filter(r=>r.kind==="sign")).toHaveLength(2);
 expect(f.native.filter(r=>r.name==="client_portal_chat_file_status").some(r=>r.args.p_thread_id===thread&&r.args.p_file_id===fileId)).toBe(true);
});
it("never signs a forged historical private filename or path",async()=>{
 await render();await act(async()=>state.transfer(file(),fileId));const row=state.files[0];
 await expect(state.retrieve({...row,filename:"Foreign.pdf"})).rejects.toThrow();expect(f.storage.filter(r=>r.kind==="sign")).toHaveLength(0);
 await expect(state.retrieve({...row,storage_path:tenant+"/foreign"})).rejects.toThrow();expect(f.storage.filter(r=>r.kind==="sign")).toHaveLength(0);
});
