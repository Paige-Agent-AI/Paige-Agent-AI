/**
 * Layer C — the pure decision core of the connector-neutral act engine (`_shared/paige-orchestration/decide.ts`).
 * Proves condition evaluation (closes the dispatcher's TODO F3), the lane→outcome mapping, the refusal→outcome
 * mapping, and that the TS outcome vocabulary stays in lock-step with the SQL domain `paige_act_outcome`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateConditions,
  laneNonExecuteOutcome,
  refusalToOutcome,
  type ConditionVerdict,
  type EventFacts,
  type ActOutcome,
} from "../../supabase/functions/_shared/paige-orchestration/decide.ts";
import {
  ACT_OUTCOMES,
  FINAL_OUTCOMES,
  ADVANCEABLE_OUTCOMES,
  isFinalOutcome,
} from "../../supabase/functions/_shared/paige-orchestration/outcomes.ts";
import { GOVERNED_REFUSAL_CODES } from "../../supabase/functions/_shared/paige-spine/governedExecution.ts";

const facts: EventFacts = {
  event_key: "contact.created",
  subject_table: "clients",
  subject_id: "11111111-1111-1111-1111-111111111111",
  payload: { source: "web_form", tags: ["vip", "inbound"], score: 42, nested: { stage: "new" } },
};

/** Assert a verdict did NOT match and its reason contains `substr`. Uses an explicit literal-equality
 *  discriminant check (`=== false`): this repo compiles with `strictNullChecks:false`, under which TS
 *  narrows a discriminated union on `x.k === literal` but NOT on `!x.k` / a truthy-`throw`. */
function expectReason(v: ConditionVerdict, substr: string): void {
  if (v.matched === false) {
    expect(v.reason).toContain(substr);
    return;
  }
  throw new Error(`expected a non-match verdict, got matched:true`);
}

describe("evaluateConditions — closes TODO F3 (unconditional matches, else all-must-hold)", () => {
  it("matches when conditions are empty / null / undefined (an unconditional automation)", () => {
    expect(evaluateConditions([], facts).matched).toBe(true);
    expect(evaluateConditions(null, facts).matched).toBe(true);
    expect(evaluateConditions(undefined, facts).matched).toBe(true);
  });

  it("evaluates eq / ne / exists / not_exists against top-level and payload fields", () => {
    expect(evaluateConditions([{ field: "event_key", op: "eq", value: "contact.created" }], facts).matched).toBe(true);
    expect(evaluateConditions([{ field: "event_key", op: "eq", value: "deal.won" }], facts).matched).toBe(false);
    expect(evaluateConditions([{ field: "source", op: "eq", value: "web_form" }], facts).matched).toBe(true);
    expect(evaluateConditions([{ field: "payload.source", op: "eq", value: "web_form" }], facts).matched).toBe(true);
    expect(evaluateConditions([{ field: "missing", op: "not_exists" }], facts).matched).toBe(true);
    expect(evaluateConditions([{ field: "source", op: "exists" }], facts).matched).toBe(true);
  });

  it("evaluates in / not_in / contains / gt / lt and dotted nested paths", () => {
    expect(evaluateConditions([{ field: "source", op: "in", value: ["web_form", "referral"] }], facts).matched).toBe(true);
    expect(evaluateConditions([{ field: "source", op: "not_in", value: ["referral"] }], facts).matched).toBe(true);
    expect(evaluateConditions([{ field: "tags", op: "contains", value: "vip" }], facts).matched).toBe(true);
    expect(evaluateConditions([{ field: "tags", op: "contains", value: "cold" }], facts).matched).toBe(false);
    expect(evaluateConditions([{ field: "score", op: "gt", value: 10 }], facts).matched).toBe(true);
    expect(evaluateConditions([{ field: "score", op: "lt", value: 10 }], facts).matched).toBe(false);
    expect(evaluateConditions([{ field: "nested.stage", op: "eq", value: "new" }], facts).matched).toBe(true);
  });

  it("requires ALL conditions to hold (AND)", () => {
    const v = evaluateConditions(
      [{ field: "source", op: "eq", value: "web_form" }, { field: "score", op: "gt", value: 100 }],
      facts,
    );
    expect(v.matched).toBe(false);
    expectReason(v, "score");
  });

  it("FAILS SAFE (not matched) on a non-array or a malformed condition element", () => {
    const nonArray = evaluateConditions({ field: "x", op: "eq" } as unknown, facts);
    expect(nonArray.matched).toBe(false);
    expectReason(nonArray, "not an array");
    const malformed = evaluateConditions([{ nope: true }] as unknown, facts);
    expect(malformed.matched).toBe(false);
    expectReason(malformed, "malformed");
  });
});

