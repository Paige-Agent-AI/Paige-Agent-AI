/**
 * EXP08 Team Hub agents (A1b): the 56 agent colour tokens in the shared token layer.
 *
 * The colours and symbols are APPROVED-FROZEN (owner, 2026-10-27, "Colors and images are approved",
 * §28). This test is the in-repo re-measure the contract asks to travel with the tokens: it pins the
 * exact approved values in both themes, then re-checks the generator's two gates against the values
 * src/index.css actually declares — AA (ink ≥4.5:1 on its tint and on every surface; fill and ring
 * ≥3:1 on every surface) and the STATUS rules (agent colour stays clear of error, success, warning,
 * the Approve gold and PAIGE's own gold). If a system status token or a surface ever changes, this
 * fails and the tokens are re-generated, never hand-edited.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../../index.css"), "utf8");
const themeBlock = (theme: "dark" | "light") => {
  const start = css.indexOf(`[data-pg="${theme}"] {`);
  return css.slice(start, css.indexOf("\n  }", start));
};
const tokens = (theme: "dark" | "light") => {
  const out: Record<string, string> = {};
  for (const match of themeBlock(theme).matchAll(/(--pg-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[match[1]] = match[2].trim().toLowerCase();
  return out;
};

const AGENTS = ["paige", "vera", "nexus", "cura", "mentor", "merit", "zion"] as const;
type Role = "tint" | "ink" | "fill" | "ring";
// The approved values (team-hub-agents frames/agent-tokens.json, artifact version 1793069117-3333).
const APPROVED: Record<"dark" | "light", Record<typeof AGENTS[number], Record<Role, string>>> = {
  dark: {
    paige: { tint: "#413317", ink: "#ebcd96", fill: "#ac8947", ring: "#ac8947" },
    vera: { tint: "#0a3232", ink: "#50b7b8", fill: "#148b8d", ring: "#2c8a8b" },
    nexus: { tint: "#3e1e3b", ink: "#e7a3e0", fill: "#c46dbd", ring: "#a65aa0" },
    cura: { tint: "#47192a", ink: "#f275a0", fill: "#c24976", ring: "#bc5077" },
    mentor: { tint: "#463455", ink: "#eedcff", fill: "#e1c2fe", ring: "#b990dd" },
    merit: { tint: "#2a452c", ink: "#bef5c1", fill: "#9ce6a1", ring: "#77b77b" },
    zion: { tint: "#1d314b", ink: "#a4cafe", fill: "#6ea4eb", ring: "#5886c5" },
  },
  light: {
    paige: { tint: "#f4e7d2", ink: "#745303", fill: "#a38245", ring: "#a38245" },
    vera: { tint: "#d0ebeb", ink: "#065c5d", fill: "#057f80", ring: "#3b8f90" },
    nexus: { tint: "#fee3fb", ink: "#8c4287", fill: "#bc65b5", ring: "#b76eb1" },
    cura: { tint: "#fee6ec", ink: "#6b183a", fill: "#8b0f49", ring: "#cd6589" },
    mentor: { tint: "#e5d8f3", ink: "#4e276b", fill: "#663a89", ring: "#7e599d" },
    merit: { tint: "#d0e5d0", ink: "#034b14", fill: "#176325", ring: "#417b46" },
    zion: { tint: "#e2eeff", ink: "#3764a0", fill: "#5286cb", ring: "#5d8ac4" },
  },
};

const hex = (value: string) => [0, 2, 4].map((i) => parseInt(value.replace("#", "").slice(i, i + 2), 16) / 255);
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (value: string) => { const [r, g, b] = hex(value).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function oklab(value: string) {
  const [r, g, b] = hex(value).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** OKLab distance ×100, normal vision: the generator's ΔE. */
const deltaE = (a: string, b: string) => { const p = oklab(a), q = oklab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100; };

const SURFACES = ["--pg-canvas", "--pg-spine", "--pg-workspace", "--pg-surface", "--pg-raised", "--pg-nav"];

describe("Team Hub agent colour tokens (APPROVED-FROZEN 2026-10-27)", () => {
  for (const theme of ["dark", "light"] as const) {
    const declared = tokens(theme);
    const value = (agent: string, role: Role) => declared[`--pg-agent-${agent}-${role}`];

    it(`declares all 28 ${theme} agent tokens in the shared token layer with exactly the approved values`, () => {
      for (const agent of AGENTS) for (const role of ["tint", "ink", "fill", "ring"] as const) {
        expect(value(agent, role), `${theme} ${agent} ${role}`).toBe(APPROVED[theme][agent][role]);
      }
    });

    it(`clears AA in ${theme}: ink ≥4.5:1 on its tint and on every surface, fill and ring ≥3:1 on every surface`, () => {
      for (const agent of AGENTS) {
        expect(contrast(value(agent, "ink"), value(agent, "tint")), `${agent} ink on tint`).toBeGreaterThanOrEqual(4.5);
        for (const surface of SURFACES) {
          const ground = declared[surface];
          expect(contrast(value(agent, "ink"), ground), `${agent} ink on ${surface}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(value(agent, "fill"), ground), `${agent} fill on ${surface}`).toBeGreaterThanOrEqual(3);
          expect(contrast(value(agent, "ring"), ground), `${agent} ring on ${surface}`).toBeGreaterThanOrEqual(3);
        }
      }
    });

    it(`keeps every agent clear of the ${theme} status colours and of the Approve gold (the generator's STATUS rules)`, () => {
      const negative = declared["--pg-negative"], positive = declared["--pg-positive"], warning = declared["--pg-warning"], gold = declared["--pg-gold-fill"];
      const paigeInk = value("paige", "ink"), paigeFill = value("paige", "fill");
      for (const agent of AGENTS) {
        const ink = value(agent, "ink"), fill = value(agent, "fill");
        expect(deltaE(ink, negative), `${agent} ink vs negative`).toBeGreaterThanOrEqual(10);
        expect(deltaE(fill, negative), `${agent} fill vs negative`).toBeGreaterThanOrEqual(10);
        expect(deltaE(ink, positive), `${agent} ink vs positive`).toBeGreaterThanOrEqual(8);
        if (agent === "paige") continue;
        for (const [name, other] of [["warning", warning], ["gold-fill", gold], ["PAIGE ink", paigeInk], ["PAIGE fill", paigeFill]] as const) {
          expect(deltaE(ink, other), `${agent} ink vs ${name}`).toBeGreaterThanOrEqual(8);
          expect(deltaE(fill, other), `${agent} fill vs ${name}`).toBeGreaterThanOrEqual(8);
        }
      }
      // PAIGE's identity is gold, but never the Approve fill: her fill is her ring value.
      expect(deltaE(paigeFill, gold)).toBeGreaterThanOrEqual(8);
      expect(value("paige", "fill")).toBe(value("paige", "ring"));
    });
  }
});
