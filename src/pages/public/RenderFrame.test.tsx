import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RenderFrame from "./RenderFrame";
import { readRenderPayload, settleRenderFrame } from "@/lib/render-frame";

/**
 * /render-frame is what paige-browser screenshots for the §33 critique loop. Its whole contract:
 * render the injected payload through the SAME page renderer the public route uses, touch no data
 * source, and say when it is ready — and never say so when there is nothing to show.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Every way the app could reach Supabase is a recorded call. The frame must make none.
const db = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => {
  const record = (name: string) => (...args: unknown[]) => {
    db.calls.push(`${name}(${JSON.stringify(args[0] ?? "")})`);
    return { select: () => ({}), then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) };
  };
  return {
    supabase: {
      from: record("from"),
      rpc: record("rpc"),
      functions: { invoke: record("functions.invoke") },
      auth: { getSession: record("auth.getSession"), getUser: record("auth.getUser"), onAuthStateChange: record("auth.onAuthStateChange") },
      channel: record("channel"),
    },
  };
});

const PAYLOAD = {
  blocks: [
    { type: "hero", title: "Get your weekends back", subtitle: "Paige handles the follow-ups.", cta_label: "Book a call", cta_href: "#apply" },
    { type: "feature_grid", title: "What changes", items: [{ title: "Intake on autopilot", body: "Every new client is onboarded the same day." }] },
    { type: "image", url: "https://img.test/team.jpg", alt: "The team" },
    { type: "embedded_form", form_slug: "intake", title: "Apply" },
    { type: "chatbot", title: "Ask Paige" },
    "not a block",
  ],
  theme: { primary: "#1f2a5a" },
  brand: { primary_color: "#1f2a5a", accent_color: "#c9a24a" },
  tenant_name: "Northwind Advisory",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom has no Element.scrollTo; the static chatbot block scrolls its own message list on mount.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
  db.calls.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.__PAIGE_RENDER_PAYLOAD__;
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
});

async function mount() {
  await act(async () => { root.render(<RenderFrame />); });
}

async function waitForReady() {
  for (let i = 0; i < 100; i++) {
    const el = container.querySelector("[data-render-frame]");
    // Images never load in jsdom; fire their load so the settle step completes like a browser would.
    container.querySelectorAll("img").forEach((img) => img.dispatchEvent(new Event("load")));
    if (el?.getAttribute("data-render-ready") === "true") return el;
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  return container.querySelector("[data-render-frame]");
}

describe("/render-frame renders the injected page", () => {
  it("renders the payload's blocks through the public page renderer and marks itself ready", async () => {
    window.__PAIGE_RENDER_PAYLOAD__ = PAYLOAD;
    await mount();
    expect(container.textContent).toContain("Get your weekends back");
    expect(container.textContent).toContain("Intake on autopilot");
    // The same footer the published page carries — one renderer, not a look-alike.
    expect(container.textContent).toContain(`© ${new Date().getFullYear()}`);
    const el = await waitForReady();
    expect(el?.getAttribute("data-render-ready")).toBe("true");
  });

  it("makes no Supabase call of any kind — the payload is its only input", async () => {
    window.__PAIGE_RENDER_PAYLOAD__ = PAYLOAD;
    await mount();
    await waitForReady();
    expect(db.calls).toEqual([]);
  });

  it("renders an embedded form as the non-submitting preview (no tenant is ever passed)", async () => {
    window.__PAIGE_RENDER_PAYLOAD__ = PAYLOAD;
    await mount();
    expect(container.textContent).toContain("Your form renders here on the published page.");
    expect(container.querySelector("#apply form")).toBeNull();
  });

  it("keeps the chatbot block static: sending from it reaches no backend", async () => {
    window.__PAIGE_RENDER_PAYLOAD__ = PAYLOAD;
    await mount();
    const chatForm = container.querySelector("form");
    const input = chatForm?.querySelector("input, textarea") as HTMLInputElement | null;
    if (input) {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
        setter?.call(input, "hello");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await act(async () => { chatForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(db.calls).toEqual([]);
  });

  it("is noindex and takes the display name as its title", async () => {
    window.__PAIGE_RENDER_PAYLOAD__ = PAYLOAD;
    await mount();
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toContain("noindex");
    expect(document.title).toBe("Northwind Advisory");
  });
});

describe("/render-frame with nothing to render", () => {
  it.each([
    ["no payload", undefined],
    ["blocks not an array", { blocks: "hero" }],
    ["a bare array", [{ type: "hero", title: "x" }]],
  ])("%s → a neutral state that never claims to be ready", async (_label, raw) => {
    if (raw !== undefined) window.__PAIGE_RENDER_PAYLOAD__ = raw;
    await mount();
    expect(container.textContent).toContain("Nothing to render");
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(container.querySelector('[data-render-ready="true"]')).toBeNull();
    expect(db.calls).toEqual([]);
  });
});

describe("readRenderPayload / settleRenderFrame", () => {
  it("keeps only object blocks with a type and drops malformed theme/brand", () => {
    const p = readRenderPayload({ blocks: [{ type: "cta", title: "t", cta_label: "a", cta_href: "#" }, null, 3, { title: "no type" }], theme: "dark", brand: [1] });
    expect(p?.blocks).toHaveLength(1);
    expect(p?.theme).toBeNull();
    expect(p?.brand).toBeNull();
    expect(p?.tenantName).toBeNull();
  });

  it("upgrades lazy images to eager so a full-page capture includes them", async () => {
    const host = document.createElement("div");
    host.innerHTML = '<img loading="lazy" src="https://img.test/a.jpg"><img src="https://img.test/b.jpg">';
    const done = settleRenderFrame(host, 200);
    host.querySelectorAll("img").forEach((img) => img.dispatchEvent(new Event("load")));
    await done;
    expect(host.querySelector("img")?.getAttribute("loading")).toBe("eager");
  });

  it("still resolves when an image never loads — bounded by the cap", async () => {
    const host = document.createElement("div");
    host.innerHTML = '<img src="https://img.test/never.jpg">';
    const t0 = Date.now();
    await settleRenderFrame(host, 60);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
  });
});

describe("App mounts /render-frame outside every provider", () => {
  it("short-circuits on the path before ThemeProvider, TenantProvider and the router", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const gate = app.indexOf("isRenderFramePath(window.location.pathname)");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(app.indexOf("<ThemeProvider"));
    expect(app).toContain('import("./pages/public/RenderFrame")');
  });
});
