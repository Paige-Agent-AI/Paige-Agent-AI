// Stubbed client for the People contact-methods harness. `upsert_contact` echoes what it was
// sent into `window.__upserts` so a drive can assert the exact payload; `?taken=<address>`
// makes it refuse that address the way the database does.
declare global { interface Window { __upserts: unknown[] } }
window.__upserts = [];
const taken = new URLSearchParams(window.location.search).get("taken");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const supabase = {
  rpc: async (name: string, args: { p_patch?: { contact_methods?: Array<{ value: string }> } }) => {
    if (name === "get_tenant_assignable_members") return { data: [{ user_id: "owner-1", full_name: "Dana Whitfield", roles: ["admin"] }], error: null };
    if (name === "upsert_contact") {
      window.__upserts.push(args);
      await wait(500);
      const clash = taken && args.p_patch?.contact_methods?.find((m) => m.value.toLowerCase() === taken.toLowerCase());
      if (clash) return { data: null, error: { message: `CONTACT_METHOD_TAKEN: ${clash.value} already belongs to another contact in this workspace` } };
      return { data: "harness-contact-1", error: null };
    }
    return { data: null, error: { message: `unstubbed rpc ${name}` } };
  },
};
