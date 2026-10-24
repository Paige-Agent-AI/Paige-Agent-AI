// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * "Recent activity" in the Solo Command Center — the tenant-wide Rail, made reachable.
 *
 * WHY THIS PANEL EXISTS, and therefore what these tests are for. The Rail's tenant-wide strip
 * (`PaigeRailFeed`) ships inside `PaigeWorkspace`, which `TenantCommandCenterShell` renders ONLY
 * when the Solo workspace is absent — and the Solo shell always supplies it. So the tenant-wide
 * rail was structurally dark for every Solo tenant: the safe reader was deployed, the consumers
 * were repaired, and a Solo owner still had no surface that showed it.
 *
 * These drive the REAL component through a mocked supabase client, so the assertions cover the
 * whole path — panel → `useSoloActivityFeed` → `get_solo_rail_activity` — rather than a stubbed
 * hook that would pass whether or not the mount is wired to the deployed reader.
 *
 * The five answers are the point. Reading `items.length` alone answers five questions with one
 * sentence: still loading, refused, failed, genuinely empty, populated. Three of those are not
 * "nothing happened", and two of them are confident false statements about the tenant's own work.
 */

type ReadResult = { data: unknown[] | null; error: { code?: string; message: string } | null };

const harness = vi.hoisted(() => ({
  result: null as ReadResult | null,
  /** Per-call answers, in order, for the stale-response case. Consumed before `result`. */
  queue: [] as Array<{ answer: ReadResult; delayTicks: number }>,
  /** Every RPC name the panel asked for — proves it reaches the deployed reader, not the table. */
  calls: [] as string[],
  command: vi.fn(),
  systems: vi.fn(),
}));

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_t, k) => {
      if (typeof k !== "string" || k === "then") return undefined;
      if (k === "limit") return () => Promise.resolve({ data: [], error: null });
      return () => chain;
    },
  });
  return {
    supabase: {
      from: () => chain,
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
      rpc: async (fn: string) => {
        if (fn !== "get_solo_rail_activity") return { data: null, error: null };
        harness.calls.push(fn);
        const queued = harness.queue.shift();
        if (!queued) return harness.result ?? { data: [], error: null };
        for (let i = 0; i < queued.delayTicks; i += 1) await tick();
        return queued.answer;
      },
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
  };
});

vi.mock("./data/useCommandCenter", () => ({ useCommandCenter: () => harness.command() }));
vi.mock("@/hooks/useSystemsCheck", () => ({ useSystemsCheck: () => harness.systems() }));

import { SoloSystemsCheckWorkspace } from "./SoloSystemsCheckWorkspace";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseCommand = {
  approvals: [], metrics: [], attention: null, departments: [],
  greeting: { name: "Owner", dateLabel: "Wednesday, September 3", summary: "Nothing waiting." },
  counts: { approvals: 0 }, loading: false, empty: true, isError: false,
  departmentsConfigured: false,
  approve: vi.fn(), decline: vi.fn(), refresh: vi.fn(),
};
const baseSystems = { run: null, findings: [], loading: false, isError: false, scanPending: false, refresh: vi.fn() };

/** A row in the exact shape `get_solo_rail_activity` returns. */
const railRow = (over: Record<string, unknown> = {}) => ({
  id: "eeeeeeee-0000-4000-8000-000000000001",
  event_kind: "owner.note",
  surface: "your_paige",
  actor_type: "paige_agent",
  audience: "owner",
  visibility: "owner_internal",
  from_department: null,
  to_department: "operations_pmo",
  title: "RAIL-PANEL-RECORDED-EVENT",
  summary: "RAIL-PANEL-SUMMARY",
  occurred_at: new Date().toISOString(),
  ...over,
});

let host: HTMLDivElement;
let root: Root;

/**
 * Every COMMITTED frame. `act()` flushes passive effects before returning, so a post-render
 * assertion cannot see a frame that an effect later clears — which is exactly how a stale-frame
 * test passes against the defect it names. `useLayoutEffect` runs after this commit's DOM
 * mutations and before passive effects, and a parent's runs after its children are in place.
 */
const frames: string[] = [];
function FrameRecorder({ children }: { children: React.ReactNode }) {
  React.useLayoutEffect(() => { frames.push(host.textContent ?? ""); });
  return <>{children}</>;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.command.mockReturnValue(baseCommand);
  harness.systems.mockReturnValue(baseSystems);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  harness.result = null;
  harness.queue = [];
  harness.calls = [];
  frames.length = 0;
});

const text = () => host.textContent ?? "";
const panel = () => Array.from(host.querySelectorAll("section.sc-side-panel"))
  .find((node) => node.textContent?.includes("Recent activity")) ?? null;

// The real workspace now reads its canonical finding URL. Keep the original
// Rail reader, authority and every-frame assertions inside its actual Router context.
const renderWorkspace = (tree: React.ReactNode) => root.render(
  <MemoryRouter initialEntries={["/solo/1234567/command-center/systems-check"]}>{tree}</MemoryRouter>,
);

