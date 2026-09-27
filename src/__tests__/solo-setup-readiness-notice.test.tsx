// @vitest-environment jsdom
/**
 * PR #1277 exact-head correction — the readiness reminder's LAYOUT contract.
 *
 * FINDING 1 (Codex P2): the reminder originally rendered as a SIBLING of the
 * canonical Solo shell, which owns height:100dvh — banner + 100dvh expanded
 * the document past the shell's viewport. This suite pins the corrected
 * integration:
 *
 *   • the access gate's solo branch renders children ONLY — no sibling DOM of
 *     any kind (the load-bearing regression: rendering a reminder as a gate
 *     sibling again FAILS these proofs);
 *   • the reminder lives INSIDE SoloApp's height-owned paige-solo column
 *     (flex:none row; the content wrapper below it is flex:1/minHeight:0), so
 *     the canonical shell stays the ONE viewport owner and main.tcs-main the
 *     ONE scroll owner;
 *   • the reminder's own behavior: truthful copy + keyboard-reachable Setup
 *     link and Dismiss, dismissal hides it, complete/missing state renders
 *     nothing.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const gateSrc = read("src/components/auth/RequireSetupComplete.tsx");
const soloAppSrc = read("src/solo/SoloApp.tsx");

const { SoloSetupReadinessNotice } = await import("../solo/SoloSetupReadinessNotice");
const { isSoloSetupComplete } = await import("@/components/auth/RequireSetupComplete");
const { soloShellRole } = await import("../solo/shell-role");

let host: HTMLDivElement;
let root: Root | null = null;
const mount = async (props: { visible?: boolean; setupHref: string | null; dismissed?: boolean; onDismiss?: () => void }) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(SoloSetupReadinessNotice, {
          visible: props.visible ?? true,
          setupHref: props.setupHref,
          dismissed: props.dismissed ?? false,
          onDismiss: props.onDismiss ?? (() => {}),
        }),
      ),
    );
  });
};
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  vi.clearAllMocks();
});

describe("load-bearing: the access gate never renders reminder siblings (Finding 1 regression)", () => {
  it("the gate's solo branch returns children ONLY — no JSX element, banner, link, or wrapper besides children", () => {
    const start = gateSrc.indexOf('if (tierKey === "solo")');
    const end = gateSrc.indexOf("// ── SUB-ACCOUNT");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const soloBranch = gateSrc.slice(start, end);
    // The branch contains exactly one return, of the children, and nothing
    // else renderable. A reintroduced sibling (banner/div/link) trips this.
    expect(soloBranch).toContain("return <>{children}</>;");
    expect(soloBranch).not.toMatch(/<(div|span|button|Link|aside|section)[\s>]/);
    expect(soloBranch).not.toContain("setup-readiness");
    expect(soloBranch).not.toContain("useState");
  });

  it("the gate file no longer imports Link or useState (no sibling machinery at all)", () => {
    expect(gateSrc).not.toMatch(/import\s+.*\bLink\b.*from "react-router-dom"/);
    expect(gateSrc).not.toContain("useState");
  });

  it("solo routing invariants survive the layout correction (source): the redirect stays sub_account-only", () => {
    expect(gateSrc).toContain('const gatedTier = tierKey === "sub_account";');
  });
});

describe("one viewport owner: the reminder renders inside SoloApp's height-owned subtree", () => {
  it("SoloApp renders the notice INSIDE the paige-solo column, above the flexed content wrapper", () => {
    const noticeAt = soloAppSrc.indexOf("<SoloSetupReadinessNotice");
    const columnAt = soloAppSrc.indexOf('className="paige-solo"');
    const wrapperAt = soloAppSrc.indexOf('display:\'flex\',flex:1,minHeight:0,overflow:\'hidden\'');
    expect(noticeAt).toBeGreaterThan(-1);
    expect(columnAt).toBeGreaterThan(-1);
    // Notice is inside the paige-solo div, before the content wrapper.
    expect(noticeAt).toBeGreaterThan(columnAt);
    expect(wrapperAt).toBeGreaterThan(noticeAt);
  });

  it("the paige-solo root is a COLUMN layout with fixed height, and the content wrapper is flex:1/minHeight:0 — the reminder cannot expand the document", () => {
    expect(soloAppSrc).toContain("height:'100%'");
    expect(soloAppSrc).toContain("display:'flex',flexDirection:'column'");
    expect(soloAppSrc).toContain("display:'flex',flex:1,minHeight:0,overflow:'hidden'");
  });

  it("the notice itself is flex:none (a row inside the column, never a scroll owner)", () => {
    const noticeSrc = read("src/solo/SoloSetupReadinessNotice.tsx");
    expect(noticeSrc).toContain('flex: "none"');
    expect(noticeSrc).not.toContain("100vh");
    expect(noticeSrc).not.toContain("100dvh");
    expect(noticeSrc).not.toContain("position: \"fixed\"");
    // It reuses the shell's existing token vocabulary, not a new system.
    expect(noticeSrc).toContain("var(--line)");
    expect(noticeSrc).toContain("var(--surface)");
  });

  it("Codex a1c5cfd0 P2 regression: banner actions are contrast-safe — the link inherits the shell's standard link token (no gold override), the dismiss label uses ink-2", () => {
    const noticeSrc = read("src/solo/SoloSetupReadinessNotice.tsx");
    // Gold-bright measures ~2.1:1 on the light surface at 12.5px — below the
    // 4.5:1 floor. The link must carry NO inline color (it inherits
    // .paige-solo's --violet, ~6.7:1) and the dismiss uses --ink-2 (~4:1
    // ink-3 is below the floor).
    expect(noticeSrc).not.toContain("var(--gold-bright)");
    expect(noticeSrc).not.toMatch(/<Link[^>]*color/);
    expect(noticeSrc).toMatch(/button[\s\S]*?color: "var\(--ink-2\)"/);
    // Sabotage-sensitivity: reintroducing either low-contrast override trips.
    const goldBack = noticeSrc.replace("<Link to={setupHref}>", '<Link to={setupHref} style={{ color: "var(--gold-bright)" }}>');
    expect(goldBack).toMatch(/<Link[^>]*color/);
  });

  it("Codex a1c5cfd0 P2 regression: the membership probe verdict is tenant+user-keyed — an account switch can never surface the previous workspace's verdict", () => {
    // The derived value must be false the instant the identity changes
    // (before any RPC resolves, and indefinitely if one hangs). Renamed with
    // the INT-071 owner-label repair: editorProbe → roleProbe carrying the
    // owner and admin verdicts; the keying contract is unchanged.
    expect(soloAppSrc).toMatch(/roleProbe\.tenant === activeTenantId/);
    expect(soloAppSrc).toMatch(/roleProbe\.user === activeUserId/);
    expect(soloAppSrc).toMatch(/const isMembershipEditor =[\s\S]*?\(roleProbe\.owner \|\| roleProbe\.admin\);/);
    // Sabotage-sensitivity: a bare boolean (the stale shape) fails the pin.
    const bare = soloAppSrc.replace(
      /roleProbe\.tenant === activeTenantId\s*&&\s*roleProbe\.user === activeUserId\s*&&\s*\(roleProbe\.owner \|\| roleProbe\.admin\)/,
      "roleProbe.owner",
    );
    expect(/roleProbe\.tenant === activeTenantId/.test(bare)).toBe(false);
  });

  it("the shell (not the gate) owns dismissal, so it survives route remounts", () => {
    expect(soloAppSrc).toContain("const [setupReminderDismissal, setSetupReminderDismissed] = React.useState");
  });

  it("Codex d4c85392 P2 regression: dismissal is tenant+user-keyed — one workspace's dismissal never hides another's notice after an in-place switch", () => {
    // The stored record carries the identity that dismissed; the DERIVED
    // boolean is false the instant the active identity changes.
    expect(soloAppSrc).toMatch(/setupReminderDismissal\.tenant === activeTenantId/);
    expect(soloAppSrc).toMatch(/setupReminderDismissal\.user === activeUserId/);
    // Sabotage-sensitivity: the unkeyed bare-boolean shape fails the pin.
    const bare = soloAppSrc.replace(
      /setupReminderDismissal !== null\s*&&\s*setupReminderDismissal\.tenant === activeTenantId\s*&&\s*setupReminderDismissal\.user === activeUserId/,
      "setupReminderDismissal !== null",
    );
    expect(/setupReminderDismissal\.tenant === activeTenantId/.test(bare)).toBe(false);
  });

  it("Codex ea0e7a8b P2 regression: the reminder predicate carries the STAFF guard — an operator acting inside an incomplete standalone tenant gets no owner setup guidance", () => {
    // The guard lives on the visibility derivation, so the notice is
    // suppressed entirely for staff act-as sessions.
    const guardRegex = /!isPlatformStaff\s*&&\s*activeTenant\?\.account_number != null/;
    expect(guardRegex.test(soloAppSrc)).toBe(true);
    expect(soloAppSrc).toContain(
      "const { activeTenant, activeTenantId, activeUserId, isPlatformStaff } = useTenantContext();",
    );
    // Sabotage-sensitivity: stripping the guard from the predicate makes the
    // pin fail (proven on the mutated text, not by asserting the negation).
    const guardless = soloAppSrc.replace(/!isPlatformStaff\s*&&\s*/, "");
    expect(guardRegex.test(guardless)).toBe(false);
  });

  it("Codex 1c401d1b P2 regression: the deep link exists ONLY for callers who can edit Setup — read-only members get the notice with NO CTA", () => {
    // Visibility and link are SEPARATE: the notice is everyone's truthful
    // readiness news; the CTA must never lead to a surface the user cannot
    // change (solo_setup_access_scope maps coaches/members to read_only).
    expect(soloAppSrc).toContain("const showSetupReminder =");
    expect(soloAppSrc).toMatch(/canFinishSetup = isPrimaryOwner \|\| isMembershipEditor/);
    expect(soloAppSrc).toMatch(/soloSetupHref = showSetupReminder && canFinishSetup/);
    // The notice component renders the link ONLY on a non-null href, and
    // role-appropriate copy otherwise (no dead-end CTA).
    const noticeSrc = read("src/solo/SoloSetupReadinessNotice.tsx");
    expect(noticeSrc).toMatch(/setupHref != null \? \([\s\S]*?<Link/);
    expect(noticeSrc).toContain("an owner or admin completes it from Settings");
    // Sabotage-sensitivity: unlinking the gate (link for everyone) fails the pin.
    const ungated = soloAppSrc.replace("showSetupReminder && canFinishSetup", "showSetupReminder");
    expect(/soloSetupHref = showSetupReminder && canFinishSetup/.test(ungated)).toBe(false);
  });

  it("Codex 2c3a2321/dda03dcd P2 regression: membership OWNERS and ADMINS are both honored — the gate matches every non-read_only scope classification", () => {
    // solo_setup_access_scope() grants editing to owner_full (primary owner
    // via tenants.owner_user_id, OR an active membership owner: is_owner /
    // role='owner') AND to admin_operational (role='admin' — the save RPC
    // accepts it and the Setup UI enables operational editing). The canonical
    // client-callable predicate for both membership halves is has_tenant_role
    // (authenticated-granted, STABLE, the §18 one home). Since the INT-071
    // owner-label repair the probe pair runs whenever the shell has a
    // resolved identity (the label needs the owner verdict even when Setup is
    // complete) — still ONE pair of calls per tenant+user, still fail-closed.
    expect(soloAppSrc.match(/supabase\.rpc\("has_tenant_role"/g)?.length).toBe(2);
    expect(soloAppSrc).toMatch(/_role: "owner"/);
    expect(soloAppSrc).toMatch(/_role: "admin"/);
    expect(soloAppSrc).toMatch(/const probeTenant = activeTenantId;/);
    expect(soloAppSrc).toMatch(/const probeUser = activeUserId;/);
    expect(soloAppSrc).toMatch(/canFinishSetup = isPrimaryOwner \|\| isMembershipEditor/);
    // Sabotage-sensitivity: dropping either half breaks the classification pin.
    const membershipDropped = soloAppSrc.replace("isPrimaryOwner || isMembershipEditor", "isPrimaryOwner");
    expect(/isPrimaryOwner \|\| isMembershipEditor/.test(membershipDropped)).toBe(false);
    const adminDropped = soloAppSrc.replace('_role: "admin"', '_role: "owner"');
    expect(soloAppSrc.match(/_role: "admin"/g)?.length ?? 0).toBe(1);
    expect((adminDropped.match(/_role: "admin"/g)?.length ?? 0) === 0).toBe(true);
  });
});

