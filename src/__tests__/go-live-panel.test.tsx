// go-live-panel — the Go Live surface on Marketing › Social (EXP07 broadcast slice).
//
// What these tests pin is the surface's HONESTY, not its layout: every phase is the door's
// own answer rendered truthfully. A door that cannot be reached, isn't deployed, or reports
// itself dormant all render the same honest "isn't switched on yet" with NO act button —
// the fail-closed default nothing may talk out of. Readiness renders only when the door
// asserted it; live renders only the session facts the door minted; ended names what the
// session was and was not (never a recording that no slice ships yet).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const door = vi.hoisted(() => ({
  /** Queued answers in call order; an Error makes invoke reject (door unreachable). */
  answers: [] as Array<Record<string, unknown> | Error>,
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (_name: string, { body }: { body: Record<string, unknown> }) => {
        door.calls.push(body);
        const next = door.answers.shift();
        if (next instanceof Error) throw next;
        return { data: next ?? null, error: null };
      },
    },
  },
}));
vi.mock("@/lib/integrations/connectError", () => ({ readFunctionErrorBody: async () => null }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "tenant-1" }) }));

import { GoLive } from "../solo/go-live";

const SESSION = { id: "ffff0000-0000-4000-8000-00000000c001", title: "Spring open house", started_at: "2026-10-28T23:00:00Z", guest_url: "https://paigeagent.ai/live/spring-open-house" };

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const mount = async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<GoLive />); });
  return container;
};

const text = () => container?.textContent ?? "";
const button = (label: string) =>
  Array.from(container?.querySelectorAll("button") ?? []).find((b) => b.textContent?.includes(label));

const click = async (label: string) => {
  const el = button(label);
  expect(el, `button "${label}"`).toBeTruthy();
  await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  vi.useRealTimers();
});

beforeEach(() => {
  door.answers = [];
  door.calls = [];
});

describe("Go live — fail-closed before readiness", () => {
  it("renders the honest not-switched-on state with NO act button when the door is unreachable", async () => {
    door.answers = [new Error("Function not found")];
    await mount();
    expect(text()).toContain("isn’t switched on for your workspace yet");
    expect(button("Go live")).toBeUndefined();
  });

  it("renders the same honest state when the door reports itself dormant", async () => {
    door.answers = [{ ok: false, error: "broadcast_not_enabled" }];
    await mount();
    expect(text()).toContain("isn’t switched on for your workspace yet");
    expect(button("Go live")).toBeUndefined();
  });
});

describe("Go live — the act, only when the door asserts readiness", () => {
  it("offers the act on ready, opens the room through the door, and renders only the session facts the door minted", async () => {
    door.answers = [
      { ok: true, state: "ready" },
      { ok: true, session: SESSION },
    ];
    await mount();
    expect(text()).toContain("Go live");
    expect(door.calls[0]).toMatchObject({ action: "status", expected_tenant_id: "tenant-1" });

    await click("Go live");
    expect(door.calls[1]).toMatchObject({ action: "open", title: "Live from my business" });
    expect(container?.querySelector("[data-golive-phase]")?.getAttribute("data-golive-phase")).toBe("live");
    expect(text()).toContain("Spring open house");
    expect(container?.querySelector("[data-golive-guest-link]")?.textContent).toBe(SESSION.guest_url);
    expect(text()).toContain("End broadcast");
    // The room lives at /live/:id — the panel's act link points there.
    const roomLink = Array.from(container?.querySelectorAll("a") ?? []).find((a) => a.textContent?.includes("Open the room"));
    expect(roomLink?.getAttribute("href")).toBe(`/live/${SESSION.id}`);
  });

  it("sends the host's own title when one is given", async () => {
    door.answers = [
      { ok: true, state: "ready" },
      { ok: true, session: SESSION },
    ];
    await mount();
    await act(async () => {
      const input = container?.querySelector("input");
      expect(input).toBeTruthy();
      // React's value tracker ignores raw .value writes; the native setter is what a real
      // keystroke resolves to, so this is the typing this test means.
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(input!, "Coffee with founders");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Go live");
    expect(door.calls[1]).toMatchObject({ action: "open", title: "Coffee with founders" });
  });

  it("refuses to claim liveness when the door refuses the open — honest failure, state unchanged", async () => {
    door.answers = [
      { ok: true, state: "ready" },
      { ok: false, error: "cloudflare_refused" },
    ];
    await mount();
    await click("Go live");
    expect(container?.querySelector("[data-golive-phase]")?.getAttribute("data-golive-phase")).toBe("ready");
    expect(text()).toContain("The room couldn’t be opened");
    expect(text()).not.toContain("End broadcast");
  });
});

describe("Go live — ending, truthfully", () => {
  it("ends on the door's confirmation and names what the session was not", async () => {
    door.answers = [
      { ok: true, state: "ready" },
      { ok: true, session: SESSION },
      { ok: true },
    ];
    await mount();
    await click("Go live");
    await click("End broadcast");
    expect(door.calls[2]).toMatchObject({ action: "end" });
    expect(container?.querySelector("[data-golive-phase]")?.getAttribute("data-golive-phase")).toBe("ended");
    expect(text()).toContain("“Spring open house” has ended");
    expect(text()).toContain("wasn’t recorded");
    expect(text()).toContain("Go live again");
  });

  it("does not claim an end the door didn't confirm", async () => {
    door.answers = [
      { ok: true, state: "ready" },
      { ok: true, session: SESSION },
      { ok: false, error: "cloudflare_refused" },
    ];
    await mount();
    await click("Go live");
    await click("End broadcast");
    expect(container?.querySelector("[data-golive-phase]")?.getAttribute("data-golive-phase")).toBe("live");
    expect(text()).toContain("couldn’t be ended");
  });
});
