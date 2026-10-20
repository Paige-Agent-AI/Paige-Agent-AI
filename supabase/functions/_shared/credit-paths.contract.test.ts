// Credit paths refuse a customer-tier caller, and never trust the global `admin` role across
// businesses (E09 F1b). SOURCE CONTRACT — a static reading of each shipped handler, not a drive.
// The two shared writers (sync-credit-report-data, paige-apply-extraction) are DRIVEN in
// scripts/sync-credit-report-data and scripts/apply-extraction; the helper they call is unit-tested
// in finance-entitlement.test.ts. What this file proves for the rest: the check is present, it runs
// BEFORE the first table read, storage access, provider fetch or model call after sign-in, and any
// id taken from the request body is resolved to the caller's own business before it is used.
//
// Run: deno test --allow-read=supabase/functions --node-modules-dir=none --deny-net --deny-env \
//        --deny-write --deny-run --deny-ffi --deny-sys supabase/functions/_shared/credit-paths.contract.test.ts

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (fn: string) =>
  Deno.readTextFileSync(`supabase/functions/${fn}/index.ts`)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Index of the first data access after `from` (a table/RPC read, storage, fetch or model call). */
function firstAccessAfter(src: string, from: number): number {
  const re = /\.from\(|\.storage\b|\bfetch\(|gatewayCompat|\.rpc\("(?!_user_is_portal_customer_only)/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // the tier check's own RPC is not a data access
    const line = src.slice(src.lastIndexOf("\n", m.index), src.indexOf("\n", m.index));
    if (/refuseCustomerTier|check_rate_limit/.test(line)) continue;
    return m.index;
  }
  return Number.POSITIVE_INFINITY;
}

const FUNCTIONS: { fn: string; signIn: RegExp }[] = [
  { fn: "analyze-credit-report", signIn: /auth\.getUser\(token\)/ },
  { fn: "generate-lender-summary", signIn: /auth\.getUser\(token\)/ },
  { fn: "isoftpull-initiate", signIn: /auth\.getUser\(/ },
  { fn: "calculate-credit-factors", signIn: /auth\.getUser\(/ },
  { fn: "generate-credit-predictions", signIn: /userClient\.auth\.getUser\(\)/ },
  { fn: "extract-business-credit-report", signIn: /auth\.getUser\(/ },
  { fn: "sync-business-credit-bureaus", signIn: /auth\.getUser\(/ },
  { fn: "generate-funding-projection", signIn: /auth\.getUser\(/ },
  { fn: "match-funding-products", signIn: /auth\.getUser\(/ },
  { fn: "backfill-credit-extractions", signIn: /auth\.getUser\(/ },
];

for (const { fn, signIn } of FUNCTIONS) {
  Deno.test(`${fn}: a customer-tier caller is refused before any data access`, () => {
    const src = read(fn);
    assert(/from "\.\.\/_shared\/finance-entitlement\.ts"/.test(src), "imports the shared credit checks");
    const auth = src.search(signIn);
    assert(auth >= 0, "sign-in located");
    const tier = src.indexOf("refuseCustomerTier(", auth);
    assert(tier > auth, "refuseCustomerTier runs after sign-in");
    const firstAccess = firstAccessAfter(src, auth + 1);
    assert(tier < firstAccess, `the tier check (at ${tier}) precedes the first data access (at ${firstAccess})`);
    assert(/if \(!tier\.ok\)/.test(src.slice(tier, tier + 400)), "a refusal returns");
  });

  Deno.test(`${fn}: the global admin role is not a cross-business pass`, () => {
    const src = read(fn);
    assert(!/has_role/.test(src), "no has_role(…, 'admin') check");
    assert(!/from\("user_roles"\)/.test(src), "no user_roles admin lookup");
  });
}

Deno.test("analyze-credit-report and generate-lender-summary: another person's record needs staff of ITS business", () => {
  for (const [fn, tenantExpr] of [
    ["analyze-credit-report", "upload.tenant_id"],
    ["generate-lender-summary", "businesses?.tenant_id"],
  ] as const) {
    const src = read(fn);
    const i = src.indexOf("staffOfBusiness(supabase, user.id,");
    assert(i > 0, `${fn}: staffOfBusiness is called`);
    assert(src.slice(i, i + 120).includes(tenantExpr), `${fn}: scoped to ${tenantExpr}`);
  }
});

Deno.test("calculate-credit-factors: a body client_id is checked with can_access_contact before the credit reads", () => {
  const src = read("calculate-credit-factors");
  const check = src.indexOf("contactAccessible(supabase, userId, clientId)");
  const reads = src.indexOf('.from("credit_accounts")');
  assert(check > 0 && reads > check, JSON.stringify({ check, reads }));
});

Deno.test("generate-credit-predictions: someone else's predictions need staff standing (staffOfSubject)", () => {
  const src = read("generate-credit-predictions");
  assert(src.includes("staffOfSubject(supabase, userRes.user.id, String(body.user_id))"));
});

Deno.test("extract-business-credit-report: a body business_id is resolved before the file is stored", () => {
  const src = read("extract-business-credit-report");
  const check = src.indexOf("staffOfBusiness(supabase, user.id, biz.tenant_id");
  const store = src.indexOf('.from("business-credit-reports")');
  assert(check > 0 && store > check, JSON.stringify({ check, store }));
});

Deno.test("backfill-credit-extractions: a bulk run is platform-owner only; a targeted run needs staff standing", () => {
  const src = read("backfill-credit-extractions");
  const owner = src.indexOf('rpc("is_platform_owner", { _user_id: user.id })');
  const subject = src.indexOf("staffOfSubject(supabase, user.id, singleUserId)");
  const query = src.indexOf('.from("credit_report_uploads")');
  assert(owner > 0 && subject > 0 && query > owner && query > subject, JSON.stringify({ owner, subject, query }));
});
