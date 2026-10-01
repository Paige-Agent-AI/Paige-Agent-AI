import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveConversationCard } from "@/lib/paigeLiveConversation/contract";

const control = vi.hoisted(() => ({
  start: vi.fn(),
  transition: vi.fn(async (_id?: string, _action?: string) => undefined),
  renew: vi.fn(),
  acceptTerms: vi.fn(),
}));
const relay = vi.hoisted(() => ({
  connect: vi.fn(),
  stop: vi.fn(),
  interrupt: vi.fn(),
  setMuted: vi.fn(),
  runtimeProof: vi.fn(),
  runtimeFailed: vi.fn(),
}));
vi.mock("@/lib/paigeLiveConversation/client", () => ({
  startPaigeLiveConversation: control.start,
  transitionPaigeLiveConversation: control.transition,
  renewPaigeLiveRelayTicket: control.renew,
  acceptPaigeLiveTerms: control.acceptTerms,
}));
// The 3D presence fetches a 3.7 MB GLB through a lazy import and needs a WebGL context; neither
// exists here. The component already falls back to the flat presence when WebGL is absent, which is
// exactly what happens in this environment, so these tests exercise the real fallback path rather
// than a stub of it.
vi.mock("@/lib/paigeLiveConversation/relayTransport", () => ({
  connectPaigeLiveRelay: relay.connect,
}));

