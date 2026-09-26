#!/usr/bin/env node
/**
 * title-authority-guard.mjs — no permission decision reads a title.
 *
 * WHY. `tenant_members` and `tenant_invite_tokens` carry TWO identities side by side: the enforced
 * one (`role`, `is_owner`) and a work identity (`job_title`, `responsibilities`). The migration that
 * added the second (20260901001520) states the rule in its first lines: work identity "is
 * descriptive and NEVER consulted for authorization." A title is free text an owner types. The
 * moment a policy, a DEFINER helper or a UI gate reads it to decide what someone may do, "Manager"
 * becomes a permission nobody granted and no permission screen shows. That rule lived only in a
 * comment. This guard makes it a CI invariant.
 *
 * WHAT IT CHECKS.
 *   SQL — replays supabase/migrations/*.sql in filename order, LAST DEFINITION WINS, recursing into
 *   DO blocks: functions are keyed by schema-qualified name + argument types (CREATE OR REPLACE
 *   replaces, DROP removes, ALTER FUNCTION ... RENAME / SET SCHEMA moves); policies are keyed by
 *   table + name (CREATE defines, ALTER POLICY replaces ONLY the USING / WITH CHECK clause it names,
 *   DROP POLICY / DROP TABLE removes, ALTER TABLE ... RENAME moves); views and materialized views
 *   are keyed by schema-qualified name (CREATE [OR REPLACE] defines, DROP removes, ALTER ... RENAME
 *   moves); the columns of tenant_members and tenant_invite_tokens are tracked through CREATE
 *   TABLE and ALTER TABLE ADD / DROP / RENAME COLUMN. The SQL an EXECUTE runs — in a DO block or in
 *   a function body — is read as a template: literals and format() templates are kept, a format()
 *   argument that is itself a literal is substituted, anything computed at run time becomes a hole.
 *   A policy on a table named by a hole is replayed on the placeholder table `<dynamic>`, once per
 *   EXECUTE, and every rule below applies to it. Then, over what is LIVE:
 *     R0  a statement the replay cannot read names a work-identity column or reaches a title reader
 *         (calls a function / names a view that reads one): an EXECUTE whose SQL is built at run
 *         time, whose statement kind is a hole, or whose policy clause / body / view query contains
 *         a hole — judged on the text of the whole DO block or function that runs it; an
 *         EXECUTEd statement of a kind the replay does not model (a rule, a trigger, DML) — judged
 *         on its own text; or a function / policy / view statement that did not parse. What
 *         cannot be replayed cannot be proven clean. No exemption.
 *     R1  a policy expression references a work-identity column, calls a function that reads one,
 *         or names a view that reads one (directly or through further calls). No exemption.
 *     R2  a function or view named like an authorization helper (an is_ / has_ / can_ / may_ /
 *         assert_ segment anywhere in the name, a check_ / current_user_ / authorize* prefix, or
 *         naming authority / permission / permitted / allowed / access) references one, or reaches
 *         one. No exemption, baselined or not.
 *     R3  any other live function or view that references one must be in the baseline with a
 *         purpose of display | write | search | invite-copy, a one-line reason, and a pin:
 *         `defined_in` (the migration of its last definition) and `fingerprint` (of its
 *         comment-stripped, whitespace-normalised definition). An unlisted reader fails.
 *     R4  a baseline entry that no longer matches a live reader fails, so the baseline can only
 *         shrink and never rots into a list of names nobody can find; and a baselined reader whose
 *         last definition moved to another migration or whose fingerprint changed fails until a
 *         reviewer re-reads it and re-pins it — a reviewed name is not a reviewed body.
 *     R6  a live column of tenant_members / tenant_invite_tokens whose name looks like a title
 *         (/title|responsib/i) but is not in the work-identity set. The tenant-isolation lane owns
 *         a pending title field (decision log, 2026-09-26: "F2 waits for that field to exist") and
 *         it has no migration yet; if it lands as, say, `tenant_members.title`, every rule above
 *         would silently stop watching the title. It fails closed until the column joins the SQL
 *         and TS work-identity sets in the same PR.
 *   TS — src/**\/*.{ts,tsx} and supabase/functions/**\/*.ts, excluding tests, generated files and
 *   the generated Supabase types:
 *     R5  a statement that reads job_title / jobTitle / responsibilities fails unless the baseline
 *         lists it by path + fingerprint with a reason, when EITHER (a) it is a decision (if /
 *         else-if, ternary, && / ||, switch / case, comparison, or a predicate call — .includes(
 *         .test( .startsWith( .endsWith( .match( Boolean( or a leading !!) and carries an
 *         authorization token (role, permission, owner, admin, grant, allowed, authorized, can-,
 *         hasFeature); OR (b) it initialises or assigns an authorization-shaped binding
 *         (`const isAdmin = ...`, `canApprove: (m) => ...`, a JSX prop `canRemove={...}`); OR (c) it
 *         is a `return` whose nearest named enclosing function is authorization-shaped
 *         (`function canApprove(m) { return ... }`).
 *         A TS entry that no longer matches fails under R4.
 *
 * A column is matched with word boundaries, so a writer's `_job_title` PARAMETER is an input and
 * does not count, while `tm.job_title`, `SET job_title = ...` and `'job_title', x.job_title` do.
 *
 * HEURISTIC LIMITS, stated rather than implied. The SQL half reads migration source, not
 * `pg_proc`, so it proves what the tree says, and its policy count is the policies it REPLAYED,
 * not the database's. It does not model CHECK constraints, triggers, rules or grants: written as
 * a plain statement, one of those is not judged at all (EXECUTEd, it is judged under R0). It
 * tracks columns only on the two watched tables, so a title-like column on any other table is
 * outside R6. It counts a function or view as a reader on any mention outside a comment —
 * including dynamic SQL in a string, which is the fail-closed direction. Calls are matched by
 * name, so an overload is treated as its sibling, and a view by its bare name (fail-closed
 * again). A pin covers the reader's OWN definition: a baselined reader whose behaviour changes
 * only because a function it calls changed keeps its pin; the callee is judged only on its own
 * terms (R2 / R3, when it reads or reaches a title). The template reader follows literals,
 * format() and `||` chains; SQL
 * assembled across several statements in a variable is a hole, judged under R0 on the text of
 * the block that runs it. A dynamic policy on `<dynamic>` is never removed by a later
 * statement — the replay cannot know which tables a loop touched, so a dynamic DROP POLICY
 * removes nothing and a dynamic ALTER POLICY is replayed as one more policy; both are the
 * fail-closed direction. A column name that reaches dynamic SQL only as a run-time value (a
 * parameter, a catalogue row) is invisible unless the enclosing block names it. A function that
 * is neither helper-named nor a direct reader, but calls a reader and then decides, is left to
 * R3's review of the reader it calls. The TS half is text-based, not an AST: a title copied into
 * a local under another name and compared later (`const t = m.job_title; ... if (t === "Lead" &&
 * isOwner)`) passes; so does a decision whose title read and authorization token sit on opposite
 * sides of a `{`, a title-only predicate with no authorization-shaped name (`const isLead =
 * m.job_title === "Lead"`; display predicates like `hasTitle` pass on purpose), and a JSX prop
 * gate whose prop name is not authorization-shaped (`<Row showRemove={m.job_title ===
 * "Manager"} />`): by the time the component reads `showRemove` it is a boolean with no title in
 * sight, so nothing downstream catches it either. Authorization shape is judged on a NAME: a
 * verdict word (`permission`, `access`, `allowed`, a `can` / `may` segment) over a title fails
 * even when it only labels (`permissionLabel = m.job_title`) — rename it or baseline it. English
 * prose in JSX text and string literals ("job title and responsibilities only describe work") is
 * set aside by a neighbouring-word test, so copy that explains the rule is not mistaken for code
 * that breaks it. Argument types are keyed by the shared normaliser in definer-signature-acl.mjs,
 * so `float` and `double precision` name one function, as in pg_proc.
 *
 * Self-test mode (--self-test) replays the real tree in memory, applies one mutation per rule and
 * fails if any mutation is not caught, if any control is not quiet, if the real tree's dynamic
 * policy loop is not replayed, or if the unmutated tree is not clean.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseType, splitParams } from "./definer-signature-acl.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = (() => {
  const i = process.argv.indexOf("--root");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : join(HERE, "..", "..");
})();
const BASELINE_PATH = join(ROOT, "scripts", "ci", "title-authority-baseline.json");

// The work-identity columns, in one place. A new title column joins BOTH lists in the PR that adds it (R6).
const SQL_WORK_IDENTITY_COLUMNS = ["job_title", "responsibilities"];
const TS_WORK_IDENTITY = new Set(["job_title", "jobTitle", "responsibilities"]);
const SQL_WORK_IDENTITY = new RegExp(`\\b(${SQL_WORK_IDENTITY_COLUMNS.join("|")})\\b`, "i");
const TS_WORK_IDENTITY_ANY = new RegExp(`\\b(${[...TS_WORK_IDENTITY].join("|")})\\b`);
const WATCHED_TABLES = new Set(["public.tenant_members", "public.tenant_invite_tokens"]);
const TITLE_LIKE_COLUMN = /title|responsib/i;
const HELPER_NAME = /(^|_)(is|has|can|may|assert)_|^(check_|current_user_|authorize)|authority|permission|permitted|allowed|access/;
const PURPOSES = new Set(["display", "write", "search", "invite-copy"]);

// Holes stand for SQL text computed at run time. Both are valid identifiers, so a hole in a name
// position still parses; `<dynamic>` is the placeholder table a policy on a hole-named table gets.
const IDENT_HOLE = "__dyn_ident__";
const VALUE_HOLE = "__dyn_value__";
const HOLE = /__dyn_(?:ident|value)__/i;
const DYNAMIC_TABLE = "<dynamic>";

// ── SQL lexing ────────────────────────────────────────────────────────────────────────────────

/** Top-level statements, top-level comments dropped; '..', E'..', ".." and $tag$..$tag$ respected. */
export function splitSql(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (sql.startsWith("--", i)) { const e = sql.indexOf("\n", i); i = e === -1 ? n : e; continue; }
    if (sql.startsWith("/*", i)) { const e = sql.indexOf("*/", i + 2); i = e === -1 ? n : e + 2; continue; }
    if (c === "'") { const j = endOfString(sql, i); buf += sql.slice(i, j); i = j; continue; }
    if (c === '"') { const e = sql.indexOf('"', i + 1); const j = e === -1 ? n : e + 1; buf += sql.slice(i, j); i = j; continue; }
    if (c === "$") {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i, i + 64));
      if (m) { const e = sql.indexOf(m[0], i + m[0].length); const j = e === -1 ? n : e + m[0].length; buf += sql.slice(i, j); i = j; continue; }
    }
    if (c === ";") { if (buf.trim()) out.push(buf.trim()); buf = ""; i++; continue; }
    buf += c; i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Index just past the string literal opening at `i` (handles '' and E'\'' escapes). */
