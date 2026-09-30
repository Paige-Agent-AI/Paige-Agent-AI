import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const migrationDir = path.join(root, "supabase", "migrations");
const migrationName = fs.readdirSync(migrationDir).find((name) => name.endsWith("_secure_browser_session_tenant_scope.sql"));
let failures = 0;

function check(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else { failures += 1; console.error(`FAIL ${message}`); }
}

check(Boolean(migrationName), "tenant-scope migration exists");
const migration = migrationName ? fs.readFileSync(path.join(migrationDir, migrationName), "utf8") : "";
check(/ADD COLUMN tenant_id uuid/i.test(migration), "browser_use_sessions gains tenant_id");
check(/ALTER COLUMN tenant_id SET NOT NULL/i.test(migration), "tenant attribution cannot remain null");
check(/browser_use_sessions_invoker_kind_check[\s\S]*'agency'/.test(migration), "browser session provenance supports authorized representatives without relabeling");
check(/paige_skill_runs_invoker_kind_check[\s\S]*'agency'/.test(migration), "skill-run provenance supports authorized representatives without relabeling");
check(/FORCE ROW LEVEL SECURITY/i.test(migration), "browser session ledger forces RLS");
check(/REFERENCES public\.tenants\s*\(id\)/i.test(migration), "tenant_id has a tenant foreign key");
check(/guard_browser_use_session_tenant/.test(migration), "same-tenant object trigger exists");
check(/browser_use_sessions_legacy_quarantine/.test(migration) && /REVOKE ALL[\s\S]*PUBLIC, anon, authenticated/.test(migration), "unattributable legacy rows move to a locked quarantine");
check(/related_contact_id is outside the session tenant/.test(migration), "contact mismatch fails closed");
check(/related_business_id is outside the session tenant/.test(migration), "business mismatch fails closed");

const interpreter = read("supabase/functions/_shared/skill-interpreter.ts");
check(/from\("browser_use_sessions"\)[\s\S]{0,600}tenant_id:\s*tenantId/.test(interpreter), "skill writer stamps its resolved tenant");
check(/browser_evidence_unavailable/.test(interpreter), "skill navigation stops when evidence creation fails");

