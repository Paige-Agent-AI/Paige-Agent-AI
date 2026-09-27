import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FleetTenant } from "@/operator/data/useFleet";
import { fleetDetailVisible } from "@/operator/data/useFleet";
import { FleetDirectoryView } from "@/operator/surfaces/FleetConsole";

/**
 * The Directory at BOTH operator tiers (Platform Operator milestone, slice 3).
 *
 * Seat and client reads are owner-only by RLS, so a `platform_admin` receives zero rows — which
 * `useFleet` turns into `seats: 0` on every tenant. The defect this pins: that zero was graded
 * "At risk" on every row, a verdict built on data the session never read. An unread seat count
 * must never be graded, and the directory must say — once — that it is not visible.
 */
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&rarr;/g, "→")
    .replace(/&middot;/g, "·")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const tenant = (over: Partial<FleetTenant>): FleetTenant => ({
  id: "t",
  slug: null,
  name: "Test Tenant",
  status: "active",
  accountType: "standalone",
  parentTenantId: null,
  planOffer: null,
  revenueClass: null,
  seats: 0,
  customers: 0,
  trialEndsAt: null,
  ...over,
});

// What a platform_admin's session actually produces: every seat reads 0, no class is readable.
const UNREAD: FleetTenant[] = [
  tenant({ id: "a", name: "Active One" }),
  tenant({ id: "b", name: "Active Two" }),
  tenant({ id: "c", name: "Canceled One", status: "canceled" }),
];

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("FleetDirectoryView — seats this session cannot read", () => {
  it("never grades an unread seat count as At risk", () => {
    const out = text(
      renderToStaticMarkup(
        <FleetDirectoryView tenants={UNREAD} classificationVisible={false} detailVisible={false} onEnter={() => {}} />,
      ),
    );
    // Only the tenant whose STATUS is readable and not active is at risk.
    expect(count(out, "At risk")).toBe(1);
    expect(out).toContain("Not graded");
    // "no seats" is a claim about data the session did not read.
    expect(out).not.toContain("no seats");
  });

  it("says once that seats are not visible to this role", () => {
    const out = text(
      renderToStaticMarkup(
        <FleetDirectoryView tenants={UNREAD} classificationVisible={false} detailVisible={false} onEnter={() => {}} />,
      ),
    );
    expect(count(out, "not visible to your role")).toBe(1);
  });

  it("says access could not be confirmed when the check itself did not answer", () => {
    const out = text(
      renderToStaticMarkup(
        <FleetDirectoryView tenants={UNREAD} classificationVisible={false} detailVisible={null} onEnter={() => {}} />,
      ),
    );
    expect(out).toContain("could not be confirmed");
    expect(out).not.toContain("not visible to your role");
    expect(count(out, "At risk")).toBe(1);
  });
});

describe("FleetDirectoryView — seats this session can read", () => {
  it("still grades a zero-seat active tenant At risk and a seated one Nominal", () => {
    const out = text(
      renderToStaticMarkup(
        <FleetDirectoryView
          tenants={[
            tenant({ id: "a", name: "Seated", seats: 3, revenueClass: "promotional" }),
            tenant({ id: "b", name: "Empty", seats: 0, revenueClass: "promotional" }),
          ]}
          classificationVisible
          detailVisible
          onEnter={() => {}}
        />,
      ),
    );
    expect(out).toContain("3 seats");
    expect(out).toContain("no seats");
    expect(count(out, "At risk")).toBe(1); // the row; the header reads "1 at risk" in lowercase
    expect(out).toContain("Nominal");
    expect(out).not.toContain("Not graded");
    expect(out).not.toContain("not visible to your role");
  });
});

describe("fleetDetailVisible — when seat and client counts are real", () => {
  it("is true only for the owner with both reads succeeding", () => {
    expect(fleetDetailVisible(true, false)).toBe(true);
  });
  it("is false for a session the server says is not the owner", () => {
    expect(fleetDetailVisible(false, false)).toBe(false);
  });
  it("is unknown when the owner check has not answered", () => {
    expect(fleetDetailVisible(null, false)).toBe(null);
  });
  it("is unknown when the seat or client read failed — even for the owner (a failed read is not a zero)", () => {
    expect(fleetDetailVisible(true, true)).toBe(null);
    expect(fleetDetailVisible(false, true)).toBe(null);
  });
});

describe("FleetDirectoryView — header risk count when seats are unread but classification is readable", () => {
  it("counts only the status-driven At risk rows", () => {
    const out = text(
      renderToStaticMarkup(
        <FleetDirectoryView
          tenants={UNREAD.map((t) => ({ ...t, revenueClass: "promotional" }))}
          classificationVisible
          detailVisible={null}
          onEnter={() => {}}
        />,
      ),
    );
    expect(out).toContain("1 at risk");
    expect(count(out, "At risk")).toBe(1);
  });
});
