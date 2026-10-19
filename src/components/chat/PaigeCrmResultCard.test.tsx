import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaigeCrmResultCard } from "./PaigeCrmResultCard";
import { readCrmResultMetadata } from "../../../supabase/functions/_shared/paige-turn/crm-result-reference";

const ID = "e4000000-0000-4000-8000-0000000c0001";
const solo = (account_number = 200) => ({ account_type: "standalone", parent_tenant_id: null, account_number });

describe("PaigeCrmResultCard", () => {
  it("rebuilds a restored contact reference through the current workspace", () => {
    const restored = { action: "contact.update", outcome: "succeeded", receipt_recorded: true,
      readback: null, record_locator: null,
      record_reference: { destination: "contacts" as const, record_id: "e4000000-0000-4000-8000-0000000c0001", subject: "CLT-1234" } };
    const html = renderToStaticMarkup(<PaigeCrmResultCard result={restored} account={{ account_type: "standalone", parent_tenant_id: null, account_number: 200 }} />);
    expect(html).toContain("CLT-1234");
    expect(html).toContain('href="/solo/200/clients/people?person=e4000000-0000-4000-8000-0000000c0001"');
    expect(html).toContain("Open exact record");
  });
  it("renders server readback, durable receipt, and the exact router-owned link", () => {
    const html = renderToStaticMarkup(<PaigeCrmResultCard result={{
      action: "deal.move",
      outcome: "succeeded",
      readback: { id: ID, title: "Northwind renewal" },
      receipt_recorded: true,
      record_locator: { record_id: ID, surface_url: "/solo/100/growth", deep_link: `/solo/100/growth?deal=${ID}`, deep_link_status: "exact" },
    }} account={solo()} />);
    expect(html).toContain("Northwind renewal");
    expect(html).toContain("Recorded in Paige activity.");
    expect(html).toContain(`href="/solo/200/growth/pipeline?deal=${ID}"`);
    expect(html).toContain("Open deal");
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

describe("Task and Deal receipt reload links", () => {
  it("opens a fresh exact Task and its reduced history through the current SOLO account", () => {
    const fresh = { action: "task.update", outcome: "succeeded", receipt_recorded: true,
      readback: { id: ID, title: "Neutral saved Task" },
      record_locator: { record_id: ID, deep_link_status: "exact", deep_link: "/solo/999/foreign" } };
    const [saved] = readCrmResultMetadata([{ action: fresh.action, outcome: fresh.outcome, receipt_recorded: true,
      record_reference: { destination: "operations_work", record_id: ID } }]);
    for (const result of [fresh, saved]) {
      const html = renderToStaticMarkup(<PaigeCrmResultCard result={result} account={solo(300)} />);
      expect(html).toContain(`href="/solo/300/operations/work?task=${ID}"`);
      expect(html).toContain("Open task"); expect(html).not.toContain("/solo/999");
      expect(html).toContain("Recorded in Paige activity.");
    }
  });
  const stored = (family: "task" | "deal") => ({ action: `${family}.update`, outcome: "succeeded", receipt_recorded: true,
    record_reference: family === "task" ? { destination: "operations_work" as const, record_id: null } : { destination: "pipeline" as const, record_id: ID } });
  it.each(["task", "deal"] as const)("rehydrates a %s link using the current workspace without restoring payloads", family => {
    const [result] = readCrmResultMetadata(JSON.parse(JSON.stringify([stored(family)])));
    const html = renderToStaticMarkup(<PaigeCrmResultCard result={result} account={solo(300)} />);
    expect(html).toContain(family === "task" ? 'href="/solo/300/operations/work"' : `href="/solo/300/growth/pipeline?deal=${ID}"`);
    expect(html).toContain(family === "task" ? "Open Work" : "Open deal");
    expect(html).toContain("Recorded in Paige activity.");
    expect(html).not.toMatch(/Private title|999|undefined/);
    if (family === "task") expect(html).not.toMatch(/Open exact|task=|record_id|e4000000/);
  });
  it.each([null, undefined, { account_type: "agency", parent_tenant_id: null, account_number: 200 },
    { account_type: "standalone", parent_tenant_id: null, account_number: null }])("does not address a restored link without a supported current workspace (%j)", account => {
    for (const family of ["task", "deal"] as const) {
      const [result] = readCrmResultMetadata([stored(family)]);
      expect(renderToStaticMarkup(<PaigeCrmResultCard result={result} account={account} />)).not.toContain("href=");
    }
  });
  it.each(["task", "deal"] as const)("never falls back to a stale or external live %s URL in Solo", family => {
    const result = { ...stored(family), readback: { id: ID }, record_locator: { record_id: ID,
      deep_link_status: family === "task" ? "surface_only" : "exact", deep_link: "https://example.invalid/foreign", surface_url: "/solo/999/foreign" } };
    const html = renderToStaticMarkup(<PaigeCrmResultCard result={result} account={solo()} />);
    expect(html).not.toMatch(/example.invalid|solo\/999/);
    expect(html).toContain(family === "task" ? 'href="/solo/200/operations/work"' : `href="/solo/200/growth/pipeline?deal=${ID}"`);
    for (const invalid of [
      { receipt_recorded: false }, { outcome: "unknown" }, { action: `${family}.delete` },
      { readback: { id: ID, absent: true } }, { record_locator: { ...result.record_locator, record_id: "bad-id" } },
    ]) expect(renderToStaticMarkup(<PaigeCrmResultCard result={{ ...result, ...invalid }} account={solo()} />)).not.toContain("href=");
  });
  it.each(["task", "deal"] as const)("keeps reduced old %s rows generic instead of reconstructing an unsupported reference", family => {
    const [result] = readCrmResultMetadata([{ action: `${family}.update`, outcome: "succeeded", receipt_recorded: true,
      readback: { id: ID, title: "Private title" }, record_locator: { surface_url: "/solo/999/foreign" } }]);
    const html = renderToStaticMarkup(<PaigeCrmResultCard result={result} account={solo()} />);
    expect(html).not.toMatch(/href=|Private title|999/);
  });
  it("retains the incumbent live sub-account Task surface without claiming exact Task focus", () => {
    const html = renderToStaticMarkup(<PaigeCrmResultCard account={{ account_type: "sub_account", parent_tenant_id: "parent", account_number: 300 }} result={{
      action: "task.update", outcome: "succeeded", receipt_recorded: true, readback: { id: ID },
      record_locator: { record_id: ID, deep_link_status: "surface_only", surface_url: "/business/300/calendar/tasks", deep_link: null },
    }} />);
    expect(html).toContain('href="/business/300/calendar/tasks"');
    expect(html).not.toContain("Open exact");
  });
  it.each(["task", "deal"] as const)("does not adopt a new stored %s reference in a non-Solo workspace", family => {
    const [result] = readCrmResultMetadata([stored(family)]);
    expect(renderToStaticMarkup(<PaigeCrmResultCard account={{ account_type: "sub_account", parent_tenant_id: "parent", account_number: 300 }} result={result} />)).not.toContain("href=");
  });
  it("retains the incumbent live sub-account Deal surface rather than inventing exact focus", () => {
    const html = renderToStaticMarkup(<PaigeCrmResultCard account={{ account_type: "sub_account", parent_tenant_id: "parent", account_number: 300 }} result={{
      action: "deal.move", outcome: "succeeded", receipt_recorded: true, readback: { id: ID },
      record_locator: { record_id: ID, deep_link_status: "surface_only", surface_url: "/business/300/clients/pipelines", deep_link: null },
    }} />);
    expect(html).toContain('href="/business/300/clients/pipelines"');
    expect(html).not.toContain("Open exact");
  });
});
