#!/usr/bin/env node
/**
 * capability-declaration-lint — every tool the MODEL can call must be DECLARED by a domain,
 * and where two sources describe the same act they must not contradict each other.
 *
 * THE GAP THIS GUARDS, measured 2026-09-24 against this tree. Capability truth is kept in five
 * places that do not know about one another: the Chat handler's tool array (what the model sees),
 * the PAIGE Spine registry (what a domain declares), `list_tool_autonomy()` (what the operator can
 * switch), `_shared/action-risk.ts` (how much proof an act needs), and the Capability Kit bypass
 * ledger. `lint:tool-catalogue` already holds the runtime↔operator seam. THIS guard holds the
 * model↔Spine seam, which nothing held before:
 *
 *   154 tools on the maximum model surface · 65 of them declared by a Spine capability ·
 *    89 undeclared, of which 46 MUTATE.
 *
 * Those 46 are the ones that matter. An undeclared READ tool is a documentation gap. An undeclared
 * MUTATING tool is an act with no domain owner, no idempotency statement, no approval-authority
 * declaration and no Rail contract — and the autonomy policy will happily run it unattended once a
 * tenant sets it to `auto`. `document_generate` is the live example: it mints offer letters with
 * signature lines and an "Accept" CTA, is classified `ordinary`, has ZERO Spine registration and
 * ZERO `record_capability_run` coverage. That is why rule 3 exists — the two populations are
 * reported separately, because they are not the same problem.
 *
 * THE THREE RULES
 *
 *   1. DECLARATION. Every tool on the model surface has a Spine capability whose `action.chatTool`
 *      names it, or it is an EXACT entry in the shrink-only baseline. New tool, no declaration,
 *      not in the baseline → FAIL.
 *   2. AGREEMENT. Where a tool has BOTH a Spine capability and an action-risk class, the two must
 *      agree. The rules below are derived from the real types — `SpineActionClassification`,
 *      `SpineRiskPolicy` and `ActionRisk` — and nothing else. This rule is a WALL, not a ratchet:
 *      it has zero violations on this tree, so enforcing it blocks nothing that is already true.
 *   3. SEVERITY. A baselined MUTATING tool is reported distinctly from a baselined READ tool, and
 *      a baselined READ tool that later GAINS a risk class fails — the membership stayed flat but
 *      the gap got worse, which is exactly the churn a bare count hides.
 *
 * A RATCHET, NOT A WALL (rule 1). Failing outright would block every unrelated PR on a
 * pre-existing gap, so the known 89 are the baseline: the guard fails when the gap GROWS and tells
 * you to lower the baseline when it shrinks. Same posture, and deliberately the same wording, as
 * `scripts/ci/tool-catalogue-lint.mjs`.
 *
 * WHAT THIS GUARD DOES NOT COVER, stated so nobody reads silence as coverage (§13):
 *   · A Spine capability that declares a `chatTool` NO tool array contains — today exactly one,
 *     `integrations_health` (paige-spine/domains/integrations_surface.ts). The registry asserts a
 *     Chat binding for a tool that does not exist. That is the mirror seam and it wants its own
 *     check; this one walks the model surface, not the registry.
 *   · Catalogue rows with no tool behind them, receipts, and Kit adoption. Other guards, or gaps.
 *
 *   node scripts/ci/capability-declaration-lint.mjs
 *   node scripts/ci/capability-declaration-lint.mjs --self-test
 *   node scripts/ci/capability-declaration-lint.mjs --update-baseline   (regenerate, deliberately)
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const LOADER = path.join(ROOT, "scripts", "knowledge-scope", "register.mjs");

const HANDLER = path.join(ROOT, "supabase/functions/paige-ai-chat/index.ts");
const REGISTRY = path.join(ROOT, "supabase/functions/_shared/paige-spine/registry.ts");
const POLICY = path.join(ROOT, "supabase/functions/_shared/action-risk.ts");
const BASELINE = process.env.CAPABILITY_DECLARATION_BASELINE
  ? path.resolve(process.env.CAPABILITY_DECLARATION_BASELINE)
  : path.join(HERE, "capability-declaration-baseline.json");

/**
 * The Spine registry and the domain tool arrays are Deno `.ts` modules. Rather than re-implement
 * them with regexes — which is how a resolver silently under-counts and a guard grades a subset
 * while reporting a total — this check IMPORTS them through the repository's existing offline
 * loader and reads the real arrays. If the loader is not registered, re-exec ourselves with it.
 */
