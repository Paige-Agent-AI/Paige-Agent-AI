/**
 * The shell's geometry contract.
 *
 * WHY THIS ASSERTS RENDERED MARKUP AND NOT KEY COUNTS. The console's first failure mode was a
 * registry that resolved every address, typechecked clean, passed every test — and rendered a
 * blank card on all 78 screens (`src/operator/CLAUDE.md`). Counting slots proves the tree is
 * addressed and proves nothing about what anyone sees, so every assertion here reads the DOM the
 * shell actually produced.
 *
 * Folder convention: react-dom/server, no RTL. `signOut` is mocked because importing it pulls in
 * the supabase client, which is not this test's subject.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { OPERATOR_SLOTS } from "@/operator/ia/operatorIA";
import { SETTINGS_MENU } from "@/operator/ia/settingsIA";
import { resolveOperatorAddress, viewPath } from "@/operator/shell/operatorAddress";
import { SPINE_REGIONS, spineHasContent } from "@/operator/shell/OperatorSpine";

vi.mock("@/lib/auth/signOut", () => ({ performSignOut: vi.fn(), registerSignOutActAsGuard: vi.fn(() => () => undefined) }));
vi.mock("@/operator/data/usePlatformTrust", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/operator/data/usePlatformTrust")>(),
  PlatformTrustProvider: ({ children }: { children: ReactNode }) => children,
}));

import OperatorShell from "./OperatorShell";

const at = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/operator/:section/*" element={<OperatorShell />} />
      </Routes>
    </MemoryRouter>,
  );

/** `data-slot="…"` in source order — the seam the harness measures slot ORDER through. */
const slotOrder = (html: string) =>
  [...html.matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1]);

