import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

const harness = vi.hoisted(() => ({ oauth: vi.fn().mockResolvedValue({ redirected: true }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: {
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
  } },
}));
vi.mock("@/integrations/auth/oauth", () => ({ signInWithOAuth: harness.oauth }));
vi.mock("@/hooks/useAnalytics", () => ({ trackEvent: vi.fn() }));
import Auth from "./Auth";

describe("OAuth recovery in the real auth route", () => {
  it("clears the failed fragment, renders login, and starts a fresh login callback rather than signup", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const button = (name: string) => [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === name)!;
    try {
    window.history.replaceState({ idx: 0 }, "", "/auth?mode=signup#preserved=false&error=server_error&error_description=private-detail");
    expect(window.location.hash).toContain("error=server_error");
    await act(async () => { root.render(<BrowserRouter><Auth /></BrowserRouter>); });
    expect(window.location.hash).toContain("error=server_error");
    expect(host.querySelector("h1")?.textContent).toBe("We could not verify your identity");
    expect(host.textContent).not.toContain("private-detail");
    await act(async () => { button("Try signing in again").click(); });
    expect(host.querySelector("h1")?.textContent).toBe("Welcome back");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?mode=login");
    await act(async () => { button("Google").click(); });
    expect(harness.oauth).toHaveBeenCalledWith(
      "google", `${window.location.origin}/auth?mode=login`, { chooseAccount: true },
    );
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
      vi.clearAllMocks();
      vi.unstubAllGlobals();
      window.history.replaceState(null, "", "/");
    }
  });
});
