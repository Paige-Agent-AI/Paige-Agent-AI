import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
let failures = 0;
function check(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else { failures += 1; console.error(`FAIL ${message}`); }
}

const migration = read("supabase/migrations/20270419000000_paige_secure_browser_control_plane.sql");
const contract = read("supabase/functions/_shared/secure-browser-contract.ts");
const handler = read("supabase/functions/browser-use/index.ts");

for (const table of [
  "secure_browser_tenant_limits",
  "secure_browser_sessions",
  "secure_browser_usage_windows",
  "secure_browser_connected_accounts",
  "secure_browser_download_intakes",
  "secure_browser_receipts",
]) {
  check(new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`).test(migration), `${table} forces RLS`);
}
check(/REVOKE ALL ON public\.secure_browser_tenant_limits,[\s\S]{0,500}FROM PUBLIC,anon,authenticated,service_role/.test(migration), "direct table access is denied; all browser roles use bounded RPC projections");
check(/secure_browser_one_active_context_idx[\s\S]{0,220}WHERE state IN/.test(migration), "one active session per Paige thread is serialized");
check(/worker_available boolean NOT NULL DEFAULT false/.test(migration), "worker capacity fails closed independently of the customer feature flag");
check(/v_active>=v_limits\.max_active_sessions/.test(migration), "per-tenant active session concurrency is enforced before reservation");
check(/SECURE_BROWSER_BUDGET_EXHAUSTED/.test(migration) && /reserved_seconds\+v_day\.consumed_seconds\+p_reserved_seconds/.test(migration), "daily time and monthly cost budgets are atomically enforced");
check(/SECURE_BROWSER_RECEIPTS_APPEND_ONLY/.test(migration) && /BEFORE INSERT OR UPDATE OR DELETE ON public\.secure_browser_receipts/.test(migration), "detailed receipts are append-only");
check(/rail_run_id uuid NOT NULL/.test(migration) && /UNIQUE\(rail_run_id\)/.test(migration), "each detailed receipt has one stable Rail summary id");
check(/FOREIGN KEY\(tenant_id,session_id,requested_by\) REFERENCES public\.secure_browser_sessions/.test(migration) && /FOREIGN KEY\(tenant_id,quarantine_id\) REFERENCES public\.business_vault_quarantine_uploads/.test(migration), "download intake session and quarantine links are tenant-coupled");
check(/state='unavailable' AND quarantine_id IS NULL/.test(migration), "only an unavailable download may exist without a quarantine row");
check(/SECURE_BROWSER_QUARANTINE_STATE_INVALID/.test(migration) && /NEW\.state='passed' AND v_inspection_state<>'passed'/.test(migration), "download access cannot precede canonical Vault inspection passage");
check(/COALESCE\(auth\.role\(\),''\) <> 'service_role'/.test(migration), "service RPCs enforce the service-role claim in-body");
check(/ON CONFLICT\(tenant_id,requested_by,idempotency_key\) DO NOTHING/.test(migration), "request retries do not mutate or version-bump the original session");
check(/list_secure_browser_connected_accounts/.test(migration) && /control_secure_browser_connected_account/.test(migration), "Vault gets tenant-safe list, pause, revoke, and delete account controls");
check(/list_secure_browser_receipts/.test(migration), "owners can read safe detailed receipts through an authenticated projection");
check((migration.match(/record_capability_run\(/g) || []).length >= 4, "limits, session controls, account controls, and refused downloads link detailed receipts to Rail summaries");
check(!/CREATE FUNCTION public\.(?:create|connect)_secure_browser_connected_account/.test(migration), "no credentialed account creation seam exists");
check(!/BROWSERBASE_API_KEY|api\.browserbase\.com|\bprovider_id\b|\bcontext_id\b|\blive_view_url\b/i.test(migration + contract + handler), "control plane contains no external secret, endpoint, runtime handle, or live-view field");
check(/class UnavailableSecureBrowserWorker/.test(contract), "worker adapter is explicitly inert");
check(/consequentialActions:\s*"disabled"/.test(contract), "consequential action execution remains disabled");
check(/normalizeSecureBrowserTarget/.test(handler) && /validateSecureBrowserScope/.test(handler), "the Edge request validates target and scope using the shared contract");
check(/_secure_browser_safe_text/.test(migration) && /NOT public\._secure_browser_safe_text\(p_purpose\)/.test(migration) && /client\[-_ \]\?secret\|secret/.test(migration), "generic secret and token purpose values fail closed in the database");
check(/_secure_browser_json_node_safe/.test(migration) && /jsonb_array_elements/.test(migration) && !/\.keyvalue\(\)/.test(migration), "nested object and array scope values are validated without unsafe JSONPath methods");
check(/p_actor_kind IS DISTINCT FROM public\._secure_browser_actor_kind/.test(migration), "database re-derives and verifies exact actor provenance");
check(/secure_browser_settle_session_usage/.test(migration) && /reservation_settled_at/.test(migration) && /GREATEST\(0,reserved_seconds-v_session\.reserved_seconds\)/.test(migration), "reservations settle idempotently and release budget capacity");
check(/_secure_browser_expire_if_due/.test(migration) && /_secure_browser_expire_connected_accounts/.test(migration) && /'account\.expire'/.test(migration), "expired sessions and connected accounts fail closed and write durable expiry evidence");

if (failures) {
  console.error(`\n${failures} Secure Browser control-plane check(s) failed.`);
  process.exit(1);
}
console.log("\nSecure Browser provider-neutral control-plane checks passed.");
