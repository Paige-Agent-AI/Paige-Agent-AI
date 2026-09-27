import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FleetTenant } from "@/operator/data/useFleet";
import { fleetDetailVisible, rowReadComplete } from "@/operator/data/useFleet";
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

describe("FleetDirectoryView — the row carries the real data already read (slice 4)", () => {
  const DAY = 86_400_000;
  const soon = new Date(Date.now() + 5.5 * DAY).toISOString();
  const readRows = [
    tenant({ id: "a", name: "Has Clients", seats: 2, customers: 4, revenueClass: "promotional" }),
    tenant({ id: "b", name: "One Client", seats: 1, customers: 1, revenueClass: "promotional" }),
    tenant({ id: "c", name: "Trialing", status: "trial", seats: 1, trialEndsAt: soon, revenueClass: "promotional" }),
    tenant({ id: "d", name: "Gone", status: "canceled", seats: 1, revenueClass: "promotional" }),
    tenant({ id: "e", name: "Internal Row", seats: 0, revenueClass: "internal_test" }),
  ];

  it("shows each tenant's client count when counts are readable", () => {
    const out = text(
      renderToStaticMarkup(
        <FleetDirectoryView tenants={readRows} classificationVisible detailVisible onEnter={() => {}} />,
      ),
    );
    expect(out).toContain("4 clients");
    expect(out).toContain("1 client ");
    expect(out).toContain("no clients");
  });

  it("names a non-active status beside the grade, with the trial's days left", () => {
    const out = text(
      renderToStaticMarkup(
        <FleetDirectoryView tenants={readRows} classificationVisible detailVisible onEnter={() => {}} />,
      ),
    );
    expect(out).toContain("Trial · 6 days left");
    expect(out).toContain("Canceled");
    expect(out).not.toMatch(/\bActive\b/); // the default status is not repeated on every row
  });

  it("counts at risk from the rows actually shown, at both tiers", () => {
    const owner = text(
      renderToStaticMarkup(
        <FleetDirectoryView tenants={readRows} classificationVisible detailVisible onEnter={() => {}} />,
      ),
    );
    expect(owner).toContain("2 at risk"); // trial + canceled; the internal row is hidden
    const admin = text(
      renderToStaticMarkup(
        <FleetDirectoryView
          tenants={readRows.map((t) => ({ ...t, seats: 0, customers: 0, revenueClass: null }))}
          classificationVisible={false}
          detailVisible={false}
          onEnter={() => {}}
        />,
      ),
    );
    expect(admin).toContain("2 at risk"); // status alone: trial + canceled
    expect(admin).not.toContain("— at risk");
  });

  it("states the header count truthfully when internal accounts cannot be told apart", () => {
    const admin = text(
      renderToStaticMarkup(
        <FleetDirectoryView
          tenants={readRows.map((t) => ({ ...t, seats: 0, customers: 0, revenueClass: null }))}
          classificationVisible={false}
          detailVisible={false}
          onEnter={() => {}}
        />,
      ),
    );
    expect(admin).toContain("5 tenants, internal accounts included");
    expect(admin).not.toContain("— live");
    expect(admin).not.toContain("Show — internal");
    expect(admin).not.toContain("clients"); // client counts are not readable at this role
    expect(admin).toContain("Seat and client counts are not visible to your role");
    expect(admin).not.toContain("the chip reveals them"); // no chip is offered at this role
  });
});

describe("FleetDirectoryView — status wording is exact (slice 4 review)", () => {
  const DAY = 86_400_000;
  const render = (t: FleetTenant) =>
    text(
      renderToStaticMarkup(
        <FleetDirectoryView tenants={[{ ...t, revenueClass: "promotional" }]} classificationVisible detailVisible onEnter={() => {}} />,
      ),
    );

  it("counts a lapsed trial's elapsed days without rounding up", () => {
    const out = render(tenant({ status: "trial", trialEndsAt: new Date(Date.now() - 9.2 * DAY).toISOString() }));
    expect(out).toContain("Trial · ended 9 days ago");
  });

  it("says a trial that lapsed within the day ended today", () => {
    const out = render(tenant({ status: "trial", trialEndsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
    expect(out).toContain("Trial · ended today");
  });

  it("uses the platform's own label for a status, not its stored value", () => {
    expect(render(tenant({ status: "past_due" }))).toContain("Past due");
    expect(render(tenant({ status: "past_due" }))).not.toContain("past_due");
    expect(render(tenant({ status: "suspended" }))).toContain("Suspended");
  });

  it("marks the at-risk figure as including internal accounts when they cannot be told apart", () => {
    const out = text(
      renderToStaticMarkup(
        <FleetDirectoryView
          tenants={[tenant({ status: "canceled" })]}
          classificationVisible={false}
          detailVisible={false}
          onEnter={() => {}}
        />,
      ),
    );
    expect(out).toContain("1 at risk, internal included");
  });
});

describe("FleetDirectoryView — header counts while the fleet is not read (slice 4, Codex)", () => {
  const view = (over: { loading?: boolean; error?: string | null }) =>
    text(
      renderToStaticMarkup(
        <FleetDirectoryView
          tenants={[]}
          classificationVisible={false}
          detailVisible={false}
          onEnter={() => {}}
          {...over}
        />,
      ),
    );

  it("shows no tenant or at-risk figure while loading", () => {
    const out = view({ loading: true });
    expect(out).not.toMatch(/\b0 tenants\b/);
    expect(out).not.toMatch(/\b0 at risk\b/);
    expect(out).toContain("— at risk");
  });

  it("shows no tenant or at-risk figure when the read failed", () => {
    const out = view({ error: "timeout" });
    expect(out).not.toMatch(/\b0 tenants\b/);
    expect(out).not.toMatch(/\b0 at risk\b/);
    expect(out).toContain("— at risk");
  });
});

describe("rowReadComplete — a row read the server truncated is not a count", () => {
  it("is complete when every matching row came back", () => {
    expect(rowReadComplete(9, 9)).toBe(true);
    expect(rowReadComplete(0, 0)).toBe(true);
  });
  it("is incomplete when the server matched more rows than it returned (row cap)", () => {
    expect(rowReadComplete(1000, 1432)).toBe(false);
  });
  it("is incomplete when the server did not report how many rows matched", () => {
    expect(rowReadComplete(9, null)).toBe(false);
  });
});
