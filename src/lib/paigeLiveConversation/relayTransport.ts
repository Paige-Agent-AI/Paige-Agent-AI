import { AudioRecorder } from "@/utils/VoiceAudio";
import { SILENT_ENERGY, type AudioEnergy } from "./presence";

export type RelayTransportState =
  | { kind: "ready" }
  | { kind: "speaking" }
  | { kind: "unavailable"; message: string }
  | { kind: "permission-denied" }
  | { kind: "disconnected" };

export interface RelayTransport {
  subscribeOutput(listener: () => void): () => void;
  outputPlaying(): boolean;
  readEnergy(): AudioEnergy;
  pauseOutput(): void;
  resumeOutput(): void;
  clearOutput(): void;
  interrupt(): void;
  setMuted(muted: boolean): void;
  runtimeProof(turnId: string, proof: string): void;
  runtimeFailed(turnId: string): void;
  stop(): void;
}

function pcm16(samples: Float32Array): ArrayBuffer {
  const output = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output.buffer;
}

function relayUrl(sessionId: string, ticket: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const params = new URLSearchParams({ session: sessionId, ticket });
  if (apikey) params.set("apikey", apikey);
  return base.replace(/^http/, "ws").replace(/\/$/, "") + "/functions/v1/paige-live-relay?" + params;
}

/**
 * First-party audio transport. No vendor SDK or key enters the browser.
 * Capture starts only after a server ready frame; the provider-free server
 * never sends ready, so it never asks for microphone permission.
 */
