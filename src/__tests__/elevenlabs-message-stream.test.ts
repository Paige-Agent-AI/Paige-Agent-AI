/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VOICE="g6xIsTj2HwM6VR4iXFCw";
let transport: ReturnType<typeof vi.fn>;
beforeEach(()=>{
  vi.resetModules();
  vi.stubGlobal("Deno",{env:{get:(key:string)=>key==="ELEVENLABS_API_KEY"?"synthetic-provider-key":undefined,toObject:()=>({})}});
  transport=vi.fn();vi.stubGlobal("fetch",transport);
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("existing ElevenLabs adapter message streaming",()=>{
  it("returns the same MPEG stream without waiting for its tail or changing approved selection",async()=>{
    let body!:ReadableStreamDefaultController<Uint8Array>;
    const response=new Response(new ReadableStream<Uint8Array>({start(c){body=c;c.enqueue(new Uint8Array([1,2]));}}),{headers:{"Content-Type":"audio/mpeg"}});
    transport.mockResolvedValue(response);
    const adapter=await import("../../supabase/functions/_shared/elevenlabs.ts");
    const abort=new AbortController();
    const result=await adapter.elevenlabsMessageStream({text:"Synthetic spoken answer",voiceId:VOICE,modelId:"eleven_v3_conversational"},abort.signal);
    expect(result).toBe(response);expect(transport).toHaveBeenCalledTimes(1);
    const [url,options]=transport.mock.calls[0];
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/stream?enable_logging=false&output_format=mp3_44100_128`);
    expect(options.signal).toBe(abort.signal);expect(options.headers.accept).toBe("audio/mpeg");
    expect(JSON.parse(options.body)).toEqual({text:"Synthetic spoken answer",model_id:"eleven_v3_conversational"});
    body.close();
  });
  it("refuses a caller-selected voice before dispatch",async()=>{
    const {elevenlabsMessageStream}=await import("../../supabase/functions/_shared/elevenlabs.ts");
    await expect(elevenlabsMessageStream({text:"Synthetic",voiceId:"unapproved"},new AbortController().signal)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("refuses an unapproved model without substituting one",async()=>{
    const {elevenlabsMessageStream}=await import("../../supabase/functions/_shared/elevenlabs.ts");
    await expect(elevenlabsMessageStream({text:"Synthetic",voiceId:VOICE,modelId:"unapproved"},new AbortController().signal)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not dispatch an already cancelled request",async()=>{
    const {elevenlabsMessageStream}=await import("../../supabase/functions/_shared/elevenlabs.ts");
    const abort=new AbortController();abort.abort();
    await expect(elevenlabsMessageStream({text:"Synthetic",voiceId:VOICE},abort.signal)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects a successful non-audio body and cancels it without retry",async()=>{
    const cancel=vi.fn();transport.mockResolvedValue(new Response(new ReadableStream({cancel}),{headers:{"Content-Type":"application/json"}}));
    const {elevenlabsMessageStream}=await import("../../supabase/functions/_shared/elevenlabs.ts");
    await expect(elevenlabsMessageStream({text:"Synthetic",voiceId:VOICE},new AbortController().signal)).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);expect(transport).toHaveBeenCalledTimes(1);
  });
});
