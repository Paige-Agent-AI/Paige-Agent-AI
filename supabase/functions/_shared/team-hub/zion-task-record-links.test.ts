import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zionTaskRecordLinks } from "./zion-task-record-links.ts";

const id = "00000000-0000-4000-8000-000000000001";
const task = { id, title: "Private source text", user_id: "00000000-0000-4000-8000-000000000002" };
const reference = { destination: "operations_work", record_id: id };
describe("ZION original Task references", () => {
  it("keeps only a returned Task UUID, never source text, a synthetic Work key or a URL", () => {
    assert.deepEqual(zionTaskRecordLinks("crm_list_tasks", { success: true, tasks: [task, { id: "crm:" + id }, { id: "https://example.invalid" }] }), [reference]);
    assert.deepEqual(zionTaskRecordLinks("crm_get_task", { status: "available", found: true, task }), [reference]);
  });
  it("deduplicates and retains the existing six-reference limit", () => {
    const tasks = Array.from({ length: 9 }, (_, n) => ({ id: `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}` }));
    assert.equal(zionTaskRecordLinks("crm_list_tasks", { success: true, tasks: [task, ...tasks] }).length, 6);
  });
  it("ignores injected result links and non-Task tools", () => {
    assert.deepEqual(zionTaskRecordLinks("plan_list", { success: true, tasks: [task], record_links: [reference] }), []);
    assert.deepEqual(zionTaskRecordLinks("crm_list_tasks", { success: true, tasks: [], record_links: [reference] }), []);
  });
  for (const data of [null, [], { success: false, tasks: [task] }, { success: true, tasks: null }]) {
    it("withholds unavailable or malformed list results " + JSON.stringify(data), () => {
      assert.deepEqual(zionTaskRecordLinks("crm_list_tasks", data), []);
    });
  }
  it("withholds missing, refused and unknown individual Tasks", () => {
    for (const data of [{ status: "unavailable", found: true, task }, { status: "available", found: false, task }, { found: true, task }]) {
      assert.deepEqual(zionTaskRecordLinks("crm_get_task", data), []);
    }
  });
});
