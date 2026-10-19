#!/usr/bin/env node
/**
 * customer-portal-identity-lint.mjs — PAIGE never speaks inside the Customer Portal.
 *
 * WHY (owner ruling, Antonio, 2026-10-19): "CURA is supposed to be one of our agents that is assigned
 * under PAIGE ... PAIGE should not be inside of the Customer Portal. She's a COO not a customer
 * specialist." A customer of a business talks to that business's agent: Cura, or the business's own
 * name for it (customerAgentName). Copy that names PAIGE on a customer surface is the defect, and it
 * kept coming back through Playbook-persona fallbacks and hardcoded strings, so this is a gate.
 *
 * WHAT IT FLAGS: any customer-visible text that names the COO — `Paige`, `PAIGE` (whole word,
 * case-sensitive) or `PaigeAgent`. "Customer-visible text" is read from the TypeScript syntax tree, not
 * from raw lines: string literals, template-literal text and JSX text. Comments, identifiers
 * (PaigeChat, paigeAvatar), import paths, string-literal TYPES ("PAIGE" in a union), console output and
 * lowercase event names ("paige:prefill") are never text a customer reads, and are never flagged.
 *
 * SCOPE IS DERIVED, NOT LISTED (round 2, verifier #3 / compliance #5). The scanned set is every file a
 * customer can reach:
 *   1. the /app route tree in src/App.tsx — the <Route path="/app"> element and every child route's
 *      element — plus everything those components import, transitively (static, dynamic and re-exports;
 *      type-only imports are skipped). A component that renders a persona fallback (`name || "Paige"`)
 *      is caught wherever it lives, because it is imported;
 *   2. CUSTOMER_EMAIL_ROOTS and CUSTOMER_EDGE_ROOTS — customer-bound email templates and the edge
 *      modules that voice the customer's agent — plus their imports (the shared email footer);
 *   3. SCAN_DIRS, whole, so a new customer file is scanned before it is routed.
 * A child route wrapped in a STAFF_GATES component is staff-only and is not a root, but every such
 * route must be named in STAFF_ONLY_ROUTES with its reason, and every name there must be gated: removing
 * the gate puts the route back in scope and fails this check.
 *
 * EXEMPTIONS. A file: FILE_EXEMPT, with a reason; it must be in scope (a stale entry fails). A string:
 * `customer-identity-exempt: <reason>` (reason required). A marker covers EXACTLY ONE flagged string:
 * a marker after code on a line covers the flagged string on that line; a marker on a line of its own
 * covers the flagged string on the next line. A marker that would cover two strings, or none, fails —
 * so a marker can never quietly exempt a customer branch next to the staff text it was written for.
 * The exemptions are narrow by rule: a staff-only branch, the platform's legal name where it is a
 * legal-entity reference, a superseded consent sentence kept byte for byte because evidence already
 * names it, a consent or legal text awaiting legal review, and a model-only instruction.
 *
 * `--self-test` runs compliant and non-compliant fixtures through the same checker and scope builder.
 */

import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const ROUTE_SOURCE = "src/App.tsx";
export const PORTAL_ROUTE = "/app";

/** Components that make a child route staff-only. A customer gets the portal's not-available state. */
export const STAFF_GATES = ["RequirePortalStaff"];

/** Every staff-gated /app child route, by path, and why it is not a customer's. */
export const STAFF_ONLY_ROUTES = {
  "paige-team": "the PAIGE team directory is the owner's team (§14), never a customer's; RequirePortalStaff shows customers the portal's not-available state",
};

/** Customer-bound email: sent to a client of a business. */
export const CUSTOMER_EMAIL_ROOTS = [
  "supabase/functions/_shared/transactional-email-templates/coaching-reminder.tsx",
  "supabase/functions/_shared/transactional-email-templates/agreement-signature-request.tsx",
  "supabase/functions/_shared/transactional-email-templates/agreement-completed.tsx",
  "supabase/functions/_shared/transactional-email-templates/agreement-activity.tsx",
  "supabase/functions/_shared/transactional-email-templates/role-invitation.tsx",
  "supabase/functions/_shared/email/sender-display-name.ts",
];

