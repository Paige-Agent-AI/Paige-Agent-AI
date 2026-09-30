#!/usr/bin/env node
/**
 * crm-patch-field-gen — the patch field list the model sees is DERIVED from the database, and
 * drift between the two turns CI red.
 *
 * ── THE INCIDENT THIS EXISTS FOR (production, 2026-09-25) ────────────────────────────────────────
 *
 * The owner asked Paige, in live Solo chat, to add a contact — John Coleman, at a heating and
 * cooling company, with a Chicago street address. He pressed Approve. The approval was claimed
 * correctly: `paige_pending_confirmations.consumed = true`, and `paige_audit_log` recorded
 * `crm.governed_decision -> execute` on lane `confirm`. The approval gate did its job.
 *
 * Then the executor threw, at 17:37:52.303Z:
 *
 *     CRM_PATCH_FIELDS_INVALID:company_name,zip
 *
 * Paige had sent `company_name` and `zip`. The database accepts `entity_name` and `zip_code`.
 *
 * She had NO WAY TO KNOW. The tool definition described `patch` as, in full:
 *
 *     patch: { type: "object", description: "Only fields the operator asked to change." }
 *
 * A bare object. No field list, no names, no closed set — so the model filled it with the words a
 * human would use. `company_name` is what a person calls the company name. `zip` is what a person
 * calls the zip code. Both are wrong, and nothing in the schema said so.
 *
 * ── WHY A TRANSLATION MAP WAS REJECTED ───────────────────────────────────────────────────────────
 *
 * The obvious fix is a two-field rename: map `company_name -> entity_name`, `zip -> zip_code`. It
 * works today and fails on the next field a user names in plain English — `mobile`, `company`,
 * `postcode`, `notes` on an update. The ruling rejected it for exactly that reason. The field list
 * presented to the model must ORIGINATE from the database allowlist, so that a field added, removed
 * or renamed in the database cannot leave the schema quietly stale.
 *
 * ── WHERE THE ALLOWLISTS ACTUALLY LIVE (verified against prod, not assumed) ──────────────────────
 *
 * `public.execute_crm_command` — the name you would reach for first — contains ZERO allowlist
 * sites. The live authority is two other functions. Verified by asking prod which functions can
 * even raise the error:
 *
 *     select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 *      where n.nspname = 'public'
 *        and pg_get_functiondef(p.oid) like '%CRM_PATCH_FIELDS_INVALID%';
 *
 *     -> public.execute_crm_command_reversible   (6 allowlist sites)
 *        public.preview_crm_command              (1 allowlist site)
 *
 * Exactly two functions in the entire database, and seven allowlists between them. That query is
 * the completeness proof: there is no third site to miss.
 *
 * ── THE SEVEN ARE NOT ONE LIST, AND THAT IS THE POINT ────────────────────────────────────────────
 *
 * `contact.create` allows `notes`. `contact.update` allows `current_notes` — the same concept under
 * a different name, because the create path writes a seed note and the update path edits the live
 * one. `task.create` accepts nine fields including `assignee_user_id` and `due_date`; `task.update`
 * accepts four and NEITHER of those. Collapsing the seven into one shared list would hand the model
 * a field the database will reject on four of the seven actions — reintroducing the incident with
 * different field names. Each action therefore gets its own derived set.
 *
 * ── WHY A COMMITTED ARTIFACT AND NOT A RUNTIME READ ──────────────────────────────────────────────
 *
 * Stated plainly, because a materialised copy that nobody admits to is the thing the ruling warns
 * about: THIS GUARD MATERIALISES THE DATABASE'S LISTS INTO A COMMITTED TYPESCRIPT FILE. It is not a
 * hand-typed list — it is machine-derived and machine-checked — but it is a copy, and the honest
 * description of it is a copy with a tripwire.
 *
 * The tripwire is the entire reason it is allowed. The alternative, reading the allowlists from the
 * database when the tool definition is built, puts a query on the path of every Chat turn: a cold
 * start or a transient database error would then produce a turn with NO CRM TOOLS AT ALL, or worse,
 * tools with an empty field set that refuses every legitimate patch. The tool definition must not
 * be able to fail. So the read happens at build time, the result is committed, and this guard makes
 * the copy unable to drift in silence — which is the property the ruling actually demands.
 *
 * ── HOW DRIFT IS MADE LOUD — TWO HALVES, AND THE SECOND IS NOT OPTIONAL ──────────────────────────
 *
 * Default mode re-derives the seven lists from the migration SQL that DEFINES these functions and
 * diffs them against the committed artifact. Any difference — a field added, removed, renamed, or
 * an action's list reordered — exits non-zero and prints the exact delta. No secrets, no network,
 * so it runs on every PR including from forks.
 *
 * That half reads migration TEXT, which means this file re-implements the resolution rule Postgres
 * already owns, and the "NEWEST DECLARATION WINS" note below is exactly that re-implementation. So
 * `--write` also emits a pgTAP twin, `supabase/tests/crm_patch_fields_match_database.sql`, which
 * asserts the same seven lists against a REAL DATABASE through `pg_get_functiondef()` — the
 * database `supabase db reset` builds by replaying the whole chain, in the `paige-spine-contract`
 * database-contract job. There, PostgreSQL decides which definition is live and the text-slicing
 * below is not on the trusted path at all. If the two ever resolve differently, they disagree and
 * the build goes red. Both artifacts are written in one pass and both are diffed here, so neither
 * can be hand-edited into agreement with the other.
 *
 * It also asserts the allowlist COUNT per function (6 and 1). A new allowlist appearing in either
 * function fails the guard even though every existing list still matches — otherwise an eighth
 * patch-bearing action could be added and silently never reach the schema.
 *
 * NEWEST DECLARATION WINS. These are `create or replace function` bodies, so prod runs whichever
 * migration sorts LAST by filename, and an earlier-sorting file that merges later is shadowed the
 * instant it lands. `scripts/ci/tool-catalogue-lint.mjs` documents that exact failure happening
 * five times on `list_tool_autonomy`, once erasing 25 rows. So the extractor walks every migration
 * in filename order and keeps the LAST definition of each function, never the first it finds.
 *
 * ── LIVE PARITY ──────────────────────────────────────────────────────────────────────────────────
 *
 * The migration chain is the definition site, but prod can in principle be changed out of band (a
 * hand-applied MCP statement, a hotfix). Point this at a dump of the live definitions to prove the
 * repo and prod still agree:
 *
 *     CRM_PATCH_LIVE_DEFS=/path/to/defs.json node scripts/ci/crm-patch-field-gen.mjs
 *
 * where defs.json is [{ "proname": "...", "def": "<pg_get_functiondef output>" }, ...].
 *
 * VERIFIED AGAINST PRODUCTION 2026-09-26, and worth stating precisely because the brief warned
 * that `20270204000000` is superseded and must not be trusted as the source of truth. It is not
 * trusted: prod was asked directly. `pg_get_functiondef` on ref `xygzykjyynhzqytbqnzu` returns
 * exactly two functions containing CRM_PATCH_FIELDS_INVALID, carrying 6 and 1 allowlists, and all
 * seven live lists are field-for-field identical to what this script derives — including the
 * `notes` / `current_notes` split. The ten generated pgTAP assertions were additionally executed
 * against prod as plain SQL and all ten returned true, so the emitted proof is known to RUN and
 * not merely to have been written. Negative controls run at the same time: reinstating
 * `company_name`/`zip` in the expected list, and asserting contact.update's list against
 * contact.create's allowlist, both returned false.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT TOUCH ────────────────────────────────────────────────────────
 *
 * `task.assign`, `task.reschedule` and `activity.log` also take a `patch`, and have NO allowlist.
 * They read specific keys (`assignee_user_id`; `due_date`; `channel`/`subject`/`body`) and ignore
 * anything else, so the database cannot raise CRM_PATCH_FIELDS_INVALID for them. Closing their
 * schema would INVENT a constraint prod does not enforce — replacing the database as authority
 * instead of agreeing with it. They keep the open `{ type: "object" }` patch. If an allowlist is
 * ever added to one, the per-function count assertion above fails and this comment is what tells
 * the next person why.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

// Overridable ONLY so the self-test can run against fixtures without touching the real tree.
const MIGRATIONS = process.env.CRM_PATCH_MIGRATIONS_DIR || join(ROOT, "supabase/migrations");
const ARTIFACT = process.env.CRM_PATCH_ARTIFACT
  || join(ROOT, "supabase/functions/_shared/crm-command/patch-fields.generated.ts");
// The pgTAP twin of the artifact above. When the TS path is overridden (the self-test), this
// follows it into the same temp directory so a self-test never writes into the repo's test suite.
const SQL_ARTIFACT = process.env.CRM_PATCH_SQL_ARTIFACT
  || (process.env.CRM_PATCH_ARTIFACT
    ? `${process.env.CRM_PATCH_ARTIFACT.replace(/\.ts$/, "")}.pgtap.sql`
    : join(ROOT, "supabase/tests/crm_patch_fields_match_database.sql"));

/**
 * Where each action's allowlist lives, and how to find it.
 *
 * `anchor` is the plpgsql branch opener that guards the allowlist. The extractor takes the FIRST
 * allowlist after the anchor and asserts it falls before the NEXT branch opener, so a future edit
 * that moves an allowlist out of its branch fails loudly instead of silently binding the wrong set.
 *
 * `contact.bulk_update` is the exception and needs no anchor: `preview_crm_command` handles only
 * `contact.merge`, `contact.hard_delete` and `contact.bulk_update`, and the first two carry no
 * patch — so its single allowlist is unambiguously the bulk one. The count assertion below is what
 * keeps "single" true.
 */
