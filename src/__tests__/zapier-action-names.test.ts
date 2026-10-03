// @vitest-environment node
/**
 * The Zapier action-names fix — the operator must be able to act on discovery, not just
 * count it.
 *
 * Production incident (2026-10-02, owner transcript): "zero approved actions, 17 sitting
 * unapproved… The tool didn't hand me the names of those 17 — just the count." The owner
 * approved actions in Zapier blind, and when he asked "which of the 17 should I approve?"
 * Paige could only restate the number. The discovery projection dropped unapproved tool
 * NAMES alongside provider prose — but a name is a bounded identifier, not prose, and it
 * is exactly what the operator needs to grant approval.
 *
 * This suite pins the new contract at every layer:
 *  - projectDiscovery returns validated, deduped, sorted UNAPPROVED NAMES alongside the
 *    true count (a name outside the identifier grammar stays counted-only, never
 *    truncated or sanitized — the count can honestly exceed the names);
 *  - the edge forwards them;
 *  - the model-side allowlist re-filters them (grammar + 200 cap) and the note tells the
 *    model to NAME the waiting actions to the operator, never describe them as just a count;
 *  - the chat tool description carries the same instruction.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
// esbuild ships with vite (vitest's engine) — it transpiles the REAL function's TypeScript
// so the behavioral tests run the genuine source, never a hand-copied duplicate.
import { transformSync } from "esbuild";

const root = join(__dirname, "..", "..");
const outcome = readFileSync(join(root, "supabase/functions/_shared/mcp-outcome.ts"), "utf8");
const edge = readFileSync(join(root, "supabase/functions/call-zapier-action/index.ts"), "utf8");
const chat = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");

/** Extract a self-contained exported function from source and run it as a value. */
function extractFn(source: string, name: string): (...args: unknown[]) => unknown {
  const start = source.indexOf(`export function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const decl = source.slice(start);
  // Paren-match the parameter list…
  const parenOpen = decl.indexOf("(");
  let depth = 0;
  let parenClose = -1;
  for (let i = parenOpen; i < decl.length; i++) {
    if (decl[i] === "(") depth++;
    else if (decl[i] === ")") { depth--; if (depth === 0) { parenClose = i; break; } }
  }
  // …then skip an optional return-type annotation (a colon before the next brace means
  // that brace opens the TYPE, not the body)…
  let scanFrom = parenClose + 1;
  const maybeAnnotation = decl.indexOf("{", scanFrom);
  if (maybeAnnotation >= 0 && decl.slice(scanFrom, maybeAnnotation).includes(":")) {
    let annDepth = 0;
    for (let i = maybeAnnotation; i < decl.length; i++) {
      if (decl[i] === "{") annDepth++;
      else if (decl[i] === "}") { annDepth--; if (annDepth === 0) { scanFrom = i + 1; break; } }
    }
  }
  // …then brace-match the body.
  let bodyDepth = 0;
  let bodyEnd = -1;
  const bodyOpen = decl.indexOf("{", scanFrom);
  for (let i = bodyOpen; i < decl.length; i++) {
    if (decl[i] === "{") bodyDepth++;
    else if (decl[i] === "}") { bodyDepth--; if (bodyDepth === 0) { bodyEnd = i; break; } }
  }
  const declText = decl.slice(0, bodyEnd + 1);
  const js = transformSync(declText, { loader: "ts", format: "cjs" }).code.trim();
  const module = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", js)(module, module.exports);
  const exported = Object.values(module.exports)[0];
  expect(typeof exported).toBe("function");
  return exported as (...args: unknown[]) => unknown;
}

describe("projectDiscovery names the waiting actions (behavioral, the REAL function)", () => {
  const projectDiscovery = extractFn(outcome, "projectDiscovery") as
    (d: Array<{ name: string }>, a: string[]) => { approved: string[]; unapproved: string[]; unapproved_count: number };

  it("unapproved identifier-shaped names cross, deduped and sorted", () => {
    const r = projectDiscovery(
      [{ name: "gmail_send_email" }, { name: "slack_post_message" }, { name: "gmail_send_email" }],
      [],
    );
    expect(r.unapproved).toEqual(["gmail_send_email", "slack_post_message"]);
    expect(r.unapproved_count).toBe(3); // repeats still count — the count is the truth
  });

  it("a name outside the identifier grammar stays COUNTED, never named or truncated", () => {
    const r = projectDiscovery([{ name: "send an email NOW!!!" }, { name: "sheets_add_row" }], []);
    expect(r.unapproved).toEqual(["sheets_add_row"]);
    expect(r.unapproved_count).toBe(2); // the honest gap: one was unshapeable
  });

  it("approved names are separated from unapproved ones as before", () => {
    const r = projectDiscovery([{ name: "gmail_send_email" }, { name: "slack_post_message" }], ["gmail_send_email"]);
    expect(r.approved).toEqual(["gmail_send_email"]);
    expect(r.unapproved).toEqual(["slack_post_message"]);
    expect(r.unapproved_count).toBe(1);
  });

  it("the projection's own 200-name cap bites (defense in depth with the model-side gate)", () => {
    const tools = Array.from({ length: 250 }, (_, i) => ({ name: `action_${String(i).padStart(3, "0")}` }));
    const r = projectDiscovery(tools, []);
    expect(r.unapproved).toHaveLength(200);
    expect(r.unapproved_count).toBe(250); // the count stays the whole truth
  });

  it("the incident's shape: 17 unapproved become 17 NAMES the operator can act on", () => {
    const tools = Array.from({ length: 17 }, (_, i) => ({ name: `action_${String(i).padStart(2, "0")}` }));
    const r = projectDiscovery(tools, []);
    expect(r.unapproved).toHaveLength(17);
    expect(r.unapproved_count).toBe(17);
  });
});

describe("the edge forwards the names", () => {
  it("the list response carries the unapproved array", () => {
    expect(edge).toContain("unapproved: projected.unapproved,");
    expect(edge).toContain("unapproved_count: projected.unapproved_count,");
  });
});

describe("the model-side allowlist re-filters and instructs", () => {
  it("the discovery branch re-asserts the identifier grammar and the 200 cap on unapproved", () => {
    expect(outcome).toMatch(/unapproved: Array\.isArray\(d\.unapproved\)[\s\S]{0,220}CAPABILITY_NAME\.test\(a\)[\s\S]{0,80}slice\(0, 200\)/);
  });

  it("the note tells the model to NAME the waiting actions, never reduce them to a count", () => {
    expect(outcome).toContain("name them so the operator can choose which to grant");
  });

  it("provider prose still never crosses — descriptions remain absent from the projection", () => {
    expect(outcome).toContain("DESCRIPTION is provider prose and never");
  });
});

describe("the chat tool description carries the instruction", () => {
  it("zapier_list_actions tells her to name unapproved actions to the operator", () => {
    expect(chat).toContain("The result names BOTH the approved actions (ready to run) and the UNAPPROVED ones");
    expect(chat).toContain("never describe waiting actions as just a count");
  });
});