/** Edge modules that voice the customer's agent. */
export const CUSTOMER_EDGE_ROOTS = [
  "supabase/functions/_shared/client-portal-identity.ts",
  "supabase/functions/_shared/client-portal-persona.ts",
  "supabase/functions/_shared/client-seat-reply.ts",
];

/** Scanned whole, routed or not. */
export const SCAN_DIRS = ["src/pages/app/", "src/components/app/", "src/components/client/"];

/** Files in scope that are not customer text, with the reason. Each must be in scope. */
export const FILE_EXEMPT = {
  "src/lib/playbook/presets.ts":
    "the owner's Playbook persona defaults; the customer chat replaces name, role and greeting from the customer frame (PaigeChat), and no customer surface reads persona.name",
  "src/components/ui/page/PaigeAttribution.tsx":
    "owner-only byline (rendered by ApprovalRow); in scope only through the ui/page barrel re-export",
};

const COO_NAME = /\b(?:Paige|PAIGE)\b|PaigeAgent/;
const EXEMPT = /customer-identity-exempt\s*:\s*\S+/;
const EXEMPT_COMMENT = /(?:\/\/|\/\*|\{\/\*)\s*customer-identity-exempt\s*:[^\n]*$/;

function isTest(path) {
  return /\.(test|spec)\.[cm]?[tj]sx?$/.test(path) || path.split(sep).includes("__tests__");
}

function parse(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

// ── scope ──────────────────────────────────────────────────────────────────────────────────────────

function resolveModule(root, from, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile() && /\.(ts|tsx)$/.test(c)) return c;
  }
  return null;
}

/** Module specifiers a file loads at runtime: static, dynamic and re-exports. Type-only imports are skipped. */
function runtimeImports(file, source) {
  const out = [];
  const visit = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.importClause?.isTypeOnly) out.push(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.isTypeOnly) out.push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword
      && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(file, source));
  return out;
}

function jsxTagName(n) {
  const tag = ts.isJsxElement(n) ? n.openingElement.tagName : ts.isJsxSelfClosingElement(n) ? n.tagName : null;
  return tag && ts.isIdentifier(tag) ? tag.text : null;
}
function jsxAttr(el, name) {
  const attrs = (ts.isJsxElement(el) ? el.openingElement : el).attributes.properties;
  return attrs.find((a) => ts.isJsxAttribute(a) && a.name.getText() === name);
}
function attrString(el, name) {
  const a = jsxAttr(el, name);
  return a?.initializer && ts.isStringLiteral(a.initializer) ? a.initializer.text : null;
}
/** Every capitalised JSX tag name inside a node (the components an element prop renders). */
function componentsIn(node) {
  const names = new Set();
  const visit = (n) => {
    const t = jsxTagName(n);
    if (t && /^[A-Z]/.test(t)) names.add(t);
    ts.forEachChild(n, visit);
  };
  if (node) visit(node);
  return names;
}

