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
