/**
 * Vibe Studio project workspace (layout C) — rendered behaviour.
 *
 * EVIDENCE CLASS (§32/§70.1): a HARNESS drive in jsdom. The data layer's reads (studio-data) and
 * the media hook are in-memory doubles; the chat stream is a scripted SSE body served by a stubbed
 * fetch, parsed by the real useStudioChat. Publishing runs the REAL studio-data door calls
 * (preparePublication / confirmPublication) against a stubbed `functions.invoke` that answers in
 * the growth-publish-command contract. It proves the workspace wires the owner's acts to the right
 * seams and renders what the stream, the reads and the door return. It is NOT authenticated runtime
 * proof that paige-ai-chat or the publish door accept these calls in production.
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
  // The publish door: every invoke is recorded; `door` answers each body.
  doorCalls: [] as Rec[],
  door: null as ((body: Rec, n: number) => { data: unknown; error: unknown }) | null,
  sse: [] as string[],
  status: 200,
  fetchBodies: [] as Rec[],
  versionReads: 0,
  content: null as Rec | null,
  funnel: null as Rec | null,
  openTitle: "Client intake",
  renamed: [] as Array<[string, string]>,
  held: [] as Array<{ tool: string; summary: string; fingerprint: string }>,
  openBrief: "An intake form for new clients",
}));

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "t-synthetic", activeTenant: { slug: "northwind-studio" } }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-token" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    // No `rpc` here on purpose: a publish that bypassed the door would throw.
    functions: {
      invoke: async (fn: string, opts: { body: Rec }) => {
        if (fn !== "growth-publish-command") throw new Error(`unexpected function ${fn}`);
        h.doorCalls.push(opts.body);
        if (!h.door) throw new Error("no door double");
        return h.door(opts.body, h.doorCalls.length);
      },
    },
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
    openSession: async (id: string) => session(id, h.openTitle, h.openBrief),
    loadHeldConfirms: async () => h.held,
    renameSession: async (id: string, title: string) => { h.renamed.push([id, title]); h.openTitle = title; },
    ensureThread: async () => "th-1",
    loadTurns: async () => [],
    loadBrand: async () => ({ floor: {}, name: "Northwind Studio", logoUrl: null }),
    loadForm: async () => { if (!h.form) throw new Error("missing"); return h.form; },
    listVersions: async () => { h.versionReads += 1; return h.versions; },
    loadImage: async () => { if (!h.content) throw new Error("missing"); return h.content; },
    loadFunnel: async () => { if (!h.funnel) throw new Error("missing"); return h.funnel; },
    restoreVersion: async (id: string) => { h.restored.push(id); },
  };
});

// growth-publish-command replies, in its contract. A non-2xx body rides on the error's context.
const ok = (data: unknown) => ({ data, error: null });
const http = (status: number, body: unknown) => ({ data: null, error: { name: "FunctionsHttpError", message: `status ${status}`, context: new Response(JSON.stringify(body), { status }) } });
const CHECKS = [
  { key: "questions", label: "Has 3 questions", ok: true },
  { key: "email", label: "Asks for an email, so each request becomes a contact", ok: true },
];
const ready = (fp = "fp-1", checks: unknown[] = CHECKS) => ok({ approval_required: true, fingerprint: fp, preview: { kind: "form", id: "f-1", title: "New client intake", action: "publish", address: "/form/f-1", checks } });
const published = () => ok({ ok: true, action: "publish", kind: "form", id: "f-1", status: "active", published_at: "2026-10-04T10:00:00Z", url: "/form/f-1" });
/** The happy door: prepare → ready, redeem → published. */
const happyDoor = (body: Rec) => (body.approved_fingerprint ? published() : ready());

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
  Object.assign(h, { sessions: [], created: [], manifest: [], form: null, versions: [], restored: [], doorCalls: [], door: happyDoor, sse: [], status: 200, fetchBodies: [], versionReads: 0, content: null, funnel: null, openTitle: "Client intake", renamed: [], held: [], openBrief: "An intake form for new clients" });
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

  async function openPiece(piece: Rec = FORM) {
    h.manifest = [{ kind: "form", id: "f-1", title: "New client intake" }];
    h.form = piece;
    h.sessions = [{ id: "s-1", title: "Client intake", seedBrief: null, artifacts: h.manifest, updatedAt: "2026-10-03T12:00:00Z" }];
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
  }
  async function openPanel() { await act(async () => { button("Publish")!.click(); }); await flush(); }
  async function press(label: string) { await act(async () => { button(label)!.click(); }); await flush(); }

  it("opening Publish prepares through the door; the click redeems that fingerprint; 'It's live' only with the returned address", async () => {
    await openPiece();
    expect(h.fetchBodies).toHaveLength(0); // reopening a project never re-sends a brief
    await openPanel();
    // One prepare, no fingerprint: opening the panel never executes anything.
    expect(h.doorCalls).toEqual([{ action: "publish", kind: "form", id: "f-1" }]);
    expect(text()).toContain("Ready to go live?");
    // The server's checks, not the browser's.
    expect(text()).toContain("Has 3 questions");
    expect(text()).toContain("Asks for an email");
    expect(text()).toContain(`Goes live at ${window.location.origin}/form/f-1`);
    expect(text()).not.toContain("It's live");
    await press("Publish now");
    expect(h.doorCalls[1]).toEqual({ action: "publish", kind: "form", id: "f-1", approved_fingerprint: "fp-1" });
    expect(h.doorCalls).toHaveLength(2);
    expect(text()).toContain("It's live");
    expect(text()).toContain(`${window.location.origin}/form/f-1`);
  });

  it("while the server checks, Publish waits and says so", async () => {
    let release: (v: unknown) => void = () => {};
    h.door = () => new Promise((r) => { release = r; }) as unknown as { data: unknown; error: unknown };
    await openPiece();
    await openPanel();
    expect(text()).toContain("Paige is checking it against what's saved");
    expect(button("Checking…")!.disabled).toBe(true);
    await act(async () => { release(ready()); });
    await flush();
    expect(button("Publish now")!.disabled).toBe(false);
  });

  it("a check that fails blocks Publish and shows the server's reason", async () => {
    h.door = () => ok({ approval_required: true, preview: { kind: "form", id: "f-1", title: "New client intake", action: "publish", checks: [
      { key: "questions", label: "Has 3 questions", ok: true },
      { key: "placeholders", label: "Still has unfinished text", ok: false, detail: "The thank-you message says [your name]." },
    ] } });
    await openPiece();
    await openPanel();
    expect(text()).toContain("Still has unfinished text");
    expect(text()).toContain("The thank-you message says [your name].");
    expect(text()).toContain("Fix what's marked, or ask Paige to, then publish.");
    expect(button("Publish now")!.disabled).toBe(true);
    expect(h.doorCalls).toHaveLength(1);
  });

  it("publishing switched off in Paige's settings: the panel says so and offers no Publish", async () => {
    h.door = () => http(403, { error: "Publishing is switched off in Paige's settings for this workspace.", disabled: true });
    await openPiece();
    await openPanel();
    expect(text()).toContain("Publishing is switched off");
    expect(text()).toContain("turn it back on in Command Center › Trust Compass");
    // Said once: the heading carries the fact, the body only the way back.
    expect(text().split("switched off").length - 1).toBe(1);
    expect(button("Publish now")).toBeUndefined();
    expect(button("Close")).toBeDefined();
  });

  it("someone who isn't an owner or admin is told so, with no Publish", async () => {
    h.door = () => http(403, { error: "Only the workspace owner or an admin can publish.", forbidden: true });
    await openPiece();
    await openPanel();
    expect(text()).toContain("Only an owner or admin can publish");
    expect(text()).toContain("Ask this workspace's owner to publish it");
    expect(document.activeElement?.textContent).toBe("Close"); // focus never drops to the page
    expect(button("Publish now")).toBeUndefined();
  });

  it("a stale approval is checked again once, and the owner's next click is the new approval", async () => {
    let redeems = 0;
    h.door = (body) => {
      if (!body.approved_fingerprint) return ready(redeems === 0 ? "fp-1" : "fp-2");
      redeems += 1;
      return redeems === 1 ? http(409, { ok: false, refused: true, error: "That approval has expired." }) : published();
    };
    await openPiece();
    await openPanel();
    await press("Publish now");
    // Refused → one fresh prepare, never an automatic retry of the act.
    expect(h.doorCalls.map((c) => c.approved_fingerprint ?? null)).toEqual([null, "fp-1", null]);
    expect(text()).toContain("That approval has expired. Paige checked it again. Press Publish now to go ahead.");
    expect(text()).not.toContain("It's live");
    await press("Publish now");
    expect(h.doorCalls[3]).toMatchObject({ approved_fingerprint: "fp-2" });
    expect(text()).toContain("It's live");
  });

  it("a refusal that holds never leaves a used fingerprint armed: every click redeems a fresh one", async () => {
    let prepares = 0;
    h.door = (body) => {
      if (!body.approved_fingerprint) { prepares += 1; return ready(`fp-${prepares}`); }
      return http(409, { ok: false, refused: true, code: "APPROVAL_NOT_AVAILABLE", error: "GROWTH_PLACEHOLDER: the form still has unfinished text" });
    };
    await openPiece();
    await openPanel();
    await press("Publish now");
    await press("Publish now");
    await press("Publish now");
    expect(text()).toContain("The form still has unfinished text");
    expect(text()).not.toContain("It's live");
    // Each click redeems the fingerprint the refusal's re-prepare just issued — never a spent one —
    // and nothing is redeemed without a click.
    const redeemed = h.doorCalls.filter((c) => c.approved_fingerprint).map((c) => c.approved_fingerprint);
    expect(redeemed).toEqual(["fp-1", "fp-2", "fp-3"]);
    expect(h.doorCalls.map((c) => (c.approved_fingerprint ? "redeem" : "prepare"))).toEqual(["prepare", "redeem", "prepare", "redeem", "prepare", "redeem", "prepare"]);
  });

  it("an optional check that isn't met shows as optional, not as a cross that blocks", async () => {
    h.door = () => ready("fp-1", [
      { key: "has_questions", label: "Has 3 questions", ok: true, blocking: true },
      { key: "alert_email", label: "No alert email", ok: false, blocking: false, detail: "Set one in Form settings." },
      { key: "thank_you", label: "No thank-you message", ok: false, blocking: false, detail: "Visitors see a plain confirmation." },
    ]);
    await openPiece();
    await openPanel();
    const marks = [...host.querySelectorAll(".vs-checks li svg")].map((s) => s.getAttribute("aria-label"));
    expect(marks).toEqual(["Done", "Optional", "Optional"]);
    expect(text()).toContain("No alert email");
    expect(text()).not.toContain("Fix what's marked");
    expect(button("Publish now")!.disabled).toBe(false);
  });

  it("only unpublishing switched off keeps the live view, names unpublishing, and still offers Publish again", async () => {
    h.manifest = [{ kind: "funnel", id: "u-1", title: "Free strategy call" }];
    h.funnel = { id: "u-1", name: "Free strategy call", slug: "free-call", live: true, steps: [] };
    h.door = (body) => (body.action === "unpublish"
      ? http(403, { ok: false, refused: true, disabled: true, code: "autonomy_off", error: "Unpublishing is switched off for this workspace in your autonomy settings. Nothing changed." })
      : ready());
    h.sessions = [{ id: "s-1", title: "Free strategy call", seedBrief: null, artifacts: h.manifest, updatedAt: "2026-10-03T12:00:00Z" }];
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    await act(async () => { button("Live · Manage")!.click(); });
    await flush();
    expect(text()).toContain("This is live");
    expect(text()).toContain("Unpublishing is switched off in your Trust Compass");
    expect(text()).not.toContain("Publishing is switched off");
    expect(button("Unpublish")!.disabled).toBe(true);
    expect(button("Publish again")!.disabled).toBe(false);
  });

  it.each([
    ["NO_WORKSPACE", "Open one of your workspaces first, then try again.", "Open this workspace first"],
    ["OTHER_WORKSPACE", "That isn't the workspace you're signed in to. Nothing changed.", "This piece belongs to another workspace"],
    ["NOT_ADMIN", "Only this workspace's owner or an admin can use the Studio.", "Only an owner or admin can publish"],
  ])("a %s refusal says what is actually wrong", async (code, error, heading) => {
    h.door = () => http(403, { ok: false, refused: true, forbidden: true, code, error });
    await openPiece();
    await openPanel();
    expect(host.querySelector(".vs-pop h2")?.textContent).toBe(heading);
    expect(button("Publish now")).toBeUndefined();
  });

  it.each([
    ["READINESS_UNAVAILABLE", 503, { ok: false, code: "READINESS_UNAVAILABLE", error: "I couldn't check whether it's ready just now. Nothing changed. Try again." }],
    ["APPROVAL_STORE_UNAVAILABLE", 503, { ok: false, code: "APPROVAL_STORE_UNAVAILABLE", error: "I couldn't check that approval just now. Nothing changed." }],
    ["DECISION_RECEIPT_FAILED", 503, { ok: false, code: "DECISION_RECEIPT_FAILED", error: "I couldn't record this decision, so I didn't go ahead. Nothing changed." }],
    ["failed", 500, { ok: false, outcome: "failed", error: "It didn't go live. Nothing changed." }],
  ])("a redeem the door says never ran (%s) says nothing changed, never 'may not be live', and Try again prepares afresh", async (_label, status, body) => {
    let prepares = 0;
    h.door = (b) => {
      if (!b.approved_fingerprint) { prepares += 1; return ready(`fp-${prepares}`); }
      return http(status as number, body);
    };
    await openPiece();
    const readsBefore = h.versionReads;
    await openPanel();
    await press("Publish now");
    expect(text()).toContain("Nothing changed");
    expect(text()).not.toContain("may not be live");
    expect(text()).not.toContain("It's live");
    expect(h.versionReads).toBe(readsBefore + 0); // nothing ran, so nothing to re-read
    // The used fingerprint is disarmed: the act button is gone until the owner asks to try again.
    expect(button("Publish now")).toBeUndefined();
    await press("Try again");
    expect(h.doorCalls.at(-1)).toEqual({ action: "publish", kind: "form", id: "f-1" });
    expect(button("Publish now")!.disabled).toBe(false);
  });

  it("a lost answer (outcome_unknown) is the one redeem failure that may say 'may not be live'", async () => {
    h.door = (b) => (b.approved_fingerprint ? http(503, { ok: false, outcome: "outcome_unknown", error: "The answer never came back, so I can't say whether it changed. Check the project before trying again." }) : ready());
    await openPiece();
    await openPanel();
    await press("Publish now");
    expect(text()).toContain("can't say whether it changed");
    expect(text()).not.toContain("It's live");
    expect(button("Publish now")).toBeUndefined();
    expect(button("Check again")).toBeDefined();
  });

  it("an unverified publish claims nothing and re-reads the piece", async () => {
    h.door = (body) => {
      if (!body.approved_fingerprint) return ready();
      // The server did flip the status, but proved no address.
      h.form = { ...FORM, status: "active", live: true };
      return ok({ ok: false, outcome: "unverified", error: "The publish ran but Paige couldn't confirm a public address, so it may not be live." });
    };
    await openPiece();
    const readsBefore = h.versionReads;
    await openPanel();
    await press("Publish now");
    expect(text()).toContain("couldn't confirm a public address");
    expect(text()).not.toContain("It's live");
    // The re-read says active, but the panel never turns that into "This is live" without an address.
    expect(text()).not.toContain("This is live");
    // The server may have changed state: the piece and its timeline are read again.
    expect(h.versionReads).toBeGreaterThan(readsBefore);
  });

  it("a door 'ok' without an address is never reported as live", async () => {
    h.door = (body) => (body.approved_fingerprint ? ok({ ok: true, action: "publish", kind: "form", id: "f-1", status: "active", url: null }) : ready());
    await openPiece();
    await openPanel();
    await press("Publish now");
    expect(text()).toContain("didn't confirm a public address");
    expect(text()).not.toContain("It's live");
  });

  it("when the door can't be reached, the panel says so and offers to check again", async () => {
    let calls = 0;
    h.door = () => { calls += 1; return calls === 1 ? { data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request" } } : ready(); };
    await openPiece();
    await openPanel();
    expect(text()).toContain("Paige couldn't check this just now");
    await press("Check again");
    expect(button("Publish now")!.disabled).toBe(false);
  });

  it("a live piece prepares its unpublish on open, and a refusal (a funnel uses it) is shown before any click", async () => {
    h.door = () => ok({ approval_required: true, preview: { kind: "form", id: "f-1", title: "New client intake", action: "unpublish", checks: [
      { key: "funnels", label: "A live funnel uses this form", ok: false, detail: "Take “Free strategy call” offline first." },
    ] } });
    await openPiece({ ...FORM, status: "active", live: true });
    await act(async () => { button("Live · Manage")!.click(); });
    await flush();
    expect(h.doorCalls).toEqual([{ action: "unpublish", kind: "form", id: "f-1" }]);
    expect(text()).toContain("This is live");
    expect(text()).toContain("A live funnel uses this form");
    expect(text()).toContain("Take “Free strategy call” offline first.");
    expect(button("Unpublish")!.disabled).toBe(true);
  });

  it("unpublishing asks 'Take it offline?' inline and redeems the prepared fingerprint", async () => {
    h.door = (body) => (body.approved_fingerprint
      ? ok({ ok: true, action: "unpublish", kind: "form", id: "f-1", status: "draft" })
      : ok({ approval_required: true, fingerprint: "fp-out", preview: { kind: "form", id: "f-1", title: "New client intake", action: "unpublish", checks: [] } }));
    await openPiece({ ...FORM, status: "active", live: true });
    await act(async () => { button("Live · Manage")!.click(); });
    await flush();
    await press("Unpublish");
    expect(text()).toContain("Take it offline?");
    expect(h.doorCalls).toHaveLength(1); // already prepared on open
    await press("Take it offline");
    expect(h.doorCalls[1]).toEqual({ action: "unpublish", kind: "form", id: "f-1", approved_fingerprint: "fp-out" });
    expect(text()).toContain("Unpublished. It's back to a draft here in the Studio.");
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

  it("C2: a step under way shows a working glyph in What Paige did, then closes to Done on the same row", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      h.fetchBodies.push(JSON.parse(String(init.body)));
      const enc = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        async start(c) {
          c.enqueue(enc.encode(`data: ${JSON.stringify({ paige_step: { id: "a", label: "Read your brand" } })}\n\n`));
          c.enqueue(enc.encode(`data: ${JSON.stringify({ paige_step: { id: "b", label: "Designing your landing page", status: "running" } })}\n\n`));
          await gate;
          c.enqueue(enc.encode(`data: ${JSON.stringify({ paige_step: { id: "b", label: "Designed your landing page", status: "done" } })}\n\n`));
          c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
        },
      }), { status: 200 });
    }));
    await startProject("A landing page for my workshop");
    const rows = () => Array.from(host.querySelectorAll<HTMLElement>('ol[aria-label="What Paige did"] li'));
    const glyph = (li: HTMLElement) => li.firstElementChild?.getAttribute("aria-label");
    expect(rows().map((li) => [li.dataset.status, glyph(li)])).toEqual([["done", "Done"], ["running", "Working on it"]]);
    // Both glyphs are drawn; studio.css shows the spinner, or the still ring under reduced motion.
    const busy = rows()[1].firstElementChild!;
    expect(busy.classList.contains("vs-step-busy")).toBe(true);
    expect([busy.querySelector(".vs-step-spin"), busy.querySelector(".vs-step-still")].every(Boolean)).toBe(true);
    // The step under way is never listed as done on the stage either.
    expect(host.querySelector(".vs-build-now")?.textContent).toBe("Designing your landing page");
    await act(async () => { release(); });
    await flush();
    expect(rows().map((li) => [li.dataset.status, glyph(li), li.textContent?.includes("Designed your landing page")]))
      .toEqual([["done", "Done", false], ["done", "Done", true]]);
  });

  it("C2: the stage's Done so far never lists a step still under way", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      h.fetchBodies.push(JSON.parse(String(init.body)));
      const enc = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        async start(c) {
          c.enqueue(enc.encode(`data: ${JSON.stringify({ paige_step: { id: "a", label: "Checking your brand", status: "running" } })}\n\n`));
          c.enqueue(enc.encode(`data: ${JSON.stringify({ paige_step: { id: "b", label: "Read the brief" } })}\n\n`));
          c.enqueue(enc.encode(`data: ${JSON.stringify({ paige_step: { id: "c", label: "Designing your landing page" } })}\n\n`));
          await gate;
          c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
        },
      }), { status: 200 });
    }));
    await startProject("A landing page for my workshop");
    const done = Array.from(host.querySelectorAll(".vs-build-done li")).map((li) => li.textContent);
    expect(done).toEqual(["Read the brief"]);
    await act(async () => { release(); });
    await flush();
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

  it("declining sends exactly that fingerprint as declined, and the card says it was skipped", async () => {
    h.sse = [JSON.stringify({ paige_confirm: { tool: "growth_page_save", summary: "Save the page draft", fingerprint: "0123456789abcdef" } }), "[DONE]"];
    await startProject("A landing page for my workshop");
    h.sse = [JSON.stringify({ choices: [{ delta: { content: "Okay, left it." } }] }), "[DONE]"];
    await act(async () => { button("Not this")!.click(); });
    await flush();
    expect(h.fetchBodies.at(-1)).toMatchObject({ declinedConfirmations: ["0123456789abcdef"] });
    expect(h.fetchBodies.at(-1)).not.toHaveProperty("approvedConfirmations");
    expect(text()).toContain("Skipped");
  });

  it("an approval settles on the server's own outcome, not on Paige's words", async () => {
    h.sse = [JSON.stringify({ paige_confirm: { tool: "growth_page_save", summary: "Save the page draft", fingerprint: "0123456789abcdef" } }), "[DONE]"];
    await startProject("A landing page for my workshop");
    h.sse = [
      JSON.stringify({ paige_approval_outcome: { actions: [{ fingerprint: "0123456789abcdef", outcome: "not_run" }], note: "That approval had expired. Ask Paige again." } }),
      JSON.stringify({ choices: [{ delta: { content: "All saved!" } }] }),
      "[DONE]",
    ];
    await act(async () => { button("Approve")!.click(); });
    await flush();
    expect(text()).toContain("Didn't run");
    expect(text()).toContain("That approval had expired. Ask Paige again.");
  });

  it("a failed Approve puts the card back so it can still be approved", async () => {
    h.sse = [JSON.stringify({ paige_confirm: { tool: "growth_page_save", summary: "Save the page draft", fingerprint: "0123456789abcdef" } }), "[DONE]"];
    await startProject("A landing page for my workshop");
    h.status = 500;
    await act(async () => { button("Approve")!.click(); });
    await flush();
    expect(text()).toContain("Paige couldn't take that just now");
    expect(button("Approve")).toBeTruthy();
    expect(text()).toContain("Waiting for your approval");
  });

  it("an approval still waiting when the project is reopened comes back", async () => {
    h.manifest = [];
    h.held = [{ tool: "growth_page_save", summary: "Save the page draft “Workshop”", fingerprint: "0123456789abcdef" }];
    h.sessions = [{ id: "s-1", title: "Workshop", seedBrief: null, artifacts: [], thumbnailUrl: null, updatedAt: "2026-10-03T12:00:00Z" }];
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(text()).toContain("Save the page draft “Workshop”");
    expect(button("Approve")).toBeTruthy();
  });

  it("a project started from Studio home (titled with its brief) is renamed to its first piece", async () => {
    h.openTitle = "An intake form for new clients";
    h.openBrief = "An intake form for new clients";
    h.sse = [JSON.stringify({ paige_artifact: { kind: "form", id: "f-1", title: "New client intake" } }), "[DONE]"];
    await startProject("An intake form for new clients");
    expect(h.renamed).toEqual([["s-new", "New client intake"]]);
  });

  it("a redesign that was not saved shows over the saved piece, marked not saved", async () => {
    h.manifest = [{ kind: "form", id: "f-1", title: "New client intake" }];
    h.form = FORM;
    h.sessions = [{ id: "s-1", title: "Client intake", seedBrief: null, artifacts: h.manifest, thumbnailUrl: null, updatedAt: "2026-10-03T12:00:00Z" }];
    await mount();
    await act(async () => { [...host.querySelectorAll(".vs-card")][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    h.sse = [JSON.stringify({ paige_preview: { kind: "page", title: "Workshop", blocks: [{ type: "hero", title: "Hi" }], theme: null } }), "[DONE]"];
    type(host.querySelector<HTMLTextAreaElement>("#vs-chat-input")!, "Make me a page for this");
    await act(async () => { host.querySelector<HTMLButtonElement>("button[aria-label='Send']")!.click(); });
    await flush();
    expect(text()).toContain("Designed, not saved yet.");
  });
});