const settle = async (workspaceId?: string | null, recorder = false) => {
  const tree = <SoloSystemsCheckWorkspace accountContext={null} workspaceId={workspaceId} />;
  await act(async () => {
    renderWorkspace(recorder ? <FrameRecorder>{tree}</FrameRecorder> : tree);
    await Promise.resolve();
  });
};

/** The sentence that must NEVER appear over a refusal, an outage, or an unsettled read. */
const EMPTY_LINE = "Nothing has been recorded on this workspace";

describe("the panel is mounted in the Solo Command Center and reads the deployed resolver", () => {
  it("renders inside the Systems Check side stack", async () => {
    harness.result = { data: [], error: null };
    await settle("workspace-one");
    const found = panel();
    expect(found, "a Recent activity panel must exist in the side stack").not.toBeNull();
    // It reuses the surface's own panel vocabulary rather than introducing a new one.
    expect(found?.className).toContain("sc-side-panel");
    expect(found?.querySelector(".sc-kicker")?.textContent).toBe("Workspace rail");
  });

  it("asks get_solo_rail_activity — never the table, and never with a tenant argument", async () => {
    harness.result = { data: [], error: null };
    await settle("workspace-one");
    // The resolver takes no tenant parameter, so there is no argument a caller could substitute
    // to read another workspace. This asserts the call reaches it at all.
    expect(harness.calls).toEqual(["get_solo_rail_activity"]);
  });
});

