// Synthetic post-worker projection ONLY. Does not simulate a live lead or provider.
export * from "../exp03-composer-inline-check-mount/stubs";
import { supabase as original, TENANT } from "../exp03-composer-inline-check-mount/stubs";
const scenario = new URLSearchParams(location.search).get("draft") ?? "eligible";
const CONTACT = "e0300000-0000-4000-8000-0000000c0001";
const APPROVAL = "e0300000-0000-4000-8000-0000000a0101";
const draft = {
  id: APPROVAL, tenant_id: scenario === "foreign" ? "11111111-1111-4111-8111-111111111111" : TENANT,
  contact_id: CONTACT, status: "pending", type: "other", category: "owner.lead_followup",
  source: "growth_form", metadata: {},
  draft_content: scenario === "malformed" ? {} : { channel: "email", subject: "Your kitchen inquiry", body: "Thanks for asking. Would Thursday suit an introductory call?" },
};
export const supabase = {
  ...original,
  rpc: async (name: string, args: unknown) => name === "is_tenant_admin"
    ? { data: scenario !== "member", error: null } : original.rpc(name, args),
  from: (table: string) => {
    const base = original.from(table);
    const filters: Array<[string, unknown]> = [];
    let history = false;
    const query: Record<string, unknown> = new Proxy({}, { get(_target, prop) {
      const result = async () => {
        if (table === "paige_approval_queue_v") {
          if (scenario === "error") return { data: null, error: { message: "Synthetic unavailable queue" } };
          const items = ["hourly", "contact", "optout"].includes(scenario) ? [] : [draft];
          return { data: items.filter(row => filters.every(([key, value]) => row[key as keyof typeof row] === value)), error: null, count: items.length };
        }
        // Existing entry's read-only attempt-history check has no prior send.
        if (table === "messages" && history) return { data: [], error: null };
        return await base;
      };
      if (prop === "then") return (done: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => result().then(done, fail);
      if (prop === "single" || prop === "maybeSingle") return async () => ({ data: (await result()).data?.[0] ?? null, error: null });
      if (prop === "eq") return (key: string, value: unknown) => { filters.push([key, value]); if (key.includes("comms_email_binding")) history = true; return query; };
      return () => query;
    } });
    return query;
  },
};
