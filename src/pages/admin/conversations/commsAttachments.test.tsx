import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommsAttachments, type CommsAttachmentsApi } from "./inbox-shared";

const ports=vi.hoisted(()=>({upload:vi.fn(),remove:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{storage:{from:()=>ports}}}));
vi.mock("sonner",()=>({toast:{error:vi.fn()}}));
const TENANT="6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const original={url:`${TENANT}/0c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f-original.txt`,name:"original.txt",mime:"text/plain",size:8};
let api:CommsAttachmentsApi;
let cleanup:(()=>void)|undefined;
const flush=async()=>{await act(async()=>{await Promise.resolve()})};
async function mount(){
 const host=document.createElement("div");document.body.appendChild(host);const root=createRoot(host);
 function Harness(){api=useCommsAttachments(()=>TENANT);return null}
 await act(async()=>{root.render(<Harness/>)});
 cleanup=()=>{root.unmount();host.remove()};
}
function deferred(){let resolve!:(value:{data:null;error:null})=>void;const promise=new Promise<{data:null;error:null}>(r=>{resolve=r});return{promise,resolve}}
beforeEach(()=>{ports.upload.mockReset().mockResolvedValue({data:null,error:null});ports.remove.mockReset().mockResolvedValue({data:null,error:null})});
afterEach(async()=>{await act(async()=>cleanup?.());cleanup=undefined});

describe("original attachment hook retains saved-draft ownership",()=>{
 it("removing and cancelling borrowed original references never deletes their files",async()=>{
  await mount();const saved=[{...original}];act(()=>api.restore(saved));
  await act(async()=>api.removeAttachment(api.attachments[0]));expect(api.attachments).toEqual([]);expect(ports.remove).not.toHaveBeenCalled();
  act(()=>api.restore(saved));act(()=>api.reset());expect(api.attachments).toEqual([]);expect(ports.remove).not.toHaveBeenCalled();expect(saved).toEqual([original]);
 });
 it("new uploads still use the same bucket path and remove their own staged file",async()=>{
  await mount();act(()=>api.restore([original]));await act(async()=>api.uploadFiles([new File(["new content"],"new.txt",{type:"text/plain"})]));
  const owned=api.attachments.find(a=>a.name==="new.txt")!;expect(owned.url).toMatch(new RegExp(`^${TENANT}/[0-9a-f-]{36}-new.txt$`));
  await act(async()=>api.removeAttachment(owned));expect(ports.remove).toHaveBeenCalledWith([owned.url]);expect(api.attachments).toEqual([original]);
 });
 it("an old upload cannot stage into a restored draft or unlock its newer in-flight upload",async()=>{
  await mount();const old=deferred(),next=deferred();ports.upload.mockImplementationOnce(()=>old.promise).mockImplementationOnce(()=>next.promise);
  let first!:Promise<void>,second!:Promise<void>;
  act(()=>{first=api.uploadFiles([new File(["old"],"old.txt",{type:"text/plain"})])});await flush();
  act(()=>api.restore([original]));expect(api.uploading).toBe(false);
  act(()=>{second=api.uploadFiles([new File(["next"],"next.txt",{type:"text/plain"})])});await flush();expect(api.uploading).toBe(true);
  old.resolve({data:null,error:null});await act(async()=>first);expect(api.uploading).toBe(true);expect(api.attachments).toEqual([original]);
  expect(ports.remove.mock.calls.flatMap(([paths])=>paths)).toEqual([ports.upload.mock.calls[0][0]]);
  next.resolve({data:null,error:null});await act(async()=>second);expect(api.uploading).toBe(false);expect(api.attachments.map(a=>a.name)).toEqual(["original.txt","next.txt"]);
 });
});
