import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeamHubEmailDraft } from "./TeamHubEmailDraft";
import type { NexusEmailDraft, NexusEmailDraftAnswer } from "../../../supabase/functions/_shared/team-hub/nexus-email-contract";

const picker=vi.hoisted(()=>({props:null as unknown}));
vi.mock("@/components/paige/CustomerSelector",()=>({CustomerSelector:(props:{onSelect:(v:unknown)=>void})=>{picker.props=props;return <button onClick={()=>props.onSelect({id:"77777777-1111-4111-8111-111111111111",name:"Existing contact",email:"recipient@tests.invalid"})}>Choose existing contact</button>;}}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const [tenant,actor,turn,conversation,source,message,contact,connector]=Array.from({length:8},(_,i)=>`${String(i+1).repeat(8)}-1111-4111-8111-111111111111`);
const base:NexusEmailDraft={tenantId:tenant,actorId:actor,turnId:turn,conversationId:conversation,sourceMessageId:source,messageId:message,
  preparation:{subject:"Project update",body:"Ready for review."},contactId:null,connectorId:null,saved:null};
let host:HTMLDivElement,root:Root;
const invoke=vi.fn<(request:unknown,signal?:AbortSignal)=>Promise<NexusEmailDraftAnswer>>();
async function render(draft=base){await act(async()=>root.render(<MemoryRouter><TeamHubEmailDraft draft={draft} account={{account_type:"standalone",parent_tenant_id:null,account_number:10000}} act={invoke}/></MemoryRouter>));}
async function click(text:string){const button=Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.trim()===text);expect(button, text).toBeTruthy();await act(async()=>button!.click());}
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);invoke.mockReset();picker.props=null;});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it("rendering and reviewing preparation never saves; recipient selection stays bound to this actor/workspace",async()=>{
  invoke.mockResolvedValue({ok:true,outcome:"available",message_id:message,senders:[{connector_id:connector,from_address:"business@tests.invalid"}]});
  await render();expect(invoke).not.toHaveBeenCalled();
  await click("Choose recipient and email account");
  expect(invoke.mock.calls[0][0]).toEqual({messageId:message,intent:"inspect"});
  expect(picker.props).toMatchObject({tenantId:tenant,scopeKey:actor});
  expect(host.textContent).toContain("It will not be sent.");
  const save=Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Save unsent email");expect(save?.disabled).toBe(true);
  await click("Choose existing contact");expect(save?.disabled).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("one explicit Save hands off only selected original IDs; truthful receipt links the same Messages draft",async()=>{
  const result={message_id:source,updated_at:"2026-11-03T03:00:00.123456+00:00",receipt_id:turn,operation_id:connector};
  invoke.mockResolvedValueOnce({ok:true,outcome:"available",message_id:message,senders:[{connector_id:connector,from_address:"business@tests.invalid"}]})
    .mockResolvedValueOnce({ok:true,outcome:"saved",message_id:message,result});
  await render();await click("Choose recipient and email account");await click("Choose existing contact");await click("Save unsent email");
  expect(invoke.mock.calls[1][0]).toEqual({messageId:message,intent:"save",contactId:contact,connectorId:connector});
  expect(host.textContent).toContain("Saved in Messages");
  const link=host.querySelector<HTMLAnchorElement>("a");expect(link?.textContent).toContain("Open email");
  expect(link?.getAttribute("href")).toContain(`email_draft=${source}`);expect(link?.getAttribute("href")).toContain(`hub_message=${message}`);
  expect(host.textContent).not.toContain("Delivered");
});
it("a reconstructed bound request first checks; unknown never claims success and retry keeps the same Save",async()=>{
  invoke.mockResolvedValue({ok:false,outcome:"unknown",message_id:message});
  await render({...base,contactId:contact,connectorId:connector});
  expect(invoke).not.toHaveBeenCalled();await click("Check saved status");
  expect(invoke.mock.calls[0][0]).toEqual({messageId:message,intent:"check"});
  expect(host.textContent).toContain("The save isn’t confirmed.");expect(host.textContent).not.toContain("Saved in Messages");
  await click("Retry same save");expect(invoke.mock.calls[1][0]).toEqual({messageId:message,intent:"save",contactId:contact,connectorId:connector});
});
it("no permitted mailbox and an unavailable read remain distinct and invoke no Save",async()=>{
  invoke.mockResolvedValueOnce({ok:false,outcome:"unavailable"}).mockResolvedValueOnce({ok:true,outcome:"available",message_id:message,senders:[]});
  await render();await click("Choose recipient and email account");expect(host.textContent).toContain("aren’t available right now");
  await click("Choose recipient and email account");expect(host.textContent).toContain("No permitted email account");
  expect(invoke.mock.calls.every(([request])=>(request as {intent:string}).intent==="inspect")).toBe(true);
});
it("leaving a pending explicit save aborts the browser wait without claiming cancellation or success",async()=>{
  let signal:AbortSignal|undefined;
  invoke.mockImplementation(async(_r,s)=>{signal=s;return new Promise(()=>{});});
  await render({...base,contactId:contact,connectorId:connector});
  await click("Check saved status");expect(signal?.aborted).toBe(false);
  await act(async()=>root.unmount());expect(signal?.aborted).toBe(true);
  root=createRoot(host);
});
