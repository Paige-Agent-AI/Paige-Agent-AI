// The server paths that could hand out the retired title role are closed. No edge function or
// PAIGE tool grants, invites to, or offers the platform-wide `coach` role, and none reads it to
// decide who someone is. "Coach" stays available as a title a business gives its people; it
// never authorizes. The database side is closed by 20270506000000; this covers the callers.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

// Comments are skipped, and so is the one line that names the retired role in order to refuse it.
const codeLines = (path: string) =>
  read(path)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .filter((line) => !/^const RETIRED_ROLES = /.test(line.trim()));

// The role written into user_roles or an invitation, compared, listed, or offered.
const ROLE_USE =
  /role:\s*["']coach["']|===?\s*["']coach["']|\.eq\(\s*["']role["']\s*,\s*["']coach["']\s*\)|\[[^\]]*["']coach["'][^\]]*\]|\?\s*["']coach["']\s*:/;

// A tool definition, from its name to the next tool.
const toolDefinition = (source: string, name: string) => {
  const start = source.indexOf(`name: "${name}"`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const next = source.indexOf('type: "function"', start);
  return source.slice(start, next === -1 ? undefined : next);
};

describe("the server grants and offers the retired title role nowhere", () => {
  it("staff invitations cannot carry it", () => {
    const offenders = [
      "supabase/functions/send-admin-invitation/index.ts",
      "supabase/functions/accept-invite/index.ts",
      "supabase/functions/handle-inbound-webhook/index.ts",
    ].filter((path) => codeLines(path).some((line) => ROLE_USE.test(line)));
    expect(offenders).toEqual([]);

    // The staff invitation's allowed roles are listed across several lines.
    const allowed = read("supabase/functions/send-admin-invitation/index.ts").match(
      /const VALID_ROLES = \[([\s\S]*?)\] as const/,
    );
    expect(allowed?.[1]).toBeDefined();
    expect(allowed?.[1]).not.toMatch(/["']coach["']/);
  });

  it("accepting an invitation that carries it is refused before any role is written", () => {
    const source = read("supabase/functions/accept-invite/index.ts");
    const refusal = source.search(/RETIRED_ROLES\.has\(\s*team\.role\s*\)/);
    const grant = source.search(/\.upsert\(\s*\{\s*user_id:\s*authUser\.id,\s*role:\s*team\.role\s*\}/);
    expect(grant).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(grant);
  });

  it("the operator toolset neither grants, invites to, nor lists by it", () => {
    const lines = codeLines("supabase/functions/paige-mcp/index.ts");
    expect(lines.filter((line) => ROLE_USE.test(line))).toEqual([]);
    expect(read("supabase/functions/paige-mcp/index.ts")).not.toMatch(/mcp\.tool\(\s*["']add_coach_role["']/);
  });

  it("PAIGE's grant and revoke tools do not offer it, and no tool says the title authorizes", () => {
    const source = read("supabase/functions/paige-ai-chat/index.ts");
    for (const name of ["member_grant_role", "member_revoke_role"]) {
      expect(toolDefinition(source, name)).not.toMatch(/["']coach["']/);
    }
    expect(source).not.toMatch(/Admin\/coach only/);
  });
});
