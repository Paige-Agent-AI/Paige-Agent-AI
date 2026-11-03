// Execute the ORIGINAL Chat source spans and durable-answer projection. The
// original RPC result and recorder are controlled ports, not live/Auth proof.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { finishPlanningChatRead } from "./read-record-links.ts";
import { mergeRecordLinks, readRecordLinks } from "../paige-turn/record-links.ts";

const source = readFileSync(new URL("../../paige-ai-chat/index.ts", import.meta.url), "utf8");
const tenant = "11111111-1111-4111-8111-111111111111", foreign = "22222222-2222-4222-8222-222222222222";
const runId = "00000000-0000-4000-8000-000000000099";
const item = { id: "00000000-0000-4000-8000-000000000001", tenant_id: tenant, plan_id: null, title: "Original private work" };
const raw = { plans: [], loose_items: [item] };
const expected = [{ destination: "operations_work", record_id: item.id, record_kind: "planning_item" }];
const producerStart = source.indexOf("// O01 original Planning read: receipt before facts and references.");
const producerEnd = source.indexOf("// O01 Planning read complete;", producerStart);
assert.ok(producerStart > 0 && producerEnd > producerStart, "original successful dispatch is inspectable");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const producer = new AsyncFunction("tc", "tid", "user", "payloadThreadId", "finishPlanningChatRead", "stableRunId", "recordCapabilityRun",
  "supabase", "rpcData", "readRecordLinkSource", "toolResults", "req", "WALL_CLOCK_MS", "startedAt", "supabaseClient",
  `for (const once of [true]) { ${source.slice(producerStart, producerEnd)} }`);
const begin = source.indexOf("// E4-S3 — only references held by an admitted read");
const end = source.indexOf("} catch { /* keep ok */ }", begin);
assert.ok(begin > 0 && end > begin, "original reference collector is inspectable");
const collector = new Function("tc", "parsed", "readRecordLinkSource", "readLinkTrace", "mergeRecordLinks", "res", source.slice(begin, end));
const metadataStart = source.indexOf("const assistantTurnMetadata = () => (");
const metadataEnd = source.indexOf("\n      });", metadataStart);
assert.ok(metadataStart > 0 && metadataEnd > metadataStart, "original durable metadata is inspectable");
const metadata = new Function("readLinkTrace", "readRecordLinks", "stepTrace", "queuedApprovals", "confirmTrace", "crmResultTrace", "researchTrace",
  "interactiveEffects", "payloadRequestIntentId", "crmResultReferenceMetadata",
  `return ${source.slice(metadataStart, metadataEnd + "\n      });".length).replace("const assistantTurnMetadata = ", "")}`);

async function dispatch(input: unknown, options: { tool?: string; tenant?: string; receipt?: boolean | "unknown";
  scopeChange?: "before_receipt" | "during_receipt" | "unavailable" } = {}) {
  const tc = { id: "original-read-1", function: { name: options.tool ?? "plan_list" } }, map = new Map(), results: Array<{ content: string }> = [];
  const records: Array<Record<string, unknown>> = [], keys: string[][] = [];
  let currentTenant = options.scopeChange === "before_receipt" ? foreign : options.tenant ?? tenant, scopeReads = 0;
  await producer(tc, options.tenant ?? tenant, { id: "00000000-0000-4000-8000-000000000010" }, "original-thread",
    finishPlanningChatRead, async (parts: string[]) => { keys.push(parts); return runId; },
    async (_service: unknown, record: Record<string, unknown>) => { records.push(record);
      if (options.scopeChange === "during_receipt") currentTenant = foreign;
      if (options.receipt === "unknown") throw Error("response lost"); return options.receipt ?? true; },
    {}, input, map, results, { signal: new AbortController().signal }, 20_000, Date.now(),
    { rpc: async (name: string) => { assert.equal(name, "current_user_tenant_id"); scopeReads++;
      return options.scopeChange === "unavailable" ? { data: null, error: { message: "unavailable" } } : { data: currentTenant, error: null }; } });
  return { tc, map, records, keys, scopeReads, result: results[0], parsed: results[0] ? JSON.parse(results[0].content) : null };
}
function collect(read: Awaited<ReturnType<typeof dispatch>>, previous: unknown[] = []) {
  const trace = [...previous];
  collector(read.tc, read.parsed, read.map, trace, mergeRecordLinks, read.result);
  const saved = metadata(trace, readRecordLinks, [], [], [], [], [], [], null, () => null)();
  return { trace, saved };
}

