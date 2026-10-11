// @vitest-environment jsdom
// Ads as its own Solo department (owner ruling 2026-10-10, INT-342): the real AdsWorkspace and the real
// GrowthHub redirect, mounted in a router. Only the network reads are stubbed (the Supabase client and
// the briefs adapter); the desk, the registry and the routing are real.
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { data: unknown; error: unknown };
const db: { calls: { table: string; filters: [string, unknown][] }[]; rows: unknown[] } = { calls: [], rows: [] };
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const call = { table, filters: [] as [string, unknown][] };
    db.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit", "in", "is", "gte", "lte", "not", "or", "maybeSingle", "single"]) chain[method] = () => chain;
    chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain; };
    chain.neq = (column: string, value: unknown) => { call.filters.push([`not ${column}`, value]); return chain; };
    chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: table === "marketing_content" ? db.rows : [], error: null }).then(resolve, reject);
    return chain;
  };
  return { supabase: { from, rpc: () => Promise.resolve({ data: null, error: null }), channel: () => ({ on: function () { return this; }, subscribe: () => ({}) }), removeChannel: () => undefined, auth: { getSession: () => Promise.resolve({ data: { session: null } }) } } };
});
const briefs = { phase: "ready", canManage: true, briefs: [] as Array<Record<string, unknown>> };
vi.mock("./useSoloCampaignBriefs", () => ({ useSoloCampaignBriefs: () => briefs }));
// Marketing's own readers never mount on a redirected address; if one did, this would say so.
vi.mock("./useSoloCampaigns", () => ({ useSoloCampaigns: () => { throw new Error("Marketing mounted on an Ads address"); } }));

import { AdsWorkspace } from "./AdsWorkspace";
import { GrowthHub } from "./growth2";
import { adsAddress, legacyAdsRoute } from "./ads-routing";

let host: HTMLDivElement;
let root: Root;
let where = "";
let go: ((delta: number) => void) | null = null;
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const pressed = () => host.querySelector('[aria-label="Ads views"] [aria-pressed="true"]')?.textContent;

