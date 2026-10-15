#!/usr/bin/env node
/**
 * solo-parity-guard.mjs — the Solo parity static CI check (PR-P2, census proposal).
 *
 * WHY: the Solo Parity Census (INT-071) established that Solo accounts must never
 * diverge from one another by identity. Parity today rests on structural facts —
 * the route stack order, the gate that must not gate (#1277), the surfaces that
 * must never be role/setup-gated, and the absence of identity branches. Those
 * facts were proven by hand in the census docs; this guard makes them CI-invariants
 * so a later edit cannot silently break one. It is DEPLOYMENT-INERT: it edits no
 * runtime file and asserts only structural facts about code that already exists.
 *
 * WHAT IT CHECKS (violation codes):
 *   SP1  route-stack order for /solo/*: the App.tsx mount is exactly
 *        RequireCompleteSignup → RequireSoloBetaEntitlement → RequireSetupComplete
 *        → SoloEntry (in that order, nothing role/setup-shaped inserted between).
 *   SP2  no redirect in the Solo branch of RequireSetupComplete (#1277): the solo
 *        branch returns children ONLY — no Navigate, no router push, no gate.
 *   SP3  PAIGE and the Command Center are not gated by role/setup/provider/tenant
 *        identity: SoloApp mounts SoloPaigeWorkspace and the CommandHub home
 *        screen unconditionally (no conditional wrapper on their mount sites).
 *   SP4  no identity branches in Solo route/shell code: no account-number or
 *        tenant-UUID literals, no tenant-name/slug identity comparisons, and no
 *        creation-date branches in the solo tree + routing, chrome and tier seams.
 *   SP5  registry snapshot for nav + tier floor, with doc counts derived from the
 *        SAME registries: the settings destinations and nav branch slugs are
 *        re-derived from SOLO_SETTINGS_DESTINATIONS / SOLO_BRANCHES and compared
 *        to the committed snapshot; the shell doctrine's Settings rows must name
 *        EXACTLY the registry destinations (the docs' count is derived, never
 *        hand-typed).
 *
 * DELIBERATELY NOT CHECKED (out of scope by coordinator ruling): the
 * "no owner_user_id in authorization predicates" rule — it does not hold today
 * and ships with the solo_setup_access_scope access PR, not here.
 *
 * HEURISTIC LIMITS (coordinator ruling 2026-09-20, round 2 comment-only):
 * this guard is TEXT-BASED. Its threat model is defending against ACCIDENTAL
 * DRIFT FROM OUR OWN EDITS, not adversarial evasion; no claim of completeness.
 * Known un-fixed evasion classes (Codex 62d370a1/03268bd6 rounds, ruled known
 * limits — the root fix is a SHARED AST helper the coordinator will sequence
 * for this guard, the SDK lane's #1295 import resolution, and the Mind lane's
 * PR-A3; do not build a per-guard AST here):
 *   SP1 — conditional/expression-wrapped mounts (e.g. `{isOwner && <Require…>}`)
 *         pass the component-set check; the wrapper EXPRESSION is not parsed.
 *   SP2 — aliased navigation bindings (`const goTo = useNavigate(); goTo(…)`)
 *         pass; only a literal `navigate(` is recognized in the Solo branch.
 *   SP4 — aliases, computed property names and indirect identity predicates are
 *         not resolved. Literal comparisons in either direction, including
 *         qualified and quoted account-number access, are covered.
 * Fail-closed fragilities (a reformat trips the guard RED, never silently
 * passes): SP1 depends on the /solo/* route mount living on ONE line in
 * App.tsx, and SP2 depends on the `// ── SUB-ACCOUNT` marker delimiting the
 * solo branch of RequireSetupComplete. If either file is reformatted, the
 * guard fails loudly and the pin must be re-grounded deliberately.
 *
 * Self-test mode (--self-test) runs the guard's checks against mutated fixture
 * trees and asserts each violation code fires (the guard is load-bearing).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdtempSync, cpSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const root = (() => {
  const i = process.argv.indexOf("--root");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
})();

const read = (p) => readFileSync(join(root, p), "utf8");
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const violations = [];
const fail = (code, detail) => violations.push(`${code}: ${detail}`);

// ── SP1 ── route-stack order for /solo/* ────────────────────────────────────
const appSrc = read("src/App.tsx");
const soloRoute = appSrc.split("\n").find((l) => l.includes('path="/solo/*"'));
if (!soloRoute) {
  fail("SP1", 'no `path="/solo/*"` route found in src/App.tsx');
} else {
  const order = ["RequireCompleteSignup", "RequireSoloBetaEntitlement", "RequireSetupComplete", "SoloEntry"];
  let at = -1;
  for (const name of order) {
    const idx = soloRoute.indexOf(name);
    if (idx < 0) { fail("SP1", `${name} missing from the /solo/* route mount`); break; }
    if (idx < at) { fail("SP1", `${name} appears out of order in the /solo/* route mount`); }
    at = idx;
  }
  // The wrapper CHAIN must be exact: every JSX component inside the mount
  // element is one of the four guards + PageSuspense. A renamed gate
  // (e.g. <SetupGate>) wrapping SoloEntry is caught by set membership, not by
  // name-pattern recognition (Codex 62d370a1 P2).
  const element = soloRoute.slice(soloRoute.indexOf("element="));
  const allowed = new Set([...order, "PageSuspense"]);
  const components = [...element.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]);
  const unexpected = [...new Set(components.filter((c) => !allowed.has(c)))];
  if (unexpected.length) fail("SP1", `unexpected component(s) in the /solo/* mount chain: ${unexpected.join(", ")}`);
}

// ── SP2 ── no redirect in the Solo branch of RequireSetupComplete ───────────
const gateSrc = read("src/components/auth/RequireSetupComplete.tsx");
const soloStart = gateSrc.indexOf('if (tierKey === "solo")');
const soloEnd = gateSrc.indexOf("// ── SUB-ACCOUNT");
if (soloStart < 0 || soloEnd < soloStart) {
  fail("SP2", "the solo branch of RequireSetupComplete was not found");
} else {
  const branch = gateSrc.slice(soloStart, soloEnd);
  if (!branch.includes("return <>{children}</>;")) fail("SP2", "the solo branch does not return children ONLY");
  const code = stripComments(branch);
  // Every redirect mechanism, not just Navigate/router.push: browser-location
  // assignment (window.location.assign/replace/href) and hook navigation
  // (navigate(...)) restore the lockout while looking like "children only"
  // (Codex 62d370a1 P2).
  if (/\bNavigate\b|router\s*\.\s*(push|replace)|\bredirect\b|\bwindow\s*\.\s*location\b|\blocation\s*\.\s*(assign|replace)\b|\blocation\.href\s*=|(?<![A-Za-z])navigate\s*\(/i.test(code)) {
    fail("SP2", "the solo branch contains redirect machinery (Navigate/router/location/navigate)");
  }
}

// ── SP3 ── PAIGE + Command Center not gated by role/setup/provider/tenant id ─
const soloAppSrc = read("src/solo/SoloApp.tsx");
const paigeMount = soloAppSrc.split("\n").find((l) => l.includes("soloPaigeWorkspace={<SoloPaigeWorkspace"));
const homeMount = soloAppSrc.split("\n").find((l) => l.includes("home:<CommandHub"));
for (const [label, line] of [["SoloPaigeWorkspace", paigeMount], ["CommandHub home", homeMount]]) {
  if (!line) { fail("SP3", `${label} mount site not found in SoloApp.tsx`); continue; }
  const code = stripComments(line);
  const gated = code.match(/\?\s*\(?\s*null|&&\s*(isOwner|role|setup|provider|tenantId|tenant_id|account)/i);
  if (gated) fail("SP3", `${label} appears conditionally mounted (${code.trim().slice(0, 90)}…)`);
  if (/\b(role|isOwner|isPrimaryOwner|setupComplete|provider|tenantId|tenant_id)\b/i.test(code)) {
    fail("SP3", `${label} mount references a role/setup/provider/tenant-identity fact`);
  }
}

// ── SP4 ── no identity branches in Solo route/shell code ────────────────────
const sweepFiles = (() => {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
  };
  walk(join(root, "src", "solo"));
  for (const seam of [
    "src/lib/routing/tierBranches.ts",
    "src/lib/auth/workspaceEntry.ts",
    "src/lib/auth/resolveLandingRoute.ts",
    "src/components/auth/RequireSetupComplete.tsx",
    "src/components/tenant-shell/TenantCommandCenterShell.tsx",
    "src/components/auth/RequireSoloBetaEntitlement.tsx",
    "src/lib/tier/tierFeatures.ts",
  ]) {
    try { out.push(join(root, seam)); } catch { /* missing seam file is SP4's own finding below */ }
  }
  return out;
})();
if (sweepFiles.length === 0) fail("SP4", "no files found to sweep");
for (const p of sweepFiles) {
  let code;
  try { code = stripComments(readFileSync(p, "utf8")); } catch { fail("SP4", `unreadable sweep file: ${p}`); continue; }
  const rel = p.slice(root.length + 1).replace(/\\/g, "/");
  // Account numbers are positive addresses. Zero validation and dynamic route
  // construction remain legal; selecting behavior by a positive literal does not.
  const accountOperand = String.raw`(?:\b(?:[A-Za-z_$][\w$]*\s*(?:\?\.|\.)\s*)*account_?[Nn]umber\b|\b[A-Za-z_$][\w$]*(?:\s*(?:\?\.|\.)\s*[A-Za-z_$][\w$]*)*\s*(?:\?\.)?\s*\[\s*["']account_?[Nn]umber["']\s*\])`;
  const positiveAddress = String.raw`(?:["'\x60]0*[1-9]\d*["'\x60]|\b[1-9]\d*\b)`;
  const comparison = String.raw`\s*(?:={2,3}|!={1,2})\s*`;
  const acct = code.match(new RegExp(accountOperand + comparison + positiveAddress))
    ?? code.match(new RegExp(positiveAddress + comparison + accountOperand));
  if (acct) fail("SP4", `account-number literal comparison in ${rel}`);
  const uuid = code.match(/["'`][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}["'`]/i);
  if (uuid) fail("SP4", `tenant-UUID literal in ${rel}`);
  const nameIdentity = code.match(/\b(activeTenant\?*\.\s*(name|slug)|tenantName|tenant\.slug)\s*===?\s*["'`][^"'`]+["'`]/);
  if (nameIdentity) fail("SP4", `tenant-name/slug identity comparison in ${rel}`);
  const dateBranch = code.match(/\b(createdAt|created_at)\s*(===?|<|>|<=|>=)\s*["'`]?[\d-]{6,}/);
  if (dateBranch) fail("SP4", `creation-date branch in ${rel}`);
}

// ── SP5 ── registry snapshot for nav + tier floor; doc counts derived likewise ─
const settingsContract = read("src/solo/settings-contract.ts");
const settingsKeys = [...settingsContract.matchAll(/key:\s*"([a-z-]+)",\s*label/g)].map((m) => m[1]);
const tierBranches = read("src/lib/routing/tierBranches.ts");
const soloBranchMatch = tierBranches.match(/SOLO_BRANCHES[^=]*=\s*\[([\s\S]*?)\n\];/);
const navSlugs = [...(soloBranchMatch?.[1] ?? "").matchAll(/slug:\s*"([a-z-]+)"/g)].map((m) => m[1]);
const workspaceEntry = read("src/lib/auth/workspaceEntry.ts");
const floorMatch = workspaceEntry.match(/solo:\s*\[([^\]]*)\]/);
const tierFloor = floorMatch ? floorMatch[1].replace(/[\s"']/g, "").split(",") : null;

let snapshot;
try { snapshot = JSON.parse(read("scripts/ci/solo-parity-snapshot.json")); } catch { snapshot = null; }
if (settingsKeys.length === 0) fail("SP5", "SOLO_SETTINGS_DESTINATIONS registry not found/empty");
if (navSlugs.length === 0) fail("SP5", "SOLO_BRANCHES registry not found/empty");
if (!tierFloor || tierFloor.length === 0) fail("SP5", "ROUTE_TIERS solo floor not found");
if (snapshot) {
  if (JSON.stringify(snapshot.settingsDestinations) !== JSON.stringify(settingsKeys)) {
    fail("SP5", `settings destinations drifted from the snapshot (registry: ${settingsKeys.join(",")} vs snapshot: ${(snapshot.settingsDestinations ?? []).join(",")})`);
  }
  if (JSON.stringify(snapshot.navBranchSlugs) !== JSON.stringify(navSlugs)) {
    fail("SP5", `solo nav branch slugs drifted from the snapshot (registry ${navSlugs.length} vs snapshot ${(snapshot.navBranchSlugs ?? []).length})`);
  }
  if (JSON.stringify(snapshot.tierFloorSolo) !== JSON.stringify(tierFloor)) {
    fail("SP5", `ROUTE_TIERS solo floor drifted (registry ${tierFloor} vs snapshot ${snapshot.tierFloorSolo})`);
  }
} else if (settingsKeys.length && navSlugs.length && tierFloor) {
  fail("SP5", "scripts/ci/solo-parity-snapshot.json missing — derive it from the registries (see --emit-snapshot)");
}

// The doctrine's Settings rows must name EXACTLY the registry destinations.
const doctrine = read("docs/doctrine/solo-shell-contract.md");
const doctrineSettings = doctrine
  .split("\n")
  .filter((l) => l.startsWith("| Settings →"))
  .flatMap((l) => l.split("→")[1]?.split("|")[0].split(",") ?? [])
  .map((s) => s.replace(/\(incl\.[^)]*\)/g, "").replace(/\*\*/g, "").trim())
  .filter(Boolean);
const registryLabels = [...settingsContract.matchAll(/key:\s*"([a-z-]+)",\s*label:\s*"([^"]+)"/g)].map((m) => m[1] === "security-data" ? "Security & data" : m[2]);
const doctrineSet = [...doctrineSettings].sort().join("|");
const registrySet = [...registryLabels].sort().join("|");
if (doctrineSet !== registrySet) {
  fail("SP5", `the shell doctrine's Settings destinations do not match the registry (doctrine: ${doctrineSettings.join(", ")} vs registry: ${registryLabels.join(", ")})`);
}

// ── report ─────────────────────────────────────────────────────────────────
const emitSnapshot = process.argv.includes("--emit-snapshot");
if (emitSnapshot && settingsKeys.length && navSlugs.length && tierFloor) {
  writeFileSync(join(root, "scripts/ci/solo-parity-snapshot.json"), `${JSON.stringify({
    settingsDestinations: settingsKeys,
    navBranchSlugs: navSlugs,
    tierFloorSolo: tierFloor,
  }, null, 2)}\n`);
  console.log("snapshot written from the registries");
}

if (process.argv.includes("--self-test")) {
  // Mutated fixture trees: each mutation must produce its violation code.
  const patch = (t, file, from, to) => {
    const p = join(t, file);
    writeFileSync(p, readFileSync(p, "utf8").replace(from, to));
  };
  const mutate = (fn) => {
    const tmp = mkdtempSync(join(tmpdir(), "solo-parity-"));
    try {
      // Copy every source boundary the guard reads, rather than unrelated
      // product/media trees. Positive controls below fail if a required input
      // is missing; all original mutation assertions remain unchanged.
      cpSync(join(root, "src/solo"), join(tmp, "src/solo"), { recursive: true });
      for (const file of [
        "src/App.tsx", "src/lib/routing/tierBranches.ts",
        "src/lib/auth/workspaceEntry.ts", "src/lib/auth/resolveLandingRoute.ts",
        "src/components/auth/RequireSetupComplete.tsx",
        "src/components/tenant-shell/TenantCommandCenterShell.tsx",
        "src/components/auth/RequireSoloBetaEntitlement.tsx",
        "src/lib/tier/tierFeatures.ts",
      ]) {
        mkdirSync(dirname(join(tmp, file)), { recursive: true });
        cpSync(join(root, file), join(tmp, file));
      }
      // The guard reads this one doctrine file. Copying historical screenshots
      // and release archives adds no negative-control coverage.
      mkdirSync(join(tmp, "docs", "doctrine"), { recursive: true });
      cpSync(join(root, "docs/doctrine/solo-shell-contract.md"), join(tmp, "docs/doctrine/solo-shell-contract.md"));
      mkdirSync(join(tmp, "scripts", "ci"), { recursive: true });
      cpSync(join(root, "scripts/ci/solo-parity-snapshot.json"), join(tmp, "scripts", "ci", "solo-parity-snapshot.json"));
      fn(tmp);
      try {
        execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--root", tmp], { stdio: "pipe" });
        return null;
      } catch (e) {
        return String(e.stdout ?? "") + String(e.stderr ?? "");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };
  const cases = [
    ["SP1", (t) => patch(t, "src/App.tsx", "<SoloEntry />", "<RequireOwnerGate><SoloEntry /></RequireOwnerGate>")],
    ["SP1", (t) => patch(t, "src/App.tsx", "<SoloEntry />", "<SetupGate><SoloEntry /></SetupGate>")],
    ["SP2", (t) => patch(t, "src/components/auth/RequireSetupComplete.tsx", 'return <>{children}</>;\n  }', 'return <Navigate to="/x" replace />;\n  }')],
    ["SP2", (t) => patch(t, "src/components/auth/RequireSetupComplete.tsx", 'return <>{children}</>;\n  }', 'window.location.assign("/choose-account");\n    return <>{children}</>;\n  }')],
    ["SP3", (t) => patch(t, "src/solo/SoloApp.tsx", "soloPaigeWorkspace={<SoloPaigeWorkspace", 'soloPaigeWorkspace={role === "owner" ? <SoloPaigeWorkspace')],
    ["SP4", (t) => patch(t, "src/lib/routing/tierBranches.ts", "export const ENTERPRISE_EXTRA", 'const sp4Mutation = accountNumber === "1234567";\nexport const ENTERPRISE_EXTRA')],
    ["SP4", (t) => patch(t, "src/lib/routing/tierBranches.ts", "export const ENTERPRISE_EXTRA", 'const sp4Mutation = activeTenant?.account_number === 1234567;\nexport const ENTERPRISE_EXTRA')],
    ["SP4", (t) => patch(t, "src/lib/routing/tierBranches.ts", "export const ENTERPRISE_EXTRA", 'const sp4Mutation = 7654321 === activeTenant?.account_number;\nexport const ENTERPRISE_EXTRA')],
    ["SP4", (t) => patch(t, "src/lib/routing/tierBranches.ts", "export const ENTERPRISE_EXTRA", 'const sp4Mutation = activeTenant["account_number"] === "7654321";\nexport const ENTERPRISE_EXTRA')],
    ["SP4", (t) => patch(t, "src/lib/routing/tierBranches.ts", "export const ENTERPRISE_EXTRA", 'const sp4Mutation = accountNumber === 42;\nexport const ENTERPRISE_EXTRA')],
    ["SP4", (t) => writeFileSync(join(t, "src/components/tenant-shell/TenantCommandCenterShell.tsx"), readFileSync(join(t, "src/components/tenant-shell/TenantCommandCenterShell.tsx"), "utf8") + '\nconst sp4Mutation = activeTenant?.id === "11111111-2222-4333-8444-555555555555";\n')],
    ["SP4", (t) => writeFileSync(join(t, "src/components/auth/RequireSoloBetaEntitlement.tsx"), readFileSync(join(t, "src/components/auth/RequireSoloBetaEntitlement.tsx"), "utf8") + '\nconst sp4Mutation = activeTenant?.account_number === 7654321;\n')],
    ["SP4", (t) => writeFileSync(join(t, "src/lib/tier/tierFeatures.ts"), readFileSync(join(t, "src/lib/tier/tierFeatures.ts"), "utf8") + '\nconst sp4Mutation = tenantName === "test-tenant-special";\n')],
    ["PASS", (t) => writeFileSync(join(t, "src/components/tenant-shell/TenantCommandCenterShell.tsx"), readFileSync(join(t, "src/components/tenant-shell/TenantCommandCenterShell.tsx"), "utf8") + '\nconst sp4Address = "/solo/" + activeTenant.account_number + "/clients";\nconst sp4Validation = accountNumber === 0;\n')],
    ["PASS", (t) => writeFileSync(join(t, "src/lib/tier/tierFeatures.ts"), readFileSync(join(t, "src/lib/tier/tierFeatures.ts"), "utf8") + '\nconst sp4Eligibility = tenant.account_type === "standalone" && entitlement.enabled && permission.allowed && provider.ready;\n')],
    ["SP5", (t) => patch(t, "src/solo/settings-contract.ts", '{ key: "vault", label: "Vault", truth: "PROPOSED" },', "")],
  ];
  let selfTestOk = true;
  for (const [code, fn] of cases) {
    const out = mutate(fn);
    if (code === "PASS") {
      if (out) {
        selfTestOk = false;
        console.error(`SELF-TEST FAIL: legitimate address/eligibility fixture was refused (${out.slice(0, 200)})`);
      } else console.log("self-test: legitimate address/eligibility fixture passed ✓");
      continue;
    }
    if (!out || !out.includes(code)) {
      selfTestOk = false;
      console.error(`SELF-TEST FAIL: mutation for ${code} did not fire (output: ${(out ?? "exit 0").slice(0, 200)})`);
    } else {
      console.log(`self-test: ${code} fired under mutation ✓`);
    }
  }
  if (!selfTestOk) process.exit(1);
  console.log("solo-parity-guard self-test: all mutation cases fired");
  process.exit(0);
}

if (violations.length) {
  console.error("solo-parity-guard: FAIL");
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log("solo-parity-guard: PASS (SP1–SP5)");