describe("the shell's Owner/Team label derives from authoritative membership (INT-071 census repair)", () => {
  const probe = (over: Partial<{ tenant: string; user: string; owner: boolean; admin: boolean }>) =>
    ({ tenant: "t-1", user: "u-1", owner: false, admin: false, ...over });

  it("a membership OWNER (co-owner seat) sees the Owner workspace label", () => {
    expect(soloShellRole(probe({ owner: true }), "t-1", "u-1")).toBe("admin");
  });

  it("membership ADMIN and MEMBER both see the Team workspace label", () => {
    expect(soloShellRole(probe({ admin: true }), "t-1", "u-1")).toBe("member");
    expect(soloShellRole(probe({}), "t-1", "u-1")).toBe("member");
  });

  it("unresolved verdict fails to Team workspace", () => {
    expect(soloShellRole(null, "t-1", "u-1")).toBe("member");
  });

  it("an account switch never leaks the previous workspace's label — a verdict keyed to a prior tenant OR prior user is dead", () => {
    expect(soloShellRole(probe({ owner: true, tenant: "t-prior" }), "t-1", "u-1")).toBe("member");
    expect(soloShellRole(probe({ owner: true, user: "u-prior" }), "t-1", "u-1")).toBe("member");
  });

  it("pointer/membership disagreement resolves to membership — the derivation's CODE has no owner_user_id input at all", () => {
    // Comments may NAME the forbidden pointer (documentation); the code must
    // never read it. Strip comments, then assert the token is absent.
    const shellRoleSrc = read("src/solo/shell-role.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(shellRoleSrc).not.toContain("owner_user_id");
    // The pointer CANNOT disagree because it is not consulted: a pointer-owner
    // without a membership-owner verdict is "member", a membership owner whose
    // pointer names someone else is "admin".
    expect(soloShellRole(probe({ owner: true }), "t-1", "u-1")).toBe("admin");
    expect(soloShellRole(null, "t-1", "u-1")).toBe("member");
  });

  it("SoloApp wires the label to the tenant+user-keyed membership probe — never to the display-only tenants.owner_user_id pointer", () => {
    expect(soloAppSrc).toContain("const shellRole = soloShellRole(roleProbe, activeTenantId, activeUserId);");
    // The defective pointer expression is gone entirely.
    expect(soloAppSrc).not.toContain('owner_user_id === activeUserId ? "admin" : "coach"');
    expect(soloAppSrc).not.toMatch(/shellRole[^;\n]*owner_user_id/);
    // The presentation repair does NOT touch the CTA's authorization halves:
    // isPrimaryOwner keeps the server-derived column (solo_setup_access_scope's
    // own owner_full definition) and isMembershipEditor keeps the probe.
    expect(soloAppSrc).toMatch(/const isPrimaryOwner =/);
    expect(soloAppSrc).toMatch(/canFinishSetup = isPrimaryOwner \|\| isMembershipEditor/);
    // Sabotage-sensitivity: re-pointing the label at the pointer fails the pin.
    const pointerWired = soloAppSrc.replace(
      "const shellRole = soloShellRole(roleProbe, activeTenantId, activeUserId);",
      'const shellRole = activeUserId != null && activeTenant?.owner_user_id === activeUserId ? "admin" : "coach";',
    );
    expect(/const shellRole = soloShellRole\(roleProbe, activeTenantId, activeUserId\);/.test(pointerWired)).toBe(false);
  });

  it("the probe state carries the owner and admin verdicts separately (the label needs owner alone; the CTA needs owner OR admin)", () => {
    expect(soloAppSrc).toMatch(/setRoleProbe\(\{ tenant: probeTenant, user: probeUser, owner: owner\.data === true, admin: admin\.data === true \}\)/);
  });
});

describe("the readiness predicate is one shared pure function", () => {
  it("isSoloSetupComplete recognizes the three readiness signals and nothing else", () => {
    expect(isSoloSetupComplete(null)).toBe(false);
    expect(isSoloSetupComplete({})).toBe(false);
    expect(isSoloSetupComplete({ playbook: "" })).toBe(false);
    expect(isSoloSetupComplete({ playbook: "funding" })).toBe(true);
    expect(isSoloSetupComplete({ playbook_config: { slug: "x" } })).toBe(true);
    expect(isSoloSetupComplete({ solo_setup_complete: true })).toBe(true);
    expect(isSoloSetupComplete({ solo_setup_complete: false })).toBe(false);
  });

  it("the gate consumes the same predicate (one home for the signal)", () => {
    expect(gateSrc).toContain("const hasPlaybook = isSoloSetupComplete(activeTenant?.features);");
  });
});

describe("the reminder's behavior (component)", () => {
  it("renders truthful copy with a keyboard-reachable Setup link and Dismiss while incomplete", async () => {
    await mount({ setupHref: "/solo/42/settings/setup" });
    expect(host.textContent).toContain("Setup isn't finished");
    expect(host.textContent).toContain("everything else works");
    const link = host.querySelector("a");
    expect(link).toBeTruthy();
    expect(link!.getAttribute("href")).toBe("/solo/42/settings/setup");
    const dismiss = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Dismiss setup reminder");
    expect(dismiss).toBeTruthy();
  });

  it("dismissal hides the reminder via the shell-held callback", async () => {
    let dismissed = false;
    await mount({ setupHref: "/solo/42/settings/setup", onDismiss: () => { dismissed = true; } });
    const dismiss = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Dismiss setup reminder")!;
    await act(async () => { dismiss.click(); });
    expect(dismissed).toBe(true);
  });

  it("renders nothing when dismissed or when not visible (complete / staff)", async () => {
    await mount({ visible: true, setupHref: "/solo/42/settings/setup", dismissed: true });
    expect(host.querySelector("[data-setup-readiness]")).toBeNull();
    await mount({ visible: false, setupHref: "/solo/42/settings/setup" });
    expect(host.querySelector("[data-setup-readiness]")).toBeNull();
  });

  it("Codex 1c401d1b P2: a read-only caller sees the truthful notice with NO link — role-appropriate copy, no dead-end CTA", async () => {
    await mount({ visible: true, setupHref: null });
    expect(host.querySelector("[data-setup-readiness]")).toBeTruthy();
    expect(host.textContent).toContain("Setup isn't finished");
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("an owner or admin completes it from Settings");
    const dismiss = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Dismiss setup reminder");
    expect(dismiss).toBeTruthy();
  });
});
