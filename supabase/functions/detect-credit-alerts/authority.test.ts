// Drift: the entitlement detect-credit-alerts enforces is the SAME per-business expression the SQL
// persona resolver uses, read through the ONE TS reader — never a third copy.
//
// The SQL source of truth today is the newest `get_paige_persona_context` definition in
// supabase/migrations (its live production body was read on 2026-10-19 and carries the same text).
// E09 F1a added the canonical `_tenant_finance_entitled`; its newest definition is held to the same
// predicate here, and F1b's edge reader is held to calling it.
//
// Run with: --allow-read=supabase/functions,supabase/migrations (see handler.test.ts).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS = "supabase/migrations";
const GATE = "supabase/functions/_shared/funding-coaching-gate.ts";
const AUTHORITY = "supabase/functions/detect-credit-alerts/authority.ts";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

function newestDefinition(fn: string): { file: string; body: string } | null {
  const re = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${fn}\\s*\\(`, "i");
  const files = [...Deno.readDirSync(MIGRATIONS)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const text = Deno.readTextFileSync(`${MIGRATIONS}/${files[i]}`);
    const m = re.exec(text);
    if (!m) continue;
    // The definition runs to its closing dollar-quote; take a generous window after the header.
    return { file: files[i], body: norm(text.slice(m.index, m.index + 20000)) };
  }
  return null;
}

/** The SQL predicate, as normalized fragments. Every one must appear in the definition. */
const SQL_PREDICATE = [
  "from public.marketplace_installs mi",
  "join public.marketplace_items it on it.id = mi.item_id",
  "mi.status = 'active'",
  "it.is_finance",
  "'finance_in_scope'",
];

Deno.test("SQL: the newest get_paige_persona_context carries the install-OR-flag finance expression", () => {
  const def = newestDefinition("get_paige_persona_context");
  assert(def, "get_paige_persona_context is defined in a migration");
  for (const frag of SQL_PREDICATE) assert(def.body.includes(frag), `${def.file} is missing: ${frag}`);
  assert(/is_finance( = true)?\s*\)\s*or\s*\(t\.features ->> 'finance_in_scope'\)/.test(def.body),
    `${def.file}: the two legs are joined by OR (install OR flag)`);
});

Deno.test("SQL: _tenant_finance_entitled (E09 F1a) carries the same expression", () => {
  const def = newestDefinition("_tenant_finance_entitled");
  assert(def, "_tenant_finance_entitled is defined in a migration");
  for (const frag of SQL_PREDICATE) assert(def.body.includes(frag), `${def.file} is missing: ${frag}`);
  assert(/is_finance( = true)?\s*\)\s*or\s*\(t\.features ->> 'finance_in_scope'\)/.test(def.body),
    `${def.file}: the two legs are joined by OR (install OR flag)`);
});

Deno.test("TS: resolveFinanceEntitlement asks the database for that predicate (E09 F1b), never a copy", () => {
  const src = Deno.readTextFileSync(GATE);
  const start = src.indexOf("export async function resolveFinanceEntitlement(");
  assert(start >= 0, "resolveFinanceEntitlement is exported from the gate");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert(body.includes("financeEntitled(db, tenantId)"), "it delegates to the one edge reader");
  assert(src.includes('import { financeEntitled, type FinanceRpcDb } from "./finance-entitlement.ts";'));
  const reader = Deno.readTextFileSync("supabase/functions/_shared/finance-entitlement.ts");
  assert(reader.includes('db.rpc("_tenant_finance_entitled", { _tenant: tenantId })'), "the reader calls the SQL predicate");
  // A read error never resolves "entitled".
  assert(/if \(error\) \{[\s\S]*?return "read_error";/.test(reader), "an RPC error is read_error");
  assert(/return data === true \? "entitled" : "not_entitled";/.test(reader), "only an explicit true is entitled");
});

Deno.test("detect-credit-alerts reads the entitlement only through the shared reader", () => {
  const src = Deno.readTextFileSync(AUTHORITY);
  assert(src.includes('import { resolveFinanceEntitlement, type FundingGateDb } from "../_shared/funding-coaching-gate.ts"'));
  assert(!/marketplace_installs|marketplace_items|finance_in_scope"\)/.test(src.replace(/^\/\/.*$/gm, "")),
    "no second copy of the predicate in the function");
});
