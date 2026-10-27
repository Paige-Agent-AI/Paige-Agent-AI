import * as React from "react";
import { createRoot } from "react-dom/client";
import { VibeStudio } from "@/solo/vibe";
import { DomainGuidanceCard } from "@/solo/studio/DomainGuidanceCard";
import { SharingPreviewLine } from "@/solo/studio/PublishPanel";
import { applyPublishedSeo } from "@/lib/growth/seo";
import "@/index.css";
import "@/solo/solo-tokens.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";

// Structural harness: the real Vibe Studio over the shell's own chrome (the Studio is a full-screen
// overlay, so the PAIGE dock sits under it). `?theme=light|dark`, `?paige=open|closed`,
// `?approval=1`, `?nexus=1` (threads a stub openPaige so the Plan/Review-with-NEXUS handoff is
// drivable; the prefill event and the open/close marks are recorded on window). The chat stream is
// a scripted SSE body. NOT the live app.
const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const paige = params.get("paige") === "open" ? "open" : "closed";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-theme", theme);

// ?stream=default | build (holds after the first page step) | preview (designed, held for approval)
//   | lifecycle (a step opens "running", waits for window.__releaseStep(), then closes "done" on the same id)
const mode = params.get("stream") ?? "default";
let releaseStep: () => void = () => {};
const stepGate = new Promise<void>((r) => { releaseStep = r; });
(window as unknown as { __releaseStep: () => void }).__releaseStep = () => releaseStep();
const frames: Array<Record<string, unknown> | "HOLD" | "GATE"> =
  mode === "lifecycle" ? [
    { paige_step: { id: "a", label: "Read your form", detail: "6 questions, routed to Sales" } },
    { paige_step: { id: "b", label: "Adding a budget question", status: "running" } },
    "GATE",
    { paige_step: { id: "b", label: "Added a budget question", detail: "After the goal question", status: "done" } },
    { choices: [{ delta: { content: "Added “What's your budget for this?” after the goal question. It's saved as a draft change; publish when you're ready." } }] },
  ]
  : mode === "build" ? [{ paige_step: { id: "a", label: "Designing your landing page" } }, "HOLD"]
  : mode === "start" ? ["HOLD"]
  : mode === "preview" ? [
    { paige_step: { id: "a", label: "Designing your landing page" } },
    { paige_preview: { kind: "page", title: "Referral workshop", theme: null, blocks: [
      { type: "hero", eyebrow: "Live workshop · Nov 14", title: "Turn your next ten clients into a referral engine", subtitle: "Ninety minutes, one plan you can run on Monday.", cta_label: "Save my seat", cta_href: "#form" },
      { type: "feature_grid", title: "What you'll leave with", items: [{ title: "A referral ask that lands", body: "The exact words, timed to the moment a client is happiest." }, { title: "A follow-up rhythm", body: "Three touches that keep you top of mind." }, { title: "A simple scorecard", body: "Know which clients refer, and why." }] },
    ] } },
    { paige_confirm: { tool: "growth_page_save", summary: "Save the page draft “Referral workshop”", fingerprint: "0123456789abcdef" } },
    { choices: [{ delta: { content: "Your workshop page is designed. **It's waiting on your approval to save** — approve it and it lands in this project." } }] },
  ]
  : [
    { paige_step: { id: "a", label: "Read your form", detail: "6 questions, routed to Sales" } },
    { paige_step: { id: "b", label: "Added a budget question" } },
    { paige_step: { id: "c", label: "Saved the working copy", detail: "Visitors see it after you publish" } },
    { paige_artifact: { kind: "form", id: "f-1", title: "New client intake" } },
    { choices: [{ delta: { content: "Added “What's your budget for this?” after the goal question. It's saved as a draft change; publish when you're ready." } }] },
  ];
