import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter,Route,Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ContentPiece } from "./marketing-content-model";
import type { SocialDeskPost } from "./social-publishing-model";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ actor:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",tenant:"11111111-1111-4111-8111-111111111111",read: vi.fn(), save: vi.fn(), recover: vi.fn(), pending: vi.fn(), performance:vi.fn(), published: [] as string[], opens: 0,plansOpened:0, recorded: undefined as ((id:string)=>void)|undefined }));
vi.mock("@/hooks/useTenantContext",()=>({useTenantContext:()=>({activeUserId:h.actor,activeTenantId:h.tenant,loading:false,accountContextLoading:false})}));
vi.mock("./content-calendar",()=>({ContentCalendar:({onOpenPiece}:{onOpenPiece:(id:string)=>void})=>{
  h.plansOpened++;return <div><p>Original unlinked planning note</p><button onClick={()=>onOpenPiece("22222222-2222-4222-8222-222222222222")}>Open original planned piece</button></div>;
}}));
vi.mock("./social-publishing-data", () => ({ readSocialDesk: h.read, saveSocialDraft: h.save, recoverSocialDraft: h.recover,
  readSocialPiece: vi.fn(), pendingSocialDraft: h.pending, checkSocialPerformance:h.performance, SOCIAL_LIBRARY_LIMIT: 100 }));
vi.mock("./publish-piece", () => ({ PUBLICATION_STATUS_WORDS: { published: "Published", outcome_unknown: "Needs check" },
  PublishPiece: ({ piece, onlyPublicationId, originalAttempt, onPublicationRecorded }: { piece?: ContentPiece; onlyPublicationId?: string; originalAttempt?: {contentId:string;publicationId:string}; onPublicationRecorded?:(id:string)=>void }) => {
    h.recorded=onPublicationRecorded;return <div data-publish-piece={piece?.id??originalAttempt?.contentId} data-reconcile-only={onlyPublicationId??originalAttempt?.publicationId}>{onlyPublicationId||originalAttempt ? "Check original attempt" : "Review exact saved post"}</div>;
  } }));