describe("Planning original dispatch → read receipt → collector → durable references", () => {
  it("records only a read and emits/persists/reopens original references from the canonical no-status RPC shape", async () => {
    assert.equal("status" in raw, false);
    const read = await dispatch(raw), result = collect(read);
    assert.equal(read.parsed.status, "available"); assert.deepEqual(result.trace, expected);
    assert.deepEqual(result.saved.bundleRef.paige_record_links, expected);
    assert.deepEqual(readRecordLinks(result.saved.bundleRef.paige_record_links), expected);
    assert.equal(JSON.stringify(result.saved).includes(item.title), false, "persist references, not source payload");
    assert.equal(read.records.length, 1); assert.equal(read.records[0].runId, runId);
    assert.equal(read.scopeReads, 2, "original current-tenant read before and after receipt await");
    assert.equal(read.records[0].capabilityKey, "plan_list"); assert.equal(read.records[0].outcome, "capability_succeeded");
    assert.deepEqual(read.records[0].detail, { channel: "paige_chat", tool: "plan_list", read_only: true });
    assert.equal(read.parsed.read_receipt.run_id, runId); assert.equal(read.parsed.read_receipt.kind, "read_only");
    assert.ok(read.keys[0].includes("original-thread:original-read-1"), "original call identity, no new operation");
  });
  for (const scopeChange of ["before_receipt", "during_receipt", "unavailable"] as const) it(`withholds original facts on actual caller scope transition ${scopeChange}`, async () => {
    const read = await dispatch(raw, { scopeChange }), result = collect(read);
    assert.equal(read.parsed.status, "unavailable");
    assert.equal("loose_items" in read.parsed, false); assert.equal("read_receipt" in read.parsed, false);
    assert.deepEqual(result.trace, []); assert.equal(result.saved.bundleRef, null);
    assert.equal(read.records.length, scopeChange === "during_receipt" ? 1 : 0);
    assert.ok(read.scopeReads > 0, "not a comparison with only the captured tenant");
  });
  for (const receipt of [false, "unknown"] as const) it(`withholds facts/references when the original read receipt is ${receipt}`, async () => {
    const read = await dispatch(raw, { receipt }), result = collect(read);
    assert.equal(read.parsed.status, "unavailable"); assert.equal("loose_items" in read.parsed, false);
    assert.deepEqual(result.trace, []); assert.equal(result.saved.bundleRef, null);
  });
  it("refuses foreign-scope data before recording or publishing", async () => {
    const read = await dispatch(raw, { tenant: foreign }), result = collect(read);
    assert.equal(read.records.length, 0); assert.equal(read.parsed.status, "unavailable"); assert.deepEqual(result.trace, []);
  });
  it("keeps authoritative empty and unavailable distinct", async () => {
    const read = await dispatch({ plans: [], loose_items: [] });
    assert.equal(read.parsed.status, "available"); assert.equal(read.records.length, 1); assert.deepEqual(collect(read).trace, []);
  });
  it("never takes result-supplied links instead of the admitted original source", async () => {
    const read = await dispatch({ ...raw, record_links: [{ destination: "contacts", record_id: runId }] });
    assert.equal("record_links" in read.parsed, false); assert.deepEqual(collect(read).trace, expected);
    const noSource = await dispatch(raw); noSource.map.clear(); assert.deepEqual(collect(noSource).trace, []);
  });
  it("does not promise a Planning control dropped by the existing six-reference cap", async () => {
    const read = await dispatch(raw);
    const previous = Array.from({ length: 6 }, (_, i) => ({ destination: "operations_work", record_id: `00000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}` }));
    assert.deepEqual(collect(read, previous).trace, previous);
    assert.match(JSON.parse(read.result.content).navigation_note, /not in this response's bounded selection/);
  });
  it("does not turn an original Planning write into a read receipt", async () => {
    const read = await dispatch(raw, { tool: "plan_set_reminder" });
    assert.equal(read.result, undefined); assert.equal(read.records.length, 0); assert.equal(read.map.size, 0);
  });
});
