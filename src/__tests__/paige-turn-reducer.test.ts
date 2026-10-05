/**
 * The PAIGE turn reducer — what a chat turn turned out to be, observed rather than predicted.
 *
 * docs/delivery/paige-conversational-loop-c1.md, decisions 3–5. The reducer is pure (no Deno API),
 * so every rule is driven here directly; the edge function only feeds it what already happened.
 * Each rule below names the mutation that kills it, and the build record lists the reverts run.
 */
import { describe, expect, it } from "vitest";
import {
  attachTurnRecord,
  createTurnTracker,
  NO_TOOLS,
  observeToolResult,
  type TurnClassifiers,
} from "../../supabase/functions/_shared/paige-turn/reducer";
import { isTurnFrame, readTurnRecord, TURN_TRACE_MAX_ENTRIES } from "../../supabase/functions/_shared/paige-turn/contract";

const WORK_A = "11111111-2222-4333-8444-555555555555";
const WORK_B = "66666666-7777-4888-8999-aaaaaaaaaaaa";

const CLASSIFY: TurnClassifiers = {
  isMutating: (t) => ["contact_create", "document_generate", "propose_action"].includes(t),
  isBuild: (t) => t === "growth_page_save",
  isResearch: (t) => t === "web_search",
  isDelegation: (t) => t === "delegate_to_subagent",
};
const tracker = () => createTurnTracker(CLASSIFY);
const ran = (name: string, extra: Record<string, unknown> = {}) => ({ name, ran: true, ...extra });

describe("mode is observed from what the turn actually did", () => {
  it("is pending until the first round resolves", () => {
    const t = tracker();
    expect(t.mode).toBe("pending");
    t.roundStarted();
    expect(t.mode).toBe("pending");
  });

  it("is fast_answer when round 0 resolves with no tool call", () => {
    const t = tracker();
    t.roundStarted();
    t.naturalStop();
    expect(t.mode).toBe("fast_answer");
  });

  it("is answer, not fast_answer, when the answer took more than one round", () => {
    // A continuation re-ran the model; the answer was not a first-round answer.
    const t = tracker();
    t.roundStarted(); t.naturalStop();
    t.roundStarted(); t.naturalStop();
    expect(t.mode).toBe("answer");
  });

  it("counts the tools-free closing call in rounds, without changing the observed mode", () => {
    // A Live turn: one decision round that chose to answer, then the answer call itself.
    const t = tracker();
    t.roundStarted(); t.naturalStop();
    t.closingCallStarted();
    expect(t.mode).toBe("fast_answer");
    expect(t.record().rounds).toBe(2);
  });

  it("is answer when tools ran but none is classified", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([ran("contacts_search")]);
    t.roundStarted(); t.naturalStop();
    expect(t.mode).toBe("answer");
  });

  it.each([
    [["contact_create"], "action"],
    [["web_search"], "research"],
    [["web_search", "contact_create"], "research"],
    [["delegate_to_subagent", "web_search", "contact_create"], "multi_agent"],
    [["growth_page_save", "delegate_to_subagent", "web_search", "contact_create"], "build"],
  ])("priority build > multi_agent > research > action: %j → %s", (tools, mode) => {
    const t = tracker();
    t.roundStarted();
    // One per round, in reverse priority order, so first-seen can never win by accident.
    for (const name of [...(tools as string[])].reverse()) t.toolsExecuted([ran(name)]);
    expect(t.mode).toBe(mode);
  });

  it("is clarify when PAIGE asked with choices and ran nothing else", () => {
    const t = tracker();
    t.roundStarted(); t.choicesAsked();
    expect(t.mode).toBe("clarify");
  });

  it("an executed tool outranks clarify", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([ran("contact_create")]);
    t.roundStarted(); t.choicesAsked();
    expect(t.mode).toBe("action");
  });

  it("a failed tool still counts as executed (it ran)", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([observeToolResult("contact_create", JSON.stringify({ success: false, error: "duplicate" }))]);
    expect(t.mode).toBe("action");
    expect(t.record().tools).toBe(1);
  });

  // A call refused before any executor ran is not work the turn did. Each of the five not-run shapes
  // the chat loop writes, read through observeToolResult exactly as the edge function feeds it.
  const REFUSALS: Array<[string, Record<string, unknown>]> = [
    ["the client-seat gate (forbidden_seat)", { success: false, forbidden_seat: true, error: "This is a client portal seat; that action is not available here." }],
    ["an autonomy-off tool (disabled)", { success: false, disabled: true, error: "Adding a contact is turned off for this workspace." }],
    ["the Studio scope boundary (outside_studio_scope)", { success: false, error: "outside_studio_scope", message: "isn't something the design studio can do" }],
    // _shared/confirm-fingerprint.ts — an id the model made up, refused before the write.
    ["an id that is not addressable (refused_before_run)", { success: false, refused_before_run: true, error: "id_not_addressable", field: "contact_id", note: "x" }],
    // R2 — an approved customer draft carrying internal text, refused before it was filed or sent.
    ["the outbound-draft check (internal_text_in_draft)", { success: false, error: "internal_text_in_draft", note: "x" }],
  ];
  it.each(REFUSALS)("a call refused by %s counts toward neither tools nor mode", (_gate, result) => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([observeToolResult("contact_create", JSON.stringify(result))]);
    t.roundStarted(); t.naturalStop();
    expect(t.mode).toBe("answer");
    expect(t.record().tools).toBe(0);
  });
  it.each(REFUSALS)("a call refused by %s does not hide the tools that did run beside it", (_gate, result) => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([observeToolResult("contact_create", JSON.stringify(result)), observeToolResult("web_search", JSON.stringify({ success: true }))]);
    expect(t.mode).toBe("research");
    expect(t.record().tools).toBe(1);
  });
});

