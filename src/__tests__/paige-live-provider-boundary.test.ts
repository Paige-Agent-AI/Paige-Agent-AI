import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const router = readFileSync("supabase/functions/_shared/model-router.ts", "utf8");
const tts = readFileSync("supabase/functions/paige-tts/index.ts", "utf8");
const messageAudioButton = readFileSync("src/components/chat/MessageAudioButton.tsx", "utf8");
const session = readFileSync("supabase/functions/paige-live-session/index.ts", "utf8");
const operator = readFileSync("supabase/functions/paige-voice-profile-admin/index.ts", "utf8");

describe("Paige voice provider boundary", () => {
  it("bounds the actual relay sender and cancels once without recursively sending into a full socket", () => {
    const edge = readFileSync("supabase/functions/paige-live-relay/index.ts", "utf8");
    const method = edge.slice(edge.indexOf("    send(frame) {"), edge.indexOf("    close(code, reason) {"));
    const sent: unknown[] = [];
    const failures: string[] = [];
    const socket = { readyState: 1, bufferedAmount: 0, send: (frame: unknown) => sent.push(frame) };
    const bridge = { unavailable: (code: string) => { failures.push(code); send("failure notification"); } };
    const send: (frame: string | ArrayBuffer) => void = new Function("socket", "bridge", "WebSocket", `let outputBlocked = false; return ({${method}}).send;`)(socket, bridge, { OPEN: 1 });
    send(new ArrayBuffer(4));
    expect(sent).toHaveLength(1);
    socket.bufferedAmount = 262_144;
    send(new ArrayBuffer(2));
    send(new ArrayBuffer(2));
    expect(sent).toHaveLength(1);
    expect(failures).toEqual(["live_output_backpressure"]);
  });

  it("cannot route a caller-selected voice from the shared model router", () => {
    const voiceCell = router.slice(router.indexOf("const voiceCell"), router.indexOf("const docRenderCell"));
    expect(voiceCell).not.toMatch(/voiceId|voice_id|elevenlabsTts|ELEVENLABS_API_KEY/);
    expect(voiceCell).toContain("paige_voice_profile:studio_adapter");
  });

  it("resolves the server profile before the only Paige TTS provider adapter call", () => {
    expect(tts.indexOf('rpc("resolve_paige_voice_profile_internal"')).toBeGreaterThan(-1);
    expect(tts.indexOf('rpc("resolve_paige_voice_profile_internal"')).toBeLessThan(tts.indexOf("elevenlabsTts({"));
    expect(tts).toContain("voice_override_not_allowed");
  });

  it("reserves before provider entry, releases only typed pre-dispatch failures, and keeps ambiguous failures counted", () => {
    const reserve = tts.indexOf('rpc("reserve_paige_voice_cost_internal"');
    const provider = tts.indexOf("elevenlabsTts({");
    const cache = tts.indexOf("download(cachePath)");
    expect(cache).toBeGreaterThan(-1);
    expect(cache).toBeLessThan(reserve);
    expect(reserve).toBeGreaterThan(-1);
    expect(reserve).toBeLessThan(provider);
    expect(tts).toContain("e instanceof NeedsConfigError");
    expect(tts).toContain('_outcome: "released"');
    expect(tts).toContain('_outcome: "committed"');
    expect(tts).toContain("must remain reserved");
    expect(tts).not.toMatch(/if \(!bytes \|\| bytes\.length === 0\) \{[\s\S]{0,300}_outcome: "released"/);
    expect(tts).toContain("tts_cost_settlement_unavailable");
  });

  it("keeps request identity client-owned while allowing the per-tap key through CORS", () => {
    expect(messageAudioButton).toContain("const requestId = crypto.randomUUID()");
    expect(messageAudioButton).toContain(`"Idempotency-Key": requestId`);
    expect(tts).toContain(
      `"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, Idempotency-Key"`,
    );
    expect(tts).not.toContain("suppliedIdempotencyKey");
    expect(tts).not.toContain("fallbackRequestRef");
  });

  it("requires scope on every transition and permits stale cleanup only for explicit end", () => {
    expect(session).toContain("thread_id: z.string().uuid()");
    expect(session).toContain("context_epoch: z.string().min(1).max(512)");
    expect(session).toContain('parsed.data.transition !== "end"');
    expect(session).toContain("paige_live_session_transition_internal");
  });

  it("keeps activation atomic and separate from read-only owner inspection", () => {
    expect(operator).toContain('rpc("is_platform_owner")');
    expect(operator).toContain('admin.rpc("activate_paige_voice_profile_internal",');
    expect((operator.match(/admin\.rpc\("activate_paige_voice_profile_internal"/g) ?? [])).toHaveLength(1);
    expect((operator.match(/admin\.rpc\("set_paige_live_pilot_internal"/g) ?? [])).toHaveLength(2);
    expect(operator).not.toContain('rpc("set_paige_voice_readiness_internal")');
    expect(operator).not.toContain('rpc("set_paige_voice_profile_internal")');
    expect(operator).not.toMatch(/elevenlabsTts|api\.elevenlabs|fetch\(/);
    expect(operator).not.toMatch(/console\.(log|error).*provider_voice_ref/);
  });

  it("authorizes before account inspection and resolves the candidate without request overrides", () => {
    const branch = operator.indexOf('parsed.data.action === "inspect-configured-account"');
    expect(branch).toBeGreaterThan(operator.indexOf('ownerError || isOwner !== true'));
    expect(branch).toBeGreaterThan(-1);
    const inspection = operator.slice(branch, operator.indexOf('// One database call'));
    expect(inspection).toContain('.eq("slot", "candidate")');
    expect(inspection).toContain('inspectConfiguredVoiceProvider');
    expect(inspection).toContain('envKey("ELEVENLABS_API_KEY")');
    expect(inspection).toContain('admin.from("paige_audit_log").insert');
    expect(inspection).not.toMatch(/activate_paige|set_paige_voice|parsed.data.provider_voice_ref/);
    expect(inspection).toMatch(/if \(parsed.data.action === "authorize-live-pilot"\)[\s\S]*?rpc\("set_paige_live_pilot_internal"/);
    expect(operator).toContain("accept_default_provider_retention: z.literal(true)");
    expect(operator).toContain("accept_procedural_single_speaker: z.literal(true)");
    expect(inspection).toContain('audio_enabled: false');
  });
});
