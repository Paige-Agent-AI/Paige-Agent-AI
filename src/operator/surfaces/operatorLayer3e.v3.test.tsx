import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { FleetTenant } from "@/operator/data/useFleet";
import { FleetDirectoryView } from "@/operator/surfaces/FleetConsole";
import { FleetHistoryView } from "@/operator/surfaces/FleetHistorySurface";
import SocialSurface from "@/operator/surfaces/campaigns/SocialSurface";

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&rarr;/g, "→")
    .replace(/&middot;/g, "·")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const TENANTS: FleetTenant[] = [
  {
    id: "tenant-a",
    slug: "test-agency",
    name: "Test Agency",
    status: "active",
    accountType: "agency",
    parentTenantId: null,
    planOffer: null,
    revenueClass: "promotional",
    seats: 2,
    customers: 0,
    trialEndsAt: null,
  },
  {
    id: "tenant-b",
    slug: "test-child",
    name: "Test Child",
    status: "active",
    accountType: "standalone",
    parentTenantId: "tenant-a",
    planOffer: null,
    revenueClass: "promotional",
    seats: 0,
    customers: 0,
    trialEndsAt: null,
  },
  {
    id: "tenant-i",
    slug: "test-internal",
    name: "Test Internal",
    status: "active",
    accountType: "standalone",
    parentTenantId: null,
    planOffer: null,
    revenueClass: "internal_test",
    seats: 0,
    customers: 0,
    trialEndsAt: null,
  },
];

describe("Layer 3e v3 surface lineage", () => {
  it("renders the complete History hierarchy from real-shaped records", () => {
    const html = renderToStaticMarkup(
      <FleetHistoryView
        total={2}
        events={[
          {
            id: "run:test",
            at: "2026-08-24T14:02:00Z",
            kind: "Full sweep",
            outcome: "Complete",
            duration: "48s",
            detail: "4 pass · 0 fail · 6 other",
          },
          {
            id: "firing:test",
            at: "2026-08-24T13:47:00Z",
            kind: "Firing",
            outcome: "Firing",
            duration: "—",
            detail: "Alert firing · delivered",
          },
        ]}
      />,
    );
    const output = text(html);
    expect(output).toContain("Run history");
    expect(output).toContain("Full sweep");
    expect(output).toContain("Firing");
    expect(output).toContain("In flight");
    expect(output).toContain("Clean —");
    expect(output).toContain("newest first, capped at 100");
    expect(output).not.toContain("36 runs in three hours");
  });

  it("keeps History loading, empty, failure, and partial-read states honest", () => {
    const loading = renderToStaticMarkup(<FleetHistoryView events={[]} total={null} loading />);
    expect(loading).toContain('aria-label="Reading run history"');

    const empty = text(renderToStaticMarkup(<FleetHistoryView events={[]} total={0} />));
    expect(empty).toContain("No run has been recorded here yet.");

    const failed = text(
      renderToStaticMarkup(<FleetHistoryView events={[]} total={null} error="Read unavailable" />),
    );
    expect(failed).toContain("The run history could not be read. Read unavailable");

    const partial = text(
      renderToStaticMarkup(
        <FleetHistoryView
          total={null}
          error="Firings unavailable"
          events={[
            {
              id: "run:partial",
              at: "2026-08-24T14:02:00Z",
              kind: "Full sweep",
              outcome: "Complete",
              duration: "48s",
              detail: "4 pass · 0 fail · 6 other",
            },
          ]}
        />,
      ),
    );
    expect(partial).toContain("the available records remain below");
    expect(partial).toContain("4 pass · 0 fail · 6 other");
  });

  it("renders v3 Fleet topology and excludes internal rows by default", () => {
    const html = renderToStaticMarkup(
      <FleetDirectoryView
        tenants={TENANTS}
        classificationVisible
        detailVisible
        onEnter={() => {}}
      />,
    );
    const output = text(html);
    expect(output).toContain("The fleet");
    expect(output).toContain("Agency 1");
    expect(output).toContain("Sub-account 1");
    expect(output).toContain("Show 1 internal");
    expect(output).toContain("Test Agency");
    expect(output).toContain("Test Child");
    expect(output).not.toContain("Test Internal");
    expect(output).not.toContain("Field");
    expect(output).not.toContain("Table");
    expect(output).not.toContain("Fleet Console");
  });

  it("renders the Social publishing spine with no design fixture values", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SocialSurface />
      </MemoryRouter>,
    );
    const output = text(html);
    expect(output).toContain("accounts connected");
    expect(output).toContain("scheduled this week");
    expect(output).toContain("Connect an account");
    expect(output).toContain("LinkedIn");
    expect(output).toContain("TikTok");
    expect(output).toContain("Post");
    expect(output).toContain("Reply");
    expect(output).toContain("Story");
    expect(output).toContain("Ad flight");
    expect(output).toContain("Representative — no social API is wired");
    expect(output).not.toContain("@");
    expect(output).not.toMatch(/\$\d/);
  });
});