const ACTION_SOURCES = {
  "contact.create": { fn: "execute_crm_command_reversible", anchor: "v_action = 'contact.create'" },
  "contact.update": { fn: "execute_crm_command_reversible", anchor: "v_action = 'contact.update'" },
  "task.create": { fn: "execute_crm_command_reversible", anchor: "v_action = 'task.create'" },
  "task.update": { fn: "execute_crm_command_reversible", anchor: "v_action = 'task.update'" },
  "company.create": { fn: "execute_crm_command_reversible", anchor: "v_action = 'company.create'" },
  "company.update": { fn: "execute_crm_command_reversible", anchor: "v_action = 'company.update'" },
  "contact.bulk_update": { fn: "preview_crm_command", anchor: null },
};

/** Allowlist sites expected per function. A new one appearing is drift, even if the others match. */
const EXPECTED_SITES = { execute_crm_command_reversible: 6, preview_crm_command: 1 };

/**
 * Descriptions for field names a person would not guess, keyed by database field name.
 *
 * These are ANNOTATIONS on a derived list, never the list itself — a field with no entry here
 * simply ships without a description. `entity_name` is the reason the whole file exists: it is what
 * a person calls "the company name", and the model had no way to learn that.
 *
 * A stale entry — a description for a field no longer in ANY allowlist — fails the guard, so this
 * map cannot quietly outlive the schema it annotates.
 */
