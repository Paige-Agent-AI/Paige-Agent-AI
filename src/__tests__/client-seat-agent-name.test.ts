import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// E09 CURA round 3 (verifier 3). A client seat outside the native Customer Portal branch runs on the
// owner's prompt blocks, which name PAIGE. paige-ai-chat re-voices them with the name the business gave
// its agent, read from the customer's own frame (client_portal_frame under the caller's JWT). Nothing
// executed that branch, so going back to `customerSeatIdentity(m.content)` (always "Cura") or to a
// playbook name passed every test. This reads the real handler source and pins the wiring.
const source = readFileSync(resolve(__dirname, "../../supabase/functions/paige-ai-chat/index.ts"), "utf8");
const file = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const text = (n: ts.Node) => n.getText(file).replace(/\s+/g, "");

function all(node: ts.Node, test: (n: ts.Node) => boolean): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node) => { if (test(n)) out.push(n); ts.forEachChild(n, visit); };
  visit(node);
  return out;
}

/** The `else if (callerTier === "client") { ... }` branch that follows the native persona branch. */
function clientSeatBranch(): ts.Block {
  const branches = all(file, (n) => ts.isIfStatement(n) && text(n.expression) === 'callerTier==="client"'
    && ts.isIfStatement(n.parent) && n.parent.elseStatement === n
    && all(n.thenStatement, (c) => ts.isCallExpression(c) && text(c.expression) === "customerSeatIdentity").length > 0) as ts.IfStatement[];
  expect(branches).toHaveLength(1);
  return branches[0].thenStatement as ts.Block;
}

describe("older client chat path names the business's agent", () => {
  it("reads the name from the caller's own frame and passes it to every re-voiced prompt", () => {
    const branch = clientSeatBranch();
    const reads = all(branch, (n) => ts.isCallExpression(n) && text(n.expression) === "readClientPortalPersonaInput") as ts.CallExpression[];
    expect(reads).toHaveLength(1);
    // Under the caller's JWT client and the verified user, never a service-role client or a body field.
    expect(reads[0].arguments.map(text)).toEqual(["supabaseClient", "user.id"]);

    // The read's assistantName is what the branch binds as the agent's name, falling back to Cura.
    const declarations = all(branch, (n) => ts.isVariableDeclaration(n) && !!n.initializer
      && all(n.initializer, (c) => c === reads[0]).length > 0) as ts.VariableDeclaration[];
    expect(declarations).toHaveLength(1);
    const init = text(declarations[0].initializer!);
    expect(init).toMatch(/\)\?\.assistantName\?\?customerAgentName\(undefined\)$/);
    const agent = text(declarations[0].name);

    const revoices = all(branch, (n) => ts.isCallExpression(n) && text(n.expression) === "customerSeatIdentity") as ts.CallExpression[];
    expect(revoices.length).toBeGreaterThan(0);
    for (const call of revoices) expect(call.arguments.map(text)).toEqual(["m.content", agent]);
  });

  it("re-voices only system prompts and leaves text vouched for the leak read untouched", () => {
    const branch = clientSeatBranch();
    expect(text(branch)).toContain("!clientSeatVouched.includes(m.content)");
    expect(text(branch)).toContain('m?.role==="system"');
  });
});
