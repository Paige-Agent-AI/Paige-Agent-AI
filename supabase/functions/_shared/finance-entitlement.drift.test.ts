// Drift: the per-business finance entitlement exists ONCE, in SQL (`_tenant_finance_entitled`,
// E09 F1a), and the edge reads it ONLY by calling that function (`_shared/finance-entitlement.ts`,
// E09 F1b). These checks fail the moment the two drift apart:
//   1. the newest SQL definition still carries the persona expression (install OR flag), verbatim;
//   2. the persona resolver (get_paige_persona_context) still carries the same expression;
//   3. the TS helper calls exactly that function, with that function's parameter name, and the
//      helper's other RPCs exist in SQL under the names and parameters it passes;
//   4. the SQL predicate is service-role-only, and the RPCs the edge calls are granted to the service
//      role in their newest migration;
//   5. no edge source (outside tests and comments) reads `finance_in_scope` / `is_finance` itself, so
//      no fifth copy of the expression can grow back.
//
// Run: deno test --allow-read=supabase/functions,supabase/migrations --node-modules-dir=none \
//        --deny-net --deny-env --deny-write --deny-run --deny-ffi --deny-sys \
//        supabase/functions/_shared/finance-entitlement.drift.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS = "supabase/migrations";
const FUNCTIONS = "supabase/functions";
const HELPER = `${FUNCTIONS}/_shared/finance-entitlement.ts`;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

function migrationFiles(): string[] {
  return [...Deno.readDirSync(MIGRATIONS)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
}

/** The newest `CREATE [OR REPLACE] FUNCTION public.<fn>(` definition: its file, header args and body. */
function newestDefinition(
  fn: string,
  accept: (args: string) => boolean = () => true,
): { file: string; args: string; body: string; text: string } | null {
  const files = migrationFiles();
  for (let i = files.length - 1; i >= 0; i--) {
    const text = Deno.readTextFileSync(`${MIGRATIONS}/${files[i]}`);
    // Overloads share a name: take the newest definition whose parameter list the caller accepts.
    const re = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${fn}\\s*\\(([^)]*)\\)`, "gi");
    const m = [...text.matchAll(re)].reverse().find((x) => accept(x[2]));
    if (!m) continue;
    const start = m.index!;
    const open = text.indexOf("$function$", start);
    const close = text.indexOf("$function$", open + 10);
    return { file: files[i], args: m[2], body: norm(text.slice(open, close)), text };
  }
  return null;
}

/** The install-OR-flag expression, normalized, as it appears in both SQL homes. */
const EXPRESSION = norm(`
  EXISTS (
    SELECT 1
    FROM public.marketplace_installs mi
    JOIN public.marketplace_items it ON it.id = mi.item_id
    WHERE mi.tenant_id = t.id
      AND mi.status = 'active'
      AND it.is_finance = true
  )
  OR (t.features ->> 'finance_in_scope')::boolean`);

Deno.test("SQL: _tenant_finance_entitled carries the persona expression verbatim", () => {
  const def = newestDefinition("_tenant_finance_entitled");
  assert(def, "_tenant_finance_entitled is defined in a migration");
  assert(def.body.includes(EXPRESSION), `${def.file}: the install-OR-flag expression is not verbatim`);
  assert(/^\s*_tenant uuid\s*$/i.test(def.args), `${def.file}: the parameter is (_tenant uuid), got (${def.args})`);
  assert(def.body.includes("where t.id = _tenant"), `${def.file}: the expression is evaluated for _tenant`);
});

Deno.test("SQL: get_paige_persona_context still carries the same expression", () => {
  const def = newestDefinition("get_paige_persona_context");
  assert(def, "get_paige_persona_context is defined in a migration");
  assert(def.body.includes(EXPRESSION), `${def.file}: the persona expression drifted from _tenant_finance_entitled`);
});

/** Every `db.rpc("<name>", { <args> })` call in the helper. */
function helperRpcCalls(): { name: string; params: string[] }[] {
  const src = Deno.readTextFileSync(HELPER);
  const out: { name: string; params: string[] }[] = [];
  for (const m of src.matchAll(/db\.rpc\("([a-z_]+)",\s*\{([^}]*)\}\)/g)) {
    out.push({ name: m[1], params: [...m[2].matchAll(/(_[a-z_]+)\s*:/g)].map((p) => p[1]) });
  }
  return out;
}

Deno.test("TS: the helper calls the SQL predicate with its own parameter name", () => {
  const calls = helperRpcCalls();
  const predicate = calls.filter((c) => c.name === "_tenant_finance_entitled");
  assertEquals(predicate.length, 1, "exactly one call site for the predicate");
  assertEquals(predicate[0].params, ["_tenant"]);
});

Deno.test("TS: every RPC the helper calls exists in SQL with the parameters it passes, granted to service_role", () => {
  for (const call of helperRpcCalls()) {
    const names = (args: string) => [...args.matchAll(/(_[a-z_]+)\s+[a-z]/gi)].map((m) => m[1]);
    const def = newestDefinition(call.name, (args) => call.params.every((p) => names(args).includes(p)));
    assert(def, `${call.name} is defined in a migration with parameters ${call.params.join(",")}`);
    const declared = names(def.args);
    for (const p of call.params) assert(declared.includes(p), `${call.name}: SQL has no parameter ${p} (has ${declared.join(",")})`);
    // The grant may sit in the defining file or a later one; search every file from the definition on.
    const files = migrationFiles().filter((f) => f >= def.file);
    const granted = files.some((f) => {
      const t = norm(Deno.readTextFileSync(`${MIGRATIONS}/${f}`));
      return new RegExp(`grant execute on function public\\.${call.name}\\([^)]*\\) to [a-z_, ]*service_role`).test(t);
    }) ||
      // Pre-existing platform helpers whose service_role EXECUTE comes from the project's default
      // privileges, not a migration line (production pg_proc ACL read 2026-10-19: all three true).
      ["is_platform_owner", "is_tenant_admin_as", "can_access_contact"].includes(call.name);
    assert(granted, `${call.name} is not granted to service_role in a migration`);
  }
});

Deno.test("SQL: the predicate is service-role only", () => {
  const def = newestDefinition("_tenant_finance_entitled");
  assert(def);
  const t = norm(def.text);
  assert(t.includes("revoke all on function public._tenant_finance_entitled(uuid) from public, anon, authenticated, service_role"));
  assert(t.includes("grant execute on function public._tenant_finance_entitled(uuid) to service_role;"));
  assert(!/grant execute on function public\._tenant_finance_entitled\(uuid\) to [a-z_, ]*authenticated/.test(t));
});

function* edgeSources(dir: string): Generator<string> {
  for (const e of Deno.readDirSync(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* edgeSources(p);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.test\.(ts|tsx|mjs|js)$/.test(e.name)) yield p;
  }
}

Deno.test("edge: no source reads finance_in_scope / is_finance itself (one reader only)", () => {
  const offenders: string[] = [];
  for (const file of edgeSources(FUNCTIONS)) {
    const code = Deno.readTextFileSync(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s\/\/.*$/gm, "");
    if (/finance_in_scope|is_finance/.test(code)) offenders.push(file);
  }
  assertEquals(offenders, [], "read the entitlement through _shared/finance-entitlement.ts instead");
});
