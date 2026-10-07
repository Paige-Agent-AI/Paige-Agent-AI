import { supabase as sharedSupabase } from "../connections-mount/supabase-stub";
import { analyticsFixture } from "./analytics-fixture";

/** Settings-harness extension used only by the PAIGE rendered drive. */
export const supabase = {
  ...sharedSupabase,
  rpc: (name: string, args?: Record<string, unknown>) => name === "issue_analytics_evidence_bundle" && args?.p_metric_key
    ? Promise.resolve({ data: analyticsFixture(args), error: null })
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
