// messageTts — the ONE controller for per-message chat voice playback (#131). §18: a single
// shared HTMLAudioElement + one playing message at a time, so starting a new message ALWAYS stops
// the prior one (no overlapping voices), no matter which message button was clicked.
//
// It exposes a tiny external store (subscribe/getSnapshot) so every MessageAudioButton reflects the
// same live state via useSyncExternalStore. It owns NO React state itself and NO network code — the
// caller passes a `fetchAudio` that returns the authenticated Response or legacy Blob, keeping this module
// framework-agnostic and the auth/URL concerns at the call site.
//
// HONEST degrade (§13): a `tts_not_configured` code from the endpoint flips a workspace-level
// `needsConfig` flag — every button then shows the disabled/needs-config state (playback is a
// workspace capability, not a per-message one), never a broken/silent button.

export type TtsStatus = "idle" | "loading" | "playing" | "paused";

export interface TtsSnapshot {
  /** The message id currently loading or playing, else null. */
  activeId: string | null;
  status: TtsStatus;
  /** True once the endpoint reported the workspace has no TTS configured — disables all buttons. */
  needsConfig: boolean;
}

/** The result a caller's fetcher must throw on failure so we can distinguish needs-config. */
export interface TtsFetchError {
  needsConfig?: boolean;
  code?: string | null;
  status?: number;
  resetAt?: string | null;
  message?: string;
}

type Listener = () => void;
export type MessageAudio = Blob | Response;

/** Register before attaching/appending. Every wait owns cleanup and a bounded abort path. */
function mediaUpdate(target: EventTarget, event: string, signal: AbortSignal, run?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(event, done); target.removeEventListener("error", failed); signal.removeEventListener("abort", aborted); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Voice playback could not be decoded.")); };
    const aborted = () => { cleanup(); reject(new DOMException("Playback stopped", "AbortError")); };
    const timer = setTimeout(failed, 10_000);
    target.addEventListener(event, done, { once: true }); target.addEventListener("error", failed, { once: true }); signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    try { run?.(); } catch (error) { cleanup(); reject(error); }
  });
}

class MessageTtsController {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private snapshot: TtsSnapshot = { activeId: null, status: "idle", needsConfig: false };
  private listeners = new Set<Listener>();
  /** Monotonic token so a stale in-flight fetch can't resurrect playback after a newer start/stop. */
  private token = 0;
  private playToken = 0;
  private held = false;
  private request: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  // Ephemeral output timing only. Native Performance entries contain no business,
  // thread, message or voice identity; there is no network reporter or second store.
  private timing: { start: number; transport: "pending" | "legacy" | "buffered" | "progressive"; held: boolean; phases: Set<string>; serverTiming: Record<string, number> } | null = null;

