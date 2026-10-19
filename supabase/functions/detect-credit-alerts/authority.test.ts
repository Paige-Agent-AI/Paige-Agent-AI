// Drift: the entitlement detect-credit-alerts enforces is the SAME per-business expression the SQL
// persona resolver uses, read through the ONE TS reader — never a third copy.
//
// The SQL source of truth today is the newest `get_paige_persona_context` definition in
// supabase/migrations (its live production body was read on 2026-10-19 and carries the same text).
// When the planned canonical `_tenant_finance_entitled` lands (E09 F1a), its newest definition is
// held to the same predicate here too.
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

Deno.test("SQL: when _tenant_finance_entitled exists, it carries the same expression", () => {
  const def = newestDefinition("_tenant_finance_entitled");
  if (!def) return; // F1a not merged yet; the persona expression above is the source today.
  for (const frag of SQL_PREDICATE) assert(def.body.includes(frag), `${def.file} is missing: ${frag}`);
});

Deno.test("TS: resolveFinanceEntitlement reads the same two legs", () => {
  const src = Deno.readTextFileSync(GATE);
  const start = src.indexOf("export async function resolveFinanceEntitlement(");
  assert(start >= 0, "resolveFinanceEntitlement is exported from the gate");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  for (const frag of [
    '.from("marketplace_installs")',
    '.eq("tenant_id", tenantId)',
    '.eq("status", "active")',
    '.from("marketplace_items")',
    '.eq("is_finance", true)',
    '.from("tenants")',
    "finance_in_scope === true",
  ]) assert(body.includes(frag), `resolveFinanceEntitlement is missing: ${frag}`);
  // A read error never resolves "entitled".
  assertEquals((body.match(/return "read_error"/g) ?? []).length >= 3, true);
});

Deno.test("detect-credit-alerts reads the entitlement only through the shared reader", () => {
  const src = Deno.readTextFileSync(AUTHORITY);
  assert(src.includes('import { resolveFinanceEntitlement, type FundingGateDb } from "../_shared/funding-coaching-gate.ts"'));
  assert(!/marketplace_installs|marketplace_items|finance_in_scope"\)/.test(src.replace(/^\/\/.*$/gm, "")),
    "no second copy of the predicate in the function");
});
