// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The five ways a Rail feed can be wrong, driven through the REAL components.
 *
 * The two owner-facing strips — `PaigeRailFeed` ("Across your clients — live") and
 * `ClientActivityFeed` ("Your activity") — both decided what to say from `events.length === 0`.
 * That one check answered four different questions with one sentence: still loading, refused,
 * failed, and genuinely nothing. Three of those four are not "nothing happened", and two of them
 * are assertions about Paige's work that were never true. Both strips also discarded the read
 * error entirely, so a refusal was indistinguishable from a quiet week.
 *
 * The cases below are the five the repair is answerable for:
 *   1. a successful history                 — the recorded events reach the screen at all
 *   2. an empty history                     — "nothing yet" is said ONLY when it is true
 *   3. a denied read                        — a refusal never renders as "nothing yet"
 *   4. a workspace switch                   — the previous workspace's events never paint under
 *                                             the new one, not even for one frame
 *   5. a stale response                     — a slow answer for a workspace already left is
 *                                             discarded rather than winning by arriving last
 *
 * WHY THESE MOUNT THE COMPONENTS rather than probe the hook. The hook can hold four honest states
 * and still be rendered by a component that collapses them — which is exactly what shipped. What
 * has to be true is that the SURFACE says different things, so the surface is what is read.
 */

type ReadResult = { data: unknown[] | null; error: { code?: string; message: string } | null };

const harness = vi.hoisted(() => ({
  result: null as ReadResult | null,
  /** Per-call answers, in order, for the stale-response case. Consumed before `result`. */
  queue: [] as Array<{ answer: ReadResult; delayTicks: number }>,
  /** Every RPC name the hook asked for, so a scope can be shown to reach the right resolver. */
  calls: [] as string[],
}));

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
    rpc: async (fn: string) => {
      harness.calls.push(fn);
      const queued = harness.queue.shift();
      if (!queued) return harness.result ?? { data: [], error: null };
      // A read that finishes LATER than the one issued after it — the shape of a slow answer for
      // a workspace the operator has already left.
      for (let i = 0; i < queued.delayTicks; i += 1) await tick();
      return queued.answer;
    },
  },
}));

// The client strip names the customer's agent (Cura by default; owner ruling 2026-10-19), never this owner persona.
// Neither is what these cases are about, so both are pinned rather than driven.
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "Paige" } }) }));
vi.mock("@/hooks/useMyContactId", () => ({ useMyContactId: () => ({ contactId: null, loading: false }) }));

import { PaigeRailFeed } from "@/components/paige/PaigeRailFeed";
import { ClientActivityFeed } from "@/components/app/ClientActivityFeed";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  harness.result = null;
  harness.queue = [];
  harness.calls = [];
  frames.length = 0;
});

const text = () => container.textContent ?? "";

/**
 * Every COMMITTED frame, as it was on screen.
 *
 * `act()` flushes passive effects before it returns, so reading `container.textContent` after a
 * render shows the state AFTER `useEffect` has run. A reset that lives in an effect is therefore
 * invisible to that assertion — the stale frame is painted, then cleared, and the test sees only
 * the clearing. This was verified, not assumed: with the guard moved from render into an effect,
 * the frame assertions below passed 11/11 before this recorder existed.
 *
 * `useLayoutEffect` runs after the commit's DOM mutations and BEFORE passive effects, and a
 * PARENT's layout effect runs after its children's DOM is in place — so a snapshot taken here is
 * the frame the user would actually have seen.
 */
const frames: string[] = [];
function FrameRecorder({ children }: { children: React.ReactNode }) {
  React.useLayoutEffect(() => {
    frames.push(container.textContent ?? "");
  });
  return <>{children}</>;
}
const settle = async (node: React.ReactElement) => {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
};

const row = (over: Record<string, unknown> = {}) => ({
  id: "rrrrrrrr-0000-4000-8000-000000000001",
  event_kind: "owner.note",
  surface: "your_paige",
  actor_type: "paige_agent",
  audience: "owner",
  visibility: "owner_internal",
  title: "RAIL-STATE-RECORDED-EVENT",
  summary: null,
  occurred_at: new Date().toISOString(),
  ...over,
});

/** The sentence that must NEVER appear over a refusal, an outage, or an unsettled read. */
const TENANT_NOTHING = "Nothing across your clients yet";
const CLIENT_NOTHING = "Nothing yet";

