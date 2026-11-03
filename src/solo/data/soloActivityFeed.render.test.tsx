// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The two Solo surfaces that used to invent activity, driven for real.
 *
 * A source-only assertion ("the fixture const is gone") is not enough on its own: the point is
 * not that a variable was deleted, it is that the panel now shows what the Rail recorded and
 * says so honestly when it cannot. So this drives the hook through a mocked client and reads
 * the rendered text — while ALSO pinning the source, because a future edit could reintroduce a
 * plausible-looking constant and every render assertion below would keep passing on it.
 */

type ReadResult = { data: unknown; error: { code?: string; message: string } | null };
const harness = vi.hoisted(() => ({
  result: null as ReadResult | null,
  /** Per-call answers, in order, for the stale-response case. Consumed before `result`. */
  queue: [] as Array<{ answer: ReadResult; delayTicks: number }>,
  calls: 0,
}));

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    // The chain is a Proxy rather than an enumerated method list. Enumerating meant every new
    // builder method the Solo tree reached for ('in' for usePaigeDeptStatus, then 'is' for the
    // platform-default filter in useSoloTrust) returned undefined mid-call and surfaced as an
    // UNHANDLED ERROR while every test still passed — a failure shape that is easy to miss and
    // that has now been paid for twice. Anything but the terminal `limit` chains.
    const chain: Record<string, unknown> = new Proxy({}, {
      get: (_t, k) => {
        if (typeof k !== "string" || k === "then") return undefined;
        if (k === "limit") return () => Promise.resolve(harness.result ?? { data: [], error: null });
        return () => chain;
      },
    });
    return chain;
  };
  return {
    supabase: {
      from: () => builder(),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
      // The feed now reads the DEPLOYED resolver rather than the table, so the harness answers by
      // RPC NAME. Dispatching on the name matters: a blanket answer would feed this fixture to
      // every other RPC the tree issues.
      rpc: async (fn: string) => {
        if (fn !== "get_solo_rail_activity") return { data: null, error: null };
        harness.calls += 1;
        const queued = harness.queue.shift();
        if (!queued) return harness.result ?? { data: [], error: null };
        // A read that finishes LATER than the one issued after it — the shape of a slow answer
        // for a workspace the operator has already left.
        for (let i = 0; i < queued.delayTicks; i += 1) await tick();
        return queued.answer;
      },
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
  };
});

import { useSoloActivityFeed, departmentLabel, elapsedLabel } from "./useSoloActivityFeed";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A minimal consumer that renders exactly the decisions the two surfaces make. */
function Probe({ workspaceId }: { workspaceId?: string | null }) {
  const activity = useSoloActivityFeed(workspaceId);
  // Deliberately derived from `status`, not from a truthy check on `error`: the point of this
  // slice is that a refusal, an outage and an empty feed are three different answers.
  const state =
    activity.status === "loading"
      ? "loading"
      : activity.status === "forbidden"
        ? "forbidden"
        : activity.status === "unavailable"
          ? "unavailable"
          : activity.items.length
            ? "ok"
            : "empty";
  return (
    <div>
      <span data-testid="state">{state}</span>
      {(state === "forbidden" || state === "unavailable") && (
        <span data-testid="copy">This timeline could not be loaded, so it is not a record of nothing happening.</span>
      )}
      {state === "empty" && <span data-testid="copy">Nothing recorded yet.</span>}
      {activity.items.map((a) => (
        <div key={a.id} data-testid="row">
          {a.title} · {departmentLabel(a.departmentSlug)} · {a.byPaige ? "Paige" : "Person"} · {elapsedLabel(a.occurredAt, Date.parse("2026-09-01T12:00:00Z"))}
        </div>
      ))}
    </div>
  );
}

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
  harness.calls = 0;
  frames.length = 0;
});

const render = async (workspaceId?: string | null) => {
  await act(async () => {
    root.render(<Probe workspaceId={workspaceId} />);
    await Promise.resolve();
  });
};

const state = () => container.querySelector('[data-testid="state"]')?.textContent;

/**
 * Every COMMITTED frame, as it was on screen.
 *
 * `act()` flushes passive effects before it returns, so reading the DOM after a render shows the
 * state AFTER `useEffect` has run — which makes a reset that lives in an effect invisible to that
 * assertion. This was verified, not assumed: with the guard moved from render into an effect, a
 * plain post-render assertion still passed. `useLayoutEffect` runs after this commit's DOM
 * mutations and BEFORE passive effects, and a parent's runs after its children's DOM is in place,
 * so a snapshot taken here is the frame a person would actually have seen.
 */
