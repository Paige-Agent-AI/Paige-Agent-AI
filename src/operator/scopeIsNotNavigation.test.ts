import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Round 0 — act-as is a SCOPE CHANGE, not a navigation.
 *
 * `switchTenant` runs the audited operator RPC, commits `activeTenantId` to the one shared
 * provider, and invalidates every query, so all consumers re-read under the new scope. The
 * console used to follow that with `window.location.assign("/admin")` — which is what made it
 * a one-way door, since no exit existed on the far side.
 *
 * The pack models scope as three states on the band above the shell (`P.SCOPES` — rest / read /
 * act) and mutates it with `cycleScope`/`exitScope`, which are `setState`, never routing. The
 * decisive detail is `exitScope`'s own announcement: "active_tenant_id returned to NULL." Scope 0
 * IS `tenant_id IS NULL` — act-as is the value of one column, not a place you travel to. Scope is
 * also BROADCAST rather than routed, which is why a scope change lands in every detached window;
 * a route-based act-as structurally cannot do that.
 *
 * So this guard is about the MODEL, not a style rule: a hard navigate inside the operator console
 * means someone has re-introduced "go somewhere else" as the shape of act-as.
 *
 * AMENDED 2026-09-27 — the one exception, and why it is not the old one-way door. Enter under the
 * scope-only model recorded an audited act-as and left the operator on the directory: no tenant
 * view, no exit, a band still reading "No tenant", and an audit row asserting access nobody had.
 * The owner's defect report (2026-09-27) is that the operator must actually arrive in the tenant.
 * `operator/actAs.ts` now lands them in that tenant's OWN workspace, and it may do so only because
 * the far side now carries the audited exit (`WorkspaceExitControl` → `operator_exit_tenant`) in
 * every shell an operator can land in; tenants whose shell cannot hold an operator are refused
 * before anything is recorded. That module is the ONLY one allowed to navigate. Any other hard
 * navigate under src/operator is still the old one-way door and still fails here.
 */
describe("act-as changes scope, it does not navigate", () => {
  const OPERATOR = path.resolve(__dirname);

  /** Comments discuss the removed call by name — strip them before searching for a real one. */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return files(full);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
    });

  // The act-as landing, paired with the exit on the far side. See the amendment above.
  const LANDING = path.join(OPERATOR, "actAs.ts");

  it("no module under src/operator performs a hard navigate, except the act-as landing", () => {
    const offenders = files(OPERATOR)
      .filter((f) => f !== LANDING)
      .filter((f) => /window\s*\.\s*location\s*\.\s*(assign|replace)\s*\(|window\s*\.\s*location\s*\.\s*href\s*=/
        .test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(OPERATOR, f));
    expect(offenders).toEqual([]);
  });

  it("the guard reads code, not prose — a comment naming the call does not trip it", () => {
    const prose = `/* we removed window.location.assign("/admin") here */\nexport const x = 1;`;
    expect(/window\s*\.\s*location\s*\.\s*assign\s*\(/.test(stripComments(prose))).toBe(false);
    const real = `export function go() { window.location.assign("/admin"); }`;
    expect(/window\s*\.\s*location\s*\.\s*assign\s*\(/.test(stripComments(real))).toBe(true);
  });

  it("the act-as landing is the one navigate, and it exists", () => {
    const src = stripComments(fs.readFileSync(LANDING, "utf8"));
    expect(src.match(/window\s*\.\s*location\s*\.\s*assign\s*\(/g)?.length).toBe(1);
  });
});
