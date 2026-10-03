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
  versionReads: 0,
  content: null as Rec | null,
  openTitle: "Client intake",
  renamed: [] as Array<[string, string]>,
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
    openSession: async (id: string) => session(id, h.openTitle, "An intake form for new clients"),
    renameSession: async (id: string, title: string) => { h.renamed.push([id, title]); h.openTitle = title; },
    ensureThread: async () => "th-1",
    loadTurns: async () => [],
    loadBrand: async () => ({ floor: {}, name: "Northwind Studio", logoUrl: null }),
    loadForm: async () => { if (!h.form) throw new Error("missing"); return h.form; },
    listVersions: async () => { h.versionReads += 1; return h.versions; },
    loadImage: async () => { if (!h.content) throw new Error("missing"); return h.content; },
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
    // "__BREAK__" drops the connection mid-turn, after whatever came before it was delivered.
    start(c) {
      for (const f of frames) {
        if (f === "__BREAK__") { c.error(new TypeError("network connection was lost")); return; }
        c.enqueue(enc.encode(`data: ${f}\n\n`));
      }
      c.close();
    },
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
  Object.assign(h, { sessions: [], created: [], manifest: [], form: null, versions: [], restored: [], published: [], publishError: null, sse: [], status: 200, fetchBodies: [], versionReads: 0, content: null, openTitle: "Client intake", renamed: [] });
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

  it("reopening a project never re-sends its brief, even when this person's thread is empty", async () => {
    // Threads are per person: a teammate opening the project (or an expired thread) sees no turns
    // while the project still carries its seed brief. That must not start a second build.
    h.manifest = [{ kind: "form", id: "f-1", title: "New client intake" }];
    h.form = FORM;
    h.sessions = [{ id: "s-1", title: "Client intake", seedBrief: "An intake form for new clients", artifacts: h.manifest, thumbnailUrl: null, updatedAt: "2026-10-03T12:00:00Z" }];
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(host.querySelector(".vs-session")).toBeTruthy();
    expect(h.fetchBodies).toHaveLength(0);
  });

  it("a malformed line in the stream is skipped and the rest of the turn still arrives", async () => {
    h.sse = ["{not json", JSON.stringify({ paige_step: { id: "a", label: "Saved the form" } }), JSON.stringify({ choices: [{ delta: { content: "Done — it's on the stage." } }] }), "[DONE]"];
    await startProject("An intake form for new clients");
    expect(text()).toContain("Saved the form");
    expect(text()).toContain("Done — it's on the stage.");
  });

  it("a streamed turn reads the timeline once when it ends, not on every word", async () => {
    h.manifest = [{ kind: "form", id: "f-1", title: "New client intake" }];
    h.form = FORM;
    h.sessions = [{ id: "s-1", title: "Client intake", seedBrief: null, artifacts: h.manifest, thumbnailUrl: null, updatedAt: "2026-10-03T12:00:00Z" }];
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    const before = h.versionReads;
    h.sse = [...Array.from({ length: 30 }, (_, i) => JSON.stringify({ choices: [{ delta: { content: `w${i} ` } }] })), "[DONE]"];
    type(host.querySelector<HTMLTextAreaElement>("#vs-chat-input")!, "Tighten the questions");
    await act(async () => { host.querySelector<HTMLButtonElement>("button[aria-label='Send']")!.click(); });
    await flush();
    expect(text()).toContain("w29");
    expect(h.versionReads - before).toBeLessThanOrEqual(2);
  });

  it("picking a version shows it on the stage before going back to it", async () => {
    h.manifest = [{ kind: "form", id: "f-1", title: "New client intake" }];
    h.form = FORM;
    h.versions = [
      { id: "v1", versionNo: 1, isCurrent: false, title: "First draft", thumbnailUrl: null, createdAt: "2026-10-03T11:00:00Z",
        snapshot: { id: "f-1", name: "Old intake", status: "draft", schema_json: { sections: [{ fields: [{ key: "email", label: "Old email question", type: "email" }] }] } } },
      { id: "v2", versionNo: 2, isCurrent: true, title: "Now", thumbnailUrl: null, createdAt: "2026-10-03T11:30:00Z", snapshot: null },
    ];
    h.sessions = [{ id: "s-1", title: "Client intake", seedBrief: null, artifacts: h.manifest, thumbnailUrl: null, updatedAt: "2026-10-03T12:00:00Z" }];
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(text()).not.toContain("Old email question");
    const v1 = [...host.querySelectorAll(".vs-version")].find((b) => b.textContent?.includes("First draft")) as HTMLButtonElement;
    await act(async () => { v1.click(); });
    expect(text()).toContain("Old email question");
    expect(text()).toContain("Showing version 1. Your working copy is unchanged.");
    expect(h.restored).toEqual([]);
  });

  it("saved copy in the project is shown as words, not an empty image, and Publish refuses it in plain words", async () => {
    h.manifest = [{ kind: "content", id: "c-1", title: "Client welcome guide" }];
    h.content = { id: "c-1", title: "Client welcome guide", contentKind: "copy", imageUrl: null, body: "Welcome aboard.\n\nHere is how we work.", live: false };
    h.sessions = [{ id: "s-1", title: "Welcome guide", seedBrief: null, artifacts: h.manifest, thumbnailUrl: null, updatedAt: "2026-10-03T12:00:00Z" }];
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(text()).toContain("Here is how we work.");
    expect(text()).not.toContain("This image has no file yet");
    await act(async () => { button("Publish")!.click(); });
    expect(text()).toContain("Copy isn't published from the Studio");
    expect(button("Publish now")!.disabled).toBe(true);
  });

  it("a failed turn clears its steps instead of hanging them under the previous reply", async () => {
    h.sse = [JSON.stringify({ paige_step: { id: "a", label: "Wrote 3 questions" } }), JSON.stringify({ choices: [{ delta: { content: "First reply." } }] }), "[DONE]"];
    await startProject("An intake form for new clients");
    expect(text()).toContain("Wrote 3 questions");
    // The next turn streams a step, then the connection drops.
    h.sse = [JSON.stringify({ paige_step: { id: "b", label: "Started the budget question" } }), "__BREAK__"];
    type(host.querySelector<HTMLTextAreaElement>("#vs-chat-input")!, "Add a budget question");
    await act(async () => { host.querySelector<HTMLButtonElement>("button[aria-label='Send']")!.click(); });
    await flush();
    expect(text()).toContain("Paige couldn't take that just now. Check your connection and try again.");
    expect(text()).not.toContain("network connection was lost");
    expect(text()).not.toContain("Started the budget question");
  });

  it("while Paige works, the stage shows the sheet taking the shape of what her steps say she is making", async () => {
    // The stream holds after the first step so the in-progress stage can be read.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      h.fetchBodies.push(JSON.parse(String(init.body)));
      const enc = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        async start(c) {
          c.enqueue(enc.encode(`data: ${JSON.stringify({ paige_step: { id: "a", label: "Designing your landing page" } })}\n\n`));
          await gate;
          c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
        },
      }), { status: 200 });
    }));
    await startProject("A landing page for my workshop");
    const build = host.querySelector(".vs-build");
    expect(build?.getAttribute("data-shape")).toBe("page");
    expect(host.querySelector(".vs-build-now")?.textContent).toBe("Designing your landing page");
    expect(host.querySelector(".vs-wire-page")).toBeTruthy();
    await act(async () => { release(); });
    await flush();
    expect(host.querySelector(".vs-build")).toBeNull();
  });

  it("a page designed but not saved shows on the stage as not saved, never as an empty stage", async () => {
    h.sse = [
      JSON.stringify({ paige_step: { id: "a", label: "Designing your landing page" } }),
      JSON.stringify({ paige_preview: { kind: "page", title: "Workshop", blocks: [{ type: "hero", title: "Turn ten clients into referrals" }], theme: null } }),
      JSON.stringify({ choices: [{ delta: { content: "Here it is." } }] }),
      "[DONE]",
    ];
    await startProject("A landing page for my workshop");
    expect(text()).toContain("Designed, not saved yet.");
    expect(host.querySelector("[data-testid='live-preview']")).toBeTruthy();
    expect(text()).not.toContain("Nothing on the stage yet");
  });

  it("an action held for approval shows a card, and Approve sends exactly that action's fingerprint", async () => {
    h.sse = [
      JSON.stringify({ paige_confirm: { tool: "growth_page_save", summary: "Save the page draft “Workshop”", fingerprint: "0123456789abcdef" } }),
      JSON.stringify({ choices: [{ delta: { content: "It's waiting on your approval." } }] }),
      "[DONE]",
    ];
    await startProject("A landing page for my workshop");
    expect(text()).toContain("Waiting for your approval");
    expect(text()).toContain("Save the page draft “Workshop”");
    h.sse = [JSON.stringify({ choices: [{ delta: { content: "Saved." } }] }), "[DONE]"];
    await act(async () => { button("Approve")!.click(); });
    await flush();
    expect(h.fetchBodies.at(-1)).toMatchObject({ approvedConfirmations: ["0123456789abcdef"] });
    expect((h.fetchBodies.at(-1)!.messages as Rec[]).at(-1)).toEqual({ role: "user", content: "Approved — run it." });
    expect(text()).not.toContain("Waiting for your approval");
  });

  it("Paige's reply is formatted, not shown with raw markdown", async () => {
    h.sse = [JSON.stringify({ choices: [{ delta: { content: "**The structure:**\n\n- A hero\n- A proof block" } }] }), "[DONE]"];
    await startProject("A landing page for my workshop");
    expect(text()).not.toContain("**");
    expect(host.querySelector(".vs-md strong")?.textContent).toBe("The structure:");
    expect(host.querySelectorAll(".vs-md li")).toHaveLength(2);
  });

  it("an unnamed project shows what was asked for, and takes the name of the first piece Paige saves", async () => {
    h.openTitle = "Untitled project";
    h.sse = [
      JSON.stringify({ paige_artifact: { kind: "form", id: "f-1", title: "New client intake" } }),
      JSON.stringify({ choices: [{ delta: { content: "Done." } }] }),
      "[DONE]",
    ];
    await startProject("An intake form for new clients");
    expect(h.renamed).toEqual([["s-new", "New client intake"]]);
    expect(host.querySelector(".vs-crumbs b")?.textContent).toBe("New client intake");
  });
});
