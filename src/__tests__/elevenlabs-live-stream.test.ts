// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";

const KEY = "local-only-test-provider-key";
const VOICE = "g6xIsTj2HwM6VR4iXFCw";
const TEXT = "A short reply.";
const options = { text: TEXT, voiceId: VOICE, modelId: "eleven_v3_conversational", retentionPolicy: "default_provider_retention" as const };
let environment: Record<string, string>;
let fetcher: ReturnType<typeof vi.fn>;
let adapter: typeof import("../../supabase/functions/_shared/elevenlabs");

class FakeSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  bufferedAmount = 0;
  sent: string[] = [];
  closes: Array<{ code?: number; reason?: string }> = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string | URL) { super(); FakeSocket.instances.push(this); }
  send(data: string) {
    if (this.readyState !== FakeSocket.OPEN) throw new Error("send while not open");
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closes.push({ code, reason });
    this.readyState = FakeSocket.CLOSED;
  }
  open() { this.readyState = FakeSocket.OPEN; const event = new Event("open"); this.onopen?.(event); this.dispatchEvent(event); }
  raw(data: string) { const event = new MessageEvent("message", { data }); this.onmessage?.(event); this.dispatchEvent(event); }
  message(data: unknown) { this.raw(JSON.stringify(data)); }
  remoteClose(code: number) {
    this.readyState = FakeSocket.CLOSED;
    const event = Object.assign(new Event("close"), { code, reason: "PRIVATE-PROVIDER-REASON", wasClean: code === 1000 });
    this.onclose?.(event); this.dispatchEvent(event);
  }
}

