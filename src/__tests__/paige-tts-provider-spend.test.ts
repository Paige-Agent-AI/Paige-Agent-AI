/** @vitest-environment node */
// INT-324 Slice A — message playback reserves through the ONE voice-cost seam before EITHER
// provider is called. Drives the real paige-tts handler (supabase/functions/paige-tts/index.ts)
// with the Supabase clients and the provider adapters replaced by recording doubles, so the
// order of reserve → provider → settle is observed, not inferred from source text.
//
// Evidence class: automated (a handler drive against in-memory doubles). It is NOT a deployed
// edge run and NOT a database proof — the SQL side is supabase/tests/paige_voice_budget_control.sql.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Step = string;
type RpcResult = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  handler: null as ((request: Request) => Promise<Response>) | null,
  createClient: vi.fn(),
  synthesizeSpeechStream: vi.fn(),
  elevenlabsMessageStream: vi.fn(),
  planTtsSynthesis: vi.fn(),
  resolveProfileVoice: vi.fn(),
  ttsCacheKey: vi.fn(),
  upload: vi.fn(),
  meter: vi.fn(),
}));

vi.mock("https://deno.land/std@0.190.0/http/server.ts", () => ({
  serve: (handler: (request: Request) => Promise<Response>) => { h.handler = handler; },
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2.75.0", () => ({ createClient: h.createClient }));
vi.mock("../../supabase/functions/_shared/tts-router.ts", () => ({
  planTtsSynthesis: h.planTtsSynthesis,
  resolveProfileVoice: h.resolveProfileVoice,
  synthesizeSpeechStream: h.synthesizeSpeechStream,
  ttsCacheKey: h.ttsCacheKey,
}));
vi.mock("../../supabase/functions/_shared/elevenlabs.ts", () => ({ elevenlabsMessageStream: h.elevenlabsMessageStream }));

const USER = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const RESERVATION = "33333333-3333-4333-8333-333333333333";

const OPENAI = { provider: "openai", model: "gpt-4o-mini-tts", voice: "nova", profileRevision: "openai-r1" } as const;
const ELEVEN = { provider: "elevenlabs", model: "eleven_v3_conversational", voiceId: "voice-ref", profileRevision: "el-r1" } as const;

let log: Step[];
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
let cached: Blob | null;
let tenantFromJwt: string | null;
let reserveResult: RpcResult;
let settleResult: RpcResult;
let settleThrows: boolean;
// Taken from the SAME module registry the handler loaded after vi.resetModules(), so the handler's
// `e instanceof NeedsConfigError` sees the class this test throws (a top-level import would be a
// different class instance and would silently turn every typed failure into an ambiguous one).
let NeedsConfigError: typeof import("../../supabase/functions/_shared/provider-types.ts").NeedsConfigError;

function audioResponse(): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); },
  }), { status: 200 });
}

function setupClients() {
  h.createClient.mockImplementation((_url: string, key: string) => {
    if (key === "SUPABASE_ANON_KEY") {
      return {
        auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
        rpc: async (fn: string) => {
          if (fn === "current_user_tenant_id") return { data: tenantFromJwt, error: null };
          if (fn === "is_platform_admin") return { data: true, error: null };
          throw new Error(`unexpected authed rpc ${fn}`);
        },
      };
    }
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        if (fn === "resolve_paige_voice_profile_internal") {
          log.push("resolve");
          return { data: { provider: "x", provider_voice_ref: "y", revision: "r", approved: true, active: true }, error: null };
        }
        if (fn === "reserve_paige_voice_cost_internal") { log.push("reserve"); return reserveResult; }
        if (fn === "settle_paige_voice_cost_internal") { log.push(`settle:${String(args._outcome)}`); if(settleThrows)throw new Error("synthetic settlement transport failure"); return settleResult; }
        throw new Error(`unexpected admin rpc ${fn}`);
      },
      storage: {
        from: () => ({
          download: async () => { log.push("cache"); return { data: cached, error: null }; },
          upload: h.upload,
        }),
      },
      from: () => ({ insert: h.meter }),
    };
  });
}