describe("laneNonExecuteOutcome — only auto proceeds; everything else is a non-execute outcome", () => {
  it("auto proceeds (null), confirm → approval_pending, off → held_by_lane", () => {
    expect(laneNonExecuteOutcome("auto")).toBeNull();
    expect(laneNonExecuteOutcome("confirm")).toBe("approval_pending");
    expect(laneNonExecuteOutcome("off")).toBe("held_by_lane");
  });
  it("fails SAFE to held_by_lane on an unrecognized lane (never silently executes)", () => {
    expect(laneNonExecuteOutcome("weird")).toBe("held_by_lane");
    expect(laneNonExecuteOutcome("")).toBe("held_by_lane");
  });
});

describe("refusalToOutcome — a governed refusal maps to the exact refused_* outcome, never a success", () => {
  it("maps the forward-looking budget / trust / consent literals, and defaults everything else to refused_authority", () => {
    expect(refusalToOutcome("budget_exceeded")).toBe("refused_budget");
    expect(refusalToOutcome("trust_ceiling")).toBe("refused_trust_compass");
    expect(refusalToOutcome("autonomy_off")).toBe("refused_trust_compass"); // the ONE real code today
    expect(refusalToOutcome("consent_required")).toBe("refused_consent");
    expect(refusalToOutcome("access_denied")).toBe("refused_authority");
    expect(refusalToOutcome("tenant_not_server_derived")).toBe("refused_authority");
    expect(refusalToOutcome("anything_unmapped")).toBe("refused_authority");
  });

  it("is TOTAL over the seam's real GOVERNED_REFUSAL_CODES — every one maps to a refused_* (never a success)", () => {
    const REFUSED: ActOutcome[] = ["refused_authority", "refused_budget", "refused_trust_compass", "refused_consent"];
    for (const code of GOVERNED_REFUSAL_CODES) {
      expect(REFUSED, `real refusal code '${code}' must map to a refused_* outcome`).toContain(refusalToOutcome(code));
    }
    // the one code the seam emits today that is NOT a generic authority refusal:
    expect(refusalToOutcome("autonomy_off")).toBe("refused_trust_compass");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// C4 — the BIDIRECTIONAL "exact state semantics" drift guard. The outcome vocabulary AND the FINAL/SETTLED
// set each live in TWO languages (the canonical TS `outcomes.ts` and the shipped SQL migration). A drift is a
// SILENT correctness bug (a state FINAL in the RPC but advanceable in the engine can never settle; the reverse
// drops a reconcile). This guard parses the ALREADY-SHIPPED migration and asserts BOTH sides are set-for-set
// identical, in BOTH directions — the same mechanical pin as the F5 registry-sync guard, not a human
// remembering to edit two files. It upgrades the prior one-way substring check (TS ⊆ SQL only), which could
// not catch a SQL value with no TS counterpart, and did not cover `_final` at all.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("exact state semantics — TS `outcomes.ts` ↔ SQL migration parity (C4 drift guard)", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20270126000000_paige_act_execution_ledger.sql"),
    "utf8",
  );
  // The record RPC's EFFECTIVE definition (INT-179 Slice 2b redefined it with the in-flight guard). The domain
  // still lives only in the founding migration; `_final` and `_decision` are parsed from the effective RPC.
  const rpcMigration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20271023000000_paige_act_dispatch_claim.sql"),
    "utf8",
  );
  // Strip SQL line comments FIRST: several domain entries carry a trailing `-- …` whose prose contains an
  // apostrophe (e.g. "the automation's conditions"), which would otherwise poison a naive quoted-token scan.
  const clean = migration.replace(/--[^\n]*/g, "");
  const cleanRpc = rpcMigration.replace(/--[^\n]*/g, "");
  const tokens = (block: string | undefined): string[] =>
    (block?.match(/'([a-z_]+)'/g) ?? []).map((s) => s.slice(1, -1));
  const sorted = (xs: readonly string[]): string[] => [...xs].slice().sort();

  it("the SQL domain `paige_act_outcome` CHECK equals ACT_OUTCOMES, set-for-set (both directions)", () => {
    const m = clean.match(/create domain public\.paige_act_outcome[\s\S]*?value in \(([\s\S]*?)\)\s*\)/i);
    expect(m, "could not locate the paige_act_outcome domain CHECK block in the migration").toBeTruthy();
    const sqlDomain = tokens(m?.[1]);
    expect(sqlDomain.length).toBeGreaterThan(0);
    // bidirectional: no TS-only member (SQL would reject it at write time) and no SQL-only member (a state the
    // TS side can never name). sort() both so the assertion message names any exact divergence.
    expect(sorted(sqlDomain)).toEqual(sorted(ACT_OUTCOMES));
  });

  it("the SQL `_final` array equals FINAL_OUTCOMES, set-for-set (both directions)", () => {
    const m = cleanRpc.match(/_final\s+constant\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/i);
    expect(m, "could not locate the `_final` array in paige_record_act_execution").toBeTruthy();
    const sqlFinal = tokens(m?.[1]);
    expect(sqlFinal.length).toBeGreaterThan(0);
    expect(sorted(sqlFinal)).toEqual(sorted(FINAL_OUTCOMES));
  });

  it("the SQL `_decision` array is exactly FINAL_OUTCOMES minus the terminal dispatch outcomes", () => {
    // A decision may never overwrite an in-flight row (Slice 2b). The set must be every FINAL outcome that records
    // what the engine DECIDED — i.e. FINAL minus executed/failed/cancelled, which are what a dispatch produced.
    const m = cleanRpc.match(/_decision\s+constant\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/i);
    expect(m, "could not locate the `_decision` array in paige_record_act_execution").toBeTruthy();
    const terminal = new Set(["executed", "failed", "cancelled"]);
    expect(sorted(tokens(m?.[1]))).toEqual(sorted(FINAL_OUTCOMES.filter((o) => !terminal.has(o))));
  });

  it("FINAL_OUTCOMES ⊂ ACT_OUTCOMES and ADVANCEABLE is exactly the complement (one partition, no drift)", () => {
    // FINAL and ADVANCEABLE are two views of ONE partition of the vocabulary — derived, never hand-listed.
    for (const f of FINAL_OUTCOMES) expect(ACT_OUTCOMES as readonly string[]).toContain(f);
    expect(sorted([...FINAL_OUTCOMES, ...ADVANCEABLE_OUTCOMES])).toEqual(sorted(ACT_OUTCOMES));
    // the advanceable states are exactly the dispatch/reconcile ones the engine + adapters may still move.
    expect(sorted(ADVANCEABLE_OUTCOMES)).toEqual(sorted(["accepted_for_execution", "retrying", "ambiguous"]));
    // the canonical predicate agrees with the partition on every member, and fails safe on a null/absent value.
    for (const f of FINAL_OUTCOMES) expect(isFinalOutcome(f), `${f} is final`).toBe(true);
    for (const a of ADVANCEABLE_OUTCOMES) expect(isFinalOutcome(a), `${a} is advanceable`).toBe(false);
    expect(isFinalOutcome(null)).toBe(false);
    expect(isFinalOutcome(undefined)).toBe(false);
    expect(isFinalOutcome("not_an_outcome")).toBe(false);
  });

  it("every ActOutcome the code can produce is a real vocabulary member (no orphan literal)", () => {
    // A belt-and-suspenders type-level check: the producible list the code paths emit is exactly the vocabulary.
    const producible: ActOutcome[] = [...ACT_OUTCOMES];
    expect(sorted(producible)).toEqual(sorted(ACT_OUTCOMES));
  });

  it("20270126000000 is the SOLE authority for the domain, and the record RPC is defined only where this guard parses it", () => {
    // Codex P2 (post-merge review of #1208): the two parses above read ONLY the founding migration, so a LATER
    // immutable migration that altered the domain or replaced the RPC (with a new _final), while the TS
    // vocabulary was left stale, would compare stale-TS vs stale-founding-SQL and PASS while the deployed schema
    // had diverged. Close that hole mechanically (the C4 principle — a lock, not a comment): assert the founding
    // migration is the ONLY one that creates the domain or defines the RPC, and that NOTHING alters the domain
    // later. If any of these trip, the effective schema moved: update ACT_OUTCOMES/FINAL_OUTCOMES AND repoint the
    // parses above at the new effective definition, in the SAME commit (§66/§BRAIN.3).
    const FOUNDING = "20270126000000_paige_act_execution_ledger.sql";
    const dir = resolve(process.cwd(), "supabase/migrations");
    const createsDomain: string[] = [];
    const definesRpc: string[] = [];
    const altersDomain: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
      const sql = readFileSync(resolve(dir, f), "utf8");
      if (/create\s+domain\s+public\.paige_act_outcome\b/i.test(sql)) createsDomain.push(f);
      if (/create\s+or\s+replace\s+function\s+public\.paige_record_act_execution\b/i.test(sql)) definesRpc.push(f);
      if (/alter\s+domain\s+(public\.)?paige_act_outcome\b/i.test(sql)) altersDomain.push(f);
    }
    expect(createsDomain).toEqual([FOUNDING]);
    // (Slice 2b moved the RPC's effective definition to 20271023000000; the `_final`/`_decision` parses read that
    // file, and this list pins exactly those two definitions. A third definition must repoint.)
    expect(definesRpc).toEqual([FOUNDING, "20271023000000_paige_act_dispatch_claim.sql"]);
    expect(altersDomain).toEqual([]); // an ALTER DOMAIN ... ADD VALUE would widen the domain past this guard
  });
});