/** The /app route tree of App.tsx: its components (roots) and its staff-gated child routes. */
export function portalRoutes(root, staffOnly = STAFF_ONLY_ROUTES) {
  const file = join(root, ROUTE_SOURCE);
  const source = readFileSync(file, "utf8");
  const sf = parse(file, source);
  // Component name -> module specifier: `import { X } from "…"`, `import X from "…"` and
  // `const X = lazy…(() => import("…"))`.
  const modules = new Map();
  const visitDecl = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause && !n.importClause.isTypeOnly) {
      const spec = n.moduleSpecifier.text;
      if (n.importClause.name) modules.set(n.importClause.name.text, spec);
      const nb = n.importClause.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) modules.set(el.name.text, spec);
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let spec = null;
      const find = (m) => {
        if (spec) return;
        if (ts.isCallExpression(m) && m.expression.kind === ts.SyntaxKind.ImportKeyword && m.arguments[0] && ts.isStringLiteral(m.arguments[0])) spec = m.arguments[0].text;
        ts.forEachChild(m, find);
      };
      find(n.initializer);
      if (spec) modules.set(n.name.text, spec);
    }
    ts.forEachChild(n, visitDecl);
  };
  visitDecl(sf);

  let portal = null;
  const findPortal = (n) => {
    if (portal) return;
    if (jsxTagName(n) === "Route" && attrString(n, "path") === PORTAL_ROUTE && ts.isJsxElement(n)) portal = n;
    ts.forEachChild(n, findPortal);
  };
  findPortal(sf);
  if (!portal) throw new Error(`no <Route path="${PORTAL_ROUTE}"> in ${ROUTE_SOURCE}`);

  const rootNames = new Set(componentsIn(jsxAttr(portal, "element")));
  const routes = [];
  for (const child of portal.children) {
    if (jsxTagName(child) !== "Route") continue;
    const path = attrString(child, "path") ?? (jsxAttr(child, "index") ? "(index)" : "(unnamed)");
    const names = componentsIn(jsxAttr(child, "element"));
    const gated = STAFF_GATES.some((g) => names.has(g));
    routes.push({ path, names: [...names], gated });
    if (!gated) for (const nm of names) rootNames.add(nm);
  }
  const problems = [];
  for (const r of routes) {
    if (r.gated && !(r.path in staffOnly)) problems.push(`/app/${r.path} is staff-gated but not named in STAFF_ONLY_ROUTES (say why)`);
  }
  for (const p of Object.keys(staffOnly)) {
    const r = routes.find((x) => x.path === p);
    if (!r) problems.push(`STAFF_ONLY_ROUTES names /app/${p}, which is not an /app route`);
    else if (!r.gated) problems.push(`/app/${p} is named staff-only but is not wrapped in ${STAFF_GATES.join(" or ")}: a customer can open it`);
  }
  const rootFiles = [file];
  for (const nm of rootNames) {
    const spec = modules.get(nm);
    if (!spec) continue; // a JSX intrinsic-like component defined in App.tsx itself
    const resolved = resolveModule(root, file, spec);
    if (resolved) rootFiles.push(resolved);
  }
  return { routes, rootFiles, problems };
}

function walkDir(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkDir(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !isTest(p)) out.push(p);
  }
  return out;
}

/** The customer scope: files to scan, the route table, and configuration problems. */
export function customerScope(root = REPO_ROOT, config = {}) {
  const emailRoots = config.emailRoots ?? CUSTOMER_EMAIL_ROOTS;
  const edgeRoots = config.edgeRoots ?? CUSTOMER_EDGE_ROOTS;
  const scanDirs = config.scanDirs ?? SCAN_DIRS;
  const fileExempt = config.fileExempt ?? FILE_EXEMPT;
  const { routes, rootFiles, problems } = portalRoutes(root, config.staffOnly ?? STAFF_ONLY_ROUTES);
  const queue = [...rootFiles];
  for (const rel of [...emailRoots, ...edgeRoots]) {
    const abs = join(root, ...rel.split("/"));
    if (!existsSync(abs)) problems.push(`customer root is missing: ${rel}`);
    else queue.push(abs);
  }
  for (const d of scanDirs) {
    const abs = join(root, ...d.split("/"));
    if (!existsSync(abs)) problems.push(`scan directory is missing: ${d}`);
    else queue.push(...walkDir(abs, []));
  }
  const seen = new Set();
  const appFile = join(root, ROUTE_SOURCE);
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f) || isTest(f)) continue;
    seen.add(f);
    // App.tsx is the route table, not a surface: only the /app tree's components are followed from it.
    if (f === appFile) continue;
    for (const spec of runtimeImports(f, readFileSync(f, "utf8"))) {
      const r = resolveModule(root, f, spec);
      if (r) queue.push(r);
    }
  }
  seen.delete(appFile);
  const exempt = new Map();
  for (const [rel, reason] of Object.entries(fileExempt)) {
    const abs = join(root, ...rel.split("/"));
    if (!reason || !String(reason).trim()) problems.push(`FILE_EXEMPT ${rel} needs a reason`);
    if (!seen.has(abs)) problems.push(`FILE_EXEMPT ${rel} is not in the customer scope (stale entry)`);
    exempt.set(abs, reason);
  }
  const files = [...seen].filter((f) => !exempt.has(f)).sort();
  return { files, exempt, routes, problems };
}

