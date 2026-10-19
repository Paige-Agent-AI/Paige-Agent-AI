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
 * WHAT IT FLAGS: any customer-visible text in a customer-surface file that names the COO — `Paige`,
 * `PAIGE` (whole word, case-sensitive) or `PaigeAgent`. "Customer-visible text" is read from the
 * TypeScript syntax tree, not from raw lines: string literals, template-literal text and JSX text.
 * Comments, identifiers (PaigeChat, paigeAvatar), import paths and lowercase event names
 * ("paige:prefill") are never text a customer reads, and are never flagged.
 *
 * NOT FLAGGED: a line carrying `customer-identity-exempt: <reason>` (reason required) on the flagged
 * line or either of the two lines above it. The exemptions are narrow by rule: a staff-only branch
 * (an admin previewing /app), the platform's legal name where it is a legal-entity reference, a
 * superseded consent sentence kept byte for byte because evidence already names it, and a model-only
 * instruction the customer never reads.
 *
 * SCOPE: the customer portal's surfaces (CUSTOMER_SCOPE below). Owner and staff surfaces, the
 * marketing site and the platform's legal pages are out of scope and keep PAIGE.
 *
 * `--self-test` runs compliant and non-compliant fixtures through the same checker.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The customer portal: what a client of a business sees or receives. A trailing "/" is a directory. */
export const CUSTOMER_SCOPE = [
  "src/pages/AppShell.tsx",
  "src/pages/ClientApprovals.tsx",
  "src/pages/FundingMatches.tsx",
  "src/pages/app/",
  "src/components/app/",
  "src/components/client/",
  "src/components/approvals/ClientApprovalsView.tsx",
  "src/components/dashboard/OnboardingChecklist.tsx",
  "src/components/dashboard/OnboardingFlow.tsx",
  "src/components/dashboard/RepositioningNotice.tsx",
  "src/components/dashboard/DataPrivacyPanel.tsx",
  "src/components/dashboard/business-profile/",
  "src/components/onboarding/DemographicQuestionsStep.tsx",
  "src/components/notifications/PushNotificationPrompt.tsx",
  "src/components/funding/FundingWalkthrough.tsx",
  "src/components/credit/CreditIntelWalkthrough.tsx",
  "src/hooks/useClientPortalFrame.ts",
  "src/lib/client-portal-preferences.ts",
  "src/lib/portal/customerIdentity.tsx",
  "supabase/functions/_shared/client-portal-identity.ts",
  "supabase/functions/_shared/client-portal-persona.ts",
  "supabase/functions/_shared/client-seat-reply.ts",
  "supabase/functions/_shared/transactional-email-templates/coaching-reminder.tsx",
];

const COO_NAME = /\b(?:Paige|PAIGE)\b|PaigeAgent/;
const EXEMPT = /customer-identity-exempt\s*:\s*\S+/;

function isTest(path) {
  return /\.(test|spec)\.[cm]?[tj]sx?$/.test(path) || path.split(sep).includes("__tests__");
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !isTest(p)) out.push(p);
  }
  return out;
}

function scopeFiles() {
  const files = [];
  for (const entry of CUSTOMER_SCOPE) {
    const abs = join(REPO_ROOT, ...entry.split("/"));
    if (!existsSync(abs)) throw new Error(`customer scope entry is missing: ${entry} (update CUSTOMER_SCOPE)`);
    if (entry.endsWith("/")) walk(abs, files);
    else files.push(abs);
  }
  return files;
}

/** Every customer-visible text token in a source file: [{ line, text }]. */
function visibleText(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const add = (node, text) => found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line, text });
  const visit = (node) => {
    // Import and export paths are module names, never text.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") return;
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

/** Findings for one file's source: [{ line (1-based), text }]. */
export function checkSource(source, fileName = "fixture.tsx") {
  const lines = source.split("\n");
  const exempt = (i) => [i, i - 1, i - 2].some((j) => j >= 0 && EXEMPT.test(lines[j] ?? ""));
  return visibleText(source, fileName)
    .filter(({ line, text }) => COO_NAME.test(text) && !exempt(line))
    .map(({ line, text }) => ({ line: line + 1, text: text.trim().slice(0, 120) }));
}

function run() {
  let failures = 0;
  const files = scopeFiles();
  for (const file of files) {
    for (const f of checkSource(readFileSync(file, "utf8"), file)) {
      failures++;
      console.error(`${relative(REPO_ROOT, file)}:${f.line}: names PAIGE on a customer surface: "${f.text}"`);
    }
  }
  if (failures) {
    console.error(`\n✗ customer-portal-identity-lint: ${failures} customer-visible PAIGE reference(s).`);
    console.error("  A customer talks to the business's agent: useCustomerIdentity().agentName (customerAgentName),");
    console.error("  or names the business. PAIGE is the owner's COO (owner ruling, 2026-10-19).");
    console.error("  Staff-only, legal-entity, superseded-evidence or model-only text: add `customer-identity-exempt: <reason>`.");
    process.exit(1);
  }
  console.log(`✓ customer-portal-identity-lint: ${files.length} customer-surface file(s), no customer-visible PAIGE.`);
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
    { name: "identifiers, imports, events and comments", src: [
      'import { PaigeChat } from "@/components/app/PaigeChat";',
      "import paigeAvatar from \"@/assets/paige-ai-avatar.png\";",
      "// Paige is the owner's COO; this comment is not customer text.",
      'window.dispatchEvent(new CustomEvent("paige:prefill"));',
      'console.warn("[Paige] debug only");',
      "export const A = () => <PaigeChat avatar={paigeAvatar} />;",
    ].join("\n"), bad: 0 },
    { name: "exempt on the line", src: 'const staff = "Ask Paige anything"; // customer-identity-exempt: staff-only branch', bad: 0 },
    { name: "exempt two lines above", src: '// customer-identity-exempt: legal entity\nconst a = 1;\nconst t = "Paige Agent AI";', bad: 0 },
    { name: "exempt too far above", src: '// customer-identity-exempt: legal entity\nconst a = 1;\nconst b = 2;\nconst t = "Paige Agent AI";', bad: 1 },
    { name: "an exemption needs a reason", src: 'const t = "Ask Paige"; // customer-identity-exempt:', bad: 1 },
    { name: "Paiget is a different word", src: 'const t = "Ask Paiget";', bad: 0 },
  ];
  let failed = 0;
  for (const c of cases) {
    const got = checkSource(c.src).length;
    if (got !== c.bad) { failed++; console.error(`✗ ${c.name}: expected ${c.bad} finding(s), got ${got}`); }
    else console.log(`✓ ${c.name}`);
  }
  if (failed) { console.error(`\n✗ customer-portal-identity-lint self-test: ${failed} case(s) failed.`); process.exit(1); }
  console.log(`\n✓ customer-portal-identity-lint self-test: ${cases.length} case(s) passed.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--self-test")) selfTest(); else run();
}
