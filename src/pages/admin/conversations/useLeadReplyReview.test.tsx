import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLeadReplyReview } from "./useLeadReplyReview";

const db = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn(), getUser:vi.fn(),rpc:vi.fn(),auth:null as null|((event:string)=>void), row: null as Record<string, unknown> | null, filters: [] as unknown[][] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: db.invoke }, from: db.from,rpc:db.rpc,auth:{getUser:db.getUser,onAuthStateChange:(cb:(event:string)=>void)=>{db.auth=cb;return{data:{subscription:{unsubscribe:vi.fn()}}};}} } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tenant = "11111111-1111-4111-8111-111111111111";
const contact = "22222222-2222-4222-8222-222222222222";
const connector = "33333333-3333-4333-8333-333333333333";
const approval = "44444444-4444-4444-8444-444444444444";
const fingerprint = "abcdef0123456789";
const actor="88888888-8888-4888-8888-888888888888";
const base = { actorId:actor,tenantId: tenant, contactId: contact, threadKey: `contact:${tenant}:${contact}`, approvalId: approval, connectorId: connector, channel: "email", subject: "Your inquiry", body: "Thanks for asking. Here is the next step.", attachmentCount: 0, uploading: false, scheduledFor: null, signatureEnabled: false, disabled: false };
type Input = Parameters<typeof useLeadReplyReview>[0];
let host: HTMLDivElement;
let root: Root;
let props: Input;
let api: ReturnType<typeof useLeadReplyReview>;
const onAccepted = vi.fn();
function Harness({ input }: { input: Input }) { api = useLeadReplyReview(input, onAccepted); return <>{api.panel}</>; }
async function render(next: Partial<Input> = {}) { props = { ...props, ...next }; await act(async () => { root.render(<Harness input={props} />); }); }
async function prepare() { await act(async () => { await api.prepare(); }); }
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  expect(button, `button ${text}`).toBeTruthy();
  await act(async () => { button!.click(); });
}
function proposal(call: Record<string, unknown>, override: Record<string, unknown> = {}) {
  return { data: { ok: false, outcome: "approval_required", operation_id: call.operation_id, fingerprint, summary: "Email this contact", expires_at: new Date(Date.now() + 60_000).toISOString(), preview: { kind: "email", to_address: "lead@example.test", from_address: "hello@business.example", subject: base.subject, body_text: base.body }, ...override }, error: null };
}
beforeEach(async () => {
  props = { ...base }; onAccepted.mockClear(); db.filters = []; db.row = null;
  db.getUser.mockReset().mockResolvedValue({data:{user:{id:actor}},error:null});db.rpc.mockReset().mockResolvedValue({data:tenant,error:null});
  db.invoke.mockReset(); db.invoke.mockImplementation(async (_name, options) => proposal(options.body));
  db.from.mockReset(); db.from.mockImplementation((table) => {
    db.filters.push(["table", table]);
    const query: Record<string, unknown> = {};
    for (const key of ["select", "eq", "limit"]) query[key] = (...args: unknown[]) => { db.filters.push([key, ...args]); return query; };
    query.maybeSingle = async () => ({ data: db.row, error: null });
    query.then=(yes:(v:unknown)=>unknown)=>Promise.resolve({data:db.row?[db.row]:[],error:null}).then(yes);
    return query;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); vi.useRealTimers(); });

describe("lead reply through the existing approval door", () => {
  it.each(["prepare","approve","record","status"].flatMap(stage=>["actor-read","tenant-read"].map(read=>({stage,read}))))("owned cleanup recovers $stage after a parent hold during $read",async({stage,read})=>{
    let original:Record<string,unknown>|null=null;
    if(stage!=="prepare"){await prepare();original=db.invoke.mock.calls[0][1].body;}
    if(stage==="record"||stage==="status"){
      db.invoke.mockResolvedValueOnce({data:stage==="record"?{ok:true,outcome:"provider_accepted",operation_id:original!.operation_id,approval_id:approval,message_id:"99999999-9999-4999-8999-999999999999",provider_receipt_available:true,delivery_confirmed:false,record_status:"pending_record"}:null,error:null});await click("Approve");
      if(stage==="record")db.row={id:"99999999-9999-4999-8999-999999999999",tenant_id:tenant,contact_id:contact,send_actor_id:actor,lead_reply_approval_id:approval,comms_email_operation:original!.operation_id,comms_email_state:"provider_accepted",channel_type:"email",direction:"outbound",status:"sent",provider_message_id:"receipt",connector_id:connector,subject:base.subject,body_text:base.body};
    }
    const callsBefore=db.invoke.mock.calls.length;let finish!:(v:unknown)=>void,pending:Promise<void>|undefined;
    if(read==="actor-read")db.getUser.mockReturnValueOnce(new Promise(done=>{finish=done;}));else db.rpc.mockReturnValueOnce(new Promise(done=>{finish=done;}));
    await act(async()=>{
      if(stage==="prepare")pending=api.prepare();else [...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===(stage==="approve"?"Approve":stage==="record"?"Finish recording reply":"Check sending status"))!.click();
      for(let i=0;i<8;i++)await Promise.resolve();
    });
    await render({current:()=>false});await act(async()=>{finish(read==="actor-read"?{data:{user:{id:actor}},error:null}:{data:tenant,error:null});if(pending)await pending;for(let i=0;i<16;i++)await Promise.resolve();});
    expect(db.invoke).toHaveBeenCalledTimes(callsBefore);expect(db.rpc.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);
    await render({current:()=>true});expect(api.busy).toBe(false);
    if(stage==="prepare"){await prepare();expect(db.invoke).toHaveBeenCalledTimes(1);}
    else if(stage==="approve"){expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==="Approve")?.disabled).toBe(false);db.invoke.mockResolvedValueOnce({data:null,error:null});await click("Approve");expect(db.invoke.mock.calls.at(-1)![1].body).toEqual({...original,approved_fingerprint:fingerprint});}
    else if(stage==="record"){db.rpc.mockImplementation(async name=>({data:name==="current_user_tenant_id"?tenant:{ok:true,state:"provider_accepted",approval_id:approval,operation_id:original!.operation_id,message_id:db.row!.id,delivery_confirmed:false},error:null}));await click("Finish recording reply");expect(db.rpc).toHaveBeenCalledWith("lead_reply_record_send",{_approval_id:approval,_operation_id:original!.operation_id});expect(db.invoke).toHaveBeenCalledTimes(callsBefore);}
    else{await click("Check sending status");expect(db.invoke).toHaveBeenCalledTimes(callsBefore);}
  });
  it("owned cleanup never clears a newer request after observed scope A-B-A",async()=>{
    let first!:(v:unknown)=>void,second!:(v:unknown)=>void,pending!:Promise<void>;
    db.getUser.mockReturnValueOnce(new Promise(done=>{first=done;})).mockReturnValueOnce(new Promise(done=>{second=done;}));
    await act(async()=>{pending=api.prepare();});await render({threadKey:"other-thread"});await render({threadKey:base.threadKey});
    let newer!:Promise<void>;await act(async()=>{newer=api.prepare();});expect(api.busy).toBe(true);
    await act(async()=>{first({data:{user:{id:actor}},error:null});await pending;});expect(api.busy).toBe(true);
    await prepare();expect(db.getUser).toHaveBeenCalledTimes(2);expect(db.invoke).not.toHaveBeenCalled();
    await act(async()=>{second({data:{user:{id:actor}},error:null});await newer;});expect(api.busy).toBe(false);expect(db.invoke).toHaveBeenCalledTimes(1);
  });
  it("owned cleanup after a spent effect retains only original status recovery",async()=>{
    await prepare();const original=db.invoke.mock.calls[0][1].body;let finish!:(v:unknown)=>void;db.invoke.mockReturnValueOnce(new Promise(done=>{finish=done;}));
    await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()==="Approve")!.click();for(let i=0;i<16;i++)await Promise.resolve();});expect(db.invoke).toHaveBeenCalledTimes(2);
    await render({current:()=>false});await act(async()=>{finish({data:null,error:null});for(let i=0;i<16;i++)await Promise.resolve();});await render({current:()=>true});
    expect(api.busy).toBe(false);expect(api.blocksSending).toBe(true);expect(host.querySelector('[aria-label="Needs your OK"]')).toBeNull();expect(host.textContent).toContain("Don't resend");
    await prepare();expect(db.invoke).toHaveBeenCalledTimes(2);await click("Check sending status");expect(db.filters).toContainEqual(["eq","meta->comms_email_binding->>operation_id",original.operation_id]);expect(db.invoke).toHaveBeenCalledTimes(2);
  });
  it("allows fresh explicit same-actor review after token refresh and reopening",async()=>{
    await prepare();await act(async()=>db.auth!("TOKEN_REFRESHED"));
    expect(host.querySelector('[aria-label="Needs your OK"]')).toBeNull();
    await render({approvalId:null,disabled:true});await render({approvalId:approval,disabled:false});await prepare();
    expect(db.invoke).toHaveBeenCalledTimes(2);expect(host.querySelector('[aria-label="Needs your OK"]')).not.toBeNull();
  });
  it.each(["actor-read","tenant-read","hold-aba","parent-fence","parent-aba"])("a live eligibility hold during %s cannot dispatch the approved call",async kind=>{
    await prepare();let finish!:(v:unknown)=>void;
    if(kind==="tenant-read")db.rpc.mockReturnValueOnce(new Promise(done=>{finish=done;}));else db.getUser.mockReturnValueOnce(new Promise(done=>{finish=done;}));
    await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()==="Approve")!.click();for(let i=0;i<8;i++)await Promise.resolve();});
    if(kind.startsWith("parent")){await render({current:()=>false});if(kind==="parent-aba")await render({current:()=>true});}
    else{await render({disabled:true});if(kind==="hold-aba")await render({disabled:false});}
    await act(async()=>{finish(kind==="tenant-read"?{data:tenant,error:null}:{data:{user:{id:actor}},error:null});for(let i=0;i<16;i++)await Promise.resolve();});
    expect(db.invoke).toHaveBeenCalledTimes(1);
    await render({disabled:false,current:()=>true});expect(host.querySelector('[aria-label="Needs your OK"]')).not.toBeNull();
  });
  it.each(["actor","tenant"])("a refreshed session cannot borrow a different current %s",async kind=>{
    await prepare();await act(async()=>db.auth!("TOKEN_REFRESHED"));
    if(kind==="actor")db.getUser.mockResolvedValue({data:{user:{id:"foreign"}},error:null});else db.rpc.mockResolvedValue({data:"foreign",error:null});
    await prepare();expect(db.invoke).toHaveBeenCalledTimes(1);expect(host.querySelector('[aria-label="Needs your OK"]')).toBeNull();
  });
  it("token refresh retires an awaiting approval before dispatch but permits a fresh authorized review",async()=>{
    await prepare();let finish!:(v:unknown)=>void;db.getUser.mockReturnValueOnce(new Promise(done=>{finish=done;}));
    await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()==="Approve")!.click());
    await act(async()=>db.auth!("TOKEN_REFRESHED"));await act(async()=>{finish({data:{user:{id:actor}},error:null});for(let i=0;i<16;i++)await Promise.resolve();});
    expect(db.invoke).toHaveBeenCalledTimes(1);expect(host.querySelector('[aria-label="Needs your OK"]')).toBeNull();
    await prepare();expect(db.invoke).toHaveBeenCalledTimes(2);expect(host.querySelector('[aria-label="Needs your OK"]')).not.toBeNull();
  });
  it("a refreshed in-flight original remains read-only with the same operation",async()=>{
    await prepare();const original=db.invoke.mock.calls[0][1].body;let finish!:(v:unknown)=>void;
    db.invoke.mockReturnValueOnce(new Promise(done=>{finish=done;}));
    await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()==="Approve")!.click();for(let i=0;i<16;i++)await Promise.resolve();});
    expect(db.invoke).toHaveBeenCalledTimes(2);await act(async()=>db.auth!("TOKEN_REFRESHED"));
    expect(host.querySelector('[aria-label="Needs your OK"]')).toBeNull();expect(host.textContent).not.toContain("lead@example.test");expect(api.blocksSending).toBe(true);
    await prepare();expect(db.invoke).toHaveBeenCalledTimes(2);
    await click("Check sending status");expect(db.filters).toContainEqual(["eq","meta->comms_email_binding->>operation_id",original.operation_id]);expect(db.invoke).toHaveBeenCalledTimes(2);
    await act(async()=>{finish({data:null,error:null});for(let i=0;i<16;i++)await Promise.resolve();});expect(api.blocksSending).toBe(true);
  });
  it("a preparation hold during auth cannot invoke even the proposal door",async()=>{
    let finish!:(v:unknown)=>void;db.getUser.mockReturnValueOnce(new Promise(done=>{finish=done;}));let pending!:Promise<void>;
    await act(async()=>{pending=api.prepare();});await render({disabled:true});
    await act(async()=>{finish({data:{user:{id:actor}},error:null});await pending;});expect(db.invoke).not.toHaveBeenCalled();
    await render({disabled:false});await prepare();expect(db.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([{subject:"Changed words"},{connectorId:"77777777-7777-4777-8777-777777777777"}])("changed exact draft inputs during auth cannot spend the old card %j",async changed=>{
    await prepare();let finish!:(v:unknown)=>void;db.getUser.mockReturnValueOnce(new Promise(done=>{finish=done;}));
    await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()==="Approve")!.click());await render(changed);
    await act(async()=>{finish({data:{user:{id:actor}},error:null});for(let i=0;i<16;i++)await Promise.resolve();});expect(db.invoke).toHaveBeenCalledTimes(1);expect(host.querySelector('[aria-label="Needs your OK"]')).toBeNull();
  });
  it.each(["actor-read","tenant-read"])("original recording is held if eligibility changes during %s",async kind=>{
    await prepare();const call=db.invoke.mock.calls[0][1].body,message="99999999-9999-4999-8999-999999999999";
    db.invoke.mockResolvedValueOnce({data:{ok:true,outcome:"provider_accepted",operation_id:call.operation_id,approval_id:approval,message_id:message,provider_receipt_available:true,delivery_confirmed:false,record_status:"pending_record"},error:null});await click("Approve");
    db.row={id:message,tenant_id:tenant,contact_id:contact,send_actor_id:actor,lead_reply_approval_id:approval,comms_email_operation:call.operation_id,comms_email_state:"provider_accepted",channel_type:"email",direction:"outbound",status:"sent",provider_message_id:"receipt",connector_id:connector,subject:base.subject,body_text:base.body};
    let finish!:(v:unknown)=>void;if(kind==="actor-read")db.getUser.mockReturnValueOnce(new Promise(done=>{finish=done;}));else db.rpc.mockReturnValueOnce(new Promise(done=>{finish=done;}));
    await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()==="Finish recording reply")!.click();for(let i=0;i<8;i++)await Promise.resolve();});
    await render({disabled:true});await act(async()=>{finish(kind==="actor-read"?{data:{user:{id:actor}},error:null}:{data:tenant,error:null});for(let i=0;i<16;i++)await Promise.resolve();});
    expect(db.rpc.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);expect(db.invoke).toHaveBeenCalledTimes(2);expect(api.blocksSending).toBe(true);
  });
  it("retains the exact prepared card across a temporary locator dispatch hold",async()=>{
    await prepare();const original=db.invoke.mock.calls[0][1].body;
    await render({disabled:true});expect(host.querySelector<HTMLButtonElement>('[aria-label="Needs your OK"] button')?.disabled).toBe(true);
    await render({disabled:false});expect(host.querySelector('[aria-label="Needs your OK"]')).not.toBeNull();
    db.invoke.mockResolvedValueOnce({data:null,error:null});await click("Approve");expect(db.invoke.mock.calls[1][1].body).toEqual({...original,approved_fingerprint:fingerprint});
  });
  it("moves focus from the review trigger to the exact card, never directly to Approve", async () => {
    const trigger = document.createElement("button"); trigger.textContent = "Review reply"; document.body.append(trigger); trigger.focus();
    try {
      await prepare();
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Needs your OK");
      expect(document.activeElement?.tagName).not.toBe("BUTTON");
    } finally { trigger.remove(); }
  });
  it("reviews the server's exact envelope, then echoes the same operation, command and fingerprint", async () => {
    await prepare();
    expect(host.textContent).toContain("lead@example.test"); expect(host.textContent).toContain("hello@business.example");
    const call = db.invoke.mock.calls[0][1].body;
    expect(db.invoke.mock.calls[0][0]).toBe("comms-email-command");
    expect(call).toMatchObject({ expected_tenant_id: tenant, approval_id: approval, command: { action: "comms.email_send", contact_id: contact, connector_id: connector, subject: base.subject, body: base.body } });
    expect(call.command).not.toHaveProperty("to"); expect(call.command).not.toHaveProperty("from_address");
    db.invoke.mockResolvedValueOnce({ data: { ok: true, outcome: "provider_accepted", operation_id: call.operation_id, provider_receipt_available: true, message_id:"99999999-9999-4999-8999-999999999999", delivery_confirmed:false, approval_id:approval }, error: null });
    await click("Approve");
    expect(db.invoke.mock.calls[1][1].body).toEqual({ ...call, approved_fingerprint: fingerprint });
    expect(host.textContent).toContain("Delivery is not confirmed");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Approve")).toBe(false);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });
  it.each(["subject", "body", "connectorId", "approvalId", "channel", "attachmentCount", "scheduledFor", "signatureEnabled"] as const)("invalidates review when %s changes", async (field) => {
    await prepare();
    const value = field === "attachmentCount" ? 1 : field === "signatureEnabled" ? true : "changed";
    await render({ [field]: value });
    expect(host.textContent).toContain("draft changed");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Approve")).toBe(false);
    expect(db.invoke).toHaveBeenCalledTimes(1);
  });
  it("editing and restoring the original words still requires a fresh review", async () => {
    await prepare(); await render({ body: "Revised" }); await render({ body: base.body });
    expect(host.textContent).toContain("draft changed"); expect(host.querySelector("button")).toBeNull();
  });
  it("Not now keeps the caller's draft and spends no approval", async () => {
    await prepare(); await click("Not now"); expect(host.textContent).toBe(""); expect(props.body).toBe(base.body); expect(db.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([
    { attachmentCount: 1 }, { uploading: true }, { scheduledFor: "2026-12-01T00:00:00Z" }, { signatureEnabled: true }, { channel: "sms" }, { approvalId: null }, { subject: "" }, { body: "" }, { subject: "x".repeat(201) }, { body: "x".repeat(10001) },
  ])("refuses unsupported or incomplete input before calling the door: %j", async (next) => {
    await render(next); await prepare(); expect(db.invoke).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(props.body).toBe(next.body ?? base.body);
  });
  it("does not prepare when the current role or handling mode forbids it", async () => {
    await render({ disabled: true }); await prepare(); expect(db.invoke).not.toHaveBeenCalled();
  });
  it.each([
    { preview: null }, { fingerprint: "invalid" }, { operation_id: "different" }, { expires_at: "invalid" }, { expires_at: "2020-01-01T00:00:00Z" }, { summary: "" },
    { preview: { kind: "email", to_address: "lead@example.test", from_address: "hello@business.example", subject: base.subject, body_text: "Different" } },
  ])("rejects malformed, mismatched and expired server reviews: %j", async (override) => {
    db.invoke.mockImplementationOnce(async (_name, options) => proposal(options.body, override));
    await prepare(); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector("button")).toBeNull();
  });
  it("re-checks expiry at the moment of approval", async () => {
    await prepare(); const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    await click("Approve"); clock.mockRestore(); expect(db.invoke).toHaveBeenCalledTimes(1); expect(host.textContent).toContain("expired");
  });
  it("locks repeated prepare and approve gestures synchronously", async () => {
    let resolve: (value: unknown) => void;
    db.invoke.mockImplementationOnce((_name, options) => new Promise((done) => { resolve = () => done(proposal(options.body)); }));
    let pending: Promise<void>;
    await act(async () => { pending = api.prepare(); void api.prepare(); });
    expect(db.invoke).toHaveBeenCalledTimes(1);
    await act(async () => { resolve!(null); await pending!; });
    db.invoke.mockImplementationOnce(() => new Promise(() => {}));
    const approve = [...host.querySelectorAll("button")].find((b) => b.textContent === "Approve")!;
    await act(async () => { approve.click(); approve.click(); });
    expect(db.invoke).toHaveBeenCalledTimes(2); expect(api.blocksSending).toBe(true);
  });
  it("discards a late review after an A to B to A workspace switch", async () => {
    let resolve: () => void;
    db.invoke.mockImplementationOnce((_name, options) => new Promise((done) => { resolve = () => done(proposal(options.body)); }));
    let pending: Promise<void>;
    await act(async () => { pending = api.prepare(); });
    await render({ tenantId: "55555555-5555-4555-8555-555555555555" }); await render({ tenantId: tenant });
    await act(async () => { resolve!(); await pending!; }); expect(host.textContent).toBe("");
  });
  it("never renders an old workspace's send completion or calls its reset callback", async () => {
    await prepare(); let resolve: (v: unknown) => void;
    db.invoke.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await click("Approve"); await render({ tenantId: "55555555-5555-4555-8555-555555555555" });
    await act(async () => { resolve!({ data: { outcome: "provider_accepted", ok: true, provider_receipt_available: true, message_id:"99999999-9999-4999-8999-999999999999", delivery_confirmed:false, approval_id:approval }, error: null }); });
    expect(host.textContent).toBe(""); expect(onAccepted).not.toHaveBeenCalled();
  });
  it("a network error after approval stays unknown; status checks are tenant/contact/operation scoped reads only", async () => {
    await prepare(); const call = db.invoke.mock.calls[0][1].body;
    db.invoke.mockRejectedValueOnce(new Error("private provider payload")); await click("Approve");
    expect(host.textContent).toContain("Don't resend"); expect(host.textContent).not.toContain("private provider payload"); expect(api.blocksSending).toBe(true);
    await prepare(); expect(db.invoke).toHaveBeenCalledTimes(2);
    await click("Check sending status");
    expect(db.invoke).toHaveBeenCalledTimes(2); expect(db.filters).toContainEqual(["eq", "tenant_id", tenant]); expect(db.filters).toContainEqual(["eq", "contact_id", contact]); expect(db.filters).toContainEqual(["eq", "meta->comms_email_binding->>operation_id", call.operation_id]); expect(api.blocksSending).toBe(true);
  });
  it.each(["sent", "read", "delivered"])("settles %s only from the same canonical bound message with a provider receipt", async (status) => {
    await prepare(); const call = db.invoke.mock.calls[0][1].body;
    db.invoke.mockResolvedValueOnce({ data: null, error: { message: "transport" } }); await click("Approve");
    db.row = { id:"99999999-9999-4999-8999-999999999999",send_actor_id:actor,tenant_id: tenant, contact_id: contact,channel_type:"email",direction:"outbound",lead_reply_approval_id:approval, comms_email_operation: call.operation_id, comms_email_state: "provider_accepted", status, provider_message_id: "provider-receipt" };
    await click("Check sending status");
    expect(host.textContent).toContain(status === "delivered" ? "Delivery confirmed" : "Delivery is not confirmed"); expect(onAccepted).toHaveBeenCalledTimes(1); expect(db.invoke).toHaveBeenCalledTimes(2);
  });
  it("a foreign or unbound message cannot settle an unknown attempt", async () => {
    await prepare(); db.invoke.mockResolvedValueOnce({ data: null, error: null }); await click("Approve");
    db.row = { tenant_id: "foreign", contact_id: contact, comms_email_state: "provider_accepted", status: "delivered", provider_message_id: "receipt" };
    await click("Check sending status"); expect(api.blocksSending).toBe(true); expect(onAccepted).not.toHaveBeenCalled();
  });
  it("a held approval reports not sent and preserves the caller's draft", async () => {
    await prepare(); db.invoke.mockResolvedValueOnce({ data: { ok: false, outcome: "held" }, error: null }); await click("Approve");
    expect(host.textContent).toContain("Not sent"); expect(props.body).toBe(base.body); expect(onAccepted).not.toHaveBeenCalled(); expect(api.blocksSending).toBe(false);
  });
});

describe("current scope and original operation recovery",()=>{
  it("snapshots original caller facts before awaiting authority",async()=>{
    let finish!:(value:unknown)=>void;db.getUser.mockReturnValueOnce(new Promise(done=>{finish=done;}));let pending!:Promise<void>;await act(async()=>{pending=api.prepare();});
    props.actorId="foreign";props.tenantId="foreign";props.approvalId="foreign";props.body="Changed without a render";
    await act(async()=>{finish({data:{user:{id:actor}},error:null});await pending;});expect(db.invoke.mock.calls[0][1].body).toMatchObject({expected_tenant_id:tenant,approval_id:approval,command:{body:base.body}});
  });
  it("a stalled authority read expires and cannot dispatch when its late answer arrives",async()=>{
    vi.useFakeTimers({toFake:["performance","setTimeout","clearTimeout"]});let finish!:(value:unknown)=>void;
    db.getUser.mockReturnValueOnce(new Promise(done=>{finish=done;}));let pending!:Promise<void>;await act(async()=>{pending=api.prepare();});
    await act(async()=>{await vi.advanceTimersByTimeAsync(8001);await pending;});expect(db.invoke).not.toHaveBeenCalled();
    await act(async()=>{finish({data:{user:{id:actor}},error:null});await Promise.resolve();});expect(db.invoke).not.toHaveBeenCalled();expect(api.busy).toBe(false);
  });
  it.each([{send_actor_id:"foreign"},{lead_reply_approval_id:"foreign"},{channel_type:"portal"},{direction:"inbound"},{id:"invalid"}])("does not recover another original binding %j",async override=>{
    await prepare();const call=db.invoke.mock.calls[0][1].body;db.invoke.mockResolvedValueOnce({data:null,error:null});await click("Approve");
    db.row={id:"99999999-9999-4999-8999-999999999999",send_actor_id:actor,tenant_id:tenant,contact_id:contact,lead_reply_approval_id:approval,channel_type:"email",direction:"outbound",comms_email_operation:call.operation_id,comms_email_state:"provider_accepted",status:"sent",provider_message_id:"receipt",...override};
    await click("Check sending status");expect(onAccepted).not.toHaveBeenCalled();expect(api.blocksSending).toBe(true);expect(db.invoke).toHaveBeenCalledTimes(2);
  });
  it.each([{message_id:null},{message_id:"malformed"},{approval_id:"foreign"},{delivery_confirmed:true}])("a malformed terminal receipt %j remains unknown",async override=>{
    await prepare();const call=db.invoke.mock.calls[0][1].body;db.invoke.mockResolvedValueOnce({data:{ok:true,outcome:"provider_accepted",operation_id:call.operation_id,approval_id:approval,message_id:"99999999-9999-4999-8999-999999999999",delivery_confirmed:false,provider_receipt_available:true,record_status:"recorded",...override},error:null});await click("Approve");expect(onAccepted).not.toHaveBeenCalled();expect(host.textContent).toContain("Don't resend");
  });
  it("finishes original accepted recording through the existing record-only RPC without a command replay",async()=>{
    await prepare();const call=db.invoke.mock.calls[0][1].body;const reply={ok:true,outcome:"provider_accepted",operation_id:call.operation_id,approval_id:approval,message_id:"99999999-9999-4999-8999-999999999999",provider_receipt_available:true,delivery_confirmed:false};
    db.invoke.mockResolvedValueOnce({data:{...reply,record_status:"pending_record"},error:null});await click("Approve");
    db.row={id:reply.message_id,tenant_id:tenant,contact_id:contact,send_actor_id:actor,lead_reply_approval_id:approval,comms_email_operation:call.operation_id,comms_email_state:"provider_accepted",channel_type:"email",direction:"outbound",status:"sent",provider_message_id:"receipt",connector_id:connector,subject:base.subject,body_text:base.body};
    db.rpc.mockImplementation(async(name)=>({data:name==="current_user_tenant_id"?tenant:{...reply,state:"provider_accepted"},error:null}));
    expect(host.textContent).not.toMatch(/^Done/);await click("Finish recording reply");
    expect(db.rpc).toHaveBeenCalledWith("lead_reply_record_send",{_approval_id:approval,_operation_id:call.operation_id});expect(host.textContent).toContain("original accepted reply is recorded");expect(db.invoke).toHaveBeenCalledTimes(2);
  });
  it("never publishes a fresh reproposal returned during original recording recovery",async()=>{
    await prepare();const call=db.invoke.mock.calls[0][1].body;db.invoke.mockResolvedValueOnce({data:{ok:true,outcome:"provider_accepted",operation_id:call.operation_id,approval_id:approval,message_id:"99999999-9999-4999-8999-999999999999",provider_receipt_available:true,delivery_confirmed:false,record_status:"pending_record"},error:null});await click("Approve");
    db.invoke.mockImplementationOnce(async(_name,opts)=>proposal(opts.body));await click("Finish recording reply");expect(host.querySelector('[aria-label="Needs your OK"]')).toBeNull();expect(host.textContent).toContain("Don't resend");expect(api.blocksSending).toBe(true);expect(db.invoke).toHaveBeenCalledTimes(2);expect(db.rpc.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);
  });
  it.each([null,{id:"wrong"},{send_actor_id:"foreign"},{lead_reply_approval_id:"foreign"},{comms_email_operation:"foreign"},{comms_email_state:"unknown"},{provider_message_id:""},{body_text:"changed"},{subject:"changed"},{connector_id:"foreign"}])("cannot finish recording without the exact accepted original %j",async override=>{
    await prepare();const call=db.invoke.mock.calls[0][1].body,message="99999999-9999-4999-8999-999999999999";
    db.invoke.mockResolvedValueOnce({data:{ok:true,outcome:"provider_accepted",operation_id:call.operation_id,approval_id:approval,message_id:message,provider_receipt_available:true,delivery_confirmed:false,record_status:"pending_record"},error:null});await click("Approve");
    db.row=override===null?null:{id:message,tenant_id:tenant,contact_id:contact,send_actor_id:actor,lead_reply_approval_id:approval,comms_email_operation:call.operation_id,comms_email_state:"provider_accepted",channel_type:"email",direction:"outbound",status:"sent",provider_message_id:"receipt",connector_id:connector,subject:base.subject,body_text:base.body,...override};
    await click("Finish recording reply");expect(db.rpc.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(0);expect(db.invoke).toHaveBeenCalledTimes(2);expect(host.textContent).toContain("Don't resend");
  });
  it.each(["withdrawn","truncated","wrong-result","lost-record-ack"])("keeps %s record recovery unverified and never re-enters the sender",async kind=>{
    await prepare();const call=db.invoke.mock.calls[0][1].body,message="99999999-9999-4999-8999-999999999999";
    db.invoke.mockResolvedValueOnce({data:{ok:true,outcome:"provider_accepted",operation_id:call.operation_id,approval_id:approval,message_id:message,provider_receipt_available:true,delivery_confirmed:false,record_status:"pending_record"},error:null});await click("Approve");
    db.row={id:message,tenant_id:tenant,contact_id:contact,send_actor_id:actor,lead_reply_approval_id:approval,comms_email_operation:call.operation_id,comms_email_state:"provider_accepted",channel_type:"email",direction:"outbound",status:"sent",provider_message_id:"receipt",connector_id:connector,subject:base.subject,body_text:base.body};
    if(kind==="withdrawn")db.getUser.mockResolvedValue({data:{user:{id:"foreign"}},error:null});
    if(kind==="truncated")db.from.mockImplementationOnce(()=>{const q:Record<string,unknown>={};for(const method of ["select","eq","limit"])q[method]=()=>q;q.then=(yes:(v:unknown)=>unknown)=>Promise.resolve({data:[db.row,db.row],error:null}).then(yes);return q;});
    db.rpc.mockImplementation(async(name)=>{if(name==="current_user_tenant_id")return{data:tenant,error:null};if(kind==="lost-record-ack")throw Error("Lost record ACK");return{data:{ok:true,state:"provider_accepted",approval_id:approval,operation_id:call.operation_id,message_id:"wrong",delivery_confirmed:false},error:null};});
    await click("Finish recording reply");expect(host.textContent).toContain("Don't resend");expect(api.blocksSending).toBe(true);expect(db.invoke).toHaveBeenCalledTimes(2);expect(db.rpc.mock.calls.filter(([name])=>name==="lead_reply_record_send")).toHaveLength(kind==="withdrawn"||kind==="truncated"?0:1);
  });
  it("reuses the original operation after a lost preparation ACK",async()=>{
    db.invoke.mockRejectedValueOnce(new Error("lost ACK"));await prepare();const call=db.invoke.mock.calls[0][1].body;
    await prepare();expect(db.invoke.mock.calls[1][1].body).toEqual(call);expect(host.textContent).toContain("lead@example.test");
  });
  it("reuses the original operation after a malformed preparation ACK",async()=>{db.invoke.mockResolvedValueOnce({data:null,error:null});await prepare();const call=db.invoke.mock.calls[0][1].body;await prepare();expect(db.invoke.mock.calls[1][1].body).toEqual(call);});
  it.each(["actor","tenant"])("requires the original current %s before dispatch",async kind=>{
    if(kind==="actor")db.getUser.mockResolvedValue({data:{user:{id:"foreign"}},error:null});else db.rpc.mockResolvedValue({data:"foreign",error:null});
    await prepare();expect(db.invoke).not.toHaveBeenCalled();
  });
  it.each(["actorId","tenantId","threadKey"] as const)("an observed %s A-B-A cannot publish the original preparation",async field=>{
    let finish!:()=>void;db.invoke.mockImplementationOnce((_name,opts)=>new Promise(done=>{finish=()=>done(proposal(opts.body));}));
    let pending!:Promise<void>;await act(async()=>{pending=api.prepare();});await render({[field]:"other"});await render({[field]:base[field]});
    await act(async()=>{finish();await pending;});expect(host.querySelector("[aria-label='Needs your OK']")).toBeNull();
  });
  it("honors a sticky parent scope withdrawal between auth and invocation",async()=>{
    let valid=true;let finish!:(v:unknown)=>void;await render({current:()=>valid});db.getUser.mockReturnValueOnce(new Promise(done=>{finish=done;}));
    let pending!:Promise<void>;await act(async()=>{pending=api.prepare();});valid=false;await act(async()=>{finish({data:{user:{id:actor}},error:null});await pending;});expect(db.invoke).not.toHaveBeenCalled();
  });
  it("authentication withdrawal prevents approving the old card",async()=>{await prepare();await act(async()=>db.auth!("SIGNED_OUT"));await prepare();expect(db.invoke).toHaveBeenCalledTimes(1);expect(host.textContent).toContain("account changed");expect(host.textContent).not.toContain("lead@example.test");});
  it("post-response authority change cannot publish a prepared card",async()=>{db.getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:null}).mockResolvedValueOnce({data:{user:{id:"other"}},error:null});await prepare();expect(host.querySelector("[aria-label='Needs your OK']")).toBeNull();expect(db.invoke).toHaveBeenCalledTimes(1);});
  it.each(["pending_record",undefined])("keeps provider accepted/%s distinct from fully recorded and prevents another send",async record_status=>{
    await prepare();const call=db.invoke.mock.calls[0][1].body;db.invoke.mockResolvedValueOnce({data:{ok:true,outcome:"provider_accepted",operation_id:call.operation_id,approval_id:approval,provider_receipt_available:true,message_id:"99999999-9999-4999-8999-999999999999",delivery_confirmed:false,record_status},error:null});await click("Approve");
    expect(host.textContent).toMatch(/approval record.*unconfirmed/i);expect(host.textContent).toContain("Delivery is not confirmed");expect(api.blocksSending).toBe(true);await prepare();expect(db.invoke).toHaveBeenCalledTimes(2);
  });
  it("only explicit recorded native settlement removes the pending-record label",async()=>{await prepare();const call=db.invoke.mock.calls[0][1].body;db.invoke.mockResolvedValueOnce({data:{ok:true,outcome:"provider_accepted",operation_id:call.operation_id,approval_id:approval,provider_receipt_available:true,message_id:"99999999-9999-4999-8999-999999999999",delivery_confirmed:false,record_status:"recorded"},error:null});await click("Approve");expect(host.textContent).not.toContain("approval record is still");expect(host.textContent).toContain("Delivery is not confirmed");expect(onAccepted).toHaveBeenCalledTimes(1);});
  it("rejects acceptance borrowed from a different approval",async()=>{await prepare();const call=db.invoke.mock.calls[0][1].body;db.invoke.mockResolvedValueOnce({data:{ok:true,outcome:"provider_accepted",operation_id:call.operation_id,approval_id:"foreign",provider_receipt_available:true,message_id:"99999999-9999-4999-8999-999999999999",delivery_confirmed:false,record_status:"recorded"},error:null});await click("Approve");expect(host.textContent).toContain("Don't resend");expect(onAccepted).not.toHaveBeenCalled();});
  it("cannot locally reset an uncertain original execution",async()=>{await prepare();db.invoke.mockResolvedValueOnce({data:null,error:null});await click("Approve");expect(api.reset()).toBe(false);expect(api.blocksSending).toBe(true);expect(props.body).toBe(base.body);});
  it("an explicit local cancellation of a prepared review performs no native rejection",async()=>{await prepare();let reset=false;await act(async()=>{reset=api.reset();});expect(reset).toBe(true);expect(host.textContent).toBe("");expect(db.invoke).toHaveBeenCalledTimes(1);expect(db.filters).toEqual([]);});
});
