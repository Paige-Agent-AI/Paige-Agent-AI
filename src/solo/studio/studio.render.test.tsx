/**
 * Vibe Studio project workspace (layout C) — rendered behaviour.
 *
 * EVIDENCE CLASS (§32/§70.1): a HARNESS drive in jsdom. The data layer (studio-data) and the media
 * hook are in-memory doubles; the chat stream is a scripted SSE body served by a stubbed fetch,
 * parsed by the real useStudioChat. It proves the workspace wires the owner's acts to the right
 * seams and renders what the stream and the reads return. It is NOT authenticated runtime proof
 * that paige-ai-chat or the publish RPCs accept these calls in production.
 *
 * Synthetic data only (§63): "Northwind Studio", t-synthetic.
 */
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Rec = Record<string, unknown>;

const h = vi.hoisted(() => ({
  sessions: [] as Rec[],
  created: [] as string[],
  manifest: [] as Array<{ kind: string; id: string; title: string }>,
  form: null as Rec | null,
  versions: [] as Rec[],
  restored: [] as string[],
  published: [] as Array<[string, string]>,
  publishError: null as Error | null,
  sse: [] as string[],
  status: 200,
  fetchBodies: [] as Rec[],
}));

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "t-synthetic", activeTenant: { slug: "northwind-studio" } }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-token" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));
vi.mock("../useMediaJobs", () => ({
  useMediaJobs: () => ({ jobs: [], assets: {}, capabilities: null, loading: false, actionError: null, decide: async () => true }),
}));
vi.mock("@/components/admin/studio/LivePreview", () => ({ LivePreview: () => <div data-testid="live-preview" /> }));
vi.mock("./studio-data", async (orig) => {
  const real = await orig<typeof import("./studio-data")>();
  const session = (id: string, title: string, brief: string) => ({ id, title, seedBrief: brief, artifacts: h.manifest, updatedAt: "2026-10-03T12:00:00Z" });
  return {
    ...real,
    listSessions: async () => h.sessions,
    createSession: async (brief: string) => { h.created.push(brief); return session("s-new", brief, brief); },
    openSession: async (id: string) => session(id, "Client intake", "An intake form for new clients"),
    ensureThread: async () => "th-1",
    loadTurns: async () => [],
    loadBrand: async () => ({ floor: {}, name: "Northwind Studio", logoUrl: null }),
    loadForm: async () => { if (!h.form) throw new Error("missing"); return h.form; },
    listVersions: async () => h.versions,
    restoreVersion: async (id: string) => { h.restored.push(id); },
    publishArtifact: async (kind: string, id: string) => {
      if (h.publishError) throw h.publishError;
      h.published.push([kind, id]);
      return { url: "/form/" + id };
    },
    unpublishArtifact: async () => {},
  };
});

const { VibeStudio } = await import("../vibe");

let host: HTMLDivElement;
let root: Root | null = null;
let backs = 0;

const FORM = {
  id: "f-1", name: "New client intake", slug: "new-client-intake", status: "draft", live: false, changesPending: false,
  intro: "Tell us a little about your business.", submitLabel: "Send", thankYou: "Thanks — we'll be in touch within a day.",
  fields: [
    { key: "name", label: "Your name", type: "text", required: true, options: [] },
    { key: "email", label: "Email", type: "email", required: true, options: [] },
    { key: "goal", label: "What do you want help with?", type: "radio", required: false, options: ["Strategy", "Delivery"] },
  ],
  routesToPipeline: false, pipelineId: null, stageId: null, notifyEmail: null,
};

function sseBody(frames: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) { for (const f of frames) c.enqueue(enc.encode(`data: ${f}\n\n`)); c.close(); },
  });
}

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  act(() => { setter?.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}

beforeEach(() => {
  Object.assign(h, { sessions: [], created: [], manifest: [], form: null, versions: [], restored: [], published: [], publishError: null, sse: [], status: 200, fetchBodies: [] });
  backs = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    h.fetchBodies.push(JSON.parse(String(init.body)));
    // The build lands as the stream reports it: the manifest and the form exist once Paige says so.
    if (h.sse.some((f) => f.includes("paige_artifact"))) { h.manifest = [{ kind: "form", id: "f-1", title: "New client intake" }]; h.form = FORM; }
    return new Response(h.status === 200 ? sseBody(h.sse) : null, { status: h.status });
  }));
  Element.prototype.scrollTo = function () {} as typeof Element.prototype.scrollTo;
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  root = createRoot(host);
  act(() => { root!.render(<VibeStudio onBack={() => { backs++; }} />); });
  await flush();
}

async function startProject(brief: string) {
  await mount();
  type(host.querySelector<HTMLTextAreaElement>("#vs-brief")!, brief);
  const build = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Build it"))!;
  await act(async () => { build.click(); });
  await flush();
}