function Where() {
  const location = useLocation();
  const navigate = useNavigate();
  where = `${location.pathname}${location.search}${location.hash}`;
  go = (delta) => navigate(delta);
  return null;
}
// SoloApp's own dispatch, reduced to the two branches under test: the branch slug picks the screen.
function Shell({ tenantId }: { tenantId: string }) {
  const params = useParams();
  const [branch, subtab] = (params["*"] || "").split("/");
  // The real Marketing hub mounts for its old Ads address (the redirect under test); its other
  // addresses are only destinations here, so they render a marker.
  if (branch === "ads") return <AdsWorkspace key={tenantId} tenantId={tenantId}/>;
  if (branch === "growth" && subtab === "ads") return <GrowthHub/>;
  return <p>{branch}</p>;
}
const mount = async (path: string, tenantId = "t-1") => {
  act(() => root.render(<MemoryRouter key={`${path}|${tenantId}|${briefs.canManage}`} initialEntries={[path]}><Where/><Routes><Route path="/solo/:account/*" element={<Shell tenantId={tenantId}/>}/></Routes></MemoryRouter>));
  await flush();
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  db.calls = []; db.rows = [];
  briefs.phase = "ready"; briefs.canManage = true; briefs.briefs = [];
  where = ""; go = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("the Ads address contract", () => {
  it("maps every old Marketing Ads address to the same view in the Ads department", () => {
    expect(legacyAdsRoute("42", "ads", "", "")).toBe("/solo/42/ads");
    expect(legacyAdsRoute("42", "ads", "?view=overview", "")).toBe("/solo/42/ads");
    for (const view of ["campaigns", "creative", "audiences", "performance"]) {
      expect(legacyAdsRoute("42", "ads", `?view=${view}`, ""), view).toBe(`/solo/42/ads/${view}`);
    }
    // An unknown view lands on Overview, never a dead address.
    expect(legacyAdsRoute("42", "ads", "?view=billing", "")).toBe("/solo/42/ads");
    // Tracking tags and the hash travel; nothing else does (identity, token and redirect keys included).
    expect(legacyAdsRoute("42", "ads", "?view=creative&utm_source=mail&tenant=other&token=x&next=/evil&redirect_to=/x&callback=y", "#top")).toBe("/solo/42/ads/creative?utm_source=mail#top");
    // Only the Ads segment, and only with an account.
    expect(legacyAdsRoute("42", "analytics", "?view=creative", "")).toBeNull();
    expect(legacyAdsRoute(null, "ads", "?view=creative", "")).toBeNull();
    expect(adsAddress("a/b", "creative", "", "")).toBe("/solo/a%2Fb/ads/creative");
  });
});

describe("Ads, its own department below Marketing", () => {
  it("replaces an old Marketing Ads link with the same view, before any Marketing reader mounts", async () => {
    await mount("/solo/42/growth/ads?view=performance&utm_source=mail#figures");
    expect(where).toBe("/solo/42/ads/performance?utm_source=mail#figures");
    expect(pressed()).toBe("Performance");
    expect(text()).toContain("Every figure and where it comes from");
    // No Marketing strip: Ads is not a Marketing tab any more.
    expect(host.querySelector(".campaigns-tabs")).toBeNull();
    expect(host.querySelector("h1")?.textContent).toBe("Ads");
    // A replace, not a push: Back does not bounce through the old address.
    act(() => go?.(-1));
    await flush();
    expect(where).toBe("/solo/42/ads/performance?utm_source=mail#figures");
  });

  it("carries a bare old link to Overview and a bookmarked view to that view", async () => {
    await mount("/solo/42/growth/ads");
    expect(where).toBe("/solo/42/ads");
    expect(pressed()).toBe("Overview");
    await mount("/solo/42/growth/ads?view=creative");
    expect(where).toBe("/solo/42/ads/creative");
    expect(pressed()).toBe("Creative");
  });

  it("keeps each view in the address: a switch is a history entry, and Back and Forward walk it", async () => {
    await mount("/solo/42/ads");
    expect(pressed()).toBe("Overview");
    expect([...host.querySelectorAll('[aria-label="Ads views"] button')].map((b) => b.textContent)).toEqual(["Overview", "Campaigns", "Creative", "Audiences", "Performance"]);
    for (const [label, path, proof] of [
      ["Campaigns", "/solo/42/ads/campaigns", "No ad campaigns to show."],
      ["Creative", "/solo/42/ads/creative", "No ad copy yet."],
      ["Audiences", "/solo/42/ads/audiences", "Shown only when an ad platform shares them"],
      ["Performance", "/solo/42/ads/performance", "Every figure and where it comes from"],
    ] as const) {
      act(() => button(label)?.click());
      await flush();
      expect(where, label).toBe(path);
      expect(pressed()).toBe(label);
      expect(text()).toContain(proof);
    }
    act(() => go?.(-1));
    await flush();
    expect(where).toBe("/solo/42/ads/audiences");
    expect(pressed()).toBe("Audiences");
    act(() => go?.(1));
    await flush();
    expect(pressed()).toBe("Performance");
    // A reload of a view address opens that view.
    await mount("/solo/42/ads/creative");
    expect(pressed()).toBe("Creative");
  });

  it("lands a `?view=` on the department's own address on that view's path", async () => {
    await mount("/solo/42/ads?view=audiences");
    expect(where).toBe("/solo/42/ads/audiences");
    expect(pressed()).toBe("Audiences");
  });

  it("links out to the departments that own each piece", async () => {
    await mount("/solo/42/ads");
    act(() => button("Open Integrations")?.click());
    await flush();
    expect(where).toBe("/solo/42/settings/integrations");
    await mount("/solo/42/ads/campaigns");
    act(() => button("Open your campaign briefs")?.click());
    await flush();
    expect(where).toBe("/solo/42/growth/campaigns");
    await mount("/solo/42/ads/audiences");
    act(() => button("Open Audience")?.click());
    await flush();
    expect(where).toBe("/solo/42/growth/audience");
    await mount("/solo/42/ads/performance");
    act(() => button("Open Analytics")?.click());
    await flush();
    expect(where).toBe("/solo/42/growth/analytics");
  });

  it("reads saved ad copy for the active workspace only, and keeps the read policy for members", async () => {
    db.rows = [{ id: "a1", title: "Spring planning session", status: "draft", updated_at: "2026-10-01T10:00:00Z", body: "Headline: Plan your quarter\nPrimary text: Book a session.\nCTA: Book now" }];
    await mount("/solo/42/ads/creative", "t-1");
    expect(db.calls.filter((c) => c.table === "marketing_content").map((c) => c.filters.find(([k]) => k === "tenant_id")?.[1])).toEqual(["t-1"]);
    expect(text()).toContain("Plan your quarter");
    db.calls = [];
    await mount("/solo/42/ads/creative", "t-2");
    expect(db.calls.filter((c) => c.table === "marketing_content").map((c) => c.filters.find(([k]) => k === "tenant_id")?.[1])).toEqual(["t-2"]);
    // A member: saved copy is for owners and admins, so it is never read, and they are told so.
    db.calls = [];
    briefs.canManage = false;
    await mount("/solo/42/ads/creative", "t-3");
    expect(db.calls.some((c) => c.table === "marketing_content")).toBe(false);
    expect(text()).toContain("visible to its owners and admins");
  });

  it("states that no ad account is read, and shows no spend or return figure", async () => {
    await mount("/solo/42/ads");
    expect(text()).toContain("No ad account is read here");
    expect(text()).toContain("Return on ad spend isn’t shown");
    expect([...host.querySelectorAll(".mad-nums dd")].map((dd) => dd.textContent)).toEqual(["—", "—", "—"]);
    expect(text()).not.toMatch(/\$\s?\d/);
  });
});