if (!process.env.__CAPDECL_LOADER) {
  const child = spawnSync(process.execPath, ["--import", pathToFileURL(LOADER).href, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, __CAPDECL_LOADER: "1" },
  });
  process.exit(child.status ?? 1);
}

/* ───────────────────────── the model surface ───────────────────────── */

/** Bracket-match from `open` (an index pointing at `[`), skipping strings and comments. */
export function balanced(source, open) {
  let depth = 0, quote = null, escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "/" && source[i + 1] === "/") { const nl = source.indexOf("\n", i); if (nl < 0) break; i = nl; continue; }
    if (c === "/" && source[i + 1] === "*") { const end = source.indexOf("*/", i); if (end < 0) break; i = end + 1; continue; }
    if (c === "[" || c === "{" || c === "(") depth += 1;
    else if (c === "]" || c === "}" || c === ")") { depth -= 1; if (depth === 0) return source.slice(open, i + 1); }
  }
  return null;
}

/**
 * A tool declaration's name, read WIDELY and then CROSS-CHECKED, because the narrow lens is how a
 * guard becomes theatre.
 *
 * The first version of this used `/^\s*name: "([a-z0-9_]+)",\s*$/gm` — the same lens
 * `chat-tool-registry-lint` uses — on the reasoning that two guards should never disagree about
 * what a declaration looks like. An adversarial pass then PROVED four ordinary formattings of a
 * genuine new tool that slip straight through it: `name` last with no trailing comma, single
 * quotes, the whole object on one line, and a trailing comment after the comma. Agreeing with a
 * blind guard is not a virtue; it is the same blind spot twice. (That other lint reports 98 tools
 * where the real model surface is 154, for exactly this reason.)
 *
 * So: match `name` in any of those positions, then prove the count is right. Every tool object in
 * this array opens `type: "function"`, so the number of those is the number of names there must be.
 * A mismatch means the lens missed something and the guard FAILS CLOSED rather than under-reporting.
 */
