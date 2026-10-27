// The shared outline and ghost buttons hover to the THEME's muted surface with ink text (owner instruction,
// 2026-10-27: "Yes", answering "Want me to fix it everywhere?"). They used to hover to --secondary, which is
// defined only in :root as dark navy (264 40% 11%) and redefined by no theme scope, so in light every outline
// and ghost button went dark under its own dark text (measured 1.11:1 under the pointer).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Button, buttonVariants } from "./button";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const classes = (v: "outline" | "ghost") => buttonVariants({ variant: v }).split(/\s+/);

describe("outline and ghost hover", () => {
  it.each(["outline", "ghost"] as const)("%s hovers to the muted surface with ink text, never --secondary", (v) => {
    const c = classes(v);
    expect(c).toContain("hover:bg-muted");
    expect(c).toContain("hover:text-foreground");
    expect(c).not.toContain("hover:bg-secondary");
  });
  it("outline keeps its border hint and ghost keeps its lift", () => {
    expect(classes("outline")).toContain("hover:border-primary/40");
    expect(classes("ghost")).toContain("hover:shadow-sm");
  });
  it("the secondary variant itself is unchanged (it paints --secondary with its own foreground)", () => {
    expect(classes("secondary")).toEqual(expect.arrayContaining(["bg-secondary", "text-secondary-foreground", "hover:bg-secondary/80"]));
  });
  it("a consumer's own hover colours still win over the variant's (tailwind-merge)", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Button variant="outline" className="text-accent hover:bg-accent/10 hover:text-accent">Go</Button>));
    const c = host.querySelector("button")!.className.split(/\s+/);
    expect(c).toContain("hover:text-accent");
    expect(c).not.toContain("hover:text-foreground");
    expect(c).toContain("hover:bg-accent/10");
    expect(c).not.toContain("hover:bg-muted");
    act(() => root.unmount());
  });
  it("no consumer still forces the old navy-invert text (white on the new light hover)", () => {
    const leadReply = readFileSync(resolve("src/pages/admin/conversations/LeadReplyDrafts.tsx"), "utf8");
    expect(leadReply).not.toContain("hover:text-secondary-foreground");
  });
  // BusinessCreditDashboard's Sync button is left untouched in this change: the file carries a pre-existing
  // gold-discipline violation the changed-file lint would flag, so its hover text goes to ink (still AA on
  // its own light gold tint) rather than staying gold.
  it("consumers that tint their own hover keep their own text colour under the pointer", () => {
    for (const [file, cls] of [
      ["src/components/affiliates/AffiliateApplicationsTab.tsx", "text-red-600 hover:bg-red-50 hover:text-red-600"],
      ["src/components/credit/CreditFileHealthAssessment.tsx", "text-accent hover:bg-accent/10 hover:text-accent"],
      ["src/components/paige/PaigeSidebar.tsx", "text-accent hover:bg-accent/10 hover:text-accent"],
      ["src/components/paige/PaigeWorkspace.tsx", "text-accent hover:bg-accent/10 hover:text-accent"],
    ]) expect(readFileSync(resolve(file), "utf8")).toContain(cls);
  });
  it("--muted is defined in every theme scope; --secondary only in :root", () => {
    const css = readFileSync(resolve("src/index.css"), "utf8");
    expect(css.match(/--secondary:/g)).toHaveLength(1);
    for (const scope of [/\[data-pg="light"\]\s*\{[^}]*--muted:/s, /\[data-pg="dark"\]\s*\{[^}]*--muted:/s, /\.dark\s*\{[^}]*--muted:/s]) expect(css).toMatch(scope);
  });
});
