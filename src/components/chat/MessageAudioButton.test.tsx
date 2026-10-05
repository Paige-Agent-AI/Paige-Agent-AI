import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageAudioButton } from "./MessageAudioButton";

const harness = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token" } } })),
  snapshot: { activeId: null as string | null, status: "idle" as const, needsConfig: false },
  toggle: vi.fn(),
  toastError: vi.fn(),
  toastMessage: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: harness.getSession } },
}));

vi.mock("@/lib/voice/messageTts", () => ({
  messageTts: {
    subscribe: () => () => undefined,
    getSnapshot: () => harness.snapshot,
    toggle: harness.toggle,
  },
}));

vi.mock("sonner", () => ({
  toast: { error: harness.toastError, message: harness.toastMessage },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("MessageAudioButton request identity and failure delivery", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    harness.getSession.mockClear();
    harness.toggle.mockReset();
    harness.toastError.mockClear();
    harness.toastMessage.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const renderButton = async () => {
    await act(async () => root.render(<MessageAudioButton messageId="message-1" content="Hello owner" />));
    return host.querySelector("button")!;
  };

  it("mints one UUID per play tap and reuses it for transport attempts inside that tap", async () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    vi.stubGlobal("crypto", { randomUUID });
    harness.toggle.mockImplementation(async (_id, fetchAudio) => {
      await fetchAudio();
      await fetchAudio();
    });
    const button = await renderButton();

    await act(async () => { button.click(); });
    await vi.waitFor(() => expect(harness.toggle).toHaveBeenCalledTimes(1));
    await act(async () => { await harness.toggle.mock.results[0]?.value; });
    await act(async () => { host.querySelector("button")!.click(); });
    await vi.waitFor(() => expect(harness.toggle).toHaveBeenCalledTimes(2));
    await act(async () => { await harness.toggle.mock.results[1]?.value; });

    expect(randomUUID).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(4);
    expect(new Headers(calls[0][1]?.headers).get("Idempotency-Key")).toBe("11111111-1111-4111-8111-111111111111");
    expect(new Headers(calls[1][1]?.headers).get("Idempotency-Key")).toBe("11111111-1111-4111-8111-111111111111");
    expect(new Headers(calls[2][1]?.headers).get("Idempotency-Key")).toBe("22222222-2222-4222-8222-222222222222");
    expect(new Headers(calls[3][1]?.headers).get("Idempotency-Key")).toBe("22222222-2222-4222-8222-222222222222");
  });

  it.each([
    ["tts_tenant_allowance_reached", 429, "message", /monthly allowance/i],
    ["tts_global_cap_reached", 429, "error", /temporarily unavailable/i],
    ["tts_platform_cost_limit", 503, "error", /temporarily unavailable/i],
    ["tts_emergency_disabled", 503, "error", /paused right now/i],
    ["tts_cost_limit_unavailable", 503, "error", /didn’t start/i],
    ["tts_request_already_reserved", 409, "message", /still be processing/i],
    ["tts_synth_failed", 502, "error", /didn’t start/i],
    ["tts_cost_settlement_unavailable", 503, "error", /didn’t start/i],
    ["voice_profile_unavailable", 503, "error", /didn’t start/i],
    ["tts_voice_profile_changed", 503, "error", /didn’t start/i],
  ] as const)("delivers the %s response as its honest state", async (code, status, channel, copy) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: code }), {
      status,
      headers: { "Content-Type": "application/json" },
    }));
    harness.toggle.mockImplementation(async (_id, fetchAudio, onError) => {
      try { await fetchAudio(); } catch (error) { onError?.(error); }
    });
    const button = await renderButton();

    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });

    const sink = channel === "message" ? harness.toastMessage : harness.toastError;
    expect(sink).toHaveBeenCalledWith(expect.stringMatching(copy));
  });

  it("INT-321: a workspace allowance refusal reaches the owner as allowance copy with the server's reset day", async () => {
    const year = new Date().getUTCFullYear();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ error: "tts_tenant_cost_limit", reset_at: `${year}-11-01T00:00:00Z` }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    ));
    harness.toggle.mockImplementation(async (_id, fetchAudio, onError) => {
      try { await fetchAudio(); } catch (error) { onError?.(error); }
    });
    const button = await renderButton();

    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });

    expect(harness.toastMessage).toHaveBeenCalledWith(
      "Voice playback has reached this workspace’s monthly allowance. It resets November 1.",
    );
    expect(harness.toastError).not.toHaveBeenCalled();
  });

  it.each([
    ["voice_profile_unavailable", false],
    ["tts_voice_profile_changed", false],
    ["tts_not_configured", true],
    ["tts_workspace_voice_disabled", true],
  ] as const)("INT-321 F1: %s disables playback for the session only when needsConfig=%s", async (code, sticky) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: code }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }));
    let thrown: { needsConfig?: boolean } | undefined;
    harness.toggle.mockImplementation(async (_id, fetchAudio, onError) => {
      try { await fetchAudio(); } catch (error) { thrown = error as { needsConfig?: boolean }; onError?.(error); }
    });
    const button = await renderButton();

    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });

    await vi.waitFor(() => expect(thrown).toBeDefined());
    // needsConfig is what flips the shared controller's sticky, session-wide disabled state.
    expect(thrown?.needsConfig).toBe(sticky);
    if (sticky) {
      expect(harness.toastError).not.toHaveBeenCalled();
    } else {
      expect(harness.toastError).toHaveBeenCalledWith("Voice playback didn’t start. Please try again.");
    }
  });

  it("INT-321: a bare 503 with no code is a retry, not a platform pause", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }));
    harness.toggle.mockImplementation(async (_id, fetchAudio, onError) => {
      try { await fetchAudio(); } catch (error) { onError?.(error); }
    });
    const button = await renderButton();

    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });

    expect(harness.toastError).toHaveBeenCalledWith("Voice playback didn’t start. Please try again.");
    expect(harness.toastError).not.toHaveBeenCalledWith(expect.stringMatching(/paused/i));
  });

  it("uses the approved retry copy when the per-tap request transport fails", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "tap-transport-error" });
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Failed to fetch internal transport detail"));
    harness.toggle.mockImplementation(async (_id, fetchAudio, onError) => {
      try { await fetchAudio(); } catch (error) { onError?.(error as Error); }
    });
    const button = await renderButton();

    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });

    expect(harness.toastError).toHaveBeenCalledWith("Voice playback didn’t start. Please try again.");
    expect(harness.toastError).not.toHaveBeenCalledWith("Failed to fetch internal transport detail");
    const requestHeaders = vi.mocked(fetch).mock.calls[0]?.[1]?.headers;
    expect(new Headers(requestHeaders).get("Idempotency-Key")).toBe("tap-transport-error");
  });

  it("uses the approved retry copy when browser playback fails", async () => {
    harness.toggle.mockImplementation(async (_id, _fetchAudio, onError) => {
      onError?.(new Error("play() failed because autoplay is blocked"));
    });
    const button = await renderButton();

    await act(async () => { button.click(); await Promise.resolve(); });

    expect(harness.toastError).toHaveBeenCalledWith("Voice playback didn’t start. Please try again.");
    expect(harness.toastError).not.toHaveBeenCalledWith("play() failed because autoplay is blocked");
  });
});