  private recordTiming(phase: "request_start" | "first_chunk" | "body_complete" | "first_playback") {
    const timing = this.timing;
    if (!timing || timing.phases.has(phase)) return;
    timing.phases.add(phase);
    try {
      performance.measure(`paige.voice.message.${phase}`, {
        start: timing.start, end: phase === "request_start" ? timing.start : performance.now(),
        detail: { request: this.token, transport: timing.transport, held: timing.held, muted: this.audio?.muted === true || this.audio?.volume === 0, serverTiming: { ...timing.serverTiming } },
      });
    } catch { /* Optional measurement must never prevent or retry playback. */ }
  }

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): TtsSnapshot => this.snapshot;

  /** The existing output only; inspection never creates audio, fetches TTS, or starts playback. */
  getAudioElement = (): HTMLAudioElement | null => this.audio;

  pause = () => {
    if (!this.snapshot.activeId) return;
    this.held = true; this.playToken++;
    if (this.timing) this.timing.held = true;
    this.audio?.pause();
    this.emit({ status: "paused" });
  };

  resume = async () => {
    if (this.snapshot.status !== "paused") return;
    this.held = false;
    if (!this.audio || !this.objectUrl) { this.emit({ status: "loading" }); return; }
    const myToken = this.token, playToken = ++this.playToken;
    this.emit({ status: "loading" });
    try {
      await this.audio.play();
      if (myToken === this.token && playToken === this.playToken && !this.held) this.emit({ status: "playing" });
    } catch { if (myToken === this.token && playToken === this.playToken && !this.held) this.stop(); }
  };

  private emit(next: Partial<TtsSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const cb of this.listeners) cb();
  }

  private ensureAudio(): HTMLAudioElement {
    const a = this.audio ?? new Audio();
    const owner = this.token;
    a.onended = () => { if (owner === this.token) this.stop(); };
    a.onerror = () => { if (owner === this.token) this.stop(); };
    a.onwaiting = () => { if (owner === this.token && this.snapshot.activeId && !this.held) this.emit({ status: "loading" }); };
    a.onplaying = () => { if (owner === this.token && this.snapshot.activeId && !this.held) { this.recordTiming("first_playback"); this.emit({ status: "playing" }); } };
    this.audio = a;
    return a;
  }

  private revoke() {
    if (this.objectUrl) {
      try { URL.revokeObjectURL(this.objectUrl); } catch { /* noop */ }
      this.objectUrl = null;
    }
  }

  private reset() {
    this.revoke();
    this.emit({ activeId: null, status: "idle" });
  }

  /** Stop any current playback/loading and clear state. */
  stop = () => {
    this.token++; this.playToken++; this.held = false;
    this.timing = null;
    this.request?.abort(); this.request = null;
    void this.reader?.cancel().catch(() => undefined); this.reader = null;
    if (this.audio) {
      this.audio.pause();
      try { this.audio.currentTime = 0; } catch { /* no seekable range yet */ }
      // Empty-string src starts a failing document request in real browsers and can
      // deliver a late error into the next owner. Remove/detach the media instead.
      this.audio.removeAttribute?.("src");
      this.audio.load?.();
    }
    this.reset();
  };

  private async playBlob(blob: Blob, myToken: number): Promise<void> {
    if (myToken !== this.token) return;
    if (!blob.size) throw new Error("Voice playback returned no audio.");
    this.objectUrl = URL.createObjectURL(blob);
    const audio = this.ensureAudio(); audio.src = this.objectUrl;
    if (this.held) return;
    const playToken = ++this.playToken;
    await audio.play();
    // A late play completion must NEVER stop a newer message on the shared element.
    if (myToken === this.token && playToken === this.playToken && !this.held) this.emit({ status: "playing" });
  }

  private async playResponse(response: Response, myToken: number, signal: AbortSignal, onError?: (e: TtsFetchError) => void): Promise<void> {
    if (!response.ok || !response.body || !/^audio\/(mpeg|mp3)(?:;|$)/i.test(response.headers.get("Content-Type") ?? "")) throw new Error("Voice playback returned an unsupported response.");
    // Correlate the SAME response's numeric stages without publishing a server
    // request reference, voice/profile identity, raw header or customer content.
    const rawTiming = response.headers.get("Server-Timing") ?? "";
    if (this.timing && rawTiming.length <= 2048) {
      const stages: Record<string, number> = {};
      const duplicates = new Set<string>();
      for (const match of rawTiming.matchAll(/(?:^|,)\s*(voice_first_byte|voice_settlement|voice_ready|voice_cache)\s*;\s*dur=([0-9]+(?:\.[0-9]+)?)(?=\s*(?:,|$))/g)) {
        const value = Number(match[2]);
        if (!Number.isFinite(value) || value > 86_400_000) continue;
        if (match[1] in stages || duplicates.has(match[1])) { delete stages[match[1]]; duplicates.add(match[1]); }
        else stages[match[1]] = value;
      }
      this.timing.serverTiming = stages;
    }
    let progressive = false;
    try { progressive = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg"); } catch { /* use same-response buffered fallback */ }
    if (this.timing) this.timing.transport = progressive ? "progressive" : "buffered";
    if (!progressive) {
      const blob = await response.blob();
      if (myToken === this.token) this.recordTiming("body_complete");
      await this.playBlob(blob, myToken); return;
    }
    const reader = response.body.getReader(); this.reader = reader;
    try {
      const source = new MediaSource();
      const opened = mediaUpdate(source, "sourceopen", signal);
      this.objectUrl = URL.createObjectURL(source);
      const audio = this.ensureAudio(); audio.src = this.objectUrl;
      await opened;
      if (myToken !== this.token || signal.aborted) return;
      const buffer = source.addSourceBuffer("audio/mpeg");
      let bytes = 0, requestedPlay = false;
      while (myToken === this.token && !signal.aborted) {
        const chunk = await reader.read();
        if (myToken !== this.token || signal.aborted) return;
        if (chunk.done) break;
        if (!chunk.value.length) continue;
        this.recordTiming("first_chunk");
        bytes += chunk.value.length;
        await mediaUpdate(buffer, "updateend", signal, () => buffer.appendBuffer(chunk.value.slice().buffer));
        if (!requestedPlay && !this.held && myToken === this.token) {
          requestedPlay = true;
          const playToken = ++this.playToken;
          // Do not await play here: the decoder may need another network chunk to start.
          void audio.play().then(() => {
            if (myToken === this.token && playToken === this.playToken && !this.held) this.emit({ status: "playing" });
          }).catch(error => {
            if (myToken !== this.token || playToken !== this.playToken || this.held) return;
            this.stop(); onError?.(error as TtsFetchError);
          });
        }
      }
      if (myToken !== this.token || signal.aborted) return;
      if (!bytes) throw new Error("Voice playback returned no audio.");
      this.recordTiming("body_complete");
      if (source.readyState === "open") source.endOfStream();
    } finally {
      reader.releaseLock();
      if (this.reader === reader) this.reader = null;
    }
  }

  /** One explicit request and one output owner; unsupported browsers reuse the same body. */
  toggle = async (
    id: string,
    fetchAudio: (signal: AbortSignal) => Promise<MessageAudio>,
    onError?: (e: TtsFetchError) => void,
  ): Promise<void> => {
    if (this.snapshot.activeId === id && this.snapshot.status === "paused") { await this.resume(); return; }
    if (this.snapshot.activeId === id && this.snapshot.status !== "idle") { this.stop(); return; }
    let started: number | null = null;
    try { const at = performance.now(); if (Number.isFinite(at)) started = at; } catch { /* unsupported timing is harmless */ }
    this.stop();
    const myToken = ++this.token;
    if (started !== null) this.timing = { start: started, transport: "pending", held: false, phases: new Set(), serverTiming: {} };
    this.recordTiming("request_start");
    const request = new AbortController(); this.request = request;
    this.emit({ activeId: id, status: "loading" });
    try {
      const audio = await fetchAudio(request.signal);
      if (myToken !== this.token || request.signal.aborted) return;
      if (audio instanceof Blob) {
        if (this.timing) this.timing.transport = "legacy";
        this.recordTiming("body_complete");
        await this.playBlob(audio, myToken);
      }
      else await this.playResponse(audio, myToken, request.signal, onError);
    } catch (e) {
      if (myToken !== this.token) return;
      const err = (e ?? {}) as TtsFetchError;
      this.stop();
      if (err.needsConfig) this.emit({ needsConfig: true });
      onError?.(err);
    }
  };
}

export const messageTts = new MessageTtsController();
