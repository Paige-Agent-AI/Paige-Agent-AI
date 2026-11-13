import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
import {MemoryRouter} from "react-router-dom";
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{functions:{invoke:mocks.invoke}}}));
import {SocialApprovalReview,SocialPublicationCard} from "./SocialPublicationCard";
const reference={schema:1 as const,tenant_id:"11111111-1111-4111-8111-111111111111",content_id:"22222222-2222-4222-8222-222222222222",content_revision:"2026-11-13T12:00:00Z",publication_id:null};
const account={account_type:"standalone",parent_tenant_id:null,account_number:1234567};
const fingerprint="0123456789abcdef";
const preview=()=>({ok:true,state:"approval_available",approval:{fingerprint,summary:"Original exact Social proposal",expires_at:new Date(Date.now()+600000).toISOString()},preview:{piece_id:reference.content_id,channel_label:"Verified original destination",platform:"threads",caption:"Exact approved words\n\nSecond paragraph",media:[]}});
let host:HTMLDivElement,root:Root;
afterEach(()=>{act(()=>root.unmount());host.remove();});
beforeEach(()=>{mocks.invoke.mockReset();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
const mount=async(el:React.ReactNode)=>{await act(async()=>root.render(<MemoryRouter>{el}</MemoryRouter>));};
const byRole=(role:string,name?:RegExp)=>[...host.querySelectorAll<HTMLElement>(role==="link"?"a":role==="button"?"button":`[role="${role}"]`)].find(el=>!name||name.test(el.textContent??""))??null;
const screen={
 getByRole:(role:string,options?:{name?:RegExp})=>{const el=byRole(role,options?.name);if(!el)throw Error(`Missing ${role}`);return el;},
 queryByRole:(role:string,options?:{name?:RegExp})=>byRole(role,options?.name),
 queryByText:(text:string)=>[...host.querySelectorAll("p")].find(el=>el.textContent===text)??null,
 getByText:(text:RegExp)=>{const el=[...host.querySelectorAll("p")].find(el=>text.test(el.textContent??""));if(!el)throw Error("Missing text");return el;},
 findByText:async(text:string)=>{await act(async()=>{await Promise.resolve();});const el=[...host.querySelectorAll("p")].find(el=>el.textContent===text);if(!el)throw Error(`Missing text ${text}`);return el;},
};
const waitFor=async(check:()=>void)=>{await act(async()=>{await Promise.resolve();});check();};
const fireEvent={click:(el:HTMLElement)=>act(()=>el.click())};
describe("original Social Chat/Hub consumer",()=>{
 it("renders original native source and exact reopen route without publishing",async()=>{mocks.invoke.mockResolvedValue({data:{ok:true,state:"available",reference,title:"Original saved post",caption:"Literal source",status:"saved_source"},error:null});await mount(<SocialPublicationCard reference={reference} tenantId={reference.tenant_id} account={account}/>);await screen.findByText("Literal source");expect(screen.getByRole("link").getAttribute("href")).toBe(`/solo/1234567/growth/social?social_piece=${reference.content_id}`);expect(mocks.invoke).toHaveBeenCalledTimes(1);expect(mocks.invoke.mock.calls[0][1].body.action).toBe("inspect");});
 it("retains the original publication identity on receipt/performance reopen",async()=>{const ref={...reference,publication_id:"33333333-3333-4333-8333-333333333333"};mocks.invoke.mockResolvedValue({data:{ok:true,state:"available",reference:ref,title:"Original Social post",caption:"Published words",status:"published"},error:null});await mount(<SocialPublicationCard reference={ref} tenantId={ref.tenant_id} account={account}/>);await screen.findByText("Published words");expect(screen.getByRole("link").getAttribute("href")).toContain(`publication=${ref.publication_id}`);expect(mocks.invoke.mock.calls[0][1].body.publication_id).toBe(ref.publication_id);});
 it("does not query or link a foreign tenant reference",async()=>{await mount(<SocialPublicationCard reference={reference} tenantId="foreign" account={account}/>);expect(mocks.invoke).not.toHaveBeenCalled();expect(screen.queryByRole("link")).toBeNull();expect(screen.getByRole("status").textContent).toContain("could not be read");});
 it("does not substitute a changed draft into old Chat history",async()=>{mocks.invoke.mockResolvedValue({data:{state:"available",reference:{...reference,content_revision:"2026-11-14T12:00:00Z"},caption:"Changed content"},error:null});await mount(<SocialPublicationCard reference={reference} tenantId={reference.tenant_id} account={account}/>);await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("could not be read"));expect(screen.queryByText("Changed content")).toBeNull();});
 it("waits for the protected exact preview before offering original Approve",async()=>{let finish!:(v:unknown)=>void;mocks.invoke.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const approved=vi.fn();await mount(<SocialApprovalReview reference={reference} tenantId={reference.tenant_id} account={account} fingerprint={fingerprint} summary="Model sentence" onApprove={approved} onDeny={vi.fn()}/>);expect(screen.queryByRole("button",{name:/Approve/})).toBeNull();finish({data:preview(),error:null});await screen.findByText("Verified original destination · threads");expect(screen.getByText(/Exact approved words/).textContent).toBe("Exact approved words\n\nSecond paragraph");fireEvent.click(screen.getByRole("button",{name:/Approve/}));expect(approved).toHaveBeenCalledWith([fingerprint]);expect(mocks.invoke).toHaveBeenCalledTimes(1);expect(mocks.invoke.mock.calls[0][1].body.action).toBe("approval_read");});
 it("never offers approval after a refused or expired original read",async()=>{mocks.invoke.mockResolvedValue({data:{ok:false,code:"SOCIAL_APPROVAL_CHANGED"},error:null});await mount(<SocialApprovalReview reference={reference} tenantId={reference.tenant_id} account={account} fingerprint={fingerprint} summary="Proposal" onApprove={vi.fn()} onDeny={vi.fn()}/>);await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("could not be verified"));expect(screen.queryByRole("button",{name:/Approve/})).toBeNull();});
});
