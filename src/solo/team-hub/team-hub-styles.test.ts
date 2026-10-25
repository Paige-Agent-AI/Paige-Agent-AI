/**
 * Static checks on the Team Hub stylesheet: the layout rules a jsdom render cannot see. They read
 * the CSS text; the rendered evidence (docs/evidence/ui-delivery/exp08-team-hub-increment1.md) is
 * where the layout is actually looked at.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "team-hub.css"), "utf8");
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[}\\s])${escaped}\\{([^}]*)\\}`, "m").exec(css)?.[1] ?? "";
};

describe("Team Hub stylesheet", () => {
  it("lays out by the hub's own width (container queries), never the viewport width", () => {
    // Inline-size only: a size container collapses where its host's height is not definite.
    expect(rule(".th-hub")).toContain("container:th-hub / inline-size");
    expect(css).not.toMatch(/@media[^{]*(?:max|min)-width/);
    expect(css).toContain("@container th-hub (max-width:1149.98px)");
    expect(css).toContain("@container th-hub (max-width:759.98px)");
  });

  it("gives Retry, Delete, notice actions and reply counts a 40px target", () => {
    for (const selector of [".th-fail button", ".th-notice button", ".th-replies"]) {
      expect(rule(selector), selector).toMatch(/min-height:40px/);
    }
  });

  it("keeps its element reset at zero specificity so component colours (gold act, muted rows) apply", () => {
    expect(css).toContain(":where(.th-hub) :where(button,input,textarea){font:inherit;color:inherit}");
    expect(css).not.toMatch(/(?:^|[},\s])\.th-hub button/m);
  });

  it("spends gold only on the act, with the env tone on dark and ink on light", () => {
    expect(rule(".th-btn--act")).toContain("color:var(--pg-env)");
    expect(css).toContain('[data-pg="light"] .th-btn--act{color:var(--pg-ink)}');
    expect(css).not.toContain("accent-foreground");
    expect(css.match(/gold-fill/g)).toHaveLength(1);
  });

  it("marks a pressed visibility toggle with the same violet dot as a pressed chip, not colour alone", () => {
    expect(css).toContain('.th-chip[aria-pressed="true"]::before,.th-seg button[aria-pressed="true"]::after{content:"";width:6px;height:6px;flex:none;border-radius:50%;background:var(--pg-violet)}');
  });
});

describe("Team Hub stylesheet: increment 3 rendered-evidence fixes", () => {
  it("drops the Download word on a narrow file list and keeps a 40x40 icon button there, by the list's own width", () => {
    expect(rule(".th-files")).toContain("container:th-files / inline-size");
    const narrow = /@container th-files \(max-width:399\.98px\)\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(narrow).toContain(".th-file-dl{width:40px;min-width:40px;padding:0}");
    expect(narrow).toContain(".th-file-dl-label{display:none}");
    expect(rule(".th-file-size")).toContain("white-space:nowrap");
    expect(rule(".th-file-name")).toBe("");
    expect(css).toMatch(/\.th-att-name,\.th-file-name\{overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
  });

  it("caps the chip tray against the screen height and lets it scroll, so Send stays on screen", () => {
    expect(rule(".th-hub")).not.toContain("/ size");
    const tray = rule(".th-att-list");
    expect(tray).toMatch(/max-height:max\(73px,min\(125px,30dvh\)\)/);
    expect(tray).toContain("round(down,30dvh - 21px,52px)");
    expect(tray).toContain("overflow-y:auto");
    // The inset keeps a focused chip's ring inside the scroller.
    expect(tray).toContain("padding:3px");
    expect(tray).toContain("scroll-padding-block:3px");
  });

  it("wraps every stream row in one observed box without changing the rows' own layout", () => {
    expect(css).toContain(".th-stream > div,.th-stream-content > div{display:flex;flex-direction:column;gap:2px}");
    expect(rule(".th-stream-content")).toContain("flex:1 0 auto");
  });

  it("colours a failed chip with the warning token and a refused chip with the negative (destructive) token, never gold", () => {
    const failed = rule('.th-att[data-state="failed"]');
    const refused = rule('.th-att[data-state="refused"]');
    expect(failed).toContain("var(--pg-warning)");
    expect(refused).toContain("var(--pg-negative)");
    for (const declaration of [failed, refused]) expect(declaration).not.toMatch(/gold/);
  });
});
