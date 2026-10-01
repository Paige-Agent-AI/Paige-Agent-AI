#!/usr/bin/env node
/**
 * mcp-governed-door-lint — the no-bypass guard for the inbound MCP door.
 *
 * WHAT THIS GUARDS, AND WHY A TEST CANNOT.
 * `paige-mcp` registers its tools as 117 separate top-level `mcp.tool("<name>", …)` calls. Nothing
 * about that shape forces a new tool to be governed: a developer adds a 120th call, it dispatches,
 * and no test fails — because a test can only exercise the tools it knows about. The gap is
 * structural, so the guard has to be structural too.
 *
 * The rules below are deliberately mechanical. Each one failed to be true at some point in this
 * file's history, and each is cheap to re-break by accident:
 *
 *   R1  Every registered tool has exactly one entry in the capability policy.
 *   R2  Every policy entry names a registered tool. Drift runs both ways — a renamed tool leaves a
 *       stale entry behind, and a stale entry is worse than a missing one because it looks handled.
 *   R3  The registered count matches the count the policy declares it covers. Two comments in this
 *       repo said 117 while the real number was 119; a number written in prose rots silently, so it
 *       is asserted instead.
 *   R4  The single `tools/call` chokepoint still calls the governed adapter. If the call disappears,
 *       every tool is ungoverned and nothing else in CI notices.
 *   R5  No SECOND dispatch door. A new `server.tool`/`mcp.tool` registration on a different server
 *       instance, or a second handler branching on `tools/call`, bypasses the chokepoint entirely.
 *
 * Run: node scripts/ci/mcp-governed-door-lint.mjs
 * Self-test: node scripts/ci/mcp-governed-door-lint.mjs --self-test
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MCP = "supabase/functions/paige-mcp/index.ts";
const POLICY = "supabase/functions/_shared/paige-mcp/capability-policy.ts";
const RISK = "supabase/functions/_shared/action-risk.ts";
const CHAT = "supabase/functions/paige-ai-chat/index.ts";

/** The tool names the Chat handler declares to the model — the same shape `action-risk-lint` reads.
 *  R8 uses it to recompute `paigeHome`, so that field can never drift into a comfortable lie. */
export function chatDeclaredTools(src) {
  return new Set([...src.matchAll(/\n\s*name: "([a-z0-9_]+)",/g)].map((m) => m[1]));
}