function endOfString(sql, i) {
  const escaped = i > 0 && /[eE]/.test(sql[i - 1]) && !/[\w$]/.test(sql[i - 2] ?? "");
  let j = i + 1;
  while (j < sql.length) {
    if (escaped && sql[j] === "\\") { j += 2; continue; }
    if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
    if (sql[j] === "'") return j + 1;
    j++;
  }
  return sql.length;
}

/** Drop -- and /* *\/ comments EVERYWHERE, bodies included; only '..' literals and ".." names are opaque. */
export function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) { const e = sql.indexOf("\n", i); i = e === -1 ? sql.length : e; continue; }
    if (sql.startsWith("/*", i)) { const e = sql.indexOf("*/", i + 2); i = e === -1 ? sql.length : e + 2; out += " "; continue; }
    if (sql[i] === "'") { const j = endOfString(sql, i); out += sql.slice(i, j); i = j; continue; }
    if (sql[i] === '"') { const e = sql.indexOf('"', i + 1); const j = e === -1 ? sql.length : e + 1; out += sql.slice(i, j); i = j; continue; }
    out += sql[i]; i++;
  }
  return out;
}

/**
 * Length-preserving: blank comments, '..' literals and $tag$..$tag$ bodies so structure can be read
 * without a keyword inside a string or a body matching. ".." identifiers are skipped INTACT: a
 * policy named "Tenant admins read their own tenant's audit" must not open a string at its
 * apostrophe, or the policy silently drops out of the replay.
 */
export function maskSql(sql) {
  const out = sql.split("");
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " "; };
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) { const e = sql.indexOf("\n", i); const j = e === -1 ? sql.length : e; blank(i, j); i = j; continue; }
    if (sql.startsWith("/*", i)) { const e = sql.indexOf("*/", i + 2); const j = e === -1 ? sql.length : e + 2; blank(i, j); i = j; continue; }
    if (sql[i] === '"') { const e = sql.indexOf('"', i + 1); i = e === -1 ? sql.length : e + 1; continue; }
    if (sql[i] === "'") { const j = endOfString(sql, i); blank(i, j); i = j; continue; }
    if (sql[i] === "$") {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i, i + 64));
      if (m) { const e = sql.indexOf(m[0], i + m[0].length); const j = e === -1 ? sql.length : e + m[0].length; blank(i, j); i = j; continue; }
    }
    i++;
  }
  return out.join("");
}

const NAME = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*))?`;
const ONE = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;

/** Quoted identifiers keep their case; unquoted ones fold to lower case, as PostgreSQL does. */
function ident(part) {
  const p = part.trim();
  return p.startsWith('"') ? p.slice(1, -1).replace(/""/g, '"') : p.toLowerCase();
}
function qualified(name) {
  const parts = name.match(/"(?:[^"]|"")+"|[A-Za-z_][\w$]*/g) ?? [name];
  const [schema, obj] = parts.length > 1 ? [ident(parts[0]), ident(parts[1])] : ["public", ident(parts[0])];
  return `${schema}.${obj}`;
}
const unqualified = (key) => key.split("(")[0].split(".").pop();

function closeParen(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === "(") depth++;
    else if (masked[i] === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Split `text` at `sep` where it sits outside parentheses and literals (structure read from `masked`). */
function splitTop(text, masked, sep) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && masked.startsWith(sep, i)) { out.push(text.slice(start, i)); start = i + sep.length; i += sep.length - 1; }
  }
  out.push(text.slice(start));
  return out;
}

/** pg_proc identity: argument TYPES only; OUT parameters are not part of a function's identity. */
function signature(name, argText) {
  const types = splitParams(argText)
    .filter((p) => !/^out\s/i.test(p))
    .map((p) => normaliseType(p.replace(/\s=[\s\S]*$/, "")));
  return `${qualified(name)}(${types.join(",")})`;
}

/** Normalise a hand-written baseline key (`public.f(_a uuid, text)`) the way the replay keys it. */
export function signatureKey(text) {
  const m = new RegExp(`^\\s*(${NAME})\\s*\\(([\\s\\S]*)\\)\\s*$`).exec(text);
  return m ? signature(m[1], m[2]) : null;
}

// ── dynamic SQL: what an EXECUTE runs, as a template ─────────────────────────────────────────

/** The content of `t` when `t` is exactly one string literal ('..', E'..', $tag$..$tag$), else null. */
function literalText(raw) {
  const t = raw.trim().replace(/\s*::\s*(?:text|varchar|character\s+varying)\s*$/i, "");
  const d = /^(\$[A-Za-z_0-9]*\$)([\s\S]*)\1$/.exec(t);
  if (d && !d[2].includes(d[1])) return d[2];
  const e = /^[eE]'/.test(t);
  const q = e ? 1 : 0;
  if (t[q] !== "'" || endOfString(t, q) !== t.length) return null;
  let body = t.slice(q + 1, -1).replace(/''/g, "'");
  if (e) body = body.replace(/\\(.)/g, (_, ch) => ({ n: "\n", t: "\t", r: "\r" })[ch] ?? ch);
  return body;
}

/** format()'s template with each placeholder filled from a literal argument, or left as a hole. */
function formatText(fmt, args) {
  let next = 0;
  return fmt.replace(/%(?:(\d+)\$)?(-)?(\d+|\*(?:\d+\$)?)?([sIL%])/g, (_all, pos, _flag, width, type) => {
    if (type === "%") return "%";
    if (width?.startsWith("*")) next++;
    const k = pos ? Number(pos) - 1 : next;
    next = k + 1;
    const a = args[k] === undefined ? null : literalText(args[k]);
    if (a === null) return type === "I" ? IDENT_HOLE : VALUE_HOLE;
    if (type === "I") return /^[a-z_][a-z0-9_$]*$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`;
    if (type === "L") return `'${a.replace(/'/g, "''")}'`;
    return a;
  });
}

/**
 * The SQL an EXECUTE argument runs: `'..'`, `$f$..$f$`, `format('..', ...)` and `||` chains of
 * them are read; any other part is a hole. null when no part is literal (EXECUTE some_variable).
 */
