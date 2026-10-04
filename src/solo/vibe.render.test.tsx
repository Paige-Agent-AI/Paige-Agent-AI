/**
 * Vibe Studio (canonical rebuild) — rendered behaviour.
 *
 * EVIDENCE CLASS, stated up front (§32/§70.1). This is a HARNESS drive against an in-memory
 * double of useMediaJobs, not authenticated runtime proof. It shows the owner-authorized states
 * render truthfully and the governed controls are wired to the seam — the no-provider truth
 * panel, the composer, the approval boundary, the finished-asset review row with the truthful
 * disabled Social handoff, and Escape-close. It does NOT prove the paige-media edge function
 * accepts these payloads in production; that authenticated proof is owed to a credentialed
 * session and (for provider calls) the owner's FAL_KEY + prepaid ceiling.
 *
 * House idiom: raw createRoot + act, previous root torn down inside renderAt, mocked hook.
 */
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  media: {} as Record<string, unknown>,
  submitted: [] as Array<Record<string, unknown>>,
  decided: [] as Array<[string, boolean]>,
  cancelled: [] as string[],
}));

vi.mock("./useMediaJobs", () => ({ useMediaJobs: () => harness.media }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "t-synthetic", activeTenant: { slug: "northwind-studio" } }),
}));
vi.mock("./studio/studio-data", async (orig) => ({
  ...(await orig<typeof import("./studio/studio-data")>()),
  listSessions: async () => [],
}));

const { VibeStudio } = await import("./vibe");

let host: HTMLDivElement;
let root: Root | null = null;
let backCount = 0;

// The media tools live under "Images & video" in the Studio rail; the Studio opens on its home.
function renderAt(media: Record<string, unknown>, view: "home" | "media" = "media") {
  harness.media = media;
  if (root) act(() => root!.unmount());
  host.remove();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<VibeStudio onBack={() => { backCount++; }} />);
  });
  if (view === "media") {
    const tab = [...host.querySelectorAll("button")].find((b) => b.textContent === "Images & video");
    act(() => { tab?.click(); });
  }
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  harness.submitted = [];
  harness.decided = [];
  harness.cancelled = [];
});
beforeEach(() => {
  host = document.createElement("div");
  backCount = 0;
});

const FAL_LICENSE = "This asset was generated using the recorded provider and model. Commercial-use status depends on the applicable provider and model terms, your source materials, and your intended use.";

function caps(over: Partial<Record<string, unknown>> = {}) {
  return {
    providers: [
      {
        provider: "fal",
        execution: "async",
        configured: true,
        models: [
          { id: "fal-ai/nano-banana", label: "Nano Banana", mode: "image", tier: "standard", estCostPerUnitUsd: 0.039, unit: "image" },
          { id: "fal-ai/nano-banana/edit", label: "Nano Banana Edit", mode: "image_edit", tier: "standard", estCostPerUnitUsd: 0.039, unit: "image" },
        ],
        license: { licenseClass: "provider_and_model_terms", commercialUse: "conditional", disclosure: FAL_LICENSE },
        retention: { policy: "fal CDN", copyDeadline: "Paige copies on completion" },
      },
    ],
    music: { available: false, status: "unavailable", note: "Music generation is deferred from this release." },
    video: { available: false, enabled: false, provider_configured: true, provider_ceiling_set: false, completed_today: 0, daily_limit: 1, note: "Video generation is switched off during the controlled beta." },
    budget: { ceiling_set: true, ceiling_usd: 20, accrued_today_usd: 0.5, draft_allowance_usd: 0.1 },
    ...over,
  };
}

const baseMedia = (over: Partial<Record<string, unknown>> = {}) => ({
  capabilities: caps(),
  jobs: [] as Array<Record<string, unknown>>,
  assets: {} as Record<string, unknown>,
  loading: false,
  actionError: null as string | null,
  submit: async (input: Record<string, unknown>) => {
    harness.submitted.push(input);
    return { status: "ok", job: { id: "j1" }, awaitingApproval: false };
  },
  decide: async (id: string, approve: boolean) => {
    harness.decided.push([id, approve]);
    return true;
  },
  approve: async (id: string) => {
    harness.decided.push([id, true]);
    return true;
  },
  decline: async (id: string) => {
    harness.decided.push([id, false]);
    return true;
  },
  // Owner ruling 2026-10-04: the requester approves. Default fixture: the viewer asked for it.
  approvalFor: () => ({ requestedByYou: true, requesterName: null }),
  cancel: async (id: string) => {
    harness.cancelled.push(id);
    return true;
  },
  refreshCapabilities: async () => {},
  ...over,
});

const text = () => host.textContent ?? "";