import { PaigeLiveConversation } from "./PaigeLiveConversation";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const clickText = (text: string) => {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button not found: ${text}`);
  button.click();
  return button;
};

describe("Paige Live Conversation owner surface", () => {
  let host: HTMLDivElement;
  let root: Root;
  let getUserMedia: ReturnType<typeof vi.fn>;
  const ensureThread = vi.fn(async () => "11111111-1111-4111-8111-111111111111");
  const onAnswer = vi.fn();
  const onApprove = vi.fn();
  const onDecline = vi.fn();
  const onVoiceTurn = vi.fn();
  const onVoiceInterrupt = vi.fn();

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    control.start.mockReset();
    control.transition.mockClear();
    control.transition.mockImplementation(async () => undefined);
    control.renew.mockReset();
    control.acceptTerms.mockReset();
    relay.connect.mockReset();
    relay.stop.mockClear();
    relay.interrupt.mockClear();
    relay.setMuted.mockClear();
    relay.runtimeProof.mockClear();
    relay.runtimeFailed.mockClear();
    relay.connect.mockReturnValue({
      stop: relay.stop, interrupt: relay.interrupt, setMuted: relay.setMuted,
      runtimeProof: relay.runtimeProof, runtimeFailed: relay.runtimeFailed,
      subscribeOutput: () => () => {}, outputPlaying: () => false,
      readEnergy: () => ({ amplitude: 0, brightness: 0 }),
      pauseOutput: vi.fn(), resumeOutput: vi.fn(), clearOutput: vi.fn(),
    });
    ensureThread.mockClear();
    onAnswer.mockClear();
    onApprove.mockClear();
    onDecline.mockClear();
    onVoiceTurn.mockClear();
    onVoiceInterrupt.mockClear();
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    control.start.mockResolvedValue({ ok: false, sessionId: "22222222-2222-4222-8222-222222222222", availability: "PROOF OWED", code: "privacy_not_approved", explanation: "Live audio stays off until retention is approved. Nothing was recorded or sent." });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    document.body.querySelectorAll(".plc-stage").forEach((node) => node.remove());
  });

  const render = async (card: LiveConversationCard | null = null, epoch = "tenant-a||", working = false, threadId: string | null = null, disabled = false, voiceTurn = onVoiceTurn) => {
    await act(async () => root.render(
      <PaigeLiveConversation
        contextEpoch={epoch}
        threadId={threadId}
        ensureThread={ensureThread}
        transcript={[{ id: "m1", role: "assistant", content: "We are still in the same thread." }]}
        activeCard={card}
        working={working}
        disabled={disabled}
        confirmationFingerprints={["fingerprint-1"]}
        onAnswer={onAnswer}
        onApprove={onApprove}
        onDecline={onDecline}
        onVoiceTurn={voiceTurn}
        onVoiceInterrupt={onVoiceInterrupt}
      />,
    ));
  };

  it("uses the latest chat callback after lazy thread creation and later renders", async () => {
    control.start.mockResolvedValueOnce({ ok: true, sessionId: "session", ticket: "ticket", availability: "PROOF OWED", code: "relay_ticket_issued" });
    await render();
    await act(async () => clickText("Talk live with Paige"));
    const socket = relay.connect.mock.calls[0][0];
    const latest = vi.fn();
    await render(null, "tenant-a||", false, "11111111-1111-4111-8111-111111111111", false, latest);
    await act(async () => socket.onVoiceTurn("next turn", "turn", "challenge"));
    expect(latest).toHaveBeenCalledOnce();
    expect(onVoiceTurn).not.toHaveBeenCalled();
  });

  it.each(["offline", "hidden", "disconnected", "unavailable"])("cancels an active voice runtime once on %s, then fences late proof", async (exit) => {
    control.start.mockResolvedValueOnce({ ok: true, sessionId: "session", ticket: "ticket", availability: "PROOF OWED", code: "relay_ticket_issued" });
    await render();
    await act(async () => clickText("Talk live with Paige"));
    const socket = relay.connect.mock.calls[0][0];
    await act(async () => { socket.onState({ kind: "ready" }); socket.onVoiceTurn("hello", "turn", "challenge"); });
    const sink = onVoiceTurn.mock.calls[0][1];
    await act(async () => {
      if (exit === "offline") window.dispatchEvent(new Event("offline"));
      else if (exit === "hidden") {
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        document.dispatchEvent(new Event("visibilitychange"));
      } else socket.onState({ kind: exit, message: "Stopped" });
    });
    await act(async () => { sink.proof("late"); sink.done(); });
    expect(onVoiceInterrupt).toHaveBeenCalledOnce();
    expect(relay.runtimeProof).not.toHaveBeenCalled();
  });

  it("opens the same-thread immersive stage and fails closed without requesting a microphone", async () => {
    await render();
    await act(async () => clickText("Talk live with Paige"));
    await flush();
    expect(ensureThread).toHaveBeenCalledTimes(1);
    expect(control.start).toHaveBeenCalledWith(expect.objectContaining({ threadId: "11111111-1111-4111-8111-111111111111", contextEpoch: "tenant-a||", entryMode: "embedded" }));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Same workspace · same conversation");
    expect(document.querySelector(".plc-transcript")?.textContent).toContain("We are still in the same thread.");
    expect(document.querySelector(".plc-notice")?.textContent).toContain("PROOF OWED");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("uses the one-use ticket only for the first-party relay and keeps capture off until ready", async () => {
    control.start.mockResolvedValueOnce({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "opaque-once", availability: "PROOF OWED", code: "relay_ticket_issued",
      explanation: "Checking the live connection.",
    });
    await render();
    await act(async () => clickText("Talk live with Paige"));
    await flush();
    expect(relay.connect).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "22222222-2222-4222-8222-222222222222", ticket: "opaque-once",
    }));
    expect(getUserMedia).not.toHaveBeenCalled();
    const onState = relay.connect.mock.calls[0][0].onState;
    await act(async () => onState({ kind: "unavailable", message: "Live audio is not connected yet. You can keep working with Paige in chat." }));
    expect(document.querySelector(".plc-notice")?.textContent).toContain("UNAVAILABLE");
    expect(document.querySelector(".plc-notice")?.textContent).toContain("keep working with Paige in chat");
    expect(getUserMedia).not.toHaveBeenCalled();
    await act(async () => clickText("End"));
    expect(relay.stop).toHaveBeenCalledOnce();
  });

  it("routes spoken input to the same Paige turn without approving it, and cancels a barge-in", async () => {
    control.start.mockResolvedValueOnce({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "first-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    await render();
    await act(async () => clickText("Talk live with Paige"));
    const live = relay.connect.mock.calls[0][0];
    await act(async () => live.onState({ kind: "ready" }));
    await act(async () => live.onVoiceTurn("yes", "turn-1", "signed-challenge"));
    expect(onVoiceTurn).toHaveBeenCalledWith("yes", expect.objectContaining({
      challenge: "signed-challenge", proof: expect.any(Function),
    }));
    expect(onApprove).not.toHaveBeenCalled();
    const sink = onVoiceTurn.mock.calls[0][1];
    await act(async () => sink.proof("signed-output"));
    expect(relay.runtimeProof).toHaveBeenCalledWith("turn-1", "signed-output");
    await act(async () => live.onRuntimeCancel("turn-1"));
    expect(onVoiceInterrupt).toHaveBeenCalledOnce();
    await act(async () => { sink.proof("late-output"); sink.done(); });
    expect(relay.runtimeProof).toHaveBeenCalledTimes(1);
  });

  it("keeps audio unavailable during genuine text work and clears working Presence afterwards", async () => {
    await render();
    await act(async () => clickText("Talk live with Paige"));
    await render(null, "tenant-a||", true);
    expect(document.querySelector('[data-presence-state="working"]')).not.toBeNull();
    expect(document.querySelector(".plc-notice")?.textContent).toContain("PROOF OWED");
    await render();
    expect(document.querySelector('[data-presence-state="unavailable"]')).not.toBeNull();
    expect(document.querySelector(".plc-working")?.textContent).toContain("No active work");
  });

  it("ends late setup results instead of reviving a closed stage", async () => {
    let resolve!: (value: unknown) => void;
    control.start.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await render();
    await act(async () => { clickText("Talk live with Paige"); });
    await flush();
    await act(async () => clickText("End"));
    await act(async () => resolve({ sessionId: "late-session", availability: "PROOF OWED" }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(control.transition).toHaveBeenCalledWith("late-session", "end", expect.objectContaining({ contextEpoch: "tenant-a||" }));
  });

  it("restores a minimized same-thread session without creating another one", async () => {
    await render(null, "tenant-a||", false, "thread-a");
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => clickText("Minimize"));
    await act(async () => clickText("Talk live with Paige"));
    expect(control.start).toHaveBeenCalledTimes(1);
    expect(control.transition).toHaveBeenCalledWith(expect.any(String), "restore", { threadId: "thread-a", contextEpoch: "tenant-a||" });
  });

  it("waits for minimize and restore to settle before renewing a ticket", async () => {
    let finishMinimize!: () => void;
    let finishRestore!: () => void;
    const minimize = new Promise<void>((resolve) => { finishMinimize = resolve; });
    const restore = new Promise<void>((resolve) => { finishRestore = resolve; });
    control.start.mockResolvedValueOnce({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "first-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    control.transition.mockImplementation((_id, action) => {
      if (action === "minimize") return minimize;
      if (action === "restore") return restore;
      return Promise.resolve();
    });
    control.renew.mockResolvedValue({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "renewed-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    await render(null, "tenant-a||", false, "thread-a");
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => clickText("Minimize"));
    await act(async () => clickText("Talk live with Paige"));
    expect(control.renew).not.toHaveBeenCalled();
    expect(control.transition).not.toHaveBeenCalledWith(expect.any(String), "restore", expect.anything());
    await act(async () => finishMinimize());
    await flush();
    expect(control.transition).toHaveBeenCalledWith(expect.any(String), "restore", expect.anything());
    expect(control.renew).not.toHaveBeenCalled();
    await act(async () => finishRestore());
    await flush();
    expect(control.renew).toHaveBeenCalledOnce();
    expect(relay.connect).toHaveBeenLastCalledWith(expect.objectContaining({ ticket: "renewed-ticket" }));
  });

  it("shows unavailable and does not reconnect when a minimized workspace loses Live availability", async () => {
    control.start.mockResolvedValueOnce({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "first-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    control.renew.mockResolvedValueOnce({
      ok: false, sessionId: null, availability: "UNAVAILABLE", code: "live_audio_not_enabled",
      explanation: "Live audio isn't available for this workspace yet. You can keep working with Paige in chat.",
    });
    await render(null, "tenant-a||", false, "thread-a");
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => relay.connect.mock.calls[0][0].onState({ kind: "ready" }));
    await act(async () => clickText("Minimize"));
    await act(async () => clickText("Talk live with Paige"));
    await flush();
    expect(relay.connect).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".plc-notice")?.textContent).toContain("UNAVAILABLE");
    expect(document.querySelector(".plc-notice")?.textContent).toContain("isn't available for this workspace yet");
    expect(document.querySelector('[data-presence-state="unavailable"]')).not.toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("returns to listening with usable controls after holding a ready relay", async () => {
    control.start.mockResolvedValueOnce({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "first-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    await render();
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => relay.connect.mock.calls[0][0].onState({ kind: "ready" }));
    await act(async () => clickText("Hold"));
    expect(document.querySelector(".plc-presence")?.getAttribute("data-live-state")).toBe("held");
    await act(async () => clickText("Resume"));
    expect(document.querySelector(".plc-presence")?.getAttribute("data-live-state")).toBe("listening");
    expect(relay.setMuted).toHaveBeenLastCalledWith(false);
    expect(clickText("Interrupt").disabled).toBe(false);
  });

  it("never unmutes capture while the owner is on Hold", async () => {
    control.start.mockResolvedValueOnce({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "first-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    await render();
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => relay.connect.mock.calls[0][0].onState({ kind: "ready" }));
    await act(async () => clickText("Hold"));
    await act(async () => clickText("Mute"));
    relay.setMuted.mockClear();
    await act(async () => clickText("Unmute"));
    expect(relay.setMuted).toHaveBeenLastCalledWith(true);
    await act(async () => clickText("Resume"));
    expect(relay.setMuted).toHaveBeenLastCalledWith(false);
  });

  it("keeps the owner's mute choice when replacing a relay ticket", async () => {
    control.start.mockResolvedValueOnce({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "first-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    control.renew.mockResolvedValue({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "renewed-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    await render(null, "tenant-a||", false, "thread-a");
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => relay.connect.mock.calls[0][0].onState({ kind: "ready" }));
    await act(async () => clickText("Mute"));
    await act(async () => clickText("Minimize"));
    relay.setMuted.mockClear();
    await act(async () => clickText("Talk live with Paige"));
    await flush();
    expect(relay.connect).toHaveBeenLastCalledWith(expect.objectContaining({ ticket: "renewed-ticket" }));
    expect(relay.setMuted).toHaveBeenCalledWith(true);
    expect(document.querySelector(".plc-controls")?.textContent).toContain("Unmute");
  });

  it("applies the latest unmute choice when a pending renewal finally connects", async () => {
    let finishRenew!: (value: unknown) => void;
    control.start.mockResolvedValueOnce({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "first-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    control.renew.mockReturnValueOnce(new Promise((resolve) => { finishRenew = resolve; }));
    await render(null, "tenant-a||", false, "thread-a");
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => relay.connect.mock.calls[0][0].onState({ kind: "ready" }));
    await act(async () => clickText("Mute"));
    await act(async () => clickText("Minimize"));
    await act(async () => { clickText("Talk live with Paige"); });
    await flush();
    await act(async () => clickText("Unmute"));
    relay.setMuted.mockClear();
    await act(async () => finishRenew({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "renewed-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    }));
    expect(relay.connect).toHaveBeenLastCalledWith(expect.objectContaining({ ticket: "renewed-ticket" }));
    expect(relay.setMuted).toHaveBeenLastCalledWith(false);
    expect(document.querySelector(".plc-controls")?.textContent).toContain("Mute");
  });

  it("shows listening Presence after the relay is genuinely ready", async () => {
    control.start.mockResolvedValueOnce({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "first-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    await render();
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => relay.connect.mock.calls[0][0].onState({ kind: "ready" }));
    expect(document.querySelector(".plc-state")?.textContent).toContain("Listening");
    expect(document.querySelector('[data-presence-state="listening"]')).not.toBeNull();
    expect(document.querySelector('[data-presence-state="unavailable"]')).toBeNull();
    await act(async () => clickText("Mute"));
    expect(relay.setMuted).toHaveBeenLastCalledWith(true);
    expect(document.querySelector('[data-presence-state="listening"]')).toBeNull();
    expect(document.querySelector(".plc-state")?.textContent).toContain("Muted");
    await act(async () => clickText("Unmute"));
    expect(relay.setMuted).toHaveBeenLastCalledWith(false);
    expect(document.querySelector('[data-presence-state="listening"]')).not.toBeNull();
    expect(document.querySelector(".plc-state")?.textContent).toContain("Listening");
  });

  it("keeps listening controls available after a ready relay is interrupted", async () => {
    control.start.mockResolvedValueOnce({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "first-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    await render();
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => relay.connect.mock.calls[0][0].onState({ kind: "ready" }));
    await act(async () => clickText("Interrupt"));
    expect(relay.interrupt).toHaveBeenCalledOnce();
    expect(document.querySelector(".plc-presence")?.getAttribute("data-live-state")).toBe("listening");
    expect(clickText("Hold").disabled).toBe(false);
  });

  it.each([false, true])("interrupting Hold restores the selected mute state (%s)", async (muted) => {
    control.start.mockResolvedValueOnce({
      ok: true, sessionId: "22222222-2222-4222-8222-222222222222",
      ticket: "first-ticket", availability: "PROOF OWED", code: "relay_ticket_issued",
    });
    await render();
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => relay.connect.mock.calls[0][0].onState({ kind: "ready" }));
    if (muted) await act(async () => clickText("Mute"));
    await act(async () => clickText("Hold"));
    expect(relay.setMuted).toHaveBeenLastCalledWith(true);
    await act(async () => clickText("Interrupt"));
    expect(relay.setMuted).toHaveBeenLastCalledWith(muted);
    expect(document.querySelector(".plc-state")?.textContent).toContain(muted ? "Muted" : "Listening");
  });

  it("ends a minimized session on workspace or thread switch", async () => {
    await render(null, "tenant-a||", false, "thread-a");
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => clickText("Minimize"));
    await render(null, "tenant-a||", false, "thread-b");
    expect(control.transition).toHaveBeenCalledWith(expect.any(String), "end", { threadId: "thread-a", contextEpoch: "tenant-a||" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("ends the bound session when New chat selects a null provisional thread", async () => {
    await render(null, "tenant-a||", false, "thread-a");
    await act(async () => clickText("Talk live with Paige"));
    await act(async () => clickText("Minimize"));
    await render(null, "tenant-a||", false, null);
    expect(control.transition).toHaveBeenCalledWith(expect.any(String), "end", { threadId: "thread-a", contextEpoch: "tenant-a||" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("minimizes to the exact chat control and restores keyboard focus", async () => {
    await render();
    const trigger = clickText("Talk live with Paige");
    await flush();
    await act(async () => clickText("Minimize"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(control.transition).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", "minimize", { threadId: "11111111-1111-4111-8111-111111111111", contextEpoch: "tenant-a||" });
  });

  it("focuses the portaled stage and lets Escape return to the exact chat control", async () => {
    await render();
    const trigger = clickText("Talk live with Paige");
    await flush();
    const stage = document.querySelector('[role="dialog"]');
    expect(document.activeElement).toBe(stage);
    await act(async () => stage?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("ends and clears the stage when the workspace context changes", async () => {
    await render();
    await act(async () => clickText("Talk live with Paige"));
    await flush();
    await render(null, "tenant-b||");
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(control.transition).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", "end", { threadId: "11111111-1111-4111-8111-111111111111", contextEpoch: "tenant-a||" });
  });

  it("renders every supported card type while keeping exactly one current card", async () => {
    const cards: LiveConversationCard[] = [
      { id: "q", kind: "question", title: "One question", source: { availability: "LIVE" } },
      { id: "c", kind: "choice", title: "Choose", choices: [{ id: "one", label: "First path" }, { id: "two", label: "Second path" }], source: { availability: "LIVE" } },
      { id: "p", kind: "plan", title: "Strategic Play", recordType: "strategic-play", statusLabel: "Current canonical plan", source: { availability: "LIVE", canonicalRef: "plan:1" } },
      { id: "e", kind: "evidence-result", title: "Verified result", resultLabel: "Available", source: { availability: "LIVE", provenanceLabel: "Canonical record" } },
      { id: "g", kind: "governed-action", title: "Move the deal", action: { toolName: "move_deal", authorityStatus: "confirmation-required", scopeSummary: "Deal A to Qualified" }, source: { availability: "LIVE" } },
      { id: "r", kind: "recap", title: "Recap", points: [{ id: "r1", text: "Keep the plan", ownerConfirmed: true }], source: { availability: "LIVE" } },
    ];
    await render(cards[0]);
    await act(async () => clickText("Talk live with Paige"));
    await flush();
    for (const card of cards) {
      await render(card);
      expect(document.querySelectorAll(".plc-card")).toHaveLength(1);
      expect(document.querySelector(".plc-card")?.getAttribute("data-card-kind")).toBe(card.kind);
    }
  });

  it("routes ordinary choices and exact governed confirmation fingerprints through chat callbacks", async () => {
    const choice: LiveConversationCard = { id: "c", kind: "choice", title: "Choose", choices: [{ id: "one", label: "First path" }, { id: "two", label: "Second path" }], source: { availability: "LIVE" } };
    await render(choice);
    await act(async () => clickText("Talk live with Paige"));
    await flush();
    await act(async () => clickText("Second path"));
    expect(onAnswer).toHaveBeenCalledWith("Second path");

    const governed: LiveConversationCard = { id: "g", kind: "governed-action", title: "Move the deal", action: { toolName: "move_deal", authorityStatus: "confirmation-required", scopeSummary: "Deal A to Qualified", confirmationFingerprints: ["fingerprint-1"] }, source: { availability: "LIVE" } };
    await render(governed);
    await act(async () => clickText("Confirm this action"));
    expect(onApprove).toHaveBeenCalledWith(["fingerprint-1"]);
  });

  it("holds an already-open card action when its parent context becomes disabled", async () => {
    const choice: LiveConversationCard = { id: "c", kind: "choice", title: "Choose", choices: [{ id: "one", label: "First path" }, { id: "two", label: "Second path" }], source: { availability: "LIVE" } };
    await render(choice);
    await act(async () => clickText("Talk live with Paige"));
    await flush();
    await render(choice, "tenant-a||", false, null, true);
    const action = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Second path"));
    expect(action).toBeInstanceOf(HTMLButtonElement);
    expect((action as HTMLButtonElement).disabled).toBe(true);
    await act(async () => (action as HTMLButtonElement).click());
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("does not end an open session when Retry is invoked while its parent is disabled", async () => {
    await render();

    await act(async () => {
      clickText("Talk live with Paige");
    });
    await flush();

    control.transition.mockClear();
    await render(null, "tenant-a||", false, null, true);

    const retry = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Retry setup check"),
    );

    expect(retry).toBeInstanceOf(HTMLButtonElement);
    expect((retry as HTMLButtonElement).disabled).toBe(true);

    // Force the handler path too: the in-handler guard must remain a backstop
    // even if a stale/synthetic event bypasses the native disabled control.
    (retry as HTMLButtonElement).disabled = false;
    await act(async () => {
      (retry as HTMLButtonElement).click();
    });

    expect(control.transition).not.toHaveBeenCalled();
    expect(control.start).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("shows permission denial and retry without fabricating audio state", async () => {
    control.start.mockResolvedValueOnce({ ok: false, sessionId: null, availability: "UNAVAILABLE", code: "microphone_permission_denied", explanation: "Microphone access was denied. Nothing was recorded." });
    await render();
    await act(async () => clickText("Talk live with Paige"));
    await flush();
    expect(document.querySelector(".plc-state")?.textContent).toContain("Microphone permission denied");
    expect(clickText("Retry setup check")).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("keeps initial Shift+Tab and complete forward/backward focus movement inside the dialog", async () => {
    await render();
    await act(async () => clickText("Talk live with Paige"));
    await flush();
    const stage = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(stage).toBe(document.activeElement);
    await act(async () => stage.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
    expect(stage.contains(document.activeElement)).toBe(true);
    const focusable = [...stage.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
    focusable.at(-1)!.focus();
    await act(async () => focusable.at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(focusable[0]);
    focusable[0].focus();
    await act(async () => focusable[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(focusable.at(-1));
    expect(host.hasAttribute("inert")).toBe(true);
  });

  it("native companion close minimizes instead of reopening the stage over the platform", async () => {
    let beforeUnload: (() => void) | null = null;
    const popupDocument = document.implementation.createHTMLDocument("Paige");
    const popup = {
      document: popupDocument,
      closed: false,
      close: vi.fn(),
      addEventListener: vi.fn((name: string, listener: () => void) => { if (name === "beforeunload") beforeUnload = listener; }),
    } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(popup);
    await render();
    const trigger = clickText("Talk live with Paige");
    await flush();
    await act(async () => clickText("Open in window"));
    expect(popupDocument.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => beforeUnload?.());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(popupDocument.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(control.transition).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", "minimize", { threadId: "11111111-1111-4111-8111-111111111111", contextEpoch: "tenant-a||" });
  });

  // §70 — the deliverable is a person completing a task, not a code path that exists. Until this
  // control shipped, a Solo user whose rollout was open still had no way to give the acceptance the
  // database requires, so Live stayed off for a reason they could neither see nor act on.
  describe("turning Live on is something a person can actually finish", () => {
    const refusedForTerms = {
      ok: false, sessionId: null, availability: "UNAVAILABLE", code: "live_audio_not_enabled",
      explanation: "Live audio isn't available for this account yet. You can keep working with Paige in chat.",
    };

    it("offers the terms, and says what is true about the audio before anyone speaks", async () => {
      control.start.mockResolvedValue(refusedForTerms);
      await render();
      clickText("Talk live with Paige");
      await flush();
      const notice = document.querySelector(".plc-notice");
      expect(notice?.textContent).toContain("default retention");
      expect(notice?.textContent).toContain("one speaker");
      expect(notice?.textContent).toContain("your own decision for your own account");
      expect([...document.querySelectorAll("button")].some((b) => b.textContent?.includes("I understand"))).toBe(true);
    });

    it("accepting admits the person and starts the session, with no identifier supplied by the caller", async () => {
      control.start.mockResolvedValueOnce(refusedForTerms);
      control.acceptTerms.mockResolvedValue({ accepted: true, unchanged: false, code: null });
      control.start.mockResolvedValue({
        ok: true, sessionId: "22222222-2222-4222-8222-222222222222", availability: "LIVE",
        code: "live", explanation: "", ticket: "ticket-1", ticketExpiresAt: Date.now() + 60_000,
      });
      await render();
      clickText("Talk live with Paige");
      await flush();
      await act(async () => { clickText("I understand"); });
      await flush();
      // The RPC takes NO arguments. That is the doctrine — a build that needs an account identifier
      // is the wrong build — so it is asserted here rather than left to the migration comment.
      expect(control.acceptTerms).toHaveBeenCalledTimes(1);
      expect(control.acceptTerms.mock.calls[0]).toEqual([]);
      // And the acceptance is followed by a real attempt, not a claim that it worked.
      expect(control.start).toHaveBeenCalledTimes(2);
      expect(relay.connect).toHaveBeenCalled();
    });

    it("a refusal stays honest: no session is started and nothing claims success", async () => {
      control.start.mockResolvedValue(refusedForTerms);
      control.acceptTerms.mockResolvedValue({ accepted: false, unchanged: false, code: "live_audio_not_enabled" });
      await render();
      clickText("Talk live with Paige");
      await flush();
      await act(async () => { clickText("I understand"); });
      await flush();
      expect(control.start).toHaveBeenCalledTimes(1);
      expect(relay.connect).not.toHaveBeenCalled();
      const notice = document.querySelector(".plc-notice");
      expect(notice?.textContent).toContain("UNAVAILABLE");
      expect(notice?.textContent).toContain("nothing was recorded, sent, or saved");
      // The old assertion here was `expect(getUserMedia).not.toHaveBeenCalled()`, which could never
      // fail: nothing in src/ calls getUserMedia outside tests, and the relay is mocked, so this
      // suite could not observe a microphone request even if one happened. What IS observable, and
      // is the thing that matters, is that no relay connection was opened and the terms are still
      // being offered rather than replaced by a claim of success.
      expect(relay.connect).not.toHaveBeenCalled();
      expect(document.querySelector(".plc-terms")).not.toBeNull();

      // THE PRESS MUST BE VISIBLE. This suite passed while the control was, to a human, dead: the
      // old branch re-set the explanation to the sentence already on screen and left the button
      // exactly where it was, so pressing it changed literally nothing on the surface. The owner
      // pressed it and reported it broken. A refusal is an outcome, so assert the outcome is drawn
      // and that the control which cannot succeed is no longer offered.
      const blocked = document.querySelector(".plc-terms__blocked");
      expect(blocked).not.toBeNull();
      expect(blocked?.textContent).toContain("not something you can turn on from here");
      expect(document.querySelector(".plc-terms button")).toBeNull();
    });

    it("a thrown failure says so instead of silently doing nothing", async () => {
      // The reachable case is ordinary: acceptPaigeLiveTerms dynamically imports the Supabase
      // client, and a hashed chunk goes stale the moment a deploy lands under an open tab. Before
      // this was caught, the button flipped back from "Turning on Live…" with no message at all —
      // a press that does nothing and says nothing, which is the exact failure this control exists
      // to remove.
      control.start.mockResolvedValue(refusedForTerms);
      control.acceptTerms.mockRejectedValue(new Error("Failed to fetch dynamically imported module"));
      await render();
      clickText("Talk live with Paige");
      await flush();
      await act(async () => { clickText("I understand"); });
      await flush();
      const notice = document.querySelector(".plc-notice");
      expect(notice?.textContent).toContain("could not turn Live on");
      expect(notice?.textContent).toContain("Nothing was recorded, sent, or saved");
      expect(relay.connect).not.toHaveBeenCalled();
      // And the control is usable again rather than stuck mid-flight.
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("I understand"));
      expect(button?.disabled).toBe(false);
    });

    it("a later, different failure does not leave the audio-consent panel standing", async () => {
      // `reason` is set on every refusal and was cleared in one place, so after the first
      // "not open yet" it survived retries — and any later failure (a dropped socket, an expired
      // session) still rendered the retention consent panel underneath it, inviting someone to
      // accept provider retention in order to fix a network error.
      control.start.mockResolvedValueOnce(refusedForTerms);
      await render();
      clickText("Talk live with Paige");
      await flush();
      expect(document.querySelector(".plc-terms")).not.toBeNull();
      control.start.mockRejectedValue(new Error("network"));
      await act(async () => { clickText("Retry setup check"); });
      await flush();
      const notice = document.querySelector(".plc-notice");
      expect(notice?.textContent).toContain("could not verify live audio availability");
      expect(document.querySelector(".plc-terms")).toBeNull();
    });

    it("the terms are not offered for a refusal the person cannot act on", async () => {
      // privacy_not_approved is the platform's own gate. Offering an acceptance there would invite
      // someone to press a button that cannot change the answer.
      await render();
      clickText("Talk live with Paige");
      await flush();
      expect([...document.querySelectorAll("button")].some((b) => b.textContent?.includes("I understand"))).toBe(false);
      expect(document.querySelector(".plc-terms")).toBeNull();
    });
  });
});
