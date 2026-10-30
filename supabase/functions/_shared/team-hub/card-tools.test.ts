// node --test supabase/functions/_shared/team-hub/card-tools.test.ts
// EXP08 Team Hub agents A2b — the card set, the tool definitions' one home, and provenance (plan D2, D6,
// D13, D15). The turn-level behaviour (offer, Prepare, D11, one card per turn) is driven in
// agent-turn.test.ts. EVIDENCE CLASS: automated unit tests plus STRUCTURAL checks over two sources the
// module must agree with: paige-ai-chat's own read tool definitions and the A2b migration's inlined PAIGE
// scope. No authenticated drive is claimed here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  A2B_CARD_TOOLS, A2B_READ_TOOLS, CARD_KIND, CHAT_READ_TOOL_NAMES, CardProvenance, KIND_LABEL, PAIGE_A2B_DM_SCOPE, a2bToolDef, offeredA2bTools,
} from "./card-tools.ts";
import { classifyAction, mutatingTools } from "../action-risk.ts";
import { chatReadToolDefs } from "./a2b-test-fakes.ts";

const CHAT = readFileSync(fileURLToPath(new URL("../../paige-ai-chat/index.ts", import.meta.url)), "utf8");
const MIGRATION = readFileSync(fileURLToPath(new URL("../../../migrations/20271126020008_exp08_team_hub_a2b_cards.sql", import.meta.url)), "utf8");

const DEFS = chatReadToolDefs(CHAT);

describe("the A2b card set is hand-listed, and every card is a high write", () => {
  it("exactly the three card tools and four reads, each with one kind and one label", () => {
    assert.deepEqual([...A2B_CARD_TOOLS].sort(), ["crm_assign_task", "crm_cancel_task", "growth_page_publish"]);
    assert.deepEqual([...A2B_READ_TOOLS].sort(), ["crm_get_task", "crm_list_tasks", "crm_list_team", "growth_list"]);
    assert.deepEqual({ ...CARD_KIND }, { crm_assign_task: "task_handover", crm_cancel_task: "task_cancel", growth_page_publish: "page_publish" });
    assert.deepEqual({ ...KIND_LABEL }, { task_handover: "Task hand-over", task_cancel: "Task cancel", page_publish: "Page publish" });
    for (const t of A2B_CARD_TOOLS) { assert.equal(classifyAction(t), "high", t); assert.ok(mutatingTools().has(t), t); }
    for (const t of A2B_READ_TOOLS) assert.equal(mutatingTools().has(t), false, t);
  });
  it("the kinds are exactly the ones the link table's CHECK admits (20271126020008)", () => {
    for (const [tool, kind] of Object.entries(CARD_KIND)) assert.ok(MIGRATION.includes(`('${tool}','${kind}')`), `${tool} → ${kind}`);
  });
  it("PAIGE's DM scope is the same list the post door inlines (D13), so the two cannot disagree", () => {
    const inlined = MIGRATION.match(/WHEN ch\.agent_key='paige' THEN conf\.tool_name IN \(([^)]*)\)/);
    assert.ok(inlined, "the post door inlines PAIGE's scope");
    const list = inlined![1].split(",").map((x) => x.trim().replace(/^'|'$/g, "")).sort();
    assert.deepEqual(list, [...PAIGE_A2B_DM_SCOPE].sort());
  });
  it("an ordinary write in the stored scope is never offered, even with full authority (D4)", () => {
    assert.deepEqual(offeredA2bTools(["crm_update_task", "crm_reschedule_task", "crm_delete_task", "crm_cancel_task"], "agent_dm", { seat: true, workspaceAdmin: true }), ["crm_cancel_task"]);
  });
});

describe("every A2b tool definition comes from its one home", () => {
  it("the three reads with no shared home yet are the chat's own definitions, each used once in its tool list", () => {
    assert.deepEqual([...CHAT_READ_TOOL_NAMES].sort(), Object.keys(DEFS).sort());
    for (const name of CHAT_READ_TOOL_NAMES) {
      assert.deepEqual(a2bToolDef(name, DEFS), DEFS[name], name);
      assert.equal((DEFS[name] as any).function.name, name);
      assert.equal(CHAT.includes(`name: "${name}",`), true, `${name} is defined in the chat`);
    }
    for (const c of ["GROWTH_LIST_TOOL_DEF", "CRM_LIST_TEAM_TOOL_DEF", "CRM_LIST_TASKS_TOOL_DEF"]) {
      assert.equal(CHAT.split(`          ${c},`).length - 1, 1, `${c} is in the chat's tool list once`);
    }
  });
  it("without the chat's definitions those three are not offered, and a mislabelled one never is", () => {
    for (const name of CHAT_READ_TOOL_NAMES) assert.equal(a2bToolDef(name), null, name);
    assert.equal(a2bToolDef("growth_list", { growth_list: DEFS.crm_list_team }), null);
    assert.equal(a2bToolDef("crm_update_task", DEFS), null);
  });
  it("D15: crm_list_tasks keeps its one schema, assignee_email included", () => {
    assert.ok("assignee_email" in ((a2bToolDef("crm_list_tasks", DEFS) as any).function.parameters.properties));
  });
  it("the card tools and crm_get_task come from their shared homes, a fresh copy each time", () => {
    for (const name of ["crm_assign_task", "crm_cancel_task", "growth_page_publish", "crm_get_task"]) {
      const a = a2bToolDef(name) as any, b = a2bToolDef(name) as any;
      assert.equal(a.function.name, name);
      a.function.parameters.properties.injected = { type: "string" };
      assert.equal("injected" in b.function.parameters.properties, false, `${name}: no copy shares an object with the next`);
    }
    assert.equal(a2bToolDef("crm_update_task"), null);
  });
});