describe("the terminal state", () => {
  it("is FINAL for an ordinary answer, emitted as completed", () => {
    const t = tracker();
    t.roundStarted(); t.naturalStop();
    expect(t.state).toBe("FINAL");
    expect(t.terminalFrame()).toEqual({ v: 1, event: "completed", state: "FINAL", mode: "fast_answer" });
  });

  it("is WAIT_APPROVAL when a confirm card was issued, even though the model was re-called and answered", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([ran("contact_create", { needsConfirm: true })]);
    t.roundStarted(); t.naturalStop();
    expect(t.state).toBe("WAIT_APPROVAL");
    expect(t.terminalFrame().event).toBe("waiting");
    expect(t.record().waiting_on).toEqual({ kind: "approval", approvals: 1 });
  });

  it("counts every card issued across rounds", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([ran("contact_create", { needsConfirm: true }), ran("propose_action", { needsConfirm: true })]);
    t.roundStarted(); t.toolsExecuted([ran("contact_create", { needsConfirm: true })]);
    expect(t.record().waiting_on).toEqual({ kind: "approval", approvals: 3 });
  });

  it("is WAIT_WORK when document work was accepted and nothing needs approval", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([ran("document_generate", { acceptedWorkId: WORK_A })]);
    t.roundStarted(); t.naturalStop();
    expect(t.state).toBe("WAIT_WORK");
    expect(t.terminalFrame().event).toBe("waiting");
    expect(t.record().waiting_on).toEqual({ kind: "work", work_ids: [WORK_A] });
  });

  it("approval outranks work, and keeps the accepted work ids beside the count", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([ran("document_generate", { acceptedWorkId: WORK_A }), ran("contact_create", { needsConfirm: true })]);
    expect(t.state).toBe("WAIT_APPROVAL");
    expect(t.record().waiting_on).toEqual({ kind: "approval", approvals: 1, work_ids: [WORK_A] });
  });

  it("de-duplicates work ids and drops anything that is not a uuid", () => {
    const t = tracker();
    t.roundStarted();
    t.toolsExecuted([ran("document_generate", { acceptedWorkId: WORK_A }), ran("document_generate", { acceptedWorkId: WORK_A })]);
    t.toolsExecuted([ran("document_generate", { acceptedWorkId: "Your document is underway" }), ran("document_generate", { acceptedWorkId: WORK_B })]);
    expect(t.record().waiting_on).toEqual({ kind: "work", work_ids: [WORK_A, WORK_B] });
  });

  it("is ASK_USER on choices", () => {
    const t = tracker();
    t.roundStarted(); t.choicesAsked();
    expect(t.state).toBe("ASK_USER");
    expect(t.terminalFrame()).toEqual({ v: 1, event: "waiting", state: "ASK_USER", mode: "clarify" });
    expect(t.record().waiting_on).toEqual({ kind: "choice" });
  });

  it("is LIMIT_REACHED when a budget stopped it", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([ran("contacts_search")]);
    t.budgetStop();
    expect(t.state).toBe("LIMIT_REACHED");
    expect(t.terminalFrame().event).toBe("completed");
    expect(t.record().waiting_on).toBeUndefined();
  });

  it("a question with choices still waits on the person after a budget stop", () => {
    const t = tracker();
    t.roundStarted(); t.choicesAsked();
    t.budgetStop();
    expect(t.state).toBe("ASK_USER");
  });

  it("a card issued before the budget stop still waits on the person", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([ran("contact_create", { needsConfirm: true })]);
    t.budgetStop();
    expect(t.state).toBe("WAIT_APPROVAL");
  });

  it.each([
    ["interrupted", "INTERRUPTED"],
    ["withheld", "WITHHELD"],
    ["refused", "REFUSED"],
  ] as const)("%s outranks every waiting state, and carries no waiting_on", (call, state) => {
    const t = tracker();
    t.roundStarted();
    t.toolsExecuted([ran("contact_create", { needsConfirm: true }), ran("document_generate", { acceptedWorkId: WORK_A })]);
    t.choicesAsked(); t.budgetStop();
    t[call]();
    expect(t.state).toBe(state);
    expect(t.terminalFrame().event).toBe("completed");
    expect(t.record().waiting_on).toBeUndefined();
  });

  it("refused outranks withheld outranks interrupted", () => {
    const a = tracker(); a.interrupted(); a.withheld();
    expect(a.state).toBe("WITHHELD");
    const b = tracker(); b.withheld(); b.refused();
    expect(b.state).toBe("REFUSED");
    const c = tracker(); c.withheld(); c.interrupted();
    expect(c.state).toBe("WITHHELD");
  });
});

