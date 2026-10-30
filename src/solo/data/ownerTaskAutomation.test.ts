// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readOwnerTaskAutomations, controlOwnerTaskAutomation, type OwnerTaskCaller, type OwnerTaskReview } from "./ownerTaskAutomation";

const scope = { actorId: "actor", tenantId: "tenant", epoch: 1 };
const row = { id: "process", tenant_id: "tenant", name: "New contact review", category: "general", trigger_key: "contact.created", trigger_config: {}, conditions: [], created_by: "actor", state: "draft", granted_lane: "confirm", owner_task_armed_at: null, updated_at: "2026-10-16T12:00:00.123456+00:00" };
const step = { id: "step", automation_id: "process", position: 1, action_kind: "owner.task", tool_key: null, config: { title: "Review new contact", description: "Read the CRM record." } };
const correctionAct = '11111111-1111-4111-8111-111111111111', correctionAudit = '22222222-2222-4222-8222-222222222222';
function correctionReview(): OwnerTaskReview {
  return { ...capturedReview(), acts: [{ ...capturedReview().acts[0], id: correctionAct },
    { ...capturedReview().acts[0], id: '33333333-3333-4333-8333-333333333333', position: 2, config: { title: 'Prepare onboarding' } }] };
}
function correctionFixture(fault = '') {
  const f = fixture(fault), rpc = f.caller.rpc.bind(f.caller);
  f.caller.rpc = async (name, args) => {
    if (name !== 'control_owner_task_automation' || args?._action !== 'revise_step') return rpc(name,args);
    f.calls.push({name,args});
    if (['40001','55P03','42501','22023'].includes(fault)) return {data:null,error:{code:fault}};
    if (fault === 'throw') throw Error('lost acknowledgement');
    const packet = args._expected_acts as {reviewed_acts: Record<string,unknown>[]; revision: {act_id:string;config:unknown}};
    const changed = fault !== 'noop';
    const acts = packet.reviewed_acts.map(a=>a.id===packet.revision.act_id?{...a,config:packet.revision.config}:a);
    const originalProcess=args._expected_process as Record<string,unknown>;
    const data: Record<string,unknown> = {automation_id:args._automation_id,state:originalProcess.state,granted_lane:originalProcess.granted_lane,armed_at:null,
      updated_at:changed?'2026-10-16T13:00:00.123457+00:00':args._expected_updated_at,
      changed,execution_started:false,future_events_only:true,process:args._expected_process,acts,configuration_audit_id:changed?correctionAudit:null};
    if(fault==='wrong-audit')data.configuration_audit_id='unverified';
    if(fault==='missing-audit')delete data.configuration_audit_id;
    if(fault==='noop-audit'){data.changed=false;data.updated_at=args._expected_updated_at;}
    if(fault==='same-version')data.updated_at=args._expected_updated_at;
    if(fault==='wrong-config')data.acts=packet.reviewed_acts;
    if(fault==='other-step')data.acts=acts.map((a,i)=>i===1?{...a,config:{title:'Unexpected sibling change'}}:a);
    if(fault==='wrong-process')data.process={...args._expected_process as object,name:'Unexpected rename'};
    if(fault==='activation')data.state='live';
    if(fault==='effect')data.execution_started=true;
    return {data,error:null};
  };
  return f;
}