export function executeTemplate(arg) {
  const text = arg.trim();
  let out = "";
  let literal = false;
  for (const raw of splitTop(text, maskSql(text), "||")) {
    const p = raw.trim();
    const l = literalText(p);
    if (l !== null) { out += l; literal = true; continue; }
    const pm = maskSql(p);
    const f = /^(?:pg_catalog\s*\.\s*)?format\s*\(/i.exec(pm);
    if (f && closeParen(pm, f[0].length - 1) === pm.trimEnd().length - 1) {
      const inner = p.slice(f[0].length, pm.trimEnd().length - 1);
      const args = splitTop(inner, maskSql(inner), ",");
      const fmt = literalText(args[0]);
      if (fmt !== null) { out += formatText(fmt, args.slice(1)); literal = true; continue; }
    }
    out += /^(?:pg_catalog\s*\.\s*)?quote_ident\s*\(/i.test(pm) ? IDENT_HOLE : VALUE_HOLE;
  }
  return literal ? out : null;
}

/** Each dynamic EXECUTE statement in a PL/pgSQL body: the statement, and the expression it runs. */
function executes(body) {
  const out = [];
  for (const piece of splitSql(body)) {
    const mk = maskSql(piece);
    const m = /\bexecute\b(?!\s+(?:function|procedure|on)\b)/i.exec(mk);
    if (!m || /\b(?:grant|revoke)\b/i.test(mk.slice(0, m.index))) continue;
    const from = m.index + m[0].length;
    const am = mk.slice(from);
    let depth = 0;
    let cut = am.length;
    for (let i = 0; i < am.length; i++) {
      if (am[i] === "(") depth++;
      else if (am[i] === ")") depth--;
      else if (depth === 0 && /^(?:into|using)\b/i.test(am.slice(i)) && !/[\w$]/.test(am[i - 1] ?? " ")) { cut = i; break; }
    }
    out.push({ statement: piece.slice(m.index), arg: piece.slice(from, from + cut) });
  }
  return out;
}

// ── SQL replay: last definition wins ─────────────────────────────────────────────────────────

// Inside a DO body, a DDL statement starts a statement or follows a control keyword
// (`BEGIN CREATE POLICY`, `THEN DROP POLICY`). Anywhere else it is a clause of something else:
// `ALTER PUBLICATION supabase_realtime DROP TABLE t` drops no table and removes no policy.
const DDL_IN_BODY = /(^|\b(?:begin|then|else|loop))\s*\b(create\s+(?:or\s+replace\s+)?function|create\s+policy|alter\s+policy|drop\s+policy|drop\s+function|alter\s+function|drop\s+table|alter\s+table|create\s+(?:(?:global|local)\s+)?(?:(?:temp|temporary|unlogged)\s+)?table|create\s+(?:or\s+replace\s+)?(?:(?:temp|temporary|recursive)\s+)*(?:materialized\s+)?view|drop\s+(?:materialized\s+)?view|alter\s+(?:materialized\s+)?view)\b/i;
const REPLAYED = /^(?:create\s+(?:or\s+replace\s+)?function|create\s+policy|alter\s+policy|drop\s+policy|drop\s+function|alter\s+function|create\s+(?:or\s+replace\s+)?(?:(?:temp|temporary|recursive)\s+)*(?:materialized\s+)?view|drop\s+(?:materialized\s+)?view)\b/i;
const NOT_A_COLUMN = /^(constraint|primary|unique|check|foreign|exclude|like)$/i;
// Statement kinds the replay reads besides REPLAYED: a dynamic one of these is not "unmodelled".
const MODELLED = /^(?:do\b|drop\s+table|alter\s+table|create\s+(?:(?:global|local)\s+)?(?:(?:temp|temporary|unlogged)\s+)?table|alter\s+(?:materialized\s+)?view)\b/i;

function policyClauses(stmt, masked, from) {
  const out = {};
  const tail = masked.slice(from);
  const u = /\busing\s*\(/i.exec(tail);
  if (u) { const o = from + u.index + u[0].length - 1; const c = closeParen(masked, o); out.using = stmt.slice(o + 1, c === -1 ? stmt.length : c); }
  const w = /\bwith\s+check\s*\(/i.exec(tail);
  if (w) { const o = from + w.index + w[0].length - 1; const c = closeParen(masked, o); out.check = stmt.slice(o + 1, c === -1 ? stmt.length : c); }
  return out;
}

/** Fold `migrations` over `seed` (a prior replay's state, copied, never mutated) or an empty state. */
export function replay(migrations, seed) {
  const fns = new Map(seed?.fns);            // "schema.name(types)" -> { file, text }
  const policies = new Map(seed?.policies);  // "schema.table :: name" -> { file, table, name, using, check, dynamic }
  const views = new Map(seed?.views);        // "schema.name" -> { file, text }
  const columns = new Map([...(seed?.columns ?? [])].map(([t, c]) => [t, new Map(c)]));  // watched table -> column -> file
  const unreplayable = [...(seed?.unreplayable ?? [])];  // statements the replay could not read, judged in analyze()
  let dynSeq = seed?.dynSeq ?? 0;

  const colsOf = (table) => columns.get(table) ?? columns.set(table, new Map()).get(table);
  const watched = (table) => WATCHED_TABLES.has(table) || HOLE.test(table);

  /**
   * Apply one statement to the live state. Returns false when it looked like DDL we replay but did
   * not parse. `dyn`, when set, says the statement came out of an EXECUTE template: a hole in a
   * decision text (a policy clause, a function body, a view query) is recorded for R0.
   */
  const apply = (file, s, dyn) => {
    const mk = maskSql(s);
    const holeIn = (text, what) => {
      if (dyn && HOLE.test(text)) unreplayable.push({ file, why: `${dyn.where} EXECUTEs a statement whose ${what} is filled in at run time`, snippet: dyn.statement, text: dyn.origin });
    };
    let m;

    if (/^do\b/i.test(mk)) {
      const d = /(\$[A-Za-z_0-9]*\$)([\s\S]*)\1/.exec(s);
      if (!d) return false;
      const body = d[2];
      for (const piece of splitSql(body)) {
        const at = DDL_IN_BODY.exec(maskSql(piece));
        if (at) handle(file, piece.slice(at.index + at[0].length - at[2].length), dyn);
      }
      dynamic(file, body, stripSqlComments(body), "a DO block");
      return true;
    }

    if ((m = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?function\\s+(${NAME})\\s*\\(`, "i").exec(mk))) {
      const open = m[0].length - 1;
      const close = closeParen(mk, open);
      if (close === -1) return false;
      const key = signature(m[1], mk.slice(open + 1, close));
      const text = stripSqlComments(s);
      fns.set(key, { file, text });
      holeIn(s.slice(close + 1), "function body");
      // A function body can EXECUTE DDL too; its templates are replayed like a DO block's.
      const b = /(\$[A-Za-z_0-9]*\$)([\s\S]*?)\1/.exec(s.slice(close + 1));
      if (b) dynamic(file, b[2], text, `function ${key}`);
      return true;
    }

    if ((m = /^drop\s+function\s+(?:if\s+exists\s+)?([\s\S]+)$/i.exec(mk))) {
      const list = m[1].replace(/\b(cascade|restrict)\b\s*$/i, "");
      for (const one of splitParams(list)) {
        const f = new RegExp(`^(${NAME})\\s*(?:\\(([\\s\\S]*)\\))?\\s*$`).exec(one.trim());
        if (!f) return false;
        if (f[2] === undefined) {
          const prefix = `${qualified(f[1])}(`;
          for (const k of [...fns.keys()]) if (k.startsWith(prefix)) fns.delete(k);
        } else {
          fns.delete(signature(f[1], f[2]));
        }
      }
      return true;
    }

    if ((m = new RegExp(`^alter\\s+function\\s+(${NAME})\\s*`, "i").exec(mk))) {
      let key = null;
      let rest = mk.slice(m[0].length);
      if (rest.startsWith("(")) {
        const close = closeParen(rest, 0);
        if (close === -1) return false;
        key = signature(m[1], rest.slice(1, close));
        rest = rest.slice(close + 1);
      } else {
        const prefix = `${qualified(m[1])}(`;
        key = [...fns.keys()].find((k) => k.startsWith(prefix)) ?? null;
      }
      const rn = new RegExp(`^\\s*rename\\s+to\\s+(${NAME})`, "i").exec(rest);
      const ss = /^\s*set\s+schema\s+("(?:[^"]|"")+"|[A-Za-z_][\w$]*)/i.exec(rest);
      if (key && fns.has(key) && (rn || ss)) {
        const v = fns.get(key);
        const [schema, obj] = [key.split(".")[0], unqualified(key)];
        const nextName = rn ? `${schema}.${ident(rn[1].split(".").pop())}` : `${ident(ss[1])}.${obj}`;
        fns.delete(key);
        fns.set(nextName + key.slice(key.indexOf("(")), v);
      }
      return true;
    }

    if ((m = new RegExp(`^create\\s+policy\\s+(${ONE})\\s+on\\s+(${NAME})`, "i").exec(mk))) {
      const table = qualified(m[2]);
      const name = ident(m[1]);
      const cl = policyClauses(s, mk, m[0].length);
      holeIn(`${cl.using ?? ""}\n${cl.check ?? ""}`, "policy clause");
      if (HOLE.test(table) || HOLE.test(name)) {
        // The loop's tables are unknown: each EXECUTE is its own policy on the placeholder table.
        policies.set(`${DYNAMIC_TABLE} :: ${name} #${file}:${++dynSeq}`, { file, table: DYNAMIC_TABLE, name, using: cl.using ?? "", check: cl.check ?? "", dynamic: true });
      } else {
        policies.set(`${table} :: ${name}`, { file, table, name, using: cl.using ?? "", check: cl.check ?? "", dynamic: Boolean(dyn) });
      }
      return true;
    }

    if ((m = new RegExp(`^alter\\s+policy\\s+(${ONE})\\s+on\\s+(${NAME})`, "i").exec(mk))) {
      const table = qualified(m[2]);
      const key = `${table} :: ${ident(m[1])}`;
      const rn = new RegExp(`^\\s*rename\\s+to\\s+(${ONE})`, "i").exec(mk.slice(m[0].length));
      const dynamicTarget = HOLE.test(table) || HOLE.test(ident(m[1]));
      if (rn) {
        const v = dynamicTarget ? null : policies.get(key);
        if (v) { policies.delete(key); policies.set(`${table} :: ${ident(rn[1])}`, { ...v, name: ident(rn[1]), file }); }
        return true;
      }
      const cl = policyClauses(s, mk, m[0].length);
      holeIn(`${cl.using ?? ""}\n${cl.check ?? ""}`, "policy clause");
      if (dynamicTarget) {
        // Which policies it altered is unknown; the clause it installs is replayed as one more policy.
        if (cl.using !== undefined || cl.check !== undefined) {
          policies.set(`${DYNAMIC_TABLE} :: ${ident(m[1])} #${file}:${++dynSeq}`, { file, table: DYNAMIC_TABLE, name: ident(m[1]), using: cl.using ?? "", check: cl.check ?? "", dynamic: true });
        }
        return true;
      }
      // Replace ONLY the clause this statement names. Appending would keep a column the
      // statement removed, and count a policy as reading a title after it stopped.
      const v = { ...(policies.get(key) ?? { table, name: ident(m[1]), using: "", check: "" }) };
      if (cl.using !== undefined) v.using = cl.using;
      if (cl.check !== undefined) v.check = cl.check;
      policies.set(key, { ...v, file });
      return true;
    }

    if ((m = new RegExp(`^drop\\s+policy\\s+(?:if\\s+exists\\s+)?(${ONE})\\s+on\\s+(${NAME})`, "i").exec(mk))) {
      policies.delete(`${qualified(m[2])} :: ${ident(m[1])}`);  // a hole-named target matches nothing: removes nothing
      return true;
    }

    if ((m = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?(?:(?:temp|temporary|recursive)\\s+)*(materialized\\s+)?view\\s+(?:if\\s+not\\s+exists\\s+)?(${NAME})`, "i").exec(mk))) {
      const name = qualified(m[2]);
      holeIn(s.slice(m[0].length), "view query");
      views.set(HOLE.test(name) ? `${DYNAMIC_TABLE}.view#${file}:${++dynSeq}` : name, { file, text: stripSqlComments(s) });
      return true;
    }

    if ((m = /^drop\s+(?:materialized\s+)?view\s+(?:if\s+exists\s+)?([\s\S]+)$/i.exec(mk))) {
      for (const one of splitTop(m[1], m[1], ",")) {
        const v = new RegExp(`^\\s*(${NAME})\\s*(?:\\b(?:cascade|restrict)\\b\\s*)?$`, "i").exec(one);
        if (!v) return false;
        views.delete(qualified(v[1]));
      }
      return true;
    }

    if ((m = new RegExp(`^alter\\s+(?:materialized\\s+)?view\\s+(?:if\\s+exists\\s+)?(${NAME})\\s+rename\\s+to\\s+(${ONE})`, "i").exec(mk))) {
      const from = qualified(m[1]);
      const v = views.get(from);
      if (v) { views.delete(from); views.set(`${from.split(".")[0]}.${ident(m[2])}`, v); }
      return true;
    }

    if ((m = /^drop\s+table\s+(?:if\s+exists\s+)?([\s\S]+)$/i.exec(mk))) {
      for (const t of m[1].replace(/\b(cascade|restrict)\b\s*$/i, "").split(",")) {
        const table = qualified(t.trim());
        for (const k of [...policies.keys()]) if (k.startsWith(`${table} :: `)) policies.delete(k);
        columns.delete(table);
      }
      return true;
    }

    if ((m = new RegExp(`^create\\s+(?:(?:global|local)\\s+)?(?:(?:temp|temporary|unlogged)\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${NAME})\\s*\\(`, "i").exec(mk))) {
      const table = qualified(m[1]);
      if (watched(table)) {
        const open = m[0].length - 1;
        const close = closeParen(mk, open);
        const inner = s.slice(open + 1, close === -1 ? s.length : close);
        for (const def of splitTop(inner, maskSql(inner), ",")) {
          const c = new RegExp(`^\\s*(${ONE})`).exec(def);
          if (c && !NOT_A_COLUMN.test(c[1])) colsOf(table).set(ident(c[1]), file);
        }
      }
      return true;
    }

    if ((m = new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${NAME})\\s+`, "i").exec(mk))) {
      const table = qualified(m[1]);
      const restS = s.slice(m[0].length);
      const restM = mk.slice(m[0].length);
      const rn = new RegExp(`^rename\\s+to\\s+(${ONE})`, "i").exec(restM);
      if (rn) {
        const to = `${table.split(".")[0]}.${ident(rn[1])}`;
        for (const [k, v] of [...policies]) {
          if (!k.startsWith(`${table} :: `)) continue;
          policies.delete(k);
          policies.set(`${to} :: ${v.name}`, { ...v, table: to });
        }
        return true;
      }
      if (watched(table)) {
        for (const action of splitTop(restS, restM, ",")) {
          const a = action.trim();
          let x;
          if ((x = new RegExp(`^add\\s+(column\\s+)?(?:if\\s+not\\s+exists\\s+)?(${ONE})`, "i").exec(a)) && (x[1] || !NOT_A_COLUMN.test(x[2]))) {
            colsOf(table).set(ident(x[2]), file);
          } else if ((x = new RegExp(`^drop\\s+(column\\s+)?(?:if\\s+exists\\s+)?(${ONE})`, "i").exec(a)) && (x[1] || !NOT_A_COLUMN.test(x[2]))) {
            colsOf(table).delete(ident(x[2]));
          } else if ((x = new RegExp(`^rename\\s+(column\\s+)?(${ONE})\\s+to\\s+(${ONE})`, "i").exec(a)) && (x[1] || !NOT_A_COLUMN.test(x[2]))) {
            colsOf(table).delete(ident(x[2]));
            colsOf(table).set(ident(x[3]), file);
          }
        }
      }
      return true;
    }
    return !REPLAYED.test(mk);
  };

  /**
   * Replay the SQL each EXECUTE in `body` runs. `origin` is the text of the whole block or function
   * that runs it: when the SQL cannot be read, R0 judges `origin`, because a variable the EXECUTE
   * reads (`DECLARE q text := '... job_title ...'`) is defined there, not in the EXECUTE.
   */
  const dynamic = (file, body, origin, where) => {
    for (const ex of executes(body)) {
      const opaque = (why) => unreplayable.push({ file, why: `${where} EXECUTEs ${why}`, snippet: ex.statement, text: origin });
      const sql = executeTemplate(ex.arg);
      if (sql === null) { opaque("SQL that is built entirely at run time"); continue; }
      for (const s of splitSql(sql)) {
        if (HOLE.test(s.split(/\s+/, 1)[0])) { opaque("SQL whose statement is chosen at run time"); continue; }
        if (!apply(file, s, { where, statement: ex.statement, origin })) { opaque("a statement the replay cannot parse"); continue; }
        // A kind the replay does not model (a rule, a trigger, DML): nothing is replayed, so a
        // title it names or a reader it reaches cannot be proven harmless. Judged on its own text.
        const sm = maskSql(s);
        if (!REPLAYED.test(sm) && !MODELLED.test(sm)) unreplayable.push({ file, why: `${where} EXECUTEs a statement kind the replay does not model`, snippet: s, text: stripSqlComments(s) });
      }
    }
  };

  // A policy, function or view statement the replay could not parse is invisible to R1-R4. It is
  // recorded, and fails closed in analyze() when it names a title column or reaches a title reader.
  const handle = (file, s, dyn) => {
    if (!apply(file, s, dyn)) unreplayable.push({ file, why: "a statement could not be parsed", snippet: s, text: stripSqlComments(s) });
  };

  for (const { file, sql } of migrations) for (const s of splitSql(sql)) handle(file, s);
  return { fns, policies, views, columns, unreplayable, dynSeq };
}

// ── TS lexing ─────────────────────────────────────────────────────────────────────────────────

const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

/**
 * Two length-preserving views of a TS/TSX source: `code` blanks comments; `masked` also blanks the
 * CONTENTS of string, template and regex literals (delimiters kept, `${...}` stays code). Operators
 * and statement boundaries are read from `masked`; words are read from `code`.
 */
export function lexTs(src) {
  const code = src.split("");
  const masked = src.split("");
  const blank = (arr, k) => { if (arr[k] !== "\n") arr[k] = " "; };
  const n = src.length;
  const templates = [];   // brace depth at which each open `${` resumes its template
  let depth = 0;
  let lastSig = "";
  let lastWord = "";
  let i = 0;

  const templateText = (k) => {
    while (k < n) {
      if (src[k] === "\\") { blank(masked, k); if (k + 1 < n) blank(masked, k + 1); k += 2; continue; }
      if (src[k] === "`") { lastSig = "`"; return k + 1; }
      if (src[k] === "$" && src[k + 1] === "{") { templates.push(depth); depth++; lastSig = "{"; return k + 2; }
      blank(masked, k); k++;
    }
    return n;
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") { blank(code, i); blank(masked, i); i++; } continue; }
    if (c === "/" && d === "*") {
      const e = src.indexOf("*/", i + 2);
      const j = e === -1 ? n : e + 2;
      for (; i < j; i++) { blank(code, i); blank(masked, i); }
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      for (let k = i + 1; k < Math.min(j, n); k++) blank(masked, k);
      i = j < n && src[j] === c ? j + 1 : j;
      lastSig = c;
      continue;
    }
    if (c === "`") { i = templateText(i + 1); continue; }
    if (c === "/") {
      const isRegex = d !== ">" && lastSig !== "<" && (
        lastSig === "" || "(,=:[!&|?{};+-*%~^".includes(lastSig) || (/[\w$]/.test(lastSig) && REGEX_KEYWORDS.has(lastWord)));
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== "\n") {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "[") inClass = true;
          else if (src[j] === "]") inClass = false;
          else if (src[j] === "/" && !inClass) break;
          j++;
        }
        if (j < n && src[j] === "/") {
          for (let k = i + 1; k < j; k++) blank(masked, k);
          i = j + 1;
          while (i < n && /[a-z]/i.test(src[i])) i++;
          lastSig = "/";
          continue;
        }
      }
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      lastWord = src.slice(i, j);
      lastSig = src[j - 1];
      i = j;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (templates.length && templates[templates.length - 1] === depth) { templates.pop(); i = templateText(i + 1); continue; }
    }
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return { code: code.join(""), masked: masked.join("") };
}

/** Statement-sized pieces: split on ; { } and on commas at the piece's own paren depth. */
function pieces(masked) {
  const out = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    const boundary = c === ";" || c === "{" || c === "}" || (c === "," && depth === 0);
    if (boundary) { out.push({ start, end: i, stop: c }); start = i + 1; depth = 0; }
  }
  out.push({ start, end: masked.length, stop: "" });
  return out;
}

/**
 * Whole statements, for reading a binding and its initializer: split on ; { } and top-level commas
 * only OUTSIDE parentheses, so a typed or destructured parameter (`(m: { job_title?: string }) =>`)
 * and a callback's body stay inside the statement that binds them.
 */
function statements(masked) {
  const out = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ";" || c === "{" || c === "}" || c === ",")) { out.push({ start, end: i }); start = i + 1; }
  }
  out.push({ start, end: masked.length });
  return out;
}
const containing = (ranges, at) => {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ranges[mid].start <= at) lo = mid; else hi = mid - 1; }
  return ranges[lo];
};

function closeBrace(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}") { depth--; if (depth === 0) return i; }
  }
  return masked.length - 1;
}

