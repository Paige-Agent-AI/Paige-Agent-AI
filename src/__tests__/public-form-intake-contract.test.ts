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

describe("public form intake contract", () => {
  it("nothing in the app inserts a submission directly", () => {
    const offenders = source.filter(({ text }) =>
      /from\(\s*["']growth_form_submissions["']\s*\)[\s\S]{0,80}\.insert\(/.test(text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("no visitor-facing page or growth block reads the forms table", () => {
    const visitorFacing = source.filter(({ path }) =>
      path.startsWith("pages/public/") || path.startsWith("components/growth/"));
    const offenders = visitorFacing.filter(({ text }) => /from\(\s*["']growth_forms["']\s*\)/.test(text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("the public form reads and submits through the governed door", () => {
    const growth = source.find((f) => f.path === "lib/growth.ts")!.text;
    expect(growth).toContain('"growth_public_form"');
    expect(growth).toContain('functions.invoke("growth-public-submit"');
  });
});
