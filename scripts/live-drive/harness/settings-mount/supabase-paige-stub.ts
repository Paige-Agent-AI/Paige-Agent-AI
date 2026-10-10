import { supabase as sharedSupabase } from "../connections-mount/supabase-stub";
import { analyticsFixture } from "./analytics-fixture";

/** Settings-harness extension used only by the PAIGE rendered drive. */
const references = new Map<string, ReturnType<typeof analyticsFixture>>();
let referenceId = 0;
function analyticsRpc(name: string, args?: Record<string, unknown>) {
  if (new URLSearchParams(window.location.search).get("analytics-permission") === "denied") return Promise.resolve({ data: null, error: { code: "42501" } });
  if (name === "resolve_analytics_evidence_reference") return Promise.resolve({ data: references.get(String(args?.p_evidence_ref)) ?? null, error: null });
  const result = analyticsFixture(args ?? {});
  result.evidence_ref = `aneb_v1_${(++referenceId).toString(16).padStart(64, "0")}`;
  references.set(result.evidence_ref, result);
  return Promise.resolve({ data: result, error: null });
}
export const supabase = {
  ...sharedSupabase,
  rpc: (name: string, args?: Record<string, unknown>) => (name === "issue_analytics_evidence_bundle" && args?.p_metric_key) || name === "resolve_analytics_evidence_reference"
    ? analyticsRpc(name, args)
    : sharedSupabase.rpc(name, args),
  auth: {
    ...sharedSupabase.auth,
    getSession: () => Promise.resolve({
      data: {
        session: {
          access_token: "harness-access-token",
          user: { id: "harness-user" },
        },
      },
      error: null,
    }),
  },
};

export default { supabase };
