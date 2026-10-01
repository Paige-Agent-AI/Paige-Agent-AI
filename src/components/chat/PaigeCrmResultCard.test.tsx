import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaigeCrmResultCard } from "./PaigeCrmResultCard";

describe("PaigeCrmResultCard", () => {
  it("renders server readback, durable receipt, and the exact router-owned link", () => {
    const html = renderToStaticMarkup(<PaigeCrmResultCard result={{
      action: "deal.move",
      outcome: "succeeded",
      readback: { id: "deal-1", title: "Northwind renewal" },
      receipt_recorded: true,
      record_locator: { record_id: "deal-1", surface_url: "/solo/100/growth", deep_link: "/solo/100/growth?deal=deal-1", deep_link_status: "exact" },
    }} />);
    expect(html).toContain("Northwind renewal");
    expect(html).toContain("Recorded in Paige activity.");
    expect(html).toContain('href="/solo/100/growth?deal=deal-1"');
    expect(html).toContain("Open exact record");
  });

  it("says Added for a record it created, never Updated", () => {
    for (const action of ["contact.create", "company.create", "task.create", "deal.create"]) {
      const html = renderToStaticMarkup(<PaigeCrmResultCard result={{
        action,
        outcome: "succeeded",
        readback: { id: "rec-1", client_ref: "John Coleman" },
        receipt_recorded: true,
        record_locator: null,
      }} />);
      expect(html).toContain(">Added</p>");
      expect(html).not.toMatch(/Updated|create/);
      expect(html).toContain("John Coleman");
    }
    // Everything else keeps saying what it did.
    const updated = renderToStaticMarkup(<PaigeCrmResultCard result={{
      action: "contact.update", outcome: "succeeded", readback: { id: "rec-1" }, receipt_recorded: true, record_locator: null,
    }} />);
    expect(updated).toContain("Updated: contact update");
  });

  it("labels activity as internal-only and does not invent a link", () => {
    const html = renderToStaticMarkup(<PaigeCrmResultCard result={{
      action: "activity.log",
      outcome: "succeeded",
      readback: { id: "activity-1" },
      receipt_recorded: true,
      record_locator: null,
      external_effect: false,
    }} />);
    expect(html).toContain("Logged internally only; nothing was sent or called.");
    expect(html).not.toContain("href=");
  });
});