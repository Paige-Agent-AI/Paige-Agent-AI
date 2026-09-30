/**
 * Interprets the ONE provider-neutral Live relay reducer for the existing
 * first-party WebSocket. Ears and mouth are injected; this module owns no
 * provider credential, price, tenant resolution, approval, or second brain.
 */
import {
  createRelayState, reduceRelay, type RelayEffect, type RelayEvent,
  type RelayFramePayload, type RelayState, type UsageSink,
} from "./paige-live-relay-contract.ts";
import { sameLiveRuntimeScope, type LiveRuntimeScope, type LiveRuntimeOutput } from "./paige-live-runtime-proof.ts";

export interface LiveEars {
  sendPcm(bytes: ArrayBuffer): number | null;
  close(): void;
  cancel(): void;
}
export interface LiveEarsEvents {
  startOfTurn(text: string, turnIndex: number): void;
  partial(text: string, turnIndex: number): void;
  final(text: string, turnIndex: number): void;
  unavailable(): void;
}
export type LiveEarsOpener = (events: LiveEarsEvents) => Promise<
  { ok: true; ears: LiveEars } | { ok: false; code: string }
>;
export type LiveMouthOpener = (text: string, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;

/** Bounded authorization freshness, not a usage lease or spend limit. The
 * existing Edge resolver supplies the decision. No stale-while-revalidate:
 * PCM waits during a check, and a missing/failed check closes the adapters. */
export class LiveRelayAdmission {
  private validUntil = 0;
  private pending: Promise<boolean> | null = null;
  private closed = false;
  constructor(private readonly read: () => Promise<boolean>, private readonly deny: () => void,
    private readonly now: () => number = Date.now) {}

  check(force = false): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    if (this.pending) return this.pending;
    if (!force && this.now() < this.validUntil) return Promise.resolve(true);
    const began = this.now();
    let timeout: ReturnType<typeof setTimeout>;
    this.pending = Promise.race([
      Promise.resolve().then(this.read).catch(() => false),
      new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), 1_000); }),
    ]).then((allowed) => {
      if (this.closed) return false;
      if (!allowed || this.now() - began >= 1_000) {
        this.closed = true;
        this.deny();
        return false;
      }
      this.validUntil = began + 500;
      return true;
    }).finally(() => { clearTimeout(timeout); this.pending = null; });
    return this.pending;
  }

  stop(): void { this.closed = true; this.validUntil = 0; }
}

export interface LiveBridgeOptions {
  sessionId: string;
  epoch: string;
  send: (frame: string | ArrayBuffer) => void;
  close: (code: number, reason: string) => void;
  openEars: LiveEarsOpener;
  openMouth: LiveMouthOpener;
  usage: UsageSink;
  authorize: (force?: boolean) => Promise<boolean>;
  runtimeProof: {
    issue(turnId: string, transcript: string): Promise<{ token: string; scope: LiveRuntimeScope }>;
    readOutput(token: string): Promise<LiveRuntimeOutput | null>;
  };
  onFailure?: (code: string) => void;
  now?: () => number;
}

const MAX_RUNTIME_CHUNK = 4_096;
const MAX_RUNTIME_TURN = 32_000;
const MAX_AUDIO_FRAME = 32_000;
const MAX_CONTROL_FRAME = 16_384;

export class PaigeLiveRelayBridge {
  private state: RelayState;
  private ears: LiveEars | null = null;
  private started = false;
  private readySent = false;
  private ended = false;
  private fluxTurnIndex = -1;
  private earSeq = 0;
  private runtimeSeq = 0;
  private mouthSeq = 0;
  private audioRemainderMs = 0;
  private speechQueue: Promise<void> = Promise.resolve();
  private speechGeneration = 0;
  private speechController: AbortController | null = null;
  private runtimeEndRequested = false;
  private runtimeEndSent = false;
  private runtimeCharacters = 0;
  private runtimeScope: LiveRuntimeScope | null = null;
  private runtimeStreamId: string | null = null;
  private runtimeProofSeq = -1;
  private proofQueue: Promise<void> = Promise.resolve();
  private issueQueue: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private pendingAudioBytes = 0;

  constructor(private readonly options: LiveBridgeOptions) {
    this.now = options.now ?? Date.now;
    this.state = createRelayState({
      sessionId: options.sessionId,
      epoch: options.epoch,
      ticketId: "consumed",
      ticketExpiresAt: Number.MAX_SAFE_INTEGER,
    });
  }

  get phase(): RelayState["phase"] { return this.state.phase; }