/** Tool names as REGISTERED. Anchored at column 0 so a name inside a comment or string cannot count. */
export function registeredTools(src) {
  return [...src.matchAll(/^mcp\.tool\("([a-z0-9_]+)"/gm)].map((m) => m[1]);
}

/** Tool names the policy declares. Keys are quoted at a fixed indent inside the one exported table. */
export function policyTools(src) {
  const start = src.indexOf("export const MCP_CAPABILITY_POLICY");
  if (start === -1) return [];
  const body = src.slice(start);
  const end = body.indexOf("\n};");
  return [...body.slice(0, end === -1 ? undefined : end).matchAll(/^\s{2}([a-z0-9_]+):\s*\{/gm)].map((m) => m[1]);
}

// ── R6/R7 parsing ────────────────────────────────────────────────────────────────────────────────

/** Every policy row with the two fields the new rules grade: the canonical key it points at, and
 *  the VERIFIED effect. A row is its span from its own key to the next key, so a multi-line entry
 *  reads the same as a single-line one. `null` means "the field was not readable", which is a
 *  finding rather than a default — R7 reports it instead of grading around it. */
export function policyRows(src) {
  const start = src.indexOf("export const MCP_CAPABILITY_POLICY");
  if (start === -1) return [];
  const body = src.slice(start);
  const cut = body.indexOf("\n};");
  const table = cut === -1 ? body : body.slice(0, cut);
  const keys = [...table.matchAll(/^\s{2}([a-z0-9_]+):\s*\{/gm)];
  return keys.map((m, i) => {
    const span = table.slice(m.index, i + 1 < keys.length ? keys[i + 1].index : table.length);
    const canonical = /\bcanonical:\s*"([^"]*)"/.exec(span);
    const effect = /\beffect:\s*"(read|mutate)"/.exec(span);
    const home = /\bpaigeHome:\s*(true|false)\b/.exec(span);
    return {
      tool: m[1],
      canonical: canonical ? canonical[1] : null,
      effect: effect ? effect[1] : null,
      paigeHome: home ? home[1] === "true" : null,
    };
  });
}

/** Block comments blanked, line comments KEPT. Two views come off this one mask: calls are read
 *  from it with line comments and string bodies also blanked, and exemption markers are read from
 *  it directly. Blanking rather than deleting keeps every line index intact.
 *
 *  Block comments go first and they go for both views. That kills two picks at once — a `fetch(`
 *  merely MENTIONED in a doc comment cannot raise a finding, and an exemption marker written inside
 *  a block comment that only EXPLAINS the marker cannot silence one. That second pick is not
 *  hypothetical: it is one of the five that defeated the escape hatch in `governed-execution-lint`. */
export function maskBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** The call-detection view: line comments and closed string bodies blanked as well. A URL's `//`
 *  is preceded by `:` and is left alone. An unclosed template literal matches no pair and is left
 *  alone, so the worst case is a missed mask, never a mangled line. */
export function maskNonCode(line) {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, (m) => " ".repeat(m.length))
    .replace(/'(?:[^'\\]|\\.)*'/g, (m) => " ".repeat(m.length))
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:"'`\\])\/\/.*$/, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/** A call that leaves this function: the network, or a sibling edge function. */
const DIRECT_OUTBOUND = /\bfetch\s*\(|\.\s*functions\s*\.\s*invoke\s*\(/;

/**
 * Top-level helpers that make a direct outbound call, DISCOVERED rather than listed.
 *
 * A hardcoded roster of provider helpers is a list that goes out of date the first time somebody
 * writes a second wrapper. This finds them: any declaration at column 0 whose body — up to the next
 * line beginning at column 0 with a closing brace — contains a direct outbound call. On the shipped
 * tree it finds exactly one, `callOrchestrator` (paige-mcp/index.ts:3195), and that one matters:
 * `list_subagents` is a VERIFIED read whose only outbound call is through it.
 *
 * HONEST BOUND: this is one hop. A helper that calls a helper that fetches is not found.
 */
export function outboundHelpers(masked) {
  const lines = masked.split("\n");
  const DECL = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/;
  const names = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DECL.exec(lines[i]);
    if (!m) continue;
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j++) if (/^[}\])]/.test(lines[j])) { end = j; break; }
    if (DIRECT_OUTBOUND.test(lines.slice(i, end + 1).map(maskNonCode).join("\n"))) names.push(m[1] || m[2]);
  }
  return [...new Set(names)];
}

/**
 * One span per registration, bounded by its OWN closing `});` at column 0 — never by the next
 * registration.
 *
 * That distinction is the whole precision of R6 and it was measured, not assumed. `callOrchestrator`
 * is declared at paige-mcp/index.ts:3195, in the 152-line gap between `list_my_proposals` (ends
 * 3058) and `list_subagents` (starts 3211). A span that runs to the next registration swallows it
 * and reports a `fetch(` inside `list_my_proposals`, which is a verified read whose handler contains
 * no fetch at all. Bounding on the closing brace attributes zero calls to it. All 117 registrations
 * terminate this way on the shipped tree; one that does not is reported rather than guessed at.
 */
export function toolSpans(mcpSrc) {
  const lines = maskBlockComments(mcpSrc).split("\n");
  const starts = [];
  lines.forEach((line, i) => {
    const m = /^mcp\.tool\("([a-z0-9_]+)"/.exec(line);
    if (m) starts.push({ tool: m[1], start: i + 1 });
  });
  return starts.map((s, i) => {
    const nextStart = i + 1 < starts.length ? starts[i + 1].start : lines.length + 1;
    let end = nextStart - 1, terminated = false;
    for (let ln = s.start; ln < nextStart; ln++) {
      if (/^\}\)\s*;/.test(lines[ln - 1])) { end = ln; terminated = true; break; }
    }
    return { tool: s.tool, start: s.start, end, terminated, body: lines.slice(s.start - 1, end) };
  });
}

