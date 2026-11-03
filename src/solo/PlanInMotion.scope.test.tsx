import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanInMotion } from "./PlanInMotion";
import {MemoryRouter,Routes,Route} from "react-router-dom";

const h = vi.hoisted(() => ({ actor: "test-owner", tenant: "test-tenant-a", ready: true, detail: vi.fn(), mutate: vi.fn(), source: vi.fn(), inspectTask: vi.fn(), submitTask: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({supabase: {rpc: vi.fn()}}));
vi.mock('./operations/useOperationsPeople',()=>({useOperationsPeople:()=>({members:[{user_id:h.actor,full_name:'Current owner',email:'owner@tests.invalid',status:'active'}],loading:false,error:null,refresh:vi.fn()})}));
vi.mock('./mission-task-command',async()=>({...await vi.importActual('./mission-task-command'),inspectMissionTaskEffect:h.inspectTask,submitMissionTaskOperation:h.submitTask}));

vi.mock('../../supabase/functions/_shared/knowledge-source-evidence', () => ({readKnowledgeSourceEvidence: h.source}));
vi.mock("@/hooks/useTenantContext", () => ({ useOptionalTenantContext: () => ({ activeUserId: h.actor, activeTenantId: h.tenant, accountContextStatus: h.ready ? "ready" : "resolving", loading: !h.ready }) }));
vi.mock("./MissionTargetsPanel", () => ({ MissionTargetsPanel: () => <div>Existing target reader</div> }));
vi.mock("./data/useBusinessGamePlanMissions", () => ({ useBusinessGamePlanMissions: (scope: string | null) => ({ status: scope ? "ready" : "loading", refresh: vi.fn(), getDetail: h.detail, mutate: h.mutate,
  items: scope ? [{ id: "play", title: "Reviewed plan", state: "active", stageLabel: "Active", horizonLabel: "Open horizon", nextOwner: "Owner", desired_outcome: "Reviewed outcome" }] : [] }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const render = async (workspace = h.tenant) => { await act(async () => { root.render(<PlanInMotion workspaceId={workspace} />); }); };
const open = async () => { await act(async () => host.querySelector<HTMLButtonElement>(".pim-card")!.click()); };
const detail = (title: string) => ({ mission: { id: "play", title, state: "active", revision: 1 }, brief: { desired_outcome: "Private owner direction", constraints: [], assumptions: [], missing_information: [] } });
beforeEach(() => { h.actor = "test-owner"; h.tenant = "test-tenant-a"; h.ready = true; h.detail.mockReset(); h.mutate.mockReset(); h.source.mockReset(); h.inspectTask.mockReset(); h.submitTask.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("retires a private drawer immediately on workspace/actor or unresolved-account change", async () => {
  h.detail.mockResolvedValue(detail("Private Play A")); await render(); await open();
  expect(host.textContent).toContain("Private Play A");
  h.ready = false; await render("test-tenant-a");
  expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(host.textContent).not.toContain("Private Play A");
  h.ready = true; h.tenant = "test-tenant-b"; await render();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  h.actor = "test-owner-b"; await render(); expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("discards a late detail across A-B-A and never replaces the new Play", async () => {
  let late!: (v: unknown) => void;
  h.detail.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
  await render(); await open(); h.tenant = "test-tenant-b"; await render();
  h.tenant = "test-tenant-a"; await render(); h.detail.mockResolvedValue(detail("Current Play")); await open();
  await act(async () => { late(detail("Retired private response")); });
  expect(host.textContent).toContain("Current Play"); expect(host.textContent).not.toContain("Retired private response");
});
it("a closed drawer cannot reopen when a pending lifecycle write returns", async () => {
  let done!: (v: unknown) => void;
  h.detail.mockResolvedValue(detail("Reviewed Play")); h.mutate.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  await render(); await open();
  const pause = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === "Pause")!;
  await act(async () => pause.click());
  const reason = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Owner review"); reason.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Confirm")!.click());
  expect(h.mutate).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
  await act(async () => { done({ ok: true, verified: true, railRecorded: true, outcomeUnknown: false, missionId: "play" }); });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("opens a referenced Play through the existing authorized reader and never dispatches a mutation", async () => {
  h.detail.mockResolvedValue(detail("Referenced canonical Play"));
  const close = vi.fn();
  await act(async () => root.render(<PlanInMotion workspaceId={h.tenant} selectedPlayId="play" onClosePlay={close} />));
  expect(h.detail).toHaveBeenCalledWith("play"); expect(host.textContent).toContain("Referenced canonical Play");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
  expect(close).toHaveBeenCalledTimes(1); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(h.mutate).not.toHaveBeenCalled();
});
it("withholds a referenced record when context is unresolved, and offers an honest failed read", async () => {
  h.ready = false;
  await act(async () => root.render(<PlanInMotion workspaceId={h.tenant} selectedPlayId="play" />));
  expect(h.detail).not.toHaveBeenCalled();
  h.ready = true; h.detail.mockRejectedValue(Error("MISSION_NOT_FOUND"));
  await act(async () => root.render(<PlanInMotion workspaceId={h.tenant} selectedPlayId="play" />));
  expect(host.textContent).toContain("could not be verified in the current workspace");
  expect(host.textContent).toContain("Retry Play read"); expect(h.mutate).not.toHaveBeenCalled();
});
it("retires a previous route read across record changes and removal", async () => {
  let late!: (value: unknown) => void;
  h.detail.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
  const route = async (id: string | null) => { await act(async () => root.render(<PlanInMotion workspaceId={h.tenant} selectedPlayId={id} />)); };
  await route("play-a");
  h.detail.mockResolvedValue({ ...detail("Current referenced Play"), mission: { id: "play-b", title: "Current referenced Play", state: "active", revision: 2 } });
  await route("play-b");
  await act(async () => { late(detail("Retired route response")); });
  expect(host.textContent).toContain("Current referenced Play"); expect(host.textContent).not.toContain("Retired route response");
  await route(null);
  expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(h.mutate).not.toHaveBeenCalled();
});

function documentPlan() {
  const documentId='22222222-2222-4222-8222-222222222222';
  return {mission:{id:'play',title:'Engagement plan',state:'active',revision:4,next_action:'Hold kickoff'},
    brief:{id:'brief',version:3,desired_outcome:'Deliver the engagement',deadline_on:null,baseline:'Agreement reviewed',strategy:'Follow the reviewed steps',constraints:[],
      success_definition:'Deliverables verified',owner_authority:'Propose work for review',assumptions:[],missing_information:[],revision_reason:'',created_at:'2026-11-02T00:00:00Z',
      document_work_intent_status:'available',document_work_intent_hash:'a'.repeat(64),document_work_intent:{contractVersion:1,
        sources:[{reference:{contractVersion:1,tenantId:h.tenant,documentId,revision:2,contentSha256:'b'.repeat(64)},title:'Synthetic engagement',excerpts:[{start:0,end:17,text:'PRIVATE_QUOTATION'}]}],
        steps:[{id:'33333333-3333-4333-8333-333333333333',title:'Hold kickoff',description:'Confirm the required inputs.',responsible:{kind:'unassigned'},dueOn:null,
          dependencies:[],sourceIds:[documentId],basis:'source_obligation',proposedTask:{action:'task.create',assigneeUserId:null}}]}}};
}
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.trim()===name)!;

it('edits document steps through the existing plan save and retains their original identity and source version', async () => {
  h.tenant='11111111-1111-4111-8111-111111111111';
  const record=documentPlan();h.detail.mockResolvedValue(record);
  h.mutate.mockResolvedValue({ok:true,verified:true,railRecorded:true,outcomeUnknown:false,missionId:'play'});
  await render();await open();
  expect(host.textContent).toContain('Synthetic engagement');
  expect(host.textContent).not.toContain('PRIVATE_QUOTATION');
  expect(h.source).not.toHaveBeenCalled();
  await act(async()=>button('Revise').click());
  const label=[...host.querySelectorAll('label')].find(item=>item.querySelector('span')?.textContent==='Step title')!;
  const input=label.querySelector<HTMLInputElement>('input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Prepare kickoff');input.dispatchEvent(new Event('input',{bubbles:true}));});
  const reason=[...host.querySelectorAll('label')].find(item=>item.querySelector('span')?.textContent==='Why this changed')!.querySelector<HTMLInputElement>('input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(reason,'Refined kickoff');reason.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>button('Save revision').click());
  const args=h.mutate.mock.calls[0][1];
  expect(args.document_work_intent.steps[0]).toMatchObject({id:record.brief.document_work_intent.steps[0].id,title:'Prepare kickoff',dueOn:null});
  expect(args.document_work_intent.sources).toEqual(record.brief.document_work_intent.sources);
  expect(args.expected_revision).toBe(4);
});

it('withholds unavailable source text and omits the field on unrelated edits instead of clearing the saved intent', async () => {
  h.tenant='11111111-1111-4111-8111-111111111111';
  const record=documentPlan();
  h.detail.mockResolvedValue({...record,brief:{...record.brief,document_work_intent:null,document_work_intent_status:'source_unavailable'}});
  h.mutate.mockResolvedValue({ok:true,verified:true,railRecorded:true,outcomeUnknown:false,missionId:'play'});
  await render();await open();
  expect(host.textContent).toContain('Saved source details are withheld');
  expect(host.textContent).not.toContain('Synthetic engagement');
  await act(async()=>button('Revise').click());
  const label=[...host.querySelectorAll('label')].find(item=>item.querySelector('span')?.textContent==='Why this changed')!;
  const input=label.querySelector<HTMLInputElement>('input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Updated the approach');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>button('Save revision').click());
  expect(h.mutate.mock.calls[0][1]).not.toHaveProperty('document_work_intent');
});

it('never paints a late source quotation after workspace departure and return', async () => {
  h.tenant='11111111-1111-4111-8111-111111111111';
  h.detail.mockResolvedValue(documentPlan());
  let resolve!:(value:unknown)=>void;
  h.source.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  await render();await open();await act(async()=>button('Check source quotations').click());
  expect(h.source).toHaveBeenCalledOnce();
  h.tenant='44444444-4444-4444-8444-444444444444';await render();
  h.tenant='11111111-1111-4111-8111-111111111111';await render();await open();
  await act(async()=>resolve({status:'available',excerpts:[{text:'Retired private quotation'}]}));
  expect(host.textContent).not.toContain('Retired private quotation');
  expect(h.mutate).not.toHaveBeenCalled();
});

it('explicitly removes withheld document steps without exposing their former source text', async () => {
  h.tenant='11111111-1111-4111-8111-111111111111';
  const record=documentPlan();
  h.detail.mockResolvedValue({...record,brief:{...record.brief,document_work_intent:null,document_work_intent_status:'source_changed'}});
  h.mutate.mockResolvedValue({ok:true,verified:true,railRecorded:true,outcomeUnknown:false,missionId:'play'});
  await render();await open();await act(async()=>button('Revise').click());
  expect(host.textContent).not.toContain('Synthetic engagement');
  expect(host.textContent).not.toContain('PRIVATE_QUOTATION');
  const remove=button('Remove document steps from this plan');
  expect(remove).toBeDefined();
  await act(async()=>remove.click());
  expect(host.textContent).toContain('will be removed when you save this revision');
  const input=[...host.querySelectorAll('label')].find(item=>item.querySelector('span')?.textContent==='Why this changed')!.querySelector<HTMLInputElement>('input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Removed stale source-based steps');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>button('Save revision').click());
  expect(h.mutate.mock.calls[0][1]).toHaveProperty('document_work_intent',null);
  expect(h.source).not.toHaveBeenCalled();
});

it('reviews a saved source step and creates only through the original Task door after exact approval',async()=>{
 h.tenant='11111111-1111-4111-8111-111111111111';h.actor='55555555-5555-4555-8555-555555555555';
 const record=documentPlan();record.mission.id='66666666-6666-4666-8666-666666666666';h.detail.mockResolvedValue(record);
 h.inspectTask.mockResolvedValue({kind:'not_created'});
 await render();await open();expect(button('Review task')).toBeDefined();
 await act(async()=>button('Review task').click());
 expect(h.inspectTask).toHaveBeenCalledOnce();expect(h.submitTask).not.toHaveBeenCalled();
 expect(host.textContent).toContain('Assigned to: Current owner (you)');expect(host.textContent).toContain('The task will have no due date.');
 h.submitTask.mockResolvedValueOnce({kind:'approval',fingerprint:'exact-native-fingerprint',summary:'Create this reviewed task.'});
 await act(async()=>button('Create task').click());
 const op=h.submitTask.mock.calls[0][0];expect(op.command.patch).toMatchObject({title:'Hold kickoff',assignee_user_id:h.actor,due_date:null,
  metadata:{mission_source_v1:{missionId:record.mission.id,missionRevision:4,briefVersion:3,stepId:record.brief.document_work_intent.steps[0].id}}});
 expect(button('Approve task')).toBeDefined();
 h.submitTask.mockResolvedValueOnce({kind:'acknowledged'});h.inspectTask.mockResolvedValueOnce({kind:'available',task:{id:'77777777-7777-4777-8777-777777777777',title:'Hold kickoff',status:'pending'},origin:{missionRevision:4,briefVersion:3,intentSha256:'a'.repeat(64)},receipt:{correlation_id:'88888888-8888-4888-8888-888888888888'}});
 await act(async()=>button('Approve task').click());
 expect(h.submitTask).toHaveBeenLastCalledWith(op,'exact-native-fingerprint');expect(h.inspectTask).toHaveBeenCalledTimes(2);
 expect(host.textContent).toContain('Saved task');expect(host.textContent).toContain('Original receipt: 88888888');expect(h.mutate).not.toHaveBeenCalled();
});

function taskPlan(){
 h.tenant='11111111-1111-4111-8111-111111111111';h.actor='55555555-5555-4555-8555-555555555555';
 const record=documentPlan();record.mission.id='66666666-6666-4666-8666-666666666666';h.detail.mockResolvedValue(record);return record;
}
it('inspects a lost Task response without replay and masks a late A-B-A result',async()=>{
 taskPlan();h.inspectTask.mockResolvedValueOnce({kind:'not_created'});h.submitTask.mockResolvedValue({kind:'uncertain',message:'Original effect is unknown.'});
 await render();await open();await act(async()=>button('Review task').click());await act(async()=>button('Create task').click());
 expect(host.textContent).toContain('Original effect is unknown.');expect(h.submitTask).toHaveBeenCalledOnce();
 let late!:(result:unknown)=>void;h.inspectTask.mockImplementationOnce(()=>new Promise(done=>{late=done;}));
 await act(async()=>button('Check original task').click());expect(h.submitTask).toHaveBeenCalledOnce();
 const original=h.tenant;h.tenant='44444444-4444-4444-8444-444444444444';await render();h.tenant=original;await render();await open();
 await act(async()=>late({kind:'available',task:{id:'77777777-7777-4777-8777-777777777777',title:'Late private Task',status:'pending'},origin:{missionRevision:4,briefVersion:3,intentSha256:'a'.repeat(64)},receipt:{correlation_id:'88888888-8888-4888-8888-888888888888'}}));
 expect(host.textContent).not.toContain('Late private Task');expect(h.submitTask).toHaveBeenCalledOnce();
});
it('reopens the original Task through the canonical route and preserves older creating provenance',async()=>{
 const record=taskPlan();h.inspectTask.mockResolvedValue({kind:'available',task:{id:'77777777-7777-4777-8777-777777777777',title:'Original saved Task',status:'in_progress'},origin:{missionRevision:2,briefVersion:1,intentSha256:'b'.repeat(64)},receipt:{correlation_id:'88888888-8888-4888-8888-888888888888'}});
 await act(async()=>root.render(<MemoryRouter initialEntries={['/solo/9000001/command-center']}><Routes><Route path="/solo/:account/*" element={<PlanInMotion workspaceId={h.tenant}/>}/></Routes></MemoryRouter>));
 await open();await act(async()=>button('Review task').click());
 expect(host.textContent).toContain('Original saved Task');expect(host.textContent).toContain('earlier approved plan version');
 expect(host.querySelector<HTMLAnchorElement>('a[href*="77777777"]')?.getAttribute('href')).toContain('/solo/9000001/');
 expect(host.querySelector<HTMLAnchorElement>('a[href*="77777777"]')?.textContent).toBe('Open task');
 expect(h.submitTask).not.toHaveBeenCalled();expect(h.detail).toHaveBeenCalled();expect(record.mission.revision).toBe(4);
});
it('does not create from an unsaved editor, an inactive plan or a deleted historical effect',async()=>{
 const record=taskPlan();h.inspectTask.mockResolvedValueOnce({kind:'historical_unavailable'});
 await render();await open();await act(async()=>button('Review task').click());
 expect(host.textContent).toContain('Another task will not be created');expect(button('Create task')).toBeUndefined();
 await act(async()=>button('Close task review').click());await act(async()=>button('Revise').click());
 expect(button('Review task')).toBeUndefined();expect(h.submitTask).not.toHaveBeenCalled();
 await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
 h.detail.mockResolvedValue({...record,mission:{...record.mission,state:'paused'}});await open();h.inspectTask.mockResolvedValue({kind:'not_created'});
 await act(async()=>button('Review task').click());expect(button('Create task').disabled).toBe(true);expect(h.submitTask).not.toHaveBeenCalled();
});