describe("frames obey the contract", () => {
  it("started is WORKING and carries the mode as known at the time", () => {
    const t = tracker();
    expect(t.frame("started")).toEqual({ v: 1, event: "started", state: "WORKING", mode: "pending" });
  });

  it("every frame it builds passes the contract's own closed-shape reader", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([ran("contact_create", { needsConfirm: true })]);
    for (const f of [t.frame("started"), t.terminalFrame(), t.frame("waiting")]) expect(isTurnFrame(f)).toBe(true);
  });

  it("refuses a terminal event that disagrees with the state (a bug, not an input)", () => {
    const t = tracker();
    t.roundStarted(); t.naturalStop();
    expect(() => t.frame("waiting")).toThrow();
    t.choicesAsked();
    expect(() => t.frame("completed")).toThrow();
  });

  it("never emits the event still reserved for a later slice", () => {
    const t = tracker();
    expect(() => t.frame("segment")).toThrow();
  });

  // C4a — `resumed` is real now: the turn that carries an approved act forward says so once, while
  // it is still WORKING, and its record keeps the kind (closed enum) and nothing else.
  it("a resumed turn says resumed while WORKING and records the kind only", () => {
    const t = tracker();
    t.resumed("approval");
    expect(t.frame("resumed")).toEqual({ v: 1, event: "resumed", state: "WORKING", mode: "pending" });
    t.toolsExecuted([ran("contact_create")]);
    t.roundStarted(); t.naturalStop();
    expect(t.record()).toEqual({ v: 1, state: "FINAL", mode: "action", rounds: 1, tools: 1, resumed: { kind: "approval" } });
    expect(readTurnRecord(JSON.parse(JSON.stringify(t.record())))).toEqual(t.record());
  });

  it("an ordinary turn's record carries no resumed key", () => {
    const t = tracker();
    t.roundStarted(); t.naturalStop();
    expect(Object.keys(t.record())).not.toContain("resumed");
  });

  it("the reader drops a resumed kind outside the contract", () => {
    expect(readTurnRecord({ v: 1, state: "FINAL", mode: "action", rounds: 1, tools: 1, resumed: { kind: "approved" } }))
      .toEqual({ v: 1, state: "FINAL", mode: "action", rounds: 1, tools: 1 });
    expect(readTurnRecord({ v: 1, state: "FINAL", mode: "action", rounds: 1, tools: 1, resumed: { kind: "work" } })?.resumed)
      .toEqual({ kind: "work" });
  });
});