/** A marker is the ONLY thing on its line, is a line comment (block comments are already blanked),
 *  and carries a real reason. Anything looser is the hatch that got picked five ways. */
const EXEMPT_MARKER = /^\s*\/\/ mcp-read-fetch-exempt: *(\S.{19,})\s*$/;

/** Outbound calls inside one span, each with the marker state of the line directly above it. */
export function outboundCallsIn(span, helperNames) {
  const helper = helperNames.length
    ? new RegExp(`\\b(?:${helperNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*\\(`)
    : null;
  const hits = [];
  span.body.forEach((raw, i) => {
    const code = maskNonCode(raw);
    const what = DIRECT_OUTBOUND.test(code) ? (/\bfetch\s*\(/.test(code) ? "fetch(" : ".functions.invoke(")
      : helper && helper.test(code) ? `${helper.exec(code)[0].replace(/\s*\($/, "")}( — a helper that fetches` : null;
    if (!what) return;
    const above = i > 0 ? span.body[i - 1] : "";
    hits.push({ line: span.start + i, what, marked: EXEMPT_MARKER.test(above) });
  });
  return hits;
}

/** The canonical keys `action-risk.ts` actually classifies. */
export function riskKeys(src) {
  const at = src.indexOf("const RISK: ReadonlyArray<readonly [string, ActionRisk, string]> = [");
  if (at < 0) return [];
  const end = src.indexOf("\n];", at);
  return [...src.slice(at, end < 0 ? undefined : end).matchAll(/\[\s*"([a-z0-9_]+)"\s*,\s*"(?:ordinary|high|owner_only)"\s*,/g)].map((m) => m[1]);
}

/** Keys named, with a reason, as reading like a write while persisting nothing. */
export function exemptKeys(src) {
  const at = src.indexOf("const NON_MUTATING_EXEMPT: ReadonlyMap<string, string> = new Map([");
  if (at < 0) return [];
  const end = src.indexOf("\n]);", at);
  return [...src.slice(at, end < 0 ? undefined : end).matchAll(/\[\s*"([a-z0-9_]+)"\s*,/g)].map((m) => m[1]);
}

/** COMPILED from the policy's own source, not copied into this file. `action-risk-lint.mjs` keeps a
 *  duplicate and asserts the two are byte-identical (its rule 5); a third copy would be a third
 *  thing to keep in step, so this reads the one that ships. */
export function mutationVerb(src) {
  const m = /export const MUTATION_VERB = \/(.+)\/;/.exec(src);
  if (!m) return null;
  try { return new RegExp(m[1]); } catch { return null; }
}

/**
 * Reads that are ALLOWED to call out, and the reason each one is real.
 *
 * Two keys, one door, on purpose. The marker at the call site carries the reason where a reader of
 * the handler will see it; this roster is what makes ADDING one a reviewed act rather than a comment
 * anybody can write — the same reasoning as `EXPECTED_TOOLS_CALL_MENTIONS`. A tool needs BOTH.
 */
const READ_FETCH_EXEMPT = new Set([
  "list_subagents",
  "list_subagent_proposals",
]);

/** Below this, the policy table is a fixture rather than the real thing and the shape assertions
 *  would be grading nothing. R1/R3 already fail loudly if the real table shrinks to fixture size. */
const POLICY_POPULATED_MIN = 20;

/** A second door: any tool registration on something other than the one `mcp` instance, or a
 *  second place that branches on the tools/call method. */
export function secondDoors(src) {
  const found = [];
  for (const m of src.matchAll(/^(?!mcp\.tool\()[ \t]*([A-Za-z_$][\w$]*)\.tool\(\s*"/gm)) {
    found.push(`${m[1]}.tool( — a registration on an instance other than \`mcp\``);
  }
  const callBranches = [...src.matchAll(/"tools\/call"/g)].length;
  if (callBranches > EXPECTED_TOOLS_CALL_MENTIONS) {
    found.push(`"tools/call" appears ${callBranches}× (expected ${EXPECTED_TOOLS_CALL_MENTIONS}) — a new dispatch branch may bypass the chokepoint`);
  }
  return found;
}

/** The chokepoint mentions tools/call in the tier/scope gate, the Rail emitter, and the list filter.
 *  Raising this number is a deliberate act that must be reviewed, which is the point. */
const EXPECTED_TOOLS_CALL_MENTIONS = 4;

export function check(mcpSrc, policySrc, riskSrc = "", chatSrc = "") {
  const failures = [];
  const registered = registeredTools(mcpSrc);
  const policied = policyTools(policySrc);
  const rset = new Set(registered);
  const pset = new Set(policied);

  const unmapped = registered.filter((t) => !pset.has(t));
  if (unmapped.length) {
    failures.push(
      `R1 ${unmapped.length} registered tool(s) have NO capability-policy entry, so they would be ` +
      `denied at runtime and are invisible to governance review: ${unmapped.join(", ")}`,
    );
  }

  const stale = policied.filter((t) => !rset.has(t));
  if (stale.length) {
    failures.push(`R2 ${stale.length} policy entr(ies) name no registered tool (renamed or deleted): ${stale.join(", ")}`);
  }

  const declared = /MCP_TOOL_COUNT\s*=\s*(\d+)/.exec(policySrc);
  if (!declared) failures.push("R3 the policy does not declare MCP_TOOL_COUNT");
  else if (Number(declared[1]) !== registered.length) {
    failures.push(`R3 policy declares MCP_TOOL_COUNT=${declared[1]} but ${registered.length} tools are registered`);
  }

  if (!/governMcpToolCall\s*\(/.test(mcpSrc)) {
    failures.push("R4 the tools/call chokepoint no longer calls governMcpToolCall — every tool is ungoverned");
  }

  for (const d of secondDoors(mcpSrc)) failures.push(`R5 ${d}`);

  // R6 ─ a handler that calls out may not be declared a read. `governedExecution` returns before
  // classification, clamp, approval and outcome for a `read` (capability-policy.ts:22-25), so a
  // mutation wearing `read` executes ungoverned. The effect field is set by a human reading the
  // handler; this is the mechanical cross-check on that reading.
  const rows = policyRows(policySrc);
  const spans = new Map(toolSpans(mcpSrc).map((s) => [s.tool, s]));
  const helpers = outboundHelpers(maskBlockComments(mcpSrc));
  const unbounded = [...spans.values()].filter((s) => !s.terminated);
  if (unbounded.length) {
    failures.push(`R6 ${unbounded.length} registration(s) are not closed by a \`});\` at column 0, so this guard cannot bound them and a top-level helper between registrations would be read as part of one: ${unbounded.map((s) => `${s.tool}@${s.start}`).join(", ")}`);
  }
  for (const row of rows) {
    if (row.effect !== "read") continue;
    const span = spans.get(row.tool);
    if (!span) continue; // R1/R2 own the mapping; this rule does not double-report it.
    for (const hit of outboundCallsIn(span, helpers)) {
      const rostered = READ_FETCH_EXEMPT.has(row.tool);
      if (hit.marked && rostered) continue;
      const why = !hit.marked && !rostered
        ? "Verify the handler: if it really does reach outside, its effect is `mutate`. If the call is genuinely read-only, put `// mcp-read-fetch-exempt: <reason>` on the line directly above it AND add the tool to READ_FETCH_EXEMPT in this guard."
        : !hit.marked
          ? "It is listed in READ_FETCH_EXEMPT but the call site carries no `// mcp-read-fetch-exempt: <reason>` marker directly above it — the reason has to live where the handler is read."
          : "The call site is marked but the tool is not in READ_FETCH_EXEMPT in this guard — adding an exemption is a reviewed edit here, not a comment.";
      failures.push(`R6 ${row.tool} is declared effect:"read" but calls ${hit.what} at ${MCP}:${hit.line}${span.terminated ? "" : " (span bounded by the NEXT registration, so this attribution may be wrong)"}. ${why}`);
    }
  }

  // R7 ─ every capability resolves in the ONE classifier. A `mutate` whose canonical key is absent
  // from `action-risk.ts` is refused at runtime as `unclassified` — correct, and a silent way to
  // ship a dead tool. A `read` that points at a classified mutation, or that reads as a write with
  // nothing on the record saying otherwise, is the mis-declaration R6 catches from the other side.
  const populated = rows.length >= POLICY_POPULATED_MIN;
  const keys = new Set(riskKeys(riskSrc));
  const exempt = new Set(exemptKeys(riskSrc));
  const verb = mutationVerb(riskSrc);
  if (populated) {
    const unreadable = rows.filter((r) => !r.canonical || !r.effect);
    if (unreadable.length) {
      failures.push(`R7 ${unreadable.length} policy row(s) declare no readable canonical key and/or effect, so neither rule can grade them: ${unreadable.map((r) => r.tool).join(", ")}`);
    }
    if (!riskSrc) failures.push(`R7 the policy declares ${rows.length} capabilities but no ${RISK} source was supplied — nothing was resolved`);
    else if (keys.size < 40) failures.push(`R7 only ${keys.size} classification(s) parsed out of ${RISK} — the RISK table changed shape, so this guard is reading nothing`);
    else if (!verb) failures.push(`R7 MUTATION_VERB could not be compiled from ${RISK} — the read-side check is reading nothing`);
  }
  // With the real table in front of it and no readable classifier behind it, per-row grading would
  // emit one derived finding per capability and bury the one fact that matters. The admission above
  // is the finding; the rows are not graded against nothing.
  const graded = !populated || (keys.size >= 40 && !!verb);
  for (const row of graded ? rows : []) {
    if (!row.canonical || !row.effect) continue;
    if (row.effect === "mutate") {
      if (!keys.has(row.canonical)) {
        failures.push(`R7 ${row.tool} mutates and points at canonical "${row.canonical}", which ${RISK} does not classify — classifyAction() answers "unclassified" and the act is refused, so the tool ships dead. Add the key to the RISK table.`);
      }
      continue;
    }
    if (keys.has(row.canonical)) {
      failures.push(`R7 ${row.tool} is declared effect:"read" but points at canonical "${row.canonical}", which ${RISK} classifies as a mutation. One of the two is wrong.`);
    } else if (verb && verb.test(row.canonical) && !exempt.has(row.canonical)) {
      failures.push(`R7 ${row.tool} is declared effect:"read" and its canonical "${row.canonical}" reads as a write, with nothing on the record saying it persists nothing. Add it to NON_MUTATING_EXEMPT in ${RISK} with the reason, or reclassify.`);
    }
  }

  // R8 ─ `paigeHome` is DERIVED, never asserted. It decides the one sentence a refused caller reads:
  // "ask Paige to do it" for an act a person can actually perform there, and "there is no approved
  // path for this yet" for the fifty-six that reached the classifier only because MCP registered
  // them. A hand-kept boolean drifts toward the comfortable answer, and the comfortable answer here
  // is a destination the platform does not have — the operator goes to Paige, finds nothing, and
  // concludes the refusal was a bug.
  if (populated && chatSrc) {
    const declared = chatDeclaredTools(chatSrc);
    if (declared.size < 50) {
      failures.push(`R8 only ${declared.size} tool name(s) parsed out of ${CHAT} — this rule is reading nothing, so it would silently bless every paigeHome value`);
    } else {
      for (const row of rows) {
        if (row.paigeHome === null) {
          failures.push(`R8 ${row.tool} declares no paigeHome, so the door cannot tell a refused caller whether the act has anywhere to go.`);
          continue;
        }
        const truth = !!row.canonical && declared.has(row.canonical);
        if (row.paigeHome !== truth) {
          failures.push(
            `R8 ${row.tool} declares paigeHome:${row.paigeHome} but ${CHAT} ${truth ? "DOES" : "does NOT"} declare "${row.canonical}" as a tool. ` +
            (truth
              ? "The refusal would tell the caller there is no approved path when a person can do this in Paige."
              : "The refusal would send the caller to Paige for an act Paige cannot perform."),
          );
        }
      }
    }
  } else if (populated && !chatSrc) {
    failures.push(`R8 no ${CHAT} source was supplied, so paigeHome was graded against nothing`);
  }

  return { failures, registeredCount: registered.length, policiedCount: policied.length };
}

// ── self-test ────────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const okMcp = `mcp.tool("alpha", {\n});\nmcp.tool("beta", {\n});\ngovernMcpToolCall(\n"tools/call"\n"tools/call"\n"tools/call"\n"tools/call"\n`;
  const okPolicy = `export const MCP_TOOL_COUNT = 2;\nexport const MCP_CAPABILITY_POLICY = {\n  alpha: {\n  beta: {\n};\n`;
  // ── R6/R7 fixtures ───────────────────────────────────────────────────────────────────────────
  // A fixture is a whole consistent tree, so a case can only fail the rule it is aiming at: the
  // declared count matches, every registration is mapped, and every mapping is registered.
  const tree = (tools) => {
    const mcp = tools.map((t) => `mcp.tool("${t.name}", {\n${t.body ?? ""}});\n${t.after ?? ""}`).join("")
      + "governMcpToolCall(\n" + '"tools/call"\n'.repeat(4);
    const policy = `export const MCP_TOOL_COUNT = ${tools.length};\nexport const MCP_CAPABILITY_POLICY = {\n`
      + tools.map((t) => `  ${t.name}: { canonical: "${t.canonical ?? t.name}", ${t.effect === null ? "" : `effect: "${t.effect}", `}category: "read", evidence: "index.ts:1"${t.paigeHome === undefined ? ", paigeHome: false" : t.paigeHome === null ? "" : `, paigeHome: ${t.paigeHome}`} },\n`).join("")
      + "};\n";
    return [mcp, policy];
  };
  const risk = (keys = [], exempts = []) =>
    "const RISK: ReadonlyArray<readonly [string, ActionRisk, string]> = [\n"
    + keys.map((k) => `  ["${k}", "ordinary", "a reason long enough"],\n`).join("") + "];\n"
    + "const NON_MUTATING_EXEMPT: ReadonlyMap<string, string> = new Map([\n"
    + exempts.map((k) => `  ["${k}", "a reason long enough"],\n`).join("") + "]);\n"
    + "export const MUTATION_VERB = /(^|_)(create|update|delete|send|run|log)(_|$)/;\n";
  const many = (n, effect, extra = {}) => Array.from({ length: n }, (_, i) => ({ name: `t_${i}`, canonical: `c_${i}`, effect, ...extra }));
  // A Chat handler stub with enough declarations to be graded, and deliberately declaring NONE of
  // the fixtures' canonicals — so `paigeHome: false` is the truth for every default row.
  const chatNone = Array.from({ length: 60 }, (_, i) => `\n  name: "chat_tool_${i}",`).join("");
  const chatWith = (key) => chatNone + `\n  name: "${key}",`;
  const FETCH = '    const r = await fetch("https://api.example.com/x", {\n';
  const MARK = "    // mcp-read-fetch-exempt: the sibling function only SELECTs on this branch\n";

  // R6 — a read that calls out.
  const [readClean, policyClean] = tree([{ name: "list_things", effect: "read" }]);
  const [readFetch, policyFetch] = tree([{ name: "list_things", effect: "read", body: FETCH }]);
  const [readMarked] = tree([{ name: "list_things", effect: "read", body: MARK + FETCH }]);
  const [readMarkedOk] = tree([{ name: "list_subagents", effect: "read", body: MARK + FETCH }]);
  const [readRosteredNoMark] = tree([{ name: "list_subagents", effect: "read", body: FETCH }]);
  const [, policyRostered] = tree([{ name: "list_subagents", effect: "read" }]);
  const [mutFetch, policyMutFetch] = tree([{ name: "send_thing", canonical: "x_send_thing", effect: "mutate", body: FETCH }]);
  const [readBlockComment] = tree([{ name: "list_things", effect: "read", body: "    /* we deliberately do not fetch( here */\n" }]);
  const [readMarkerInBlock] = tree([{ name: "list_things", effect: "read", body: `    /*\n${MARK}    */\n${FETCH}` }]);
  const [readStringFetch] = tree([{ name: "list_things", effect: "read", body: '    const note = "fetch(";\n' }]);
  // The anchoring precision case, reproduced from the shipped tree: a top-level helper that fetches,
  // declared BETWEEN two registrations. Bounding the span on the next registration attributes its
  // call to the preceding read; bounding it on `});` does not.
  const [readHelperAfter] = tree([
    { name: "list_things", effect: "read", after: `\nasync function callOut(b) {\n${FETCH}}\n\n` },
    { name: "list_more", effect: "read" },
  ]);
  const [, policyTwoReads] = tree([{ name: "list_things", effect: "read" }, { name: "list_more", effect: "read" }]);
  // ...and the hop that SHOULD be caught: the read actually calls that helper.
  const [readCallsHelper] = tree([
    { name: "list_things", effect: "read", body: "    const r = await callOut({});\n", after: `\nasync function callOut(b) {\n${FETCH}}\n\n` },
    { name: "list_more", effect: "read" },
  ]);
  const [unterminated, policyUnterminated] = tree([{ name: "list_things", effect: "read" }]);

  // R7 — resolution against the one classifier.
  const [mcp1, polMutOk] = tree([{ name: "send_thing", canonical: "x_send_thing", effect: "mutate" }]);
  const [, polMutMissing] = tree([{ name: "send_thing", canonical: "x_absent_thing", effect: "mutate" }]);
  const [mcpRead, polReadPlain] = tree([{ name: "get_thing", canonical: "x_get_thing", effect: "read" }]);
  const [, polReadClassified] = tree([{ name: "get_thing", canonical: "x_send_thing", effect: "read" }]);
  const [, polReadVerb] = tree([{ name: "get_thing", canonical: "x_run_thing", effect: "read" }]);
  const [mcpBig, polBig] = tree(many(22, "mutate"));
  const [, polNoEffect] = tree(many(22, null));
  // One row lies about having a Paige-side home; one row omits the field entirely.
  const withFirst = (over) => [{ ...many(22, "mutate")[0], ...over }, ...many(22, "mutate").slice(1)];
  const [, polHomeLie] = tree(withFirst({ paigeHome: true }));
  const [, polNoHome] = tree(withFirst({ paigeHome: null }));
  const riskBig = risk([...many(22, "mutate").map((t) => t.canonical), ...Array.from({ length: 23 }, (_, i) => `pad_${i}`)]);
  const cases = [
    ["clean tree passes", okMcp, okPolicy, 0],
    ["an unmapped tool fails", okMcp + `mcp.tool("gamma", {\n});\n`, okPolicy, 2], // R1 + R3
    ["a stale policy entry fails", okMcp, `export const MCP_TOOL_COUNT = 2;\nexport const MCP_CAPABILITY_POLICY = {\n  alpha: {\n  beta: {\n  ghost: {\n};\n`, 1],
    ["a wrong declared count fails", okMcp, okPolicy.replace("= 2", "= 117"), 1],
    ["removing the adapter call fails", okMcp.replace("governMcpToolCall(\n", ""), okPolicy, 1],
    ["a second server instance fails", okMcp + `other.tool("sneaky", {\n`, okPolicy, 1],
    ["an extra tools/call branch fails", okMcp + `"tools/call"\n`, okPolicy, 1],
    ["a tool name inside a comment does not count", okMcp + `// mcp.tool("commented", {\n`, okPolicy, 0],
    // ── R6 ────────────────────────────────────────────────────────────────────────────────────
    ["R6 a read with no outbound call passes", readClean, policyClean, 0, risk()],
    ["R6 a read that fetches fails", readFetch, policyFetch, 1, risk()],
    ["R6 a mutation that fetches is fine", mutFetch, policyMutFetch, 0, risk(["x_send_thing"])],
    ["R6 a read that calls a helper which fetches fails", readCallsHelper, policyTwoReads, 1, risk()],
    ["R6 a helper between registrations is NOT attributed to the read above it", readHelperAfter, policyTwoReads, 0, risk()],
    ["R6 marker + roster exempts", readMarkedOk, policyRostered, 0, risk()],
    ["R6 a marker on a tool that is not rostered still fails", readMarked, policyFetch, 1, risk()],
    ["R6 a rostered tool with no marker at the call site still fails", readRosteredNoMark, policyRostered, 1, risk()],
    ["R6 fetch( inside a block comment is not a call", readBlockComment, policyClean, 0, risk()],
    ["R6 a marker inside a block comment does not exempt", readMarkerInBlock, policyFetch, 1, risk()],
    ["R6 fetch( inside a string is not a call", readStringFetch, policyClean, 0, risk()],
    ["R6 an unterminated registration is reported", unterminated.replace("});\n", ""), policyUnterminated, 1, risk()],
    // ── R7 ────────────────────────────────────────────────────────────────────────────────────
    ["R7 a mutation whose canonical is classified passes", mcp1, polMutOk, 0, risk(["x_send_thing"])],
    ["R7 a mutation whose canonical is unclassified fails", mcp1, polMutMissing, 1, risk(["x_send_thing"])],
    ["R7 a read whose canonical is unclassified and reads as a query passes", mcpRead, polReadPlain, 0, risk(["x_send_thing"])],
    ["R7 a read pointing at a classified mutation fails", mcpRead, polReadClassified, 1, risk(["x_send_thing"])],
    ["R7 a read whose canonical reads as a write fails", mcpRead, polReadVerb, 1, risk(["x_send_thing"])],
    ["R7 ...unless it is named in NON_MUTATING_EXEMPT", mcpRead, polReadVerb, 0, risk(["x_send_thing"], ["x_run_thing"])],
    ["R7 a populated policy with no action-risk source fails", mcpBig, polBig, 1, ""],
    ["R7 a populated policy against an unreadable RISK table fails", mcpBig, polBig, 1, "export const MUTATION_VERB = /(^|_)(run)(_|$)/;\n"],
    ["R7 a populated row with no readable effect fails", mcpBig, polNoEffect, 1, riskBig],

    // ── R8 ────────────────────────────────────────────────────────────────────────────────────
    // The field decides one sentence, and the wrong value sends a refused caller to a place that
    // cannot perform the act. Graded against the Chat handler rather than trusted.
    ["R8 paigeHome:false on a canonical Chat does NOT declare passes", mcpBig, polBig, 0, riskBig],
    ["R8 paigeHome:true on a canonical Chat does NOT declare fails", mcpBig, polHomeLie, 1, riskBig],
    ["R8 paigeHome:false on a canonical Chat DOES declare fails", mcpBig, polBig, 1, riskBig, chatWith("c_0")],
    ["R8 a row with no paigeHome at all fails", mcpBig, polNoHome, 1, riskBig],
    ["R8 a chat source this rule cannot read fails rather than blessing every row", mcpBig, polBig, 1, riskBig, "nothing parseable here"],
    ["R8 an absent chat source fails rather than grading against nothing", mcpBig, polBig, 1, riskBig, ""],
  ];
  let bad = 0;
  for (const [name, m, p, expected, r, c] of cases) {
    const got = check(m, p, r ?? "", c === undefined ? chatNone : c).failures.length;
    const ok = got === expected;
    if (!ok) bad++;
    console.log(`${ok ? "  ok" : "FAIL"}  ${name} (expected ${expected} failure(s), got ${got})`);
  }
  if (bad) { console.error(`\n${bad} self-test case(s) failed.`); process.exit(1); }
  console.log(`\nmcp-governed-door-lint self-test: ${cases.length}/${cases.length} passed.`);
}

import { pathToFileURL } from "node:url";
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (process.argv.includes("--self-test")) { selfTest(); }
else if (!invokedDirectly) { /* imported for its exports */ }
else {
  const mcpSrc = readFileSync(resolve(process.cwd(), MCP), "utf8");
  const policySrc = readFileSync(resolve(process.cwd(), POLICY), "utf8");
  const riskSrc = readFileSync(resolve(process.cwd(), RISK), "utf8");
  const chatSrc = readFileSync(resolve(process.cwd(), CHAT), "utf8");
  const { failures, registeredCount, policiedCount } = check(mcpSrc, policySrc, riskSrc, chatSrc);
  if (failures.length) {
    console.error(`\nmcp-governed-door-lint: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log(`✅ mcp-governed-door-lint: ${registeredCount} registered tools, ${policiedCount} governed, one door, no bypass.`);
}
