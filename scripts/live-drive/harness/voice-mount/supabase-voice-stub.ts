/**
 * Data-boundary stub for the INT-345 voice-readiness mount.
 *
 * MOCKS THE TRANSPORT, NEVER THE CONTRACT (harness README). The shipped
 * `VoiceDeviceProvider`, `DialPadTrigger`, `DialPadSurface` and `DialPad` are
 * under measurement; the only replaced seam is the Supabase transport, and the
 * needs_config payload is built by the SHIPPED `classifyVoiceReadiness` itself
 * with synthetic fixtures — so the rendered copy is byte-identical to the edge
 * function's by construction, not by copy-paste.
 *
 * The fixtures are the identifier-free ones from the INT-345 test suite; no
 * real tenant, number, or SID appears here (§13/§63).
 *
 * `?state=` selects the readiness state under measurement:
 *   not_configured · no_primary · multiple_primary · wrong_subaccount ·
 *   missing_binding · no_voice
 */
import { classifyVoiceReadiness } from "../../../../supabase/functions/voice-access-token/authorization";

const ACTIVE_SUB = { id: "sub-harness", active: true, status: "active" };

const STATES: Record<string, () => ReturnType<typeof classifyVoiceReadiness>> = {
  not_configured: () => classifyVoiceReadiness(null, null),
  no_primary: () => classifyVoiceReadiness(ACTIVE_SUB, []),
  multiple_primary: () => classifyVoiceReadiness(ACTIVE_SUB, [
    { subaccount_id: "sub-harness", twilio_sid: "PN-harness-1", capabilities: { voice: true } },
    { subaccount_id: "sub-harness", twilio_sid: "PN-harness-2", capabilities: { voice: true } },
  ]),
  wrong_subaccount: () => classifyVoiceReadiness(ACTIVE_SUB, [
    { subaccount_id: "sub-other", twilio_sid: "PN-harness-1", capabilities: { voice: true } },
  ]),
  missing_binding: () => classifyVoiceReadiness(ACTIVE_SUB, [
    { subaccount_id: "sub-harness", twilio_sid: null, capabilities: { voice: true } },
  ]),
  no_voice: () => classifyVoiceReadiness(ACTIVE_SUB, [
    { subaccount_id: "sub-harness", twilio_sid: "PN-harness-1", capabilities: { voice: false } },
  ]),
};

const state = new URLSearchParams(window.location.search).get("state") ?? "not_configured";

export const supabase = {
  functions: {
    invoke: async (fn: string) => {
      if (fn !== "voice-access-token") return { data: {}, error: { message: "unexpected function" } };
      const verdict = (STATES[state] ?? STATES.not_configured)();
      if (verdict.ok) return { data: { token: "harness-not-a-real-token" }, error: null };
      return {
        data: {
          needs_config: true,
          error: verdict.code,
          reason_code: verdict.reason_code ?? null,
          message: verdict.message,
        },
        error: null,
      };
    },
  },
  // The transcript topic is null in every needs_config state (no live call),
  // so a real subscribe is never attempted; the shape exists so any import of
  // the client resolves. The callback is RECORDED, never invoked (the
  // synchronous-SUBSCRIBED trap).
  channel: () => ({
    on() { return this; },
    subscribe(_cb: unknown) { return this; },
  }),
  removeChannel() { /* no-op */ },
};

export default supabase;
