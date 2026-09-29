// Stubbed client for the People contact-methods harness. `upsert_contact` echoes what it was
// sent into `window.__upserts` so a drive can assert the exact payload; `?taken=<address>`
// makes it refuse that address the way the database does. `?stale=1` refuses the first list
// replacement as CONTACT_METHODS_STALE, as if an inbound message had attached an address after the
// editor opened, and `clients` then answers with that newer list.
declare global { interface Window { __upserts: unknown[] } }
window.__upserts = [];
const taken = new URLSearchParams(window.location.search).get("taken");
let stale = new URLSearchParams(window.location.search).get("stale") === "1";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const supabase = {
  rpc: async (name: string, args: { p_patch?: { contact_methods?: Array<{ value: string }>; expected_updated_at?: string | null } }) => {
    if (name === "get_tenant_assignable_members") return { data: [{ user_id: "owner-1", full_name: "Dana Whitfield", roles: ["admin"] }], error: null };
    if (name === "upsert_contact") {
      window.__upserts.push(args);
      await wait(500);
      const clash = taken && args.p_patch?.contact_methods?.find((m) => m.value.toLowerCase() === taken.toLowerCase());
      if (args.p_patch?.contact_methods && args.p_patch.expected_updated_at === null) return { data: null, error: { message: "CONTACT_EXPECTED_VERSION_INVALID: expected_updated_at must be a timestamp" } };
      if (stale && args.p_patch?.contact_methods) {
        stale = false;
        return { data: null, error: { message: "CONTACT_METHODS_STALE: this contact changed since it was loaded" } };
      }
      if (clash) return { data: null, error: { message: `CONTACT_METHOD_TAKEN: ${clash.value} already belongs to another contact in this workspace` } };
      return { data: "harness-contact-1", error: null };
    }
    return { data: null, error: { message: `unstubbed rpc ${name}` } };
  },
  from: (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => table !== "clients" ? { data: null, error: { message: `unstubbed table ${table}` } } : {
        data: {
          updated_at: "2026-09-29T02:00:00.123456+00:00",
          client_contact_methods: [
            { id: "e1", kind: "email", value: "jordan@reyesbuild.co", label: "Work", is_primary: true, position: 0 },
            { id: "e2", kind: "email", value: "jordan.reyes.home@fastmail.com", label: "Personal", is_primary: false, position: 1 },
            { id: "e3", kind: "email", value: "accounts@reyesbuild.co", label: "Billing", is_primary: false, position: 2 },
            { id: "e4", kind: "email", value: "hello@reyesbuild.co", label: "Work", is_primary: false, position: 3 },
            { id: "e5", kind: "email", value: "jordan@reyes-projects.co", label: null, is_primary: false, position: 4 },
            { id: "p1", kind: "phone", value: "+1 (512) 555-0148", label: "Mobile", is_primary: true, position: 0 },
            { id: "p2", kind: "phone", value: "(512) 555-0190", label: "Work", is_primary: false, position: 1 },
          ],
        },
        error: null,
      },
    };
    return chain;
  },
};
