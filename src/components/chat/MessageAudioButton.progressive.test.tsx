import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageAudioButton } from "./MessageAudioButton";
import { messageTts } from "@/lib/voice/messageTts";
const state=vi.hoisted(()=>({fetch:vi.fn(),error:vi.fn(),message:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{getSession:async()=>({data:{session:{access_token:"synthetic-not-a-credential"}}})}}}));
vi.mock("sonner",()=>({toast:{error:state.error,message:state.message}}));
let root:Root;let host:HTMLDivElement;
beforeEach(()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;state.fetch.mockReset();state.error.mockReset();state.message.mockReset();
 vi.stubGlobal("fetch",state.fetch);vi.stubGlobal("MediaSource",undefined);
 vi.stubGlobal("Audio",function(){return {src:"",currentTime:0,play:vi.fn(async()=>{}),pause:vi.fn(),removeAttribute:vi.fn(),load:vi.fn()};});
 vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:synthetic-playback");vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>{messageTts.stop();root.unmount();});host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function render(){await act(async()=>root.render(<MessageAudioButton messageId="synthetic-message" content="Synthetic message for controller integration."/>));}
describe("incumbent read-aloud button transport",()=>{
 it("keeps loading cancellable and aborts its one authenticated request",async()=>{
   let finish!:(value:Response)=>void;state.fetch.mockImplementation(()=>new Promise<Response>(r=>{finish=r;}));await render();
   await act(async()=>host.querySelector('button')!.click());
   const options=state.fetch.mock.calls[0][1] as RequestInit;
   expect(options.signal?.aborted).toBe(false);expect(options.headers).toHaveProperty("Idempotency-Key");
   const stop=host.querySelector('[aria-label="Stop loading voice"]') as HTMLButtonElement;
   expect(stop.disabled).toBe(false);await act(async()=>stop.click());expect(options.signal?.aborted).toBe(true);
   await act(async()=>finish(new Response(new Uint8Array([1,2,3]),{headers:{"Content-Type":"audio/mpeg"}})));
   expect(URL.createObjectURL).not.toHaveBeenCalled();expect(state.fetch).toHaveBeenCalledTimes(1);expect(messageTts.getSnapshot().activeId).toBeNull();
 });
 it("preserves an allowance refusal without disabling voice as unconfigured",async()=>{
   state.fetch.mockResolvedValue(new Response(JSON.stringify({error:"tts_tenant_cost_limit"}),{status:429,headers:{"Content-Type":"application/json"}}));
   await render();await act(async()=>host.querySelector('button')!.click());
   expect(state.message).toHaveBeenCalledTimes(1);expect(state.error).not.toHaveBeenCalled();expect(messageTts.getSnapshot().needsConfig).toBe(false);expect(URL.createObjectURL).not.toHaveBeenCalled();
 });
 it("passes the successful raw response to the same controller with one request",async()=>{
   state.fetch.mockResolvedValue(new Response(new Uint8Array([1,2,3]),{headers:{"Content-Type":"audio/mpeg"}}));
   await render();await act(async()=>host.querySelector('button')!.click());expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
   expect(state.fetch).toHaveBeenCalledTimes(1);expect(host.querySelector('[aria-label="Stop playback"]')).toBeTruthy();
 });
 it("cancels owned loading output when its message leaves the workspace",async()=>{
   let finish!:(value:Response)=>void;state.fetch.mockImplementation(()=>new Promise<Response>(r=>{finish=r;}));await render();await act(async()=>host.querySelector('button')!.click());
   const signal=(state.fetch.mock.calls[0][1] as RequestInit).signal!;await act(async()=>root.render(null));expect(signal.aborted).toBe(true);expect(messageTts.getSnapshot().activeId).toBeNull();
   await act(async()=>finish(new Response(new Uint8Array([1]),{headers:{"Content-Type":"audio/mpeg"}})));expect(URL.createObjectURL).not.toHaveBeenCalled();
 });
 it("does not stop another message during old-message cleanup",async()=>{
   await render();await act(async()=>{await messageTts.toggle("other-conversation",async()=>new Blob(["other"]));});
   await act(async()=>root.render(null));expect(messageTts.getSnapshot().activeId).toBe("other-conversation");
 });

});
