import * as React from "react";
import { createRoot } from "react-dom/client";
import { VibeStudio } from "@/solo/vibe";
import "@/index.css";
import "@/solo/solo-tokens.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";

// Structural harness: the real Vibe Studio over the shell's own chrome (the Studio is a full-screen
// overlay, so the PAIGE dock sits under it). `?theme=light|dark`, `?paige=open|closed`,
// `?approval=1`. The chat stream is a scripted SSE body. NOT the live app.
const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const paige = params.get("paige") === "open" ? "open" : "closed";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-theme", theme);

const frames = [
  { paige_step: { id: "a", label: "Read your form", detail: "6 questions, routed to Sales" } },
  { paige_step: { id: "b", label: "Added a budget question" } },
  { paige_step: { id: "c", label: "Saved the working copy", detail: "Visitors see it after you publish" } },
  { paige_artifact: { kind: "form", id: "f-1", title: "New client intake" } },
  { choices: [{ delta: { content: "Added “What's your budget for this?” after the goal question. It's saved as a draft change; publish when you're ready." } }] },
];
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/functions/v1/paige-ai-chat")) {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        for (const f of frames) { c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`)); await new Promise((r) => setTimeout(r, 60)); }
        c.enqueue(enc.encode("data: [DONE]\n\n")); c.close();
      },
    });
    return new Response(body, { status: 200 });
  }
  return realFetch(input, init);
};

function Harness() {
  return (
    <div data-tenant-shell data-nav="expanded" data-paige={paige}>
      <nav className="tcs-nav" />
      <section className="tcs-canvas">
        <header className="tcs-command-row"><div className="tcs-context"><span>Campaigns · structural harness</span></div></header>
        <main id="tenant-shell-main" className="tcs-main paige-solo" data-theme={theme}>
          <VibeStudio onBack={() => { (window as unknown as { __closed: number }).__closed = 1; }} />
        </main>
      </section>
      <aside className="tcs-paige" hidden={paige !== "open"} aria-label="PAIGE dock (harness placeholder)"><div className="tcs-paige-header"><span style={{ color: "var(--pg-ink)" }}>PAIGE</span></div></aside>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
