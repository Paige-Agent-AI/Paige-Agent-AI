// @vitest-environment node
// E2-6a — the business review seam for the owner-facing UI: source contracts that keep the
// edge a THIN transport over the one composer (no second source of truth, no service-role
// client, no authority of its own). Failing-first: each assertion fails if the seam regrows
// a parallel read path.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SOURCE = fs.readFileSync(path.resolve(__dirname, "../../supabase/functions/paige-business-review/index.ts"), "utf8");

/** Extract a named function's text through the AST (brace-walking truncates on return types). */
function fnText(name: string): string {
  const sf = ts.createSourceFile("index.ts", SOURCE, ts.ScriptTarget.ES2022, true);
  let out = "";
  sf.forEachChild(function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) out = node.getText(sf);
    node.forEachChild(visit);
  });
  return out;
}

describe("E2-6a — one composition path", () => {
  it("runs the fabric composer on the caller's own session (no parallel read logic)", () => {
    expect(SOURCE).toMatch(/import \{ composeBusinessReview \} from "\.\.\/_shared\/paige-context\/business-review\.ts";/);
    expect(SOURCE).toMatch(/await composeBusinessReview\(/);
  });

  it("reads NO table directly — every figure flows through the composer, so a parallel read path cannot grow here", () => {
    expect(SOURCE).not.toMatch(/\.from\(/);
  });

  it("NEVER creates a service-role client (the issuer holds the authority)", () => {
    expect(SOURCE).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(SOURCE).toMatch(/global: \{ headers: \{ Authorization: authHeader \} \}/);
  });

  it("resolve who honestly: user id + server-read workspace, never invented role/accountShape", () => {
    expect(SOURCE).toMatch(/actorId: user\.id, tenantId, role: null, accountShape: null/);
    expect(SOURCE).toMatch(/rpc\("current_user_tenant_id"\)/);
    expect(SOURCE).not.toMatch(/role: "/);
  });
});

describe("E2-6a — bounded input", () => {
  const parse = fnText("parseRequest");

  it("admits only the chat tool's vocabulary, and every period must be a known key", () => {
    expect(parse).toContain('k !== "period" && k !== "custom_start" && k !== "custom_end" && k !== "focus" && k !== "timezone"');
    expect(parse).toContain("SNAPSHOT_PERIOD_KEYS");
    expect(parse).toContain("SNAPSHOT_DOMAINS");
  });

  it("an empty body is the default UTC review (the UI's plain mount), and focus is capped at 6 known areas", () => {
    expect(parse).toContain("body === undefined || body === null");
    expect(parse).toContain("args.focus.length > 6");
  });

  it("the request body is size-bounded before parsing", () => {
    expect(SOURCE).toContain("MAX_BODY_BYTES");
    expect(SOURCE).toMatch(/raw\.length > MAX_BODY_BYTES/);
  });
});

describe("E2-6a — truthful responses", () => {
  it("the composer is total: only auth/shape errors are HTTP errors; a bad period is ok:false with its reason", () => {
    expect(SOURCE).toMatch(/if \(!review\.ok\) \{\s*\n\s*return new Response\(JSON\.stringify\(\{ ok: false, reason: review\.reason \}\)/);
  });

  it("returns the structured snapshot AND the projection (the UI renders from the same data the chat narrates)", () => {
    expect(SOURCE).toMatch(/\{ ok: true, snapshot: review\.snapshot, projection: review\.projection \}/);
  });

  it("no internal error text leaves the edge", () => {
    expect(SOURCE).toMatch(/console\.error\("\[paige-business-review\] failed:/);
    expect(SOURCE).toMatch(/"The business review could not be read right now\."/);
  });

  it("verify_jwt is ON in config (caller JWT required at the gateway)", () => {
    const config = fs.readFileSync(path.resolve(__dirname, "../../supabase/config.toml"), "utf8");
    expect(config).toMatch(/\[functions\.paige-business-review\]\s*\n\s*verify_jwt = true/);
  });
});