describe("the persisted record and trace", () => {
  it("counts rounds and executed tools", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([ran("web_search"), ran("contacts_search")]);
    t.roundStarted(); t.toolsExecuted([ran("contact_create")]);
    t.roundStarted(); t.naturalStop();
    expect(t.record()).toEqual({ v: 1, state: "FINAL", mode: "research", rounds: 3, tools: 3 });
  });

  it("round-trips through the contract's defensive reader unchanged", () => {
    const t = tracker();
    t.roundStarted(); t.toolsExecuted([ran("document_generate", { acceptedWorkId: WORK_A }), ran("contact_create", { needsConfirm: true })]);
    expect(readTurnRecord(JSON.parse(JSON.stringify(t.record())))).toEqual(t.record());
  });

  it("the trace keeps action steps only — a thought never becomes durable", () => {
    const t = tracker();
    const steps = [
      { kind: "thought", label: "Looking at the PRIVATE-NOTE the client sent", group: "shared", status: "done" },
      { kind: "action", label: "Searched your contacts", group: "owner", status: "done", detail: "3 found" },
      { kind: "action", label: "Couldn't add that contact", group: "client", status: "error" },
    ];
    expect(t.trace(steps)).toEqual([
      { label: "Searched your contacts", group: "owner", status: "done" },
      { label: "Couldn't add that contact", group: "client", status: "error" },
    ]);
    expect(JSON.stringify(t.trace(steps))).not.toContain("PRIVATE-NOTE");
  });

  // C2 — a step's START (`running`) and anything withdrawn are live lifecycle, never an outcome. Kills:
  // coercing every non-error status to "done" (the pre-C2 rule saved a step that never finished as one
  // that did); dropping status-less steps (how a finished step was written before the lifecycle).
  it("the trace keeps outcomes only: running and withdrawn steps never persist, a missing status reads as done", () => {
    const steps = [
      { kind: "action", label: "Adding Dana to your contacts", group: "owner", status: "running" },
      { kind: "action", label: "Added Dana to your contacts", group: "owner", status: "done" },
      { kind: "action", label: "Drafting the welcome email", group: "client", status: "withdrawn" },
      { kind: "action", label: "Searching your calendar", group: "owner", status: "queued" },
      { kind: "action", label: "Couldn't book the session", group: "client", status: "error" },
      { kind: "action", label: "Searched your contacts", group: "owner" },
    ];
    expect(tracker().trace(steps)).toEqual([
      { label: "Added Dana to your contacts", group: "owner", status: "done" },
      { label: "Couldn't book the session", group: "client", status: "error" },
      { label: "Searched your contacts", group: "owner", status: "done" },
    ]);
  });

  it("a START that never finished leaves nothing behind, and does not use up the entry cap", () => {
    const running = Array.from({ length: TURN_TRACE_MAX_ENTRIES + 5 }, (_, i) => ({ kind: "action", label: `Starting ${i}`, group: "owner", status: "running" }));
    expect(tracker().trace(running)).toEqual([]);
    const trace = tracker().trace([...running, { kind: "action", label: "Finished", group: "owner", status: "done" }]);
    expect(trace).toEqual([{ label: "Finished", group: "owner", status: "done" }]);
  });

  it("the trace is bounded", () => {
    const steps = Array.from({ length: 60 }, (_, i) => ({ kind: "action", label: `Step ${i} ${"x".repeat(100)}`, group: "owner", status: "done" }));
    const trace = tracker().trace(steps);
    expect(trace).toHaveLength(TURN_TRACE_MAX_ENTRIES);
    expect(trace.every((e) => e.label.length <= 80)).toBe(true);
  });
});