  async open(): Promise<boolean> {
    if (this.ended) return false;
    let result: Awaited<ReturnType<LiveEarsOpener>>;
    try {
      if (!await this.options.authorize(true)) { this.fail("live_admission_changed"); return false; }
      if (this.ended) return false;
      result = await this.options.openEars({
        startOfTurn: (text, index) => this.onStartOfTurn(text, index),
        partial: (text, index) => this.onTranscript(text, index, false),
        final: (text, index) => this.onTranscript(text, index, true),
        unavailable: () => this.fail("ears_unavailable"),
      });
    } catch {
      this.fail("ears_unavailable");
      return false;
    }
    if (this.ended) {
      if (result.ok) result.ears.cancel();
      return false;
    }
    if (!result.ok) {
      this.fail(result.code);
      return false;
    }
    this.ears = result.ears;
    try {
      if (!await this.options.authorize(true)) { this.fail("live_admission_changed"); return false; }
    } catch { this.fail("live_admission_unavailable"); return false; }
    if (this.ended) return false;
    return true;
  }

  /** Only the authenticated Edge boundary may call this, after LIVE is durably read back. */
  ready(): void {
    if (this.ended || !this.ears || this.readySent) return;
    this.readySent = true;
    this.send({ type: "ready" });
  }

  receive(data: string | ArrayBuffer): void | Promise<void> {
    if (this.ended) return;
    if (data instanceof ArrayBuffer) {
      return this.receiveAudio(data);
    }
    if (typeof data !== "string" || data.length > MAX_CONTROL_FRAME) {
      this.fail("invalid_live_frame");
      return;
    }
    let frame: Record<string, unknown>;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      frame = parsed as Record<string, unknown>;
    } catch {
      this.fail("invalid_live_frame");
      return;
    }
    if (frame.type === "start" && frame.sampleRate === 16_000 &&
      this.readySent && this.ears && !this.started) {
      this.started = true;
      this.startTurn();
      return;
    }
    if (!this.started) { this.fail("audio_not_ready"); return; }
    if (frame.type === "interrupt") {
      const hasRequestId = Object.hasOwn(frame, "request_id");
      if (hasRequestId && (typeof frame.request_id !== "number" || !Number.isSafeInteger(frame.request_id) || frame.request_id <= 0)) {
        this.fail("invalid_live_frame"); return;
      }
      this.interrupt();
      // Cancel/abort and playback-clear effects run synchronously before this
      // ordered barrier. Already-interrupted turns still acknowledge each tap.
      // Older clients omit the ID and keep their existing protocol.
      if (hasRequestId) this.send({ type: "interrupt.ack", request_id: frame.request_id });
      return;
    }
    if (frame.type === "end") { this.end(); return; }
    if (frame.type === "playback.complete") {
      const turn = this.state.currentTurn;
      if (turn) this.apply({ kind: "playback.complete", at: this.now(), turnId: turn.id });
      return;
    }
    const turn = this.state.currentTurn;
    if (!turn || typeof frame.turn_id !== "string" || frame.turn_id !== turn.id || turn.interrupted) return;
    if (frame.type === "runtime.proof" && typeof frame.proof === "string") {
      const turnId = turn.id;
      const proof = frame.proof;
      this.proofQueue = this.proofQueue.then(() => this.acceptRuntimeProof(turnId, proof))
        .catch(() => this.fail("runtime_proof_invalid"));
      return this.proofQueue;
    } else if (frame.type === "runtime.failed") {
      this.fail("runtime_unavailable");
    } else {
      this.fail("invalid_live_frame");
    }
  }

  private async acceptRuntimeProof(turnId: string, token: string): Promise<void> {
    const output = await this.options.runtimeProof.readOutput(token);
    const turn = this.state.currentTurn;
    // Cancellation and barge-in remain immediate while verification is pending.
    if (this.ended || !turn || turn.id !== turnId || turn.interrupted) return;
    if (!output || !this.runtimeScope || !sameLiveRuntimeScope(output.scope, this.runtimeScope) ||
      output.seq !== this.runtimeProofSeq + 1 || turn.runtimeDone) {
      this.fail("runtime_proof_invalid"); return;
    }
    if (output.kind === "start" && output.seq === 0 && !turn.runtimeDispatched) {
      this.runtimeStreamId = output.streamId;
      this.apply({ kind: "runtime.dispatched", at: this.now(), turnId });
    } else if (output.streamId !== this.runtimeStreamId || !turn.runtimeDispatched) {
      this.fail("runtime_proof_invalid"); return;
    } else if (output.kind === "chunk" && output.text && output.text.length <= MAX_RUNTIME_CHUNK &&
      this.runtimeCharacters + output.text.length <= MAX_RUNTIME_TURN) {
      this.runtimeCharacters += output.text.length;
      this.frame("runtime", ++this.runtimeSeq, { kind: "runtime.chunk", text: output.text });
    } else if (output.kind === "done") {
      this.frame("runtime", ++this.runtimeSeq, { kind: "runtime.done" });
      this.runtimeEndRequested = true;
      this.maybeSendRuntimeDone();
    } else { this.fail("runtime_proof_invalid"); return; }
    this.runtimeProofSeq = output.seq;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.apply({ kind: "session.cancel", at: this.now(), reason: "owner_end" });
    this.ears?.close();
    this.options.close(1000, "owner_end");
  }

  /** Fail visibly when the authenticated session can no longer be marked live. */
  unavailable(code: string): void { this.fail(code); }

  private send(frame: Record<string, unknown>): void {
    if (!this.ended) this.options.send(JSON.stringify(frame));
  }

  private fail(code: string): void {
    if (this.ended) return;
    this.send({
      type: "unavailable", code,
      message: "Live audio stopped. Your conversation is still here, and you can continue in chat.",
    });
    this.ended = true;
    this.options.onFailure?.(code);
    this.apply({ kind: "session.cancel", at: this.now(), reason: code });
    this.ears?.cancel();
    this.options.close(1011, code.slice(0, 120));
  }

  private startTurn(): void {
    const turnId = crypto.randomUUID();
    const transition = this.apply({ kind: "turn.start", at: this.now(), turnId });
    if (!transition.some((effect) => effect.kind === "ears.start")) return;
    this.earSeq = 0;
    this.runtimeSeq = 0;
    this.mouthSeq = 0;
    this.audioRemainderMs = 0;
    this.runtimeCharacters = 0;
    this.runtimeScope = null;
    this.runtimeStreamId = null;
    this.runtimeProofSeq = -1;
    this.runtimeEndRequested = false;
    this.runtimeEndSent = false;
    this.send({ type: "turn.start", turn_id: turnId });
  }

  private interrupt(): void {
    const turn = this.state.currentTurn;
    if (!turn || turn.interrupted) return;
    this.apply({ kind: "turn.interrupt", at: this.now(), turnId: turn.id });
  }

  private onStartOfTurn(text: string, index: number): void {
    if (this.ended || !this.started || index < this.fluxTurnIndex) return;
    if (index > this.fluxTurnIndex) {
      this.fluxTurnIndex = index;
      const current = this.state.currentTurn;
      if (current && current.finalTranscript !== null && !current.playbackComplete) this.interrupt();
      if (!current || current.interrupted || current.playbackComplete) this.startTurn();
    }
    if (text.trim()) this.onTranscript(text, index, false);
  }

  private onTranscript(text: string, index: number, final: boolean): void {
    if (this.ended || !this.started || !text.trim() || index < this.fluxTurnIndex) return;
    if (index > this.fluxTurnIndex) this.onStartOfTurn("", index);
    const turn = this.state.currentTurn;
    if (!turn || turn.interrupted || turn.playbackComplete) return;
    this.frame("ears", ++this.earSeq, { kind: final ? "transcript.final" : "transcript.partial", text });
    this.send({ type: "transcript", turn_id: turn.id, text, is_final: final });
  }

  private async receiveAudio(data: ArrayBuffer): Promise<void> {
    if (!this.started || !this.ears || data.byteLength < 2 ||
      data.byteLength > MAX_AUDIO_FRAME || data.byteLength % 2 !== 0) {
      this.fail("invalid_audio_frame");
      return;
    }
    // Bound only the in-flight transport buffer; this is not a usage allowance.
    this.pendingAudioBytes += data.byteLength;
    if (this.pendingAudioBytes > MAX_AUDIO_FRAME) {
      this.pendingAudioBytes -= data.byteLength;
      this.fail("live_admission_unavailable");
      return;
    }
    let authorized = false;
    try { authorized = await this.options.authorize(); }
    catch { this.fail("live_admission_unavailable"); }
    finally { this.pendingAudioBytes -= data.byteLength; }
    if (this.ended) return;
    if (!authorized) { this.fail("live_admission_changed"); return; }
    if (this.state.currentTurn?.playbackComplete) this.startTurn();
    const durationMs = this.ears.sendPcm(data);
    if (durationMs === null) { this.fail("ears_unavailable"); return; }
    const turn = this.state.currentTurn;
    if (!turn || turn.interrupted || turn.playbackComplete) return;
    this.audioRemainderMs += durationMs;
    const wholeMs = Math.floor(this.audioRemainderMs);
    if (wholeMs > 0) {
      this.audioRemainderMs -= wholeMs;
      this.frame("ears", ++this.earSeq, { kind: "audio.observed", durationMs: wholeMs });
    }
  }

  private frame(source: "ears" | "runtime" | "mouth", seq: number, payload: RelayFramePayload): void {
    const turn = this.state.currentTurn;
    if (!turn) return;
    this.apply({
      kind: "frame", at: this.now(), sessionId: this.options.sessionId,
      epoch: this.options.epoch, turnId: turn.id, source, seq, payload,
    });
  }

  private apply(event: RelayEvent): RelayEffect[] {
    const transition = reduceRelay(this.state, event);
    this.state = transition.state;
    for (const effect of transition.effects) this.effect(effect);
    return transition.effects;
  }

  private effect(effect: RelayEffect): void {
    switch (effect.kind) {
      case "ears.start":
        // One Flux stream spans successive turns. The reducer owns turn state;
        // cancelled old turn frames are fenced by turn index and sequence.
        break;
      case "ears.cancel":
        // Keep the capture socket open to hear a barge-in. Logical cancellation
        // fences the old turn; closing this socket would drop the new utterance.
        break;
      case "runtime.dispatch":
        this.issueQueue = this.issueQueue.then(async () => {
          if (this.ended || this.state.currentTurn?.id !== effect.turnId || this.state.currentTurn.interrupted) return;
          const { token, scope } = await this.options.runtimeProof.issue(effect.turnId, effect.transcript);
          if (this.ended || this.state.currentTurn?.id !== effect.turnId || this.state.currentTurn.interrupted) return;
          this.runtimeScope = scope;
          this.send({ type: "runtime.dispatch", turn_id: effect.turnId, text: effect.transcript, challenge: token });
        }).catch(() => this.fail("runtime_unavailable"));
        break;
      case "runtime.cancel":
        this.send({ type: "runtime.cancel", turn_id: effect.turnId });
        break;
      case "mouth.synthesize":
        this.queueSpeech(effect.turnId, effect.text);
        break;
      case "mouth.cancel":
        this.speechGeneration++;
        this.speechController?.abort();
        break;
      case "client.clear_playback":
        this.send({ type: "clear_playback", turn_id: effect.turnId });
        break;
      case "usage.emit":
        // Neutral measurement only. No budget, pricing, reserve or refusal.
        try {
          const result = this.options.usage.emit(effect.event);
          if (result instanceof Promise) void result.catch(() => undefined);
        } catch { /* measurement cannot block a turn */ }
        break;
      case "turn.rejected":
        // Stale/duplicate frames are fenced; never reflect transcript or secrets.
        break;
      case "governance.review":
        // Speech has no execution effect. The canonical chat runtime decides
        // whether to show a governed confirmation card.
        break;
    }
  }

  private queueSpeech(turnId: string, text: string): void {
    const generation = this.speechGeneration;
    this.speechQueue = this.speechQueue.then(async () => {
      if (this.ended || generation !== this.speechGeneration ||
        this.state.currentTurn?.id !== turnId) return;
      const controller = new AbortController();
      this.speechController = controller;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let carry: number | null = null;
      let observed = false;
      try {
        const stream = await this.options.openMouth(text, controller.signal);
        reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (this.ended || controller.signal.aborted || generation !== this.speechGeneration ||
            this.state.currentTurn?.id !== turnId) return;
          if (!value?.byteLength) continue;
          const bytes: Uint8Array = carry === null ? value : new Uint8Array(value.byteLength + 1);
          if (carry !== null) {
            bytes[0] = carry;
            bytes.set(value, 1);
          }
          const even: number = bytes.byteLength - (bytes.byteLength % 2);
          carry = even < bytes.byteLength ? bytes[even] : null;
          if (!even) continue;
          this.options.send(bytes.slice(0, even).buffer);
          this.frame("mouth", ++this.mouthSeq, { kind: "audio.chunk", bytes: even });
          if (!observed) {
            observed = true;
            this.apply({ kind: "mouth.synthesized", at: this.now(), turnId, characters: text.length });
          }
        }
        if (!observed || carry !== null) throw new Error("incomplete_pcm");
      } catch {
        if (!controller.signal.aborted && generation === this.speechGeneration) this.fail("mouth_unavailable");
      } finally {
        try { await reader?.cancel(); } catch { /* stream already closed */ }
        if (this.speechController === controller) this.speechController = null;
        this.maybeSendRuntimeDone();
      }
    }).catch(() => this.fail("mouth_unavailable"));
  }

  private maybeSendRuntimeDone(): void {
    if (!this.runtimeEndRequested || this.runtimeEndSent || this.ended || this.state.currentTurn?.interrupted) return;
    const generation = this.speechGeneration;
    void this.speechQueue.then(() => {
      if (this.ended || generation !== this.speechGeneration || this.state.currentTurn?.interrupted ||
        !this.state.currentTurn?.runtimeDone || this.state.currentTurn.pendingSpeech.length) return;
      this.runtimeEndSent = true;
      this.send({ type: "runtime.done", turn_id: this.state.currentTurn.id });
    });
  }
}