const realFetch = window.fetch.bind(window);
// EXP07 row 1: every chat request body is recorded so a drive can assert exactly what Paige was
// sent (the composed brief is the first message) — the fetch never reaches the network.
declare global { interface Window { __chatBodies: Array<Record<string, unknown>> } }
window.__chatBodies = [];
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/functions/v1/paige-ai-chat")) {
    try { window.__chatBodies.push(JSON.parse(String(init?.body ?? "{}"))); } catch { /* keep the stream even if a body isn't JSON */ }
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        for (const f of frames) {
          if (f === "HOLD") { await new Promise(() => {}); }
          if (f === "GATE") { await stepGate; continue; }
          c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`)); await new Promise((r) => setTimeout(r, 60));
        }
        c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
      },
    });
    return new Response(body, { status: 200 });
  }
  return realFetch(input, init);
};

function Harness() {
  // ?nexus=1: the EXP06 NEXUS handoff, drivable without the real shell. A stub openPaige marks
  // window.__nexusOpen, and every paige:prefill the seam dispatches is captured on
  // window.__nexusHandoffs — the harness never mounts PAIGE's composer, so the prefill stays
  // visible as "handed off, not sent".
  const nexus = params.get("nexus") === "1";
  // ?domain=1|conflict: the EXP06 PR7 domain-guidance disclosure, inside the same live-view pop
  // the publish panel uses — "conflict" feeds the overridden observation so the truth-when-blocked
  // state is framed too. The pop renders inside a REAL .vs-studio root exactly as in the product:
  // the Studio is a full-screen fixed overlay (z-index 80) that sits over the shell and the PAIGE
  // dock, and the pop anchors at its true geometry (absolute, top 50px / right 12px / width 360px
  // — no inline overrides). ?paige=open|closed still toggles the dock in the shell beneath, so a
  // drive can PROVE the panel's geometry is invariant to the dock state instead of asserting it.
  // ?seo=1: the EXP06 PR8 sharing-truth surfaces, exercisable in a real browser. The REAL
  // applyPublishedSeo runs against the REAL document (title + meta tags land in this page's own
  // head, and the drive asserts them from the DOM), beside the REAL SharingPreviewLine the
  // publish panel mounts — so the head behavior and the owner-visible line are both proven in
  // a browser, not only at jsdom level. NOT the live app.
  const seo = params.get("seo");
  if (seo) {
    const applied = applyPublishedSeo(document, {
      title: "Referral Workshop",
      description: "Ninety minutes to a Monday-ready referral plan.",
      ogImage: "https://media.example.com/og/workshop.png",
      canonicalUrl: window.location.href,
    });
    const meta = (attr: string, key: string) => document.head.querySelector(`meta[${attr}="${key}"]`)?.getAttribute("content") ?? "(absent)";
    return (
      <div className="vs-studio" style={{ padding: "48px 16px", display: "flex", justifyContent: "center", alignItems: "flex-start", minHeight: "100dvh" }}>
        <div className="vs-pop" role="dialog" aria-label="Put your changes live" style={{ maxWidth: 560, width: "100%" }}>
          <h2>Ready to go live?</h2>
          <p>It gets a public link and moves to Marketing › Overview.</p>
          <p className="vs-pop-address">Goes live at <b>https://acme-coaching.paigeagent.ai/p/acme-coaching/workshop</b></p>
          <SharingPreviewLine title="Referral Workshop" draftSeo={{ description: "Ninety minutes to a Monday-ready referral plan." }} />
          <div className="vs-seo-preview" data-harness-seo-applied="1" style={{ marginTop: 10 }}>
            <p className="vs-seo-line"><strong>Applied to this page's own head by the real module:</strong></p>
            <ul className="vs-domain-hostpath" style={{ marginTop: 6 }}>
              <li className="vs-domain-note">document.title = “{applied.title}”</li>
              <li className="vs-domain-note">meta[name=description] = “{meta("name", "description")}”</li>
              <li className="vs-domain-note">meta[property=og:image] = “{meta("property", "og:image")}”</li>
              <li className="vs-domain-note">meta[property=og:url] = “{meta("property", "og:url")}”</li>
            </ul>
          </div>
          <div className="vs-pop-foot"><button type="button" className="vs-btn">Not yet</button></div>
        </div>
      </div>
    );
  }
  const domain = params.get("domain");
  if (domain) {
    return (
      <div data-tenant-shell data-nav="expanded" data-paige={paige}>
        <nav className="tcs-nav" />
        <section className="tcs-canvas">
          <header className="tcs-command-row"><div className="tcs-context"><span>Campaigns · structural harness</span></div></header>
          <main id="tenant-shell-main" className="tcs-main paige-solo" data-theme={theme} />
        </section>
        <aside className="tcs-paige" hidden={paige !== "open"} aria-label="PAIGE dock (harness placeholder)"><div className="tcs-paige-header"><span style={{ color: "var(--pg-ink)" }}>PAIGE</span></div></aside>
        <div className="vs-studio">
          <div className="vs-pop" role="dialog" aria-label="It's live">
            <h2>It's live</h2>
            <p>Anyone with the link can open it, and it's in Marketing › Overview.</p>
            <a className="vs-link" href="#" onClick={(e) => e.preventDefault()} style={{ wordBreak: "break-all" }}>https://acme-coaching.paigeagent.ai/p/acme-coaching/workshop</a>
            <DomainGuidanceCard
              tenantSlug="acme-coaching"
              observations={domain === "conflict" ? { customDomain: "www.acme-coaching.com", recordConflict: true } : undefined}
            />
            <div className="vs-pop-foot"><button type="button" className="vs-btn">Done</button></div>
          </div>
        </div>
      </div>
    );
  }
  if (nexus && !(window as unknown as { __nexusArmed?: boolean }).__nexusArmed) {
    (window as unknown as { __nexusArmed?: boolean }).__nexusArmed = true;
    (window as unknown as { __nexusHandoffs: string[] }).__nexusHandoffs = [];
    window.addEventListener("paige:prefill", ((e: CustomEvent<{ prompt: string }>) => {
      (window as unknown as { __nexusHandoffs: string[] }).__nexusHandoffs.push(e.detail.prompt);
    }) as EventListener);
  }
  return (
    <div data-tenant-shell data-nav="expanded" data-paige={paige}>
      <nav className="tcs-nav" />
      <section className="tcs-canvas">
        <header className="tcs-command-row"><div className="tcs-context"><span>Campaigns · structural harness</span></div></header>
        <main id="tenant-shell-main" className="tcs-main paige-solo" data-theme={theme}>
          <VibeStudio onBack={() => { (window as unknown as { __closed: number }).__closed = 1; }} openPaige={nexus ? () => { (window as unknown as { __nexusOpen: number }).__nexusOpen = 1; } : undefined} />
        </main>
      </section>
      <aside className="tcs-paige" hidden={paige !== "open"} aria-label="PAIGE dock (harness placeholder)"><div className="tcs-paige-header"><span style={{ color: "var(--pg-ink)" }}>PAIGE</span></div></aside>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
