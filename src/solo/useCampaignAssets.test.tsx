import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { assetMessageFor, readAssets, useCampaignAssets, type CampaignAssetsState } from "./useCampaignAssets";

const TENANT = "11111111-1111-4111-8111-111111111111";
const link = (kind: string, id: string, extra: Record<string, unknown> = {}) => ({ brief_id: "b1", kind, id, name: `Name ${id}`, status: "draft", channel: null, created_through: "human", linked_at: null, detachable: true, ...extra });

describe("readAssets", () => {
  it("keeps only rows it can name a kind for, and never offers a social post to attach", () => {
    const read = readAssets({ can_manage: true,
      links: [link("page", "p1"), link("video", "v1"), link("email_campaign", "e1", { name: null, status: null }), { kind: "page" }],
      available: [{ kind: "form", id: "f1", name: "Intake" }, { kind: "social_post", id: "s1", name: "Post" }, { kind: "page", id: "p2", name: "" }] });
    expect(read.canManage).toBe(true);
    expect(read.links.map((row) => [row.kind, row.id, row.name])).toEqual([["page", "p1", "Name p1"], ["email_campaign", "e1", null]]);
    expect(read.available.map((row) => [row.kind, row.id])).toEqual([["form", "f1"]]);
  });

  it("names every refusal the writer can raise in words a person can act on", () => {
    expect(assetMessageFor("CAMPAIGN_ASSET_NOT_FOUND")).toMatch(/no longer available/);
    expect(assetMessageFor("CAMPAIGN_BRIEF_NOT_FOUND")).toMatch(/campaign is no longer available/);
    expect(assetMessageFor("CAMPAIGN_BRIEF_FORBIDDEN")).toMatch(/Only owners and admins/);
    expect(assetMessageFor("CAMPAIGN_BRIEF_IDEMPOTENCY_CONFLICT")).toMatch(/already recorded/);
  });
});

describe("useCampaignAssets", () => {
  let host: HTMLDivElement; let root: Root; let state: CampaignAssetsState;
  function Probe() { state = useCampaignAssets(TENANT); return null; }
  afterEach(() => { act(() => root.unmount()); host.remove(); rpc.mockReset(); });
  const mount = async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root.render(<Probe/>); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };

  it("reads every link through the governed read, then attaches through the writer and confirms it by reading again", async () => {
    let links = [link("form", "f1")];
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "get_campaign_brief_assets") return { data: { can_manage: true, links, available: [] }, error: null };
      links = [...links, link("page", "p1")];
      return { data: { ok: true, outcome: "attached", message: "Attached to the campaign. Nothing is sent or published." }, error: null };
    });
    await mount();
    expect(state.phase).toBe("ready");
    expect(rpc.mock.calls[0]).toEqual(["get_campaign_brief_assets", { _tenant_id: TENANT, _brief_id: null }]);
    let result: { ok: boolean; message: string } | undefined;
    await act(async () => { result = await state.attach("b1", "page", "p1"); });
    expect(result).toEqual({ ok: true, message: "Attached to the campaign. Nothing is sent or published." });
    const write = rpc.mock.calls.find(([name]) => name === "configure_campaign_brief_assets")!;
    expect(write[1]).toMatchObject({ _tenant_id: TENANT, _command: { type: "attach_asset", briefId: "b1", assetKind: "page", assetId: "p1" }, _actor_kind: "human" });
    expect(typeof write[1]._idempotency_key).toBe("string");
    expect(state.links.map((row) => row.id)).toEqual(["f1", "p1"]);
  });

  it("never reports a change the server's read doesn't show", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockImplementation(async (name: string) => (name === "get_campaign_brief_assets"
      ? { data: { can_manage: true, links: [], available: [] }, error: null }
      : { data: { ok: true, outcome: "attached", message: "Attached." }, error: null }));
    await mount();
    let result: { ok: boolean; message: string } | undefined;
    await act(async () => { result = await state.attach("b1", "page", "p1"); });
    expect(result?.ok).toBe(false);
    expect(result?.message).toMatch(/doesn't show it yet/);
  });

  it("a refused write says why, and a failed read is an error, never an empty campaign", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockImplementation(async (name: string) => (name === "get_campaign_brief_assets"
      ? { data: { can_manage: true, links: [], available: [] }, error: null }
      : { data: null, error: { message: "CAMPAIGN_ASSET_NOT_FOUND" } }));
    await mount();
    let result: { ok: boolean; message: string } | undefined;
    await act(async () => { result = await state.detach("b1", "form", "f1"); });
    expect(result).toEqual({ ok: false, message: assetMessageFor("CAMPAIGN_ASSET_NOT_FOUND") });
    act(() => root.unmount()); host.remove();
    rpc.mockResolvedValue({ data: null, error: { message: "CAMPAIGN_BRIEF_FORBIDDEN" } });
    await mount();
    expect(state.phase).toBe("error");
  });
});