const KW_BEFORE = new Set(["return", "typeof", "await", "case", "new", "void", "delete", "yield", "throw", "in", "of", "instanceof", "else", "const", "let", "var", "export", "default", "readonly", "public", "private", "protected", "static", "declare", "keyof", "extends", "implements", "as", "satisfies", "is", "function", "async"]);
const KW_AFTER = new Set(["in", "of", "instanceof", "as", "satisfies", "is", "extends"]);

/**
 * Words in `text` that are code, not prose. A code identifier never has a plain word beside it
 * except a keyword (`return x`, `x as T`); English always does ("titles and responsibilities
 * only describe work"). A JSX attribute (` role="status"`) is markup, not an authorization read.
 */
function codeWords(text, tsx) {
  const out = [];
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const s = m.index;
    const e = s + m[0].length;
    const before = /([A-Za-z_$][\w$]*)\s+$/.exec(text.slice(Math.max(0, s - 40), s));
    const after = /^\s+([A-Za-z_$][\w$]*)/.exec(text.slice(e, e + 40));
    if (before && !KW_BEFORE.has(before[1])) continue;
    if (after && !KW_AFTER.has(after[1])) continue;
    if (tsx && /\s/.test(text[s - 1] ?? "") && /^=["'{]/.test(text.slice(e, e + 2))) continue;
    out.push(m[0]);
  }
  return out;
}

const parts = (word) => word.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[_$]+/).filter(Boolean);
const AUTH_PART = new Set(["role", "roles", "permission", "permissions", "can", "allowed", "authorized", "grant", "grants", "granted", "admin", "admins", "owner", "owners"]);
function isAuthWord(word) {
  const p = parts(word);
  if (p.some((x) => AUTH_PART.has(x))) return true;
  for (let k = 0; k + 1 < p.length; k++) if (p[k] === "has" && p[k + 1] === "feature") return true;
  return false;
}