describe("the five answers are kept apart", () => {
  it("REAL ACTIVITY renders the recorded lines with desk, actor and elapsed time", async () => {
    harness.result = { data: [railRow()], error: null };
    await settle("workspace-one");
    expect(text()).toContain("RAIL-PANEL-RECORDED-EVENT");
    expect(text()).toContain("RAIL-PANEL-SUMMARY");
    // The desk comes from the event's own department slug, not a guess from the title.
    expect(text()).toContain("Operations / PMO");
    expect(text()).toContain("PAIGE");
    expect(text()).not.toContain(EMPTY_LINE);
  });

  it("a GENUINELY EMPTY workspace is the one and only case that says nothing was recorded", async () => {
    harness.result = { data: [], error: null };
    await settle("workspace-one");
    expect(text()).toContain(EMPTY_LINE);
    expect(text()).not.toContain("could not be loaded");
    expect(text()).not.toContain("is not available to you");
  });

  it("a REFUSED read says so, and never that nothing was recorded", async () => {
    // What `get_solo_rail_activity` actually raises for a caller holding no owner/admin/coach
    // membership of the active workspace — or none at all.
    harness.result = { data: null, error: { code: "42501", message: "RAIL_FORBIDDEN" } };
    await settle("workspace-one");
    expect(text()).toContain("is not available to you here");
    expect(text()).toContain("not a record of nothing happening");
    expect(text()).not.toContain(EMPTY_LINE);
    expect(panel()?.querySelector('[role="alert"]'), "a refusal is announced, not left to be noticed").not.toBeNull();
  });

  it("an OUTAGE is distinct from a refusal, and both are distinct from empty", async () => {
    harness.result = { data: null, error: { message: "Failed to fetch" } };
    await settle("workspace-one");
    expect(text()).toContain("could not be loaded");
    // A permission fact and a transport fact are different things and read differently.
    expect(text()).not.toContain("is not available to you here");
    expect(text()).not.toContain(EMPTY_LINE);
    expect(panel()?.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("LOADING says it is reading, and claims nothing about what exists", async () => {
    harness.queue = [{ answer: { data: [railRow()], error: null }, delayTicks: 8 }];
    // Render synchronously: the read has been issued and has not resolved.
    act(() => { renderWorkspace(<SoloSystemsCheckWorkspace accountContext={null} workspaceId="workspace-one" />); });
    expect(text()).toContain("Reading this workspace");
    expect(text()).not.toContain(EMPTY_LINE);
    expect(text()).not.toContain("could not be loaded");
    await act(async () => { for (let i = 0; i < 20; i += 1) await tick(); });
    expect(text()).toContain("RAIL-PANEL-RECORDED-EVENT");
  });
});

describe("no unsafe or internal field reaches the panel", () => {
  it("renders none of the internal columns, ids, or raw server text", async () => {
    harness.result = {
      data: [railRow({
        id: "eeeeeeee-0000-4000-8000-00000000dead",
        title: "A recorded event",
        summary: "A recorded summary.",
      })],
      error: null,
    };
    await settle("workspace-one");
    const shown = panel()?.textContent ?? "";
    // The row's own UUID is a React key and must never be rendered.
    expect(shown).not.toContain("eeeeeeee-0000-4000-8000-00000000dead");
    // `get_solo_rail_activity` does not return these at all, so they cannot leak — assert it,
    // because a future edit that switched the panel to a wider read would break here first.
    for (const forbidden of ["payload", "ref_table", "ref_id", "actor_user_id", "tenant_id", "contact_id", "@", "paige_client_events"]) {
      expect(shown, `"${forbidden}" must not appear on a tenant surface`).not.toContain(forbidden);
    }
  });

  it("never prints the server's own error text, code, or function name on a refusal", async () => {
    harness.result = {
      data: null,
      error: { code: "42501", message: 'RAIL_FORBIDDEN: permission denied for function get_solo_rail_activity' },
    };
    await settle("workspace-one");
    const shown = panel()?.textContent ?? "";
    expect(shown).not.toContain("42501");
    expect(shown).not.toContain("RAIL_FORBIDDEN");
    expect(shown).not.toContain("permission denied");
    expect(shown).not.toContain("get_solo_rail_activity");
    // …but it still says, in the tenant's own language, that this is not an empty record.
    expect(shown).toContain("not a record of nothing happening");
  });
});

describe("a workspace switch leaves nothing of the previous workspace behind", () => {
  it("never PAINTS the previous workspace's activity, in any frame", async () => {
    harness.result = { data: [railRow({ title: "WORKSPACE-ONE-EVENT" })], error: null };
    await settle("workspace-one", true);
    expect(text()).toContain("WORKSPACE-ONE-EVENT");
    const before = frames.length;
    harness.result = { data: [railRow({ id: "second", title: "WORKSPACE-TWO-EVENT" })], error: null };

    // The guard runs in RENDER, not in an effect. An effect is passive: React commits the frame
    // before it runs, so an effect-based reset paints workspace one's rows under workspace two's
    // heading and only then clears them. The settled end state is identical either way, so every
    // committed frame is inspected — that is the only thing that tells the two apart.
    act(() => {
      renderWorkspace(<FrameRecorder><SoloSystemsCheckWorkspace accountContext={null} workspaceId="workspace-two" /></FrameRecorder>);
    });
    const during = frames.slice(before);
    expect(during.length).toBeGreaterThan(0);
    for (const frame of during) {
      expect(frame).not.toContain("WORKSPACE-ONE-EVENT");
      // Nor may the gap be filled with the empty-state claim, which is the other false sentence.
      expect(frame).not.toContain(EMPTY_LINE);
    }
    expect(text()).toContain("Reading this workspace");

    await act(async () => { await tick(); });
    expect(text()).toContain("WORKSPACE-TWO-EVENT");
  });

  it("DISCARDS a slow answer for the workspace already left", async () => {
    // Workspace one answers late; workspace two answers first. Without the request guard the late
    // answer wins simply by arriving last, and one workspace's activity is shown under another's
    // name — both reads individually authorized, so no policy could catch it.
    harness.queue = [
      { answer: { data: [railRow({ title: "LEFT-WORKSPACE-EVENT" })], error: null }, delayTicks: 8 },
      { answer: { data: [railRow({ id: "second", title: "CURRENT-WORKSPACE-EVENT" })], error: null }, delayTicks: 0 },
    ];
    await act(async () => { renderWorkspace(<SoloSystemsCheckWorkspace accountContext={null} workspaceId="workspace-one" />); });
    await act(async () => { renderWorkspace(<SoloSystemsCheckWorkspace accountContext={null} workspaceId="workspace-two" />); });
    await act(async () => { for (let i = 0; i < 20; i += 1) await tick(); });

    expect(harness.calls).toEqual(["get_solo_rail_activity", "get_solo_rail_activity"]);
    expect(text()).toContain("CURRENT-WORKSPACE-EVENT");
    expect(text()).not.toContain("LEFT-WORKSPACE-EVENT");
  });

  it("the Command Center REMOUNTS this subtree on a switch, which is the primary mechanism", () => {
    // The panel's own guard is the second layer. The first is that `CommandHub` keys the mount on
    // the active workspace, so a switch unmounts and remounts: no row, no filter, no pending read
    // and no loading state can survive it. Pinned here because it lives in a different file and a
    // future edit could drop the key without any panel test noticing.
    const src = fs.readFileSync(path.join(process.cwd(), "src/solo/CommandCenter.tsx"), "utf8");
    expect(src).toContain('key={activeTenantId ?? "unresolved"}');
    expect(src).toContain("workspaceId={activeTenantId}");
  });
});

describe("the screen's own Refresh control refreshes this panel too", () => {
  it("re-reads the rail when \"Refresh current data\" is pressed", async () => {
    harness.result = { data: [railRow()], error: null };
    await settle("workspace-one");
    expect(harness.calls.length).toBe(1);

    // Without `activity.refresh()` in the screen's refresh handler the panel sits on its last
    // read until a 15s poll or a window focus — so the one control a person reaches for after
    // watching a read fail does nothing to the panel they were watching.
    const button = Array.from(host.querySelectorAll("button"))
      .find((node) => node.getAttribute("aria-label") === "Refresh current data");
    expect(button, "the screen's refresh control must exist").toBeTruthy();
    await act(async () => { button!.dispatchEvent(new MouseEvent("click", { bubbles: true })); await tick(); });

    expect(harness.calls.length).toBeGreaterThan(1);
    expect(harness.calls.every((c) => c === "get_solo_rail_activity")).toBe(true);
  });
});