export const inlineToolNames = (source) =>
  [...source.matchAll(/\bname:\s*["']([a-z0-9_]+)["']/g)].map((m) => m[1]);

/** How many tool objects the literal actually contains — the cross-check for the lens above. */
export const toolObjectCount = (source) => [...source.matchAll(/\btype:\s*["']function["']/g)].length;

/**
 * `...SYMBOL,` or `...builder(),` alone on its line — and, critically, a CENSUS of every other
 * spread so none can hide.
 *
 * The first version matched only the bare form. An adversarial pass rewrote index.ts:6835
 * `...N8N_MANAGEMENT_TOOLS,` as `...(true ? N8N_MANAGEMENT_TOOLS : []),` — a refactor any reviewer
 * waves through — and twelve tools vanished from the surface while the guard still exited 0 with a
 * green tick. A resolver that silently drops a whole tool family is worse than no resolver, because
 * it certifies the gap it just created.
 */
export const spreadSymbols = (source) =>
  [...source.matchAll(/^\s*\.\.\.([A-Za-z_$][\w$]*)(\(\))?,\s*$/gm)].map((m) => ({ symbol: m[1], call: Boolean(m[2]) }));

/** Every line-leading spread, resolvable or not. Anything here that spreadSymbols missed is fatal. */
export const allSpreadLines = (source) =>
  [...source.matchAll(/^\s*\.\.\..*$/gm)].map((m) => m[0].trim());

export function importSpecifiers(source) {
  const map = new Map();
  for (const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) map.set(name, m[2]);
    }
  }
  return map;
}

/**
 * THE ORDER IS THE POINT, AND GETTING IT WRONG UNDER-COUNTS BY SEVEN.
 *
 * The handler builds the literal, SPLICES nine legacy CRM writers out of it, then PUSHES the 32
 * generated CRM command tools — and seven of the nine spliced names come straight back pointed at
 * a different executor. Delete-after-add silently drops those seven from the surface. It is a real
 * mistake, it was made while writing this guard, and the self-test pins it.
 *
 * `resolveSpread({symbol, call})` returns the tool names that spread contributes.
 */
export function resolveChatTools(source, resolveSpread) {
  const declared = source.indexOf("const toolDefs = [");
  if (declared < 0) throw new Error("could not find `const toolDefs = [` in the Chat handler");
  const literal = balanced(source, source.indexOf("[", declared));
  if (!literal) throw new Error("could not bracket-match the toolDefs literal");

  // Inline names are read from the WHOLE handler, not just the literal: `ask_choices` is pushed
  // later behind the Studio gate and is still a tool the model can be given.
  const names = new Set(inlineToolNames(source));
  if (names.size < 50) throw new Error(`parsed only ${names.size} inline tool declarations — the declaration shape changed and this guard is blind`);

  // FAIL CLOSED (1): every tool object opens `type: "function"`, so that count is how many names
  // there must be inside the literal. If the lens found fewer, it missed a declaration and this
  // guard would silently under-report the surface — the exact failure it exists to prevent.
  const objectsInLiteral = toolObjectCount(literal);
  const namesInLiteral = new Set(inlineToolNames(literal));
  if (namesInLiteral.size < objectsInLiteral) {
    throw new Error(
      `the toolDefs literal holds ${objectsInLiteral} tool object(s) but only ${namesInLiteral.size} name(s) could be read. ` +
      `A declaration is written in a shape this guard cannot see, so the surface it reports is too small. ` +
      `Widen inlineToolNames rather than lowering this check.`,
    );
  }

  // FAIL CLOSED (2): census every line-leading spread and prove each one was resolved. The bare
  // `...SYMBOL,` form is all spreadSymbols can follow; `...(cond ? SYMBOL : [])` and friends are
  // NOT resolvable here and must stop the run rather than quietly removing a tool family.
  const resolvedSpreads = new Set(spreadSymbols(literal).map((x) => x.symbol));
  const unresolved = allSpreadLines(literal).filter((line) => {
    const bare = line.match(/^\.\.\.([A-Za-z_$][\w$]*)(\(\))?,?$/);
    if (bare && resolvedSpreads.has(bare[1])) return false;
    // A conditional spread of INLINE objects — `...(fundingEnabled ? [{ type: "function", ... }]`
    // — is safe: the objects are written out in this file, so the name lens above already has them
    // and the cross-check above already counts them. Two of these ship today (the funding gate at
    // index.ts:5451 and the marketplace gate at :5538) and they are not a gap.
    if (/^\.\.\.\(.*\?\s*\[\s*\{/.test(line)) return false;
    // What is NOT safe is a conditional spread of a SYMBOL — `...(cond ? SYMBOL : [])` — because
    // the tools live in another module and nothing here can see them.
    return true;
  });
  if (unresolved.length) {
    throw new Error(
      `${unresolved.length} spread(s) in the toolDefs literal cannot be resolved, so the tools they contribute are invisible:\n` +
      unresolved.map((l) => `    ${l}`).join("\n") +
      `\n  Teach resolveSpread to follow this shape, or flatten it back to \`...SYMBOL,\`. ` +
      `Do NOT delete this check: a conditional spread once removed 12 tools while the guard still reported success.`,
    );
  }

  for (const spread of spreadSymbols(literal)) for (const n of resolveSpread(spread)) names.add(n);

  const at = source.indexOf("const legacyCrmMutationTools = new Set([");
  if (at < 0) throw new Error("could not find the legacy CRM splice set");
  const spliced = [...source.slice(at, source.indexOf("]);", at)).matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  if (!spliced.length) throw new Error("the legacy CRM splice set parsed empty");
  for (const n of spliced) names.delete(n);

  const pushed = [...source.matchAll(/toolDefs\.push\(\s*\.\.\.([A-Za-z_$][\w$]*)/g)].map((m) => ({ symbol: m[1], call: false }));
  for (const spread of pushed) for (const n of resolveSpread(spread)) names.add(n);

  return names;
}

/* ───────────────────────── rule 2: agreement ───────────────────────── */

/**
 * DERIVED FROM THE REAL TYPES, AND NOTHING ELSE.
 *
 *   contracts.ts  SpineActionClassification = "read" | "mutate" | "external_effect"
 *                 SpineRiskPolicy           = "read_only" | "ordinary" | "high"
 *   action-risk   ActionRisk                = "ordinary" | "high" | "owner_only"
 *                 ActionRiskVerdict         = ActionRisk | "unclassified"
 *
 * The registry's own validator already enforces the WITHIN-Spine invariants (a mutating action
 * needs `ordinary`/`high` + a LIVE Chat binding + chat-canonical approval; an `external_effect`
 * needs `high`; a read needs `read_only` + no approval authority). This function does NOT repeat
 * them — repeating a check is not a second opinion. It grades only what neither source can see
 * alone: the BETWEEN-source contradictions.
 *
 * `classify()` is the shipped `classifyAction`. It answers "unclassified" for a tool with no RISK
 * entry, which is a refusal, not a class — so "both exist" means the verdict is not "unclassified".
 */
export function agreementFindings(capabilitiesByTool, classify) {
  const findings = [];
  for (const [tool, capability] of capabilitiesByTool) {
    const action = capability.action;
    if (!action) continue;
    const verdict = classify(tool);
    if (verdict === "unclassified") continue;             // only one source speaks; rule 1's problem, not rule 2's.
    const declared = action.riskPolicyKey;

    // (a) The policy says this is a mutation. The Spine says it is a read that needs no approval
    //     authority at all. One of them is wrong about what the act DOES, and the permissive one
    //     is the Spine — a read declaration is what lets a call skip the approval treatment.
    if (declared === "read_only") {
      findings.push({ tool, rule: "read-vs-mutation", capability: capability.key,
        detail: `Spine declares action.classification "${action.classification}" with riskPolicyKey "read_only"; action-risk classifies it "${verdict}", and that table is EVERY MUTATION PAIGE CAN PERFORM.` });
      continue;
    }

    // (b) `owner_only` is not a stronger approval — it is "this does not happen from Chat, at any
    //     approval strength". A Spine capability that declares a chatTool for it is declaring a
    //     door the handler refuses unconditionally.
    if (verdict === "owner_only") {
      findings.push({ tool, rule: "owner-only-chat-declaration", capability: capability.key,
        detail: `action-risk classifies "${tool}" owner_only — never performed from Chat — yet the Spine declares it as a Chat action with riskPolicyKey "${declared}".` });
      continue;
    }

    // (c) The dangerous direction: the Spine declares the act needs `high` (the rendered approval
    //     card, whose fingerprint travels in the request body), the policy grants `ordinary` (a
    //     compact confirmation the model can satisfy). The gate is weaker than the declaration.
    if (declared === "high" && verdict === "ordinary") {
      findings.push({ tool, rule: "gate-weaker-than-declared", capability: capability.key,
        detail: `Spine declares riskPolicyKey "high"; action-risk grants "ordinary". The runtime gate is weaker than the domain's own declaration.` });
      continue;
    }

    // (d) The stale direction: the policy was tightened to `high` and the declaration was not.
    //     Not dangerous — the runtime is stricter — but the declaration now lies to every reader.
    if (declared === "ordinary" && verdict === "high") {
      findings.push({ tool, rule: "declaration-behind-policy", capability: capability.key,
        detail: `action-risk classifies "${tool}" high; the Spine still declares riskPolicyKey "ordinary". The runtime is stricter than the declaration — update the declaration.` });
    }
  }
  return findings;
}

/* ───────────────────────── rule 1 + 3: the ratchet ───────────────────────── */

/**
 * The baseline lists EXACT KEYS WITH THEIR KIND, never a count. A count alone stays flat while
 * membership churns — one tool declared and another added would net to zero and pass — and a
 * count cannot see the churn that matters most here, a READ tool quietly becoming a MUTATING one.
 *
 * `undeclared` : [{ tool, kind }] for every model-surface tool with no Spine capability.
 * `baseline`   : the same shape, read from disk.
 */
export function ratchet(undeclared, baseline) {
  const known = new Map(baseline.map((e) => [e.tool, e.kind]));
  const now = new Map(undeclared.map((e) => [e.tool, e.kind]));
  const added = undeclared.filter((e) => !known.has(e.tool));
  return {
    addedMutating: added.filter((e) => e.kind === "mutating").map((e) => e.tool).sort(),
    addedRead: added.filter((e) => e.kind === "read").map((e) => e.tool).sort(),
    // Flat membership, worse gap: it was baselined as a read and now the policy says it writes.
    escalated: undeclared.filter((e) => e.kind === "mutating" && known.get(e.tool) === "read").map((e) => e.tool).sort(),
    // The gain: it is declared now, so the baseline is stale and must come down in this PR.
    declared: baseline.filter((e) => !now.has(e.tool)).map((e) => e.tool).sort(),
    // Kind drifted the harmless way; still stale, still fixed in the same PR.
    softened: undeclared.filter((e) => e.kind === "read" && known.get(e.tool) === "mutating").map((e) => e.tool).sort(),
  };
}

/* ───────────────────────── self-test ───────────────────────── */

if (process.argv.includes("--self-test")) {
  let bad = 0;
  const ok = (label, condition, detail = "") => {
    if (condition) console.log(`  ok   ${label}`);
    else { bad += 1; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
  };

  // ── resolver ──────────────────────────────────────────────────────────────────────────────
  // 50+ inline names so the fail-closed floor is not what is being tested here.
  const filler = Array.from({ length: 60 }, (_, i) => `  { type: "function", function: {\n      name: "filler_${i}",\n  } },`).join("\n");
  const fixtureHandler = [
    'const toolDefs = [',
    filler,
    '  { type: "function", function: {',
    '      name: "keeper",',
    '  } },',
    '  { type: "function", function: {',
    '      name: "crm_create_contact",',
    '  } },',
    '  ...DOMAIN_TOOLS,',
    '  ...buildGatewayToolDefs(),',
    '];',
    'const legacyCrmMutationTools = new Set([',
    '  "crm_create_contact", "gone_for_good",',
    ']);',
    'toolDefs.push(...CRM_COMMAND_TOOLS as any);',
    'toolDefs.push({ type: "function", function: {',
    '      name: "ask_choices",',
    '} });',
  ].join("\n");
  const fixtureSpread = ({ symbol, call }) => ({
    DOMAIN_TOOLS: ["domain_write"],
    buildGatewayToolDefs: call ? ["capability_status"] : [],
    CRM_COMMAND_TOOLS: ["crm_create_contact", "crm_close_deal"],
  })[symbol] ?? [];
  const resolved = resolveChatTools(fixtureHandler, fixtureSpread);
  ok("resolves inline names", resolved.has("keeper"));
  ok("resolves a spread identifier", resolved.has("domain_write"));
  ok("resolves a spread CALL", resolved.has("capability_status"));
  ok("keeps a studio-gated push that lives outside the literal", resolved.has("ask_choices"));
  ok("drops a spliced legacy name that nothing re-adds", !resolved.has("gone_for_good"));
  // THE NEGATIVE THAT PINS THE BUG: splice-then-push order. Delete-after-add loses this name.
  ok("KEEPS a spliced name the CRM push re-adds (order bug would drop it)", resolved.has("crm_create_contact"),
    "resolveChatTools deleted the splice set AFTER the push — that silently under-counts the surface by seven.");
  let blind = false;
  try { resolveChatTools('const toolDefs = [\n  name: "only_one",\n];\nconst legacyCrmMutationTools = new Set(["x"]);', () => []); } catch { blind = true; }
  ok("FAILS CLOSED when the declaration shape changes and it parses almost nothing", blind);

  // ── rule 2 ────────────────────────────────────────────────────────────────────────────────
  const cap = (key, classification, riskPolicyKey, chatTool) => [chatTool, {
    key, action: { classification, riskPolicyKey, chatTool, executor: "public.x", idempotency: "x", approvalAuthority: classification === "read" ? "none" : "chat-canonical" },
  }];
  const agree = (rows, classify) => agreementFindings(new Map(rows), classify);
  ok("passes when a mutating declaration and its class agree",
    agree([cap("d.a", "mutate", "ordinary", "t")], () => "ordinary").length === 0);
  ok("passes when only the Spine speaks (unclassified is a refusal, not a class)",
    agree([cap("d.a", "read", "read_only", "t")], () => "unclassified").length === 0);
  ok("FAILS a read_only declaration the mutation policy classifies",
    agree([cap("d.a", "read", "read_only", "t")], () => "ordinary")[0]?.rule === "read-vs-mutation");
  ok("FAILS an owner_only act declared as a Chat action",
    agree([cap("d.a", "mutate", "ordinary", "t")], () => "owner_only")[0]?.rule === "owner-only-chat-declaration");
  ok("FAILS when the runtime gate is WEAKER than the declaration",
    agree([cap("d.a", "mutate", "high", "t")], () => "ordinary")[0]?.rule === "gate-weaker-than-declared");
  ok("FAILS when the declaration is BEHIND a tightened policy",
    agree([cap("d.a", "mutate", "ordinary", "t")], () => "high")[0]?.rule === "declaration-behind-policy");
  ok("ignores an evidence-only capability with no action at all",
    agreementFindings(new Map([["t", { key: "d.e" }]]), () => "high").length === 0);

  // ── rules 1 + 3 ───────────────────────────────────────────────────────────────────────────
  const base = [{ tool: "old_write", kind: "mutating" }, { tool: "old_read", kind: "read" }];
  ok("passes when the gap is unchanged", (() => {
    const r = ratchet(base, base);
    return !r.addedMutating.length && !r.addedRead.length && !r.escalated.length && !r.declared.length && !r.softened.length;
  })());
  ok("FAILS on a NEW undeclared MUTATING tool, reported as mutating",
    (() => { const r = ratchet([...base, { tool: "new_write", kind: "mutating" }], base);
      return r.addedMutating.join() === "new_write" && r.addedRead.length === 0; })());
  ok("FAILS on a NEW undeclared READ tool, reported SEPARATELY",
    (() => { const r = ratchet([...base, { tool: "new_read", kind: "read" }], base);
      return r.addedRead.join() === "new_read" && r.addedMutating.length === 0; })());
  ok("FAILS when a baselined READ tool gains a risk class — flat membership, worse gap",
    ratchet([{ tool: "old_write", kind: "mutating" }, { tool: "old_read", kind: "mutating" }], base).escalated.join() === "old_read");
  ok("FAILS when a baselined tool is now declared, and says to lower the baseline",
    ratchet([{ tool: "old_write", kind: "mutating" }], base).declared.join() === "old_read");
  ok("catches a swap a bare count would miss (one out, one in)",
    (() => { const r = ratchet([{ tool: "old_write", kind: "mutating" }, { tool: "swapped_in", kind: "mutating" }], base);
      return r.addedMutating.join() === "swapped_in" && r.declared.join() === "old_read"; })());

  // ── the end-to-end negative: the REAL check, against a baseline with one entry removed ────
  // A guard nobody proved can fail is theatre. This drives the shipped code path, not a fixture.
  if (fs.existsSync(BASELINE)) {
    const real = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
    const victim = real.find((e) => e.kind === "mutating");
    const tmp = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "capdecl-")), "baseline.json");
    fs.writeFileSync(tmp, JSON.stringify(real.filter((e) => e.tool !== victim.tool), null, 2));
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      encoding: "utf8", env: { ...process.env, __CAPDECL_LOADER: "", CAPABILITY_DECLARATION_BASELINE: tmp },
    });
    const out = `${run.stdout}${run.stderr}`;
    ok(`END-TO-END NEGATIVE: the real check exits non-zero and names "${victim.tool}" when its baseline entry is removed`,
      run.status !== 0 && out.includes(victim.tool), `exit=${run.status}\n${out.slice(0, 600)}`);

    // …and the positive control, so the negative above proves something: unmodified baseline passes.
    const clean = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      encoding: "utf8", env: { ...process.env, __CAPDECL_LOADER: "" },
    });
    ok("POSITIVE CONTROL: the real check passes against the committed baseline", clean.status === 0,
      `exit=${clean.status}\n${clean.stdout}${clean.stderr}`.slice(0, 600));
  } else {
    bad += 1;
    console.log(`  FAIL the baseline ${path.relative(ROOT, BASELINE)} is missing — the end-to-end negative could not run, which is not a pass.`);
  }

  console.log(bad ? `\n✗ capability-declaration-lint self-test: ${bad} failure(s).` : "\n✓ capability-declaration-lint self-test passed.");
  process.exit(bad ? 1 : 0);
}

/* ───────────────────────── main ───────────────────────── */

const fail = (message) => { console.error(`✗ capability-declaration-lint: ${message}`); process.exit(1); };

for (const f of [HANDLER, REGISTRY, POLICY]) {
  if (!fs.existsSync(f)) fail(`${path.relative(ROOT, f)} is missing — that is a resolver failure, not a pass.`);
}

const source = fs.readFileSync(HANDLER, "utf8");
const imports = importSpecifiers(source);

/** Import the module a spread symbol comes from and read the REAL array. Fail closed on empty. */
function resolveSpread({ symbol, call }) {
  const specifier = imports.get(symbol);
  if (!specifier) fail(`the Chat tool array spreads \`${symbol}\`, which is not an import this guard can resolve.\n  Resolve it deliberately — an unresolved spread means the guard is grading a SUBSET while reporting a total.`);
  let value;
  try {
    const url = new URL(specifier, pathToFileURL(HANDLER).href).href;
    const module = moduleCache.get(url) ?? fail(`internal: ${specifier} was not preloaded`);
    value = call ? module[symbol]() : module[symbol];
  } catch (error) {
    fail(`could not read \`${symbol}\` from ${specifier} — ${error?.message ?? error}`);
  }
  const names = (Array.isArray(value) ? value : []).map((d) => d?.function?.name).filter(Boolean);
  if (!names.length) fail(`\`${symbol}\` contributed ZERO tool names.\n  Either the export changed shape or this guard has gone blind to a whole family of tools. Fix the resolver; do not delete the check.`);
  return names;
}

// Dynamic import must be awaited, and resolveChatTools is sync by design (so the self-test can
// drive it with a plain fixture function). Preload every spread module first.
const moduleCache = new Map();
{
  const literal = balanced(source, source.indexOf("[", source.indexOf("const toolDefs = [")));
  if (!literal) fail("could not bracket-match the toolDefs literal in the Chat handler.");
  const symbols = [
    ...spreadSymbols(literal),
    ...[...source.matchAll(/toolDefs\.push\(\s*\.\.\.([A-Za-z_$][\w$]*)/g)].map((m) => ({ symbol: m[1], call: false })),
  ];
  for (const { symbol } of symbols) {
    const specifier = imports.get(symbol);
    if (!specifier) continue; // resolveSpread reports it, with the full remedy.
    const url = new URL(specifier, pathToFileURL(HANDLER).href).href;
    if (!moduleCache.has(url)) {
      try { moduleCache.set(url, await import(url)); }
      catch (error) { fail(`could not import ${specifier} (for \`${symbol}\`) — ${error?.message ?? error}`); }
    }
  }
}

let chatTools;
try { chatTools = resolveChatTools(source, resolveSpread); }
catch (error) { fail(`${error.message}.\n  A guard that cannot find its subject must fail loudly, never pass quietly.`); }
if (chatTools.size < 100) fail(`resolved only ${chatTools.size} tools from the Chat handler — too few to be real.`);

const { PAIGE_SPINE_CAPABILITIES } = await import(pathToFileURL(REGISTRY).href);
const { classifyAction } = await import(pathToFileURL(POLICY).href);
if (!PAIGE_SPINE_CAPABILITIES?.length) fail("the PAIGE Spine registry resolved empty.");

const capabilitiesByTool = new Map();
for (const capability of PAIGE_SPINE_CAPABILITIES) {
  const tool = capability.action?.chatTool;
  if (!tool) continue;
  // Two capabilities claiming one chat tool is not something the registry's own validator forbids,
  // and a plain `.set()` would keep whichever domain composes LAST in registry.ts — so rule 2 below
  // would grade one act against the other's risk class and never say which it chose. That is a
  // silent ownership ambiguity, which is the shape of defect this guard exists to surface.
  const prior = capabilitiesByTool.get(tool);
  if (prior) {
    fail(`two Spine capabilities declare chatTool "${tool}" — \`${prior.key}\` and \`${capability.key}\`. ` +
         `One act, one owner: the grading below cannot choose between them and must not pick silently.`);
  }
  capabilitiesByTool.set(tool, capability);
}

// Rule 2 — the wall.
const disagreements = agreementFindings(
  new Map([...capabilitiesByTool].filter(([tool]) => chatTools.has(tool))),
  classifyAction,
);
if (disagreements.length) {
  console.error(`✗ capability-declaration-lint: ${disagreements.length} source(s) contradict each other about the same act:\n`);
  for (const f of disagreements) console.error(`    ${f.tool}  [${f.rule}]\n      ${f.capability}: ${f.detail}`);
  console.error(
    `\n  Two places describe this act and they do not agree, so one of them is lying to whoever reads it.` +
    `\n  Fix the WRONG one — do not widen this rule. The agreement rules are derived from` +
    `\n  SpineActionClassification / SpineRiskPolicy (paige-spine/contracts.ts) and ActionRisk` +
    `\n  (_shared/action-risk.ts), and there is no baseline here because this tree has zero violations.`,
  );
  process.exit(1);
}

// Rules 1 + 3 — the ratchet.
const undeclared = [...chatTools]
  .filter((tool) => !capabilitiesByTool.has(tool))
  .map((tool) => ({ tool, kind: classifyAction(tool) === "unclassified" ? "read" : "mutating" }))
  .sort((a, b) => a.tool.localeCompare(b.tool));

if (process.argv.includes("--update-baseline")) {
  fs.writeFileSync(BASELINE, `${JSON.stringify(undeclared, null, 2)}\n`);
  console.log(`✓ wrote ${undeclared.length} entries to ${path.relative(ROOT, BASELINE)} — read the diff before you commit it.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) fail(`${path.relative(ROOT, BASELINE)} is missing. Generate it with --update-baseline and commit it.`);
let baseline;
try { baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")); }
catch (error) { fail(`${path.relative(ROOT, BASELINE)} is not readable JSON — ${error.message}`); }
if (!Array.isArray(baseline) || baseline.some((e) => typeof e?.tool !== "string" || !["mutating", "read"].includes(e?.kind))) {
  fail(`${path.relative(ROOT, BASELINE)} must be an array of { "tool": string, "kind": "mutating" | "read" } — EXACT KEYS, never a count.`);
}

const r = ratchet(undeclared, baseline);
let failed = false;

if (r.addedMutating.length) {
  failed = true;
  console.error(`✗ capability-declaration-lint: ${r.addedMutating.length} newly undeclared MUTATING tool(s) — acts with no domain owner:\n`);
  for (const t of r.addedMutating) console.error(`    ${t}   (action-risk: ${classifyAction(t)})`);
  console.error(
    `\n  These WRITE. A mutating tool with no Spine capability has no declared executor, no` +
    `\n  idempotency statement, no approval authority and no Rail contract — and a tenant who sets` +
    `\n  it to \`auto\` gets it unattended. Declare it in its domain under` +
    `\n  supabase/functions/_shared/paige-spine/domains/ and compose it in registry.ts.` +
    `\n  Do NOT add it to the baseline to get past this guard.`,
  );
}
if (r.addedRead.length) {
  failed = true;
  console.error(`\n✗ capability-declaration-lint: ${r.addedRead.length} newly undeclared READ tool(s):\n`);
  for (const t of r.addedRead) console.error(`    ${t}`);
  console.error(`\n  Reads cannot act unattended, so this is the lesser half — but a read the registry has never` +
                `\n  heard of is a capability nothing owns. Declare it the same way.`);
}
if (r.escalated.length) {
  failed = true;
  console.error(`\n✗ capability-declaration-lint: ${r.escalated.length} baselined READ tool(s) now MUTATE:\n`);
  for (const t of r.escalated) console.error(`    ${t}   (action-risk: ${classifyAction(t)})`);
  console.error(
    `\n  The baseline did not grow and the gap got worse anyway — exactly the churn a bare count hides.` +
    `\n  This tool was tolerated as an undeclared read; it now writes, with no domain declaration behind` +
    `\n  it. Declare it, or change its kind here ONLY alongside the reason it is still acceptable.`,
  );
}
if (r.declared.length || r.softened.length) {
  failed = true;
  console.error(`\n✗ capability-declaration-lint: ${r.declared.length + r.softened.length} baseline entr(ies) are now stale:\n`);
  // Two very different reasons a baseline entry goes stale, and saying the wrong one is worse than
  // saying nothing: a tool that LEFT the model surface is not "now declared by the Spine". Both
  // sets are already in hand, so there is no excuse for guessing.
  for (const t of r.declared) {
    console.error(capabilitiesByTool.has(t)
      ? `    ${t} — now declared by the Spine; delete its entry`
      : `    ${t} — no longer on the model surface; delete its entry`);
  }
  for (const t of r.softened) console.error(`    ${t} — no longer mutating; set its kind to "read"`);
  console.error(`\n  Good news, and the ratchet holds the gain: lower the baseline in this same PR, or the next` +
                `\n  author inherits a lie. \`node scripts/ci/capability-declaration-lint.mjs --update-baseline\`.`);
}
if (failed) process.exit(1);

const mutating = undeclared.filter((e) => e.kind === "mutating").length;
console.log(
  `✓ capability-declaration-lint: ${chatTools.size} tool(s) on the model surface · ` +
  `${chatTools.size - undeclared.length} declared by a Spine capability · ${undeclared.length} undeclared ` +
  `(baseline, not grown) · 0 source disagreements.`,
);
console.log(
  `  ${mutating} of the undeclared ${undeclared.length} MUTATE — those are the ones that can act unattended once a` +
  `\n  tenant sets them to \`auto\`, and closing them is the declaration-backfill work. This guard stops it widening.`,
);
