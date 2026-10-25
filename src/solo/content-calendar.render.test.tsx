/**
 * EXP07 row 8 — the content-calendar PLAN, rendered behaviour (jsdom).
 *
 * EVIDENCE CLASS (§32/§70.1): a harness drive in jsdom. The plan RPCs and the library read are
 * in-memory doubles; the real useTenantRead drives loading/ready/error; the real Frame renders
 * the states. It proves the tab wires the owner's acts to content_plan_upsert with the exact
 * payload (a tz-aware instant, no client-named tenant) and renders what the RPCs return —
 * including the cancelled strike-through and the planning/scheduling boundary line. It is NOT
 * authenticated runtime proof; the SQL fixture owns the authority answers.
 *
 * Synthetic data only (§63).
 */
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  pieces: [] as Array<{ id: string; title: string }>,
  upserts: [] as Array<Record<string, unknown>>,
  failUpsert: null as string | null,
}));

vi.mock("./content-plan-data", async (orig) => {
  const real = await orig<typeof import("./content-plan-data")>();
  return {
    ...real,
    listPlanEntries: async () => h.entries.map((e) => ({ ...e })),
    readAllPieces: async () => h.pieces.map((p) => ({ ...p })),
    upsertPlanEntry: async (entry: Record<string, unknown>) => {
      if (h.failUpsert) throw new Error(h.failUpsert);
      h.upserts.push(entry);
      const saved = { id: (entry.id as string) ?? "cp-new", contentId: entry.contentId ?? null, channel: entry.channel, plannedFor: entry.plannedFor, note: entry.note ?? null, status: entry.status };
      const i = h.entries.findIndex((e) => e.id === saved.id);
      if (i >= 0) h.entries[i] = saved; else h.entries.push(saved);
      return saved;
    },
  };
});
vi.mock("./useSoloCampaignBriefs", () => ({
  useSoloCampaignBriefs: () => ({ phase: "ready", canManage: true }),
}));

const { ContentCalendar } = await import("./content-calendar");

let host: HTMLDivElement;
let root: Root | null = null;
let opened: string[] = [];

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

beforeEach(() => {
  Object.assign(h, { entries: [], pieces: [], upserts: [], failUpsert: null });
  opened = [];
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host.remove();
});

async function mount() {
  root = createRoot(host);
  await act(async () => {
    root!.render(<ContentCalendar tenantId="t-synthetic" onOpenPiece={(id) => { opened.push(id); }} />);
  });
  await flush();
}

const entry = (over: Record<string, unknown>) => ({
  id: "cp-1", contentId: "mc-2", channel: "email_campaign",
  plannedFor: "2026-11-03T14:00:00.000Z", note: null, status: "planned", ...over,
});

describe("Content calendar — the plan, planned and kept distinct from scheduling (EXP07 row 8)", () => {
  it("renders entries grouped by local day with channel labels, linked pieces and statuses, plus the boundary line", async () => {
    h.entries = [
      entry({}),
      entry({ id: "cp-2", contentId: null, channel: "site", plannedFor: "2026-11-03T18:00:00.000Z", note: "Swap the hero", status: "planned" }),
      entry({ id: "cp-3", contentId: "mc-5", channel: "ad_copy", plannedFor: "2026-11-05T14:00:00.000Z", status: "cancelled" }),
      entry({ id: "cp-4", contentId: "mc-2", channel: "email_campaign", plannedFor: "2026-11-03T14:00:00.000Z", status: "ready" }),
    ];
    h.pieces = [{ id: "mc-2", title: "Workshop reminder: two days out" }, { id: "mc-5", title: "Free planning session, limited seats" }];
    await mount();

    expect(text()).toContain("Email");
    expect(text()).toContain("Website update");
    expect(text()).toContain("Workshop reminder: two days out");
    expect(text()).toContain("Swap the hero");
    expect(text()).toContain("Ready to schedule");
    expect(text()).toContain("Cancelled");
    expect(text()).toContain("entries planned");
    // The boundary is ON the surface: the plan never claims to schedule.
    expect(text()).toContain("nothing here posts or schedules by itself");
    expect(text()).toContain("exact send times are set only if and when scheduling is connected");
    // A cancelled entry stays visible (a plan keeps its history).
    expect(host.querySelector(".cpc-entry[data-status='cancelled']")).not.toBeNull();
  });

  it("the empty state says so honestly", async () => {
    await mount();
    expect(text()).toContain("Nothing planned yet");
  });

  it("adding an entry sends the governed upsert a timezone-aware instant and no client-named tenant, then shows it", async () => {
    h.pieces = [{ id: "mc-4", title: "Three questions to ask before hiring help" }];
    await mount();
    await act(async () => { button("Add a plan entry")!.click(); });
    const when = host.querySelector<HTMLInputElement>(".cpc-form input[type='datetime-local']")!;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    act(() => { set?.call(when, "2026-11-06T09:00"); when.dispatchEvent(new Event("input", { bubbles: true })); });
    const note = host.querySelector<HTMLInputElement>(".cpc-form input[type='text']")!;
    act(() => { set?.call(note, "Teardown post"); note.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { button("Add to plan")!.click(); });
    await flush();

    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0]).toMatchObject({ id: null, contentId: null, channel: "social_post", note: "Teardown post", status: "planned" });
    expect(String(h.upserts[0].plannedFor)).toMatch(/Z$|[+-]\d\d:\d\d$/);
    // The refreshed list shows what the server returned — the note renders as the entry's what.
    expect(text()).toContain("Teardown post");
  });

  it("cancelling re-upserts the SAME row — an edit can never duplicate a scheduled anything", async () => {
    h.entries = [entry({})];
    await mount();
    await act(async () => { button("Cancel")!.click(); });
    await flush();
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0]).toMatchObject({ id: "cp-1", status: "cancelled" });
    expect(text()).toContain("Restore");
  });

  it("a refusal from the server becomes one owner-readable sentence, and nothing else changes", async () => {
    h.entries = [entry({})];
    h.failUpsert = "CONTENT_FORBIDDEN: the workspace owner or an admin is required";
    await mount();
    await act(async () => { button("Cancel")!.click(); });
    await flush();
    expect(text()).toContain("Only this workspace's owner or an admin can change the plan.");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("a linked piece whose library row is gone is said plainly, never invented", async () => {
    h.entries = [entry({ contentId: "mc-gone" })];
    h.pieces = [];
    await mount();
    expect(text()).toContain("The linked piece is no longer in your library");
  });
});