describe('original inactive task-purpose correction',()=>{
  // This specification calls the existing five-argument control, not a new writer.
  const revise = (f: ReturnType<typeof correctionFixture>, review = correctionReview(), config = {title:'Review delivery scope',description:'Keep the original owner.'}) =>
    controlOwnerTaskAutomation(scope,review,'revise_step',f.caller,f.current,{act_id:correctionAct,config});
  it('saves one exact original step, verifies its configuration audit and preserves every sibling',async()=>{
    const f=correctionFixture(),review=correctionReview();
    expect(await revise(f,review)).toEqual({status:'saved',state:'draft',revision:{changed:true,configurationAuditId:correctionAudit,updatedAt:'2026-10-16T13:00:00.123457+00:00'}});
    expect(f.calls.filter(c=>c.name==='control_owner_task_automation')).toEqual([{name:'control_owner_task_automation',args:{
      _automation_id:review.id,_action:'revise_step',_expected_updated_at:review.updatedAt,_expected_process:review.process,
      _expected_acts:{reviewed_acts:review.acts,revision:{act_id:correctionAct,config:{title:'Review delivery scope',description:'Keep the original owner.'}}}}}]);
  });
  it('preserves a genuine no-op without manufacturing an audit or version',async()=>{
    const f=correctionFixture('noop'),review=correctionReview();
    expect(await revise(f,review,review.acts[0].config as {title:string;description:string})).toEqual({status:'saved',state:'draft',revision:{changed:false,configurationAuditId:null,updatedAt:review.updatedAt}});
  });
  it('repairs the selected unresolved purpose while retaining an inactive paused state and exact authority lane',async()=>{
    const f=correctionFixture(),r=correctionReview();r.process.state='paused';r.process.granted_lane='auto';r.acts[0].config={title:'{{unresolved}}'};
    expect((await revise(f,r))).toEqual({status:'saved',state:'paused',revision:{changed:true,configurationAuditId:correctionAudit,updatedAt:'2026-10-16T13:00:00.123457+00:00'}});
  });
  it.each(['foreign-act','bad-sibling','duplicate-id','bad-order','extra-action','armed','trigger-settings','conditions'])('refuses unsupported original %s without invoking the writer',async fault=>{
    const f=correctionFixture(),r=correctionReview();let revision={act_id:correctionAct,config:{title:'Review scope'}};
    if(fault==='foreign-act')revision={...revision,act_id:'44444444-4444-4444-8444-444444444444'};
    if(fault==='bad-sibling')r.acts[1].config={title:'{{unresolved}}'};
    if(fault==='duplicate-id')r.acts[1].id=correctionAct;
    if(fault==='bad-order')r.acts[1].position=3;
    if(fault==='extra-action')r.acts[1].tool_key='external.send';
    if(fault==='armed')r.process.owner_task_armed_at='2026-10-17T12:00:00Z';
    if(fault==='trigger-settings')r.process.trigger_config={unreviewed:true};
    if(fault==='conditions')r.process.conditions=[{unreviewed:true}];
    expect((await controlOwnerTaskAutomation(scope,r,'revise_step',f.caller,f.current,revision)).status).toBe('unsupported');
    expect(f.calls.filter(c=>c.name==='control_owner_task_automation')).toHaveLength(0);
  });
  it.each(['wrong-audit','missing-audit','noop-audit','same-version','wrong-config','other-step','wrong-process','activation','effect'])('keeps %s ambiguous and never repeats the original request',async fault=>{
    const f=correctionFixture(fault);expect((await revise(f)).status).toBe('unknown');
    expect(f.calls.filter(c=>c.name==='control_owner_task_automation')).toHaveLength(1);
  });
  it.each([['40001','stale'],['55P03','busy'],['42501','refused'],['22023','unsupported'],['throw','unknown']])('retains native %s recovery semantics',async(fault,status)=>{
    const f=correctionFixture(fault);expect((await revise(f)).status).toBe(status);
    expect(f.calls.filter(c=>c.name==='control_owner_task_automation')).toHaveLength(1);
  });
  it.each(['wrong-actor','wrong-tenant','member','inactive'])('does not dispatch without current %s authority',async fault=>{
    const f=correctionFixture(fault);expect((await revise(f)).status).toBe('refused');
    expect(f.calls.filter(c=>c.name==='control_owner_task_automation')).toHaveLength(0);
  });
  it.each(['live','invalid'])('cannot correct an active or invalid %s process',async state=>{
    const f=correctionFixture(),r=correctionReview();r.process.state=state;
    expect((await revise(f,r)).status).toBe('unsupported');expect(f.calls.filter(c=>c.name==='control_owner_task_automation')).toHaveLength(0);
  });
  it.each(['','{{contact.name}}','<% dynamic %>','hidden\u202etext','a'.repeat(501)])('rejects unsupported task titles before dispatch',async title=>{
    const f=correctionFixture();expect((await revise(f,correctionReview(),{title,description:''})).status).toBe('unsupported');
    expect(f.calls.filter(c=>c.name==='control_owner_task_automation')).toHaveLength(0);
  });
  it('captures the exact original review and proposal before asynchronous admission',async()=>{
    const f=correctionFixture(),r=correctionReview(),pending=deferred<Awaited<ReturnType<OwnerTaskCaller['auth']['getUser']>>>();
    const first=f.caller.auth.getUser;let count=0;f.caller.auth.getUser=()=>++count===1?pending.promise:first();
    const proposal={act_id:correctionAct,config:{title:'Original approved edit',description:'Original notes'}};
    const operation=controlOwnerTaskAutomation(scope,r,'revise_step',f.caller,f.current,proposal);
    proposal.config.title='Changed during admission';r.process.name='Changed during admission';r.updatedAt='2027-01-01T00:00:00Z';r.acts[1].config={title:'Changed sibling'};
    pending.resolve({data:{user:{id:'actor'}},error:null});expect((await operation).status).toBe('saved');
    const args=f.calls.find(c=>c.name==='control_owner_task_automation')!.args!;
    expect(args._expected_updated_at).toBe(row.updated_at);expect((args._expected_process as any).name).toBe(row.name);
    expect((args._expected_acts as any).revision.config.title).toBe('Original approved edit');
    expect((args._expected_acts as any).reviewed_acts[1].config.title).toBe('Prepare onboarding');
  });
});
function fixture(fault = "") {
  let now: typeof scope | null = { ...scope };
  const calls: { name: string; args?: Record<string, unknown> }[] = [], queries: { table: string; filters: [string, unknown][] }[] = [];
  const caller = {
    auth: { getUser: async () => ({ data: { user: { id: fault === "wrong-actor" ? "other" : "actor" } }, error: null }) },
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "current_user_tenant_id") return { data: fault === "wrong-tenant" ? "other" : "tenant", error: null };
      if (fault === "throw") throw new TypeError("response lost");
      if (["40001", "55P03", "42501", "22023"].includes(fault)) return { data: null, error: { code: fault } };
      if (fault === "switch-control") now = { ...scope, tenantId: "other", epoch: 2 };
      const pause = args?._action === "pause", state = pause ? "paused" : "live", armedAt = pause ? null : "2026-10-16T13:00:00+00:00";
      const grant = pause ? (args?._expected_process as Record<string, unknown>).granted_lane : "confirm";
      const data = { automation_id: "process", state, granted_lane: grant, armed_at: armedAt, updated_at: "2026-10-16T13:00:00.123456+00:00", changed: true, execution_started: false, future_events_only: true,
        process: { ...args?._expected_process as object, state, granted_lane: grant, owner_task_armed_at: armedAt }, acts: args?._expected_acts };
      if (fault === "false-effect") data.execution_started = true;
      if (fault === "wrong-id-ack") data.automation_id = "other";
      if (fault === "changed-acts-ack") data.acts = [];
      if (fault === "false-history") data.future_events_only = false;
      return { data: fault === "empty-ack" ? {} : data, error: null };
    },
    from(table: string) {
      const filters: [string, unknown][] = []; queries.push({ table, filters });
      const q = { select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
        in: (k: string, v: unknown) => { filters.push([k, v]); return q; }, range: () => q, order: () => q, limit: () => q, maybeSingle: () => q,
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          if (fault === "switch-read" && table === "paige_automation_acts") now = { ...scope, tenantId: "other", epoch: 2 };
          const data = table === "tenant_members" ? { role: fault === "member" ? "member" : "owner", status: fault === "inactive" ? "inactive" : "active" }
            : table === "paige_automations" ? [{ ...row, tenant_id: fault === "foreign-row" ? "other" : "tenant", granted_lane: fault === "pause-auto" ? "auto" : "confirm" }]
            : [{ ...step, automation_id: fault === "foreign-act" ? "other" : "process", config: fault === "malformed-config" ? ["unsupported"] : step.config }];
          return Promise.resolve({ data, count: table === "paige_automation_acts" ? 1 : null,
            error: fault === "read-error" && table === "paige_automations" ? { code: "PGRST000" } : null }).then(resolve, reject);
        } };
      return q;
    },
  } as unknown as OwnerTaskCaller;
  return { caller, calls, queries, current: () => now, change: () => { now = { ...scope, epoch: 2 }; } };
}
describe("ordinary owner task process control", () => {
  it("reads native process and complete ordered acts in the current workspace", async () => {
    const f = fixture(), r = await readOwnerTaskAutomations(scope, f.caller, f.current);
    expect(r.status).toBe("ready");
    if (r.status !== "ready") throw new Error("not ready");
    expect(r.items).toHaveLength(1); expect(r.items[0].updatedAt).toBe(row.updated_at);
    expect(r.items[0].process).toEqual((({ updated_at: _, ...p }) => p)(row));
    expect(r.items[0].acts[0]).toEqual((({ automation_id: _, ...a }) => a)(step));
    expect(f.queries.find(x => x.table === "paige_automations")?.filters).toContainEqual(["tenant_id", "tenant"]);
    expect(f.queries.find(x => x.table === "paige_automation_acts")?.filters).toContainEqual(["automation_id", ["process"]]);
  });
  it.each(["wrong-actor", "wrong-tenant", "member", "inactive", "foreign-row", "foreign-act", "switch-read"])("never exposes another authority/context: %s", async fault => {
    const f = fixture(fault); expect((await readOwnerTaskAutomations(scope, f.caller, f.current)).status).not.toBe("ready");
    expect(f.calls.some(x => x.name === "control_owner_task_automation")).toBe(false);
  });
  it("does not report a failed read as an empty list", async () => {
    const f = fixture("read-error"); expect((await readOwnerTaskAutomations(scope, f.caller, f.current)).status).toBe("unavailable");
  });
  it("submits exact reviewed timestamp/JSON through only the existing native control", async () => {
    const f = fixture(), r = await readOwnerTaskAutomations(scope, f.caller, f.current);
    if (r.status !== "ready") throw new Error("not ready");
    const result = await controlOwnerTaskAutomation(scope, r.items[0], "arm", f.caller, f.current);
    expect(result.status).toBe("saved");
    expect(f.calls.filter(x => x.name === "control_owner_task_automation")).toEqual([{ name: "control_owner_task_automation", args: {
      _automation_id: "process", _action: "arm", _expected_updated_at: row.updated_at, _expected_process: r.items[0].process, _expected_acts: r.items[0].acts } }]);
    expect(Object.keys(f.calls.find(x => x.name === "control_owner_task_automation")!.args!)).toEqual([
      "_automation_id", "_action", "_expected_updated_at", "_expected_process", "_expected_acts"]);
  });
  it.each([["40001", "stale"], ["55P03", "busy"], ["42501", "refused"], ["22023", "unsupported"], ["throw", "unknown"]])("keeps %s truthful without replay", async (fault, status) => {
    const base = fixture(), r = await readOwnerTaskAutomations(scope, base.caller, base.current);
    if (r.status !== "ready") throw new Error("not ready");
    const f = fixture(fault); expect((await controlOwnerTaskAutomation(scope, r.items[0], "arm", f.caller, f.current)).status).toBe(status);
    expect(f.calls.filter(x => x.name === "control_owner_task_automation")).toHaveLength(1);
  });
  it("refuses a captured review after leaving and returning to the same account", async () => {
    const f = fixture(), r = await readOwnerTaskAutomations(scope, f.caller, f.current);
    if (r.status !== "ready") throw new Error("not ready");
    f.change(); expect((await controlOwnerTaskAutomation(scope, r.items[0], "arm", f.caller, f.current)).status).toBe("refused");
    expect(f.calls.some(x => x.name === "control_owner_task_automation")).toBe(false);
  });
  it("never publishes the previous workspace's returned control state", async () => {
    const base = fixture(), r = await readOwnerTaskAutomations(scope, base.caller, base.current);
    if (r.status !== "ready") throw new Error("not ready");
    const f = fixture("switch-control"); expect((await controlOwnerTaskAutomation(scope, r.items[0], "pause", f.caller, f.current)).status).toBe("refused");
  });
  it.each(["empty-ack", "false-effect", "wrong-id-ack", "changed-acts-ack", "false-history"])("does not claim saved from an invalid native acknowledgement: %s", async fault => {
    const f = fixture(fault), r = await readOwnerTaskAutomations(scope, f.caller, f.current);
    if (r.status !== "ready") throw new Error("not ready");
    expect((await controlOwnerTaskAutomation(scope, r.items[0], "arm", f.caller, f.current)).status).toBe("unknown");
    expect(f.calls.filter(x => x.name === "control_owner_task_automation")).toHaveLength(1);
  });
  it.each(["pause-auto", "malformed-config"])("keeps an unsupported process inspectable and pausable: %s", async fault => {
    const f = fixture(fault), r = await readOwnerTaskAutomations(scope, f.caller, f.current);
    if (r.status !== "ready") throw new Error("not ready");
    expect((await controlOwnerTaskAutomation(scope, r.items[0], "pause", f.caller, f.current)).status).toEqual("saved");
    expect(f.calls.find(x => x.name === "control_owner_task_automation")?.args?._expected_acts).toEqual(r.items[0].acts);
  });
});

