// @vitest-environment jsdom
// The one client picker read (Pipeline's deal picker and the calendar's appointment drawer):
// it offers this account's LIVE clients only. A contact merged into another is not a client
// any more — choosing it would attach a deal or a session to a record the CRM has retired.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Call = { table: string; filters: [string, unknown][] };
const db: { rows: Row[]; calls: Call[] } = { rows: [], calls: [] };

// A tiny in-memory `clients` table. `.eq` and `.is` really narrow the rows, so a filter the
// hook forgets is a merged client the owner can pick — not just a missing call record.
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const call: Call = { table, filters: [] };
    db.calls.push(call);
    let rows = db.rows;
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.order = () => chain;
    chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); rows = rows.filter((r) => r[column] === value); return chain; };
    chain.is = (column: string, value: unknown) => { call.filters.push([`is ${column}`, value]); rows = rows.filter((r) => (r[column] ?? null) === value); return chain; };
    chain.range = (lo: number, hi: number) => Promise.resolve({ data: rows.slice(lo, hi + 1), error: null });
    return chain;
  };
  return { supabase: { from } };
});
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "tenant-north", accountContextLoading: false }),
}));

import { useSoloDealClients } from "./useSoloDealClients";

const email = (value: string) => [{ id: `m-${value}`, kind: "email", value, label: null, is_primary: true, position: 0 }];
let host: HTMLDivElement;
let root: Root;
let seen: ReturnType<typeof useSoloDealClients> | null = null;
function Probe({ tenantId }: { tenantId: string }) {
  seen = useSoloDealClients(tenantId);
  return null;
}
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };

beforeEach(() => {
  db.rows = [];
  db.calls = [];
  seen = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useSoloDealClients — live clients only", () => {
  it("leaves out a client merged into another, and keeps the survivor", async () => {
    db.rows = [
      { id: "client-jordan", tenant_id: "tenant-north", first_name: "Jordan", last_name: "Rivera", merged_into_contact_id: null, client_contact_methods: email("jordan@northwind.example") },
      { id: "client-jordan-dup", tenant_id: "tenant-north", first_name: "Jordan", last_name: "R.", merged_into_contact_id: "client-jordan", client_contact_methods: email("jr@northwind.example") },
      { id: "client-sam", tenant_id: "tenant-north", first_name: "Sam", last_name: "Okafor", merged_into_contact_id: null, client_contact_methods: [] },
      { id: "client-other", tenant_id: "tenant-south", first_name: "Robin", last_name: "Hale", merged_into_contact_id: null, client_contact_methods: [] },
    ];
    act(() => root.render(<Probe tenantId="tenant-north" />));
    await flush();
    expect(seen?.phase).toBe("ready");
    expect(seen?.clients).toEqual([
      { id: "client-jordan", name: "Jordan Rivera", primaryEmail: "jordan@northwind.example" },
      { id: "client-sam", name: "Sam Okafor", primaryEmail: null },
    ]);
    const call = db.calls.find((c) => c.table === "clients");
    expect(call?.filters).toEqual(expect.arrayContaining([["tenant_id", "tenant-north"], ["is merged_into_contact_id", null]]));
  });
});
