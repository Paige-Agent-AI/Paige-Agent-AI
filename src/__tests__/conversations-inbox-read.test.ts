// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { dispatchInboxIntelligenceChat } from "../../supabase/functions/_shared/inbox-intelligence/chat";
import { mergeRecordLinks, readRecordLinks } from "../../supabase/functions/_shared/paige-turn/record-links";
import { workspaceLinkTarget } from "../lib/links/workspaceLinks";

const source = readFileSync(resolve(process.cwd(), "supabase/functions/paige-ai-chat/index.ts"), "utf8");
const ast = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true);
const branches: ts.IfStatement[] = [];
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'tc.function.name === "inbox_list"') branches.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);

// Execute the actual small native branch with the real existing dispatcher, not a copied handler.
const nativeBranch = ts.transpileModule(
  `async function run(dispatchInboxIntelligenceChat, supabaseClient, args, tc, readRecordLinkSource) {
    let result; ${branches[0].thenStatement.getText(ast)} return result;
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const execute = new Function(`${nativeBranch}; return run;`)();
const collectors: ts.IfStatement[] = [];
function findCollector(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast).includes("readRecordLinkSource.has(tc)")) collectors.push(node);
  ts.forEachChild(node, findCollector);
}
findCollector(ast);
const collect = new Function("parsed", "tc", "readRecordLinkSource", "readLinkTrace", "mergeRecordLinks", "res",
  collectors[0].getText(ast));
const envelope = {
  id: "e2000000-0000-4000-8000-000000000001", direction: "outbound", channel: "email",
  subject: "Project update", status: "sent", contact_id: null, thread_key: null, created_at: "2026-10-20T12:00:00Z",
};

async function read(data: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  const references = new Map();
  const tc = { function: { name: "inbox_list" } };
  const result = await execute(dispatchInboxIntelligenceChat, { rpc }, { limit: 12, direction: "outbound" }, tc, references);
  return { result, rpc, links: references.get(tc) };
}

describe("Conversations envelopes through the native permitted read", () => {
  it("uses exactly one incumbent dispatch and caller RPC, without granting admission", async () => {
    expect(branches).toHaveLength(1);
    const { result, rpc, links } = await read([envelope]);
    expect(rpc.mock.calls).toEqual([["list_inbox_messages", { p_limit: 12, p_direction: "outbound" }]]);
    expect(result).toMatchObject({ success: true, status: "available", count: 1, messages: [envelope] });
    expect(result.note).toMatch(/bounded|total/i);
    expect(result.note).toMatch(/delivery/i);
    expect(links).toEqual([{ destination: "conversations", record_id: null }]);
  });

  it("keeps a legitimate empty read separate from an unavailable source", async () => {
    const { result, links } = await read([]);
    expect(result).toMatchObject({ success: true, status: "available", count: 0, messages: [] });
    expect(links).toEqual([{ destination: "conversations", record_id: null }]);
  });

  it.each([null, { messages: [envelope] }, "unavailable", [null], [{}],
    [{ ...envelope, id: "invalid" }], [{ ...envelope, subject: { private: "data" } }],
    [{ ...envelope, created_at: "not-a-date" }], Array(51).fill(envelope)])(
    "withholds malformed or unbounded results without a false empty count", async data => {
      const { result, links } = await read(data);
      expect(result).toMatchObject({ success: false, status: "unavailable" });
      expect(result).not.toHaveProperty("count");
      expect(result).not.toHaveProperty("messages");
      expect(links).toBeUndefined();
    });

  it("does not expose provider/RPC errors or present a permission refusal as an empty inbox", async () => {
    const { result, links } = await read(null, { code: "42501", message: "private internal detail" });
    expect(result).toMatchObject({ success: false, status: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("private internal detail");
    expect(links).toBeUndefined();
  });

  it("withholds a rejected transport without leaking its exception", async () => {
    const tc = { function: { name: "inbox_list" } };
    const references = new Map();
    const rpc = vi.fn(async () => { throw new Error("private transport detail"); });
    const result = await execute(dispatchInboxIntelligenceChat, { rpc }, {}, tc, references);
    expect(result).toMatchObject({ success: false, status: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("private transport detail");
    expect(references.size).toBe(0);
  });

  it("keeps the original maximum-size read without treating it as a total", async () => {
    const { result } = await read(Array(50).fill(envelope));
    expect(result).toMatchObject({ status: "available", count: 50 });
    expect(result.messages).toHaveLength(50);
    expect(result.note).toMatch(/not the business total/);
  });

  it("does not expand the envelope into content or persist any supplied address", async () => {
    const { result, links } = await read([{ ...envelope, body: "Private body", paige_record_links: [{ destination: "contacts" }], url: "https://foreign.invalid" }]);
    expect(result.messages).toEqual([envelope]);
    expect(JSON.stringify(result)).not.toMatch(/Private body|foreign.invalid|paige_record_links/);
    const saved = readRecordLinks(JSON.parse(JSON.stringify(links)));
    expect(workspaceLinkTarget(saved[0], { account_type: "standalone", parent_tenant_id: null, account_number: "7002" }))
      .toEqual({ label: "Open Conversations", to: "/solo/7002/clients/conversations", status: "surface_only" });
  });

  it("collects only a successful read's trusted per-call reference, never links supplied in a result", () => {
    expect(collectors).toHaveLength(1);
    const tc = { function: { name: "inbox_list" } };
    const trace: unknown[] = [];
    const references = new Map();
    const injected = { status: "available", paige_record_links: [{ destination: "contacts", record_id: envelope.id }] };
    collect(injected, tc, references, trace, mergeRecordLinks, {});
    expect(trace).toEqual([]);
    references.set(tc, [{ destination: "conversations", record_id: null }]);
    collect({ status: "unavailable" }, tc, references, trace, mergeRecordLinks, {});
    collect(injected, { function: { name: "inbox_list" } }, references, trace, mergeRecordLinks, {});
    expect(trace).toEqual([]);
    collect(injected, tc, references, trace, mergeRecordLinks, {});
    expect(trace).toEqual([{ destination: "conversations", record_id: null }]);
  });
});
