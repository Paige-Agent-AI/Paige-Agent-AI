// Isolated SDK/record fixture. No credentials, server, account or real persistence.
import { generalDefault } from "@/lib/playbook/presets";
const tenant = "test-tenant-intake";
const actor = "test-owner";
let config = { ...structuredClone(generalDefault), intake: [{ key: "test_question", label: "Test question", type: "text" }] };
let reads = 0;
const calls: string[] = [];
(window as unknown as { intakeFixtureSnapshot: () => unknown }).intakeFixtureSnapshot = () => ({ config, calls, reads });
export const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: actor } } }) },
  from: (table: string) => ({ select: () => ({ eq: (column: string, value: string) => ({ maybeSingle: async () => {
    reads++;
    if (table === "profiles" && column === "user_id" && value === actor) return { data: { active_tenant_id: tenant } };
    if (table === "tenants" && column === "id" && value === tenant) return { data: { features: { playbook_config: structuredClone(config) } } };
    throw new Error("Unexpected fixture scope");
  } }) }) }),
  rpc: async (name: string, args: { _tenant_id: string; _config: typeof config }) => {
    if (name !== "set_tenant_playbook" || args._tenant_id !== tenant) throw new Error("Unexpected fixture writer");
    calls.push(name); config = structuredClone(args._config); return { error: null };
  },
};
