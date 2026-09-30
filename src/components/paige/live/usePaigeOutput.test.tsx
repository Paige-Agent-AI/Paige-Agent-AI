import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ snapshot: { activeId: "old-message" as string | null, status: "loading", needsConfig: false }, stop: vi.fn(), pause: vi.fn(), resume: vi.fn() }));
vi.mock("@/lib/voice/messageTts", () => ({ messageTts: {
  subscribe: () => () => undefined, getSnapshot: () => store.snapshot,
  getAudioElement: () => null, stop: store.stop, pause: store.pause, resume: store.resume,
} }));
import { usePaigeOutput } from "./usePaigeOutput";
import type { RelayTransport } from "@/lib/paigeLiveConversation/relayTransport";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe("same-thread output ownership", () => {
  it("owns real relay playback, Hold, Resume and stale-source detachment", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    let output!: ReturnType<typeof usePaigeOutput>;
    let playing = false;
    const listeners = new Set<() => void>();
    const relay = {
      subscribeOutput: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
      outputPlaying: () => playing,
      readEnergy: () => ({ amplitude: .4, brightness: .2 }),
      pauseOutput: vi.fn(), resumeOutput: vi.fn(), clearOutput: vi.fn(),
    } as unknown as RelayTransport;
    function Harness() { output = usePaigeOutput(true, []); return null; }
    await act(async () => root.render(<Harness />));
    await act(async () => output.attachRelay(relay));
    await act(async () => { playing = true; listeners.forEach((fn) => fn()); });
    expect(output.playing).toBe(true);
    expect(output.readEnergy()).toEqual({ amplitude: .4, brightness: .2 });
    output.pause(); output.resume(); output.stop();
    expect(relay.pauseOutput).toHaveBeenCalledOnce();
    expect(relay.resumeOutput).toHaveBeenCalledOnce();
    expect(relay.clearOutput).toHaveBeenCalledOnce();
    await act(async () => output.attachRelay(null));
    expect(output.playing).toBe(false);
    expect(listeners.size).toBe(0);
    await act(async () => root.unmount());
  });
  it("stops the old owned loading output after a thread change without stopping another thread's new audio", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    let output!: ReturnType<typeof usePaigeOutput>;
    function Harness({ ids }: { ids: string[] }) { output = usePaigeOutput(true, ids); return null; }
    await act(async () => root.render(<Harness ids={["old-message"]} />));
    await act(async () => root.render(<Harness ids={["new-message"]} />));
    output.stop();
    expect(store.stop).toHaveBeenCalledTimes(1);
    store.stop.mockClear();
    await act(async () => root.render(<Harness ids={["old-message"]} />));
    store.snapshot = { ...store.snapshot, activeId: "different-owner" };
    await act(async () => root.render(<Harness ids={["new-message"]} />));
    output.stop();
    expect(store.stop).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
