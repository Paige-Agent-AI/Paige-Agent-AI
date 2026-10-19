import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Messages from "./Messages";
import { hasUnsavedWork } from "@/hooks/useBeforeUnloadGuard";
import type { ClientPortalMessagesState } from "@/hooks/useClientPortalMessages";

const T = "e0923000-0000-0000-0000-000000000001";
const f = vi.hoisted(() => ({
  state: null as unknown as ClientPortalMessagesState,
  modules: [{ key: "home", label: "Home" }, { key: "learn", label: "Resources" }],
  color: "#26483e" as string | null,
}));
vi.mock("@/hooks/useClientPortalMessages", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useClientPortalMessages")>()),
  useClientPortalMessages: () => f.state,
}));
vi.mock("@/hooks/useClientPortalBrand", () => {
  const brand = () => ({ tenant_id: T, tenant_name: "Northwind Studio", primary_color: f.color, logo_url: null });
  return {
    useClientPortalBrand: brand,
    useClientPortalBrandState: () => ({ brand: brand(), loading: false, error: null, multipleBusinesses: false }),
  };
});
// The customer's menu (and Messages' Resources hint) comes from the business's `_catalog` (E09 Slice M).
vi.mock("@/hooks/useClientPortalConfig", () => ({
  useClientPortalConfigState: () => ({ config: { catalog: { slug: null, authoredUsable: true, modules: f.modules } }, loading: false }),
}));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ portal: { modules: f.modules } }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
let where = "";
function Where() { const l = useLocation(); where = `${l.pathname}${l.search}`; return null; }
const render = async (path = "/app/messages") => act(async () => root.render(
  <MemoryRouter initialEntries={[path]}>
    <Where />
    <Routes>
      <Route path="/app/messages" element={<Messages />} />
      <Route path="/app/learn" element={<p>Resources page</p>} />
      <Route path="/app" element={<p>Home page</p>} />
    </Routes>
    <Link to="/app">Elsewhere</Link>
  </MemoryRouter>,
));
const button = (label: string) => Array.from(host.querySelectorAll("button"))
  .find(b => b.textContent?.trim() === label || b.getAttribute("aria-label") === label) as HTMLButtonElement;
async function type(value: string) {
  await act(async () => {
    const field = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  f.modules = [{ key: "home", label: "Home" }, { key: "learn", label: "Resources" }];
  f.color = "#26483e";
  f.state = {
    messages: [], outbox: [], loading: false, error: null, unavailable: false, multipleBusinesses: false,
    hasMore: false, loadingMore: false,
    tenantId: T, scopeEpoch: 0,
    refresh: vi.fn().mockResolvedValue(undefined), loadMore: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(true), retry: vi.fn().mockResolvedValue(true), discard: vi.fn(),
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  vi.restoreAllMocks();
  (window as { matchMedia?: unknown }).matchMedia = originalMatchMedia;
  expect(hasUnsavedWork()).toBe(false);
});
const originalMatchMedia = window.matchMedia;

// E09 Slice 5 — "Ask {business} for a payment link" lands here with suggested words in the composer. The
// customer edits and sends them through the existing Slice 1 send; nothing is sent on their behalf.
const DRAFT = "Could you send me a payment link for invoice INV-0042?";
const at = (draft: string) => `/app/messages?${new URLSearchParams({ topic: "payments", draft })}`;

it("puts the suggested words in the composer and sends nothing until the customer does", async () => {
  await render(at(DRAFT));
  const field = host.querySelector("textarea")!;
  expect(field.value).toBe(DRAFT);
  expect(document.activeElement).toBe(field);
  expect(f.state.send).not.toHaveBeenCalled();
  await act(async () => { button("Send").click(); });
  expect(f.state.send).toHaveBeenCalledWith(DRAFT, "message");
});

it("seeds once only: after the customer sends, a later re-render never puts the suggestion back", async () => {
  await render(at(DRAFT));
  await act(async () => { button("Send").click(); });
  expect(host.querySelector("textarea")!.value).toBe("");
  // The thread re-reads (loading, then ready again) while the page stays on the same address.
  f.state = { ...f.state, loading: true };
  await render(at(DRAFT));
  f.state = { ...f.state, loading: false };
  await render(at(DRAFT));
  expect(host.querySelector("textarea")!.value).toBe("");
  expect(f.state.send).toHaveBeenCalledTimes(1);
});

it("caps a suggestion at the message limit", async () => {
  await render(at("x".repeat(5_000)));
  expect(host.querySelector("textarea")!.value.length).toBe(4_000);
  await type("");
});

// ── Round 2 ──────────────────────────────────────────────────────────────────────────────────────────

it("takes the suggestion out of the address once it is in the composer, so a reload never puts it back", async () => {
  await render(at(DRAFT));
  expect(host.querySelector("textarea")!.value).toBe(DRAFT);
  const url = new URL(where, "https://x.test");
  expect(url.pathname).toBe("/app/messages");
  expect(url.searchParams.has("draft")).toBe(false);
  // The topic stays; only the suggestion is removed.
  expect(url.searchParams.get("topic")).toBe("payments");
  await type("");
});
