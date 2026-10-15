// INT-325 — prompt hygiene on platform-default Paige paths (§2 / §13 / §14 / §50).
//
// Three strings in paige-ai-chat reached every tenant by default and said things that are not true of
// the platform: the client session-summary prompt called Paige "an AI credit strategist" (§2 — a
// finance vertical baked into a path no funding opt-in gates), CRM OPERATOR MODE hardcoded a list of
// "specialist desks" that "own their own lane" (§13 — the roster is data and can degrade to two
// departments; §14/§16 — departments are capability domains inside one Harness and own no lane), and
// the reminder prose named a third-party trademark (§50). Each assertion below reads the
// PRODUCTION source with the TypeScript AST (the n5-client-prompt-denylist pattern), and each fails
// on origin/main 5307015f6 — that failure is the point (§71.4).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { CREDIT_DENYLIST, CREDIT_PROGRAM_DENYLIST } from "../../supabase/functions/_shared/client-context.ts";

const PATH = "supabase/functions/paige-ai-chat/index.ts";
const code = readFileSync(PATH, "utf8");
const source = ts.createSourceFile("chat.ts", code, ts.ScriptTarget.Latest, true);

const findAll = (predicate: (node: ts.Node) => boolean): ts.Node[] => {
  const out: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) out.push(node); ts.forEachChild(node, visit); };
  visit(source);
  return out;
};

// The one `if (generateSessionSummary && sessionMessages …)` branch — the session-summary producer.
const summaryBranch = (): ts.IfStatement => {
  const hits = findAll((n) => ts.isIfStatement(n) && /^generateSessionSummary\s*&&\s*sessionMessages/.test(n.expression.getText(source)));
  expect(hits).toHaveLength(1);
  return hits[0] as ts.IfStatement;
};
const declNodeInBranch = (name: string): ts.Expression => {
  const branch = summaryBranch();
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node; else ts.forEachChild(node, visit);
  };
  visit(branch.thenStatement);
  if (!found?.initializer) throw new Error(`${name} not found in the session-summary branch`);
  return found.initializer;
};
const declInBranch = (name: string): string => declNodeInBranch(name).getText(source);

// The CRM OPERATOR MODE system block, between its markers (internal-vocabulary depends on the END marker).
const crmBlock = (): string => {
  const start = code.indexOf("=== CRM OPERATOR MODE ===");
  const end = code.indexOf("=== END CRM OPERATOR MODE ===");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end);
};

describe("INT-325 session-summary prompt is vertical-neutral (§2)", () => {
  it("carries no credit/funding vocabulary and no persona claim it cannot resolve", () => {
    const prompt = declInBranch("summaryPrompt");
    expect(prompt).toContain("session summarizer"); // guards against the AST pointing at the wrong string
    expect(CREDIT_DENYLIST.test(prompt)).toBe(false);
    expect(CREDIT_PROGRAM_DENYLIST.test(prompt)).toBe(false);
    expect(/strategist|Paige \(an|\bscores?\b/i.test(prompt)).toBe(false);
  });
  it("labels the assistant side of the transcript without a hardcoded persona name", () => {
    // This branch runs before persona resolution, so it cannot know the tenant's assistant name.
    const init = declNodeInBranch("transcript");
    // The role ternary inside the map: `m.role === 'user' ? <client label> : <assistant label>`.
    const ternaries: ts.ConditionalExpression[] = [];
    const visit = (node: ts.Node) => { if (ts.isConditionalExpression(node)) ternaries.push(node); ts.forEachChild(node, visit); };
    visit(init);
    const role = ternaries.filter((t) => /\brole\s*===\s*['"`]user['"`]/.test(t.condition.getText(source)));
    expect(role).toHaveLength(1);
    const literal = (e: ts.Expression): string | undefined =>
      ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : undefined;
    expect(literal(role[0].whenTrue)).toBe("Client");
    expect(literal(role[0].whenFalse)).toBe("Assistant"); // exact — any persona name, in any quote style, fails
    expect(init.getText(source)).not.toMatch(/['"`]Paige['"`]/);
  });
});

describe("INT-325 CRM OPERATOR MODE describes departments from the live roster (§13/§14/§16)", () => {
  it("names the roster through deptRosterLine and drops the hardcoded desk lists", () => {
    const block = crmBlock();
    expect(block).toContain("${deptRosterLine}");
    // Loose on purpose: a paraphrase of the desk list or of the lane-ownership claim must still fail.
    expect(block).not.toMatch(/specialist desks?|\bowns? (their|its) (own )?lanes?\b/i);
    expect(block).not.toMatch(/marketing,? (and )?sales/i);
  });
  it("keeps the delegation tools and the advisor guidance intact (§58)", () => {
    const block = crmBlock();
    for (const kept of ["list_subagents", "delegate_to_subagent", "TRANSPARENCY:", "STRATEGIC INTEGRATION ADVISOR", "action_file", "action_advance"]) {
      expect(block).toContain(kept);
    }
  });
});

describe("INT-325 §50 trademark hygiene in paige-ai-chat", () => {
  // The denylist is read at runtime from CLAUDE.md's own §50 enforcement grep — one of the two surfaces
  // §50 permits to name the marks — so this file carries no mark literal itself and tracks the doctrine
  // as the list grows. Entries that are also ordinary weekday names are dropped (computed via Intl, so no
  // literal here either): the file legitimately schedules on weekdays.
  const denylist = (): string[] => {
    const doctrine = readFileSync("CLAUDE.md", "utf8");
    const line = doctrine.split("\n").find((l) => l.includes("§39 adversarial verifier includes a `grep -ri"));
    if (!line) throw new Error("§50 enforcement grep line not found in CLAUDE.md");
    const pattern = /grep -ri "([^"]+)"/.exec(line)?.[1];
    if (!pattern) throw new Error("§50 grep pattern not parseable");
    const weekdays = new Set(
      Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))).toLowerCase()),
    );
    return pattern.split("\\|").map((e) => e.trim().toLowerCase()).filter((e) => e && !weekdays.has(e));
  };
  it("parses a non-trivial denylist from the doctrine (guards against a vacuous pass)", () => {
    const entries = denylist();
    expect(entries.length).toBeGreaterThanOrEqual(10);
    expect(entries.every((e) => /^[a-z0-9 ]+$/.test(e))).toBe(true);
  });
  it("names no third-party trademark", () => {
    const escape = (e: string) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("\\b(" + denylist().map(escape).join("|") + ")\\b", "gi");
    expect(code.match(re) ?? []).toEqual([]);
  });
});

describe("INT-325 opt-in funding marketplace stub reports honestly (§13)", () => {
  const handler = (): string => {
    // The dispatch branch, not the earlier funding-gate list (L~10061) that also names the tool.
    const marker = '} else if (tc.function.name === "search_funding_marketplace") {';
    const start = code.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    return code.slice(start, code.indexOf("toolResults.push", start));
  };
  it("promises no vendor, no launch and no capability that does not exist", () => {
    const body = handler();
    const messages = [...body.matchAll(/message:\s*("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]) as string);
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message).not.toMatch(/coming soon|once this is live|Lendflow|500 plus|pre-?qualify|rolling out/i);
      expect(message).toMatch(/FDIC|NCUA/); // the real fallback the client can use now
    }
  });
});