describe("PaigeRailFeed — the owner's tenant-wide strip", () => {
  it("1. a SUCCESSFUL history puts the recorded events on screen", async () => {
    harness.result = { data: [row()], error: null };
    await settle(<PaigeRailFeed tenantId="tenant-one" />);
    expect(text()).toContain("RAIL-STATE-RECORDED-EVENT");
    expect(text()).not.toContain(TENANT_NOTHING);
    // The tenant scope must reach the resolver that takes no tenant argument.
    expect(harness.calls).toEqual(["get_solo_rail_activity"]);
  });

  it("2. an EMPTY history is the one and only case that says nothing has happened", async () => {
    harness.result = { data: [], error: null };
    await settle(<PaigeRailFeed tenantId="tenant-one" />);
    expect(text()).toContain(TENANT_NOTHING);
    expect(text()).not.toContain("could not be loaded");
  });

  it("3. a DENIED read says so, and never that nothing has happened", async () => {
    // Exactly what `get_solo_rail_activity` raises for a caller with no owner/admin/coach
    // membership of the active workspace. This is the defect: before the repair, this rendered
    // as "Nothing across your clients yet" — a confident, false statement about Paige's work.
    harness.result = { data: null, error: { code: "42501", message: "RAIL_FORBIDDEN" } };
    await settle(<PaigeRailFeed tenantId="tenant-one" />);
    expect(text()).toContain("not a record of nothing happening");
    expect(text()).not.toContain(TENANT_NOTHING);
    // A refusal is announced, not left for a sighted reader to notice.
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    // And the SQLSTATE itself never reaches the surface.
    expect(text()).not.toContain("42501");
    expect(text()).not.toContain("RAIL_FORBIDDEN");
  });

  it("3b. an OUTAGE is also not 'nothing happened', and is distinct from a refusal", async () => {
    harness.result = { data: null, error: { message: "Failed to fetch" } };
    await settle(<PaigeRailFeed tenantId="tenant-one" />);
    expect(text()).toContain("could not be loaded");
    expect(text()).not.toContain(TENANT_NOTHING);
    // Different sentence from the refusal above: one is a permission fact, the other is not.
    expect(text()).not.toContain("do not have access");
  });

  it("4. a WORKSPACE SWITCH never PAINTS the previous workspace, in any frame", async () => {
    harness.result = { data: [row({ title: "WORKSPACE-ONE-EVENT" })], error: null };
    await settle(
      <FrameRecorder>
        <PaigeRailFeed tenantId="tenant-one" />
      </FrameRecorder>,
    );
    expect(text()).toContain("WORKSPACE-ONE-EVENT");
    const before = frames.length;
    harness.result = { data: [row({ id: "second", title: "WORKSPACE-TWO-EVENT" })], error: null };

    // The reset lives in RENDER, not in an effect. An effect is passive: React commits the frame
    // before it runs, so an effect-based reset paints workspace one's events under workspace two's
    // heading and only then clears them. The render is issued SYNCHRONOUSLY and every frame it
    // commits is inspected, because the end state is identical either way and only the frames tell
    // the two apart.
    act(() => {
      root.render(
        <FrameRecorder>
          <PaigeRailFeed tenantId="tenant-two" />
        </FrameRecorder>,
      );
    });

    const during = frames.slice(before);
    expect(during.length).toBeGreaterThan(0);
    for (const frame of during) {
      expect(frame).not.toContain("WORKSPACE-ONE-EVENT");
      // Nor may the gap be filled with the empty-state claim, which is the other false sentence.
      expect(frame).not.toContain(TENANT_NOTHING);
    }
    expect(text()).toContain("Loading");

    // And the new workspace's own history then lands, so this is a clean handover rather than a
    // feed that simply went blank.
    await act(async () => { await tick(); });
    expect(text()).toContain("WORKSPACE-TWO-EVENT");
  });

  it("5. a STALE response for the workspace already left is DISCARDED", async () => {
    // Workspace one answers late; workspace two answers first. Without the request guard the late
    // answer wins simply by arriving last, and one workspace's activity is painted under another's
    // name — a leak no policy can catch, because both reads were individually authorized.
    harness.queue = [
      { answer: { data: [row({ title: "LEFT-WORKSPACE-EVENT" })], error: null }, delayTicks: 8 },
      { answer: { data: [row({ id: "second", title: "CURRENT-WORKSPACE-EVENT" })], error: null }, delayTicks: 0 },
    ];

    await act(async () => {
      root.render(<PaigeRailFeed tenantId="tenant-one" />);
    });
    await act(async () => {
      root.render(<PaigeRailFeed tenantId="tenant-two" />);
    });
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await tick();
    });

    expect(harness.calls).toEqual(["get_solo_rail_activity", "get_solo_rail_activity"]);
    expect(text()).toContain("CURRENT-WORKSPACE-EVENT");
    expect(text()).not.toContain("LEFT-WORKSPACE-EVENT");
  });
});

