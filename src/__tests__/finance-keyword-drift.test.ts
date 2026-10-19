// E09 K1 drift guard: the SQL finance heuristic (_text_looks_financial, 20271111050000) must stay a
// SUPERSET of the edge classifier's FINANCE_KEYWORDS (supabase/functions/_shared/finance-gate.ts).
// Two links: (1) every TS alternative has a sample in the pgTAP list that the database itself checks
// (supabase/tests/e09_customer_knowledge_v2.sql §3); (2) the SQL pattern, read from the migration,
// matches every one of those samples here too. Changing the TS set without the SQL set fails this.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FINANCE_KEYWORDS } from "../../supabase/functions/_shared/finance-gate";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Each TS alternative, with `\s*` expanded to the spaced and unspaced spellings. */
function tsSamples(): string[] {
  const body = FINANCE_KEYWORDS.source.match(/^\\b\((.*)\)\\b$/)?.[1];
  if (!body) throw new Error("FINANCE_KEYWORDS no longer has the \\b(...)\\b shape this guard reads");
  return body.split("|").flatMap((alt) => {
    if (/[^a-z\\s*]/i.test(alt.replace(/\\s\*/g, ""))) throw new Error(`unreadable alternative: ${alt}`);
    return alt.includes("\\s*") ? [alt.replace(/\\s\*/g, " "), alt.replace(/\\s\*/g, "")] : [alt];
  });
}

function sqlPattern(): RegExp {
  const sql = read("supabase/migrations/20271111050000_e09_customer_knowledge_v2.sql");
  const fn = sql.match(/CREATE FUNCTION public\._text_looks_financial[\s\S]*?\$\$;/)?.[0];
  if (!fn) throw new Error("_text_looks_financial not found in the K1 migration");
  // The pattern is written as adjacent SQL string literals: '\m(' '...' ')\M'.
  const literal = [...fn.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")).join("");
  const posix = literal.replace(/\\m/g, "\\b").replace(/\\M/g, "\\b");
  return new RegExp(posix, "i");
}

describe("finance keyword drift (SQL ⊇ TS)", () => {
  const samples = tsSamples();

  it("reads every TS alternative", () => {
    expect(samples).toEqual(expect.arrayContaining(["loan", "lender", "credit repair", "creditrepair", "funding", "underwrit"]));
  });

  it("pins one database-checked sample per TS alternative in the pgTAP suite", () => {
    const test = read("supabase/tests/e09_customer_knowledge_v2.sql");
    const list = test.match(/'TS keyword reads as finance: '[\s\S]*?ARRAY\[([^\]]*)\]/)?.[1];
    expect(list, "pgTAP TS sample list").toBeTruthy();
    const pinned = [...list!.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    for (const sample of samples) expect(pinned, `pgTAP list is missing "${sample}"`).toContain(sample);
  });

  it("the SQL pattern matches every TS sample (and plain business text does not)", () => {
    const sql = sqlPattern();
    for (const sample of samples) expect(sql.test(`Before ${sample} after`), sample).toBe(true);
    expect(sql.test("Our six-week onboarding program starts with a kickoff call.")).toBe(false);
  });
});
