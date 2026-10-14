import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OperationsClientArtifactReview } from "./OperationsClientArtifactReview";
import { allowAccountSwitch } from "@/lib/auth/accountSwitchGuard";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),session:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:mocks.rpc,auth:{getSession:mocks.session}}}));
const scope={actorId:"eb830000-0000-4000-8000-000000000001",tenantId:"eb830000-0000-4000-8000-000000000002",releaseId:"eb830000-0000-4000-8000-000000000003"};
const record={actor_id:scope.actorId,tenant_id:scope.tenantId,release_id:scope.releaseId,submission_id:"eb830000-0000-4000-8000-000000000004",state:"awaiting_client",revision_no:2,artifact_digest:"a".repeat(64),title:"Synthetic deliverable",body:"<script>synthetic</script>\nReview this promised outcome.",updated_at:"2026-10-12T00:00:00Z"};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({data:{session:{user:{id:scope.actorId}}},error:null});mocks.rpc.mockResolvedValue({data:record,error:null});host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(props=scope){await act(async()=>root.render(<OperationsClientArtifactReview {...props}/>));}
const button=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent===label)!;

it("exposes the existing note/save close boundary and unregisters it on unmount",async()=>{
 let guard:()=>boolean=()=>true;const unregister=vi.fn();
 const register=vi.fn((next:()=>boolean)=>{guard=next;return unregister;});
 await act(async()=>root.render(<OperationsClientArtifactReview {...scope} registerCloseGuard={register}/>));
 expect(register).toHaveBeenCalledOnce();expect(guard()).toBe(true);
 const note=host.querySelector<HTMLTextAreaElement>("textarea")!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(note,"Keep this review note");note.dispatchEvent(new Event("input",{bubbles:true}));});
 expect(guard()).toBe(false);expect(note.value).toBe("Keep this review note");
 await act(async()=>button("Clear review note").click());expect(guard()).toBe(true);
 await act(async()=>root.render(null));expect(unregister).toHaveBeenCalledOnce();expect(guard()).toBe(false);
});
it("blocks parent close during a pending exact decision and never notifies an unknown write",async()=>{
 let guard:()=>boolean=()=>true;const verified=vi.fn();
 await act(async()=>root.render(<OperationsClientArtifactReview {...scope} registerCloseGuard={next=>{guard=next;return()=>{};}} onVerifiedDecision={verified}/>));
 await act(async()=>button("Accept this version").click());
 let resolve!:(value:unknown)=>void;
 mocks.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 await act(async()=>button("Confirm acceptance").click());
 expect(guard()).toBe(false);expect(verified).not.toHaveBeenCalled();
 await act(async()=>resolve({data:null,error:{code:"08006"}}));
 expect(verified).not.toHaveBeenCalled();expect(button("Accept this version").disabled).toBe(true);
});
it("keeps a blank-note confirmation and unknown outcome guarded until exact terminal source recovery",async()=>{
 let guard:()=>boolean=()=>true;const verified=vi.fn();
 await act(async()=>root.render(<OperationsClientArtifactReview {...scope} registerCloseGuard={next=>{guard=next;return()=>{};}} onVerifiedDecision={verified}/>));
 expect(guard()).toBe(true);await act(async()=>button("Accept this version").click());expect(guard()).toBe(false);
 await act(async()=>button("Keep reviewing").click());expect(guard()).toBe(true);
 await act(async()=>button("Accept this version").click());mocks.rpc.mockResolvedValueOnce({data:null,error:{code:"08006"}});
 await act(async()=>button("Confirm acceptance").click());expect(guard()).toBe(false);expect(verified).not.toHaveBeenCalled();
 await act(async()=>expect(await allowAccountSwitch({fromTenantId:scope.tenantId,toTenantId:"foreign",toTenantName:"Synthetic other workspace"})).toBe(false));
 const unload=new Event("beforeunload",{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
 await act(async()=>button("Check recorded review").click());expect(guard()).toBe(false);
 mocks.rpc.mockResolvedValue({data:{...record,state:"accepted",decision_by:scope.actorId,decision_at:"2026-10-12T01:00:00.123456Z",client_note:null,updated_at:"2026-10-12T01:00:00Z"},error:null});
 await act(async()=>button("Check recorded review").click());expect(guard()).toBe(true);expect(verified).not.toHaveBeenCalled();
 await act(async()=>expect(await allowAccountSwitch({fromTenantId:scope.tenantId,toTenantId:"foreign",toTenantName:"Synthetic other workspace"})).toBe(true));
 expect(mocks.rpc.mock.calls.filter(c=>c[0]==="operations_delivery_client_decide_scoped")).toHaveLength(1);
});
it.each(["version","note"])("a changed %s cannot discharge an unresolved blank-note decision",async change=>{
 let guard:()=>boolean=()=>true;
 await act(async()=>root.render(<OperationsClientArtifactReview {...scope} registerCloseGuard={next=>{guard=next;return()=>{};}}/>));
 await act(async()=>button("Accept this version").click());mocks.rpc.mockResolvedValueOnce({data:null,error:{code:"08006"}});
 await act(async()=>button("Confirm acceptance").click());
 mocks.rpc.mockResolvedValue({data:{...record,state:"accepted",decision_by:scope.actorId,decision_at:"2026-10-12T01:00:00.123456Z",client_note:change==="note"?"A different decision":null,revision_no:change==="version"?3:2,updated_at:"2026-10-12T01:00:00Z"},error:null});
 await act(async()=>button("Check recorded review").click());expect(guard()).toBe(false);
});
it("notifies only the named source tuple after independently verified acceptance",async()=>{
 const verified=vi.fn();await act(async()=>root.render(<OperationsClientArtifactReview {...scope} onVerifiedDecision={verified}/>));
 expect(verified).not.toHaveBeenCalled();await act(async()=>button("Accept this version").click());
 const saved={...record,state:"accepted",decision_by:scope.actorId,decision_at:"2026-10-12T01:00:00.123456Z",client_note:null,updated_at:"2026-10-12T01:00:00Z"};
 mocks.rpc.mockResolvedValue({data:saved,error:null});await act(async()=>button("Confirm acceptance").click());
 expect(verified).toHaveBeenCalledOnce();expect(verified).toHaveBeenCalledWith({actorId:scope.actorId,tenantId:scope.tenantId,
  releaseId:scope.releaseId,submissionId:record.submission_id,state:"accepted",revisionNo:2,artifactDigest:record.artifact_digest,updatedAt:saved.updated_at});
 expect(JSON.stringify(verified.mock.calls)).not.toContain(record.body);
});
it.each(["42501","08006"])("a %s decision never emits a verified notification",async code=>{
 const verified=vi.fn();await act(async()=>root.render(<OperationsClientArtifactReview {...scope} onVerifiedDecision={verified}/>));
 await act(async()=>button("Accept this version").click());mocks.rpc.mockResolvedValue({data:null,error:{code}});
 await act(async()=>button("Confirm acceptance").click());expect(verified).not.toHaveBeenCalled();
});
it("consumer notification failure cannot change an independently verified write into failure",async()=>{
 const verified=vi.fn(()=>{throw new Error("PRIVATE_CONSUMER_REFRESH");});
 await act(async()=>root.render(<OperationsClientArtifactReview {...scope} onVerifiedDecision={verified}/>));
 await act(async()=>button("Accept this version").click());
 mocks.rpc.mockResolvedValue({data:{...record,state:"accepted",decision_by:scope.actorId,decision_at:"2026-10-12T01:00:00.123456Z",client_note:null,updated_at:"2026-10-12T01:00:00Z"},error:null});
 await act(async()=>button("Confirm acceptance").click());
 expect(verified).toHaveBeenCalledOnce();expect(host.textContent).toContain("Your acceptance is recorded");
 expect(host.textContent).not.toContain("could not be confirmed");expect(host.textContent).not.toContain("PRIVATE_CONSUMER_REFRESH");
});
it("a slow consumer does not hold a completed decision or its close guard busy",async()=>{
 let guard:()=>boolean=()=>false;const verified=vi.fn(()=>new Promise<void>(()=>{}));
 await act(async()=>root.render(<OperationsClientArtifactReview {...scope} registerCloseGuard={next=>{guard=next;return()=>{};}} onVerifiedDecision={verified}/>));
 await act(async()=>button("Accept this version").click());
 mocks.rpc.mockResolvedValue({data:{...record,state:"accepted",decision_by:scope.actorId,decision_at:"2026-10-12T01:00:00.123456Z",client_note:null,updated_at:"2026-10-12T01:00:00Z"},error:null});
 await act(async()=>button("Confirm acceptance").click());
 expect(verified).toHaveBeenCalledOnce();expect(guard()).toBe(true);expect(host.textContent).not.toContain("Saving and checking");
});
it.each(["scope","session"])("a late %s change never notifies the parent about an old decision",async change=>{
 const verified=vi.fn();const register=vi.fn(()=>()=>{});
 await act(async()=>root.render(<OperationsClientArtifactReview {...scope} registerCloseGuard={register} onVerifiedDecision={verified}/>));
 await act(async()=>button("Accept this version").click());
 let resolve!:(value:unknown)=>void;mocks.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 await act(async()=>button("Confirm acceptance").click());
 if(change==="scope")await act(async()=>root.render(<OperationsClientArtifactReview {...scope} releaseId="other-release" registerCloseGuard={register} onVerifiedDecision={verified}/>));
 else mocks.session.mockResolvedValue({data:{session:{user:{id:"other-actual-user"}}},error:null});
 await act(async()=>resolve({data:{...record,state:"accepted",decision_by:scope.actorId,decision_at:"2026-10-12T01:00:00.123456Z",client_note:null,updated_at:"2026-10-12T01:00:00Z"},error:null}));
 expect(verified).not.toHaveBeenCalled();expect(host.textContent).not.toContain("Your acceptance is recorded");expect(host.textContent).not.toContain(record.body);
 expect(mocks.rpc.mock.calls.filter(c=>c[0]==="operations_delivery_client_decide_scoped")).toHaveLength(1);
});
it("an asynchronously rejected refresh cannot turn a verified decision into a failed write",async()=>{
 const verified=vi.fn(()=>Promise.reject(new Error("PRIVATE_REFRESH_REJECTION")));
 await act(async()=>root.render(<OperationsClientArtifactReview {...scope} onVerifiedDecision={verified}/>));
 await act(async()=>button("Accept this version").click());
 mocks.rpc.mockResolvedValue({data:{...record,state:"accepted",decision_by:scope.actorId,decision_at:"2026-10-12T01:00:00.123456Z",client_note:null,updated_at:"2026-10-12T01:00:00Z"},error:null});
 await act(async()=>button("Confirm acceptance").click());
 expect(verified).toHaveBeenCalledOnce();expect(host.textContent).toContain("Your acceptance is recorded");expect(host.textContent).not.toContain("PRIVATE_REFRESH_REJECTION");expect(host.textContent).not.toContain("could not be confirmed");
});
it("a verified revision notification excludes the private review note",async()=>{
 const verified=vi.fn();await act(async()=>root.render(<OperationsClientArtifactReview {...scope} onVerifiedDecision={verified}/>));
 const note=host.querySelector<HTMLTextAreaElement>("textarea")!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(note,"Private requested revision");note.dispatchEvent(new Event("input",{bubbles:true}));});
 await act(async()=>button("Request changes").click());
 mocks.rpc.mockResolvedValue({data:{...record,state:"client_revision_requested",decision_by:scope.actorId,decision_at:"2026-10-12T01:00:00.123456Z",client_note:"Private requested revision",updated_at:"2026-10-12T01:00:00Z"},error:null});
 await act(async()=>button("Confirm changes").click());
 expect(verified).toHaveBeenCalledOnce();expect(verified.mock.calls[0][0]).toMatchObject({state:"client_revision_requested",releaseId:scope.releaseId,revisionNo:2});expect(JSON.stringify(verified.mock.calls)).not.toContain("Private requested revision");
});
it("reads only the exact released client artifact and never executes on opening",async()=>{await render();expect(host.textContent).toContain("Synthetic deliverable");expect(host.textContent).toContain("Version 2");expect(host.textContent).toContain(record.body);expect(host.querySelector("script")).toBeNull();expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(["operations_delivery_client_read_scoped"]);});
it("foreign or mismatched source content stays hidden and cannot be accepted",async()=>{mocks.rpc.mockResolvedValue({data:{...record,tenant_id:"foreign"},error:null});await render();expect(host.textContent).not.toContain(record.title);expect(host.textContent).toContain("Review unavailable");expect(button("Accept this version")).toBeUndefined();});
it("acceptance requires confirmation and independent decision readback",async()=>{await render();await act(async()=>button("Accept this version").click());expect(mocks.rpc).toHaveBeenCalledOnce();expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Accept version 2?");mocks.rpc.mockResolvedValue({data:{...record,state:"accepted",decision_by:scope.actorId,decision_at:"2026-10-12T01:00:00.123456Z",client_note:null,updated_at:"2026-10-12T01:00:00Z"},error:null});await act(async()=>button("Confirm acceptance").click());expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(["operations_delivery_client_read_scoped","operations_delivery_client_decide_scoped","operations_delivery_client_read_scoped"]);expect(host.textContent).toContain("Your acceptance is recorded");});
it("cancelling acceptance restores its invoker and never submits",async()=>{await render();const accept=button("Accept this version");accept.focus();await act(async()=>accept.click());await act(async()=>button("Keep reviewing").click());await vi.waitFor(()=>expect(document.activeElement).toBe(accept));expect(mocks.rpc).toHaveBeenCalledOnce();});
it("an acknowledgement without matching independent readback is unknown and cannot be replayed",async()=>{await render();mocks.rpc.mockImplementation(async(name:string)=>({data:name==="operations_delivery_client_decide_scoped"?{...record,state:"accepted"}:record,error:null}));await act(async()=>button("Accept this version").click());await act(async()=>button("Confirm acceptance").click());expect(host.textContent).toContain("Your decision could not be confirmed");expect(host.textContent).not.toContain("Your acceptance is recorded");expect(button("Accept this version").disabled).toBe(true);await act(async()=>button("Check recorded review").click());expect(button("Accept this version").disabled).toBe(true);expect(mocks.rpc.mock.calls.filter(c=>c[0]==="operations_delivery_client_decide_scoped")).toHaveLength(1);});
it("revision requires a note, guards the unsaved note, and records a distinct verified decision",async()=>{await render();await act(async()=>button("Request changes").click());expect(host.textContent).toContain("Add a review note");expect(mocks.rpc).toHaveBeenCalledOnce();const note=host.querySelector<HTMLTextAreaElement>("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(note,"Clarify the second outcome");note.dispatchEvent(new Event("input",{bubbles:true}));});expect(button("Check recorded review").disabled).toBe(true);await act(async()=>{expect(await allowAccountSwitch({fromTenantId:scope.tenantId,toTenantId:"foreign",toTenantName:"Synthetic other workspace"})).toBe(false);});await act(async()=>button("Request changes").click());mocks.rpc.mockResolvedValue({data:{...record,state:"client_revision_requested",decision_by:scope.actorId,decision_at:"2026-10-12T01:00:00.123456Z",client_note:"Clarify the second outcome"},error:null});await act(async()=>button("Confirm changes").click());expect(host.textContent).toContain("Your changes are recorded");expect(host.textContent).not.toContain("Your acceptance is recorded");expect(mocks.rpc.mock.calls.find(c=>c[0]==="operations_delivery_client_decide_scoped")?.[1]).toMatchObject({p_decision:"client_revision_requested",p_note:"Clarify the second outcome"});});
it("an actual session mismatch cannot use a preview actor to read or accept",async()=>{mocks.session.mockResolvedValue({data:{session:{user:{id:"other-actual-user"}}},error:null});await render();expect(mocks.rpc).not.toHaveBeenCalled();expect(host.textContent).toContain("Review unavailable");expect(host.textContent).not.toContain(record.body);});
it("revoked server access hides artifact content and decisions",async()=>{mocks.rpc.mockResolvedValue({data:null,error:{code:"42501"}});await render();expect(host.textContent).toContain("Review unavailable");expect(host.textContent).not.toContain(record.body);expect(button("Accept this version")).toBeUndefined();});
it("late content for an earlier scope never appears in the new actor or tenant",async()=>{let resolve!:(value:unknown)=>void;mocks.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));await render();await render({...scope,tenantId:"other-tenant"});await act(async()=>resolve({data:record,error:null}));expect(host.textContent).not.toContain(record.title);expect(host.textContent).not.toContain(record.body);expect(button("Accept this version")).toBeUndefined();});
it("recorded-state recovery preserves the client's revision note after refusal",async()=>{await render();const note=host.querySelector<HTMLTextAreaElement>("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(note,"Preserve the requested changes");note.dispatchEvent(new Event("input",{bubbles:true}));});await act(async()=>button("Request changes").click());mocks.rpc.mockResolvedValueOnce({data:null,error:{code:"42501"}});await act(async()=>button("Confirm changes").click());expect(note.disabled).toBe(true);expect(button("Check recorded review").disabled).toBe(false);await act(async()=>button("Check recorded review").click());expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Preserve the requested changes");expect(mocks.rpc.mock.calls.filter(c=>c[0]==="operations_delivery_client_decide_scoped")).toHaveLength(1);});
it.each(["42501","08006"])("preserves a note through %s recovery without transferring it to a changed version",async code=>{await render();const note=host.querySelector<HTMLTextAreaElement>("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(note,"Note for version two");note.dispatchEvent(new Event("input",{bubbles:true}));});await act(async()=>button("Request changes").click());mocks.rpc.mockResolvedValueOnce({data:null,error:{code}});await act(async()=>button("Confirm changes").click());mocks.rpc.mockResolvedValue({data:{...record,revision_no:3,artifact_digest:"b".repeat(64)},error:null});await act(async()=>button("Check recorded review").click());expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Note for version two");expect(host.textContent).toContain("Your note belongs to the earlier released version");expect(button("Accept this version").disabled).toBe(true);await act(async()=>button("Clear review note").click());expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");expect(button("Accept this version").disabled).toBe(code==="08006");expect(mocks.rpc.mock.calls.filter(c=>c[0]==="operations_delivery_client_decide_scoped")).toHaveLength(1);});
it("revoked recovery masks the artifact but offers explicit draft clearance so the client can leave",async()=>{await render();const note=host.querySelector<HTMLTextAreaElement>("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(note,"Private retained client note");note.dispatchEvent(new Event("input",{bubbles:true}));});await act(async()=>button("Request changes").click());mocks.rpc.mockResolvedValue({data:null,error:{code:"42501"}});await act(async()=>button("Confirm changes").click());await act(async()=>button("Check recorded review").click());expect(host.textContent).toContain("Review unavailable");expect(host.textContent).not.toContain(record.body);expect(host.textContent).not.toContain("Private retained client note");expect(button("Clear review note")).toBeDefined();await act(async()=>button("Clear review note").click());await act(async()=>expect(await allowAccountSwitch({fromTenantId:scope.tenantId,toTenantId:"foreign",toTenantName:"Synthetic other workspace"})).toBe(true));expect(mocks.rpc.mock.calls.filter(c=>c[0]==="operations_delivery_client_decide_scoped")).toHaveLength(1);});
