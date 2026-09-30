/**
 * Renders the REAL `PaigeConfirmCard` in every state and writes a standalone page, so the owner
 * can SEE the design rather than read a description of it (§00). Run via vitest; the page is
 * screenshotted by `scripts/shoot-confirm-card.mjs`.
 *
 * PROOF CLASS, stated so it is never over-read: this is a RENDERED HARNESS of the real component
 * with the real compiled tokens. It is NOT an authenticated runtime drive of Solo — that is owed.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { describe, it } from "vitest";
import { existsSync } from "node:fs";

import { PaigeConfirmCard, type ConfirmAction } from "@/components/chat/PaigeConfirmCard";

const FP = "a1b2c3d4e5f60718:3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const FP2 = "b7c8d9e0f1a2b3c4:4f2504e0-4f89-11d3-9a0c-0305e82c3302";

const SCENES: Array<{ label: string; note: string; actions: ConfirmAction[]; hint?: string }> = [
  {
    label: "One action, ready to approve",
    note: "The ordinary case. Gold is spent on the act and nowhere else.",
    actions: [{ summary: "Add John Coleman to your contacts", fingerprint: FP }],
  },
  {
    label: "A batch",
    note: "Each action is listed. Approve covers exactly the ones it names.",
    actions: [
      { summary: "Add John Coleman to your contacts", fingerprint: FP },
      { summary: "Create a deal for Coleman Consulting at $4,500", fingerprint: FP2 },
    ],
  },
  {
    label: "Running",
    note: "The card holds its ground while the server works, instead of disappearing.",
    actions: [{ summary: "Send the research email to Lavelle", fingerprint: FP, state: "working" }],
  },
  {
    label: "Done",
    note: "It reports the outcome. No second approval is offered on a settled action.",
    actions: [{ summary: "Add John Coleman to your contacts", fingerprint: FP, state: "done" }],
  },
  {
    label: "Didn't run",
    note: "The failure names its reason, rather than a silent disappearance.",
    actions: [{
      summary: "Send the agreement to Tashia",
      fingerprint: FP,
      state: "failed",
      note: "The sending domain isn't verified yet.",
    }],
  },
  {
    label: "Nothing behind it — the defect, now impossible",
    note: "No fingerprint means NO approve control. This is the button that used to lie.",
    actions: [{ summary: "Send the research email to Lavelle" }],
    hint: "Open Paige in your workspace to approve this.",
  },
  {
    label: "A mixed batch",
    note: "Approves what it can bind, and says plainly what it can't.",
    actions: [
      { summary: "Add John Coleman to your contacts", fingerprint: FP },
      { summary: "Email the offer letter", },
    ],
  },
];

function mainCss(): string {
  const dir = "dist/assets";
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  // The Solo entry carries the console token redefinitions; main carries the base theme.
  const pick = [files.find((f) => f.startsWith("main-")), files.find((f) => f.startsWith("SoloEntry-"))]
    .filter(Boolean) as string[];
  return pick.map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");
}

describe("confirm card render harness", () => {
  // The page embeds the COMPILED tokens, so it needs a build. CI runs tests without one; skip
  // rather than fail, because this harness is a viewing aid, not a correctness gate.
  it.skipIf(!existsSync("dist/assets"))("writes the page", () => {
    const cards = SCENES.map((s) => {
      // renderToStaticMarkup exercises the same component the app ships.
      const html = renderToStaticMarkup(
        <PaigeConfirmCard
          actions={s.actions}
          onApprove={() => {}}
          onDeny={() => {}}
          cannotApproveHere={s.hint}
        />,
      );
      return `<section class="scene">
        <h2>${s.label}</h2>
        <p>${s.note}</p>
        <div class="stage">${html}</div>
      </section>`;
    }).join("\n");

    const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Approval card</title>
<style>${mainCss()}</style>
<style>
  body { margin:0; background: hsl(var(--background)); color: hsl(var(--foreground));
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 40px 24px 64px; }
  h1 { font-size: 24px; letter-spacing: -0.03em; margin: 0 0 4px; }
  .lede { color: hsl(var(--muted-foreground)); font-size: 14px; margin: 0 0 32px; line-height: 1.6; }
  .scene { margin-bottom: 30px; }
  .scene h2 { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 2px; }
  .scene p { font-size: 12.5px; color: hsl(var(--muted-foreground)); margin: 0 0 10px; line-height: 1.5; }
  .stage { border: 1px dashed hsl(var(--border)); border-radius: 14px; padding: 14px 16px 18px;
           background: hsl(var(--card)); }
</style></head>
<body><div class="wrap">
<h1>Needs your OK</h1>
<p class="lede">The approval card, in every state it can reach. An action with no binding behind it
renders no Approve button at all &mdash; that is the change.</p>
${cards}
</div></body></html>`;

    mkdirSync("docs/evidence/ui-delivery/solo-approval-executes", { recursive: true });
    writeFileSync("docs/evidence/ui-delivery/solo-approval-executes/confirm-card.html", page, "utf8");

    // Also mount it once for real, so a render-time throw fails this harness rather than
    // surfacing later as a blank card (§32 — a green build is not a working render).
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <>{SCENES.map((s, i) => (
          <PaigeConfirmCard key={i} actions={s.actions} onApprove={() => {}} onDeny={() => {}} cannotApproveHere={s.hint} />
        ))}</>,
      );
    });
    act(() => { root.unmount(); });
    host.remove();
  });
});