describe("Vibe Studio — the 18 owner-required states, rendered", () => {
  it("state 1 — no provider configured renders the truthful needs-config panel naming FAL_KEY", () => {
    renderAt(baseMedia({ capabilities: caps({ providers: [{ ...caps().providers[0], configured: false }] }) }));
    expect(text()).toContain("Media generation isn't switched on yet");
    expect(text()).toContain("FAL_KEY");
    expect(text()).toContain("prepaid provider ceiling");
  });

  it("state 3 — configured provider renders the composer; Generate stays disabled until a brief exists", () => {
    renderAt(baseMedia());
    const textarea = host.querySelector("textarea");
    expect(textarea).toBeTruthy();
    const gen = host.querySelector<HTMLButtonElement>("button[aria-label='Generate']");
    expect(gen?.disabled).toBe(true);
    act(() => {
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Controlled input via native setter (jsdom + React idiom).
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setter?.call(textarea, "a bold hero visual for the masterclass");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((textarea as HTMLTextAreaElement).value).toContain("masterclass");
  });

  it("states 5+6 — awaiting approval renders the boundary with the estimate and the exact commercial-use language", async () => {
    renderAt(baseMedia({
      jobs: [{ id: "pj", mode: "image", provider: "fal", model: "fal-ai/nano-banana", params: { prompt: "hero visual" }, state: "blocked", approval_state: "pending", estimated_cost_usd: 0.039, actual_cost_usd: null, error: null, content_id: null, video_seconds: null, created_at: new Date().toISOString(), completed_at: null }],
    }));
    expect(text()).toContain("Needs your approval");
    expect(text()).toContain("≈$0.039");
    expect(text()).toContain("Commercial-use status depends on the applicable provider and model terms");
    const approve = [...host.querySelectorAll("button")].find((b) => b.textContent === "Approve & run");
    await act(async () => { approve?.click(); });
    const decline = [...host.querySelectorAll("button")].find((b) => b.textContent === "Decline");
    await act(async () => { decline?.click(); });
    expect(harness.decided).toEqual([["pj", true], ["pj", false]]);
  });

  it("states 5+6 for another admin — names who asked, offers Decline only, and never Approve", async () => {
    renderAt(baseMedia({
      jobs: [{ id: "pj", mode: "image", provider: "fal", model: "fal-ai/nano-banana", params: { prompt: "hero visual" }, state: "blocked", approval_state: "pending", estimated_cost_usd: 0.039, actual_cost_usd: null, error: null, content_id: null, video_seconds: null, created_at: new Date().toISOString(), completed_at: null }],
      approvalFor: () => ({ requestedByYou: false, requesterName: "Dana Reyes" }),
    }));
    expect(text()).toContain("Waiting for Dana Reyes");
    expect(text()).toContain("Waiting for Dana Reyes");
    expect(text()).toContain("Only they can approve the cost. You can decline it.");
    expect(text()).not.toContain("Needs your approval");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Approve & run")).toBe(false);
    const decline = [...host.querySelectorAll("button")].find((b) => b.textContent === "Decline");
    await act(async () => { decline?.click(); });
    expect(harness.decided).toEqual([["pj", false]]);
  });

  it("states 10+11+18 — a finished job renders its asset, the review row, and the truthful DISABLED Social handoff", () => {
    renderAt(baseMedia({
      jobs: [{ id: "sj", mode: "image", provider: "fal", model: "fal-ai/nano-banana", params: { prompt: "finished hero" }, state: "succeeded", approval_state: "not_required", estimated_cost_usd: 0.039, actual_cost_usd: null, error: null, content_id: "c1", video_seconds: null, created_at: new Date().toISOString(), completed_at: new Date().toISOString() }],
      assets: { c1: { id: "c1", kind: "image", title: "finished hero", image_url: "https://example.test/a.png", meta: {} } },
    }));
    expect(text()).toContain("Review ready");
    const img = host.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://example.test/a.png");
    const social = [...host.querySelectorAll("button")].find((b) => b.textContent === "Send to Social");
    expect(social?.disabled).toBe(true);
    expect(social?.getAttribute("title")).toContain("Social connection and publishing path are verified");
  });

  it("states 2+4 — video off-in-beta and music unavailable render as truthful capability rows", () => {
    renderAt(baseMedia());
    expect(text()).toContain("off in beta");
    expect(text()).toContain("Music");
    expect(text()).toContain("deferred from this release — no music provider is connected");
  });

  it("Escape closes the overlay (the SoloApp mount contract), from Images & video and from Studio home", () => {
    renderAt(baseMedia());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(backCount).toBe(1);
    renderAt(baseMedia(), "home");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(backCount).toBe(2);
  });

  it("opens on Studio home: one brief composer, no artifact-type picker, and Back to Marketing", () => {
    renderAt(baseMedia(), "home");
    expect(text()).toContain("What should Paige build?");
    expect(text()).toContain("Back to Marketing");
    expect(host.querySelector("#vs-brief")).toBeTruthy();
    for (const tab of ["Page", "Form", "Funnel", "Copy"]) {
      expect([...host.querySelectorAll("button")].some((b) => b.textContent === tab)).toBe(false);
    }
  });

  it("empty state — no jobs yet renders guidance, not fake projects", () => {
    renderAt(baseMedia());
    expect(text()).toContain("Nothing here yet");
    expect(text()).not.toContain("Meridian Advisory");
  });

  it("state 15 — a budget-denied submit surfaces the server's explanation verbatim", async () => {
    renderAt(baseMedia({
      submit: async () => ({ status: "error", message: "Daily media budget reached ($20.00 of $20.00); resets at UTC midnight", budgetDenied: true }),
    }));
    const textarea = host.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setter?.call(textarea, "another image please");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const gen = host.querySelector<HTMLButtonElement>("button[aria-label='Generate']");
    await act(async () => { gen?.click(); });
    expect(text()).toContain("Daily media budget reached");
  });
});
