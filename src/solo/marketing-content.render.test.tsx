// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketingContent, type MarketingContentProps } from "./marketing-content";

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  error: null as Error | null,
  filters: [] as [string, unknown][],
  access: true,
  posts: [] as Record<string, unknown>[],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => {
    expect(table).toBe("marketing_content");
    let originalId: unknown;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        db.filters.push([key, value]);
        if (key === "id") originalId = value;
        return query;
      },
      in: (key: string, value: unknown) => { db.filters.push([key, value]); return query; },
      not: (key: string, op: string, value: unknown) => { db.filters.push([`not ${key} ${op}`, value]); return query; },
      order: () => query,
      limit: (size: number) => Promise.resolve({
        data: (originalId ? db.rows.filter(row => row.id === originalId) : db.rows).slice(0, size),
        error: db.error,
      }),
    };
    return query;
  } },
}));
vi.mock("./useSoloCampaignBriefs", () => ({ useSoloCampaignBriefs: () => ({ phase: "ready", canManage: db.access }) }));
vi.mock("./social-publishing-data", () => ({ readSocialDesk: async () => ({ posts: db.posts }) }));

const tenant = "9561c2f4-9de7-478e-84fa-d9d16f929c9e";
const foreign = "f6eecba0-0811-4d62-a0a0-ab15c7f3a737";
const id = "b5e24aed-91ab-4450-873a-d262218aab3c";
const origin = "https://storage.example.test";
const image = {
  id, tenant_id: tenant, kind: "image", status: "published", title: "Published brand image",
  published_at: "2026-10-03T10:00:00Z", image_path: `${tenant}/hero.jpg`,
  image_url: `${origin}/storage/v1/object/public/paige-generated/${tenant}/hero.jpg`,
};
const page: MarketingContentProps["artifacts"][number] = {
  id: "page-1", type: "page", name: "Registration page", slug: "registration", status: "published",
  updatedAt: "2026-10-01T10:00:00Z", publicHref: "https://example.com/registration", recentSubmissions: 0,
  routingConfigured: false, routingState: "No route", routingTargets: [],
  recentDispatches: { succeeded: 0, failed: 0, other: 0 }, dispatchStatuses: {},
};

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const render = async (props: Partial<MarketingContentProps> = {}) => {
  act(() => root.render(<MarketingContent tenantId={tenant} artifacts={[]} publishedPhase="ready" onRetryPublished={vi.fn()} {...props}/>));
  await flush();
};
const card = (title: string) => Array.from(host.querySelectorAll<HTMLButtonElement>(".content-catalog-item"))
  .find(button => button.querySelector("strong")?.textContent === title);

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  db.filters = [];
  db.rows = [];
  db.error = null;
  db.access = true;
  db.posts = [];
  vi.stubEnv("VITE_SUPABASE_URL", origin);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("the published Solo Content catalog", () => {
  it("requests only actual published media and mixes it with existing live work", async () => {
    db.rows = [
      image,
      { ...image, id: "draft", status: "draft", title: "Private draft" },
      { ...image, id: "ready", status: "ready", title: "Private ready file" },
      { ...image, id: "unproven", published_at: null, title: "No publication proof" },
      { ...image, id: "foreign", tenant_id: foreign, title: "Other workspace image" },
    ];
    db.posts = [
      { key: "receipt-1", receiptId: "receipt-1", status: "published", caption: "Original published post",
        updatedAt: "2026-10-04T10:00:00Z", media: [], url: "https://www.threads.com/@fixture/post/1" },
      { key: "draft-1", receiptId: null, status: "draft", caption: "Private social draft", media: [] },
    ];
    await render({ artifacts: [page, { ...page, id: "draft-page", status: "draft", name: "Private page draft" }] });
    expect(db.filters).toEqual([["tenant_id", tenant], ["status", "published"], ["kind", ["image", "video"]], ["not published_at is", null]]);
    expect(host.querySelector("h1")?.textContent).toBe("Content");
    expect(host.querySelector('[aria-label="Content view"]')).toBeNull();
    expect(host.textContent).not.toMatch(/Media library|Private |Other workspace|No publication proof/);
    expect(card("Published brand image")).toBeTruthy();
    expect(card("Registration page")).toBeTruthy();
    expect(card("Original published post")).toBeTruthy();
  });

  it("opens the eligible published original in Studio and returns from the same catalog detail", async () => {
    db.rows = [image];
    await render();
    const opener = card(image.title)!;
    act(() => opener.click());
    expect(host.querySelector(".content-catalog-detail h2")?.textContent).toBe(image.title);
    const launcher = host.querySelector<HTMLButtonElement>("[data-solo-vibe-studio-launcher]")!;
    const received = vi.fn();
    window.addEventListener("paige-studio", received, { once: true });
    act(() => launcher.click());
    expect(received.mock.calls[0][0].detail).toEqual({
      returnFocus: launcher, asset: { source: "marketing_content", id, kind: "image", expectedTenantId: tenant },
    });
    act(() => host.querySelector<HTMLButtonElement>(".content-catalog-back")!.click());
    expect(document.activeElement).toBe(card(image.title));
  });

  it("never loads an unscoped media URL from a published row", async () => {
    db.rows = [{ ...image, image_url: "https://example.test/unknown.jpg" }];
    await render();
    act(() => card(image.title)!.click());
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("[data-solo-vibe-studio-launcher]")).toBeNull();
  });

  it("shows a published Studio upload from its original tenant-scoped bucket", async () => {
    const url = image.image_url.replace("paige-generated", "growth-assets");
    db.rows = [{ ...image, image_url: url }];
    await render();
    act(() => card(image.title)!.click());
    expect(host.querySelector("img")?.getAttribute("src")).toBe(url);
    expect(host.querySelector("[data-solo-vibe-studio-launcher]")).toBeNull();
  });

  it("plays a published video in its detail and keeps unpublished video out", async () => {
    db.rows = [
      { ...image, kind: "video", title: "Published video", image_path: `${tenant}/replay.mp4`,
        image_url: `${origin}/storage/v1/object/public/paige-generated/${tenant}/replay.mp4` },
      { ...image, kind: "video", title: "Draft video", status: "draft" },
    ];
    await render();
    expect(card("Draft video")).toBeUndefined();
    act(() => card("Published video")!.click());
    expect(host.querySelector("video[controls]")?.getAttribute("aria-label")).toBe("Published video");
  });

  it("keeps live pages visible if published media cannot be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.error = new Error("sample unavailable");
    await render({ artifacts: [page] });
    expect(card(page.name)).toBeTruthy();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Published images and videos couldn’t load");
    expect(log).toHaveBeenCalled();
  });

  it("shows an explicit published-only empty state when every saved record is a draft", async () => {
    db.rows = [{ ...image, status: "draft" }];
    await render();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("No published work yet.");
  });

  it("opens an exact published bookmark even beyond the scoped recent list", async () => {
    db.rows = [...Array.from({ length: 61 }, (_, i) => ({ ...image, id: `recent-${i}` })), image];
    const clear = vi.fn();
    await render({ linkedPieceId: id, onClearLinkedPiece: clear });
    expect(db.filters).toContainEqual(["id", id]);
    expect(host.querySelector(".content-catalog-detail h2")?.textContent).toBe(image.title);
    act(() => host.querySelector<HTMLButtonElement>(".content-catalog-back")!.click());
    expect(clear).toHaveBeenCalledOnce();
  });

  it("declines legacy draft bookmarks and explains the published media search scope", async () => {
    db.rows = [
      ...Array.from({ length: 61 }, (_, i) => ({ ...image, id: `recent-${i}` })),
      { ...image, status: "draft", title: "Linked draft" },
    ];
    await render({ linkedPieceId: id });
    expect(host.querySelector(".content-catalog-detail")).toBeNull();
    expect(host.textContent).toContain("This original is unavailable in published Content.");
    expect(host.textContent).toContain("Showing the latest 60 published images and videos.");
    expect(host.textContent).not.toContain("Linked draft");
  });

  it("keeps the existing media read authority and shows the other published work", async () => {
    db.access = false;
    db.rows = [image];
    await render({ artifacts: [page] });
    expect(db.filters).toEqual([]);
    expect(card(image.title)).toBeUndefined();
    expect(card(page.name)).toBeTruthy();
  });
});