const { SocialPublishingDesk } = await import("./social-publishing-desk");
const T = "11111111-1111-4111-8111-111111111111", P = "22222222-2222-4222-8222-222222222222", R = "33333333-3333-4333-8333-333333333333";
const piece = { id:P,kind:"text",channel:"social_post",title:"Original post",body:"Saved literal *caption*",status:"draft",updated_at:"2026-11-13T12:00:00Z",meta:{media_content_ids:[]},image_url:null,size:null,brief:null };
const post: SocialDeskPost = { key:`content:${P}`,pieceId:P,receiptId:null,title:"Original post",caption:piece.body,platform:"threads",destination:null,status:"draft",url:null,updatedAt:piece.updated_at,revision:piece.updated_at,media:[],performance:{state:"unavailable",checkedAt:null,values:{}} };
const recordedPost = {...post,key:`publication:${R}`,receiptId:R,status:"outcome_unknown"};
let host: HTMLDivElement, root: Root;
async function render(path="/solo/123/growth/social", tenant=T, manage=true) {
  h.tenant=tenant;
  await act(async()=>root.render(<MemoryRouter initialEntries={[path]}><SocialPublishingDesk key={tenant} tenantId={tenant} canManage={manage} onOpenStudio={()=>h.opens++} onAskPaige={()=>h.opens++}/></MemoryRouter>));
}
function button(label:string) { const b=[...host.querySelectorAll("button")].find(b=>b.textContent?.includes(label) || b.getAttribute("aria-label")===label);if(!b)throw Error(`No button ${label}`);return b; }
async function click(label:string) { await act(async()=>button(label).click()); }
beforeEach(()=>{ h.actor="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";h.tenant=T;h.read.mockReset().mockResolvedValue({pieces:[piece],posts:[post]});h.save.mockReset();h.recover.mockReset();h.pending.mockReset().mockReturnValue(null);h.opens=0;h.plansOpened=0;host=document.createElement("div");document.body.append(host);root=createRoot(host); });
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});
it("preserves the original linked and unlinked plans on demand without reading the planner while closed",async()=>{
  await render();expect(h.plansOpened).toBe(0);expect(host.textContent).not.toContain("Original unlinked planning note");
  const plans=host.querySelector<HTMLDetailsElement>(".sdesk-saved-plans")!;
  await act(async()=>{plans.open=true;plans.dispatchEvent(new Event("toggle"));});
  expect(h.plansOpened).toBeGreaterThan(0);expect(host.textContent).toContain("Original unlinked planning note");
  await click("Open original planned piece");expect(host.querySelector("textarea")?.value).toBe(piece.body);expect(h.save).not.toHaveBeenCalled();
});
it("returns to the same native Hub message and preserves a dirty draft when discarding is refused",async()=>{
 const message="44444444-4444-4444-8444-444444444444";
 await act(async()=>root.render(<MemoryRouter initialEntries={[`/solo/1234567/growth/social?social_piece=${P}&social_return_message=${message}`]}><Routes>
  <Route path="/solo/:account/growth/social" element={<SocialPublishingDesk tenantId={T} canManage onOpenStudio={()=>{}} onAskPaige={()=>{}}/>}/>
  <Route path="/solo/:account/team-hub" element={<p>Original conversation</p>}/>
 </Routes></MemoryRouter>));
 const caption=host.querySelector("textarea")!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(caption,"Unsaved original caption");caption.dispatchEvent(new Event("input",{bubbles:true}));});
 const back=[...host.querySelectorAll("a")].find(a=>a.textContent==="Return to conversation")!;expect(back.getAttribute("href")).toBe(`/solo/1234567/team-hub?message=${message}`);
 const discard=vi.spyOn(window,"confirm").mockReturnValue(false);await act(async()=>back.click());expect(host.querySelector("textarea")!.value).toBe("Unsaved original caption");
 discard.mockReturnValue(true);await act(async()=>back.click());expect(host.textContent).toBe("Original conversation");
});
it("opens the real original post link, minimizes and reopens the same unsaved editor without a write",async()=>{
  await render(`/solo/123/growth/social?social_piece=${P}`);
  const caption=host.querySelector("textarea")!;
  expect(caption.value).toBe(piece.body);
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(caption,"My unsaved caption");caption.dispatchEvent(new Event("input",{bubbles:true}));});
  await click("Minimize workspace");expect(host.querySelector(".sdesk-workspace")).toBeNull();
  await click("Reopen Original post");expect(host.querySelector("textarea")!.value).toBe("My unsaved caption");
  expect(h.save).not.toHaveBeenCalled();expect(host.textContent).not.toContain("Review exact saved post");
});
it("reopens an original terminal receipt with historic caption and real measured zero; no publish control",async()=>{
  h.read.mockResolvedValue({pieces:[piece],posts:[{...post,key:`publication:${R}`,receiptId:R,status:"published",caption:"Historic caption",url:"https://www.threads.com/@example/post/one",performance:{state:"available",checkedAt:piece.updated_at,values:{views:0,likes:2}}}]});
  await render(`/solo/123/growth/social?social_piece=${P}&publication=${R}`);
  expect(host.querySelector(".sdesk-workspace")!.textContent).toContain("Historic caption");
  expect(host.querySelector(".sdesk-workspace")!.textContent).not.toContain(piece.body);
  await click("Result");expect(host.querySelector("dd")!.textContent).toBe("0");expect(host.querySelector("[data-publish-piece]")).toBeNull();
});
it("unknown result uses only the existing original-attempt check, never a second publish form",async()=>{
  h.read.mockResolvedValue({pieces:[piece],posts:[{...post,key:`publication:${R}`,receiptId:R,status:"outcome_unknown"}]});
  await render(`/solo/123/growth/social?social_piece=${P}&publication=${R}`);await click("Result");
  expect(host.querySelector("[data-reconcile-only]")!.getAttribute("data-reconcile-only")).toBe(R);expect(h.save).not.toHaveBeenCalled();
});
it("does not turn failed reads into an empty library or a metric zero",async()=>{
  h.read.mockRejectedValue(Error("read refused"));await render();expect(host.textContent).toContain("Your posts could not be read");expect(host.textContent).not.toContain("Your next post starts here");expect(host.querySelector("dd")).toBeNull();
});
it("read-only members have no create/editor/library control",async()=>{
  h.read.mockResolvedValue({pieces:[],posts:[]});await render("/solo/123/growth/social",T,false);expect(host.textContent).not.toContain("Create post");expect(host.querySelector("textarea")).toBeNull();expect(h.read).toHaveBeenCalledWith(T,false,null);
});
it("cannot start another draft while the original save is unconfirmed",async()=>{
  h.pending.mockReturnValue("saved-key");await render();await click("Create post");expect(host.querySelector("textarea")).toBeNull();expect(h.save).not.toHaveBeenCalled();expect(host.textContent).toContain("Check the same save");
});
it("ignores a late workspace read after moving to another tenant",async()=>{
  let settle!:(v:unknown)=>void;h.read.mockReturnValueOnce(new Promise(r=>{settle=r;}));await render();
  h.read.mockResolvedValue({pieces:[],posts:[]});await render("/solo/123/growth/social","99999999-9999-4999-8999-999999999999");
  await act(async()=>settle({pieces:[piece],posts:[post]}));expect(host.textContent).not.toContain("Original post");
});
it("keeps the exact new original attempt selected after the publisher refreshes the gallery",async()=>{
  await render(`/solo/123/growth/social?social_piece=${P}`);
  h.read.mockResolvedValue({pieces:[piece],posts:[recordedPost]});
  await act(async()=>h.recorded?.(R));
  expect(host.querySelector(".sdesk-workspace")!.textContent).not.toContain("Original post unavailable");
  await click("Result");expect(host.querySelector("[data-reconcile-only]")!.getAttribute("data-reconcile-only")).toBe(R);
});
it("re-reads a newly returned Chat or Hub receipt when its original piece is already open",async()=>{
 function OpenReceipt(){const go=useNavigate();return <button onClick={()=>go(`/solo/123/growth/social?social_piece=${P}&publication=${R}`)}>Open returned receipt</button>;}
 await act(async()=>root.render(<MemoryRouter initialEntries={[`/solo/123/growth/social?social_piece=${P}`]}><OpenReceipt/><SocialPublishingDesk tenantId={T} canManage onOpenStudio={()=>{}} onAskPaige={()=>{}}/></MemoryRouter>));
 h.read.mockResolvedValue({pieces:[piece],posts:[recordedPost]});await click("Open returned receipt");
 expect(h.read).toHaveBeenCalledTimes(2);expect(host.textContent).not.toContain("Original post unavailable");
 await click("Result");expect(host.querySelector("[data-reconcile-only]")?.getAttribute("data-reconcile-only")).toBe(R);
});
it("checks the original unknown receipt even when the editable source is archived or absent",async()=>{
  h.read.mockResolvedValue({pieces:[],posts:[recordedPost]});await render(`/solo/123/growth/social?social_piece=${P}&publication=${R}`);await click("Result");
  expect(host.textContent).toContain("Check original attempt");expect(host.querySelector("[data-reconcile-only]")!.getAttribute("data-reconcile-only")).toBe(R);
});
it("focuses the reachable reopen control when a deep-linked workspace is minimized",async()=>{
  await render(`/solo/123/growth/social?social_piece=${P}`);await click("Minimize workspace");expect(document.activeElement).toBe(button("Reopen Original post"));
});
it("history Back retains the dirty original caption when discard is refused",async()=>{
  const second="44444444-4444-4444-8444-444444444444";
  h.read.mockResolvedValue({pieces:[piece,{...piece,id:second,title:"Second post",body:"Second saved caption"}],posts:[post,{...post,key:`content:${second}`,pieceId:second,title:"Second post",caption:"Second saved caption"}]});
  function Back(){const go=useNavigate();return <button onClick={()=>go(-1)}>History Back</button>;}
  vi.spyOn(window,"confirm").mockReturnValue(false);
  await act(async()=>root.render(<MemoryRouter initialEntries={[`/?social_piece=${P}`,`/?social_piece=${second}`]} initialIndex={1}><Back/><SocialPublishingDesk tenantId={T} canManage onOpenStudio={()=>{}} onAskPaige={()=>{}}/></MemoryRouter>));
  const caption=host.querySelector("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(caption,"Dirty second caption");caption.dispatchEvent(new Event("input",{bubbles:true}));});
  await click("History Back");expect(window.confirm).toHaveBeenCalled();expect(host.querySelector("textarea")!.value).toBe("Dirty second caption");
});
it("does not let the prior draft save steal an accepted newer post selection",async()=>{
 const second="44444444-4444-4444-8444-444444444444",other={...piece,id:second,title:"Second post",body:"Second saved caption"};
 h.read.mockResolvedValue({pieces:[piece,other],posts:[post,{...post,key:`content:${second}`,pieceId:second,title:other.title,caption:other.body}]});
 let finish!:(value:ContentPiece)=>void;h.save.mockReturnValue(new Promise(resolve=>{finish=resolve;}));vi.spyOn(window,"confirm").mockReturnValue(true);
 await render(`/solo/123/growth/social?social_piece=${P}`);const caption=host.querySelector("textarea")!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(caption,"Edited first caption");caption.dispatchEvent(new Event("input",{bubbles:true}));});
 await click("Save draft");await click("Second post");expect(host.querySelector(".sdesk-workspace h3")?.textContent).toContain("Second post");
 await act(async()=>finish({...piece,body:"Edited first caption",updated_at:"2026-11-14T12:00:00Z"}));
 expect(host.querySelector(".sdesk-workspace h3")?.textContent).toContain("Second post");expect(host.querySelector("textarea")?.value).toBe(other.body);expect(h.save).toHaveBeenCalledTimes(1);
});
it("keeps the dirty editor mounted when an ordinary Marketing route exit is declined",async()=>{
 function Exit(){const go=useNavigate();return <button onClick={()=>go("/solo/123/growth/content")}>Marketing Content</button>;}
 vi.spyOn(window,"confirm").mockReturnValue(false);
 await act(async()=>root.render(<MemoryRouter initialEntries={[`/solo/123/growth/social?social_piece=${P}`]}><Routes>
  <Route path="/solo/:account/growth/social" element={<><Exit/><SocialPublishingDesk tenantId={T} canManage onOpenStudio={()=>{}} onAskPaige={()=>{}}/></>}/>
  <Route path="/solo/:account/growth/content" element={<p>Content destination</p>}/>
 </Routes></MemoryRouter>));
 const caption=host.querySelector("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(caption,"Keep this unsaved caption");caption.dispatchEvent(new Event("input",{bubbles:true}));});
 await click("Marketing Content");expect(window.confirm).toHaveBeenCalledTimes(1);expect(host.querySelector("textarea")?.value).toBe("Keep this unsaved caption");expect(host.textContent).not.toContain("Content destination");
});
it("asks once for an externally opened post before discarding the current editor",async()=>{
 const second="44444444-4444-4444-8444-444444444444",other={...piece,id:second,title:"Second post",body:"Second saved caption"};
 h.read.mockResolvedValue({pieces:[piece,other],posts:[post,{...post,key:`content:${second}`,pieceId:second,title:other.title,caption:other.body}]});
 function Next(){const go=useNavigate();return <button onClick={()=>go(`/solo/123/growth/social?social_piece=${second}`)}>Returned post link</button>;}
 vi.spyOn(window,"confirm").mockReturnValue(true);
 await act(async()=>root.render(<MemoryRouter initialEntries={[`/solo/123/growth/social?social_piece=${P}`]}><Next/><SocialPublishingDesk tenantId={T} canManage onOpenStudio={()=>{}} onAskPaige={()=>{}}/></MemoryRouter>));
 const caption=host.querySelector("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(caption,"Unsaved prior caption");caption.dispatchEvent(new Event("input",{bubbles:true}));});
 await click("Returned post link");expect(window.confirm).toHaveBeenCalledTimes(1);expect(host.querySelector(".sdesk-workspace h3")?.textContent).toContain("Second post");
});