const frames: string[] = [];
function FrameRecorder({ children }: { children: React.ReactNode }) {
  React.useLayoutEffect(() => {
    frames.push(container.textContent ?? "");
  });
  return <>{children}</>;
}
const rowText = () => Array.from(container.querySelectorAll('[data-testid="row"]')).map((n) => n.textContent);

describe("the activity feed renders what was recorded", () => {
  it("shows the recorded events, attributed to the desk and the actor the row names", async () => {
    harness.result = {
      data: [
        {
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          title: "Filed a document on a client's record",
          summary: "Internal only.",
          actor_type: "paige_agent",
          from_department: null,
          to_department: "client_experience",
          occurred_at: "2026-09-01T11:58:00.000Z",
        },
        {
          id: "aaaaaaaa-0000-4000-8000-000000000002",
          title: "Updated a contact",
          summary: null,
          actor_type: "owner_staff",
          from_department: "owner_ops",
          to_department: null,
          occurred_at: "2026-09-01T11:00:00.000Z",
        },
      ],
      error: null,
    };
    await render();
    expect(container.querySelector('[data-testid="state"]')?.textContent).toBe("ok");
    const rows = Array.from(container.querySelectorAll('[data-testid="row"]')).map((n) => n.textContent);
    expect(rows[0]).toBe("Filed a document on a client's record · Client Success · Paige · 2m ago");
    // The actor separation is the whole meaning of the surface's Paige/People filter.
    expect(rows[1]).toBe("Updated a contact · Owner Ops · Person · 1h ago");
  });

  it("says a REFUSED read is not a record of nothing happening", async () => {
    // What `get_solo_rail_activity` actually raises for a caller who holds no owner/admin/coach
    // membership of the active workspace.
    harness.result = { data: null, error: { code: "42501", message: "RAIL_FORBIDDEN" } };
    await render();
    expect(state()).toBe("forbidden");
    // The exact failure this guards: rendering a refusal as an empty timeline, which told an
    // operator with confidence that Paige had done nothing.
    expect(container.querySelector('[data-testid="copy"]')?.textContent)
      .toContain("not a record of nothing happening");
    expect(container.querySelectorAll('[data-testid="row"]').length).toBe(0);
  });

  it("keeps an OUTAGE distinct from a refusal, and both distinct from empty", async () => {
    harness.result = { data: null, error: { message: "Failed to fetch" } };
    await render();
    // Same copy on this surface, different state — a refusal is a permission fact and an outage is
    // a transport fact, and collapsing them into one flag is how a diagnostic loses the difference.
    expect(state()).toBe("unavailable");
    expect(container.querySelector('[data-testid="copy"]')?.textContent)
      .toContain("not a record of nothing happening");
  });

  it("distinguishes a genuinely empty feed from a failed one", async () => {
    harness.result = { data: [], error: null };
    await render();
    expect(container.querySelector('[data-testid="state"]')?.textContent).toBe("empty");
    expect(container.querySelector('[data-testid="copy"]')?.textContent).toContain("Nothing recorded yet");
  });

  it.each([null, {}, "not a row list", [null], [{}], ["not a row"]].map(data => ({ data })))("withholds malformed successful responses instead of claiming no activity (%j)", async ({ data }) => {
    harness.result = { data, error: null };
    await render();
    expect(state()).toBe("unavailable");
    expect(container.textContent).not.toContain("Nothing recorded yet");
    expect(rowText()).toEqual([]);
    harness.result = { data: [], error: null };
    await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve(); });
    expect(state()).toBe("empty");
  });

  it("withholds earlier facts when a later response is malformed", async () => {
    harness.result = { data: [{ id: "test-event", title: "Earlier recorded fact", occurred_at: "2026-09-01T11:59:00Z" }], error: null };
    await render();
    expect(state()).toBe("ok");
    expect(rowText()).toHaveLength(1);
    harness.result = { data: null, error: null };
    await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve(); });
    expect(state()).toBe("unavailable");
    expect(rowText()).toEqual([]);
  });
});