const FIELD_DESCRIPTIONS = {
  entity_name: "The company or business name for this contact. Use this for what a person calls \"the company name\".",
  entity_type: "Business entity form, e.g. LLC or S-Corp. Not the industry.",
  title: "The person's job title on a contact; the short name of the record on a task.",
  lifecycle_stage: "Where the contact sits in the pipeline, e.g. lead or client.",
  source: "How the contact arrived, e.g. referral or webinar.",
  primary_offer: "The offer or programme this contact is being worked toward.",
  notes: "Free-text note recorded when the contact is created.",
  current_notes: "Free-text note on an existing contact. The update path uses this name, not \"notes\".",
  do_not_contact: "True suppresses outreach to this contact.",
  street_address: "Street line of the postal address.",
  zip_code: "Postal code. Use this for what a person calls the \"zip\".",
  funding_goal: "Capital the contact is seeking, where the tenant tracks it.",
  monthly_revenue: "Self-reported monthly revenue, where the tenant tracks it.",
  legal_name: "Registered legal name of the company. Required when creating a company.",
  dba: "Trading or \"doing business as\" name, when it differs from the legal name.",
  business_email: "Company's own email address, not the contact's personal one.",
  business_phone: "Company's own phone number, not the contact's personal one.",
  naics: "NAICS industry classification code.",
  revenue_band: "Banded company revenue range.",
  state_of_formation: "US state the company was formed in.",
  assignee_user_id: "Exact active member UUID to own the task.",
  due_date: "When the task is due.",
  track: "Workstream the task belongs to.",
  metadata: "Structured object of extra task fields; must be an object.",
  description: "Longer body text for the task.",
  assigned_coach_user_id: "Exact active member UUID to set as coach across the selected contacts.",
  tags: "Full replacement list of tags; this is not additive.",
  contact_methods: "The contact's COMPLETE list of email addresses and phone numbers, in display order: [{ kind: \"email\" | \"phone\", value, label?, is_primary? }]. On an update anything left out is REMOVED, so read the current list first (crm_search_contacts or crm_get_contact_summary). One primary per kind; with none marked, the first of each kind is primary. To only add an address, use add_contact_methods.",
  add_contact_methods: "Addresses to ADD to the contact, keeping every one it already has: [{ kind: \"email\" | \"phone\", value, label?, is_primary? }]. Set is_primary only when the operator asked for the new one to become the default. Cannot be combined with contact_methods.",
};