describe("ClientActivityFeed — the client's own strip", () => {
  const clientRow = (over: Record<string, unknown> = {}) =>
    row({ event_kind: "client.message", audience: "client", visibility: "client_visible", ...over });

  it("1. a SUCCESSFUL history puts the client's own events on screen", async () => {
    harness.result = { data: [clientRow()], error: null };
    await settle(<ClientActivityFeed contactId="contact-one" />);
    expect(text()).toContain("You messaged Cura");
    expect(text()).not.toContain(CLIENT_NOTHING);
    // A client surface must ask the client-scoped resolver, never the tenant-wide one.
    expect(harness.calls).toEqual(["get_client_rail"]);
  });

  it("2. an EMPTY history is the one and only case that says nothing yet", async () => {
    harness.result = { data: [], error: null };
    await settle(<ClientActivityFeed contactId="contact-one" />);
    expect(text()).toContain(CLIENT_NOTHING);
    expect(text()).not.toContain("could not be loaded");
  });

  it("3. a DENIED read says so, without telling the client how access is decided", async () => {
    harness.result = { data: null, error: { code: "42501", message: "RAIL_FORBIDDEN" } };
    await settle(<ClientActivityFeed contactId="contact-one" />);
    expect(text()).toContain("could not be loaded");
    expect(text()).toContain("not a record of nothing happening");
    expect(text()).not.toContain(CLIENT_NOTHING);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    // No SQLSTATE, no server string, no internal identifier on a client surface.
    expect(text()).not.toContain("42501");
    expect(text()).not.toContain("RAIL_FORBIDDEN");
    expect(text()).not.toContain("contact-one");
  });

  it("4. switching to a different CLIENT never PAINTS the previous one, in any frame", async () => {
    harness.result = { data: [clientRow({ title: "CLIENT-ONE-EVENT" })], error: null };
    await settle(
      <FrameRecorder>
        <ClientActivityFeed contactId="contact-one" />
      </FrameRecorder>,
    );
    expect(text()).toContain("You messaged Cura");
    const before = frames.length;
    harness.result = {
      data: [clientRow({ id: "second", title: "CLIENT-TWO-EVENT", event_kind: "client.action_response" })],
      error: null,
    };

    act(() => {
      root.render(
        <FrameRecorder>
          <ClientActivityFeed contactId="contact-two" />
        </FrameRecorder>,
      );
    });

    // One client's activity must never be painted under another client's heading — not even for
    // the single frame between the render and the passive effect (§9).
    const during = frames.slice(before);
    expect(during.length).toBeGreaterThan(0);
    for (const frame of during) {
      expect(frame).not.toContain("You messaged Cura");
      expect(frame).not.toContain(CLIENT_NOTHING);
    }
    expect(text()).toContain("Loading");

    await act(async () => { await tick(); });
    expect(text()).toContain("You responded");
  });

  it("5. a STALE response for the client already left is DISCARDED", async () => {
    harness.queue = [
      { answer: { data: [clientRow({ title: "LEFT-CLIENT-EVENT", event_kind: "client.intake_answer" })], error: null }, delayTicks: 8 },
      { answer: { data: [clientRow({ id: "second", title: "CURRENT-CLIENT-EVENT", event_kind: "client.action_response" })], error: null }, delayTicks: 0 },
    ];

    await act(async () => {
      root.render(<ClientActivityFeed contactId="contact-one" />);
    });
    await act(async () => {
      root.render(<ClientActivityFeed contactId="contact-two" />);
    });
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await tick();
    });

    expect(harness.calls).toEqual(["get_client_rail", "get_client_rail"]);
    // "You responded" is the second client's row; "You shared some details" is the first's.
    expect(text()).toContain("You responded");
    expect(text()).not.toContain("You shared some details");
  });
});
