import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GOD_CONSOLE, operatorChooserTarget, operatorTarget } from "./operatorTarget";
import { canonicalPath, resolveOperatorAddress } from "@/operator/shell/operatorAddress";

/**
 * This validator decides where an authenticated operator lands, from a value an attacker can
 * put in a URL. The tests below are therefore mostly about what it must REFUSE — an allowlist
 * is only worth what its rejections prove.
 */
describe("operatorTarget", () => {
  it("carries a safe operator deep link through deliberate account choice", () => {
    expect(operatorChooserTarget("?next=%2Foperator%2Fsettings%2Fteam%2Froles")).toBe(
      "/choose-account?next=%2Foperator%2Fsettings%2Fteam%2Froles",
    );
    expect(operatorChooserTarget("?next=%2Fadmin")).toBe(
      `/choose-account?next=${encodeURIComponent(GOD_CONSOLE)}`,
    );
  });
  it("defaults to the God console when there is no next", () => {
    expect(operatorTarget("")).toBe(GOD_CONSOLE);
    expect(operatorTarget("?foo=bar")).toBe(GOD_CONSOLE);
  });

  it("honours a same-origin operator deep link", () => {
    expect(operatorTarget("?next=%2Foperator%2Ffleet")).toBe("/operator/fleet");
    expect(operatorTarget("?next=%2Foperator%2Fsettings%2Fteam%2Froles")).toBe(
      "/operator/settings/team/roles",
    );
  });

  it("refuses an absolute URL to another origin", () => {
    expect(operatorTarget("?next=https%3A%2F%2Fevil.example%2Foperator%2Ffleet")).toBe(GOD_CONSOLE);
  });

  it("refuses a protocol-relative URL", () => {
    // "//evil.example/..." is same-scheme, other-host — the classic open-redirect bypass.
    expect(operatorTarget("?next=%2F%2Fevil.example%2Ffleet")).toBe(GOD_CONSOLE);
    expect(operatorTarget("?next=%2Foperator%2F%2Fevil.example")).toBe(GOD_CONSOLE);
  });

  it("refuses a backslash-smuggled host", () => {
    // Some parsers normalise "\" to "/", so "/operator/\evil.example" must not pass either.
    expect(operatorTarget("?next=%2Foperator%2F%5Cevil.example")).toBe(GOD_CONSOLE);
  });

  it("refuses any path outside the operator subtree", () => {
    expect(operatorTarget("?next=%2Fadmin")).toBe(GOD_CONSOLE);
    expect(operatorTarget("?next=%2Foperatorx%2Ffleet")).toBe(GOD_CONSOLE);
    expect(operatorTarget("?next=%2Foperator")).toBe(GOD_CONSOLE); // no trailing segment
  });

  it("refuses to bounce back to the door, which would loop", () => {
    expect(operatorTarget("?next=%2Foperator%2Flogin")).toBe(GOD_CONSOLE);
    expect(operatorTarget("?next=%2Foperator%2Flogin%3Fnext%3D%252Foperator%252Ffleet")).toBe(
      GOD_CONSOLE,
    );
  });

  it("refuses a malformed escape rather than throwing", () => {
    expect(operatorTarget("?next=%E0%A4%A")).toBe(GOD_CONSOLE);
  });

  // ── The §39 peer-gate found the original prefix regex accepted these. It only looked at
  //    the character after "/operator/", and "." passes that — then react-router NORMALIZES
  //    the result, so the operator lands outside the subtree entirely. Reproduced before
  //    fixing; these are the regression tests for it.
  it("refuses ..-traversal that escapes the operator subtree", () => {
    expect(operatorTarget("?next=%2Foperator%2F..%2F..%2Fbook%2Fevil-slug")).toBe(GOD_CONSOLE);
    expect(operatorTarget("?next=%2Foperator%2F..%2F..%2Fauth")).toBe(GOD_CONSOLE);
    expect(operatorTarget("?next=%2Foperator%2F..%2F..%2F%2Fevil.example")).toBe(GOD_CONSOLE);
    expect(operatorTarget("?next=%2Foperator%2Ffleet%2F..%2F..%2Fadmin")).toBe(GOD_CONSOLE);
  });

  it("refuses a single-dot segment too", () => {
    expect(operatorTarget("?next=%2Foperator%2F.%2Ffleet")).toBe(GOD_CONSOLE);
  });

  it("refuses a doubled slash anywhere in the path", () => {
    expect(operatorTarget("?next=%2Foperator%2F%2Ffleet")).toBe(GOD_CONSOLE);
  });

  // react-router matches case-insensitively, so the anti-loop check must too — otherwise a
  // crafted /operator/LOGIN passes the guard and resolves right back to the door.
  it("refuses the door in any casing", () => {
    expect(operatorTarget("?next=%2Foperator%2FLOGIN")).toBe(GOD_CONSOLE);
    expect(operatorTarget("?next=%2Foperator%2FLogin")).toBe(GOD_CONSOLE);
  });

  it("keeps a query string on an otherwise-valid operator deep link", () => {
    expect(operatorTarget("?next=%2Foperator%2Ffleet%3Ftab%3Dalerts")).toBe(
      "/operator/fleet?tab=alerts",
    );
  });
});

