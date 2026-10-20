// Owner calendar harness transport. HARNESS RENDER · SYNTHETIC DATA · NOT LIVE.
// Calendars and bookings come from the existing calendar-mount stub unchanged (its rows are visibly synthetic:
// "Harness slot N"). This adds ONE read: the business's clients, in the exact shape useSoloDealClients selects —
//   clients: id, first_name, last_name, entity_name, entity_type, client_contact_methods(id,kind,value,label,is_primary,position)
// read as .select(..).eq('tenant_id', t).is('merged_into_contact_id', null).order('id').range(0, pages*250). Names are fictional (§63).
import { supabase as base } from "../../calendar-mount/supabase-stub";

const method = (id: string, value: string) => [{ id, kind: "email", value, label: "Work", is_primary: true, position: 0 }];
const CLIENTS = [
  { id: "e0900000-0000-4000-8000-0000000c0001", first_name: "Jordan", last_name: "Rivera", entity_name: null, entity_type: null, client_contact_methods: method("m1", "jordan.rivera@example.test") },
  { id: "e0900000-0000-4000-8000-0000000c0002", first_name: "Sam", last_name: "Okafor", entity_name: null, entity_type: null, client_contact_methods: method("m2", "sam.okafor@example.test") },
  { id: "e0900000-0000-4000-8000-0000000c0003", first_name: null, last_name: null, entity_name: "Harbour Lane Bakery", entity_type: "llc", client_contact_methods: method("m3", "hello@harbourlane.example.test") },
  { id: "e0900000-0000-4000-8000-0000000c0004", first_name: "Priya", last_name: "Nair", entity_name: null, entity_type: null, client_contact_methods: [] },
];

// One merged duplicate (merged into Jordan Rivera): the picker must never offer it (useSoloDealClients filters
// .is('merged_into_contact_id', null)); eq/is filter for real here so a dropped filter shows up on screen.
const MERGED = { id: "e0900000-0000-4000-8000-0000000c0009", first_name: "Jordan", last_name: "Rivera", entity_name: null, entity_type: null, client_contact_methods: method("m9", "jordan.old@example.test"), merged_into_contact_id: "e0900000-0000-4000-8000-0000000c0001" };
const ROWS = [...CLIENTS.map((c) => ({ ...c, merged_into_contact_id: null as string | null })), MERGED];

function clientsQuery() {
  let rows: Record<string, unknown>[] = ROWS;
  const done = () => Promise.resolve({ data: rows.map(({ merged_into_contact_id: _m, ...r }) => r), error: null });
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (col: string, v: unknown) => { if (col !== "tenant_id") rows = rows.filter((r) => r[col] === v); return q; },
    is: (col: string, v: unknown) => { rows = rows.filter((r) => (r[col] ?? null) === v); return q; },
    order: () => q, range: () => done(),
    then: (r: (v: unknown) => unknown) => done().then(r),
  };
  return q;
}

export const supabase = {
  ...base,
  from(table: string) {
    if (table === "clients") return clientsQuery();
    return base.from(table);
  },
};
export default { supabase };
