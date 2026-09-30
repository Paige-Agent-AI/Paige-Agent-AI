import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const recorder = vi.hoisted(() => ({ start: vi.fn(async () => undefined), stop: vi.fn() }));
vi.mock("@/utils/VoiceAudio", () => ({
  AudioRecorder: class {
    start = recorder.start;
    stop = recorder.stop;
  },
}));
import { connectPaigeLiveRelay } from "./relayTransport";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  readonly url: string;
  readyState = 1;
  binaryType = "";
  sent: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; FakeSocket.instances.push(this); }
  send(data: unknown) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(data: unknown) { this.onmessage?.({ data }); }
}

describe("first-party Live relay transport", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    vi.stubGlobal("WebSocket", FakeSocket);
    FakeSocket.instances = [];
    recorder.start.mockClear();
    recorder.stop.mockClear();
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("uses only the first-party WSS URL and never captures on provider-free unavailable", () => {
    const states: unknown[] = [];
    const transport = connectPaigeLiveRelay({ sessionId: "session-1", ticket: "opaque", onState: (state) => states.push(state) });
    const socket = FakeSocket.instances[0];
    expect(socket.url).toContain("wss://test.supabase.co/functions/v1/paige-live-relay?");
    expect(socket.url).toContain("ticket=opaque");
    expect(socket.url).toContain("apikey=public-test-key");
    expect(socket.url).not.toContain("tenantId");
    socket.receive(JSON.stringify({ type: "unavailable", code: "adapters_not_connected" }));
    expect(states).toEqual([{ kind: "unavailable", message: "Live audio is not connected yet. You can keep working with Paige in chat." }]);
    expect(recorder.start).not.toHaveBeenCalled();
    expect(socket.sent).toEqual([]);
    transport.stop();
  });

  it("clears playback and emits interrupt without a provider SDK", () => {
    const transport = connectPaigeLiveRelay({ sessionId: "session-2", ticket: "opaque-2", onState: () => undefined });
    const socket = FakeSocket.instances[0];
    transport.interrupt();
    expect(socket.sent).toContain(JSON.stringify({ type: "interrupt", request_id: 1 }));
    transport.stop();
    expect(socket.readyState).toBe(3);
  });

  it("routes a finalized voice turn through the existing runtime and fences it on interruption", () => {
    const turns: Array<{ text: string; turnId: string }> = [];
    const cancelled: string[] = [];
    const transport = connectPaigeLiveRelay({
      sessionId: "session-runtime", ticket: "opaque-runtime", onState: () => undefined,
      onVoiceTurn: (text, turnId) => turns.push({ text, turnId }),
      onRuntimeCancel: (turnId) => cancelled.push(turnId),
    });
    const socket = FakeSocket.instances[0];
    socket.receive(JSON.stringify({ type: "runtime.dispatch", text: "What next?", turn_id: "turn-1", challenge: "signed-challenge" }));
    expect(turns).toEqual([{ text: "What next?", turnId: "turn-1" }]);
    transport.runtimeProof("turn-1", "signed-output");
    expect(socket.sent).toContain(JSON.stringify({ type: "runtime.proof", turn_id: "turn-1", proof: "signed-output" }));
    expect(socket.sent.some((frame) => typeof frame === "string" && frame.includes('"runtime.chunk"'))).toBe(false);
    socket.receive(JSON.stringify({ type: "runtime.cancel", turn_id: "turn-1" }));
    expect(cancelled).toEqual(["turn-1"]);
    transport.interrupt();
    expect(socket.sent).toContain(JSON.stringify({ type: "interrupt", request_id: 1 }));
    transport.stop();
  });

  it.each([false, true])("fences stale PCM and completion through repeated interrupt barriers: %s", (repeat) => {
    const starts = vi.fn(), stops = vi.fn();
    vi.stubGlobal("AudioContext", class {
      state = "running"; currentTime = 0; destination = {};
      close = vi.fn(async () => undefined);
      createBuffer(_n: number, length: number) { return { duration: length / 16000, getChannelData: () => new Float32Array(length) }; }
      createBufferSource() { return { buffer: null, onended: null, connect() {}, start: starts, stop: stops }; }
    });
    const transport = connectPaigeLiveRelay({ sessionId: "barrier", ticket: "opaque", onState() {} });
    const socket = FakeSocket.instances[0];
    const pcm = () => socket.receive(new Int16Array([100, 200]).buffer);
    const ack = (id: unknown) => socket.receive(JSON.stringify({ type: "interrupt.ack", request_id: id }));
    pcm(); expect(starts).toHaveBeenCalledOnce();
    transport.interrupt(); expect(stops).toHaveBeenCalledOnce();
    if (repeat) transport.interrupt();
    const latest = repeat ? 2 : 1;
    pcm(); socket.receive(JSON.stringify({ type: "runtime.done" }));
    socket.receive(JSON.stringify({ type: "clear_playback" })); pcm();
    for (const id of [0, null, String(latest), latest + 1, ...(repeat ? [1, 1] : [])]) { ack(id); pcm(); }
    expect(starts).toHaveBeenCalledOnce();
    expect(socket.sent).not.toContain(JSON.stringify({ type: "playback.complete" }));
    expect(socket.sent).toContain(JSON.stringify({ type: "interrupt", request_id: latest }));
    ack(latest); pcm(); expect(starts).toHaveBeenCalledTimes(2);
    transport.interrupt(); ack(latest); pcm(); expect(starts).toHaveBeenCalledTimes(2);
    ack(latest + 1); pcm(); expect(starts).toHaveBeenCalledTimes(3);
    transport.stop();
  });

  it("missing interrupt acknowledgement disconnects within five seconds and stops capture", async () => {
    vi.useFakeTimers();
    const states: unknown[] = [];
    const transport = connectPaigeLiveRelay({ sessionId: "no-ack", ticket: "opaque", onState: state => states.push(state) });
    const socket = FakeSocket.instances[0];
    socket.receive(JSON.stringify({ type: "ready" }));
    await Promise.resolve(); await Promise.resolve();
    transport.interrupt();
    await vi.advanceTimersByTimeAsync(4999);
    expect(socket.readyState).toBe(FakeSocket.OPEN);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.readyState).toBe(3);
    expect(states.at(-1)).toEqual({ kind: "disconnected" });
    expect(states.filter(state => (state as { kind: string }).kind === "disconnected")).toHaveLength(1);
    expect(recorder.stop).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    socket.receive(JSON.stringify({ type: "interrupt.ack", request_id: 1 }));
    socket.receive(JSON.stringify({ type: "runtime.done" }));
    expect(states.at(-1)).toEqual({ kind: "disconnected" });
  });

  it("repeated interruption restarts the deadline and stale acknowledgements cannot clear it", async () => {
    vi.useFakeTimers();
    const states: unknown[] = [];
    const transport = connectPaigeLiveRelay({ sessionId: "repeat-ack", ticket: "opaque", onState: state => states.push(state) });
    const socket = FakeSocket.instances[0];
    transport.interrupt();
    await vi.advanceTimersByTimeAsync(4000);
    transport.interrupt();
    socket.receive(JSON.stringify({ type: "interrupt.ack", request_id: 1 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.readyState).toBe(FakeSocket.OPEN);
    await vi.advanceTimersByTimeAsync(4000);
    expect(socket.readyState).toBe(3);
    expect(states).toEqual([{ kind: "disconnected" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["matching acknowledgement", "stop", "socket close", "unavailable"])("%s clears the interrupt deadline", async (finish) => {
    vi.useFakeTimers();
    const states: unknown[] = [];
    const transport = connectPaigeLiveRelay({ sessionId: "clear-ack", ticket: "opaque", onState: state => states.push(state) });
    const socket = FakeSocket.instances[0];
    transport.interrupt();
    expect(vi.getTimerCount()).toBe(1);
    if (finish === "matching acknowledgement") socket.receive(JSON.stringify({ type: "interrupt.ack", request_id: 1 }));
    else if (finish === "stop") transport.stop();
    else if (finish === "socket close") socket.close();
    else socket.receive(JSON.stringify({ type: "unavailable" }));
    expect(vi.getTimerCount()).toBe(0);
    const before = [...states];
    await vi.advanceTimersByTimeAsync(10000);
    expect(states).toEqual(before);
    if (finish === "matching acknowledgement") expect(socket.readyState).toBe(FakeSocket.OPEN);
    transport.stop();
  });

  it("old asynchronous PCM cannot resume after interruption and its acknowledgement", async () => {
    let finishResume!: () => void;
    const resume = new Promise<void>(resolve => { finishResume = resolve; });
    const starts = vi.fn();
    vi.stubGlobal("AudioContext", class {
      state = "suspended"; currentTime = 0; destination = {};
      resume = () => resume; close = vi.fn(async () => undefined);
      createBuffer(_n: number, length: number) { return { duration: length / 16000, getChannelData: () => new Float32Array(length) }; }
      createBufferSource() { return { buffer: null, onended: null, connect() {}, start: starts, stop() {} }; }
    });
    const transport = connectPaigeLiveRelay({ sessionId: "async-barrier", ticket: "opaque", onState() {} });
    const socket = FakeSocket.instances[0];
    socket.receive(new Int16Array([1, 2]).buffer);
    transport.interrupt();
    socket.receive(JSON.stringify({ type: "interrupt.ack", request_id: 1 }));
    finishResume(); await Promise.resolve(); await Promise.resolve();
    expect(starts).not.toHaveBeenCalled();
    expect(socket.sent).not.toContain(JSON.stringify({ type: "playback.complete" }));
    transport.stop();
  });

  it("does not complete playback while audio waits for the output context to resume", async () => {
    let finishResume!: () => void;
    const resume = new Promise<void>((resolve) => { finishResume = resolve; });
    const sources: Array<{ onended: (() => void) | null }> = [];
    vi.stubGlobal("AudioContext", class {
      state = "suspended";
      currentTime = 0;
      destination = {};
      resume = vi.fn(() => resume);
      close = vi.fn(async () => undefined);
      createBuffer(_channels: number, length: number) {
        return { duration: length / 16_000, getChannelData: () => new Float32Array(length) };
      }
      createBufferSource() {
        const source = { buffer: null, onended: null as (() => void) | null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
        sources.push(source);
        return source;
      }
    });
    const transport = connectPaigeLiveRelay({ sessionId: "session-3", ticket: "opaque-3", onState: () => undefined });
    const socket = FakeSocket.instances[0];
    socket.receive(new Int16Array([100, 200]).buffer);
    socket.receive(JSON.stringify({ type: "runtime.done" }));
    expect(socket.sent).not.toContain(JSON.stringify({ type: "playback.complete" }));
    finishResume();
    await Promise.resolve();
    await Promise.resolve();
    expect(sources).toHaveLength(1);
    expect(socket.sent).not.toContain(JSON.stringify({ type: "playback.complete" }));
    sources[0].onended?.();
    expect(socket.sent).toContain(JSON.stringify({ type: "playback.complete" }));
    transport.stop();
  });

  it("Hold pauses actual PCM, Resume continues it, and microphone Mute does not stop output", async () => {
    const suspend = vi.fn(async () => undefined), resume = vi.fn(async () => undefined);
    vi.stubGlobal("AudioContext", class {
      state = "running"; currentTime = 0; destination = {};
      suspend = suspend; resume = resume; close = vi.fn(async () => undefined);
      createBuffer(_n: number, length: number) { return { duration: length / 16000, getChannelData: () => new Float32Array(length) }; }
      createBufferSource() { return { buffer: null, onended: null, connect() {}, start() {}, stop() {} }; }
    });
    const transport = connectPaigeLiveRelay({ sessionId: "session-hold", ticket: "opaque", onState() {} });
    FakeSocket.instances[0].receive(new Int16Array([100, 200]).buffer);
    await Promise.resolve();
    expect(transport.outputPlaying()).toBe(true);
    transport.setMuted(true);
    expect(transport.outputPlaying()).toBe(true);
    transport.pauseOutput();
    expect(suspend).toHaveBeenCalledOnce();
    expect(transport.outputPlaying()).toBe(false);
    transport.resumeOutput();
    await Promise.resolve();
    expect(resume).toHaveBeenCalledOnce();
    expect(transport.outputPlaying()).toBe(true);
    transport.interrupt();
    expect(transport.outputPlaying()).toBe(false);
    transport.stop();
  });

  it("Hold before first PCM suspends the new context before scheduling sound", async () => {
    const starts: string[] = [];
    const sources: Array<{ onended: (() => void) | null }> = [];
    vi.stubGlobal("AudioContext", class {
      state = "running"; currentTime = 0; destination = {};
      async suspend() { this.state = "suspended"; }
      async resume() { this.state = "running"; }
      async close() { this.state = "closed"; }
      createBuffer(_n: number, length: number) { return { duration: length / 16000, getChannelData: () => new Float32Array(length) }; }
      createBufferSource() {
        const source = { buffer: null, onended: null as (() => void) | null, connect() {}, start: () => starts.push(this.state), stop() {} };
        sources.push(source);
        return source;
      }
    });
    const transport = connectPaigeLiveRelay({ sessionId: "hold-before-speech", ticket: "opaque", onState() {} });
    const socket = FakeSocket.instances[0];
    transport.pauseOutput();
    socket.receive(new Int16Array([100, 200]).buffer);
    socket.receive(JSON.stringify({ type: "runtime.done" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(starts).toEqual(["suspended"]);
    expect(transport.outputPlaying()).toBe(false);
    expect(socket.sent).not.toContain(JSON.stringify({ type: "playback.complete" }));
    transport.resumeOutput();
    await Promise.resolve();
    expect(transport.outputPlaying()).toBe(true);
    sources[0].onended?.();
    expect(socket.sent).toContain(JSON.stringify({ type: "playback.complete" }));
    transport.stop();
  });

  it("never reports ready when the socket closes during microphone startup", async () => {
    let finishStart!: () => void;
    recorder.start.mockImplementationOnce(() => new Promise<void>((resolve) => { finishStart = resolve; }));
    const states: unknown[] = [];
    connectPaigeLiveRelay({ sessionId: "session-4", ticket: "opaque-4", onState: (state) => states.push(state) });
    const socket = FakeSocket.instances[0];
    socket.receive(JSON.stringify({ type: "ready" }));
    socket.close();
    finishStart();
    await Promise.resolve();
    await Promise.resolve();
    expect(states).toEqual([{ kind: "disconnected" }]);
    expect(socket.sent).not.toContain(JSON.stringify({ type: "start", sampleRate: 16_000 }));
    expect(recorder.stop).toHaveBeenCalled();
  });

  it("reports a later audio failure as stopped, while keeping the chat available", async () => {
    const states: Array<{ kind: string; message?: string }> = [];
    connectPaigeLiveRelay({ sessionId: "session-late-failure", ticket: "opaque-late", onState: (state) => states.push(state) });
    const socket = FakeSocket.instances[0];
    socket.receive(JSON.stringify({ type: "ready" }));
    await Promise.resolve();
    await Promise.resolve();
    socket.receive(JSON.stringify({ type: "unavailable", code: "mouth_unavailable" }));
    expect(states.at(-1)).toEqual({
      kind: "unavailable",
      message: "Live audio stopped. Your conversation is still here, and you can continue in chat.",
    });
    expect(recorder.stop).toHaveBeenCalled();
  });
});
