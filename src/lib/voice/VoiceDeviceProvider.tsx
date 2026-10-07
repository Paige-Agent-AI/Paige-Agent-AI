// #140 Slice A2 — the ONE Twilio Voice Device lifecycle (§18).
//
// This provider owns the SINGLE @twilio/voice-sdk `Device` instance for the whole
// admin shell. The top-nav dial pad and every click-to-call affordance are just
// callers of the one hook (`useVoiceDevice`) — there is never a second Device, so
// registrations don't leak and a call started from a contact row and a call started
// from the keypad are the same live call.
//
// DOCTRINE
//  §18  ONE home for the Device lifecycle. Mounted once (AdminLayout); consumers
//       read it via context. No per-surface Device.
//  §13  Honest states only. `needs_config` from the A1 token fn → a real "not set
//       up yet" state (no Device constructed, no fake dialer). A Device/connection
//       error or a denied mic → status "error" with a real reason — never a
//       fabricated "connected".
//  §32  The A1 token TTL is SHORT (default 600s). We subscribe to the Device's
//       `tokenWillExpire` event and re-mint + `updateToken` BEFORE it lapses, so a
//       stale token never silently kills calling.
//  §9   The browser passes NO tenant/identity to the token fn — identity is derived
//       server-side from the JWT (A1). We never log the token.
//  §14  Only the owner-sanctioned @twilio/voice-sdk is used; loaded lazily via a
//       dynamic import so the ~SDK weight isn't paid on admin pages that never call.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Call, Device, TwilioError } from "@twilio/voice-sdk";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import {
  acquireCallStart,
  discardExpiredVoiceDevice,
  destroyDeferredVoiceDevice,
  isDialableNumber,
  normalizeDialNumber,
  providerCallErrorMessage,
} from "./voiceCallSafety";
export { isDialableNumber, normalizeDialNumber } from "./voiceCallSafety";
import {
  useLiveTranscript,
  type TranscriptLine,
  type TranscriptState,
  type CallIntelligence,
} from "./useLiveTranscript";

export type VoiceStatus =
  | "idle" // no Device yet (nothing has asked to call)
  | "connecting" // fetching token / registering / dialing
  | "ready" // Device registered, no active call
  | "ringing" // an INBOUND call is ringing, awaiting accept/reject (A3)
  | "in_call" // a call is live
  | "needs_config" // A1 token fn returned needs_config — voice not provisioned
  | "error"; // token/Device/mic failure — carries a human reason

export interface ActiveCallInfo {
  /** The number we dialed (display form). */
  number: string;
  /** epoch ms when the call connected — the DialPad renders a timer off this. */
  startedAt: number;
  /**
   * #140 B2 — the Twilio CallSid of the LIVE call (from `call.parameters.CallSid`), used
   * to build the live-transcript topic `voice-stt:<tenantId>:<callSid>`. null until Twilio
   * populates it. HONEST CAVEAT (§13): for an OUTBOUND call this is the same leg the
   * <Start><Stream> fork runs on, so it matches the stream's callSid; for an INBOUND call
   * the browser holds the CHILD leg's SID while the stream is keyed to the PARENT — so the
   * inbound topic can mismatch until voice-twiml passes the parent SID to the <Client>
   * (a B1 follow-up). Outbound co-pilot works today; inbound is owed that fix.
   */
  callSid: string | null;
}

/** An inbound call ringing the browser, awaiting accept/reject (A3). */
export interface IncomingCallInfo {
  /** The external caller's number (From), display form; falls back to "Unknown caller". */
  from: string;
}

interface VoiceDeviceValue {
  status: VoiceStatus;
  /** Human-readable reason when status is "error" or "needs_config". */
  reason: string | null;
  /** Place an outbound call to an E.164-ish number. Lazily boots the Device. */
  call: (rawNumber: string) => Promise<void>;
  /** Hang up the active call (no-op if none). */
  hangup: () => void;
  muted: boolean;
  toggleMute: () => void;
  activeCall: ActiveCallInfo | null;
  /** Send a DTMF tone on the LIVE call (in-call keypad). No-op when no call is live. */
  sendDigit: (digit: string) => void;