function usePlan(attempt: typeof OPENAI | typeof ELEVEN) {
  h.resolveProfileVoice.mockReturnValue({
    provider: attempt.provider,
    id: attempt.provider === "openai" ? attempt.voice : attempt.voiceId,
    profileRevision: attempt.profileRevision,
  });
  h.planTtsSynthesis.mockReturnValue({ ok: true, attempts: [attempt] });
}

const play = (text = "Hello from Paige", signal?: AbortSignal) => h.handler!(new Request("https://edge.test/functions/v1/paige-tts", {
  method: "POST",
  headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
  body: JSON.stringify({ text }),
  signal,
}));

const reserveCalls = () => rpcCalls.filter((c) => c.fn === "reserve_paige_voice_cost_internal");
const settleCalls = () => rpcCalls.filter((c) => c.fn === "settle_paige_voice_cost_internal");

describe("INT-324 Slice A — paige-tts reserves before either provider", () => {
  beforeEach(async () => {
    vi.resetModules();
    h.handler = null;
    log = [];
    rpcCalls = [];
    cached = null;
    tenantFromJwt = TENANT;
    reserveResult = { data: { reservation_id: RESERVATION }, error: null };
    settleResult = { data: null, error: null };
    settleThrows = false;
    vi.stubGlobal("Deno", { env: { get: (name: string) => name } });
    for (const fn of [h.createClient, h.synthesizeSpeechStream, h.elevenlabsMessageStream, h.planTtsSynthesis, h.resolveProfileVoice, h.ttsCacheKey]) fn.mockReset();
    h.ttsCacheKey.mockResolvedValue("cache-key");
    h.upload.mockReset().mockResolvedValue({error:null});h.meter.mockReset().mockResolvedValue({error:null});
    h.synthesizeSpeechStream.mockImplementation(async () => { log.push("provider:openai"); return audioResponse(); });
    h.elevenlabsMessageStream.mockImplementation(async () => { log.push("provider:elevenlabs"); return audioResponse(); });
    setupClients();
    await vi.importActual("../../supabase/functions/paige-tts/index.ts");
    ({ NeedsConfigError } = await import("../../supabase/functions/_shared/provider-types.ts"));
    expect(h.handler).not.toBeNull();
  });

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("OpenAI: an uncached attempt reserves BEFORE the provider and commits once the provider answered", async () => {
    usePlan(OPENAI);
    const res = await play("Hello from Paige");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(log).toEqual(["resolve", "cache", "reserve", "provider:openai", "settle:committed"]);
    expect(reserveCalls()).toHaveLength(1);
    expect(reserveCalls()[0].args).toMatchObject({
      _actor_user_id: USER,
      _tenant_id: TENANT,
      _profile_revision: "openai-r1",
      _character_count: "Hello from Paige".length,
    });
    expect(settleCalls()[0].args).toEqual({ _reservation_id: RESERVATION, _actor_user_id: USER, _outcome: "committed" });
  });

  it("OpenAI: a refused reservation ends the request with its classified code and never calls the provider", async () => {
    usePlan(OPENAI);
    reserveResult = { data: null, error: { message: "PAIGE_VOICE_TENANT_COST_LIMIT", code: "54000", details: null, hint: null } };
    const res = await play();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "tts_tenant_cost_limit" });
    expect(h.synthesizeSpeechStream).not.toHaveBeenCalled();
    expect(settleCalls()).toHaveLength(0);
  });

  it("OpenAI: a reservation that returns no id is a refusal too — no provider call", async () => {
    usePlan(OPENAI);
    reserveResult = { data: {}, error: null };
    const res = await play();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "tts_cost_limit_unavailable" });
    expect(h.synthesizeSpeechStream).not.toHaveBeenCalled();
  });

  it("OpenAI: only a typed pre-dispatch NeedsConfigError releases the reservation", async () => {
    usePlan(OPENAI);
    h.synthesizeSpeechStream.mockImplementation(async () => { log.push("provider:openai"); throw new NeedsConfigError("openai"); });
    const res = await play();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "tts_synth_failed" });
    expect(log).toEqual(["resolve", "cache", "reserve", "provider:openai", "settle:released"]);
  });

  it("OpenAI: an ambiguous provider failure keeps the reservation counted (no settle at all)", async () => {
    usePlan(OPENAI);
    h.synthesizeSpeechStream.mockImplementation(async () => { log.push("provider:openai"); throw new Error("OpenAI speech 500: upstream"); });
    const res = await play();
    expect(res.status).toBe(502);
    expect(settleCalls()).toHaveLength(0);
    expect(log).toEqual(["resolve", "cache", "reserve", "provider:openai"]);
  });

  it("OpenAI: a failed commit fails closed with tts_cost_settlement_unavailable and returns no audio", async () => {
    usePlan(OPENAI);
    settleResult = { data: null, error: { code: "PGRST000", message: "upstream" } };
    const res = await play();
    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "tts_cost_settlement_unavailable" });
  });

  it("OpenAI: a cache hit never reserves and never calls the provider", async () => {
    usePlan(OPENAI);
    cached = new Blob([new Uint8Array([7, 7])]);
    const res = await play();
    expect(res.status).toBe(200);
    expect(reserveCalls()).toHaveLength(0);
    expect(h.synthesizeSpeechStream).not.toHaveBeenCalled();
  });

  it("OpenAI: platform staff without a tenant reserve against the platform budget only (null tenant)", async () => {
    usePlan(OPENAI);
    tenantFromJwt = null;
    const res = await play();
    expect(res.status).toBe(200);
    expect(reserveCalls()[0].args._tenant_id).toBeNull();
    expect(log).toEqual(["resolve", "cache", "reserve", "provider:openai", "settle:committed"]);
  });

  it("ElevenLabs (regression): unchanged order — reserve, provider, commit", async () => {
    usePlan(ELEVEN);
    const res = await play();
    expect(res.status).toBe(200);
    expect(log).toEqual(["resolve", "cache", "reserve", "provider:elevenlabs", "settle:committed"]);
    await res.arrayBuffer();
  });

  it("ElevenLabs (regression): a refused reservation still never calls the provider", async () => {
    usePlan(ELEVEN);
    reserveResult = { data: null, error: { message: "PAIGE_VOICE_PLATFORM_COST_LIMIT", code: "54000", details: null, hint: null } };
    const res = await play();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "tts_platform_cost_limit" });
    expect(h.elevenlabsMessageStream).not.toHaveBeenCalled();
  });

  it("ElevenLabs (regression): NeedsConfigError releases; an ambiguous failure does not", async () => {
    usePlan(ELEVEN);
    h.elevenlabsMessageStream.mockImplementationOnce(async () => { log.push("provider:elevenlabs"); throw new NeedsConfigError("elevenlabs"); });
    expect((await play()).status).toBe(502);
    expect(log.at(-1)).toBe("settle:released");
    log = []; rpcCalls = [];
    h.elevenlabsMessageStream.mockImplementationOnce(async () => { log.push("provider:elevenlabs"); throw new Error("ElevenLabs 500"); });
    expect((await play()).status).toBe(502);
    expect(settleCalls()).toHaveLength(0);
  });
  it("ElevenLabs streams its first chunk before EOF and caches only the complete artifact", async () => {
    usePlan(ELEVEN);let body!:ReadableStreamDefaultController<Uint8Array>;
    h.elevenlabsMessageStream.mockImplementation(async()=>{log.push("provider:elevenlabs");return new Response(new ReadableStream<Uint8Array>({start(c){body=c;c.enqueue(new Uint8Array([4,5]));}}));});
    const res=await play();expect(res.status).toBe(200);expect(h.upload).not.toHaveBeenCalled();
    const reader=res.body!.getReader();expect((await reader.read()).value).toEqual(new Uint8Array([4,5]));expect(h.upload).not.toHaveBeenCalled();
    body.enqueue(new Uint8Array([6]));body.close();expect((await reader.read()).value).toEqual(new Uint8Array([6]));expect((await reader.read()).done).toBe(true);
    await vi.waitFor(()=>expect(h.upload).toHaveBeenCalledTimes(1));
    expect(h.upload.mock.calls[0][0]).toBe(TENANT+"/cache-key.mp3");expect(h.upload.mock.calls[0][1]).toEqual(new Uint8Array([4,5,6]));
    expect(log).toEqual(["resolve","cache","reserve","provider:elevenlabs","settle:committed"]);
  });

  it("ElevenLabs client cancellation aborts the original provider and never caches a partial answer", async()=>{
    usePlan(ELEVEN);let providerSignal:AbortSignal|undefined;const cancel=vi.fn();
    h.elevenlabsMessageStream.mockImplementation(async(_input,signal)=>{providerSignal=signal;return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([4]));},cancel}));});
    const res=await play();const reader=res.body!.getReader();await reader.read();await reader.cancel();
    expect(providerSignal?.aborted).toBe(true);expect(cancel).toHaveBeenCalledTimes(1);expect(h.upload).not.toHaveBeenCalled();
    expect(settleCalls().map(x=>x.args._outcome)).toEqual(["committed"]);expect(h.elevenlabsMessageStream).toHaveBeenCalledTimes(1);
  });

  it("ElevenLabs refuses empty provider audio without releasing ambiguous spend",async()=>{
    usePlan(ELEVEN);h.elevenlabsMessageStream.mockResolvedValue(new Response(new Uint8Array()));
    const res=await play();expect(res.status).toBe(502);expect(settleCalls()).toHaveLength(0);expect(h.upload).not.toHaveBeenCalled();
  });

  it("ElevenLabs failed settlement cancels the provider and returns no audio",async()=>{
    usePlan(ELEVEN);const cancel=vi.fn();let signal:AbortSignal|undefined;
    h.elevenlabsMessageStream.mockImplementation(async(_input,s)=>{signal=s;return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([4]));},cancel}));});
    settleResult={data:null,error:{code:"PGRST000",message:"synthetic"}};
    const res=await play();expect(res.status).toBe(503);expect(await res.json()).toEqual({error:"tts_cost_settlement_unavailable"});
    expect(signal?.aborted).toBe(true);expect(cancel).toHaveBeenCalledTimes(1);expect(h.upload).not.toHaveBeenCalled();
  });

  it("ElevenLabs mid-stream failure is audible failure, not a cached success or retry",async()=>{
    usePlan(ELEVEN);let body!:ReadableStreamDefaultController<Uint8Array>;
    h.elevenlabsMessageStream.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({start(c){body=c;c.enqueue(new Uint8Array([4]));}})));
    const res=await play();const reader=res.body!.getReader();await reader.read();body.error(new Error("synthetic interruption"));
    await expect(reader.read()).rejects.toThrow();expect(h.upload).not.toHaveBeenCalled();expect(h.elevenlabsMessageStream).toHaveBeenCalledTimes(1);
    expect(settleCalls().map(x=>x.args._outcome)).toEqual(["committed"]);
  });

  it("ElevenLabs stalled first audio is bounded and keeps dispatched spend counted",async()=>{
    vi.useFakeTimers();usePlan(ELEVEN);let signal:AbortSignal|undefined;const cancel=vi.fn();
    h.elevenlabsMessageStream.mockImplementation(async(_input,s)=>{signal=s;return new Response(new ReadableStream<Uint8Array>({cancel}));});
    const pending=play();await vi.advanceTimersByTimeAsync(60_001);const res=await pending;
    expect(res.status).toBe(502);expect(signal?.aborted).toBe(true);expect(cancel).toHaveBeenCalledTimes(1);
    expect(settleCalls()).toHaveLength(0);expect(h.upload).not.toHaveBeenCalled();
  });

  it("ElevenLabs records stage durations in the incumbent usage record without claiming audible completion",async()=>{
    usePlan(ELEVEN);const res=await play();await res.arrayBuffer();
    await vi.waitFor(()=>expect(h.meter).toHaveBeenCalledTimes(1));
    const metadata=h.meter.mock.calls[0][0].metadata;
    expect(metadata).toMatchObject({provider:"elevenlabs",profile_revision:"el-r1",cache_hit:false});
    for(const key of ["provider_first_byte_ms","cost_settlement_ms","response_ready_ms"])expect(metadata[key]).toBeGreaterThanOrEqual(0);
    expect(metadata).not.toHaveProperty("text");expect(metadata).not.toHaveProperty("completed");
  });

  it("ElevenLabs a late provider response cannot revive a cancelled caller",async()=>{
    usePlan(ELEVEN);const abort=new AbortController();const cancel=vi.fn();
    h.elevenlabsMessageStream.mockImplementation(async()=>{abort.abort();return new Response(new ReadableStream<Uint8Array>({cancel}));});
    const res=await play("Synthetic cancellation",abort.signal);expect(res.status).toBe(502);
    expect(cancel).toHaveBeenCalledTimes(1);expect(settleCalls()).toHaveLength(0);expect(h.upload).not.toHaveBeenCalled();
  });

  it("ElevenLabs caller abort after settlement stops output and cannot file a partial cache",async()=>{
    usePlan(ELEVEN);const abort=new AbortController();const cancel=vi.fn();
    h.elevenlabsMessageStream.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([4]));},cancel})));
    const res=await play("Synthetic cancellation",abort.signal);const reader=res.body!.getReader();await reader.read();abort.abort();
    await expect(reader.read()).rejects.toThrow("interrupted");await vi.waitFor(()=>expect(cancel).toHaveBeenCalledTimes(1));
    expect(h.upload).not.toHaveBeenCalled();expect(settleCalls().map(x=>x.args._outcome)).toEqual(["committed"]);
  });

  it("ElevenLabs bounds an oversized first chunk before delivering or caching it",async()=>{
    usePlan(ELEVEN);const cancel=vi.fn();
    h.elevenlabsMessageStream.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(16*1024*1024+1));},cancel})));
    expect((await play()).status).toBe(502);expect(cancel).toHaveBeenCalledTimes(1);expect(h.upload).not.toHaveBeenCalled();expect(settleCalls()).toHaveLength(0);
  });

  it("ElevenLabs a thrown settlement failure cancels the provider without releasing spend",async()=>{
    usePlan(ELEVEN);settleThrows=true;let signal:AbortSignal|undefined;const cancel=vi.fn();const abort=new AbortController();
    h.elevenlabsMessageStream.mockImplementation(async(_input,s)=>{signal=s;return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([4]));},cancel}));});
    try {
      const res=await play("Synthetic settlement failure",abort.signal);expect(res.status).toBe(503);
      expect(await res.json()).toEqual({error:"tts_cost_settlement_unavailable"});expect(signal?.aborted).toBe(true);expect(cancel).toHaveBeenCalledTimes(1);
      expect(h.upload).not.toHaveBeenCalled();expect(settleCalls().map(x=>x.args._outcome)).toEqual(["committed"]);
    } finally {abort.abort();}
  });

  it("ElevenLabs an empty cached object is not returned as successful audio",async()=>{
    usePlan(ELEVEN);cached=new Blob([]);const res=await play();await res.arrayBuffer();
    expect(res.status).toBe(200);expect(h.elevenlabsMessageStream).toHaveBeenCalledTimes(1);expect(reserveCalls()).toHaveLength(1);
  });

  it("cached audio records cache readiness without fabricating provider timing or spend",async()=>{
    usePlan(ELEVEN);cached=new Blob([new Uint8Array([7])]);const res=await play();await res.arrayBuffer();
    await vi.waitFor(()=>expect(h.meter).toHaveBeenCalledTimes(1));const metadata=h.meter.mock.calls[0][0].metadata;
    expect(metadata.cache_hit).toBe(true);expect(metadata.cache_lookup_ms).toBeGreaterThanOrEqual(0);
    expect(metadata.response_ready_ms).toBeGreaterThanOrEqual(metadata.cache_lookup_ms);expect(metadata).not.toHaveProperty("provider_first_byte_ms");
    expect(h.elevenlabsMessageStream).not.toHaveBeenCalled();expect(reserveCalls()).toHaveLength(0);expect(settleCalls()).toHaveLength(0);
  });

  it("OpenAI thrown settlement also cancels its existing stream before tee or output",async()=>{
    usePlan(OPENAI);settleThrows=true;const cancel=vi.fn();
    h.synthesizeSpeechStream.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([1]));},cancel})));
    const res=await play();expect(res.status).toBe(503);expect(await res.json()).toEqual({error:"tts_cost_settlement_unavailable"});
    expect(cancel).toHaveBeenCalledTimes(1);expect(h.upload).not.toHaveBeenCalled();expect(settleCalls().map(x=>x.args._outcome)).toEqual(["committed"]);
  });

});
