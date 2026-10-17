import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
class FakeBuffer extends EventTarget {
  updating = false;
  chunks: Uint8Array[] = [];
  appendBuffer(bytes: Uint8Array) { this.updating=true;this.chunks.push(bytes);queueMicrotask(()=>{this.updating=false;this.dispatchEvent(new Event("updateend"));}); }
}
class FakeMediaSource extends EventTarget {
  static isTypeSupported=vi.fn(()=>true);
  static instances: FakeMediaSource[]=[];
  readyState="closed";
  buffer=new FakeBuffer();
  constructor(){super();FakeMediaSource.instances.push(this);}
  addSourceBuffer=vi.fn(()=>this.buffer);
  endOfStream=vi.fn(()=>{this.readyState="ended";});
}
let audio: {src:string;currentTime:number;paused:boolean;play:ReturnType<typeof vi.fn>;pause:ReturnType<typeof vi.fn>;removeAttribute:ReturnType<typeof vi.fn>;load:ReturnType<typeof vi.fn>;onerror?:()=>void;onwaiting?:()=>void;onplaying?:()=>void};
let urls: unknown[];
beforeEach(()=>{
  vi.resetModules();FakeMediaSource.instances=[];FakeMediaSource.isTypeSupported.mockReturnValue(true);urls=[];
  audio={src:"",currentTime:0,paused:true,play:vi.fn(async()=>{audio.paused=false;}),pause:vi.fn(()=>{audio.paused=true;}),removeAttribute:vi.fn(),load:vi.fn()};
  vi.stubGlobal("Audio",function(){return audio;});vi.stubGlobal("MediaSource",FakeMediaSource);
  vi.spyOn(URL,"createObjectURL").mockImplementation(value=>{urls.push(value);if(value instanceof FakeMediaSource)queueMicrotask(()=>{value.readyState="open";value.dispatchEvent(new Event("sourceopen"));});return `blob:synthetic-${urls.length}`;});
  vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("existing message controller progressive response",()=>{
 it("starts from appended audio before the HTTP body ends",async()=>{
   const {messageTts}=await import("./messageTts");let body!:ReadableStreamDefaultController<Uint8Array>;
   const response=new Response(new ReadableStream<Uint8Array>({start(c){body=c;}}),{headers:{"Content-Type":"audio/mpeg"}});
   const playing=messageTts.toggle("stream",async()=>response);
   await flush();body.enqueue(new Uint8Array([255,251,1,2]));await flush();
   expect(FakeMediaSource.instances[0]?.buffer.chunks).toHaveLength(1);
   expect(audio.play).toHaveBeenCalledTimes(1);expect(messageTts.getSnapshot().status).toBe("playing");
   body.close();await playing;expect(FakeMediaSource.instances[0].endOfStream).toHaveBeenCalledTimes(1);messageTts.stop();
 });
 it("falls back to one complete Blob from the SAME response when MPEG streaming is unsupported",async()=>{
   FakeMediaSource.isTypeSupported.mockReturnValue(false);const {messageTts}=await import("./messageTts");
   const response=new Response(new Uint8Array([1,2,3]),{headers:{"Content-Type":"audio/mpeg"}});
   const readBody=vi.spyOn(response,"blob");const fetchAudio=vi.fn(async()=>response);
   await messageTts.toggle("fallback",fetchAudio);expect(fetchAudio).toHaveBeenCalledTimes(1);expect(readBody).toHaveBeenCalledTimes(1);
   // Node20's Response owns a different Blob constructor from jsdom. Verify the
   // actual same-response artifact and bytes, not a test-environment realm.
   const artifact=await readBody.mock.results[0].value;
   expect(urls).toEqual([artifact]);expect(urls[0]).toBe(artifact);expect(artifact.type).toBe("audio/mpeg");
   expect(Array.from(new Uint8Array(await artifact.arrayBuffer()))).toEqual([1,2,3]);messageTts.stop();
 });
 it("aborts the original request and cancels its reader synchronously on Stop",async()=>{
   const {messageTts}=await import("./messageTts");let signal:AbortSignal|undefined;const cancel=vi.fn();
   const response=new Response(new ReadableStream<Uint8Array>({cancel}),{headers:{"Content-Type":"audio/mpeg"}});
   const playing=messageTts.toggle("cancel",async(s?:AbortSignal)=>{signal=s;return response;});await flush();
   messageTts.stop();await playing;expect(signal?.aborted).toBe(true);expect(cancel).toHaveBeenCalled();expect(audio.paused).toBe(true);expect(messageTts.getSnapshot().activeId).toBeNull();
 });
 it("does not stop a newer owner when an earlier play promise resolves late",async()=>{
   const {messageTts}=await import("./messageTts");let finish!:()=>void;
   audio.play.mockImplementationOnce(()=>new Promise<void>(r=>{finish=r;}));
   const first=messageTts.toggle("old",async()=>new Blob(["old"]));await flush();
   await messageTts.toggle("new",async()=>new Blob(["new"]));finish();await first;
   expect(messageTts.getSnapshot().activeId).toBe("new");expect(messageTts.getSnapshot().status).toBe("playing");messageTts.stop();
 });
 it("rejects a non-audio success body without creating output",async()=>{
   const {messageTts}=await import("./messageTts");const failed=vi.fn();
   await messageTts.toggle("invalid",async()=>new Response("{}",{headers:{"Content-Type":"application/json"}}),failed);
   expect(failed).toHaveBeenCalledTimes(1);expect(urls).toHaveLength(0);expect(messageTts.getSnapshot().status).toBe("idle");
 });
 it("keeps Hold over late progressive play and resumes without another request",async()=>{
   const {messageTts}=await import("./messageTts");let body!:ReadableStreamDefaultController<Uint8Array>;let finish!:()=>void;
   audio.play.mockImplementationOnce(()=>new Promise<void>(r=>{finish=r;}));
   const fetchAudio=vi.fn(async()=>new Response(new ReadableStream<Uint8Array>({start(c){body=c;}}),{headers:{"Content-Type":"audio/mpeg"}}));
   const playing=messageTts.toggle("hold",fetchAudio);await flush();body.enqueue(new Uint8Array([255,251,1]));await flush();
   messageTts.pause();finish();await flush();expect(messageTts.getSnapshot().status).toBe("paused");expect(audio.paused).toBe(true);
   await messageTts.resume();expect(messageTts.getSnapshot().status).toBe("playing");expect(fetchAudio).toHaveBeenCalledTimes(1);body.close();await playing;messageTts.stop();
 });
 it("ignores a fetch which resolves after stop and a newer message",async()=>{
   const {messageTts}=await import("./messageTts");let finish!:(value:Blob)=>void;
   const old=messageTts.toggle("old-fetch",()=>new Promise<Blob>(r=>{finish=r;}));await flush();
   await messageTts.toggle("current",async()=>new Blob(["current"]));finish(new Blob(["obsolete"]));await old;
   expect(urls).toHaveLength(1);expect(messageTts.getSnapshot().activeId).toBe("current");messageTts.stop();
 });
 it("reports interrupted stream failure once and releases output without refetch",async()=>{
   const {messageTts}=await import("./messageTts");let body!:ReadableStreamDefaultController<Uint8Array>;const failed=vi.fn();
   const fetchAudio=vi.fn(async()=>new Response(new ReadableStream<Uint8Array>({start(c){body=c;}}),{headers:{"Content-Type":"audio/mpeg"}}));
   const playing=messageTts.toggle("broken",fetchAudio,failed);await flush();body.enqueue(new Uint8Array([255,251,1]));await flush();body.error(new Error("synthetic network failure"));await playing;
   expect(failed).toHaveBeenCalledTimes(1);expect(fetchAudio).toHaveBeenCalledTimes(1);expect(messageTts.getSnapshot().status).toBe("idle");expect(audio.paused).toBe(true);
 });

 it("detaches the old media without an empty-src request and fences old event callbacks",async()=>{
   const {messageTts}=await import("./messageTts");await messageTts.toggle("before",async()=>new Blob(["first"]));const staleError=audio.onerror;
   messageTts.stop();expect(audio.removeAttribute).toHaveBeenCalledWith("src");expect(audio.load).toHaveBeenCalled();
   await messageTts.toggle("after",async()=>new Blob(["next"]));staleError?.();expect(messageTts.getSnapshot().activeId).toBe("after");messageTts.stop();
 });
 it("reports actual buffer waiting and playing events without refetching",async()=>{
   const {messageTts}=await import("./messageTts");const fetchAudio=vi.fn(async()=>new Blob(["audio"]));await messageTts.toggle("waiting",fetchAudio);
   audio.onwaiting?.();expect(messageTts.getSnapshot().status).toBe("loading");audio.onplaying?.();expect(messageTts.getSnapshot().status).toBe("playing");expect(fetchAudio).toHaveBeenCalledTimes(1);messageTts.stop();
 });

 it("measures the first consumed chunk and actual playing event once, without private identifiers",async()=>{
   let clock=10;const measure=vi.fn();vi.stubGlobal("performance",{now:()=>clock,measure});
   const {messageTts}=await import("./messageTts");let body!:ReadableStreamDefaultController<Uint8Array>;
   const response=new Response(new ReadableStream<Uint8Array>({start(c){body=c;}}),{headers:{"Content-Type":"audio/mpeg"}});
   const playing=messageTts.toggle("private-message-not-a-metric",async()=>response);await flush();
   clock=25;body.enqueue(new Uint8Array([255,251,1]));await flush();
   clock=40;audio.onplaying?.();clock=50;audio.onplaying?.();
   expect(measure.mock.calls.filter(([name])=>name==="paige.voice.message.first_chunk")).toHaveLength(1);
   const started=measure.mock.calls.filter(([name])=>name==="paige.voice.message.first_playback");expect(started).toHaveLength(1);
   expect(started[0][1]).toMatchObject({start:10,end:40,detail:{transport:"progressive"}});
   expect(JSON.stringify(measure.mock.calls)).not.toContain("private-message-not-a-metric");
   clock=65;body.close();await playing;expect(measure.mock.calls.filter(([name])=>name==="paige.voice.message.body_complete")).toHaveLength(1);messageTts.stop();
 });

 it("does not invent first-chunk timing for a complete-response fallback",async()=>{
   const measure=vi.fn();vi.stubGlobal("performance",{now:()=>20,measure});FakeMediaSource.isTypeSupported.mockReturnValue(false);
   const {messageTts}=await import("./messageTts");await messageTts.toggle("fallback-metric",async()=>new Response(new Uint8Array([1]),{headers:{"Content-Type":"audio/mpeg"}}));audio.onplaying?.();
   expect(measure.mock.calls.filter(([name])=>name==="paige.voice.message.first_chunk")).toHaveLength(0);
   expect(measure.mock.calls.filter(([name])=>name==="paige.voice.message.body_complete")).toHaveLength(1);
   expect(measure.mock.calls.find(([name])=>name==="paige.voice.message.first_playback")?.[1].detail.transport).toBe("buffered");messageTts.stop();
 });

 it("never breaks playback when browser performance measurement is unavailable",async()=>{
   vi.stubGlobal("performance",{now:()=>10,measure:()=>{throw new Error("synthetic unavailable timing");}});
   const {messageTts}=await import("./messageTts");await messageTts.toggle("timing-unavailable",async()=>new Blob(["audio"]));audio.onplaying?.();
   expect(messageTts.getSnapshot().status).toBe("playing");messageTts.stop();
 });

 it("identifies intentional Hold and rejects stale playing measurements from an old owner",async()=>{
   const measure=vi.fn();vi.stubGlobal("performance",{now:()=>30,measure});
   const {messageTts}=await import("./messageTts");await messageTts.toggle("old-private-message",async()=>new Blob(["old"]));const stalePlaying=audio.onplaying;
   await messageTts.toggle("new-private-message",async()=>new Blob(["new"]));stalePlaying?.();
   expect(measure.mock.calls.filter(([name])=>name==="paige.voice.message.first_playback")).toHaveLength(0);
   messageTts.pause();await messageTts.resume();audio.onplaying?.();audio.onplaying?.();
   const first=measure.mock.calls.filter(([name])=>name==="paige.voice.message.first_playback");expect(first).toHaveLength(1);expect(first[0][1].detail.held).toBe(true);
   expect(JSON.stringify(measure.mock.calls)).not.toContain("private-message");messageTts.stop();
 });

 it("correlates only finite allowlisted server durations from the same response",async()=>{
   const measure=vi.fn();vi.stubGlobal("performance",{now:()=>30,measure});FakeMediaSource.isTypeSupported.mockReturnValue(false);
   const {messageTts}=await import("./messageTts");
   await messageTts.toggle("safe-timing",async()=>new Response(new Uint8Array([1]),{headers:{"Content-Type":"audio/mpeg","Server-Timing":"voice_first_byte;dur=12, voice_ready;dur=20, customer_secret;dur=44, voice_cache;dur=-9, voice_settlement;dur=999999999999"}}));audio.onplaying?.();
   const detail=measure.mock.calls.find(([name])=>name==="paige.voice.message.first_playback")?.[1].detail;
   expect(detail.serverTiming).toEqual({voice_first_byte:12,voice_ready:20});expect(JSON.stringify(measure.mock.calls)).not.toContain("customer_secret");messageTts.stop();
 });

 it.each([
   "voice_ready;dur=10, voice_ready;dur=20",
   "voice_ready;dur=10, "+"x".repeat(2048),
 ])("does not attribute ambiguous or oversized server timing (%#)",async(header)=>{
   const measure=vi.fn();vi.stubGlobal("performance",{now:()=>30,measure});FakeMediaSource.isTypeSupported.mockReturnValue(false);
   const {messageTts}=await import("./messageTts");
   await messageTts.toggle("bounded-timing",async()=>new Response(new Uint8Array([1]),{headers:{"Content-Type":"audio/mpeg","Server-Timing":header}}));audio.onplaying?.();
   expect(measure.mock.calls.find(([name])=>name==="paige.voice.message.first_playback")?.[1].detail.serverTiming).toEqual({});messageTts.stop();
 });

});