// ── text ───────────────────────────────────────────────────────────────────────────────────────────

/** Every customer-visible text token in a source file: [{ line (0-based, of the first COO match), start (0-based), text }]. */
function visibleText(source, fileName) {
  const sf = parse(fileName, source);
  const found = [];
  const add = (node, text) => {
    const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    // The line the PAIGE word sits on, for a token that spans lines (JSX text, templates).
    const raw = source.slice(node.getStart(sf), node.getEnd());
    const m = COO_NAME.exec(raw);
    const line = m ? start + (raw.slice(0, m.index).match(/\n/g)?.length ?? 0) : start;
    found.push({ line, start, text });
  };
  const visit = (node) => {
    // Import and export paths are module names, never text.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) return;
    // A string-literal TYPE ("PAIGE" in a union) is never rendered.
    if (ts.isLiteralTypeNode(node)) return;
    // Console output is for developers; it never renders.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "console") return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      add(node.head, node.head.text);
      for (const span of node.templateSpans) add(span.literal, span.literal.text);
    } else if (ts.isJsxText(node)) add(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Findings for one file's source: [{ line (1-based), text }]. Exemption markers cover exactly one string. */
export function checkSource(source, fileName = "fixture.tsx") {
  const lines = source.split("\n");
  const flagged = visibleText(source, fileName).filter(({ text }) => COO_NAME.test(text));
  const findings = [];
  // Each marker's target line: its own line when code precedes it, else the next line.
  const covered = new Map(); // target line -> marker line
  lines.forEach((ln, i) => {
    if (!/customer-identity-exempt/.test(ln)) return;
    if (!EXEMPT.test(ln)) { findings.push({ line: i + 1, text: "customer-identity-exempt needs a reason" }); return; }
    const code = ln.replace(EXEMPT_COMMENT, "").replace(/[{}]\s*$/, "").trim();
    covered.set(code ? i : i + 1, i);
  });
  // A flagged string is covered by a marker that targets the line its PAIGE word is on, or the line the
  // string starts on (a multi-line JSX text or template). Each marker may cover exactly one string.
  const byMarker = new Map();
  for (const f of flagged) {
    const marker = covered.get(f.line) ?? covered.get(f.start);
    if (marker === undefined) { findings.push({ line: f.line + 1, text: f.text.trim().slice(0, 120) }); continue; }
    byMarker.set(marker, [...(byMarker.get(marker) ?? []), f]);
  }
  const used = new Set();
  for (const [marker, items] of byMarker) {
    used.add(marker);
    if (items.length > 1) findings.push({ line: marker + 1, text: `one exemption marker covers ${items.length} strings; put each on its own line with its own marker` });
  }
  for (const [, marker] of covered) {
    if (!used.has(marker)) findings.push({ line: marker + 1, text: "customer-identity-exempt marks no PAIGE string (stale or misplaced)" });
  }
  return findings.sort((a, b) => a.line - b.line);
}

function run() {
  const scope = customerScope();
  let failures = 0;
  for (const p of scope.problems) { failures++; console.error(`${ROUTE_SOURCE}: scope: ${p}`); }
  for (const file of scope.files) {
    for (const f of checkSource(readFileSync(file, "utf8"), file)) {
      failures++;
      console.error(`${relative(REPO_ROOT, file)}:${f.line}: names PAIGE on a customer surface: "${f.text}"`);
    }
  }
  if (failures) {
    console.error(`\n✗ customer-portal-identity-lint: ${failures} problem(s).`);
    console.error("  A customer talks to the business's agent: useCustomerIdentity().agentName (customerAgentName),");
    console.error("  useAssistantName() in a component an owner surface also mounts, or names the business.");
    console.error("  PAIGE is the owner's COO (owner ruling, 2026-10-19).");
    console.error("  Staff-only, legal-entity, superseded-evidence or model-only text: one string per line, with");
    console.error("  `customer-identity-exempt: <reason>` on that line or alone on the line above.");
    process.exit(1);
  }
  const gated = scope.routes.filter((r) => r.gated).map((r) => `/app/${r.path}`);
  console.log(`✓ customer-portal-identity-lint: ${scope.files.length} customer file(s) from ${scope.routes.length} /app route(s) and their imports, no customer-visible PAIGE.`);
  console.log(`  staff-gated: ${gated.join(", ") || "none"}; whole-file exemptions: ${scope.exempt.size}.`);
}

function selfTest() {
  const cases = [
    { name: "hardcoded Paige in JSX text", src: "export const A = () => <p>Tell Paige what you need.</p>;", bad: 1 },
    { name: "Paige in a string literal", src: 'export const t = "Ask Paige anything";', bad: 1 },
    { name: "PAIGE in an aria label", src: 'export const A = () => <div aria-label="Message PAIGE" />;', bad: 1 },
    { name: "Paige in template text", src: "export const t = (b: string) => `messages ${b} sends you through Paige.`;", bad: 1 },
    { name: "Playbook fallback literal", src: 'const name = persona?.name || "Paige";', bad: 1 },
    { name: "platform name", src: 'export const A = () => <span>{name || "PaigeAgent"}</span>;', bad: 1 },
    { name: "agent name from the frame", src: "export const A = ({ agentName }: { agentName: string }) => <p>Ask {agentName}</p>;", bad: 0 },
    { name: "identifiers, imports, events, types and comments", src: [
      'import { PaigeChat } from "@/components/app/PaigeChat";',
      "import paigeAvatar from \"@/assets/paige-ai-avatar.png\";",
      "// Paige is the owner's COO; this comment is not customer text.",
      'window.dispatchEvent(new CustomEvent("paige:prefill"));',
      'console.warn("[Paige] debug only");',
      'export type VP = "PAIGE" | "CURA";',
      "export const A = () => <PaigeChat avatar={paigeAvatar} />;",
    ].join("\n"), bad: 0 },
    { name: "exempt on the line", src: 'const staff = "Ask Paige anything"; // customer-identity-exempt: staff-only branch', bad: 0 },
    { name: "exempt alone on the line above", src: '// customer-identity-exempt: legal entity\nconst t = "Paige Agent AI";', bad: 0 },
    { name: "JSX exempt alone on the line above", src: 'export const A = () => (<p>\n  {/* customer-identity-exempt: legal entity */}\n  Terms from PaigeAgent\n</p>);', bad: 0 },
    // Round 2 (compliance #4): a marker used to cover its line and the TWO below, so a customer branch next to
    // the staff string it was written for passed. Now it covers one string, and a stale marker fails.
    { name: "exempt two lines above covers nothing", src: '// customer-identity-exempt: legal entity\nconst a = 1;\nconst t = "Paige Agent AI";', bad: 2 },
    { name: "a marker never reaches a customer string below its own line", src: 'const staff = "Message Paige"; // customer-identity-exempt: staff-only branch\nconst customer = "Ask Paige";', bad: 1 },
    { name: "one marker cannot cover two strings on a line", src: 'const p = c ? "Ask Paige" : "Message PAIGE"; // customer-identity-exempt: staff-only branch', bad: 1 },
    { name: "a marker that marks nothing fails", src: 'const t = "Ask Cura"; // customer-identity-exempt: staff-only branch', bad: 1 },
    { name: "an exemption needs a reason", src: 'const t = "Ask Paige"; // customer-identity-exempt:', bad: 2 },
    { name: "multi-line JSX text is flagged on the PAIGE line", src: "export const A = () => <p>\n  Review and accept\n  to keep using PaigeAgent.\n</p>;", bad: 1, line: 3 },
    { name: "a marker above a multi-line JSX text covers it", src: "export const A = () => <p>\n  {/* customer-identity-exempt: legal entity */}\n  <b>Note:</b> Texts come\n  from PaigeAgent.\n</p>;", bad: 0 },
    { name: "Paiget is a different word", src: 'const t = "Ask Paiget";', bad: 0 },
  ];
  let failed = 0;
  for (const c of cases) {
    const got = checkSource(c.src);
    const ok = got.length === c.bad && (c.line === undefined || got[0]?.line === c.line);
    if (!ok) { failed++; console.error(`✗ ${c.name}: expected ${c.bad} finding(s)${c.line ? ` at line ${c.line}` : ""}, got ${JSON.stringify(got)}`); }
    else console.log(`✓ ${c.name}`);
  }
  failed += scopeSelfTest();
  if (failed) { console.error(`\n✗ customer-portal-identity-lint self-test: ${failed} case(s) failed.`); process.exit(1); }
  console.log(`\n✓ customer-portal-identity-lint self-test: ${cases.length + SCOPE_CASES} case(s) passed.`);
}

const SCOPE_CASES = 5;
/** A miniature repo: the scope must follow /app routes and their imports, and honour the staff gate. */
function scopeSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), "cura-scope-"));
  const put = (rel, text) => { const p = join(dir, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
  let failed = 0;
  const check = (name, cond, detail) => { if (cond) console.log(`✓ scope: ${name}`); else { failed++; console.error(`✗ scope: ${name} ${detail ?? ""}`); } };
  try {
    const app = (gated) => `import { Shell } from "./pages/Shell";
const Help = lazy(() => import("./pages/Help"));
const Team = lazy(() => import("./pages/Team"));
export const App = () => (<Routes><Route path="/app" element={<Shell />}>
  <Route path="help" element={<Help />} />
  <Route path="team" element={${gated ? "<RequirePortalStaff><Team /></RequirePortalStaff>" : "<Team />"}} />
</Route><Route path="/operator" element={<Admin />} /></Routes>);`;
    put("src/pages/Shell.tsx", 'import { Thinking } from "@/components/Thinking";\nexport const Shell = () => <Thinking />;');
    put("src/components/Thinking.tsx", 'export const Thinking = ({ n }: { n?: string }) => <p>{n || "Paige"} is thinking</p>;');
    put("src/pages/Help.tsx", "export default () => <p>Help</p>;");
    put("src/pages/Team.tsx", "export default () => <p>Your Paige Team</p>;");
    put("src/pages/admin/Admin.tsx", "export default () => <p>Paige admin</p>;");
    put("src/pages/app/.keep.ts", "export {};");
    const cfg = { emailRoots: [], edgeRoots: [], scanDirs: ["src/pages/app/"], fileExempt: {}, staffOnly: { team: "owner team" } };
    put("src/App.tsx", app(true));
    let s = customerScope(dir, cfg);
    const rel = (f) => relative(dir, f).split(sep).join("/");
    check("an imported component's persona fallback is in scope", s.files.map(rel).includes("src/components/Thinking.tsx"));
    check("the staff-gated route's page is not a customer root", !s.files.map(rel).includes("src/pages/Team.tsx"));
    check("routes outside /app are not in scope", !s.files.map(rel).includes("src/pages/admin/Admin.tsx"));
    check("a gated route that is named staff-only is clean", s.problems.length === 0, JSON.stringify(s.problems));
    put("src/App.tsx", app(false));
    s = customerScope(dir, cfg);
    check("removing the staff gate puts the page back in scope and fails", s.files.map(rel).includes("src/pages/Team.tsx")
      && s.problems.some((p) => p.includes("/app/team is named staff-only but is not wrapped")), JSON.stringify(s.problems));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--self-test")) selfTest(); else run();
}