  // ── Live-call co-pilot transcript (#140 B2) ──
  /** Render-ready transcript lines for the LIVE call (committed finals + one interim). */
  liveTranscript: TranscriptLine[];
  /** What the transcript subscription is doing: idle | listening | live | reconnecting. */
  transcriptState: TranscriptState;
  /**
   * #140 B3 — drop the POST-CALL transcript keepalive early (the operator dismissed the
   * panel). The subscription otherwise self-releases when the late draft lands or the
   * bounded grace window elapses. A no-op while a call is live.
   */
  endLiveTranscriptGrace: () => void;

  // ── Live-call co-pilot INTELLIGENCE (#140 B3) ──
  /** Whisper cues / commitments / at-risk flags / follow-up draft for the LIVE call. */
  liveIntelligence: CallIntelligence;

  // ── Inbound (A3): a ringing call awaiting the operator's accept/reject ──
  incomingCall: IncomingCallInfo | null;
  /** Accept the ringing inbound call — wires it exactly like an outbound call. */
  acceptIncoming: () => void;
  /** Reject the ringing inbound call. */
  rejectIncoming: () => void;

  // ── Dialer UI wiring (so a click-to-call anywhere drives the one top-nav pad) ──
  dialerOpen: boolean;
  setDialerOpen: (open: boolean) => void;
  /** Controlled keypad value, shared so click-to-call can prefill it. */
  draft: string;
  setDraft: (v: string) => void;
  /** Open the pad prefilled with a number (does NOT dial). */
  openDialerWith: (number: string) => void;
  /** Open the pad prefilled AND start the call (the click-to-call path). */
  callFrom: (number: string) => void;
  /** Boot the Device early (called when the pad opens) so the first dial is instant. */
  warmUp: () => void;
}

const VoiceDeviceContext = createContext<VoiceDeviceValue | null>(null);

// Re-mint this many ms is handled by Twilio's own `tokenWillExpire` (fires ~10s
// before expiry by default); we just react to it. Kept as a named constant so the
// §32 refresh path is self-documenting.
const TOKEN_REFRESH_EVENT = "tokenWillExpire" as const;

// #140 B3 FIX 2 — post-call transcript keepalive. The copilot broadcasts "draft_ready"
// (and settles any late final lines / commitment / at-risk) from finalize(), which runs
// draft synthesis + 2 RPCs ASYNC *after* the media stream stops and the call has already
// left "in_call". If we drop the private channel the instant the call ends, those late
// broadcasts reach nobody and the "Follow-up drafted" affordance never appears even though
// the approval WAS created. So we hold the just-ended call's topic subscribed through a
// bounded grace window: until the draft lands (then a short settle so the panel can freeze
// it) or TRANSCRIPT_GRACE_MS elapses — whichever comes first. A NEW call supersedes the
// grace topic immediately, so a fresh stream never inherits the prior call's subscription.
const TRANSCRIPT_GRACE_MS = 90_000;
const TRANSCRIPT_GRACE_SETTLE_AFTER_DRAFT_MS = 2_000;

type MintResult =
  | { kind: "token"; token: string }
  | { kind: "needs_config"; message: string }
  | { kind: "error"; message: string };

/**
 * Call the A1 token seam. §9: no body params that could widen scope — identity and
 * tenant are server-derived from the JWT. §13: needs_config and error are surfaced
 * honestly; the token is never logged.
 */
async function mintToken(): Promise<MintResult> {
  try {
    const { data, error } = await supabase.functions.invoke("voice-access-token", {
      body: {},
    });
    if (error) {
      // functions.invoke turns a non-2xx (e.g. the 502 real-failure path) into `error`.
      // needs_config is a 200 so it lands in `data`, not here.
      return { kind: "error", message: "Couldn't reach the calling service. Try again in a moment." };
    }
    const d = (data ?? {}) as {
      token?: string;
      needs_config?: boolean;
      message?: string;
    };
    if (d.needs_config) {
      return {
        kind: "needs_config",
        message:
          d.message ??
          "Calling isn't set up for this practice yet. Once your phone number is provisioned you'll be able to call from the browser.",
      };
    }
    if (typeof d.token === "string" && d.token.length > 0) {
      return { kind: "token", token: d.token };
    }
    return { kind: "error", message: "Calling is temporarily unavailable." };
  } catch {
    return { kind: "error", message: "Couldn't reach the calling service. Try again in a moment." };
  }
}

