import { APPROVED_PAIGE_ELEVENLABS_VOICE_ID, resolveElevenLabsModel } from "./elevenlabs.ts";
import { envKey } from "./env-key.ts";

interface ApprovedVoiceRow {
  provider?: unknown;
  provider_voice_ref?: unknown;
  revision?: unknown;
  active?: unknown;
}

type ReadApprovedVoice = () => Promise<{ data: ApprovedVoiceRow | null; error: unknown }>;

/** One provider readiness check for the signed-in and protected signup paths. */
export async function readLiveProviderAdmission(readVoice: ReadApprovedVoice) {
  const { data: voice, error } = await readVoice();
  const voiceReady = !error && voice?.provider === "elevenlabs" &&
    voice.provider_voice_ref === APPROVED_PAIGE_ELEVENLABS_VOICE_ID &&
    voice.revision === "elevenlabs-jessica-take5-r1" && voice.active === false;
  if (!voiceReady) return { voice, runtimeSigningKey: "", unavailableCode: "approved_voice_unavailable" };
  const runtimeSigningKey = envKey("PAIGE_LIVE_STREAM_SIGNING_KEY") ?? "";
  const unavailableCode = !resolveElevenLabsModel() || !envKey("ELEVENLABS_API_KEY") ? "mouth_not_configured"
    : !envKey("DEEPGRAM_API_KEY") ? "ears_not_configured"
    : runtimeSigningKey.length < 32 ? "runtime_not_configured"
    : null;
  return { voice, runtimeSigningKey, unavailableCode };
}