describe("Vibe Studio project workspace", () => {
  it("a brief opens a project and Paige's first build lands on the stage, with her steps", async () => {
    h.sse = [
      JSON.stringify({ paige_step: { id: "a", label: "Wrote 3 questions" } }),
      JSON.stringify({ paige_step: { id: "b", label: "Saved the form" } }),
      JSON.stringify({ paige_artifact: { kind: "form", id: "f-1", title: "New client intake" } }),
      JSON.stringify({ choices: [{ delta: { content: "Your intake form is ready. Want a pipeline stage for it?" } }] }),
      "[DONE]",
    ];
    await startProject("An intake form for new clients");

    expect(h.created).toEqual(["An intake form for new clients"]);
    expect(h.fetchBodies).toHaveLength(1);
    expect(h.fetchBodies[0]).toMatchObject({ threadId: "th-1", messages: [{ role: "user", content: "An intake form for new clients" }] });
    expect(text()).toContain("Wrote 3 questions");
    expect(text()).toContain("Saved the form");
    expect(text()).toContain("Your intake form is ready");
    // The stage renders the saved working copy, labelled by its own questions.
    expect(host.querySelector(".vs-sheet")?.getAttribute("aria-label")).toBe("New client intake, as visitors see it");
    expect(text()).toContain("What do you want help with?");
    expect(text()).toContain("Saved · draft");
    // No artifact-type tabs anywhere in the session (§21).
    for (const t of ["Page", "Form", "Funnel", "Copy", "Image"]) expect(button(t)).toBeUndefined();
  });

  it("publishing goes through the publish seam and reports only the address it returned", async () => {
    h.manifest = [{ kind: "form", id: "f-1", title: "New client intake" }];
    h.form = FORM;
    h.sessions = [{ id: "s-1", title: "Client intake", seedBrief: null, artifacts: h.manifest, updatedAt: "2026-10-03T12:00:00Z" }];
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(h.fetchBodies).toHaveLength(0); // reopening a project never re-sends a brief

    await act(async () => { button("Publish")!.click(); });
    expect(text()).toContain("Ready to go live?");
    expect(text()).toContain("Has 3 questions");
    expect(text()).toContain("Asks for an email");
    await act(async () => { button("Publish now")!.click(); });
    await flush();
    expect(h.published).toEqual([["form", "f-1"]]);
    expect(text()).toContain("It's live");
    expect(text()).toContain(`${window.location.origin}/form/f-1`);
  });

  it("a refused publish shows the server's own sentence and claims nothing", async () => {
    h.manifest = [{ kind: "form", id: "f-1", title: "New client intake" }];
    h.form = FORM;
    h.sessions = [{ id: "s-1", title: "Client intake", seedBrief: null, artifacts: h.manifest, updatedAt: "2026-10-03T12:00:00Z" }];
    h.publishError = new Error("GROWTH_PLACEHOLDER: the form still has unfinished text");
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    await act(async () => { button("Publish")!.click(); });
    await act(async () => { button("Publish now")!.click(); });
    await flush();
    expect(text()).toContain("The form still has unfinished text");
    expect(text()).not.toContain("It's live");
  });

  it("the timeline restores an earlier version into the working copy", async () => {
    h.manifest = [{ kind: "form", id: "f-1", title: "New client intake" }];
    h.form = FORM;
    h.versions = [
      { id: "v1", versionNo: 1, isCurrent: false, title: "First draft", thumbnailUrl: null, createdAt: "2026-10-03T11:00:00Z" },
      { id: "v2", versionNo: 2, isCurrent: true, title: "Added a goal question", thumbnailUrl: null, createdAt: "2026-10-03T11:30:00Z" },
    ];
    h.sessions = [{ id: "s-1", title: "Client intake", seedBrief: null, artifacts: h.manifest, updatedAt: "2026-10-03T12:00:00Z" }];
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(text()).toContain("Version 2 · current");
    const v1 = [...host.querySelectorAll(".vs-version")].find((b) => b.textContent?.includes("First draft")) as HTMLButtonElement;
    await act(async () => { v1.click(); });
    await act(async () => { button("Go back to this version")!.click(); });
    await flush();
    expect(h.restored).toEqual(["v1"]);
    expect(text()).toContain("Went back to version 1");
  });

  it("Paige's one grouped question renders as choices, and the answer is sent as the next turn", async () => {
    h.sse = [JSON.stringify({ paige_choices: { prompt: "Who is this form for?", options: [{ label: "New clients", value: "new clients" }, { label: "Existing clients", value: "existing clients" }] } }), "[DONE]"];
    await startProject("A form for my clients");
    expect(text()).toContain("Who is this form for?");
    h.sse = [JSON.stringify({ choices: [{ delta: { content: "Got it." } }] }), "[DONE]"];
    await act(async () => { button("New clients")!.click(); });
    await act(async () => { button("Use this")!.click(); });
    await flush();
    expect(h.fetchBodies).toHaveLength(2);
    const last = (h.fetchBodies[1].messages as Rec[]).at(-1);
    expect(last).toEqual({ role: "user", content: "new clients" });
  });

  it("a failed turn says so and leaves the conversation as it was", async () => {
    h.status = 500;
    await startProject("A landing page for my workshop");
    expect(text()).toContain("Paige couldn't take that just now");
    expect(text()).toContain("Nothing on the stage yet");
  });

  it("Esc in a project steps back to Studio home, and Esc there closes the Studio", async () => {
    h.manifest = [{ kind: "form", id: "f-1", title: "New client intake" }];
    h.form = FORM;
    h.sessions = [{ id: "s-1", title: "Client intake", seedBrief: null, artifacts: h.manifest, updatedAt: "2026-10-03T12:00:00Z" }];
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(host.querySelector(".vs-session")).toBeTruthy();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    await flush();
    expect(host.querySelector(".vs-session")).toBeNull();
    expect(text()).toContain("What should Paige build?");
    expect(backs).toBe(0);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(backs).toBe(1);
  });
});