export function VoiceDeviceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCallInfo | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [dialerOpen, setDialerOpen] = useState(false);
  const [draft, setDraft] = useState("");

  // #140 B2 — the live-call co-pilot transcript. The topic is scoped to THIS caller's
  // tenant (§9): activeTenantId equals current_user_tenant_id() server-side, which the
  // realtime.messages RLS policy (#557) checks — so a private-channel subscribe can only
  // ever ride this tenant's own call. VoiceDeviceProvider mounts only inside AdminLayout,
  // which is under <TenantProvider>, so this context read is always safe.
  const { activeTenantId } = useTenantContext();

  // The topic WHILE a call is live (null when there's no live call / unresolved tenant/SID).
  const liveTopic =
    status === "in_call" && activeTenantId && activeCall?.callSid
      ? `voice-stt:${activeTenantId}:${activeCall.callSid}`
      : null;

  // #140 B3 FIX 2 — the STICKY subscribed topic. It follows the live call's topic AND is
  // held open through the post-call grace window (see TRANSCRIPT_GRACE_MS) so the copilot's
  // LATE draft_ready — synthesized async after the media stream stops — still reaches the
  // subscribed panel. It is only ever cleared by the grace timer, the post-draft settle,
  // an explicit dismiss, or a NEW call replacing it — NEVER nulled at call-end.
  const [subscribedTopic, setSubscribedTopic] = useState<string | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Current live topic, read (never mutated for render) so endLiveTranscriptGrace can refuse
  // to drop a subscription while a call is actually live.
  const liveTopicRef = useRef<string | null>(null);
  liveTopicRef.current = liveTopic;

  // The effective subscription. A live topic ALWAYS wins, so a new call supersedes any
  // grace-held topic on the SAME render (its string differs by callSid → useLiveTranscript
  // resets its per-call buffers) — and at call-end `liveTopic` goes null but the sticky
  // `subscribedTopic` is still the just-ended topic, so the string is UNCHANGED: no null
  // blip, so the hook keeps the call's accumulated buffers for the late draft to append to.
  const transcriptTopic = liveTopic ?? subscribedTopic;
  const {
    lines: liveTranscript,
    state: transcriptState,
    intelligence: liveIntelligence,
  } = useLiveTranscript(transcriptTopic);

  const clearGraceTimer = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  // Track the live topic into the sticky subscription and arm/cancel the grace teardown.
  useEffect(() => {
    if (liveTopic) {
      // Live (new or same) — subscribe to it and cancel any pending grace teardown. A new
      // call's topic REPLACES a grace-held one here (belt-and-suspenders to the render-level
      // `liveTopic ?? subscribedTopic` supersede) — no cross-call leak (§9).
      clearGraceTimer();
      setSubscribedTopic((prev) => (prev === liveTopic ? prev : liveTopic));
    } else if (subscribedTopic && !graceTimerRef.current) {
      // The call just ended while we still hold its topic — keep it SUBSCRIBED through the
      // bounded grace window (the string never blips to null), then tear it down. Capped by
      // TRANSCRIPT_GRACE_MS whether or not a draft ever arrives.
      graceTimerRef.current = setTimeout(() => {
        graceTimerRef.current = null;
        setSubscribedTopic(null);
      }, TRANSCRIPT_GRACE_MS);
    }
  }, [liveTopic, subscribedTopic, clearGraceTimer]);

  // Post-call only: once the draft we held the channel open for lands, give the panel a beat
  // to freeze it, then tear the subscription down early (don't wait out the full window).
  useEffect(() => {
    if (liveTopic || !subscribedTopic || !liveIntelligence.draftReady) return;
    clearGraceTimer();
    graceTimerRef.current = setTimeout(() => {
      graceTimerRef.current = null;
      setSubscribedTopic(null);
    }, TRANSCRIPT_GRACE_SETTLE_AFTER_DRAFT_MS);
  }, [liveTopic, subscribedTopic, liveIntelligence.draftReady, clearGraceTimer]);

  // Release the grace timer on unmount so a bounded keepalive never outlives the provider.
  useEffect(() => () => clearGraceTimer(), [clearGraceTimer]);

  // Drop the post-call grace subscription early (the operator dismissed the panel). Refuses
  // to touch a LIVE call's subscription — only the grace-held keepalive is released.
  const endLiveTranscriptGrace = useCallback(() => {
    if (liveTopicRef.current) return;
    clearGraceTimer();
    setSubscribedTopic(null);
  }, [clearGraceTimer]);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  // A Call object exists before provider acceptance; only this flag proves the
  // call is established enough that destroying the Device could interrupt it.
  const callAcceptedRef = useRef(false);
  const expiredDeviceRef = useRef<Device | null>(null);
  // Armed before microphone/device awaits so rapid clicks cannot create two
  // provider calls before callRef receives the first Call object.
  const callStartingRef = useRef(false);
  // The ringing inbound Call, held until the operator accepts or rejects it (A3).
  const incomingRef = useRef<Call | null>(null);
  // Guards concurrent boots (pad opens + click-to-call fire together).
  const bootingRef = useRef<Promise<Device | null> | null>(null);
  const mountedRef = useRef(true);

  // INT-345 — the workspace the current Device lifecycle belongs to. The token,
  // the `${tenantId}.${userId}` identity, the caller ID, and any live call are
  // all scoped to the tenant they were minted under (§9). `activeTenantId` is
  // read through this ref inside async boots so a mid-boot switch is detected
  // when the boot completes.
  const tenantRef = useRef<string | null>(activeTenantId);
  tenantRef.current = activeTenantId;
  const lastTenantRef = useRef<string | null>(activeTenantId);

  // INT-345 — workspace-scope teardown. A switch that does NOT reload the app
  // (the in-shell sub-account switch) must not carry the previous tenant's
  // registered Device into the new workspace: no token reuse, no stale caller
  // identity, no cross-tenant inbound/call state, no grace-held transcript
  // topic from the old workspace. Everything tears down to the idle surface;
  // the next warmUp boots fresh under the new tenant.
  useEffect(() => {
    if (lastTenantRef.current === activeTenantId) return;
    lastTenantRef.current = activeTenantId;
    if (
      !deviceRef.current && !bootingRef.current && !callRef.current &&
      !incomingRef.current && !expiredDeviceRef.current
    ) {
      return;
    }
    try { callRef.current?.disconnect(); } catch { /* already gone */ }
    try { incomingRef.current?.reject(); } catch { /* already gone */ }
    try { deviceRef.current?.destroy(); } catch { /* already gone */ }
    destroyDeferredVoiceDevice(expiredDeviceRef);
    deviceRef.current = null;
    callRef.current = null;
    incomingRef.current = null;
    callAcceptedRef.current = false;
    callStartingRef.current = false;
    clearGraceTimer();
    setSubscribedTopic(null);
    setActiveCall(null);
    setIncomingCall(null);
    setMuted(false);
    setReason(null);
    setStatus("idle");
  }, [activeTenantId, clearGraceTimer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSet = useCallback(<T,>(setter: (v: T) => void, v: T) => {
    if (mountedRef.current) setter(v);
  }, []);

  // ── Device boot (lazy, single-flight). Constructs + registers the ONE Device. ──
  const bootDevice = useCallback(async (): Promise<Device | null> => {
    if (deviceRef.current) return deviceRef.current;
    if (bootingRef.current) return bootingRef.current;

    const boot = (async (): Promise<Device | null> => {
      safeSet(setStatus, "connecting");
      safeSet(setReason, null);

      // INT-345 — the workspace this boot is FOR. Captured before any await; a
      // boot that completes after a switch must never register the old tenant's
      // freshly-minted Device under the new workspace.
      const bootTenant = tenantRef.current;

      const minted = await mintToken();
      if (minted.kind === "needs_config") {
        safeSet(setStatus, "needs_config");
        safeSet(setReason, minted.message);
        return null;
      }
      if (minted.kind === "error") {
        safeSet(setStatus, "error");
        safeSet(setReason, minted.message);
        return null;
      }

      // §14: load the owner-sanctioned SDK lazily — only when someone actually calls.
      let DeviceCtor: typeof Device;
      try {
        ({ Device: DeviceCtor } = await import("@twilio/voice-sdk"));
      } catch {
        safeSet(setStatus, "error");
        safeSet(setReason, "The calling module failed to load. Refresh and try again.");
        return null;
      }

      let device: Device;
      try {
        device = new DeviceCtor(minted.token, {
          // Keep the audio graph lean; A3 will extend codec/edge options.
          closeProtection: true,
        });
      } catch {
        safeSet(setStatus, "error");
        safeSet(setReason, "Couldn't start the calling device.");
        return null;
      }

      device.on("registered", () => {
        // Don't stomp an in-progress call's status.
        if (!callRef.current) safeSet(setStatus, "ready");
      });

      device.on("error", (err: TwilioError.TwilioError) => {
        const preserveConnectedCall = !!callRef.current && callAcceptedRef.current;
        const expired = discardExpiredVoiceDevice(
          err,
          device,
          deviceRef,
          preserveConnectedCall,
        );
        if (expired) {
          if (preserveConnectedCall) {
            // Quarantine immediately so no later call can reuse this Device, but
            // let the established call end before tearing down its audio graph.
            expiredDeviceRef.current = device;
            return;
          }
          // A Call object may exist before acceptance. It is not evidence of a
          // connected call and must not keep an expired Device or stale UI alive.
          callRef.current = null;
          callAcceptedRef.current = false;
          safeSet(setActiveCall, null);
          safeSet(setMuted, false);
          safeSet(setStatus, "error");
          safeSet(setReason, providerCallErrorMessage(err));
          return;
        }
        // §13/§32: a Device 'error' must NOT tear down a LIVE call's surface. Twilio
        // emits 'error' mid-call for non-fatal signaling/reconnect/edge conditions; if
        // we flipped status to "error" while a call is connected, DialPad's active-call
        // surface (timer + mute + the destructive HANG-UP) would unmount and the user
        // would be stuck on a still-live call with no way to end it. Real mid-call
        // failures are owned by call.on("error") below (which clears the call + resets
        // state). So only surface a Device-level error when there is NO active call.
        if (callRef.current) return;
        discardExpiredVoiceDevice(err, device, deviceRef);
        safeSet(setStatus, "error");
        safeSet(setReason, providerCallErrorMessage(err));
      });

      // §32: SHORT token refresh. Twilio fires this ~10s before expiry — re-mint and
      // hand the Device a fresh token so a live/idle registration never goes stale.
      device.on(TOKEN_REFRESH_EVENT, async () => {
        const applyFreshToken = async (): Promise<boolean> => {
          const next = await mintToken();
          if (next.kind !== "token") return false;
          try {
            device.updateToken(next.token);
            return true;
          } catch {
            return false;
          }
        };
        // One short-backoff retry absorbs a transient mint blip (network/502).
        let refreshed = await applyFreshToken();
        if (!refreshed) {
          await new Promise((r) => setTimeout(r, 1500));
          refreshed = await applyFreshToken();
        }
        // §32 "a stale token silently kills calling": if the refresh ultimately fails
        // AND no call is live, DESTROY the dead-but-registered Device so the next call()
        // re-boots with a fresh token — otherwise bootDevice() reuses the stale deviceRef
        // forever and calling is silently dead until a page reload. A live call is left
        // untouched (its own error path owns it); the dead registration is only reaped
        // when idle.
        if (!refreshed && !callRef.current) {
          try {
            device.destroy();
          } catch {
            /* ignore */
          }
          if (deviceRef.current === device) deviceRef.current = null;
          safeSet(setStatus, "idle");
        }
      });

      // A3 — real inbound handling. Twilio hands us the ringing Call; we surface it as
      // the IncomingCallOverlay (accept/reject) rather than auto-answering.
      device.on("incoming", (incoming: Call) => {
        // Single-call guard (A3 is single-call; multi-call is a tracked follow-up): if a
        // call is already LIVE or another is already RINGING, auto-reject the new one so
        // we never drop the active call or stack two ringing overlays.
        if (callRef.current || incomingRef.current) {
          try {
            incoming.reject();
          } catch {
            /* ignore — nothing to surface for the rejected second call */
          }
          return;
        }
        incomingRef.current = incoming;
        // Twilio populates call parameters with the caller's From on an inbound call.
        const fromRaw =
          incoming.parameters?.From ??
          incoming.parameters?.from ??
          "";
        safeSet(setIncomingCall, { from: fromRaw && fromRaw.length > 0 ? fromRaw : "Unknown caller" });
        safeSet(setStatus, "ringing");

        // If the caller hangs up (or Twilio cancels) BEFORE we accept, clear the overlay.
        const clearRinging = () => {
          if (incomingRef.current === incoming) incomingRef.current = null;
          safeSet(setIncomingCall, null);
          // Only fall back to ready/idle if this ring never became the live call.
          if (!callRef.current) safeSet(setStatus, deviceRef.current ? "ready" : "idle");
        };
        incoming.on("cancel", clearRinging);
        incoming.on("disconnect", clearRinging);
        incoming.on("reject", clearRinging);
        incoming.on("error", clearRinging);
      });

      try {
        await device.register();
      } catch {
        safeSet(setStatus, "error");
        safeSet(setReason, "Couldn't register for calling. Try again in a moment.");
        return null;
      }

      // INT-345 — mid-boot workspace switch: this Device was minted for the
      // previous tenant. The switch effect may already have torn it down; if the
      // switch landed while register() was pending it is destroyed HERE instead.
      // Either way it is never retained under the new workspace. "registered"
      // may have fired mid-await — reset so the surface never claims ready with
      // no retained Device.
      if (tenantRef.current !== bootTenant) {
        try { device.destroy(); } catch { /* already gone */ }
        safeSet(setStatus, "idle");
        return null;
      }

      deviceRef.current = device;
      return device;
    })();

    bootingRef.current = boot;
    const result = await boot;
    bootingRef.current = null;
    return result;
  }, [safeSet]);

  const warmUp = useCallback(() => {
    // Fire-and-forget; status reflects progress. Never throws to the caller.
    if (!deviceRef.current && status !== "connecting") void bootDevice();
  }, [bootDevice, status]);

  const wireCall = useCallback(
    (call: Call, number: string) => {
      callRef.current = call;
      callAcceptedRef.current = false;
      setMuted(false);

      call.on("accept", () => {
        callAcceptedRef.current = true;
        safeSet(setStatus, "in_call");
        // #140 B2 — capture the CallSid once the call is live so the co-pilot can build
        // the transcript topic. Twilio populates call.parameters.CallSid by accept.
        safeSet(setActiveCall, {
          number,
          startedAt: Date.now(),
          callSid: call.parameters?.CallSid ?? null,
        });
      });

      const end = () => {
        // Ignore late events from a Call already invalidated by an expired Device.
        if (callRef.current !== call) return;
        callRef.current = null;
        callAcceptedRef.current = false;
        destroyDeferredVoiceDevice(expiredDeviceRef);
        safeSet(setActiveCall, null);
        safeSet(setMuted, false);
        // Back to ready if the Device is still registered, else idle.
        safeSet(setStatus, deviceRef.current ? "ready" : "idle");
      };
      call.on("disconnect", end);
      call.on("cancel", end);
      call.on("reject", end);
      call.on("error", (err: TwilioError.TwilioError) => {
        if (callRef.current !== call) return;
        const currentDevice = deviceRef.current;
        callRef.current = null;
        callAcceptedRef.current = false;
        if (currentDevice) {
          discardExpiredVoiceDevice(err, currentDevice, deviceRef);
        }
        destroyDeferredVoiceDevice(expiredDeviceRef);
        safeSet(setStatus, "error");
        safeSet(setReason, providerCallErrorMessage(err));
        safeSet(setActiveCall, null);
      });
    },
    [safeSet],
  );

  const call = useCallback(
    async (rawNumber: string) => {
      const number = normalizeDialNumber(rawNumber);
      if (!isDialableNumber(number)) {
        safeSet(setStatus, "error");
        safeSet(setReason, "Enter a valid phone number, including the country code.");
        return;
      }
      if (!acquireCallStart(callStartingRef, !!callRef.current)) return;

      // Mic is required for outbound audio. Probe FIRST so a denial is a clear,
      // handled state (§13) instead of an opaque Device failure mid-connect.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Release the probe track immediately; Twilio acquires its own.
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        safeSet(setStatus, "error");
        safeSet(
          setReason,
          "Microphone access is blocked. Allow the mic in your browser to place calls.",
        );
        callStartingRef.current = false;
        return;
      }

      const device = await bootDevice();
      if (!device) {
        callStartingRef.current = false;
        return;
      }

      safeSet(setStatus, "connecting");
      // callSid is unknown until the call is accepted (set in wireCall's accept handler).
      safeSet(setActiveCall, { number, startedAt: Date.now(), callSid: null });
      try {
        const outbound = await device.connect({ params: { To: number } });
        wireCall(outbound, number);
      } catch (error) {
        const discarded = discardExpiredVoiceDevice(error, device, deviceRef);
        safeSet(setStatus, !discarded && deviceRef.current ? "ready" : "error");
        safeSet(setReason, providerCallErrorMessage(error));
        safeSet(setActiveCall, null);
      } finally {
        callStartingRef.current = false;
      }
    },
    [bootDevice, wireCall, safeSet],
  );

  const hangup = useCallback(() => {
    const c = callRef.current;
    if (c) {
      try {
        c.disconnect();
      } catch {
        /* disconnect handler resets state */
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    const next = !c.isMuted();
    c.mute(next);
    setMuted(next);
  }, []);

  // §3/§36: while a call is LIVE the keypad sends DTMF tones (touch-tone), not draft edits.
  // Only 0-9, *, # are valid DTMF; anything else is ignored so a stray key can't error.
  const sendDigit = useCallback((digit: string) => {
    const c = callRef.current;
    if (!c) return;
    if (!/^[0-9*#]$/.test(digit)) return;
    try {
      c.sendDigits(digit);
    } catch {
      /* a transient signaling blip on a tone is non-fatal; the call continues */
    }
  }, []);

  // ── Inbound accept/reject (A3) ────────────────────────────────────────────────
  const acceptIncoming = useCallback(() => {
    const incoming = incomingRef.current;
    if (!incoming) return;
    // Clear the ringing surface FIRST so the overlay dismisses immediately on tap.
    incomingRef.current = null;
    const callerFrom = incomingCall?.from ?? "Unknown caller";
    safeSet(setIncomingCall, null);
    safeSet(setStatus, "connecting");
    try {
      incoming.accept();
      // Reuse the SAME wiring as outbound so the in-call surface (timer + mute + DTMF +
      // destructive hang-up) behaves identically for an accepted inbound call.
      wireCall(incoming, callerFrom);
    } catch {
      safeSet(setStatus, deviceRef.current ? "ready" : "idle");
      safeSet(setReason, "Couldn't answer the call. Try again.");
    }
  }, [incomingCall, wireCall, safeSet]);

  const rejectIncoming = useCallback(() => {
    const incoming = incomingRef.current;
    incomingRef.current = null;
    safeSet(setIncomingCall, null);
    safeSet(setStatus, deviceRef.current ? "ready" : "idle");
    if (incoming) {
      try {
        incoming.reject();
      } catch {
        /* the ring's own listeners already reset state */
      }
    }
  }, [safeSet]);

  const openDialerWith = useCallback(
    (number: string) => {
      setDraft(number);
      setDialerOpen(true);
      warmUp();
    },
    [warmUp],
  );

  const callFrom = useCallback(
    (number: string) => {
      setDraft(number);
      setDialerOpen(true);
      void call(number);
    },
    [call],
  );

  // Clean up the Device on unmount so we never leak a registration (§18/§13).
  useEffect(() => {
    return () => {
      try {
        callRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        // Reject a still-ringing inbound call so we never leak an unanswered ring.
        incomingRef.current?.reject();
      } catch {
        /* ignore */
      }
      try {
        deviceRef.current?.destroy();
      } catch {
        /* ignore */
      }
      destroyDeferredVoiceDevice(expiredDeviceRef);
      deviceRef.current = null;
      callRef.current = null;
      incomingRef.current = null;
    };
  }, []);

  const value = useMemo<VoiceDeviceValue>(
    () => ({
      status,
      reason,
      call,
      hangup,
      muted,
      toggleMute,
      activeCall,
      sendDigit,
      liveTranscript,
      transcriptState,
      endLiveTranscriptGrace,
      liveIntelligence,
      incomingCall,
      acceptIncoming,
      rejectIncoming,
      dialerOpen,
      setDialerOpen,
      draft,
      setDraft,
      openDialerWith,
      callFrom,
      warmUp,
    }),
    [
      status,
      reason,
      call,
      hangup,
      muted,
      toggleMute,
      activeCall,
      sendDigit,
      liveTranscript,
      transcriptState,
      endLiveTranscriptGrace,
      liveIntelligence,
      incomingCall,
      acceptIncoming,
      rejectIncoming,
      dialerOpen,
      draft,
      openDialerWith,
      callFrom,
      warmUp,
    ],
  );

  return <VoiceDeviceContext.Provider value={value}>{children}</VoiceDeviceContext.Provider>;
}

/**
 * Consume the single Device. Returns null if no provider is mounted (e.g. a surface
 * outside the admin shell) so callers can degrade instead of crashing.
 */
export function useVoiceDevice(): VoiceDeviceValue | null {
  return useContext(VoiceDeviceContext);
}