// A NAME is authorization-shaped when it asks "may they?": a can / may segment anywhere
// (canManage, userMayEdit), an authority word that is a verdict on its own (hasPermission,
// isAllowed, accessLevel), or a predicate prefix over an authority noun (isAdmin, isOwner,
// hasRole). A bare noun is not (ownerTitle, roleLabel): those name a value, not a verdict.
const AUTH_VERDICT = new Set(["permission", "permissions", "allowed", "authorized", "authorised", "authorize", "authorise", "permitted", "permit", "access", "privilege", "privileges", "entitled", "entitlement", "entitlements", "granted"]);
const PREDICATE_PREFIX = new Set(["is", "has", "should", "must", "allow", "allows"]);
function isAuthName(name) {
  if (!name) return false;
  const p = parts(name);
  if (p.includes("can") || p.includes("may")) return true;
  if (p.some((x) => AUTH_VERDICT.has(x))) return true;
  return PREDICATE_PREFIX.has(p[0]) && p.slice(1).some((x) => AUTH_PART.has(x));
}

const DECISION = /\bif\s*\(|\belse\s+if\b|\bswitch\s*\(|\bcase\b|&&|\|\||===|!==|[^=!<>]==[^=>]|!=[^=]|<=|>=|(?<!\?)\?(?![.?])(?!\s*[:),])|\.\s*(?:includes|test|startsWith|endsWith|match)\s*\(|\bBoolean\s*\(|!!\s*[\w$(]/;

export const fingerprint = (text) => createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);

// `const isAdmin = ...`, `isAdmin = ...`, `private canEdit = ...` — and `canApprove: (m) => ...` in an object.
const BINDING = /^\s*(?:export\s+)?(?:(?:const|let|var)\s+)?(?:(?:public|private|protected|readonly|static)\s+)*([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?(?<![=!<>])=(?![=>])([\s\S]*)$/;
const PROPERTY = /^\s*([A-Za-z_$][\w$]*)\s*:(?!:)([\s\S]*)$/;
const CONTROL = new Set(["if", "for", "while", "switch", "catch", "with", "do", "try", "else", "finally", "return", "function"]);

/** Where the header of the block opening at `k` starts: the previous ; { } outside its own parentheses. */
function headerStart(masked, k) {
  let p = 0;
  let b = 0;
  for (let i = k - 1; i >= 0; i--) {
    const c = masked[i];
    if (c === ")" || c === "]") p++;
    else if (c === "(" || c === "[") p--;
    else if (c === "}") { if (p <= 0 && b === 0) return i + 1; b++; }
    else if (c === "{") { if (b === 0) { if (p <= 0) return i + 1; } else b--; }
    else if (c === ";" && p <= 0 && b === 0) return i + 1;
  }
  return 0;
}

/** The last comma-separated item of a header, not crossing an unclosed `(` (it is a call's argument). */
function headerTail(h) {
  let p = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    const c = h[i];
    if (c === ")" || c === "]") p++;
    else if (c === "(" || c === "[") { p--; if (p < 0) return h.slice(i + 1); }
    else if (c === "," && p === 0) return h.slice(i + 1);
  }
  return h;
}

/** The name of the function a block header opens: a string, or undefined when it is not a named function. */
function blockFunctionName(header) {
  const t = headerTail(header).replace(/\s+/g, " ").trim();
  const bound = () => /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=(?![=>])/.exec(header.trim())?.[1];
  const fn = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b\s*\*?\s*([A-Za-z_$][\w$]*)?/.exec(t);
  if (fn) return fn[1] ?? bound();
  if (/=>$/.test(t)) {
    const b = /^(?:export\s+)?(?:(?:const|let|var)\s+)?(?:(?:public|private|protected|readonly|static)\s+)*([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=(?![=>])/.exec(t);
    if (b) return b[1];
    const p = /^([A-Za-z_$][\w$]*)\s*:/.exec(t);
    if (p) return p[1];
    return bound();   // `const canApprove = members.some((m) => { ... })`: the callback decides the binding
  }
  const method = /^(?:(?:async|static|public|private|protected|readonly|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/.exec(t);
  if (method && !CONTROL.has(method[1])) return method[1];
  return undefined;
}

/** The nearest NAMED function enclosing position `at`, skipping control blocks and anonymous callbacks. */
function enclosingFunctionName(masked, at) {
  let k = at - 1;
  while (k >= 0) {
    let depth = 0;
    for (; k >= 0; k--) {
      if (masked[k] === "}") depth++;
      else if (masked[k] === "{") { if (depth === 0) break; depth--; }
    }
    if (k < 0) return null;
    const name = blockFunctionName(masked.slice(headerStart(masked, k), k));
    if (name !== undefined) return name;
    k--;
  }
  return null;
}

/** Every title-reading decision site in one TS/TSX source (see R5 in the header for the three shapes). */
export function tsDecisionSites(path, src) {
  if (!TS_WORK_IDENTITY_ANY.test(src)) return [];
  const tsx = path.endsWith(".tsx");
  const { code, masked } = lexTs(src);
  const hits = [];
  const readsTitle = (text) => codeWords(text, tsx).some((w) => TS_WORK_IDENTITY.has(w));
  let stmts = null;
  for (const p of pieces(masked)) {
    let { start, end } = p;
    const head = code.slice(start, end);
    if (!readsTitle(head)) continue;
    // A title read in an if/switch HEAD decides the block that follows it: judge them together.
    if (p.stop === "{" && /\b(?:if|switch)\s*\(/.test(masked.slice(start, end))) end = closeBrace(masked, end) + 1;
    const text = code.slice(start, end);
    const decided = DECISION.test(masked.slice(start, end)) && codeWords(text, tsx).some(isAuthWord);
    // The statement this piece belongs to, read whole: does it bind an authorization-shaped name,
    // and does THIS piece's title read sit in that binding's initializer?
    stmts ??= statements(masked);
    const st = containing(stmts, start);
    const stText = code.slice(st.start, Math.max(st.end, end));
    const bound = BINDING.exec(stText) ?? PROPERTY.exec(stText);
    const initAt = bound ? st.start + stText.length - bound[2].length : Infinity;
    const authBinding = Boolean(bound) && isAuthName(bound[1]) && initAt < end && readsTitle(code.slice(Math.max(start, initAt), end));
    const authReturn = /^\s*return\b/.test(head) && isAuthName(enclosingFunctionName(masked, start));
    // A JSX prop is a binding too: `<Row canRemove={m.job_title === "Manager"} />`.
    const prop = tsx ? /[\s<]([A-Za-z_$][\w$]*)=\{\s*$/.exec(masked.slice(Math.max(0, start - 80), start)) : null;
    const authProp = Boolean(prop) && isAuthName(prop[1]);
    if (!decided && !authBinding && !authReturn && !authProp) continue;
    const statement = text.replace(/\s+/g, " ").trim();
    hits.push({ path, line: code.slice(0, start + (head.length - head.trimStart().length)).split("\n").length, fingerprint: fingerprint(statement), statement });
  }
  return hits;
}

// ── the guard ─────────────────────────────────────────────────────────────────────────────────

const TS_ROOTS = [["src", /\.(ts|tsx)$/], ["supabase/functions", /\.ts$/]];

function walk(dir, re, out) {
  let names;
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, re, out); continue; }
    if (re.test(name)) out.push(p);
  }
}

export function readTree(root = ROOT) {
  const dir = join(root, "supabase", "migrations");
  const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
  const files = [];
  for (const [base, re] of TS_ROOTS) walk(join(root, base), re, files);
  const tsFiles = [];
  for (const abs of files.sort()) {
    const path = relative(root, abs).replace(/\\/g, "/");
    if (/\.(test|spec)\./.test(path) || path === "src/integrations/supabase/types.ts" || /\.generated\./.test(path)) continue;
    const text = readFileSync(abs, "utf8");
    if (/@generated/.test(text.split("\n", 3).join("\n"))) continue;
    tsFiles.push({ path, text });
  }
  return { migrations, tsFiles };
}

const siteCache = new WeakMap();

/** `seed`, when given, is the replayed state `migrations` are applied on top of (the self-test uses it). */
export function analyze({ migrations, tsFiles, baseline, seed }) {
  const violations = [];
  const fail = (rule, detail) => violations.push(`${rule}: ${detail}`);
  const { fns, policies, views, columns, unreplayable } = replay(migrations, seed);

  // Every live function or view that reads a title, or reaches one that does. A baselined
  // "display" reader is still a title reader: a policy or a helper that calls it has laundered
  // the title through it.
  const reachFns = new Set([...fns].filter(([, f]) => SQL_WORK_IDENTITY.test(f.text)).map(([k]) => unqualified(k)));
  const reachViews = new Set([...views].filter(([, v]) => SQL_WORK_IDENTITY.test(v.text)).map(([k]) => unqualified(k)));
  const wordRe = new Map();
  const reOf = (n, call) => {
    const k = `${call ? "c" : "w"}:${n}`;
    return wordRe.get(k) ?? wordRe.set(k, new RegExp(`\\b${n.replace(/[$]/g, "\\$&")}\\b${call ? "\\s*\\(" : ""}`, "i")).get(k);
  };
  const calls = (text, names) => [...names].find((n) => reOf(n, true).test(text));
  const names = (text, set) => [...set].find((n) => reOf(n, false).test(text));
  const reach = (text) => {
    const c = calls(text, reachFns);
    if (c) return `calls ${c}()`;
    const v = names(text, reachViews);
    return v ? `reads view ${v}` : null;
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const [k, f] of fns) {
      if (!reachFns.has(unqualified(k)) && reach(f.text)) { reachFns.add(unqualified(k)); grew = true; }
    }
    for (const [k, v] of views) {
      if (!reachViews.has(unqualified(k)) && reach(v.text)) { reachViews.add(unqualified(k)); grew = true; }
    }
  }

  for (const u of unreplayable) {
    const m = SQL_WORK_IDENTITY.exec(u.text);
    const via = m ? null : reach(u.text);
    if (!m && !via) continue;
    fail("R0", `${u.why} in ${u.file}, and ${m ? `it names ${m[1]}` : `it ${via}, which reads a work-identity column`} (${u.snippet.replace(/\s+/g, " ").trim().slice(0, 140)}…) — what cannot be replayed cannot be proven not to decide on a title; write it as a plain statement, or an EXECUTE of a literal template, the replay reads`);
  }

  let dynamicPolicies = 0;
  for (const [key, p] of policies) {
    if (p.dynamic) dynamicPolicies++;
    const expr = stripSqlComments(`${p.using}\n${p.check}`);
    const m = SQL_WORK_IDENTITY.exec(expr);
    const via = m ? null : reach(expr);
    const where = `policy ${key} (last defined in ${p.file}${p.dynamic ? ", from a dynamic EXECUTE template" : ""})`;
    if (m) fail("R1", `${where} reads ${m[1]} — a policy is a permission decision and may never read a title; no exemption exists`);
    else if (via) fail("R1", `${where} ${via}, which reads a work-identity column — a policy is a permission decision and may never reach a title, directly or through a function or view; no exemption exists`);
  }

  // Baseline: functions by signature, views by name; each pinned to the definition a reviewer read.
  const entries = new Map();
  for (const e of baseline.sql ?? []) {
    const isView = e.view !== undefined;
    const key = isView ? (new RegExp(`^\\s*${NAME}\\s*$`).test(String(e.view)) ? `view ${qualified(String(e.view))}` : null) : signatureKey(String(e.function ?? ""));
    if (!key) { fail("R3", `baseline entry ${JSON.stringify(e.function ?? e.view)} is not a function signature like public.name(uuid, text) or a view name like public.name`); continue; }
    if (!PURPOSES.has(e.purpose)) fail("R3", `baseline entry ${key} has purpose ${JSON.stringify(e.purpose)}; it must be one of ${[...PURPOSES].join(" | ")}`);
    if (!String(e.reason ?? "").trim()) fail("R3", `baseline entry ${key} has no reason`);
    if (!String(e.defined_in ?? "").trim() || !/^[0-9a-f]{16}$/.test(String(e.fingerprint ?? ""))) fail("R3", `baseline entry ${key} is not pinned — it needs "defined_in" (the migration of its last definition) and "fingerprint" (16 hex) so a changed body cannot keep a reviewed name`);
    entries.set(key, e);
  }

  const readers = new Map();   // baseline key -> { file, text }
  for (const [key, f] of fns) {
    const m = SQL_WORK_IDENTITY.exec(f.text);
    const name = unqualified(key);
    if (!m) {
      const via = HELPER_NAME.test(name) ? (calls(f.text, [...reachFns].filter((n) => n !== name)) ?? names(f.text, reachViews)) : null;
      if (via) fail("R2", `function ${key} (last defined in ${f.file}) is named like an authorization helper and reaches ${via}, which reads a work-identity column — a helper that answers "may they?" may never reach a title; no exemption exists`);
      continue;
    }
    readers.set(key, f);
    if (HELPER_NAME.test(name)) {
      fail("R2", `function ${key} (last defined in ${f.file}) is named like an authorization helper and reads ${m[1]} — a helper that answers "may they?" may never read a title; no exemption exists, baselined or not`);
    } else if (!entries.has(key)) {
      fail("R3", `function ${key} (last defined in ${f.file}) reads ${m[1]} — unreviewed title reader: a reviewer must confirm it is not a permission decision, then add it to the baseline pinned to "defined_in": "${f.file}", "fingerprint": "${fingerprint(f.text)}"`);
    }
  }
  for (const [vkey, v] of views) {
    const key = `view ${vkey}`;
    const name = unqualified(vkey);
    const m = SQL_WORK_IDENTITY.exec(v.text);
    if (!m) {
      const via = HELPER_NAME.test(name) ? (calls(v.text, reachFns) ?? names(v.text, [...reachViews].filter((n) => n !== name))) : null;
      if (via) fail("R2", `view ${vkey} (last defined in ${v.file}) is named like an authorization helper and reaches ${via}, which reads a work-identity column — no exemption exists`);
      continue;
    }
    readers.set(key, v);
    if (HELPER_NAME.test(name)) {
      fail("R2", `view ${vkey} (last defined in ${v.file}) is named like an authorization helper and reads ${m[1]} — no exemption exists, baselined or not`);
    } else if (!entries.has(key)) {
      fail("R3", `view ${vkey} (last defined in ${v.file}) reads ${m[1]} — unreviewed title reader: a reviewer must confirm it is not a permission decision, then add { "view": "${vkey}" } to the baseline pinned to "defined_in": "${v.file}", "fingerprint": "${fingerprint(v.text)}"`);
    }
  }
  for (const [key, e] of entries) {
    const live = readers.get(key);
    if (!live) { fail("R4", `baseline entry ${key} matches no live function or view that reads a work-identity column — remove it (the baseline only shrinks)`); continue; }
    const fp = fingerprint(live.text);
    if (e.defined_in !== undefined && e.fingerprint !== undefined && (e.defined_in !== live.file || e.fingerprint !== fp)) {
      fail("R4", `baseline entry ${key}: reviewed reader changed since review — re-read it and re-pin (reviewed: ${e.defined_in} @ ${e.fingerprint}; live: ${live.file} @ ${fp}). A reviewed name is not a reviewed body`);
    }
  }

  for (const [table, cols] of columns) {
    for (const [col, file] of cols) {
      if (TITLE_LIKE_COLUMN.test(col) && !SQL_WORK_IDENTITY_COLUMNS.includes(col)) {
        fail("R6", `column ${table === DYNAMIC_TABLE || HOLE.test(table) ? "on a table named at run time" : table}.${col} (added in ${file}) looks like a work-identity column but the guard does not watch it — add "${col}" to SQL_WORK_IDENTITY_COLUMNS and its TS spellings to TS_WORK_IDENTITY in scripts/ci/title-authority-guard.mjs in the same PR, so every rule reads it`);
      }
    }
  }

  const tsEntries = new Map();
  for (const e of baseline.ts ?? []) {
    const k = `${e.path} :: ${e.fingerprint}`;
    if (!String(e.reason ?? "").trim()) fail("R5", `baseline entry ${k} has no reason`);
    tsEntries.set(k, e);
  }
  const seen = new Set();
  for (const file of tsFiles) {
    if (!siteCache.has(file)) siteCache.set(file, tsDecisionSites(file.path, file.text));
    for (const h of siteCache.get(file)) {
      const k = `${h.path} :: ${h.fingerprint}`;
      seen.add(k);
      if (!tsEntries.has(k)) {
        fail("R5", `${h.path}:${h.line} reads a title inside a decision that also carries an authorization token, or in an authorization-shaped binding or function — a permission decision may not read a title. If a reviewer confirms it is not one, baseline { "path": "${h.path}", "fingerprint": "${h.fingerprint}" } with a reason. Statement: ${h.statement.slice(0, 180)}`);
      }
    }
  }
  for (const k of tsEntries.keys()) {
    if (!seen.has(k)) fail("R4", `baseline entry ${k} matches no current TS decision site — remove it (the baseline only shrinks)`);
  }

  return { violations, readers: readers.size, policies: policies.size, dynamicPolicies, views: views.size, tsSites: seen.size };
}

function loadBaseline() {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

// ── self-test ─────────────────────────────────────────────────────────────────────────────────

const MIG = "29991231000000_title_authority_selftest.sql";

/**
 * The mutations and controls, as data: `base` is a replay of the real tree, `baseline` the real
 * baseline. Each case is [label, rule, mutate]; each control is [label, mutate]. Exported so a
 * harness can run the same cases against another build of the guard.
 */
export function selfTestCases({ base, baseline }) {
  const addSql = (sql) => (t) => t.migrations.push({ file: MIG, sql });
  const addTs = (path, text) => (t) => t.tsFiles.push({ path, text });
  const firstReader = [...base.fns].find(([, f]) => SQL_WORK_IDENTITY.test(f.text));
  const cleanPolicy = [...base.policies].find(([k, p]) => k.startsWith("public.tenant_members :: ") && p.using && !SQL_WORK_IDENTITY.test(p.using));
  const baselinedFn = baseline.sql?.find((e) => e.function)?.function;
  const need = (v, what) => { if (!v) throw new Error(what); return v; };
  const readerName = () => signatureKey(need(baselinedFn, "baseline has no SQL function entry")).split("(")[0];
  const argsOf = (key) => key.slice(key.indexOf("(") + 1, -1).split(",").filter(Boolean).map((ty, k) => `_a${k} ${ty}`).join(", ");

  const cases = [
    ["(a) CREATE POLICY reading tm.job_title", "R1", addSql(
      `CREATE POLICY "selftest_title_gate" ON public.tenant_members FOR UPDATE USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = auth.uid() AND tm.job_title = 'Manager'));`)],
    ["(a) the same policy inside a DO block", "R1", addSql(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'selftest_do') THEN CREATE POLICY "selftest_do" ON public.tenant_invite_tokens USING (responsibilities ILIKE '%approve%'); END IF; END $$;`)],
    ["(a) a policy that reaches a title through a baselined reader", "R1", (t) => t.migrations.push({ file: MIG, sql:
      `CREATE POLICY "selftest_via" ON public.tenant_members USING (${readerName()}() IS NOT NULL);` })],
    // Verbatim from review: the shape the repo really uses (20260629180214), calling a baselined reader.
    ["(a) a policy created by a DO loop's EXECUTE format() template, calling a baselined reader", "R1", (t) => {
      need(base.fns.has("public.get_paige_team_context()"), "get_paige_team_context() is no longer a live reader; point this case at another");
      t.migrations.push({ file: MIG, sql: `DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['clients','deals'] LOOP EXECUTE format($f$ CREATE POLICY team_lead_gate ON public.%I USING (public.get_paige_team_context() IS NOT NULL) $f$, t); END LOOP; END $$;` });
    }],
    ["(a) a literal EXECUTE of a policy reading job_title is replayed as that policy", "R1", addSql(
      `DO $$ BEGIN EXECUTE 'CREATE POLICY p ON public.tenant_members USING (job_title = ''Owner'')'; END $$;`)],
    ["(a) a policy created by a function body's EXECUTE template, reading job_title", "R1", addSql(
      `CREATE FUNCTION public.selftest_install_policies(_t text) RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN EXECUTE format('CREATE POLICY lead_gate ON public.%I USING (EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.user_id = auth.uid() AND m.job_title = %L))', _t, 'Lead'); END $fn$;`)],
    ["(a) a policy reaching a title through a view", "R1", addSql(
      `CREATE VIEW public.team_managers AS SELECT user_id FROM public.tenant_members WHERE job_title='Manager';\nCREATE POLICY p2 ON public.clients USING (auth.uid() IN (SELECT user_id FROM public.team_managers));`)],
    ["(b) ALTER POLICY adding job_title to a clean live policy", "R1", (t) => {
      const [, p] = need(cleanPolicy, "no clean live tenant_members policy to mutate");
      t.migrations.push({ file: MIG, sql: `ALTER POLICY "${p.name}" ON ${p.table} USING ((${p.using}) OR job_title = 'Manager');` });
    }],
    ["(c) a new unlisted function selecting job_title", "R3", addSql(
      `CREATE OR REPLACE FUNCTION public.selftest_titles(_tenant uuid) RETURNS SETOF text LANGUAGE sql STABLE AS $$ SELECT tm.job_title FROM public.tenant_members tm WHERE tm.tenant_id = _tenant $$;`)],
    ["(c) a new unlisted view selecting job_title", "R3", addSql(
      `CREATE OR REPLACE VIEW public.selftest_titles_v AS SELECT user_id, job_title FROM public.tenant_members;`)],
    ["(d) an is_* helper reading job_title, even when baselined", "R2", (t) => {
      t.migrations.push({ file: MIG, sql: `CREATE FUNCTION public.is_team_manager(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND user_id = auth.uid() AND job_title = 'Manager') $$;` });
      t.baseline.sql.push({ function: "public.is_team_manager(uuid)", purpose: "display", reason: "self-test" });
    }],
    ["(d) an is_* helper that calls a title reader", "R2", (t) => t.migrations.push({ file: MIG, sql:
      `CREATE FUNCTION public.can_manage_team(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT ${readerName()}() IS NOT NULL $$;` })],
    ["(d) a helper with an embedded _can_ segment reading job_title (team_can_approve)", "R2", addSql(
      `CREATE FUNCTION public.team_can_approve(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND user_id = auth.uid() AND job_title = 'Approver') $$;`)],
    ["(d) a helper with an embedded _is_ segment reading job_title (user_is_manager)", "R2", addSql(
      `CREATE FUNCTION public.user_is_manager() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE user_id = auth.uid() AND job_title = 'Manager') $$;`)],
    ["(e) a TS gate on job_title and role", "R5", addTs("src/selftest/title-gate.ts",
      `export function canEdit(member: { job_title: string; role: string }) {\n  if (member.job_title === "Manager" && member.role !== "owner") {\n    return true;\n  }\n  return false;\n}\n`)],
    ["(e) a TSX render gate on jobTitle and isOwner", "R5", addTs("src/selftest/title-gate.tsx",
      `export const Row = ({ jobTitle, isOwner }: { jobTitle: string; isOwner: boolean }) => <div>{jobTitle === "Lead" || isOwner ? <button>Remove</button> : null}</div>;\n`)],
    // The four predicate shapes exactly as review reported them (untyped), then typed as real code is.
    ["(e) verbatim: export const isAdmin = (m) => /admin/i.test(m.jobTitle)", "R5", addTs("src/selftest/v-regex.ts",
      `export const isAdmin = (m) => /admin/i.test(m.jobTitle)\n`)],
    ["(e) verbatim: const hasPermission = (m) => Boolean(m.job_title?.startsWith(\"Head\"))", "R5", addTs("src/selftest/v-boolean.ts",
      `const hasPermission = (m) => Boolean(m.job_title?.startsWith("Head"))\n`)],
    ["(e) verbatim: const canManage = (m) => m.job_title?.toLowerCase().includes(\"manager\")", "R5", addTs("src/selftest/v-includes.ts",
      `const canManage = (m) => m.job_title?.toLowerCase().includes("manager")\n`)],
    ["(e) verbatim: function canApprove(m){ return [\"Manager\",\"Lead\"].includes(m.job_title) }", "R5", addTs("src/selftest/v-return.ts",
      `function canApprove(m){ return ["Manager","Lead"].includes(m.job_title) }\n`)],
    ["(e) a JSX prop with an authorization-shaped name set from a title", "R5", addTs("src/selftest/prop-gate.tsx",
      `export const List = ({ m }: { m: { job_title: string } }) => <Row canRemove={m.job_title === "Manager"} />;\n`)],
    ["(e) a regex-test predicate bound to isAdmin", "R5", addTs("src/selftest/pred-regex.ts",
      `export const isAdmin = (m: { jobTitle: string }) => /admin/i.test(m.jobTitle);\n`)],
    ["(e) a Boolean(startsWith) predicate bound to hasPermission", "R5", addTs("src/selftest/pred-boolean.ts",
      `const hasPermission = (m: { job_title?: string }) => Boolean(m.job_title?.startsWith("Head"));\nexport { hasPermission };\n`)],
    ["(e) an includes() predicate bound to canManage", "R5", addTs("src/selftest/pred-includes.ts",
      `export const canManage = (m: { job_title?: string }) => m.job_title?.toLowerCase().includes("manager");\n`)],
    ["(e) a return inside function canApprove reading job_title", "R5", addTs("src/selftest/pred-return.ts",
      `export function canApprove(m: { job_title: string }){ return ["Manager","Lead"].includes(m.job_title) }\n`)],
    ["(f) a stale SQL baseline entry", "R4", (t) => t.baseline.sql.push({ function: "public.selftest_gone(uuid)", purpose: "display", reason: "self-test", defined_in: MIG, fingerprint: "0000000000000000" })],
    ["(f) a stale TS baseline entry", "R4", (t) => t.baseline.ts.push({ path: "src/selftest/nowhere.ts", fingerprint: "0000000000000000", reason: "self-test" })],
    ["(f) DROP FUNCTION of a baselined reader leaves its entry stale", "R4", (t) => t.migrations.push({ file: MIG, sql:
      `DROP FUNCTION IF EXISTS ${need(baselinedFn, "baseline has no SQL entry to drop")};` })],
    ["(f) CREATE OR REPLACE with a clean body leaves its entry stale (last definition wins)", "R4", (t) => {
      const [key] = need(firstReader, "no live reader to replace");
      t.migrations.push({ file: MIG, sql: `CREATE OR REPLACE FUNCTION ${key.split("(")[0]}(${argsOf(key)}) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;` });
    }],
    ["(f) a baselined reader re-created with a title-based gate fails its pin", "R4", (t) => {
      const key = signatureKey(need(baselinedFn, "baseline has no SQL function entry"));
      t.migrations.push({ file: MIG, sql: `CREATE OR REPLACE FUNCTION ${key.split("(")[0]}(${argsOf(key)}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$\nBEGIN\n  IF (SELECT job_title FROM public.tenant_members WHERE user_id = auth.uid() LIMIT 1) = 'Manager' THEN RAISE EXCEPTION 'managers only'; END IF;\n  RETURN '{}'::jsonb;\nEND $$;` });
    }],
    ["(r) an EXECUTE of a variable whose value reads job_title", "R0", addSql(
      `DO $$ DECLARE q text := 'CREATE POLICY p ON public.clients USING (job_title = ''Owner'')'; BEGIN EXECUTE q; END $$;`)],
    ["(r) an EXECUTE of a variable whose value calls a title reader", "R0", (t) => t.migrations.push({ file: MIG, sql:
      `DO $$ DECLARE q text := 'CREATE POLICY p ON public.clients USING (${readerName()}() IS NOT NULL)'; BEGIN EXECUTE q; END $$;` })],
    ["(r) a format() template whose policy clause is a %s hole filled from a title-reading variable", "R0", addSql(
      `DO $$ DECLARE t text; e text := 'job_title = ''Lead'''; BEGIN FOREACH t IN ARRAY ARRAY['clients'] LOOP EXECUTE format('CREATE POLICY p ON public.%I USING (%s)', t, e); END LOOP; END $$;`)],
    ["(r) a dynamic statement of a kind the replay does not model, naming job_title", "R0", addSql(
      `DO $$ BEGIN EXECUTE 'CREATE RULE selftest_rule AS ON UPDATE TO public.tenant_members WHERE NEW.job_title = ''Manager'' DO INSTEAD NOTHING'; END $$;`)],
    ["(r) a function statement the replay cannot parse, naming job_title", "R0", addSql(
      `CREATE FUNCTION public.selftest_broken(_a uuid RETURNS text LANGUAGE sql AS $$ SELECT job_title FROM public.tenant_members $$;`)],
    ["(n) a new title-like column on tenant_members the guard does not watch", "R6", addSql(
      `ALTER TABLE public.tenant_members ADD COLUMN IF NOT EXISTS title text;`)],
    ["(n) a new title-like column on tenant_invite_tokens inside a DO block", "R6", addSql(
      `DO $$ BEGIN ALTER TABLE public.tenant_invite_tokens ADD COLUMN member_responsibility_notes text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`)],
  ];
  const quiet = [
    ["a writer parameter _job_title is an input, not a read", addSql(
      `CREATE FUNCTION public.selftest_writer(_job_title text) RETURNS void LANGUAGE sql AS $$ SELECT length(_job_title) $$;`)],
    ["ALTER POLICY replaces its clause rather than appending to it", addSql(
      `CREATE POLICY "selftest_replace" ON public.tenant_members USING (job_title = 'Manager');\nALTER POLICY "selftest_replace" ON public.tenant_members USING (user_id = auth.uid());`)],
    ["a DROP POLICY removes a title-reading policy", addSql(
      `CREATE POLICY "selftest_dropped" ON public.tenant_members USING (job_title = 'Manager');\nDROP POLICY IF EXISTS "selftest_dropped" ON public.tenant_members;`)],
    ["a clean dynamic policy loop (format %I into the table name only)", addSql(
      `DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['deals','tasks'] LOOP EXECUTE format('DROP POLICY IF EXISTS selftest_iso ON public.%I', t); EXECUTE format($f$ CREATE POLICY selftest_iso ON public.%I USING (tenant_id = public.current_user_tenant_id()) $f$, t); END LOOP; END $$;`)],
    ["a DROP VIEW removes a title-reading view", addSql(
      `CREATE VIEW public.selftest_gone_v AS SELECT job_title FROM public.tenant_members;\nDROP VIEW IF EXISTS public.selftest_gone_v;`)],
    ["a title-like column added then dropped", addSql(
      `ALTER TABLE public.tenant_members ADD COLUMN selftest_title text;\nALTER TABLE public.tenant_members DROP COLUMN selftest_title;`)],
    ["a constraint named after job_title is not a column", addSql(
      `ALTER TABLE public.tenant_members ADD CONSTRAINT selftest_job_title_chk CHECK (job_title IS NULL OR char_length(job_title) <= 120) NOT VALID;`)],
    ["a commented-out title gate in TS", addTs("src/selftest/commented.ts",
      `// if (member.job_title === "Manager" && member.role !== "owner") allow();\nexport const x = 1;\n`)],
    ["prose about titles beside a role check", addTs("src/selftest/prose.tsx",
      `export const Note = ({ role }: { role: string }) => <p>{role === "owner" ? "Job titles and responsibilities only describe work." : null}</p>;\n`)],
    ["a JSX display prop set from a title", addTs("src/selftest/display-prop.tsx",
      `export const Card = ({ m }: { m: { job_title?: string } }) => <Badge label={m.job_title ?? "Member"} isLead={m.job_title === "Lead"} />;\n`)],
    ["a display predicate and a display value named after owners", addTs("src/selftest/display.ts",
      `export const hasTitle = (m: { job_title?: string }) => Boolean(m.job_title?.trim());\nexport const ownerTitle = (owner: { job_title?: string }) => owner.job_title ?? "";\nexport function describe(m: { job_title?: string }) { return m.job_title?.includes("Lead") ? "Team lead" : "Member"; }\n`)],
  ];
  return { cases, quiet };
}

function selfTest() {
  const tree = readTree();
  const baseline = loadBaseline();
  const clone = () => JSON.parse(JSON.stringify(baseline));
  // The real tree is replayed once; each mutation is a migration applied AFTER it (last definition
  // wins, exactly as a new migration would land), so a case costs one statement, not the corpus.
  const base = replay(tree.migrations);
  const run = (mutate) => {
    const t = { migrations: [], tsFiles: [...tree.tsFiles], baseline: clone(), seed: base };
    mutate(t);
    return analyze(t).violations;
  };
  const { cases, quiet } = selfTestCases({ base, baseline });

  let ok = true;
  const clean = analyze({ ...tree, baseline: clone() });
  if (clean.violations.length) { ok = false; console.error(`SELF-TEST FAIL: (g) the real tree is not clean:\n  ${clean.violations.join("\n  ")}`); }
  else console.log(`self-test: (g) the real tree passes clean (${clean.policies} replayed policies, ${clean.dynamicPolicies} from dynamic templates) ✓`);
  // The real tree creates tenant_isolation in a FOREACH ... EXECUTE format($f$ CREATE POLICY ... $f$)
  // loop (20260629180214). If that loop stops being replayed, R1 is blind to it again: fail loudly.
  const loop = [...base.policies.values()].filter((p) => p.dynamic && p.table === DYNAMIC_TABLE && p.name === "tenant_isolation" && p.file.startsWith("20260629180214") && /current_user_tenant_id/.test(p.using) && /current_user_tenant_id/.test(p.check));
  if (!loop.length) { ok = false; console.error("SELF-TEST FAIL: (g) the real tree's dynamic tenant_isolation loop (20260629180214) was not replayed as a <dynamic> policy with USING and WITH CHECK"); }
  else console.log(`self-test: (g) the real tree's dynamic tenant_isolation loop is replayed on ${DYNAMIC_TABLE} with USING and WITH CHECK, reading no title ✓`);
  for (const [label, rule, mutate] of cases) {
    let out;
    try { out = run(mutate); } catch (e) { ok = false; console.error(`SELF-TEST FAIL: ${label} could not be built (${e.message})`); continue; }
    const fired = out.filter((v) => v.startsWith(`${rule}:`));
    if (!fired.length) { ok = false; console.error(`SELF-TEST FAIL: ${label} did not fire ${rule} (got: ${out.join(" | ").slice(0, 300) || "nothing"})`); }
    else console.log(`self-test: ${label} → ${rule} fired ✓`);
  }
  for (const [label, mutate] of quiet) {
    const out = run(mutate);
    if (out.length) { ok = false; console.error(`SELF-TEST FAIL: ${label} should stay quiet but got: ${out.join(" | ").slice(0, 300)}`); }
    else console.log(`self-test: ${label} → quiet ✓`);
  }
  if (!ok) return 1;
  console.log(`title-authority-guard self-test: all ${cases.length} mutations caught, ${quiet.length} controls quiet, real tree clean`);
  return 0;
}

// ── entry ─────────────────────────────────────────────────────────────────────────────────────

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  let baseline;
  try { baseline = loadBaseline(); } catch (e) {
    console.error(`title-authority-guard: cannot read ${relative(ROOT, BASELINE_PATH)}: ${e.message}`);
    return 1;
  }
  const { violations, readers, policies, dynamicPolicies, views, tsSites } = analyze({ ...readTree(), baseline });
  if (violations.length) {
    console.error(`title-authority-guard: FAIL — ${violations.length} violation(s). A title describes work; it never decides access.`);
    for (const v of violations) console.error(`  ${v}`);
    return 1;
  }
  console.log(`title-authority-guard: PASS (R0–R6) — ${policies} replayed policies (${dynamicPolicies} from dynamic EXECUTE templates) and ${views} replayed views read no title; ${readers} live title-reading function(s)/view(s), each reviewed and pinned; ${tsSites} TS decision site(s) reviewed`);
  return 0;
}

// Compared as resolved paths: a URL-string compare silently skips main() when the checkout path
// needs escaping, and a guard that never runs passes.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main());
