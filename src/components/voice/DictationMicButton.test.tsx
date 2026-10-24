import { act, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DictationMicButton } from "./DictationMicButton";
import { appendDictation, useDictation, type UseDictationApi } from "@/lib/voice/useDictation";

const voiceHarness = vi.hoisted(() => ({
  recorderStarts: 0,
  recorderStops: 0,
  frameCallbacks: [] as Array<(frame: Float32Array) => void>,
  getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token" } } })),
  recorderStart: vi.fn(async () => undefined),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: voiceHarness.getSession } },
}));

vi.mock("@/utils/VoiceAudio", () => ({
  AudioRecorder: class {
    constructor(onFrame: (frame: Float32Array) => void, _sampleRate: number) {
      voiceHarness.frameCallbacks.push(onFrame);
    }
    async start() {
      voiceHarness.recorderStarts += 1;
      await voiceHarness.recorderStart();
    }
    stop() { voiceHarness.recorderStops += 1; }
  },
}));

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  binaryType = "";
  readyState = FakeWebSocket.CONNECTING;
  sent: unknown[] = [];
  closeCalls = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(public readonly url: string) { sockets.push(this); }
  send(value: unknown) { this.sent.push(value); }
  close() { this.closeCalls += 1; this.readyState = FakeWebSocket.CLOSED; }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(new Event("open")); }
  message(value: Record<string, unknown>) { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) })); }
  error() { this.onerror?.(new Event("error")); }
  closed({ wasClean = true, code = wasClean ? 1000 : 1006, reason = "" } = {}) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ wasClean, code, reason } as CloseEvent);
  }
}

let sockets: FakeWebSocket[] = [];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

