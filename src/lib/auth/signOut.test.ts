// Codex review of #1547 (260ce580): sign-out has many callers (shell headers, Settings → Security,
// the idle timeout, forced and expired sessions). An operator's act-as lives on the server, so the
// one sign-out seam asks the registered act-as check first, in the mode each caller declares.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ order: [] as string[], errors: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: vi.fn(async () => { h.order.push("signOut"); return { error: null }; }) } },
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => { h.errors.push(m); } } }));

import type { ActAsSettlement } from "./signOut";

// A completed sign-out leaves the module's in-flight flag set (the page is navigating away), so each
// case loads a fresh copy of the module.
let performSignOut: typeof import("./signOut").performSignOut;
let registerSignOutActAsGuard: typeof import("./signOut").registerSignOutActAsGuard;

describe("performSignOut and an open act-as", () => {
  let release: (() => void) | null = null;
  const original = window.location;

  beforeEach(async () => {
    vi.resetModules();
    ({ performSignOut, registerSignOutActAsGuard } = await import("./signOut"));
    h.order = [];
    h.errors = [];
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, replace: vi.fn(() => { h.order.push("redirect"); }) },
    });
  });

  afterEach(() => {
    release?.();
    release = null;
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  const guard = (answer: ActAsSettlement) => {
    release = registerSignOutActAsGuard(async () => { h.order.push("check"); return answer; });
  };

  it("checks for an open act-as before a chosen sign-out", async () => {
    guard("clear");
    expect(await performSignOut("/")).toBe(true);
    expect(h.order).toEqual(["check", "signOut", "redirect"]);
  });

  it("keeps a chosen sign-out from happening when the act-as does not end", async () => {
    guard("refused");
    expect(await performSignOut("/")).toBe(false);
    expect(h.order).toEqual(["check"]);
    expect(h.errors[0]).toContain("still signed in");
  });

  it("keeps a chosen sign-out from happening when the act-as cannot be confirmed", async () => {
    guard("unknown");
    expect(await performSignOut("/")).toBe(false);
    expect(h.order).toEqual(["check"]);
    expect(h.errors[0]).toContain("couldn't confirm");
    // And the seam is free for the next attempt.
    guard("clear");
    expect(await performSignOut("/")).toBe(true);
  });

  it("never holds a security sign-out, but still tries to end the act-as", async () => {
    guard("refused");
    expect(await performSignOut({ redirectTo: "/auth", actAs: "attempt" })).toBe(true);
    expect(h.order).toEqual(["check", "signOut", "redirect"]);
  });

  // Codex review of a9c6b22c: a stalled check must not keep a security sign-out from happening.
  it("does not let a stalled check hold a security sign-out", async () => {
    vi.useFakeTimers();
    try {
      release = registerSignOutActAsGuard(() => new Promise<ActAsSettlement>(() => {}));
      const done = performSignOut({ redirectTo: "/auth", actAs: "attempt" });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await done).toBe(true);
      expect(h.order).toEqual(["signOut", "redirect"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not try the server when the session is already invalid", async () => {
    guard("refused");
    expect(await performSignOut({ redirectTo: "/auth", actAs: "skip" })).toBe(true);
    expect(h.order).toEqual(["signOut", "redirect"]);
  });

  it("signs out as before when nothing is registered", async () => {
    expect(await performSignOut("/")).toBe(true);
    expect(h.order).toEqual(["signOut", "redirect"]);
  });
});
