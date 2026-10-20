import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlatformUpdate } from "./usePlatformUpdate";
import { useBeforeUnloadGuard } from "./useBeforeUnloadGuard";

describe("canonical update recovery after a screen import fails", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  let current: ReturnType<typeof usePlatformUpdate>;
  const response = (buildId: string) => ({ ok: true, json: async () => ({ buildId, customerUpdate: null }) });
  beforeEach(() => {
    vi.stubEnv("PROD", true);
    vi.stubGlobal("__BUILD_ID__", "test-current-build");
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  });
  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove(); root = null; host = null;
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  });
  async function mount(dirty = false) {
    function Probe() { current = usePlatformUpdate(); useBeforeUnloadGuard(dirty); return null; }
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(<Probe />));
  }
  async function preloadError() {
    const event = new Event("vite:preloadError", { cancelable: true });
    await act(async () => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  }

  it("rechecks the existing version source and reveals only a genuinely different build", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response("test-current-build")).mockResolvedValue(response("test-next-build"));
    vi.stubGlobal("fetch", fetch);
    await mount(); expect(current!.updateAvailable).toBe(false);
    await preloadError();
    expect(current!.updateAvailable).toBe(true);
    expect(current!.customerUpdate).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toMatch(/^\/version\.json\?t=\d+$/);
      expect(options.cache).toBe("no-store");
    }
  });

  it.each(["same", "unavailable"])("never invents an update when the version source is %s", async mode => {
    const fetch = vi.fn().mockResolvedValueOnce(response("test-current-build"));
    if (mode === "same") fetch.mockResolvedValue(response("test-current-build"));
    else fetch.mockRejectedValueOnce(new Error("No version response"));
    vi.stubGlobal("fetch", fetch);
    await mount(); await preloadError();
    expect(current!.updateAvailable).toBe(false);
    expect(current!.reload()).toBe(false);
  });

  it("reoffers the same canonical notice after dismissal without bypassing unsaved work", async () => {
    const fetch = vi.fn().mockResolvedValue(response("test-next-build"));
    vi.stubGlobal("fetch", fetch);
    await mount(true); expect(current!.updateAvailable).toBe(true);
    act(() => current.dismiss()); expect(current!.updateAvailable).toBe(false);
    await preloadError(); expect(current!.updateAvailable).toBe(true);
    expect(current!.reload()).toBe(false);
  });

  it("removes its listener on unmount", async () => {
    const fetch = vi.fn().mockResolvedValue(response("test-current-build"));
    vi.stubGlobal("fetch", fetch);
    await mount(); expect(fetch).toHaveBeenCalledOnce();
    act(() => root?.unmount()); root = null;
    await preloadError(); expect(fetch).toHaveBeenCalledOnce();
  });
});
