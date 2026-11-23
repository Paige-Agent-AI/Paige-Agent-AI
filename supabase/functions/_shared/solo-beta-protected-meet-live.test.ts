import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { handleProtectedMeetLive } from "./solo-beta-protected-meet-live.ts";

const original = {
  referenceId: "b2470000-0000-4000-8000-000000000010",
  resumeSecretHash: "a".repeat(64),
  returnOrigin: "http://localhost:5173",
};
const context = { thread_id: "thread", context_epoch: "epoch", acknowledged: false, transcript: [] };
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function fixture(results: unknown[], noVoiceProfile = false) {
  const calls: Record<string, unknown>[] = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      assert(name === "solo_beta_protected_meet_control", "unexpected RPC");
      calls.push(args);
      return Promise.resolve({ data: results.shift(), error: null });
    },
    from: () => {
      if (!noVoiceProfile) throw new Error("unexpected provider check");
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

Deno.test("protected Meet context passes only the original server-resolved grant", async () => {
  const { admin, calls } = fixture([context]);
  const response = await handleProtectedMeetLive(admin, { ...original, operation: "context" });
  assert(response.status === 200 && response.body.thread_id === context.thread_id, "missing context");
  assert(calls.length === 1 && calls[0]._reference_id === original.referenceId &&
    calls[0]._resume_secret_hash === original.resumeSecretHash && calls[0]._return_origin === original.returnOrigin,
  "grant not forwarded unchanged");
});

Deno.test("protected Meet refuses all audio work when enrollment is unproven", async () => {
  for (const operation of ["greeting", "relay", "turn"]) {
    const { admin, calls } = fixture([null]);
    const response = await handleProtectedMeetLive(admin, { ...original, operation, cue: "welcome" });
    assert(response.status === 403 && calls.length === 1, "provider checked before enrollment");
  }
});

Deno.test("verification moves a resumed protected Meet to canonical sign in", async () => {
  const { admin, calls } = fixture([{ code: "canonical_sign_in_required" }]);
  const response = await handleProtectedMeetLive(admin, { ...original, operation: "relay" });
  assert(response.status === 409 && response.body.code === "canonical_sign_in_required" && calls.length === 1,
    "verified enrollment still attempted provisional live");
});

Deno.test("an unavailable approved voice issues no ticket and calls no provider", async () => {
  const { admin, calls } = fixture([context], true);
  const response = await handleProtectedMeetLive(admin, { ...original, operation: "relay" });
  assert(response.status === 200 && response.body.ok === false && response.body.availability === "UNAVAILABLE" &&
    response.body.code === "approved_voice_unavailable" && calls.length === 1, "missing voice did not fail closed");
});

Deno.test("protected Meet requires explicit current audio acknowledgement", async () => {
  const missing = fixture([context]);
  const blocked = await handleProtectedMeetLive(missing.admin, { ...original, operation: "acknowledge" });
  assert(blocked.status === 400 && missing.calls.length === 1, "missing acknowledgement accepted");
  const valid = fixture([context, { accepted: true }]);
  const accepted = await handleProtectedMeetLive(valid.admin, {
    ...original, operation: "acknowledge", acknowledgementVersion: "live-consent-v1",
  });
  assert(accepted.status === 200 && valid.calls.length === 2 && valid.calls[1]._operation === "acknowledge",
    "positive acknowledgement did not reach canonical consent control");
});

Deno.test("the fixed greeting requires consent before reading the provider or reserving audio", async () => {
  const { admin, calls } = fixture([context]);
  const response = await handleProtectedMeetLive(admin, { ...original, operation: "greeting", cue: "welcome" });
  assert(response.status === 200 && response.body.code === "live_audio_not_enabled" &&
    response.body.availability === "UNAVAILABLE" && response.body.audio_base64 === undefined &&
    calls.length === 1 && calls[0]._operation === "resume_context", "greeting checked provider or reserved audio before consent");
});