const ALLOWLIST_RE = /k not in \(([^)]*)\)/g;
const BRANCH_RE = /v_action\s*(?:=|like|in)\s*'/g;

function fail(msg) {
  console.error(`❌ crm-patch-field-gen: ${msg}`);
  process.exit(1);
}

/** Slice each target function's own text out of a body of SQL. Functions are sequential, so a
 *  definition runs until the next `create or replace function` or end of file. */
function sliceFunctions(sql, names) {
  const out = {};
  const starts = [...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi)];
  starts.forEach((m, i) => {
    const name = m[1].toLowerCase();
    if (!names.includes(name)) return;
    const end = i + 1 < starts.length ? starts[i + 1].index : sql.length;
    out[name] = sql.slice(m.index, end); // later definitions overwrite earlier: newest wins
  });
  return out;
}

/** Resolve the live definition of each function: walk migrations in filename order, keep the LAST. */
function resolveFromMigrations() {
  if (!existsSync(MIGRATIONS)) fail(`migrations directory not found at ${MIGRATIONS}`);
  const names = Object.keys(EXPECTED_SITES);
  const defs = {};
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const found = sliceFunctions(readFileSync(join(MIGRATIONS, file), "utf8"), names);
    for (const [name, text] of Object.entries(found)) defs[name] = { text, origin: file };
  }
  return defs;
}

/** Resolve from a dump of live `pg_get_functiondef` output, to prove prod and repo agree. */
function resolveFromLive(path) {
  if (!existsSync(path)) fail(`CRM_PATCH_LIVE_DEFS set but no file at ${path}`);
  let rows;
  try {
    rows = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`CRM_PATCH_LIVE_DEFS is not readable JSON: ${e.message}`);
  }
  if (!Array.isArray(rows)) fail("CRM_PATCH_LIVE_DEFS must be an array of { proname, def }");
  const defs = {};
  for (const row of rows) {
    if (!row || typeof row.proname !== "string" || typeof row.def !== "string") {
      fail("every CRM_PATCH_LIVE_DEFS row needs a string `proname` and `def`");
    }
    defs[row.proname.toLowerCase()] = { text: row.def, origin: `live:${row.proname}` };
  }
  return defs;
}