describe("the fabricated feeds are gone from the surfaces", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("the Trust Compass no longer carries invented activity, and reads the Rail instead", () => {
    const src = read("src/solo/compass.tsx");
    // The invented customers, by name, anywhere in the file.
    //
    // The first version of this assertion looked for `t:'Bellweather` — the fixture's own key
    // prefix — and would have passed against the UNMODIFIED file, because the names sit mid-title
    // ("Answered Bellweather on the invoice question"). A test that cannot fail on the defect it
    // names is worse than no test, so it checks for the bare name now, and the removal comment
    // left in compass.tsx deliberately does not repeat any of them.
    for (const invented of ["Bellweather", "Sarah Nnadi", "Ridgeline", "Northwind", "Cairn Advisory", "Verity Partners"]) {
      expect(src.includes(invented)).toBe(false);
    }
    expect(src).toContain("useSoloActivityFeed");
    // The green "Live" pill must be conditional now — an unconditional one is a claim about a
    // read that may have failed.
    expect(src).not.toContain('<span className="pill pill-ok"><span className="dot"/>Live</span>');
  });

  it("the Team hub timeline reads the Rail and its Paige/People filter means actor_type", () => {
    const src = read("src/solo/team.tsx");
    expect(src).toContain("useSoloActivityFeed");
    expect(src).not.toContain("Sent the Ridgeline dunning reminder");
    expect(src).not.toContain("Reconnected the HubSpot sync");
    expect(src).toContain("ai:a.byPaige");
  });
});

describe("a workspace switch cannot leave the previous workspace's activity on screen", () => {
  it("never PAINTS the previous workspace's activity, in any frame", async () => {
    harness.result = { data: [{ id: "w1", title: "WORKSPACE-ONE-EVENT", actor_type: "owner_staff", occurred_at: "2026-09-01T11:00:00.000Z" }], error: null };
    await act(async () => {
      root.render(<FrameRecorder><Probe workspaceId="workspace-one" /></FrameRecorder>);
      await Promise.resolve();
    });
    expect(rowText()[0]).toContain("WORKSPACE-ONE-EVENT");
    const before = frames.length;
    harness.result = { data: [{ id: "w2", title: "WORKSPACE-TWO-EVENT", actor_type: "owner_staff", occurred_at: "2026-09-01T11:30:00.000Z" }], error: null };

    // The switch. The reset lives in RENDER, not in an effect: an effect is passive, so React
    // commits a frame carrying workspace one's event under workspace two's heading and only then
    // clears it. Rendering synchronously and inspecting every committed frame is what tells the
    // two apart — the settled end state is identical either way.
    act(() => { root.render(<FrameRecorder><Probe workspaceId="workspace-two" /></FrameRecorder>); });
    const during = frames.slice(before);
    expect(during.length).toBeGreaterThan(0);
    for (const frame of during) expect(frame).not.toContain("WORKSPACE-ONE-EVENT");
    expect(state()).toBe("loading");

    await act(async () => { await tick(); });
    expect(rowText()[0]).toContain("WORKSPACE-TWO-EVENT");
  });

  it("DISCARDS a slow answer for the workspace the operator has already left", async () => {
    // Workspace one answers late; workspace two answers first. Without the request guard the late
    // answer wins simply by arriving last, and one workspace's activity is painted under another's
    // name — the §9 shape of a leak that no policy can catch, because both reads were authorized.
    harness.queue = [
      { answer: { data: [{ id: "w1", title: "LEFT-WORKSPACE-EVENT", actor_type: "owner_staff", occurred_at: "2026-09-01T11:00:00.000Z" }], error: null }, delayTicks: 8 },
      { answer: { data: [{ id: "w2", title: "CURRENT-WORKSPACE-EVENT", actor_type: "owner_staff", occurred_at: "2026-09-01T11:30:00.000Z" }], error: null }, delayTicks: 0 },
    ];

    await act(async () => { root.render(<Probe workspaceId="workspace-one" />); });
    await act(async () => { root.render(<Probe workspaceId="workspace-two" />); });
    // Let BOTH settle, slow one included.
    await act(async () => { for (let i = 0; i < 20; i += 1) await tick(); });

    expect(harness.calls).toBe(2);
    const rows = rowText().join(" ");
    expect(rows).toContain("CURRENT-WORKSPACE-EVENT");
    expect(rows).not.toContain("LEFT-WORKSPACE-EVENT");
  });
});
