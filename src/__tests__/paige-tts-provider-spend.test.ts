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
  elevenlabsTts: vi.fn(),
  planTtsSynthesis: vi.fn(),
  resolveProfileVoice: vi.fn(),
  ttsCacheKey: vi.fn(),
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
vi.mock("../../supabase/functions/_shared/elevenlabs.ts", () => ({ elevenlabsTts: h.elevenlabsTts }));

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
        if (fn === "settle_paige_voice_cost_internal") { log.push(`settle:${String(args._outcome)}`); return settleResult; }
        throw new Error(`unexpected admin rpc ${fn}`);
      },
      storage: {
        from: () => ({
          download: async () => { log.push("cache"); return { data: cached, error: null }; },
          upload: async () => ({ error: null }),
        }),
      },
      from: () => ({ insert: async () => ({ error: null }) }),
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

const play = (text = "Hello from Paige") => h.handler!(new Request("https://edge.test/functions/v1/paige-tts", {
  method: "POST",
  headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
  body: JSON.stringify({ text }),
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
    vi.stubGlobal("Deno", { env: { get: (name: string) => name } });
    for (const fn of [h.createClient, h.synthesizeSpeechStream, h.elevenlabsTts, h.planTtsSynthesis, h.resolveProfileVoice, h.ttsCacheKey]) fn.mockReset();
    h.ttsCacheKey.mockResolvedValue("cache-key");
    h.synthesizeSpeechStream.mockImplementation(async () => { log.push("provider:openai"); return audioResponse(); });
    h.elevenlabsTts.mockImplementation(async () => { log.push("provider:elevenlabs"); return { artifact_bytes: new Uint8Array([9]) }; });
    setupClients();
    await vi.importActual("../../supabase/functions/paige-tts/index.ts");
    ({ NeedsConfigError } = await import("../../supabase/functions/_shared/provider-types.ts"));
    expect(h.handler).not.toBeNull();
  });

  afterEach(() => { vi.unstubAllGlobals(); });

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
  });

  it("ElevenLabs (regression): a refused reservation still never calls the provider", async () => {
    usePlan(ELEVEN);
    reserveResult = { data: null, error: { message: "PAIGE_VOICE_PLATFORM_COST_LIMIT", code: "54000", details: null, hint: null } };
    const res = await play();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "tts_platform_cost_limit" });
    expect(h.elevenlabsTts).not.toHaveBeenCalled();
  });

  it("ElevenLabs (regression): NeedsConfigError releases; an ambiguous failure does not", async () => {
    usePlan(ELEVEN);
    h.elevenlabsTts.mockImplementationOnce(async () => { log.push("provider:elevenlabs"); throw new NeedsConfigError("elevenlabs"); });
    expect((await play()).status).toBe(502);
    expect(log.at(-1)).toBe("settle:released");
    log = []; rpcCalls = [];
    h.elevenlabsTts.mockImplementationOnce(async () => { log.push("provider:elevenlabs"); throw new Error("ElevenLabs 500"); });
    expect((await play()).status).toBe(502);
    expect(settleCalls()).toHaveLength(0);
  });
});
