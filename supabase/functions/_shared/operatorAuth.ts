// Platform-operator guard for edge functions that act on PLATFORM resources (the platform's own
// Apollo / Cal.com / DocuSign / Firecrawl accounts, or any user on the platform).
//
// Owner ruling 2026-10-26 (EXP08 stage 0): owning or administering one business must never carry
// admin power into another. `_shared/adminAuth.ts` `requireAdmin` answers on the GLOBAL
// `user_roles` row `admin`, which `trg_sync_tenant_member_to_user_roles` writes for an owner/admin
// seat in ANY workspace — so today every workspace owner passes it, for platform-wide actions.
// Those actions belong to the Platform Operator (§53: super_admin OR platform_admin), so they gate
// on `is_platform_operator()` from the caller's VERIFIED JWT instead.
//
// ONE implementation of the operator check (§18): this wraps `operatorUserId` from
// `systems-check-http.ts`, the check send-beta-launch-email / alerting-* / systems-check-run-operator
// already use, so the two can never disagree about who counts as an operator.
//
// WHY A NEW FILE AND NOT AN EDIT TO adminAuth.ts. `.github/scripts/edge-affected.py` deploys every
// function that transitively imports a changed file. Changing adminAuth.ts would deploy its 28
// importers, including the four `paige-plaid-*` functions that are NOT deployed today. A new file
// is only in the bundles of the functions that import it.
//
// Shape-compatible with `requireAdmin` ({ ok, userId, admin } | { ok:false, response }) so a call
// site changes one identifier. 401 when there is no bearer token at all; 403 for everything else
// that is not a verified operator (invalid token, a check error, or a non-operator) — fail closed.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { adminClient, operatorUserId } from "./systems-check-http.ts";

export const operatorCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function refusal(status: 401 | 403, error: "unauthorized" | "forbidden"): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...operatorCorsHeaders, "Content-Type": "application/json" },
  });
}

export type OperatorGuard =
  | { ok: true; userId: string; admin: SupabaseClient }
  | { ok: false; response: Response };

export interface OperatorGuardDeps {
  /** Verified operator uid for this request, or null. Defaults to `operatorUserId`. */
  resolveOperator?: (req: Request) => Promise<string | null>;
  /** Service-role client factory. Defaults to systems-check-http `adminClient`. */
  makeAdmin?: () => SupabaseClient;
}

export async function requireOperator(req: Request, deps: OperatorGuardDeps = {}): Promise<OperatorGuard> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S/.test(auth)) return { ok: false, response: refusal(401, "unauthorized") };
  let userId: string | null = null;
  try {
    userId = await (deps.resolveOperator ?? operatorUserId)(req);
  } catch (e) {
    // Loud, never swallowed (§32): an error here is a refusal, not a pass.
    console.error("[operatorAuth] operator check failed:", (e as Error)?.message ?? String(e));
    userId = null;
  }
  if (!userId) return { ok: false, response: refusal(403, "forbidden") };
  return { ok: true, userId, admin: (deps.makeAdmin ?? adminClient)() };
}