describe("attachTurnRecord — the one helper the persist call sites go through", () => {
  const settled = () => { const t = tracker(); t.roundStarted(); t.naturalStop(); return t; };
  const STEP = { kind: "action", label: "Searched your contacts", group: "owner", status: "done" };

  it("adds turn_state and turn_trace beside the legacy keys, never replacing them", () => {
    const legacy = { approval_queued: [{ id: "a" }], paige_confirm: [], paige_crm_result: [] };
    const out = attachTurnRecord(settled(), "Done.", { surfaces: ["owner"], bundleRef: legacy }, [STEP]);
    expect(out).toEqual({
      surfaces: ["owner"],
      bundleRef: { ...legacy, turn_state: { v: 1, state: "FINAL", mode: "fast_answer", rounds: 1, tools: 0 }, turn_trace: [{ label: STEP.label, group: "owner", status: "done" }] },
    });
  });

  it("gives a text turn with no legacy card a bundle of its own", () => {
    const out = attachTurnRecord(settled(), "Hello.", { bundleRef: null });
    expect(out.bundleRef).toEqual({ turn_state: { v: 1, state: "FINAL", mode: "fast_answer", rounds: 1, tools: 0 } });
  });

  it("omits an empty trace rather than persisting []", () => {
    const out = attachTurnRecord(settled(), "Hello.", { bundleRef: null }, []);
    expect(Object.keys(out.bundleRef as object)).toEqual(["turn_state"]);
  });

  it.each(["", "   "])("keeps the persist gate: empty text %j with no legacy card persists nothing", (text) => {
    const meta = { surfaces: [], bundleRef: null };
    const out = attachTurnRecord(settled(), text, meta, [STEP]);
    expect(out).toBe(meta);
    expect(out.bundleRef).toBeNull();
  });

  it("an empty-text turn WITH a legacy card still records its turn", () => {
    const legacy = { paige_crm_result: [{ outcome: "success" }] };
    const out = attachTurnRecord(settled(), "", { bundleRef: legacy });
    expect((out.bundleRef as Record<string, unknown>).turn_state).toBeDefined();
    expect((out.bundleRef as Record<string, unknown>).paige_crm_result).toBe(legacy.paige_crm_result);
  });

  it("does not mutate the metadata it was given", () => {
    const legacy = { paige_confirm: [] };
    const meta = { bundleRef: legacy };
    attachTurnRecord(settled(), "x", meta);
    expect(meta).toEqual({ bundleRef: { paige_confirm: [] } });
  });
});