const browserUse = read("supabase/functions/browser-use/index.ts");
check(/auth\.getUser\(token\)/.test(browserUse), "browser-use authenticates the JWT in-function");
check(/active_tenant_id/.test(browserUse) && /is_tenant_admin_as/.test(browserUse), "browser-use resolves active workspace and authority server-side");
check(!/invoker_user_id\s*,\s*invoker_kind\s*}\s*=\s*body/.test(browserUse), "browser-use does not trust body identity");
check(!/BROWSERBASE_API_KEY|api\.browserbase\.com|browserbase_session_id|replay_url/i.test(browserUse), "vendor execution remains hard-disabled while gates are open");
check(/from\("tenants"\)[\s\S]{0,250}select\("features"\)/.test(browserUse) && /features\.secure_browser !== true/.test(browserUse), "feature flag is read from the exact resolved tenant");
check(/agency_can_manage_child/.test(browserUse), "authorized agency representative path is preserved");
check(/from\("tenant_members"\)\.select\("role,is_owner,status"\)/.test(browserUse) && /directRole === "owner"[\s\S]{0,100}\? "owner"[\s\S]{0,180}"authorized_representative"/.test(browserUse), "browser-use records exact owner/admin/authorized-representative provenance truthfully");
check(/normalizeSecureBrowserPurpose/.test(browserUse), "browser-use refuses credential-like purpose values before persistence");
check(!/from\("browser_use_sessions"\)\.insert/.test(browserUse), "Paige Secure Browser no longer writes into the public-research evidence table");
check(/secure_browser_request_unavailable/.test(browserUse), "Paige Secure Browser uses its provider-neutral control-plane request boundary");
check(/recordCapabilityRun\(admin,[\s\S]{0,260}runId:\s*receiptId/.test(browserUse), "the detailed receipt id anchors the separate Rail summary");

const runner = read("supabase/functions/skill-runner/index.ts");
const authority = read("supabase/functions/_shared/secure-browser-authority.ts");
check(/actorUserId = await deps\.authenticate\(presented\)[\s\S]*resolveContactTenant/.test(authority), "direct skill browser caller authenticates before tenant/contact lookup");
check(/invocationKind = "mcp"/.test(authority) && /invocationKind = platformOwner \? "platform_owner" : directAdmin \? "admin" : "agency"/.test(authority), "invocation channel is separate from verified owner, admin, or agency authority");
check(/secureBrowserNeedsAdminConfirmation/.test(runner), "first-N confirmation uses truthful browser invocation provenance");
check(/isTenantAdmin:[\s\S]*is_tenant_admin_as/.test(runner) && /canAgencyManage:[\s\S]*agency_can_manage_child/.test(runner), "internal browser caller actor is re-authorized");
// ORDERING IS AN EXECUTION CLAIM, SO IT IS MEASURED INSIDE THE REQUEST HANDLER.
//
// This assertion used to compare `indexOf` across the WHOLE FILE, and that cannot express what it
// claims: helpers are DECLARED above `Deno.serve` and CALLED from inside it, so a file-wide compare
// puts a declaration site against a call site. `runDraftAndEmailDocument` is declared at L354 and
// writes its run rows at L495 and L561 — textually before the authority call at L644 — but it is
// INVOKED at L679, which is after it. The source ordering was correct the whole time; the check was
// reading the file, not the flow, and it went red the moment that helper was hoisted above the
// handler. Scoping to the handler body is what makes this an ordering proof rather than a layout one.
//
// It also now fails CLOSED. Every landmark must be FOUND: a rename previously made `indexOf` return
// -1, and `-1 < n` is true, so the check would have passed while proving nothing.
const handlerStart = runner.indexOf("Deno.serve(");
const handlerBody = handlerStart === -1 ? "" : runner.slice(handlerStart);
const authorityAt = handlerBody.indexOf("resolveBrowserAuthority(req, body, admin)");
const directRunRowAt = handlerBody.indexOf('.from("paige_skill_runs")');
// The run-row-writing helper is a second way a row could land early, so its INVOCATION is ordered too.
const runRowHelperAt = handlerBody.indexOf("runDraftAndEmailDocument(body");
check(
  handlerStart !== -1 && authorityAt !== -1 && directRunRowAt !== -1 && runRowHelperAt !== -1 &&
    authorityAt < directRunRowAt && authorityAt < runRowHelperAt,
  "browser authority resolves before any run row is written",
);
check(/const hasBrowserStep = browserToolAllowed\(skill as SkillRow\)/.test(runner), "browser authority gate uses the interpreter canonical tool normalizer");

const generatedTypes = read("src/integrations/supabase/types.ts");
const browserTypeBlock = generatedTypes.slice(generatedTypes.indexOf("browser_use_sessions:"), generatedTypes.indexOf("build_milestones:"));
check((browserTypeBlock.match(/tenant_id:/g) || []).length >= 2, "generated browser-session types carry tenant_id");

const guard = read("services/paige-browser/ssrf-guard.mjs");
const server = read("services/paige-browser/server.js");
check(/export function requestMethodBlockReason/.test(guard), "shared read-only request-method policy exists");
check(/export async function installReadOnlyBrowserEgress/.test(guard), "shared browser-context egress installer exists");
check((server.match(/installReadOnlyBrowserEgress\(ctx\)/g) || []).length >= 2, "both browser routes install the context egress fence");
check((server.match(/installReadOnlyBrowserEgress\(ctx\);[\s\S]{0,80}ctx\.newPage\(\)/g) || []).length >= 2, "both browser contexts are fenced before their first page exists");
check((server.match(/serviceWorkers:\s*"block"/g) || []).length >= 2, "both browser contexts block service workers");
check(/routeWebSocket\("\*\*\/\*"/.test(guard), "shared browser egress fence blocks WebSockets");

if (failures) {
  console.error(`\n${failures} Secure Browser security check(s) failed.`);
  process.exit(1);
}
console.log("\nSecure Browser prerequisite security checks passed.");
