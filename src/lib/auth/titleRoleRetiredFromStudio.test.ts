// The retired title role grants nothing in the studio and generation edge functions. A person holding
// the platform-wide `coach` role, or a `coach` seat in a business, cannot draft pages, forms, funnels
// or copy, edit blocks, route a studio brief, generate images or media, suggest pipelines, run evals,
// critique or learn from artifacts, or export a document.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

const FUNCTIONS = [
  "content-draft",
  "generate-image",
  "studio-learn-from-artifact",
  "studio-visual-critique",
  "growth-form-draft",
  "growth-page-draft",
  "growth-funnel-draft",
  "growth-block-edit",
  "growth-studio-route",
  "pipeline-suggest",
  "paige-eval",
  "paige-media",
  "export-document",
];

// Any code that reads the role: an RPC asking for it, a comparison against it, a list containing it,
// or a value that labels an actor with it.
const ROLE_READ = /_role:\s*["']coach["']|===?\s*["']coach["']|\[[^\]]*["']coach["'][^\]]*\]|\bisCoach\b|:\s*["']coach["'];/;

describe("the retired coach role grants nothing in studio and generation", () => {
  it("is read by none of the gates", () => {
    const offenders = FUNCTIONS.map((fn) => `supabase/functions/${fn}/index.ts`).filter((path) =>
      read(path).split("\n").some((line) => !line.trim().startsWith("//") && ROLE_READ.test(line)),
    );
    expect(offenders).toEqual([]);
  });

  it("does not tell anyone the coach role opens these tools", () => {
    const offenders = FUNCTIONS.map((fn) => `supabase/functions/${fn}/index.ts`).filter((path) =>
      read(path).includes("Admin or coach access required."),
    );
    expect(offenders).toEqual([]);
  });
});
