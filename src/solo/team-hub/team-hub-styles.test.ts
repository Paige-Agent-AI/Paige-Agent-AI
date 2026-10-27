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

describe("Team Hub stylesheet: agents (A1b, approved v5 colour rules)", () => {
  it("maps each of the seven agents to its own shared tokens, and paints identity only through them", () => {
    for (const agent of ["paige", "vera", "nexus", "cura", "mentor", "merit", "zion"]) {
      expect(rule(`[data-ag="${agent}"]`)).toBe(`--agc-fill:var(--pg-agent-${agent}-fill);--agc-tint:var(--pg-agent-${agent}-tint);--agc-ink:var(--pg-agent-${agent}-ink);--agc-ring:var(--pg-agent-${agent}-ring)`);
    }
    // No hex in an agent rule: every colour is a token.
    const agentRules = css.slice(css.indexOf("EXP08 Team Hub agents (A1b)"));
    expect(agentRules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("keeps @mention chips at tint strength (one message can hold four) and the plate on tint with a ring", () => {
    expect(rule(".th-mention.th-ag-chip")).toContain("background:var(--agc-tint)");
    expect(rule(".th-mention.th-ag-chip")).not.toContain("--agc-fill");
    expect(rule(".th-ag-plate")).toContain("background:var(--agc-tint);color:var(--agc-ink);box-shadow:inset 0 0 0 1px var(--agc-ring)");
  });

  it("never gives a status mark an agent colour: status dots keep the system colours", () => {
    for (const status of ["open", "in_progress", "blocked", "done"]) expect(rule(`.th-state[data-status="${status}"]::before`)).not.toContain("--agc");
    expect(css).not.toMatch(/\.th-state[^{]*\{[^}]*--agc/);
    expect(rule(".th-hub .th-ag-fail svg")).toContain("color:var(--pg-warning)");
    // The private part that couldn't finish is a status too: its mark is warning, not the agent's ink.
    expect(rule(".th-hub .th-ag-priv--failed>svg")).toBe("color:var(--pg-warning)");
  });

  it("spends no gold on any agent element (PAIGE's gold is her tint and ring tokens), and Say hello to PAIGE is ink", () => {
    const agentRules = css.slice(css.indexOf("EXP08 Team Hub agents (A1b)"));
    expect(agentRules).not.toMatch(/--pg-gold/);
    expect(rule(".th-btn--primary")).toContain("background:var(--pg-ink)");
  });

  it("never lets the composer row's one-line hint widen the composer past a narrow hub (390 phone overflow, A1b rendered pass)", () => {
    expect(rule(".th-composer-wrap")).toContain("grid-template-columns:minmax(0,1fr)");
  });

  it("lays the writing row and the failure row out as rows even as direct children of the stream (the A1b rendered pass found the stream's column rule centring them)", () => {
    expect(css).toMatch(/\.th-ag-typing,\.th-stream-content > \.th-ag-typing\{display:grid;grid-template-columns:32px minmax\(0,1fr\)/);
    expect(css).toMatch(/\.th-ag-fail,\.th-stream-content > \.th-ag-fail\{display:flex;flex-direction:row/);
  });

  it("moves the writing dots only when motion is welcome; the words stay either way", () => {
    expect(css).toContain("@media (prefers-reduced-motion:no-preference){.th-ag-dots i{animation:th-dot 1.1s ease-in-out infinite}");
    expect(rule(".th-ag-dots i")).not.toContain("animation");
  });
});
