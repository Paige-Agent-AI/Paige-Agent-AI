/**
 * INT-305 — the delegated-specialist engine-entry adapter (cross-lane handoff
 * 2026-10-03, §1-9): the orchestrator's invokeLocal posts { input, context } to
 * every local sub-agent's edge function, but paige-deep-research reads the
 * canonical TOP-LEVEL contract (body.question / body.user_id) — a delegated
 * specialist run died at the two entry guards before this adapter.
 *
 * The ruled fix is engine-entry normalization, bounded and fill-only:
 *  - input.question | input.query → question (only when question is absent);
 *  - context.user_id → user_id (only when user_id is absent);
 *  - caller:"subagent" (only when the envelope names none);
 *  - M0 lineage UNTOUCHED: the tenant is still resolved SERVER-SIDE from the
 *    (trusted) user_id; no caller-supplied tenant is ever read here.
 *
 * This suite pins the block structurally AND runs the EXTRACTED block against
 * fixture envelopes (the n5 eval pattern — ts.transpileModule + new Function),
 * so the mapping behavior is proven from the real source, not a copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const root = join(__dirname, "..", "..");
const enginePath = join(root, "supabase/functions/paige-deep-research/index.ts");
const source = readFileSync(enginePath, "utf8");

const blockStart = source.indexOf("// ── INT-305: delegated-specialist envelope normalization");
const blockEnd = source.indexOf("const question = typeof body.question", blockStart);
const blockText = source.slice(blockStart, blockEnd);

const js = (body: string) =>
  ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

/** Runs the REAL extracted normalization block against a fixture body. */
const normalize = (fixture: unknown): Record<string, unknown> =>
  (new Function("body", js(`return (function (body) {\n${blockText}\nreturn body;\n})(body);`)) as (b: unknown) => Record<string, unknown>)(fixture);

describe("INT-305: the engine accepts the orchestrator's { input, context } envelope", () => {
  it("the normalization block exists at the engine entry, before the two guards", () => {
    expect(blockStart).toBeGreaterThan(-1);
    const guardPos = source.indexOf('return json({ error: "question is required (min 3 chars)" }, 400);');
    const userIdGuardPos = source.indexOf('return json({ error: "user_id is required" }, 400);');
    expect(blockStart).toBeLessThan(guardPos);
    expect(blockStart).toBeLessThan(userIdGuardPos);
    // and after the JSON parse — an unparseable body still 400s before any of this
    expect(blockStart).toBeGreaterThan(source.indexOf("body = await req.json();"));
  });

  it("maps input.question and context.user_id into the canonical contract", () => {
    const out = normalize({ input: { question: "Compare Acme and Globex pricing" }, context: { user_id: "u-1", conversation_id: "c-1" } });
    expect(out.question).toBe("Compare Acme and Globex pricing");
    expect(out.user_id).toBe("u-1");
    expect(out.caller).toBe("subagent");
  });

  it("input.query is the accepted alias (the orchestrator's generic input shape)", () => {
    const out = normalize({ input: { query: "Who owns Blackrock?" }, context: { user_id: "u-2" } });
    expect(out.question).toBe("Who owns Blackrock?");
    expect(out.user_id).toBe("u-2");
  });

  it("envelope fields only FILL — an explicit top-level value always wins", () => {
    const out = normalize({
      question: "Top-level question",
      user_id: "u-top",
      caller: "manual",
      input: { question: "envelope question", query: "envelope query" },
      context: { user_id: "u-env" },
    });
    expect(out.question).toBe("Top-level question");
    expect(out.user_id).toBe("u-top");
    expect(out.caller).toBe("manual");
  });

  it("an explicit envelope caller is preserved (no 'subagent' overwrite)", () => {
    const out = normalize({ input: { question: "q" }, context: { user_id: "u" }, caller: "lender-research" });
    expect(out.caller).toBe("lender-research");
  });

  it("a body with NO envelope and NO canonical fields is left alone (the guards still 400 it)", () => {
    const out = normalize({ domain: "funding" });
    expect(out).toEqual({ domain: "funding" });
    expect(source).toContain('return json({ error: "question is required (min 3 chars)" }, 400);');
    expect(source).toContain('return json({ error: "user_id is required" }, 400);');
  });

  it("an envelope with context entirely absent fills user_id from nowhere (review P3 fixture)", () => {
    const out = normalize({ input: { question: "q" } });
    expect(out.question).toBe("q");
    expect(out.user_id).toBeUndefined();
  });

  it("an input with no question/query and no context.user_id fills nothing (fail-closed, not invented)", () => {
    const out = normalize({ input: { lender: "Acme" }, context: { conversation_id: "c" } });
    expect(out.question).toBeUndefined();
    expect(out.user_id).toBeUndefined();
  });
});

describe("INT-305: M0 lineage untouched", () => {
  it("the §9 server-side tenant resolution still derives the tenant from user_id — never a body tenant field", () => {
    expect(source).toContain("A tenant is derived SERVER-SIDE only.");
    expect(source).toContain('const userId = typeof body.user_id === "string" ? body.user_id : "";');
    expect(source).toContain('current_user_tenant_id');
    // the cross-check stays a cross-check (never authority)
    expect(source).toContain("Optional CROSS-CHECK (never authority)");
  });

  it("no tenant field is read anywhere in the normalization block (comments may explain; code may not read)", () => {
    expect(blockText).not.toMatch(/tenant_id|tenantId|\.tenant[^_a-zA-Z]|expected_tenant/);
  });
});