type TestResponse = { data: unknown; error: unknown };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function waitingQuery(response: Promise<TestResponse>) {
  const q = { select: () => q, eq: () => q, in: () => q, range: () => q, order: () => q, limit: () => q, maybeSingle: () => q,
    then: (yes: (v: TestResponse) => unknown, no: (e: unknown) => unknown) => response.then(yes, no) };
  return q as unknown as ReturnType<OwnerTaskCaller["from"]>;
}
function capturedReview(): OwnerTaskReview {
  return { id: row.id, updatedAt: row.updated_at,
    process: Object.fromEntries(Object.entries(row).filter(([key]) => key !== "updated_at")),
    acts: [Object.fromEntries(Object.entries(step).filter(([key]) => key !== "automation_id"))] };
}
describe("one bounded deadline for owner task process reads and controls", () => {
  afterEach(() => { vi.useRealTimers(); });
  const clock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it("bounds a stalled read preflight and ignores late authentication without starting reads", async () => {
    clock(); const f = fixture(), auth = deferred<Awaited<ReturnType<OwnerTaskCaller["auth"]["getUser"]>>>();
    const caller = { ...f.caller, auth: { getUser: () => auth.promise } };
    const pending = readOwnerTaskAutomations(scope, caller, f.current);
    let settled = false; void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(7_999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await pending).toEqual({ status: "unavailable" });
    auth.resolve({ data: { user: { id: "actor" } }, error: null }); await flush();
    expect(f.calls).toEqual([]); expect(f.queries).toEqual([]); expect(vi.getTimerCount()).toBe(0);
  });
  it("expires a stalled control preflight without later dispatching an effect", async () => {
    clock(); const f = fixture(), auth = deferred<Awaited<ReturnType<OwnerTaskCaller["auth"]["getUser"]>>>();
    const caller = { ...f.caller, auth: { getUser: () => auth.promise } };
    const pending = controlOwnerTaskAutomation(scope, capturedReview(), "arm", caller, f.current);
    await vi.advanceTimersByTimeAsync(8_000); expect(await pending).toEqual({ status: "unavailable" });
    auth.resolve({ data: { user: { id: "actor" } }, error: null }); await flush();
    expect(f.calls).toEqual([]); expect(f.queries).toEqual([]); expect(vi.getTimerCount()).toBe(0);
  });
  it("uses the remaining overall budget for a deferred tenant RPC, not another eight seconds", async () => {
    clock(); const f = fixture(), auth = deferred<Awaited<ReturnType<OwnerTaskCaller["auth"]["getUser"]>>>(), tenant = deferred<TestResponse>();
    let tenantCalls = 0;
    const caller = { ...f.caller, auth: { getUser: () => auth.promise }, rpc: (name: string, args?: Record<string, unknown>) => {
      if (name === "current_user_tenant_id") { tenantCalls++; return tenant.promise; }
      return f.caller.rpc(name, args);
    } };
    const pending = controlOwnerTaskAutomation(scope, capturedReview(), "arm", caller, f.current);
    let settled = false; void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(5_000); auth.resolve({ data: { user: { id: "actor" } }, error: null }); await flush();
    expect(tenantCalls).toBe(1); await vi.advanceTimersByTimeAsync(2_999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await pending).toEqual({ status: "unavailable" });
    tenant.resolve({ data: "tenant", error: null }); await flush();
    expect(f.queries).toEqual([]); expect(f.calls.some(x => x.name === "control_owner_task_automation")).toBe(false);
  });
  it("bounds a deferred seat query before control and never dispatches when that query later returns", async () => {
    clock(); const f = fixture(), seat = deferred<TestResponse>();
    const caller = { ...f.caller, from: (table: string) => table === "tenant_members" ? waitingQuery(seat.promise) : f.caller.from(table) };
    const pending = controlOwnerTaskAutomation(scope, capturedReview(), "arm", caller, f.current);
    await vi.advanceTimersByTimeAsync(8_000); expect(await pending).toEqual({ status: "unavailable" });
    seat.resolve({ data: { role: "owner", status: "active" }, error: null }); await flush();
    expect(f.calls.map(x => x.name)).toEqual(["current_user_tenant_id"]); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["scope", "deadline"])("rechecks %s immediately before starting the sole control RPC", async fault => {
    clock(); const f = fixture();
    // Deliberately model a change immediately AFTER the final seat check, before
    // the continuation may invoke the mutation. The native writer remains the
    // actual authority; this verifies that an expired UI intent never dispatches.
    const seat = { status: "active", get role() {
      if (fault === "scope") f.change(); else vi.advanceTimersByTime(8_000);
      return "owner";
    } };
    const caller = { ...f.caller, from: (table: string) => table === "tenant_members"
      ? waitingQuery(Promise.resolve({ data: seat, error: null })) : f.caller.from(table) };
    const pending = controlOwnerTaskAutomation(scope, capturedReview(), "arm", caller, f.current);
    await flush(); expect(await pending).toEqual({ status: fault === "scope" ? "refused" : "unavailable" });
    expect(f.calls.map(x => x.name)).toEqual(["current_user_tenant_id"]); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["paige_automations", "paige_automation_acts"])("bounds a deferred %s read and publishes no late records", async table => {
    clock(); const f = fixture(), response = deferred<TestResponse>();
    const caller = { ...f.caller, from: (name: string) => name === table ? waitingQuery(response.promise) : f.caller.from(name) };
    const pending = readOwnerTaskAutomations(scope, caller, f.current);
    await vi.advanceTimersByTimeAsync(8_000); expect(await pending).toEqual({ status: "unavailable" });
    const before = { calls: f.calls.length, queries: f.queries.length };
    response.resolve({ data: table === "paige_automations" ? [{ ...row }] : [{ ...step }], error: null }); await flush();
    expect({ calls: f.calls.length, queries: f.queries.length }).toEqual(before); expect(vi.getTimerCount()).toBe(0);
  });
  it("returns unknown for an already dispatched control timeout and never retries or publishes its late acknowledgement", async () => {
    clock(); const f = fixture(), response = deferred<TestResponse>(); let ack!: TestResponse;
    const caller = { ...f.caller, rpc: async (name: string, args?: Record<string, unknown>) => {
      const result = await f.caller.rpc(name, args);
      if (name !== "control_owner_task_automation") return result;
      ack = result; return response.promise;
    } };
    const pending = controlOwnerTaskAutomation(scope, capturedReview(), "arm", caller, f.current);
    await flush(); expect(f.calls.filter(x => x.name === "control_owner_task_automation")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(8_000); expect(await pending).toEqual({ status: "unknown" });
    response.resolve(ack); await flush();
    expect(f.calls.map(x => x.name)).toEqual(["current_user_tenant_id", "control_owner_task_automation"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["auth", "tenant", "seat"])("bounds post-control %s revalidation by the original deadline without re-dispatch", async stage => {
    clock(); const f = fixture(), response = deferred<TestResponse>(), after = deferred<TestResponse>();
    let controlStarted = false, ack!: TestResponse, userCalls = 0;
    const caller = { ...f.caller, auth: { getUser: () => {
      userCalls++;
      return controlStarted && stage === "auth" ? after.promise as ReturnType<OwnerTaskCaller["auth"]["getUser"]> : f.caller.auth.getUser();
    } }, rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "current_user_tenant_id" && controlStarted && stage === "tenant") return after.promise;
      const result = await f.caller.rpc(name, args);
      if (name !== "control_owner_task_automation") return result;
      controlStarted = true; ack = result; return response.promise;
    }, from: (name: string) => name === "tenant_members" && controlStarted && stage === "seat" ? waitingQuery(after.promise) : f.caller.from(name) };
    const pending = controlOwnerTaskAutomation(scope, capturedReview(), "pause", caller, f.current);
    await vi.advanceTimersByTimeAsync(6_000); expect(controlStarted).toBe(true); response.resolve(ack); await flush();
    let settled = false; void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1_999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await pending).toEqual({ status: "unknown" });
    const before = { calls: f.calls.length, queries: f.queries.length, userCalls };
    after.resolve({ data: stage === "auth" ? { user: { id: "actor" } } : stage === "tenant" ? "tenant" : { role: "owner", status: "active" }, error: null }); await flush();
    expect({ calls: f.calls.length, queries: f.queries.length, userCalls }).toEqual(before);
    expect(f.calls.filter(x => x.name === "control_owner_task_automation")).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "control"])("keeps a changed context refused when the %s deadline expires", async operation => {
    clock(); const f = fixture(), auth = deferred<Awaited<ReturnType<OwnerTaskCaller["auth"]["getUser"]>>>();
    const caller = { ...f.caller, auth: { getUser: () => auth.promise } };
    const pending = operation === "read" ? readOwnerTaskAutomations(scope, caller, f.current)
      : controlOwnerTaskAutomation(scope, capturedReview(), "arm", caller, f.current);
    await flush(); f.change(); await vi.advanceTimersByTimeAsync(8_000);
    expect(await pending).toEqual({ status: "refused" });
    auth.resolve({ data: { user: { id: "actor" } }, error: null }); await flush();
    expect(f.calls).toEqual([]); expect(f.queries).toEqual([]);
  });
  it.each(["read", "control"])("never publishes %s success after the final authority check changes context", async operation => {
    clock(); const f = fixture(); let seatReads = 0;
    const caller = { ...f.caller, from: (table: string) => {
      if (table !== "tenant_members" || ++seatReads === 1) return f.caller.from(table);
      const seat = { status: "active", get role() { f.change(); return "owner"; } };
      return waitingQuery(Promise.resolve({ data: seat, error: null }));
    } };
    const pending = operation === "read" ? readOwnerTaskAutomations(scope, caller, f.current)
      : controlOwnerTaskAutomation(scope, capturedReview(), "arm", caller, f.current);
    await flush(); expect(await pending).toEqual({ status: "refused" });
    expect(f.calls.filter(x => x.name === "control_owner_task_automation")).toHaveLength(operation === "control" ? 1 : 0);
  });
});