describe("provenance (D6): a card's ids only from this turn's reads", () => {
  const TASK = "12121212-1212-4121-8121-121212121212", PRIYA = "33333333-3333-4333-8333-333333333333", PAGE = "14141414-1414-4141-8141-141414141414";
  it("nothing read: every card call needs a lookup", () => {
    const p = new CardProvenance();
    assert.equal(p.check("crm_cancel_task", { task_id: TASK, expected_updated_at: "x" }).ok, false);
    assert.equal(p.check("growth_page_publish", { page_id: PAGE }).ok, false);
  });
  it("a task's version is its updated_at, or its created_at only when updated_at is null, exactly as read", () => {
    const p = new CardProvenance();
    p.note("crm_list_tasks", { success: true, tasks: [{ id: TASK, updated_at: null, created_at: "2026-10-01T00:00:00+00:00" }] });
    assert.deepEqual(p.check("crm_cancel_task", { task_id: TASK, expected_updated_at: "2026-10-01T00:00:00+00:00", confirm: true }),
      { ok: true, callArgs: { task_id: TASK, expected_updated_at: "2026-10-01T00:00:00+00:00" } });
    assert.equal(p.check("crm_cancel_task", { task_id: TASK, expected_updated_at: "2026-10-01T00:00:00Z" }).ok, false, "not a re-spelling of it");
  });
  it("crm_get_task counts only when it found the task; a failed read counts for nothing", () => {
    const p = new CardProvenance();
    p.note("crm_get_task", { status: "unavailable", task: { id: TASK, updated_at: "t" } });
    p.note("crm_list_tasks", { success: false, tasks: [{ id: TASK, updated_at: "t" }] });
    assert.equal(p.check("crm_cancel_task", { task_id: TASK, expected_updated_at: "t" }).ok, false);
    p.note("crm_get_task", { status: "available", found: true, task: { id: TASK, updated_at: "t", created_at: "c" } });
    assert.equal(p.check("crm_cancel_task", { task_id: TASK, expected_updated_at: "t" }).ok, true);
  });
  it("a hand-over needs the person from a team read, and nothing else in its patch", () => {
    const p = new CardProvenance();
    p.note("crm_list_tasks", { success: true, tasks: [{ id: TASK, updated_at: "t" }] });
    const assign = (patch: unknown) => p.check("crm_assign_task", { task_id: TASK, expected_updated_at: "t", patch });
    assert.equal(assign({ assignee_user_id: PRIYA }).ok, false);
    p.note("crm_list_team", { success: true, members: [{ user_id: PRIYA, name: "Priya" }] });
    assert.equal(assign({ assignee_user_id: PRIYA }).ok, true);
    assert.equal(assign({ assignee_user_id: PRIYA, title: "x" }).ok, false);
    assert.equal(assign({}).ok, false);
  });
  it("a page from growth_list; any other argument is refused", () => {
    const p = new CardProvenance();
    p.note("growth_list", { success: true, pages: [{ id: PAGE }] });
    assert.deepEqual(p.check("growth_page_publish", { page_id: PAGE }), { ok: true, callArgs: { page_id: PAGE } });
    assert.equal(p.check("growth_page_publish", { page_id: PAGE, slug: "x" }).ok, false);
  });
});

describe("the card's own sentence (compliance fix 1): from this turn's reads, never an id", () => {
  const TASK = "12121212-1212-4121-8121-121212121212", PRIYA = "33333333-3333-4333-8333-333333333333", SAM = "22222222-2222-4222-8222-222222222222";
  const read = () => {
    const p = new CardProvenance();
    p.note("crm_list_tasks", { success: true, tasks: [{ id: TASK, title: "  Book\nthe   venue ", updated_at: "2026-10-28T09:00:00Z" }] });
    p.note("crm_list_team", { success: true, members: [{ user_id: PRIYA, name: "Priya Shah" }, { user_id: SAM, name: "Sam Lee" }] });
    return p;
  };
  it("cancel names the task; hand-over names the task and the person, or 'you' for the asker", () => {
    const p = read();
    assert.equal(p.summary("crm_cancel_task", { task_id: TASK }, SAM), "Cancel “Book the venue”.");
    assert.equal(p.summary("crm_assign_task", { task_id: TASK, patch: { assignee_user_id: PRIYA } }, SAM), "Hand “Book the venue” over to Priya Shah.");
    assert.equal(p.summary("crm_assign_task", { task_id: TASK, patch: { assignee_user_id: SAM } }, SAM.toUpperCase()), "Hand “Book the venue” over to you.");
  });
  it("no title, an unnamed person, or a page: null, so the card shows the door's own sentence", () => {
    const p = new CardProvenance();
    p.note("crm_list_tasks", { success: true, tasks: [{ id: TASK, updated_at: "2026-10-28T09:00:00Z" }] });
    p.note("crm_list_team", { success: true, members: [{ user_id: PRIYA }] });
    assert.equal(p.summary("crm_cancel_task", { task_id: TASK }, SAM), null);
    assert.equal(read().summary("crm_assign_task", { task_id: TASK, patch: { assignee_user_id: "44444444-4444-4444-8444-444444444444" } }, SAM), null);
    assert.equal(read().summary("growth_page_publish", { page_id: TASK }, SAM), null);
  });
  it("a long title is cut to one line of at most 120 characters, so the sentence fits the card's 280", () => {
    const p = new CardProvenance();
    p.note("crm_list_tasks", { success: true, tasks: [{ id: TASK, title: "x".repeat(400), updated_at: "2026-10-28T09:00:00Z" }] });
    const s = p.summary("crm_cancel_task", { task_id: TASK }, SAM)!;
    assert.ok(Array.from(s).length <= 130 && s.includes("…"), s);
  });
});