describe("Solo dictation control", () => {
  let host: HTMLDivElement;
  let root: Root;
  let originalMediaDevices: MediaDevices | undefined;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    sockets = [];
    voiceHarness.recorderStarts = 0;
    voiceHarness.recorderStops = 0;
    voiceHarness.frameCallbacks = [];
    voiceHarness.getSession.mockClear();
    voiceHarness.recorderStart.mockReset();
    voiceHarness.recorderStart.mockResolvedValue(undefined);
    originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
    Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeWebSocket });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
  });

  const renderControl = async (scopeEpoch = "account-a", onText = vi.fn()) => {
    await act(async () => {
      root.render(<DictationMicButton onText={onText} showStatus scopeEpoch={scopeEpoch} />);
      await Promise.resolve();
    });
  };

  it("shows connecting, waits for ready, then tap-to-finishing and idle after a clean final", async () => {
    const onText = vi.fn();
    await renderControl("account-a", onText);
    const button = host.querySelector("button")!;

    await act(async () => { button.click(); });
    await flush();
    expect(host.textContent).toContain("Connecting");

    await act(async () => sockets[0].open());
    expect(host.textContent).toContain("Connecting");
    await act(async () => sockets[0].message({ type: "ready" }));
    expect(host.textContent).toContain("Listening");
    await act(async () => sockets[0].message({ type: "transcript", text: "Testing", is_final: false }));
    expect(host.textContent).toContain("Listening");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.disabled).toBe(false);

    await act(async () => { button.click(); });
    expect(host.textContent).toContain("Finishing");
    expect(button.disabled).toBe(false);

    await act(async () => sockets[0].message({ type: "transcript", text: "Testing PAIGE", is_final: true }));
    expect(onText).toHaveBeenCalledWith("Testing PAIGE");
    expect(host.textContent).toContain("Finishing");

    await act(async () => sockets[0].message({ type: "done" }));
    await act(async () => sockets[0].closed());
    expect(host.textContent).not.toContain("Hold to talk");
    expect(host.textContent).toContain("Added to draft");
    expect(button.getAttribute("aria-label")).toBe("Start voice typing");
    expect(button.getAttribute("title")).toBe("Tap to dictate");
  });

  it("does not stop on pointer release or keyboard keyup", async () => {
    await renderControl();
    const button = host.querySelector("button")!;
    await act(async () => {
      button.click();
      button.dispatchEvent(new Event("pointerup", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sockets).toHaveLength(1);
    expect(voiceHarness.recorderStops).toBe(0);

    await act(async () => {
      button.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    });
    expect(voiceHarness.recorderStops).toBe(0);
    await act(async () => { button.click(); });
    expect(voiceHarness.recorderStops).toBe(1);
  });

  it("stops a recorder whose startup fails after microphone acquisition begins", async () => {
    voiceHarness.recorderStart.mockRejectedValueOnce(new Error("audio setup failed"));
    await renderControl();
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    expect(voiceHarness.recorderStops).toBe(1);
    expect(sockets).toHaveLength(0);
    expect(host.textContent).toContain("Voice typing unavailable");
  });

  it("cleans a pending recorder exactly once when the user taps stop", async () => {
    let resolveStart!: () => void;
    voiceHarness.recorderStart.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    await renderControl();
    const button = host.querySelector("button")!;
    await act(async () => { button.click(); });
    await flush();
    expect(host.textContent).toContain("Requesting mic");
    await act(async () => { button.click(); });
    expect(voiceHarness.recorderStops).toBe(1);
    await act(async () => { resolveStart(); await Promise.resolve(); });
    expect(voiceHarness.recorderStops).toBe(1);
    expect(sockets).toHaveLength(0);
    expect(host.textContent).not.toContain("Listening");
  });

  it("cleans a pending recorder and opens no socket after an account epoch change", async () => {
    let resolveStart!: () => void;
    voiceHarness.recorderStart.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    const onText = vi.fn();
    await renderControl("account-a", onText);
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    await renderControl("account-b", onText);
    expect(voiceHarness.recorderStops).toBe(1);
    await act(async () => { resolveStart(); await Promise.resolve(); });
    expect(voiceHarness.recorderStops).toBe(1);
    expect(sockets).toHaveLength(0);
    expect(onText).not.toHaveBeenCalled();
  });

  it("drops final, interim, and error delivery between the epoch render and passive cleanup", async () => {
    const onText = vi.fn();
    const onError = vi.fn();
    const deliver = vi.fn();
    let latest!: UseDictationApi;
    const Probe = ({ epoch }: { epoch: string }) => {
      latest = useDictation({ onText, onError, scopeEpoch: epoch });
      useLayoutEffect(() => {
        if (epoch === "account-b") deliver();
      }, [epoch]);
      return <span>{latest.status}:{latest.partial}:{latest.error}</span>;
    };

    await act(async () => root.render(<Probe epoch="account-a" />));
    await act(async () => { void latest.start(); await Promise.resolve(); await Promise.resolve(); });
    const socket = sockets[0];
    await act(async () => socket.open());
    await act(async () => socket.message({ type: "ready" }));
    deliver.mockImplementation(() => {
      socket.message({ type: "transcript", text: "stale final", is_final: true });
      socket.message({ type: "transcript", text: "stale interim", is_final: false });
      socket.error();
    });

    await act(async () => root.render(<Probe epoch="account-b" />));

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(onText).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(host.textContent).toBe("idle::");
  });

  it("stops an active recording when its scope changes", async () => {
    const onText = vi.fn();
    await renderControl("account-a", onText);
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    const socket = sockets[0];
    await act(async () => socket.open());
    await act(async () => socket.message({ type: "ready" }));
    expect(voiceHarness.recorderStops).toBe(0);

    await renderControl("account-b", onText);

    expect(voiceHarness.recorderStops).toBe(1);
    expect(socket.closeCalls).toBe(1);
    expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("releases the mic and socket when the composer unmounts", async () => {
    await renderControl();
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    const socket = sockets[0];
    await act(async () => socket.open());
    await act(async () => socket.message({ type: "ready" }));

    await act(async () => root.render(null));

    expect(voiceHarness.recorderStops).toBe(1);
    expect(socket.closeCalls).toBe(1);
  });

  it("surfaces permission, unsupported, provider-failure, and unavailable states", async () => {
    const denied = new Error("denied"); denied.name = "NotAllowedError";
    voiceHarness.recorderStart.mockRejectedValueOnce(denied);
    await renderControl();
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    expect(host.textContent).toContain("Mic permission off");

    await renderControl();
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    await act(async () => sockets.at(-1)!.open());
    await act(async () => sockets.at(-1)!.message({ type: "ready" }));
    await act(async () => sockets.at(-1)!.error());
    expect(host.textContent).toContain("Voice typing failed");

    await renderControl();
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    await act(async () => sockets.at(-1)!.open());
    await act(async () => sockets.at(-1)!.message({ type: "error", code: "not_configured", message: "unavailable" }));
    expect(host.textContent).toContain("Voice typing unavailable");

    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    await renderControl();
    expect(host.textContent).toContain("Mic unsupported");
  });

  it("treats a clean provider close before release as a surfaced failure", async () => {
    await renderControl();
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    await act(async () => sockets[0].open());
    await act(async () => sockets[0].message({ type: "ready" }));
    await act(async () => sockets[0].closed());
    expect(host.textContent).toContain("Voice typing failed");
  });

  it("stops capture if the parent disables the control", async () => {
    const onText = vi.fn();
    await renderControl("account-a", onText);
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    await act(async () => sockets[0].open());
    await act(async () => sockets[0].message({ type: "ready" }));
    await act(async () => root.render(<DictationMicButton onText={onText} showStatus scopeEpoch="account-a" disabled />));
    expect(voiceHarness.recorderStops).toBeGreaterThan(0);
    expect(host.textContent).toContain("Finishing");
  });

  it.each(["pointercancel", "lostpointercapture"])("keeps capture active on %s", async (eventName) => {
    await renderControl();
    const button = host.querySelector("button")!;
    await act(async () => { button.click(); });
    await flush();
    await act(async () => sockets[0].open());
    await act(async () => sockets[0].message({ type: "ready" }));
    await act(async () => button.dispatchEvent(new Event(eventName, { bubbles: true })));
    expect(host.textContent).toContain("Listening");
    expect(voiceHarness.recorderStops).toBe(0);
    await act(async () => { button.click(); });
  });

  it("supports the native keyboard click path without dropping focus", async () => {
    await renderControl();
    const button = host.querySelector("button")!;
    button.focus();
    await act(async () => { button.click(); });
    await flush();
    await act(async () => sockets[0].open());
    await act(async () => sockets[0].message({ type: "ready" }));
    await act(async () => { button.click(); });
    expect(host.textContent).toContain("Finishing");
    expect(document.activeElement).toBe(button);
    await act(async () => sockets[0].message({ type: "done" }));
    await act(async () => sockets[0].closed());
    expect(document.activeElement).toBe(button);
  });

  it("fences old recording callbacks and closes only their own socket after an epoch change", async () => {
    const onText = vi.fn();
    await renderControl("account-a", onText);
    const button = host.querySelector("button")!;
    await act(async () => { button.click(); });
    await flush();
    const socketA = sockets[0];
    await act(async () => socketA.open());
    await act(async () => socketA.message({ type: "ready" }));
    await act(async () => { button.click(); });

    await renderControl("account-b", onText);
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    const socketB = sockets[1];
    expect(socketB).toBeDefined();

    await act(async () => socketA.message({ type: "transcript", text: "stale account A", is_final: true }));
    await act(async () => socketA.closed());
    expect(onText).not.toHaveBeenCalled();
    expect(socketB.closeCalls).toBe(0);

    await act(async () => socketB.open());
    await act(async () => socketB.message({ type: "transcript", text: "account B", is_final: true }));
    expect(onText).toHaveBeenCalledWith("account B");
  });

  it("does not let a released run be replaced before its provider stream settles", async () => {
    let latest!: UseDictationApi;
    const Probe = () => {
      latest = useDictation({ onText: vi.fn(), scopeEpoch: "account-a" });
      return null;
    };
    await act(async () => root.render(<Probe />));
    await act(async () => { void latest.start(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => sockets[0].open());
    await act(async () => latest.stop());
    await act(async () => { await latest.start(); });
    expect(sockets).toHaveLength(1);
    expect(latest.status).toBe("transcribing");
    await act(async () => sockets[0].message({ type: "done" }));
    await act(async () => sockets[0].closed());
    expect(latest.status).toBe("idle");
  });

  it("surfaces a provider failure when a released stream never settles", async () => {
    vi.useFakeTimers();
    try {
      await renderControl();
      const button = host.querySelector("button")!;
      await act(async () => { button.click(); });
      await flush();
      await act(async () => sockets[0].open());
      await act(async () => sockets[0].message({ type: "ready" }));
      await act(async () => { button.click(); });
      expect(host.textContent).toContain("Finishing");
      await act(async () => { vi.advanceTimersByTime(15_000); });
      expect(host.textContent).toContain("Voice typing failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats final -> done -> close 1006 as success and never surfaces a toast", async () => {
    const onText = vi.fn();
    const onError = vi.fn();
    let latest!: UseDictationApi;
    const Probe = () => {
      latest = useDictation({ onText, onError, scopeEpoch: "account-a" });
      return <span>{latest.status}:{latest.error ?? ""}</span>;
    };
    await act(async () => root.render(<Probe />));
    await act(async () => { void latest.start(); await Promise.resolve(); await Promise.resolve(); });
    const socket = sockets[0];
    await act(async () => socket.open());
    await act(async () => socket.message({ type: "ready" }));
    await act(async () => latest.stop());
    await act(async () => socket.error());
    await act(async () => socket.message({ type: "transcript", text: "trailing final", is_final: true }));
    await act(async () => socket.message({ type: "done" }));
    await act(async () => socket.closed({ wasClean: false, code: 1006, reason: "" }));
    expect(onText).toHaveBeenCalledWith("trailing final");
    expect(onError).not.toHaveBeenCalled();
    expect(latest.status).toBe("idle");
    expect(latest.error).toBeNull();
  });

  it("surfaces a truthful disconnect when STOP closes without done, even with code 1000", async () => {
    const onError = vi.fn();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let latest!: UseDictationApi;
    const Probe = () => {
      latest = useDictation({ onText: vi.fn(), onError, scopeEpoch: "account-a" });
      return null;
    };
    await act(async () => root.render(<Probe />));
    await act(async () => { void latest.start(); await Promise.resolve(); await Promise.resolve(); });
    const socket = sockets[0];
    await act(async () => socket.open());
    await act(async () => socket.message({ type: "ready" }));
    await act(async () => latest.stop());
    await act(async () => socket.closed({ wasClean: true, code: 1000, reason: "stop" }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Voice typing disconnected. Please try again.");
    expect(latest.status).toBe("error");
    expect(consoleWarn).toHaveBeenCalledWith("[dictation] socket closed without done", {
      code: 1000,
      reason: "stop",
      released: true,
      doneSeen: false,
    });
    consoleWarn.mockRestore();
  });

  it.each([
    ["stt_finalize_timeout", "Voice typing took too long to finish. Please try again."],
    ["stt_finalize_unavailable", "Voice typing stopped before it could finish. Please try again."],
    ["stt_finalize_failed", "Voice typing stopped before it could finish. Please try again."],
  ])("maps %s to its specific plain-language retry message", async (code, expectedMessage) => {
    const onError = vi.fn();
    let latest!: UseDictationApi;
    const Probe = () => {
      latest = useDictation({ onText: vi.fn(), onError, scopeEpoch: "account-a" });
      return null;
    };
    await act(async () => root.render(<Probe />));
    await act(async () => { void latest.start(); await Promise.resolve(); await Promise.resolve(); });
    const socket = sockets[0];
    await act(async () => socket.open());
    await act(async () => socket.message({ type: "ready" }));
    await act(async () => latest.stop());
    await act(async () => socket.message({ type: "error", code, message: "raw server detail" }));
    expect(onError).toHaveBeenCalledWith(expectedMessage);
    expect(latest.error).toBe(expectedMessage);
  });

  it("ignores transcript frames that arrive after done", async () => {
    const onText = vi.fn();
    let latest!: UseDictationApi;
    const Probe = () => {
      latest = useDictation({ onText, scopeEpoch: "account-a" });
      return null;
    };
    await act(async () => root.render(<Probe />));
    await act(async () => { void latest.start(); await Promise.resolve(); await Promise.resolve(); });
    const socket = sockets[0];
    await act(async () => socket.open());
    await act(async () => socket.message({ type: "ready" }));
    await act(async () => latest.stop());
    await act(async () => socket.message({ type: "transcript", text: "kept final", is_final: true }));
    await act(async () => socket.message({ type: "done" }));
    await act(async () => socket.message({ type: "transcript", text: "late duplicate", is_final: true }));
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith("kept final");
    expect(latest.status).toBe("idle");
  });

  it("times out when STOP receives no final transcript or close", async () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      let latest!: UseDictationApi;
      const Probe = () => {
        latest = useDictation({ onText: vi.fn(), onError, scopeEpoch: "account-a" });
        return null;
      };
      await act(async () => root.render(<Probe />));
      await act(async () => { void latest.start(); await Promise.resolve(); await Promise.resolve(); });
      const socket = sockets[0];
      await act(async () => socket.open());
      await act(async () => socket.message({ type: "ready" }));
      await act(async () => latest.stop());
      await act(async () => { vi.advanceTimersByTime(15_000); });
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith("Voice typing took too long to finish. Please try again.");
      expect(latest.status).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps pre-STOP onerror terminal", async () => {
    const onError = vi.fn();
    let latest!: UseDictationApi;
    const Probe = () => {
      latest = useDictation({ onText: vi.fn(), onError, scopeEpoch: "account-a" });
      return null;
    };
    await act(async () => root.render(<Probe />));
    await act(async () => { void latest.start(); await Promise.resolve(); await Promise.resolve(); });
    const socket = sockets[0];
    await act(async () => socket.open());
    await act(async () => socket.message({ type: "ready" }));
    await act(async () => socket.error());
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Couldn't reach voice typing. Check your connection and try again.");
    expect(latest.status).toBe("error");
  });

  it("keeps recording after release and stops only on the second tap", async () => {
    await renderControl();
    const button = host.querySelector("button")!;

    await act(async () => { button.click(); });
    await flush();
    expect(host.textContent).toContain("Connecting");

    await act(async () => button.dispatchEvent(new Event("pointerup", { bubbles: true })));
    expect(voiceHarness.recorderStops).toBe(0);

    await act(async () => sockets[0].open());
    expect(host.textContent).toContain("Connecting");
    await act(async () => sockets[0].message({ type: "ready" }));
    expect(host.textContent).toContain("Listening");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    await act(async () => { button.click(); });
    expect(host.textContent).toContain("Finishing");
    expect(voiceHarness.recorderStops).toBe(1);
  });

  it("captures and buffers the first audio while auth and the socket are starting", async () => {
    let resolveSession!: (value: { data: { session: { access_token: string } } }) => void;
    voiceHarness.getSession.mockImplementationOnce(() => new Promise((resolve) => { resolveSession = resolve; }));
    await renderControl();

    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    expect(voiceHarness.recorderStarts).toBe(1);
    expect(host.textContent).toContain("Connecting");

    const firstWords = new Float32Array([0.2, -0.2, 0.1]);
    await act(async () => voiceHarness.frameCallbacks[0](firstWords));
    await act(async () => {
      resolveSession({ data: { session: { access_token: "test-token" } } });
      await Promise.resolve();
    });
    await flush();
    await act(async () => sockets[0].open());

    expect(sockets[0].sent[0]).toBe(JSON.stringify({ type: "start", sampleRate: 16000 }));
    expect(sockets[0].sent[1]).toBeInstanceOf(ArrayBuffer);
  });

  it("defers a deliberate stop during connecting until the provider is ready", async () => {
    const onText = vi.fn();
    await renderControl("account-a", onText);
    const button = host.querySelector("button")!;

    await act(async () => { button.click(); });
    await flush();
    await act(async () => voiceHarness.frameCallbacks[0](new Float32Array([0.2, -0.2])));
    await act(async () => sockets[0].open());
    await act(async () => { button.click(); });

    expect(host.textContent).toContain("Finishing");
    expect(sockets[0].sent).not.toContain(JSON.stringify({ type: "stop" }));

    await act(async () => sockets[0].message({ type: "ready" }));
    expect(sockets[0].sent.filter((frame) => frame === JSON.stringify({ type: "stop" }))).toHaveLength(1);
    await act(async () => sockets[0].message({ type: "transcript", text: "short utterance", is_final: true }));
    expect(onText).toHaveBeenCalledWith("short utterance");
  });

  it("uses a five-minute silence guard without ending a natural pause", async () => {
    vi.useFakeTimers();
    try {
      await renderControl();
      await act(async () => { host.querySelector("button")!.click(); });
      await flush();
      await act(async () => sockets[0].open());
      await act(async () => sockets[0].message({ type: "ready" }));

      await act(async () => { vi.advanceTimersByTime(4 * 60_000); });
      expect(host.textContent).toContain("Listening");
      expect(voiceHarness.recorderStops).toBe(0);

      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(host.textContent).toContain("Stopped after 5 minutes of silence");
      expect(voiceHarness.recorderStops).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a thirty-minute hard limit even when audio activity keeps resetting silence", async () => {
    vi.useFakeTimers();
    try {
      await renderControl();
      await act(async () => { host.querySelector("button")!.click(); });
      await flush();
      await act(async () => sockets[0].open());
      await act(async () => sockets[0].message({ type: "ready" }));

      for (let minute = 0; minute < 29; minute += 1) {
        await act(async () => {
          vi.advanceTimersByTime(60_000);
          voiceHarness.frameCallbacks[0](new Float32Array([0.2, -0.2]));
        });
      }
      expect(voiceHarness.recorderStops).toBe(0);
      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(host.textContent).toContain("Stopped at the 30-minute limit");
      expect(voiceHarness.recorderStops).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("inserts finalized text at the captured cursor without overwriting typed text", async () => {
    const Composer = () => {
      const [value, setValue] = useState("hello world");
      return (
        <>
          <textarea aria-label="Composer" value={value} onChange={(event) => setValue(event.target.value)} />
          <DictationMicButton
            onText={(segment, insertion) => setValue((previous) => appendDictation(previous, segment, insertion))}
            showStatus
            scopeEpoch="account-a"
          />
        </>
      );
    };
    await act(async () => root.render(<Composer />));
    const textarea = host.querySelector("textarea")!;
    textarea.focus();
    textarea.setSelectionRange(6, 11);
    const button = host.querySelector("button")!;
    await act(async () => button.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    await act(async () => { button.click(); });
    await flush();
    await act(async () => sockets[0].open());
    await act(async () => sockets[0].message({ type: "ready" }));
    await act(async () => sockets[0].message({ type: "transcript", text: "PAIGE", is_final: true }));
    await act(async () => sockets[0].message({ type: "transcript", text: "systems", is_final: true }));
    expect(textarea.value).toBe("hello PAIGE systems world");
  });

  it("preserves the composer caret when keyboard focus crosses another toolbar control", async () => {
    const Composer = () => {
      const [value, setValue] = useState("hello world");
      const composerRef = useRef<HTMLTextAreaElement>(null);
      return (
        <>
          <textarea ref={composerRef} aria-label="Composer" value={value} onChange={(event) => setValue(event.target.value)} />
          <button type="button" aria-label="Toolbar control">Toolbar control</button>
          <DictationMicButton
            composerRef={composerRef}
            onText={(segment, insertion) => setValue((previous) => appendDictation(previous, segment, insertion))}
            showStatus
            scopeEpoch="account-a"
          />
        </>
      );
    };
    await act(async () => root.render(<Composer />));
    const textarea = host.querySelector("textarea")!;
    textarea.focus();
    textarea.setSelectionRange(6, 6);
    const toolbarControl = host.querySelector<HTMLButtonElement>('[aria-label="Toolbar control"]')!;
    toolbarControl.focus();
    const mic = host.querySelectorAll("button")[1]!;
    mic.focus();
    await act(async () => { mic.click(); });
    await flush();
    await act(async () => sockets[0].open());
    await act(async () => sockets[0].message({ type: "ready" }));
    await act(async () => sockets[0].message({ type: "transcript", text: "PAIGE", is_final: true }));
    expect(textarea.value).toBe("hello PAIGE world");
  });

  it("surfaces safety-stop and error reasons even when compact status is not requested", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(<DictationMicButton onText={vi.fn()} scopeEpoch="account-a" />);
      });
      await act(async () => { host.querySelector("button")!.click(); });
      await flush();
      await act(async () => sockets[0].open());
      await act(async () => sockets[0].message({ type: "ready" }));
      await act(async () => { vi.advanceTimersByTime(5 * 60_000); });
      expect(host.textContent).toContain("Stopped after 5 minutes of silence");

      const denied = new Error("denied"); denied.name = "NotAllowedError";
      voiceHarness.recorderStart.mockRejectedValueOnce(denied);
      await act(async () => {
        root.render(<DictationMicButton onText={vi.fn()} scopeEpoch="account-b" />);
      });
      await act(async () => { host.querySelector("button")!.click(); });
      await flush();
      expect(host.textContent).toContain("Mic permission off");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports capture activity through finalization so a composer can hold Send", async () => {
    const onActiveChange = vi.fn();
    const props = {
      onText: vi.fn(),
      scopeEpoch: "account-a",
      onActiveChange,
    } as Parameters<typeof DictationMicButton>[0] & {
      onActiveChange: (active: boolean) => void;
    };
    await act(async () => root.render(<DictationMicButton {...props} />));
    expect(onActiveChange).toHaveBeenLastCalledWith(false);

    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    await act(async () => sockets[0].open());
    await act(async () => sockets[0].message({ type: "ready" }));
    await act(async () => { host.querySelector("button")!.click(); });
    expect(onActiveChange).toHaveBeenLastCalledWith(true);

    await act(async () => sockets[0].message({ type: "transcript", text: "trailing words", is_final: true }));
    await act(async () => sockets[0].message({ type: "done" }));
    await act(async () => sockets[0].closed());
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });
  it("keeps customer error feedback in its own full-width composer row", async () => {
    const denied = new DOMException("Denied", "NotAllowedError");
    voiceHarness.recorderStart.mockRejectedValueOnce(denied);
    await act(async () => root.render(<DictationMicButton onText={vi.fn()} scopeEpoch="customer-a" statusLayout="composer-row" />));
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    const alert = host.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.parentElement).toBe(host);
    expect(alert.classList.contains("basis-full")).toBe(true);
    expect(alert.classList.contains("text-sm")).toBe(true);
    expect(alert.dataset.dictationState).toBe("permission-denied");
    expect(host.querySelector("button")?.getAttribute("aria-describedby")).toBe(alert.id);
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Microphone permission off");
  });

  it("preserves the shared inline status layout by default for the other composers", async () => {
    voiceHarness.recorderStart.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    await act(async () => root.render(<DictationMicButton onText={vi.fn()} scopeEpoch="owner-a" />));
    await act(async () => { host.querySelector("button")!.click(); });
    await flush();
    const alert = host.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.parentElement).not.toBe(host);
    expect(alert.parentElement?.dataset.dictationState).toBe("permission-denied");
    expect(alert.classList.contains("max-w-52")).toBe(true);
    expect(alert.classList.contains("basis-full")).toBe(false);
  });

});
