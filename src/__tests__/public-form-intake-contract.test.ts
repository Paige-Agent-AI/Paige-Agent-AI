import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The browser can neither read `growth_forms` as a visitor nor insert into
 * `growth_form_submissions` (20270518000000_public_form_intake.sql). A visitor-facing surface
 * that goes back to either silently stops working, so this holds the line in source.
 */

const ROOT = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const source = files(ROOT).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));

/** Every `.from(<table>)` call's full chain, up to the end of its statement. Handles the
 *  `from("t" as never)` style and chains that run over many lines. */
function chainsOn(text: string, table: string): string[] {
  const call = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`](?:\\s+as\\s+\\w+)?\\s*\\)`, "g");
  return [...text.matchAll(call)].map((m) => {
    const rest = text.slice(m.index! + m[0].length);
    const end = rest.search(/;|\.from\(/);
    return rest.slice(0, end === -1 ? rest.length : end);
  });
}

/** The table named anywhere other than in a `.from(...)` call — e.g. held in a variable and
 *  passed to `from(table)`, which would slip past a call-shaped check. */
function namedOutsideFrom(text: string, table: string): boolean {
  const withoutCalls = text.replace(
    new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`](?:\\s+as\\s+\\w+)?\\s*\\)`, "g"), "");
  return new RegExp(`["'\`]${table}["'\`]`).test(withoutCalls);
}

const GENERATED = new Set(["integrations/supabase/types.ts"]);

describe("public form intake contract", () => {
  it("nothing in the app inserts or upserts a submission directly", () => {
    const offenders = source.filter(({ text }) =>
      chainsOn(text, "growth_form_submissions").some((chain) => /\.(insert|upsert)\(/.test(chain)));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("the submissions table is only ever named in a direct .from() call", () => {
    const offenders = source.filter(({ path, text }) =>
      !GENERATED.has(path) && namedOutsideFrom(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), "growth_form_submissions"));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("no visitor-facing page, growth block or public helper touches the forms table", () => {
    const visitorFacing = source.filter(({ path }) =>
      path.startsWith("pages/public/") || path.startsWith("components/growth/") || path === "lib/growth.ts");
    const offenders = visitorFacing.filter(({ text }) => /["'`]growth_forms["'`]/.test(text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("the guards catch the shapes they are meant to catch", () => {
    const multiLine = `supabase\n  .from("growth_form_submissions" as never)\n  .upsert(\n    ${"x".repeat(200)}\n  );`;
    expect(chainsOn(multiLine, "growth_form_submissions").some((c) => /\.(insert|upsert)\(/.test(c))).toBe(true);
    expect(namedOutsideFrom(`const t = "growth_form_submissions"; supabase.from(t).insert({});`, "growth_form_submissions")).toBe(true);
    expect(namedOutsideFrom(`supabase.from("growth_form_submissions").select("id");`, "growth_form_submissions")).toBe(false);
  });

  it("the public form reads and submits through the governed door", () => {
    const growth = source.find((f) => f.path === "lib/growth.ts")!.text;
    expect(growth).toMatch(/\.rpc\(\s*"growth_public_form"/);
    expect(growth).toMatch(/functions\.invoke\(\s*"growth-public-submit"/);
  });
});