const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const outcome = <T,>(promise: Promise<T>) => promise.then(value => ({ value, error: null }), error => ({ value: null, error }));
const audio = (bytes: number[]) => Buffer.from(bytes).toString("base64");
async function start() {
  const controller = new AbortController();
  const pending = outcome(adapter.elevenlabsSpeechStream(options, controller.signal));
  await settle();
  expect(fetcher).not.toHaveBeenCalled();
  expect(FakeSocket.instances).toHaveLength(1);
  const socket = FakeSocket.instances[0];
  socket.open();
  const result = await pending;
  if (result.error) throw result.error;
  expect(result.value?.body).toBeTruthy();
  return { socket, controller, response: result.value!, reader: result.value!.body!.getReader() };
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  environment = { ELEVENLABS_API_KEY: KEY };
  FakeSocket.instances = [];
  fetcher = vi.fn().mockRejectedValue(new Error("HTTP fetch is forbidden in Live adapter tests"));
  vi.stubGlobal("Deno", { env: { get: (name: string) => environment[name], toObject: () => ({ ...environment }) } });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("WebSocket", FakeSocket);
  adapter = await import("../../supabase/functions/_shared/elevenlabs");
});
afterEach(() => {
  try { expect(fetcher).not.toHaveBeenCalled(); }
  finally { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

describe("ElevenLabs Live PCM transport", () => {
  it.each([
    ["missing retention", { retentionPolicy: undefined }],
    ["unapproved retention", { retentionPolicy: "zero_retention" }],
    ["another voice", { voiceId: "OtherVoice" }],
    ["another model", { modelId: "eleven_turbo_v2_5" }],
  ])("refuses %s before opening any transport", async (_label, overrides) => {
    // Deliberately malformed caller inputs exercise runtime validation, not TypeScript.
    await expect(adapter.elevenlabsSpeechStream({ ...options, ...overrides } as typeof options, new AbortController().signal)).rejects.toThrow();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses a missing key before opening any transport", async () => {
    delete environment.ELEVENLABS_API_KEY;
    await expect(adapter.elevenlabsSpeechStream(options, new AbortController().signal)).rejects.toThrow();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("pre-abort opens no transport", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(adapter.elevenlabsSpeechStream(options, controller.signal)).rejects.toThrow();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the fixed TTD endpoint and explicit authorized retention with credentials only in the first frame", async () => {
    const { socket, reader } = await start();
    const url = new URL(String(socket.url));
    expect(url.origin).toBe("wss://api.elevenlabs.io");
    expect(url.pathname).toBe("/v1/text-to-dialogue/stream-input");
    expect(url.searchParams.get("model_id")).toBe("eleven_v3_conversational");
    expect(url.searchParams.get("output_format")).toBe("pcm_16000");
    expect(url.searchParams.get("enable_logging")).toBe("true");
    expect(String(socket.url)).not.toContain(KEY);
    const sent = socket.sent.map(value => JSON.parse(value));
    expect(sent).toEqual([
      { voices: [VOICE], xi_api_key: KEY },
      { inputs: [{ text: TEXT, voice_id: VOICE }] },
      { close_socket: true },
    ]);
    await reader.cancel();
  });
  it("delivers incremental PCM before final and does not mistake a turn marker for completion", async () => {
    const { socket, reader, controller } = await start();
    socket.message({ audio: audio([1, 2]) });
    expect(await reader.read()).toEqual({ done: false, value: Uint8Array.of(1, 2) });
    let settled = false;
    const next = reader.read().then(value => { settled = true; return value; });
    socket.message({ is_final_audio_for_turn: true });
    await settle(); expect(settled).toBe(false);
    socket.message({ audio: audio([3, 4]) });
    expect(await next).toEqual({ done: false, value: Uint8Array.of(3, 4) });
    socket.message({ is_final: true });
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(socket.closes.length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    const closes = socket.closes.length;
    socket.message({ audio: audio([5, 6]) }); socket.message({ is_final: true }); controller.abort();
    await vi.advanceTimersByTimeAsync(20000);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(socket.closes).toHaveLength(closes);
  });
  it.each([1000, 1006])("rejects premature socket close %s even after audio", async (code) => {
    const { socket, reader } = await start();
    socket.message({ audio: audio([1, 2]) }); await reader.read();
    const read = outcome(reader.read()); socket.remoteClose(code);
    const { error } = await read;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("PRIVATE-PROVIDER-REASON");
  });
  it("sanitizes provider error frames and never returns their text", async () => {
    const { socket, reader } = await start();
    const read = outcome(reader.read());
    socket.message({ error: "PRIVATE-TEXT", message: KEY, detail: TEXT, code: 401 });
    const { error } = await read;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/PRIVATE-TEXT|local-only-test-provider-key|A short reply/);
    expect(socket.closes.length).toBeGreaterThan(0);
  });
  it.each(["abort", "reader cancel"])("%s hard closes without another flush and ignores late messages", async (mode) => {
    const { socket, controller, reader } = await start();
    const sent = [...socket.sent];
    const read = outcome(reader.read());
    if (mode === "abort") controller.abort(); else await reader.cancel();
    const result = await read;
    expect(mode === "abort" ? result.error instanceof Error : result.value?.done).toBe(true);
    expect(socket.closes.length).toBeGreaterThan(0);
    expect(socket.sent).toEqual(sent);
    expect(() => { socket.message({ audio: audio([9, 10]) }); socket.message({ is_final: true }); }).not.toThrow();
    expect(socket.sent).toEqual(sent);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
  it("sanitizes constructor failure without HTTP fallback or leaked resources", async () => {
    vi.stubGlobal("WebSocket", class { constructor() { throw new Error(`${KEY} ${TEXT}`); } });
    const controller = new AbortController();
    const result = await outcome(adapter.elevenlabsSpeechStream(options, controller.signal));
    const error = result.error ?? (await outcome(result.value!.body!.getReader().read())).error;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/local-only-test-provider-key|A short reply/);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
  it.each([false, true])("socket error opened=%s closes and releases resources without fallback", async (opened) => {
    const controller = new AbortController();
    const response = await adapter.elevenlabsSpeechStream(options, controller.signal);
    const socket = FakeSocket.instances[0];
    if (opened) socket.open();
    const pending = outcome(response.body!.getReader().read());
    const event = Object.assign(new Event("error"), { message: `${KEY} ${TEXT}` });
    socket.onerror?.(event); socket.dispatchEvent(event);
    const { error } = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/local-only-test-provider-key|A short reply/);
    expect(socket.closes.length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    if (!opened) expect(socket.sent).toEqual([]);
  });
  it("send failure sanitizes the error and closes without retrying credentials", async () => {
    const send = vi.spyOn(FakeSocket.prototype, "send").mockImplementation(() => { throw new Error(`${KEY} ${TEXT}`); });
    const controller = new AbortController();
    const response = await adapter.elevenlabsSpeechStream(options, controller.signal);
    const socket = FakeSocket.instances[0];
    const pending = outcome(response.body!.getReader().read()); socket.open();
    const { error } = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/local-only-test-provider-key|A short reply/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(socket.closes.length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
  it.each(["abort", "reader cancel"])("%s discards queued PCM and late completion cannot revive it", async (mode) => {
    const { socket, controller, reader } = await start();
    socket.message({ audio: audio([1, 2]) });
    if (mode === "abort") controller.abort(); else await reader.cancel();
    socket.message({ audio: audio([3, 4]) }); socket.message({ is_final: true });
    const result = await outcome(reader.read());
    expect(mode === "abort" ? result.error instanceof Error : result.value?.done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
  it("abort while connecting closes without sending text or credentials", async () => {
    const controller = new AbortController();
    const pending = outcome(adapter.elevenlabsSpeechStream(options, controller.signal));
    await settle(); expect(FakeSocket.instances).toHaveLength(1);
    const socket = FakeSocket.instances[0]; controller.abort();
    const result = await pending;
    if (result.value) await expect(result.value.body!.getReader().read()).rejects.toThrow();
    else expect(result.error).toBeInstanceOf(Error);
    expect(socket.closes.length).toBeGreaterThan(0);
    expect(socket.sent).toEqual([]);
  });
  it("bounds connection wait to eight seconds", async () => {
    const pending = outcome(adapter.elevenlabsSpeechStream(options, new AbortController().signal));
    await settle(); expect(FakeSocket.instances).toHaveLength(1);
    const socket = FakeSocket.instances[0];
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pending;
    if (result.value) await expect(result.value.body!.getReader().read()).rejects.toThrow();
    else expect(result.error).toBeInstanceOf(Error);
    expect(socket.closes.length).toBeGreaterThan(0);
    expect(socket.sent).toEqual([]);
  });
  it("bounds an idle audio read to ten seconds", async () => {
    const { socket, reader } = await start();
    const pending = outcome(reader.read());
    await vi.advanceTimersByTimeAsync(10000);
    expect((await pending).error).toBeInstanceOf(Error);
    expect(socket.closes.length).toBeGreaterThan(0);
  });
  it.each(["malformed JSON", "invalid base64", "oversized frame"])("rejects %s", async (kind) => {
    const { socket, reader } = await start();
    const pending = outcome(reader.read());
    if (kind === "malformed JSON") socket.raw("not-json");
    else if (kind === "invalid base64") socket.message({ audio: "%%%invalid%%%" });
    else socket.raw(" ".repeat(1024 * 1024 + 1));
    expect((await pending).error).toBeInstanceOf(Error);
    expect(socket.closes.length).toBeGreaterThan(0);
  });
  it("bounds queued PCM for a nonreading consumer to 512 KiB", async () => {
    const { socket, reader } = await start();
    const chunk = Buffer.alloc(256 * 1024).toString("base64");
    socket.message({ audio: chunk }); socket.message({ audio: chunk }); socket.message({ audio: chunk });
    await expect(reader.read()).rejects.toThrow();
    expect(socket.closes.length).toBeGreaterThan(0);
  });
  it.each([{ bytes: [] }, { bytes: [1] }])("rejects incomplete PCM on final ($bytes)", async ({ bytes }) => {
    const { socket, reader } = await start();
    if (bytes.length) { socket.message({ audio: audio(bytes) }); await reader.read(); }
    const pending = outcome(reader.read()); socket.message({ is_final: true });
    expect((await pending).error).toBeInstanceOf(Error);
    expect(socket.closes.length).toBeGreaterThan(0);
  });
});