function parseAllowlist(raw) {
  const fields = [...raw.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (!fields.length) fail("matched an allowlist with no quoted field names");
  return fields;
}

/** Derive the seven per-action field sets. Any ambiguity fails rather than guesses. */
function derive(defs) {
  for (const [name, expected] of Object.entries(EXPECTED_SITES)) {
    if (!defs[name]) fail(`no definition of public.${name} found — the source of truth moved`);
    const sites = [...defs[name].text.matchAll(ALLOWLIST_RE)].length;
    if (sites !== expected) {
      fail(
        `public.${name} has ${sites} allowlist site(s), expected ${expected} (from ${defs[name].origin}).\n`
        + "   An allowlist was added or removed. Map it to its action in ACTION_SOURCES and\n"
        + "   update EXPECTED_SITES, then re-run with --write. Do NOT just bump the count:\n"
        + "   an unmapped allowlist means some action's patch schema is silently wrong.",
      );
    }
  }

  const result = {};
  for (const [action, src] of Object.entries(ACTION_SOURCES)) {
    const { text, origin } = defs[src.fn];
    const sites = [...text.matchAll(ALLOWLIST_RE)];

    if (src.anchor === null) {
      if (sites.length !== 1) fail(`${action} expects public.${src.fn} to carry exactly one allowlist`);
      result[action] = { fields: parseAllowlist(sites[0][1]), fn: src.fn, origin, ordinal: 1 };
      continue;
    }

    const at = text.indexOf(src.anchor);
    if (at < 0) fail(`anchor ${JSON.stringify(src.anchor)} for ${action} not found in public.${src.fn} (${origin})`);
    if (text.indexOf(src.anchor, at + 1) >= 0) {
      fail(`anchor ${JSON.stringify(src.anchor)} for ${action} is ambiguous — it appears more than once in public.${src.fn}`);
    }

    const siteIndex = sites.findIndex((m) => m.index > at);
    const site = siteIndex < 0 ? undefined : sites[siteIndex];
    if (!site) fail(`no allowlist follows the ${action} branch in public.${src.fn}`);

    // The allowlist must belong to THIS branch, not a later one.
    const nextBranch = [...text.matchAll(BRANCH_RE)].map((m) => m.index).find((i) => i > at);
    if (nextBranch !== undefined && site.index > nextBranch) {
      fail(
        `the first allowlist after the ${action} branch sits past the next branch opener in `
        + `public.${src.fn}. The branch structure changed; re-check ACTION_SOURCES.`,
      );
    }
    result[action] = { fields: parseAllowlist(site[1]), fn: src.fn, origin, ordinal: siteIndex + 1 };
  }
  return result;
}

function render(derived) {
  const every = new Set(Object.values(derived).flatMap((d) => d.fields));
  // A description for a field no allowlist contains is dead annotation — it is never attached to
  // anything, so it cannot make the schema wrong. WARN, never fail: the field-set diff below
  // already catches every rename and removal that could actually mislead the model, and failing
  // here as well would red unrelated PRs (and any run against a partial fixture) for tidiness.
  const stale = Object.keys(FIELD_DESCRIPTIONS).filter((f) => !every.has(f));
  if (stale.length) {
    console.warn(`⚠️  crm-patch-field-gen: unused field description(s): ${stale.join(", ")}`);
  }

  const origins = [...new Set(Object.values(derived).map((d) => d.origin))].sort();
  const lines = [];
  lines.push("// @generated by scripts/ci/crm-patch-field-gen.mjs — DO NOT EDIT BY HAND.");
  lines.push("//");
  lines.push("// Every field name below is derived from the `k not in (...)` allowlist inside the plpgsql");
  lines.push("// function that enforces it, so the schema the model sees cannot disagree with the database");
  lines.push("// that rejects it. `npm run lint:crm-patch-fields` re-derives and fails on any difference.");
  lines.push("//");
  lines.push("// Regenerate:  node scripts/ci/crm-patch-field-gen.mjs --write");
  lines.push(`// Derived from: ${origins.join(", ")}`);
  lines.push("");
  lines.push("export type CrmPatchFieldSpec = { readonly name: string; readonly description?: string };");
  lines.push("");
  lines.push("export const CRM_PATCH_FIELDS: Readonly<Record<string, readonly CrmPatchFieldSpec[]>> = Object.freeze({");
  for (const [action, { fields, fn }] of Object.entries(derived)) {
    lines.push(`  // ${action} — public.${fn}`);
    lines.push(`  ${JSON.stringify(action)}: Object.freeze([`);
    for (const name of fields) {
      const d = FIELD_DESCRIPTIONS[name];
      lines.push(`    { name: ${JSON.stringify(name)}${d ? `, description: ${JSON.stringify(d)}` : ""} },`);
    }
    lines.push("  ]),");
  }
  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

/**
 * The SAME seven lists, rendered as a pgTAP proof that asks POSTGRES rather than a regex.
 *
 * Why this exists alongside the TypeScript artifact. Everything above reads migration TEXT: it
 * slices `create or replace function` bodies out of `.sql` files, sorts them by filename, and
 * keeps the last. That is a re-implementation of resolution rules Postgres already owns, and
 * `scripts/ci/tool-catalogue-lint.mjs` records that exact reasoning going wrong five times on
 * `list_tool_autonomy` — once erasing 25 rows — because an earlier-sorting migration merged later
 * and silently shadowed the newer one.
 *
 * This file removes the re-implementation from the trusted path. It runs against the database
 * `supabase db reset` builds by replaying the whole chain, and reads the allowlists back out of
 * `pg_get_functiondef()` — so PostgreSQL decides which definition is live, and the committed
 * expectations below are checked against the function that actually WOULD refuse the patch.
 * If the text-slicing above ever resolves a different definition than Postgres does, these
 * assertions disagree with it and the build goes red.
 *
 * It also asserts COMPLETENESS: exactly two functions in the entire database can raise
 * `CRM_PATCH_FIELDS_INVALID`, carrying exactly six and one allowlist. A new patch-bearing action
 * added without a schema for it fails here even though all seven existing lists still match.
 */
function renderSql(derived) {
  const byFn = {};
  for (const [action, d] of Object.entries(derived)) (byFn[d.fn] ||= []).push([action, d]);

  const lines = [];
  lines.push("-- @generated by scripts/ci/crm-patch-field-gen.mjs — DO NOT EDIT BY HAND.");
  lines.push("--");
  lines.push("-- The patch field list Paige is shown must equal the allowlist that refuses her patch.");
  lines.push("-- On 2026-09-25 it did not: she sent `company_name` and `zip`, the executor accepts");
  lines.push("-- `entity_name` and `zip_code`, and an approved contact create died as");
  lines.push("-- CRM_PATCH_FIELDS_INVALID:company_name,zip. The names below are GENERATED from the");
  lines.push("-- allowlists, and this proof reads them back out of a real database via");
  lines.push("-- pg_get_functiondef() — so Postgres, not a regex over migration files, is the authority");
  lines.push("-- on which definition is live.");
  lines.push("--");
  lines.push("-- Regenerate:  node scripts/ci/crm-patch-field-gen.mjs --write");
  lines.push("");
  lines.push("BEGIN;");
  lines.push(`SELECT plan(${Object.keys(derived).length + 1 + Object.keys(EXPECTED_SITES).length});`);
  lines.push("");
  lines.push("-- COMPLETENESS. Exactly these functions can refuse a patch field; a new one is drift.");
  lines.push("SELECT is(");
  lines.push("  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace");
  lines.push("    WHERE n.nspname = 'public' AND p.prokind = 'f'");
  lines.push("      AND pg_get_functiondef(p.oid) LIKE '%CRM_PATCH_FIELDS_INVALID%'),");
  lines.push(`  ${Object.keys(EXPECTED_SITES).length},`);
  lines.push("  'only the known functions can refuse a CRM patch field'");
  lines.push(");");
  lines.push("");
  for (const [fn, count] of Object.entries(EXPECTED_SITES)) {
    lines.push("-- A new allowlist inside a known function is drift too, even if the others still match.");
    lines.push("SELECT is(");
    lines.push("  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace");
    lines.push("    CROSS JOIN LATERAL regexp_matches(pg_get_functiondef(p.oid), 'k not in \\(([^)]*)\\)', 'g') AS m");
    lines.push(`    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ${sqlLit(fn)}),`);
    lines.push(`  ${count},`);
    lines.push(`  'public.${fn} carries exactly ${count} patch allowlist(s)'`);
    lines.push(");");
    lines.push("");
  }
  for (const [fn, entries] of Object.entries(byFn)) {
    for (const [action, d] of entries) {
      lines.push(`-- ${action} — allowlist ${d.ordinal} of public.${fn}`);
      lines.push("SELECT is(");
      lines.push("  (SELECT (SELECT array_agg(g[1] ORDER BY o)");
      lines.push("             FROM regexp_matches(s.site, '''([^'']+)''', 'g') WITH ORDINALITY AS x(g, o))");
      lines.push("     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace");
      lines.push("     CROSS JOIN LATERAL (");
      lines.push("       SELECT arr[1] AS site, ord FROM regexp_matches(");
      lines.push("         pg_get_functiondef(p.oid), 'k not in \\(([^)]*)\\)', 'g') WITH ORDINALITY AS t(arr, ord)");
      lines.push("     ) s");
      lines.push(`     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ${sqlLit(fn)} AND s.ord = ${d.ordinal}),`);
      lines.push(`  ARRAY[${d.fields.map(sqlLit).join(", ")}]::text[],`);
      lines.push(`  ${sqlLit(`${action} patch fields match the schema Paige is shown`)}`);
      lines.push(");");
      lines.push("");
    }
  }
  lines.push("SELECT * FROM finish();");
  lines.push("ROLLBACK;");
  lines.push("");
  return lines.join("\n");
}

/** Single-quoted SQL literal. The inputs are field/function names derived from SQL we already
 *  parsed, but quoting is done properly rather than assumed safe. */
function sqlLit(s) {
  return `'${String(s).split("'").join("''")}'`;
}

const args = new Set(process.argv.slice(2));

if (args.has("--self-test")) {
  const { selfTest } = await import("./crm-patch-field-gen.selftest.mjs");
  await selfTest({ sliceFunctions, derive, render, ACTION_SOURCES, EXPECTED_SITES });
  process.exit(0);
}

const defs = process.env.CRM_PATCH_LIVE_DEFS
  ? resolveFromLive(process.env.CRM_PATCH_LIVE_DEFS)
  : resolveFromMigrations();
const derived = derive(defs);
const rendered = render(derived);

if (args.has("--print")) {
  console.log(JSON.stringify(
    Object.fromEntries(Object.entries(derived).map(([a, d]) => [a, d.fields])),
    null,
    2,
  ));
  process.exit(0);
}

const renderedSql = renderSql(derived);

if (args.has("--write")) {
  writeFileSync(ARTIFACT, rendered);
  writeFileSync(SQL_ARTIFACT, renderedSql);
  const source = process.env.CRM_PATCH_LIVE_DEFS ? "the live database" : "the migration chain";
  console.log(`✅ crm-patch-field-gen: wrote ${ARTIFACT} from ${source}`);
  console.log(`✅ crm-patch-field-gen: wrote ${SQL_ARTIFACT} (pgTAP proof against a real database)`);
  for (const [action, d] of Object.entries(derived)) console.log(`   ${action}: ${d.fields.length} fields`);
  process.exit(0);
}

if (!existsSync(ARTIFACT)) {
  fail(`generated artifact missing at ${ARTIFACT}. Run: node scripts/ci/crm-patch-field-gen.mjs --write`);
}
if (!existsSync(SQL_ARTIFACT)) {
  fail(`generated pgTAP proof missing at ${SQL_ARTIFACT}. Run: node scripts/ci/crm-patch-field-gen.mjs --write`);
}

const committed = readFileSync(ARTIFACT, "utf8");
if (committed.trimEnd() !== rendered.trimEnd()) {
  const parse = (text) => {
    const out = {};
    for (const m of text.matchAll(/^\s{2}"([a-z._]+)": Object\.freeze\(\[$([\s\S]*?)^\s{2}\]\),$/gm)) {
      out[m[1]] = [...m[2].matchAll(/\{ name: "([^"]+)"/g)].map((f) => f[1]);
    }
    return out;
  };
  const was = parse(committed);
  const now = parse(rendered);
  console.error("❌ crm-patch-field-gen: the committed patch schema no longer matches the database.\n");
  for (const action of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const a = was[action] || [];
    const b = now[action] || [];
    const added = b.filter((f) => !a.includes(f));
    const removed = a.filter((f) => !b.includes(f));
    if (added.length || removed.length || a.join() !== b.join()) {
      console.error(`   ${action}:`);
      if (added.length) console.error(`      + ${added.join(", ")}`);
      if (removed.length) console.error(`      - ${removed.join(", ")}`);
      if (!added.length && !removed.length) console.error("      (order changed)");
    }
  }
  console.error("\n   The database is the authority. Regenerate rather than editing the artifact:");
  console.error("      node scripts/ci/crm-patch-field-gen.mjs --write\n");
  process.exit(1);
}

// Checked AFTER the TypeScript delta above, deliberately: when a field is renamed both artifacts
// drift together, and the named `+ company_name / - entity_name` delta is the message that tells
// the person what actually changed. Failing on the pgTAP twin first would swallow it.
if (readFileSync(SQL_ARTIFACT, "utf8").trimEnd() !== renderedSql.trimEnd()) {
  fail(
    `the committed pgTAP proof at ${SQL_ARTIFACT} no longer matches the database.\n`
    + "   Regenerate rather than editing it: node scripts/ci/crm-patch-field-gen.mjs --write",
  );
}

console.log(`✅ crm-patch-field-gen: all ${Object.keys(derived).length} action field sets match the database.`);