export function connectPaigeLiveRelay(input: Readonly<{
  sessionId: string;
  ticket: string;
  onState: (state: RelayTransportState) => void;
  onTranscript?: (text: string, final: boolean, turnId: string) => void;
  onVoiceTurn?: (text: string, turnId: string, challenge: string) => void;
  onRuntimeCancel?: (turnId: string) => void;
}>): RelayTransport {
  const socket = new WebSocket(relayUrl(input.sessionId, input.ticket));
  socket.binaryType = "arraybuffer";
  let recorder: AudioRecorder | null = null;
  let context: AudioContext | null = null;
  let nextPlayAt = 0;
  let activeSources = new Set<AudioBufferSourceNode>();
  let pendingPlayback = 0;
  let playbackEpoch = 0;
  let interruptSequence = 0;
  let pendingInterrupt: number | null = null;
  let interruptTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let terminal = false;
  let runtimeDone = false;
  let muted = false;
  let speaking = false;
  let wasReady = false;
  let held = false;
  let analyser: AnalyserNode | null = null;
  let samples = new Uint8Array(0);
  let spectrum = new Uint8Array(0);
  const outputListeners = new Set<() => void>();
  const notifyOutput = () => outputListeners.forEach((listener) => listener());
  const outputPlaying = () => speaking && !held && !stopped && !terminal && context?.state === "running";

  const clearInterrupt = () => {
    clearTimeout(interruptTimer);
    interruptTimer = undefined;
    pendingInterrupt = null;
  };

  const clearPlayback = () => {
    playbackEpoch++;
    pendingPlayback = 0;
    for (const source of activeSources) { try { source.stop(); } catch { /* already ended */ } }
    activeSources = new Set();
    nextPlayAt = 0;
    runtimeDone = false;
    speaking = false;
    notifyOutput();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterrupt();
    recorder?.stop();
    recorder = null;
    clearPlayback();
    if (context) { void context.close(); context = null; }
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "end" }));
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000, "owner_end");
  };
  const maybePlaybackDone = () => {
    if (runtimeDone && !held && !pendingPlayback && !activeSources.size && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "playback.complete" }));
      runtimeDone = false;
      speaking = false;
      notifyOutput();
      input.onState({ kind: "ready" });
    }
  };
  const playPcm = async (data: ArrayBuffer) => {
    if (stopped || terminal || data.byteLength < 2 || data.byteLength % 2) return;
    const epoch = playbackEpoch;
    pendingPlayback++;
    try {
      const playbackContext = context ??= new AudioContext();
      if (held) await playbackContext.suspend();
      if (playbackContext.state === "suspended" && !held) await playbackContext.resume();
      if (held && playbackContext.state === "running") await playbackContext.suspend();
      if (stopped || terminal || epoch !== playbackEpoch || socket.readyState !== WebSocket.OPEN) return;
      const values = new Int16Array(data);
      const buffer = playbackContext.createBuffer(1, values.length, 16_000);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < values.length; i++) channel[i] = values[i] / 0x8000;
      const source = playbackContext.createBufferSource();
      source.buffer = buffer;
      if (!analyser && typeof playbackContext.createAnalyser === "function") {
        analyser = playbackContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = .15;
        analyser.connect(playbackContext.destination);
        samples = new Uint8Array(analyser.fftSize);
        spectrum = new Uint8Array(analyser.frequencyBinCount);
      }
      source.connect(analyser ?? playbackContext.destination);
      activeSources.add(source);
      source.onended = () => {
        activeSources.delete(source);
        if (!activeSources.size && !pendingPlayback) { speaking = false; notifyOutput(); }
        maybePlaybackDone();
      };
      nextPlayAt = Math.max(playbackContext.currentTime, nextPlayAt);
      source.start(nextPlayAt);
      if (!speaking) { speaking = true; notifyOutput(); if (!held) input.onState({ kind: "speaking" }); }
      nextPlayAt += buffer.duration;
    } catch {
      if (!stopped && !terminal) {
        terminal = true;
        clearInterrupt();
        clearPlayback();
        input.onState({ kind: "unavailable", message: "Live audio stopped before Paige could speak. You can continue in chat." });
        if (socket.readyState === WebSocket.OPEN) socket.close(1011, "playback_failed");
      }
    } finally {
      if (epoch === playbackEpoch) { pendingPlayback--; maybePlaybackDone(); }
    }
  };

  socket.onmessage = (event) => {
    if (stopped || terminal) return;
    // Old PCM already in flight must not restart playback after a local interrupt.
    // The matching server acknowledgement is an ordered cancellation barrier.
    if (event.data instanceof ArrayBuffer) { if (pendingInterrupt === null) void playPcm(event.data); return; }
    if (typeof event.data !== "string") return;
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(event.data) as Record<string, unknown>; } catch { return; }
    if (frame.type === "unavailable" || frame.type === "error") {
      terminal = true;
      clearInterrupt();
      recorder?.stop();
      recorder = null;
      clearPlayback();
      input.onState({
        kind: "unavailable",
        message: wasReady
          ? "Live audio stopped. Your conversation is still here, and you can continue in chat."
          : "Live audio is not connected yet. You can keep working with Paige in chat.",
      });
    } else if (frame.type === "ready") {
      const nextRecorder = new AudioRecorder((samples) => {
        if (socket.readyState === WebSocket.OPEN && !stopped && !terminal && !muted) socket.send(pcm16(samples));
      }, 16_000, 1024);
      recorder = nextRecorder;
      void nextRecorder.start().then(() => {
        if (stopped || terminal || recorder !== nextRecorder || socket.readyState !== WebSocket.OPEN) { nextRecorder.stop(); return; }
        socket.send(JSON.stringify({ type: "start", sampleRate: 16_000 }));
        wasReady = true;
        input.onState({ kind: "ready" });
      }).catch(() => {
        if (stopped || terminal || recorder !== nextRecorder) return;
        terminal = true;
        input.onState({ kind: "permission-denied" });
        stop();
      });
    } else if (frame.type === "transcript" && typeof frame.text === "string" &&
      typeof frame.turn_id === "string") {
      input.onTranscript?.(frame.text, frame.is_final === true, frame.turn_id);
    } else if (frame.type === "runtime.dispatch" && typeof frame.text === "string" &&
      typeof frame.turn_id === "string" && typeof frame.challenge === "string") {
      input.onVoiceTurn?.(frame.text, frame.turn_id, frame.challenge);
    } else if (frame.type === "runtime.cancel" && typeof frame.turn_id === "string") {
      input.onRuntimeCancel?.(frame.turn_id);
    } else if (frame.type === "interrupt.ack") {
      if (pendingInterrupt !== null && frame.request_id === pendingInterrupt) clearInterrupt();
    } else if (frame.type === "runtime.done" && pendingInterrupt === null) {
      runtimeDone = true;
      maybePlaybackDone();
    } else if (frame.type === "clear_playback") {
      clearPlayback();
    }
  };
  socket.onerror = () => { /* onclose emits one truthful state */ };
  socket.onclose = () => {
    const unexpected = !stopped && !terminal;
    terminal = true;
    clearInterrupt();
    recorder?.stop();
    recorder = null;
    clearPlayback();
    if (context) { void context.close(); context = null; }
    if (unexpected) input.onState({ kind: "disconnected" });
  };
  return {
    subscribeOutput(listener) { outputListeners.add(listener); return () => { outputListeners.delete(listener); }; },
    outputPlaying,
    readEnergy() {
      if (!outputPlaying() || context?.state !== "running" || !analyser) return SILENT_ENERGY;
      analyser.getByteTimeDomainData(samples);
      analyser.getByteFrequencyData(spectrum);
      let sum = 0, high = 0;
      for (const value of samples) sum += ((value - 128) / 128) ** 2;
      for (let i = spectrum.length / 2; i < spectrum.length; i++) high += spectrum[i];
      return { amplitude: Math.min(1, Math.sqrt(sum / samples.length) * 3), brightness: Math.min(1, high / (spectrum.length / 2 * 255)) };
    },
    pauseOutput() { held = true; notifyOutput(); void context?.suspend().catch(() => { stop(); input.onState({ kind: "disconnected" }); }); },
    resumeOutput() { held = false; maybePlaybackDone(); void context?.resume().then(notifyOutput).catch(() => { stop(); input.onState({ kind: "disconnected" }); }); },
    clearOutput: clearPlayback,
    setMuted(value) { muted = value; },
    runtimeProof(turnId, proof) {
      if (socket.readyState === WebSocket.OPEN && !terminal && !stopped)
        socket.send(JSON.stringify({ type: "runtime.proof", turn_id: turnId, proof }));
    },
    runtimeFailed(turnId) {
      if (socket.readyState === WebSocket.OPEN && !terminal && !stopped)
        socket.send(JSON.stringify({ type: "runtime.failed", turn_id: turnId }));
    },
    interrupt() {
      if (stopped || terminal) return;
      held = false;
      if (interruptSequence === Number.MAX_SAFE_INTEGER) { stop(); input.onState({ kind: "disconnected" }); return; }
      clearInterrupt();
      const requestId = ++interruptSequence;
      pendingInterrupt = requestId;
      // A stalled peer or an older relay cannot leave this conversation silently muted.
      interruptTimer = setTimeout(() => {
        if (pendingInterrupt !== requestId || stopped || terminal) return;
        stop();
        input.onState({ kind: "disconnected" });
      }, 5_000);
      clearPlayback();
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "interrupt", request_id: pendingInterrupt }));
    },
    stop,
  };
}