describe("the operator shell renders the pack's geometry", () => {
  it("the rail carries the SIX IA slots, in the IA's order, each tagged data-slot", () => {
    expect(slotOrder(at("/operator/fleet"))).toEqual(OPERATOR_SLOTS.map((s) => s.id));
  });

  /**
   * RULING C (Claude Design, 2026-08-23) — the spine's track is reserved on whether PAIGE has
   * anything to show, never on a flag. "A collapsed spine is honest; an empty one asserts a
   * capability that isn't there."
   *
   * So this asserts the CONTRACT, not one frozen string: the rail is the pack's 216px, the middle
   * is floor-less, and the spine track agrees with `spineHasContent()`. It passes unchanged on the
   * day PAIGE lands in the spine — and fails if the two ever disagree, which is the defect.
   */
  it("the rail and middle are the pack's, and the spine track agrees with what the spine holds", () => {
    const html = at("/operator/fleet");
    expect(html).toContain("data-shell-grid");
    const cols = /grid-template-columns:\s*([^;"]+)/.exec(html)?.[1];
    expect(cols).toBeTruthy();
    expect(cols).toMatch(/^216px minmax\(0,\s*1fr\)/);
    expect(cols!.slice("216px minmax(0,1fr)".length).trim()).toBe(
      spineHasContent() ? "minmax(340px,26vw)" : "0px",
    );
  });

  it("the spine opens now Chat is wired — track reserved AND mounted, both halves", () => {
    /**
     * This asserted the collapse until 2026-08-23, when `SpineConversation` was mounted as the
     * Chat face. The rule it was protecting is unchanged and still tested in
     * `spine/OperatorSpine.test.tsx`: a spine with no content renders nothing. What changed is
     * that the spine HAS content, so both halves must now fire the other way — a reserved track
     * with nothing in it and a mounted spine on a 0px track are each still a defect.
     */
    expect(spineHasContent()).toBe(true);
    expect(SPINE_REGIONS.find((r) => r.id === "chat")?.content).not.toBeNull();
    expect(at("/operator/fleet")).toContain("data-operator-spine");
  });

  /**
   * RULING D — the gold act must land. "A gold affordance that 404s spends the design's scarcest
   * signal on nothing." RULING E — Paige is not a destination; that control was REMOVED.
   *
   * Asserted against the SOURCE because the previous address looked right and 404'd: an eye on the
   * button proves nothing, and only `operatorAddress.ts` can say whether a link lands.
   */
  it("the v3 Fleet directory carries no retired or invented operator address", () => {
    const src = readFileSync(resolve(process.cwd(), "src/operator/surfaces/FleetConsole.tsx"), "utf8");

    // Ruling E: she is the spine, not a place. No route to her, in code or in a literal.
    expect(src).not.toContain("/operator/paige");
    // `fleetVals` has no provisioning control; the retired console must not put it back.
    expect(src).not.toContain("/operator/provisioning");
    expect(src).not.toContain("PROVISION_AT");

    const directory = viewPath("fleet", "Directory");
    const [, , section, view] = directory.split("/");
    const address = resolveOperatorAddress(section, view);
    expect(address.kind).toBe("resolved");
    expect(address.kind === "resolved" && address.stale).toBe(false);
    expect(address.kind === "resolved" && address.slot.id).toBe("fleet");
  });

  it("Settings offers its owner-approved sub-main menu and category tabs", () => {
    const html = at("/operator/settings");
    expect(html).toContain('aria-label="Settings menu"'); expect(html).toContain("Back to PAIGE");
    expect(slotOrder(html)).toEqual([]);
    for (const group of SETTINGS_MENU) expect(html).toContain(`data-settings-menu="${group.slug}"`);
    expect(html).toContain('aria-label="Setup tabs"'); expect(html).not.toContain('aria-label="Settings views"');
    expect(html).toContain('href="/operator/settings/setup/platform"');
  });

  /**
   * Absence is per VIEW, not per slot. A slot can have a shipped surface behind one view and
   * nothing behind the next; showing the slot's absence over a view that HAS one would hide
   * shipped work, and showing a shape over a view that has none would be the blank screen. So
   * each view answers for itself.
   *
   * This used to point at `relationships/people`, which carried nothing at all. BUILD-ORDER
   * Layer 3a ported People, Conversations and Segments, so that address now resolves a surface
   * and the assertion moved to a view that is still genuinely sourceless. The absence copy did
   * not stop mattering — each of the three renders it INSIDE the surface when no row is read,
   * which is asserted in `relationships.v3.test.tsx` where the component can be awaited. Here
   * the shell renders synchronously and a lazy surface is still its Suspense hold.
   */
  it("a view with no shipped source renders the IA's absence copy, unedited", () => {
    const html = at("/operator/settings/connections/numbers");
    const settings = OPERATOR_SLOTS.find((s) => s.id === "settings")!;
    // Settings carries no slot-level absence, so this is the honest general form — which is
    // the branch that would otherwise go untested entirely.
    expect(settings.absence).toBeUndefined();
    expect(html).toContain("Not wired yet");
    expect(html).toContain("no surface behind it reads live data yet");
  });

  it("a view WITH a shipped source renders the feature, not the absence", () => {
    const html = at("/operator/relationships/calendar");
    const absence = OPERATOR_SLOTS.find((s) => s.id === "relationships")!.absence!;
    // Calendar's field ships. If the absence appeared here it would be hiding it — the
    // regression this pair exists to catch, in the direction that loses work.
    expect(html).not.toContain(absence.title);
  });

  it("an unknown section renders a 404 IN the shell — it does not redirect to Fleet", () => {
    const html = at("/operator/not-a-slot");
    // The redirect it replaces rendered nothing here and threw the address away.
    expect(html).toContain("data-shell-grid");
    expect(html).toContain("not-a-slot");
    // Every slot is still one click away, so the operator is never stranded.
    expect(slotOrder(html)).toEqual(OPERATOR_SLOTS.map((s) => s.id));
  });

  it("a known slot with an unknown view canonicalises rather than lying about where you are", () => {
    // <Navigate> renders nothing on the server: no shell means the redirect fired.
    expect(at("/operator/fleet/not-a-view")).not.toContain("data-shell-grid");
    expect(at("/operator/fleet/history")).toContain("data-shell-grid");
  });
  it("legacy Settings redirects retain detached-surface query and fragment", async () => {
    function Destination() { const route = useLocation(); return <output>{route.pathname}{route.search}{route.hash}</output>; }
    const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
    try {
      await act(async () => root.render(<MemoryRouter initialEntries={["/operator/settings/mind?surface=sweep#evidence"]}><Routes>
        <Route path="/operator/settings/paige-intelligence/mind" element={<Destination />} />
        <Route path="/operator/:section/*" element={<OperatorShell />} />
      </Routes></MemoryRouter>));
      expect(node.querySelector("output")?.textContent).toBe("/operator/settings/paige-intelligence/mind?surface=sweep#evidence");
    } finally { await act(async () => root.unmount()); node.remove(); }
  });
});
