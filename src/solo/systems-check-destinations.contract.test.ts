/**
 * Systems Check → every finding's exit must land somewhere real.
 *
 * ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────
 *
 * The owner's requirement for this surface was explicit: every item needs "a direct next action
 * into the real owning surface", and "no generic 'open PAIGE for more' as the only exit". So the
 * console renders a deep link per finding — "Campaigns › Sales", "Clients › People" — built from
 * CHECK_DESTINATIONS in ./systems-check-areas.
 *
 * The danger is that a WRONG link is invisible. `/solo/*` is a splat with no catch-all: SoloApp
 * resolves the branch with `branchBySlug("solo", urlBranchSlug)?.key ?? "home"` (SoloApp.tsx:141),
 * so an unrecognised branch renders Command Center with the wrong URL still sitting in the address
 * bar. Nothing 404s. Nothing throws. The owner clicks "Campaigns › Sales", lands back on the
 * dashboard he was already looking at, and there is no signal anywhere that the exit was dead.
 *
 * A rename in tierBranches.ts is therefore enough to silently sever every exit on this surface
 * while leaving the whole suite green, because no test anywhere else reads these paths. This file
 * is the guard: it asserts each destination against the routing registry itself, so the registry
 * and the console cannot drift apart without CI saying so.
 *
 * These are the paths the console actually renders, resolved through the same functions the router
 * uses — not a transcribed copy of them, which would drift in exactly the way this exists to catch.
 */
import { describe, expect, it } from "vitest";
import { branchBySlug, subtabBySlug } from "@/lib/routing/tierBranches";
import { CHECK_DESTINATIONS } from "./systems-check-areas";

const ACCOUNT = "test-tenant-systems";

/** Split a rendered destination into the parts the router actually resolves. */
function parse(path: string) {
  const [pathname, query = ""] = path.split("?");
  const parts = pathname.split("/").filter(Boolean); // ["solo", account, branch, ...rest]
  return {
    root: parts[0],
    account: parts[1],
    branch: parts[2] ?? "",
    rest: parts.slice(3),
    query: new URLSearchParams(query),
  };
}

const entries = Object.entries(CHECK_DESTINATIONS);

describe("Systems Check destinations resolve against the real Solo route tree", () => {
  it("has destinations to check at all", () => {
    // Guards every loop below from silently asserting nothing if the map is emptied.
    expect(entries.length).toBeGreaterThan(0);
  });

  it("every destination lands on a real Solo branch", () => {
    const dead: string[] = [];
    for (const [checkId, destination] of entries) {
      const { root, account, branch } = parse(destination.path(ACCOUNT));
      if (root !== "solo" || account !== ACCOUNT) dead.push(`${checkId} left the Solo tree: ${destination.path(ACCOUNT)}`);
      // The whole point: an unknown branch does NOT 404, it renders Command Center. The
      // assertion has to be against the registry, because the app itself will not complain.
      else if (!branchBySlug("solo", branch)) dead.push(`${checkId} -> "${branch}" is not a Solo branch`);
    }
    expect(dead, "these links silently render Command Center instead of going anywhere").toEqual([]);
  });

  it("every destination lands on a real sub-tab of that branch", () => {
    const dead: string[] = [];
    for (const [checkId, destination] of entries) {
      const { branch, rest } = parse(destination.path(ACCOUNT));
      const subtab = rest[0];
      if (!subtab) {
        // A branch-level link is legitimate only where the branch genuinely has no sub-tabs;
        // otherwise it lands on whichever sub-tab happens to be first.
        const subtabs = branchBySlug("solo", branch)?.subtabs ?? [];
        if (subtabs.length > 0) dead.push(`${checkId} names no sub-tab of "${branch}", which has ${subtabs.length}`);
        continue;
      }
      if (!subtabBySlug("solo", branch, subtab)) dead.push(`${checkId} -> "${branch}/${subtab}" is not a sub-tab of that branch`);
    }
    expect(dead).toEqual([]);
  });

  it("never routes a finding back to Command Center or to PAIGE as its only exit", () => {
    // The owner's rule for this surface, pinned: "no generic 'open PAIGE for more' as the only
    // exit". An exit that returns you to the page you are already on, or hands you a chat instead
    // of the thing that needs changing, is the failure this console was rebuilt to remove.
    const circular: string[] = [];
    for (const [checkId, destination] of entries) {
      const { branch } = parse(destination.path(ACCOUNT));
      if (branch === "command-center" || branch === "paige") circular.push(`${checkId} -> ${branch}`);
    }
    expect(circular).toEqual([]);
  });

  it("gives every destination a link label and a plain-English title", () => {
    const thin: string[] = [];
    for (const [checkId, destination] of entries) {
      if (!destination.label?.trim()) thin.push(`${checkId} has no link label`);
      if (!destination.title?.trim()) thin.push(`${checkId} has no owner-facing title`);
      // The registry's own check_name is engineering vocabulary for 8 of the 10 checks, which is
      // the only reason these titles exist. A title that is just the id again defeats the point.
      const flat = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");
      if (destination.title && flat(destination.title) === flat(checkId)) {
        thin.push(`${checkId} title is just the check id restated`);
      }
    }
    expect(thin).toEqual([]);
  });

  it.each(["payment_processor_connected", "payment_method_options"] as const)(
    "%s reaches the original payment records without a legacy Overview redirect",
    (checkId) => {
      const destination = CHECK_DESTINATIONS[checkId];
      const target = parse(destination.path(ACCOUNT));
      expect(target.branch).toBe("sales");
      expect(target.rest).toEqual(["payments"]);
      expect(target.query.get("view")).toBe("invoices");
      expect(destination.label).toBe("Sales › Payments");
      // Original records are inspectable; the old declaration editor is not mounted here.
      expect(destination.caveat).toContain("cannot be changed here");
      expect(destination.caveat).toContain("processor connection");
    },
  );

  it("sends the revenue finding where a stage is authored, not where revenue is reported", () => {
    // The check fails with "add a closing stage to your pipeline". Stages are authored on
    // Campaigns > Pipeline; Campaigns > Sales is only where the money then shows. Pointing at the
    // result instead of the fix is the exact miss this pins — and it is easy to reintroduce,
    // because three of the four `sales`-area checks legitimately DO point at Sales.
    const revenue = CHECK_DESTINATIONS.revenue_tracking_configured;
    expect(revenue.path(ACCOUNT)).toContain("/growth/pipeline");
    expect(revenue.path(ACCOUNT)).not.toContain("/growth/sales");
    // And it must not pretend the job can be finished there. On Solo today nothing — not the
    // surface, not PAIGE — can set a stage's closing role (task #26), so the caveat is the only
    // thing standing between this check and a next action the owner cannot complete (§70).
    expect(revenue.caveat ?? "").not.toBe("");
  });
});
