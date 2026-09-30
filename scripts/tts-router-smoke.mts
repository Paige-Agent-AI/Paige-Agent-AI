// Pure proof for the server-owned Paige Voice Profile TTS route. No provider call or secret read.
const env: Record<string, string | undefined> = {};
(globalThis as unknown as { Deno?: unknown }).Deno = { env: { get: (key: string) => env[key], toObject: () => ({ ...env }) } };

const { resolveTtsRoute, resolveProfileVoice, ttsCacheKey, planTtsSynthesis } = await import("../supabase/functions/_shared/tts-router.ts");
let failures = 0;
const ok = (name: string, condition: boolean) => condition ? console.log(`  ✓ ${name}`) : (failures++, console.error(`  ✗ ${name}`));
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

ok("both transport routes remain registered", resolveTtsRoute("elevenlabs-premium")?.provider === "elevenlabs" && resolveTtsRoute("openai-standard")?.provider === "openai");
ok("unapproved profile fails closed", resolveProfileVoice({ provider: "openai", provider_voice_ref: "nova", revision: "r1", approved: false, active: true }) === null);
ok("inactive profile fails closed", resolveProfileVoice({ provider: "openai", provider_voice_ref: "nova", revision: "r1", approved: true, active: false }) === null);
ok("unknown OpenAI voice fails closed", resolveProfileVoice({ provider: "openai", provider_voice_ref: "invented", revision: "r1", approved: true, active: true }) === null);
const openaiProfile = resolveProfileVoice({ provider: "openai", provider_voice_ref: "nova", revision: "r1", approved: true, active: true });
const elevenProfile = resolveProfileVoice({ provider: "elevenlabs", provider_voice_ref: "g6xIsTj2HwM6VR4iXFCw", revision: "r2", approved: true, active: true });
ok("approved OpenAI profile resolves", eq(openaiProfile, { provider: "openai", id: "nova", profileRevision: "r1" }));
ok("approved Jessica profile resolves", eq(elevenProfile, { provider: "elevenlabs", id: "g6xIsTj2HwM6VR4iXFCw", profileRevision: "r2" }));
ok("a stale approved profile cannot select a stranger's voice", resolveProfileVoice({ provider: "elevenlabs", provider_voice_ref: "cgSgspJ2msm6clMCkdW9", revision: "stale", approved: true, active: true }) === null);

delete env.OPENAI_API_KEY;
delete env.ELEVENLABS_API_KEY;
ok("no configured provider fails closed", !!openaiProfile && !planTtsSynthesis(openaiProfile).ok);
env.OPENAI_API_KEY = "presence-only";
ok("selected OpenAI profile creates exactly one attempt", !!openaiProfile && eq(planTtsSynthesis(openaiProfile), { ok: true, attempts: [{ provider: "openai", model: "gpt-4o-mini-tts", voice: "nova", profileRevision: "r1" }] }));
delete env.OPENAI_API_KEY;
env.ELEVENLABS_API_KEY = "presence-only";
ok("selected ElevenLabs profile defaults to realtime conversational v3", !!elevenProfile && eq(planTtsSynthesis(elevenProfile), { ok: true, attempts: [{ provider: "elevenlabs", model: "eleven_v3_conversational", voiceId: "g6xIsTj2HwM6VR4iXFCw", profileRevision: "r2" }] }));
env.ELEVENLABS_MODEL = "eleven_v3";
ok("owner can switch to expressive v3 with server config", !!elevenProfile && eq(planTtsSynthesis(elevenProfile), { ok: true, attempts: [{ provider: "elevenlabs", model: "eleven_v3", voiceId: "g6xIsTj2HwM6VR4iXFCw", profileRevision: "r2" }] }));
env.ELEVENLABS_MODEL = "eleven_multilingual_v2";
ok("legacy model cannot silently return", !!elevenProfile && !planTtsSynthesis(elevenProfile).ok);
delete env.ELEVENLABS_MODEL;
ok("a configured alternate provider is not an implicit fallback", !!openaiProfile && !planTtsSynthesis(openaiProfile).ok);

const keyA = await ttsCacheKey("hello", "openai", "nova", "gpt-4o-mini-tts");
const keyB = await ttsCacheKey("hello", "openai", "nova", "gpt-4o-mini-tts");
const keyC = await ttsCacheKey("hello", "elevenlabs", "g6xIsTj2HwM6VR4iXFCw", "eleven_v3_conversational");
ok("cache key is deterministic", keyA === keyB && /^[0-9a-f]{64}$/.test(keyA));
ok("provider identity separates cache entries", keyA !== keyC);

const { elevenlabsTts, elevenlabsSpeechStream } = await import("../supabase/functions/_shared/elevenlabs.ts");
const priorFetch = globalThis.fetch;
let observedUrl = "";
let observedModel = "";
let observedVoice = "";
const priorWebSocket = globalThis.WebSocket;
let socketUrl = "";
const socketFrames: Record<string, unknown>[] = [];
class FakeMouthSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) { socketUrl = url; queueMicrotask(() => this.onopen?.()); }
  send(raw: string) {
    const frame = JSON.parse(raw);
    socketFrames.push(frame);
    if (frame.close_socket) queueMicrotask(() => {
      this.onmessage?.({ data: JSON.stringify({ audio: "AQI=" }) });
      this.onmessage?.({ data: JSON.stringify({ is_final: true }) });
    });
  }
  close() { /* local fake, no network */ }
}
globalThis.WebSocket = FakeMouthSocket as unknown as typeof WebSocket;
env.ELEVENLABS_API_KEY = "local-presence-only";
globalThis.fetch = async (input, init) => {
  observedUrl = String(input);
  observedModel = String(JSON.parse(String(init?.body)).model_id);
  observedVoice = String(init?.headers && (init.headers as Record<string, string>)["xi-api-key"]);
  return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
};
try {
  await elevenlabsTts({ text: "A local test sentence.", voiceId: "g6xIsTj2HwM6VR4iXFCw" });
  ok("TTS transport requires no-retention mode and exact voice", observedUrl.includes("/g6xIsTj2HwM6VR4iXFCw?enable_logging=false") && observedVoice === "local-presence-only");
  ok("TTS transport defaults to conversational v3", observedModel === "eleven_v3_conversational");
  const cancel = new AbortController();
  const audio = await elevenlabsSpeechStream({ text: "A first sentence.", voiceId: "g6xIsTj2HwM6VR4iXFCw", retentionPolicy: "default_provider_retention" }, cancel.signal);
  ok("live mouth uses documented dialogue WSS and authorized default retention", socketUrl === "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v3_conversational&output_format=pcm_16000&enable_logging=true");
  ok("live mouth registers exact voice and keeps credential out of the URL", eq(socketFrames[0], { voices: ["g6xIsTj2HwM6VR4iXFCw"], xi_api_key: "local-presence-only" }) && !socketUrl.includes("local-presence-only"));
  ok("live mouth preserves PCM bytes for the existing browser player", eq(Array.from(new Uint8Array(await audio.arrayBuffer())), [1, 2]));
} finally {
  globalThis.fetch = priorFetch;
  globalThis.WebSocket = priorWebSocket;
  delete env.ELEVENLABS_API_KEY;
}

if (failures) process.exit(1);
console.log("All server-profile TTS checks passed.");