// Round 0 — one operator door.
//
// This does not test operatorTarget's logic; it tests that nothing else in the codebase
// declares a SECOND operator landing destination. That is the defect this round fixed:
// JoinPlatform.tsx carried its own `GOD_CONSOLE = "/admin/platform/tenants"`, so a staffer
// arriving through the platform-invite door landed somewhere different from one arriving
// through /auth — same role, two destinations. It read as "two consoles" for weeks. There is
// one console; admin is a role and a scope band inside it, never a URL.
//
// A grep test rather than a behavioural one on purpose: the failure mode is a NEW file
// restating the constant, which no amount of testing the existing callers would catch.
describe("the operator door has exactly one home", () => {
  const SRC = path.resolve(__dirname, "../..");

  it("no module outside operatorTarget.ts declares its own operator landing constant", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        if (full.endsWith(path.join("lib", "auth", "operatorTarget.ts"))) continue;
        const text = fs.readFileSync(full, "utf8");
        // A declaration, not a reference: `const NAME = "/operator/..."` or "/admin/platform/tenants".
        const decl = /const\s+\w*(?:GOD_CONSOLE|OPERATOR_HOME|FLEET_HREF)\w*\s*[:=][^=]*?["'](\/(?:operator|admin)\/[^"']+)["']/g;
        for (const m of text.matchAll(decl)) {
          offenders.push(`${path.relative(SRC, full)} → ${m[1]}`);
        }
      }
    };
    walk(SRC);

    // FLEET_HREF in the OLD console (OperatorCommandCenter) is in-console navigation inside a
    // surface Round 1 strips wholesale, not a landing decision — allowed until then, listed
    // explicitly so it cannot grow quietly.
    const KNOWN = ["pages/admin/OperatorCommandCenter.tsx → /admin/platform/tenants"];
    const unexpected = offenders.filter((o) => !KNOWN.includes(o));
    expect(unexpected).toEqual([]);
  });

  it("GOD_CONSOLE points inside the operator subtree", () => {
    expect(GOD_CONSOLE.startsWith("/operator/")).toBe(true);
  });

  // The landing address must name a view the console HAS. A stale view slug is canonicalised to
  // the slot's first view, so a wrong constant lands every operator somewhere they did not ask
  // for — which is exactly what "/operator/fleet/tenants" did (Systems check, not the tenants).
  it("GOD_CONSOLE lands on the tenant directory, resolved through the shell's own resolver", () => {
    const [, root, section, ...rest] = GOD_CONSOLE.split("/");
    expect(root).toBe("operator");
    const address = resolveOperatorAddress(section, rest.join("/"));
    expect(address.kind).toBe("resolved");
    if (address.kind !== "resolved") return;
    expect(address.stale).toBe(false);
    expect(address.slot.id).toBe("fleet");
    expect(address.view).toBe("Directory");
    expect(canonicalPath(address)).toBe(GOD_CONSOLE);
  });

  it("both sign-in doors require the chooser before Platform and the chooser owns final operator navigation", () => {
    const sharedAuth = fs.readFileSync(path.join(SRC, "pages", "Auth.tsx"), "utf8");
    const operatorLogin = fs.readFileSync(path.join(SRC, "pages", "OperatorLogin.tsx"), "utf8");
    const joinPlatform = fs.readFileSync(path.join(SRC, "pages", "JoinPlatform.tsx"), "utf8");
    const chooser = fs.readFileSync(path.join(SRC, "pages", "ChooseAccount.tsx"), "utf8");

    expect(sharedAuth).toContain("navigate(operatorChooserTarget(window.location.search)");
    // A failed operator-standing read is unknown authority, never "not an operator".
    expect(sharedAuth).toContain("if (initialMemberships.error || initialStanding === null)");
    expect(sharedAuth.match(/navigate\(operatorChooserTarget\(window\.location\.search\)/g)?.length).toBe(1);
    expect(sharedAuth).toContain("setRoutingError(\"Paige couldn't confirm your account access.");
    expect(sharedAuth).toContain("resolve(LANDING_ROUTE_RETRY)");
    expect(operatorLogin).toContain("navigate(operatorChooserTarget(window.location.search)");
    // The one server answer; a failed read (null) is unknown, never a denial.
    expect(operatorLogin).toContain("fetchOperatorStanding().then((s) => (s ? holdsOperatorTier(s) : null))");
    expect(joinPlatform).toContain("fetchOperatorStanding().then((s) => (s ? holdsOperatorTier(s) : null))");
    expect(operatorLogin).toContain("if (isOperator === null)");
    expect(operatorLogin).toContain("setRoutingError(\"Paige couldn't confirm Platform access.");
    expect(operatorLogin).toContain("r(LANDING_ROUTE_RETRY)");
    expect(joinPlatform.match(/navigate\(operatorChooserTarget\(window\.location\.search\)/g)?.length).toBe(2);
    expect(joinPlatform).toContain("await accountContext.refresh()");
    expect(joinPlatform).toContain("if (isStaff === null)");
    expect(joinPlatform).toContain("setRoutingError(\"Paige couldn't confirm Platform access.");
    expect(chooser).toContain("navigate(operatorTarget(location.search)");
    expect(sharedAuth).not.toContain('navigate("/admin"');
    expect(operatorLogin).not.toContain('navigate("/admin"');
    expect(joinPlatform).not.toContain("GOD_CONSOLE");
    expect(joinPlatform).not.toContain('navigate("/admin"');
    expect(chooser).not.toContain('navigate("/admin"');
  });
});