describe("observeToolResult — reading what a tool reported, from its own result JSON", () => {
  it("ran is false only for the five not-run refusals — a failed tool, or an executor's own refusal, still ran", () => {
    expect(observeToolResult("contacts_search", JSON.stringify({ success: true })).ran).toBe(true);
    expect(observeToolResult("contacts_search", JSON.stringify({ rows: [] })).ran).toBe(true);
    expect(observeToolResult("contacts_search", JSON.stringify({ success: false, error: "not found" })).ran).toBe(true);
    expect(observeToolResult("contacts_search", "not json").ran).toBe(true);
    expect(observeToolResult("contacts_search", undefined).ran).toBe(true);
    expect(observeToolResult("contact_create", JSON.stringify({ success: false, forbidden_seat: true })).ran).toBe(false);
    expect(observeToolResult("contact_create", JSON.stringify({ success: false, disabled: true })).ran).toBe(false);
    expect(observeToolResult("contact_create", JSON.stringify({ success: false, error: "outside_studio_scope" })).ran).toBe(false);
    expect(observeToolResult("crm_update_contact", JSON.stringify({ success: false, refused_before_run: true, error: "id_not_addressable" })).ran).toBe(false);
    expect(observeToolResult("propose_action", JSON.stringify({ success: false, error: "internal_text_in_draft" })).ran).toBe(false);
    // Only the exact refusal: a false-y flag, or the error string on a success, is not a refusal.
    expect(observeToolResult("contact_create", JSON.stringify({ success: false, forbidden_seat: false, disabled: false, refused_before_run: false })).ran).toBe(true);
    expect(observeToolResult("propose_action", JSON.stringify({ success: false, error: "internal_text_in_draft_x" })).ran).toBe(true);
    // The approval-resolution refusal and an executor's own refusal share `outcome: "refused"`; the
    // shape cannot tell "nothing was dispatched" from "the executor ran and refused", and describeStep
    // and the write trail both count it as an attempted call — so it counts here too (reducer.ts).
    expect(observeToolResult("crm_update_contact", JSON.stringify({ success: false, outcome: "refused", error: "Nothing was created, changed or sent." })).ran).toBe(true);
    expect(observeToolResult("crm_update_contact", JSON.stringify({ ok: false, outcome: "refused", code: "CRM_APPROVAL_CLAIM_INVALID" })).ran).toBe(true);
    expect(observeToolResult("contact_create", JSON.stringify({ success: true, error: "outside_studio_scope" })).ran).toBe(true);
  });

  it("a confirm card is needs_confirm WITH a summary (the same condition that pushes paige_confirm)", () => {
    expect(observeToolResult("contact_create", JSON.stringify({ needs_confirm: true, confirm_summary: "Add Jordan" })).needsConfirm).toBe(true);
    expect(observeToolResult("contact_create", JSON.stringify({ needs_confirm: true })).needsConfirm).toBe(false);
  });

  it("a queued approval (approval_queued card) also waits on the person", () => {
    expect(observeToolResult("propose_action", JSON.stringify({ success: true, queued: true, approval_id: "x" })).needsConfirm).toBe(true);
    expect(observeToolResult("propose_action", JSON.stringify({ success: false, queued: true })).needsConfirm).toBe(false);
  });

  it("accepted document work is the claimed work_id from document_generate only", () => {
    const accepted = { success: true, accepted: true, work_id: WORK_A, work_status: "claimed" };
    expect(observeToolResult("document_generate", JSON.stringify(accepted)).acceptedWorkId).toBe(WORK_A);
    expect(observeToolResult("document_generate", JSON.stringify({ ...accepted, accepted: false, completed: true, work_status: "succeeded" })).acceptedWorkId).toBeNull();
    expect(observeToolResult("document_generate", JSON.stringify({ ...accepted, work_status: "outcome_unknown" })).acceptedWorkId).toBeNull();
    expect(observeToolResult("some_other_tool", JSON.stringify(accepted)).acceptedWorkId).toBeNull();
  });
});

describe("NO_TOOLS — the classifiers for a turn that runs no tool (the refusal stream)", () => {
  it("answers false for every tool", () => {
    for (const fn of Object.values(NO_TOOLS)) expect(fn("delegate_to_subagent")).toBe(false);
    const t = createTurnTracker(NO_TOOLS);
    t.refused();
    expect(t.terminalFrame()).toEqual({ v: 1, event: "completed", state: "REFUSED", mode: "pending" });
  });
});
