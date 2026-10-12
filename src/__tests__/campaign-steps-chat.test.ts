// @vitest-environment node
//
// INT-298 MBC slice 6c — PAIGE's campaign-step and process-scope tools. The adapter runs on the caller's own
// session against the functions the Campaigns dossier uses; this suite drives it against a stateful double that
// follows the server's own rules (a result only over a proven finish or a failure, a judgement only over a
// result, the scope seam replacing any earlier scope), and keeps the wiring a regression would break silently.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  CAMPAIGN_STEP_TOOLS, CAMPAIGN_STEP_TOOL_NAMES, CAMPAIGN_STEP_WRITE_TOOLS, dispatchCampaignStepsChat, dueDay, ownerGaveFigure, projectSteps, requestKey,
} from "../../supabase/functions/_shared/campaign-steps-chat.ts";
import {
  CAMPAIGN_STEPS_READ_CAPABILITY, MARKETING_ACTION_CAPABILITIES, PROCESS_SCOPE_READ_CAPABILITY,
} from "../../supabase/functions/_shared/paige-spine/domains/marketing_actions.ts";
import { PAIGE_SPINE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/registry.ts";
import { requiresWorkspaceAdmin } from "../../supabase/functions/_shared/workspace-authority.ts";
import { classifyAction, mutatingTools } from "../../supabase/functions/_shared/action-risk.ts";
import { STEP_START_LABELS } from "../../supabase/functions/_shared/paige-turn/step-start.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN = "a2980600-0000-4000-8000-0000000000b1";
const FOREIGN_CAMPAIGN = "a2980600-0000-4000-8000-0000000000b9";
const PROCESS = "a2980600-0000-4000-8000-0000000000a1";
const OTHER_PROCESS = "a2980600-0000-4000-8000-0000000000a2";
const FORM_A = "a2980600-0000-4000-8000-0000000000f1";
const FORM_B = "a2980600-0000-4000-8000-0000000000f2";
const S_DONE = "a2980600-0000-4000-8000-0000000000c1";
const S_RECORDED = "a2980600-0000-4000-8000-0000000000c2";
const S_PLANNED = "a2980600-0000-4000-8000-0000000000c3";
const S_FAILED = "a2980600-0000-4000-8000-0000000000c4";

type Row = Record<string, unknown>;
const step = (action_id: string, lifecycle: string, extra: Row = {}): Row => ({
  brief_id: CAMPAIGN, action_id, tactic: "Win-back email", family: "email", lifecycle, status: lifecycle === "planned" ? "filed" : "done",
  title: `Step ${action_id.slice(-2)}`, expected_result: null, observed_result: null, evaluation: null, evidence: {}, created_through: "human", ...extra,
});

type Opts = { active?: () => string | null; manage?: boolean; writeError?: string; writeLands?: boolean; scopeError?: string; scopeLands?: boolean; formStarted?: boolean };
function database(opts: Opts = {}) {
  const calls: { name: string; args: Row }[] = [];
  const steps: Row[] = [
    step(S_DONE, "completed", { evidence: { basis: "approval" }, expected_result: { summary: "Ten replies" } }),
    step(S_RECORDED, "recorded", { evidence: { basis: "recorded" }, observed_result: { summary: "Planted" } }),
    step(S_PLANNED, "planned"),
    step(S_FAILED, "failed", { status: "failed", evidence: { basis: "workflow_run", error: "The list was empty." } }),
  ];
  let scope: Row | null = null;
  let counter = 0;
  const rpc = async (name: string, args: Row = {}) => {
    calls.push({ name, args });
    if (name === "current_user_tenant_id") return { data: opts.active ? opts.active() : TENANT, error: null };
    if (name === "read_campaign_steps") {
      if (args.p_expected_tenant_id !== TENANT) return { data: null, error: { code: "22023", message: "active_account_changed" } };
      const mine = args.p_brief_id ? [CAMPAIGN].filter((c) => c === args.p_brief_id) : [CAMPAIGN];
      return { data: { can_manage: opts.manage !== false, briefs: mine.map((c) => ({ brief_id: c, name: "Spring intake", objective: "Book calls", lifecycle_status: "active" })),
        actions: steps.filter((s) => mine.includes(String(s.brief_id))) }, error: null };
    }
    if (name === "configure_campaign_brief_actions") {
      if (opts.writeError) return { data: null, error: { code: "22023", message: opts.writeError } };
      const c = args._command as Row;
      const at = steps.findIndex((s) => s.action_id === c.actionId);
      if (opts.writeLands === false) return { data: { ok: true, action_id: "a2980600-0000-4000-8000-0000000000ff" }, error: null };
      if (c.type === "plan_action") {
        counter += 1;
        const id = `a2980600-0000-4000-8000-0000000000d${counter}`;
        steps.push(step(id, "planned", { title: c.title, tactic: c.tactic, family: c.family, due_at: c.dueAt ?? null, expected_result: c.expectedResult ?? null, created_through: args._actor_kind }));
        return { data: { ok: true, outcome: "planned", action_id: id }, error: null };
      }
      if (c.type === "record_outcome") { steps[at] = { ...steps[at], lifecycle: "outcome_observed", observed_result: c.observed, observed_through: args._actor_kind }; return { data: { ok: true }, error: null }; }
      if (c.type === "evaluate_outcome") { steps[at] = { ...steps[at], lifecycle: "evaluated", evaluation: { verdict: c.verdict, note: c.note ?? null } }; return { data: { ok: true }, error: null }; }
    }
    if (name === "read_process_scope") {
      if (args.p_expected_tenant_id !== TENANT) return { data: null, error: { code: "22023", message: "active_account_changed" } };
      if (args.p_process_id !== PROCESS) return { data: null, error: { code: "22023", message: "PROCESS_NOT_FOUND" } };
      if (opts.formStarted === false) return { data: { automation_id: PROCESS, applies: false }, error: null };
      return { data: { automation_id: PROCESS, applies: true, scope, scope_valid: true, can_go_live: scope !== null, state: "live" }, error: null };
    }
    if (name === "configure_process_scope") {
      if (opts.scopeError) return { data: null, error: { code: "22023", message: opts.scopeError } };
      const s = args._scope as Row;
      if (opts.scopeLands !== false) scope = s.formIds
        ? { kind: "form", form_ids: s.formIds, forms: (s.formIds as string[]).map((id) => ({ id, name: `Form ${id.slice(-2)}` })) }
        : { kind: "campaign", brief_id: s.briefId, campaign: { id: s.briefId, name: "Spring intake" } };
      return { data: { ok: true }, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  return { deps: { caller: { rpc } }, calls, writes: () => calls.filter((c) => c.name.startsWith("configure_")), steps };
}
const run = (db: ReturnType<typeof database>, toolName: string, args: Row, ownerText = "") =>
  dispatchCampaignStepsChat({ tenantId: TENANT, userId: "user-1", toolName, args, ownerText, threadId: "thread-1" }, db.deps);

describe("the tools PAIGE is given", () => {
  it("are six, read through the Spine and declared once, and none approves, sends or switches anything on", () => {
    expect([...CAMPAIGN_STEP_TOOL_NAMES]).toEqual(["read_campaign_steps", "campaign_step_plan", "campaign_step_record_result", "campaign_step_judge", "read_process_scope", "process_scope_set"]);
    for (const name of CAMPAIGN_STEP_TOOL_NAMES) expect(name).not.toMatch(/approve|send|publish|start|live|switch/);
    expect(CAMPAIGN_STEP_TOOLS[0].function.parameters).toBe(CAMPAIGN_STEPS_READ_CAPABILITY.input);
    expect(CAMPAIGN_STEP_TOOLS[4].function.parameters).toBe(PROCESS_SCOPE_READ_CAPABILITY.input);
    const registered = PAIGE_SPINE_CAPABILITIES.filter((c) => c.domain === "marketing_actions").map((c) => c.action.chatTool);
    expect(registered).toEqual([...CAMPAIGN_STEP_TOOL_NAMES]);
    expect(MARKETING_ACTION_CAPABILITIES.every((c) => c.readiness === "none" && c.action.seatAuthority)).toBe(true);
  });

  it("asks first: plan, record and judge are ordinary; setting a process's scope is high, so it always asks", () => {
    expect(classifyAction("campaign_step_plan")).toBe("ordinary");
    expect(classifyAction("campaign_step_record_result")).toBe("ordinary");
    expect(classifyAction("campaign_step_judge")).toBe("ordinary");
    expect(classifyAction("process_scope_set")).toBe("high");
    for (const write of CAMPAIGN_STEP_WRITE_TOOLS) { expect(mutatingTools().has(write)).toBe(true); expect(requiresWorkspaceAdmin(write, new Set())).toBe(true); }
    expect(requiresWorkspaceAdmin("read_campaign_steps", new Set())).toBe(false);
    for (const name of CAMPAIGN_STEP_TOOL_NAMES) expect(STEP_START_LABELS[name]).toBeTruthy();
  });
});

describe("reading a campaign's steps", () => {
  it("relays the server's states, never a result over a step only marked done, and keeps a failure visible", async () => {
    const db = database();
    db.steps.push(step("a2980600-0000-4000-8000-0000000000c5", "outcome_observed", { status: "failed", observed_result: { summary: "Nothing went out" }, evidence: { basis: "workflow_run" } }));
    const result = await run(db, "read_campaign_steps", { campaign_id: CAMPAIGN });
    expect(result.outcome).toBe("succeeded");
    const steps = result.content.steps as Row[];
    const recorded = steps.find((s) => s.step_id === S_RECORDED)!;
    expect(recorded.result).toBeNull();
    expect(recorded.state).toBe("marked done with nothing behind it");
    expect(recorded.can_record_result).toBe(false);
    expect(steps.find((s) => s.step_id === "a2980600-0000-4000-8000-0000000000c5")!.state).toBe("failed, then result recorded");
    expect(steps.find((s) => s.step_id === S_FAILED)!.why_it_failed).toBe("The list was empty.");
    expect(steps.find((s) => s.step_id === S_DONE)!.can_record_result).toBe(true);
  });

  it("refuses when the business changed, and a campaign that isn't this business's", async () => {
    expect((await run(database({ active: () => OTHER }), "read_campaign_steps", {})).content.code).toBe("active_account_changed");
    expect((await run(database(), "read_campaign_steps", { campaign_id: FOREIGN_CAMPAIGN })).content.code).toBe("campaign_not_found");
  });
});

describe("planning a step", () => {
  it("files one record-only step as PAIGE, on the chosen day, and reports it only once the read shows it", async () => {
    const db = database();
    const args = { campaign_id: CAMPAIGN, step: "Thank everyone who booked", tactic: "Win-back email", kind: "email", due_date: "2031-03-01", aim: "Every booking thanked" };
    const result = await run(db, "campaign_step_plan", args);
    expect(result.outcome).toBe("succeeded");
    const write = db.writes()[0].args;
    expect(write).toMatchObject({ _tenant_id: TENANT, _actor_kind: "paige", _command: { type: "plan_action", briefId: CAMPAIGN, title: "Thank everyone who booked", family: "email",
      dueAt: "2031-03-01T12:00:00.000Z", expectedResult: { summary: "Every booking thanked" } } });
    expect(String(write._idempotency_key)).toMatch(/^chat:[0-9a-f]{48}$/);
    expect((result.content.step as Row).planned_by).toBe("PAIGE");
    // Planned, not yet waiting: the step comes for approval once it is prepared (the server's own words).
    expect(String(result.content.note)).toMatch(/as planned and comes to the owner for approval once it is prepared.*Nothing was drafted, sent, published or spent/);
    expect(String(result.content.note)).not.toMatch(/waiting for the owner/);
    // The receipt's run is the asked-for change itself, so a different later change never merges into it.
    expect(result.runId).toBe(write._idempotency_key);
    // The same ask in the same conversation carries the same key, so the writer returns the step it planned.
    const again = database();
    await run(again, "campaign_step_plan", args);
    expect(again.writes()[0].args._idempotency_key).toBe(write._idempotency_key);
  });

  it("writes nothing for a campaign that isn't this business's, a day that doesn't exist, or a member", async () => {
    for (const [args, opts] of [
      [{ campaign_id: FOREIGN_CAMPAIGN, step: "x", tactic: "t", kind: "email" }, {}],
      [{ campaign_id: CAMPAIGN, step: "x", tactic: "t", kind: "email", due_date: "2031-02-30" }, {}],
      [{ campaign_id: CAMPAIGN, step: "x", tactic: "t", kind: "billboard" }, {}],
      [{ campaign_id: CAMPAIGN, step: "x", tactic: "t", kind: "email" }, { manage: false }],
    ] as const) {
      const db = database(opts as Opts);
      const result = await run(db, "campaign_step_plan", args as Row);
      expect(result.outcome === "refused" || result.outcome === "invalid").toBe(true);
      expect(db.writes()).toHaveLength(0);
    }
  });

  it("a refusal that follows a switch of business is named as the switch", async () => {
    let n = 0;
    const db = database({ active: () => (n++ < 1 ? TENANT : OTHER), writeError: "CAMPAIGN_BRIEF_FORBIDDEN" });
    expect((await run(db, "campaign_step_plan", { campaign_id: CAMPAIGN, step: "x", tactic: "t", kind: "email" })).content.code).toBe("active_account_changed");
  });

  it("names a bus refusal as the bus's, and never reports a write the read doesn't show", async () => {
    expect((await run(database({ writeError: "CAMPAIGN_ACTION_BUS_REFUSED" }), "campaign_step_plan", { campaign_id: CAMPAIGN, step: "x", tactic: "t", kind: "email" })).content.code).toBe("bus_refused");
    expect((await run(database({ writeLands: false }), "campaign_step_plan", { campaign_id: CAMPAIGN, step: "x", tactic: "t", kind: "email" })).outcome).toBe("outcome_unknown");
  });
});

describe("recording and judging a result", () => {
  it("records only a figure the owner wrote, and only on a finished step", async () => {
    const asked = await run(database(), "campaign_step_record_result", { campaign_id: CAMPAIGN, step_id: S_DONE, what_happened: "Lots booked", figure: 14 }, "It went well, twelve-ish");
    expect(asked.outcome).toBe("invalid");
    expect(asked.content.outcome).toBe("needs_input");
    const db = database();
    const done = await run(db, "campaign_step_record_result", { campaign_id: CAMPAIGN, step_id: S_DONE, what_happened: "1,000 people opened it", figure: 1000 }, "About 1,000 people opened it");
    expect(done.outcome).toBe("succeeded");
    expect(db.writes()[0].args).toMatchObject({ _actor_kind: "paige", _command: { type: "record_outcome", observed: { summary: "1,000 people opened it", value: 1000 } } });
    for (const [id, code] of [[S_RECORDED, "step_not_proven"], [S_PLANNED, "step_not_finished"]] as const) {
      const other = database();
      expect((await run(other, "campaign_step_record_result", { campaign_id: CAMPAIGN, step_id: id, what_happened: "x" })).content.code).toBe(code);
      expect(other.writes()).toHaveLength(0);
    }
  });

  it("says a failed step is still failed once its result is recorded", async () => {
    const result = await run(database(), "campaign_step_record_result", { campaign_id: CAMPAIGN, step_id: S_FAILED, what_happened: "Nothing went out" });
    expect(result.outcome).toBe("succeeded");
    expect(String(result.content.note)).toMatch(/still reads as failed/);
    // A result whose figure didn't land is not reported as recorded.
  });

  it("judges only a recorded result, once", async () => {
    const early = database();
    expect((await run(early, "campaign_step_judge", { campaign_id: CAMPAIGN, step_id: S_DONE, verdict: "met" })).content.code).toBe("no_result_yet");
    expect(early.writes()).toHaveLength(0);
    const db = database();
    await run(db, "campaign_step_record_result", { campaign_id: CAMPAIGN, step_id: S_DONE, what_happened: "Twelve booked" });
    const judged = await run(db, "campaign_step_judge", { campaign_id: CAMPAIGN, step_id: S_DONE, verdict: "met", note: "Above the aim" });
    expect(judged.outcome).toBe("succeeded");
    expect(((judged.content.step as Row).judged as Row).verdict).toBe("met");
    expect((await run(db, "campaign_step_judge", { campaign_id: CAMPAIGN, step_id: S_DONE, verdict: "not_met" })).content.code).toBe("already_judged");
    // A retry of the very same judgement (after an unclear answer) confirms it and writes nothing new.
    const before = db.writes().length;
    const retry = await run(db, "campaign_step_judge", { campaign_id: CAMPAIGN, step_id: S_DONE, verdict: "met", note: "Above the aim" });
    // It is not a "succeeded" write, so the chat records no receipt crediting PAIGE with a judgement she didn't make.
    expect(retry.outcome).toBe("unchanged");
    expect(retry.content.success).toBe(true);
    expect(db.writes()).toHaveLength(before);
  });
});

describe("a process's scope", () => {
  it("sets forms once each, sorted, as PAIGE, and says it was not switched on or off", async () => {
    const db = database();
    const result = await run(db, "process_scope_set", { process_id: PROCESS, form_ids: [FORM_B, FORM_A, FORM_B.toUpperCase()] });
    expect(result.outcome).toBe("succeeded");
    expect(db.writes()[0].args).toEqual({ _automation_id: PROCESS, _scope: { formIds: [FORM_A, FORM_B] }, _actor_kind: "paige" });
    expect(String(result.content.note)).toMatch(/live, so from now on only these submissions start it\. It was not switched on or off/);
  });

  it("refuses two scopes at once, a process that doesn't start from a form, and a form outside the business", async () => {
    expect((await run(database(), "process_scope_set", { process_id: PROCESS, form_ids: [FORM_A], campaign_id: CAMPAIGN })).outcome).toBe("invalid");
    const notForm = database({ formStarted: false });
    expect((await run(notForm, "process_scope_set", { process_id: PROCESS, campaign_id: CAMPAIGN })).content.code).toBe("process_not_form_started");
    expect(notForm.writes()).toHaveLength(0);
    expect((await run(database({ scopeError: "PROCESS_SCOPE_NOT_FOUND" }), "process_scope_set", { process_id: PROCESS, form_ids: [FORM_A] })).content.code).toBe("scope_not_found");
    expect((await run(database(), "read_process_scope", { process_id: OTHER_PROCESS })).content.code).toBe("process_not_found");
  });

  it("never reports a scope the read doesn't show", async () => {
    expect((await run(database({ scopeLands: false }), "process_scope_set", { process_id: PROCESS, campaign_id: CAMPAIGN })).outcome).toBe("outcome_unknown");
  });
});

describe("helpers", () => {
  it("a due day reads back as the same day anywhere from UTC-11 to UTC+11, and a day that doesn't exist is refused", () => {
    expect(dueDay("2031-03-01")).toBe("2031-03-01T12:00:00.000Z");
    expect(dueDay("2031-02-30")).toBeNull();
    expect(dueDay("tomorrow")).toBeNull();
  });
  it("a figure counts only when the owner wrote that number", () => {
    expect(ownerGaveFigure("about 1,000 opened", 1000)).toBe(true);
    expect(ownerGaveFigure("12.5% replied", 12.5)).toBe(true);
    expect(ownerGaveFigure("twelve booked", 12)).toBe(false);
    expect(ownerGaveFigure("120 booked", 12)).toBe(false);
    // A range is two numbers, never a negative one.
    expect(ownerGaveFigure("10-12 replies", 12)).toBe(true);
    expect(ownerGaveFigure("down by -3 this week", -3)).toBe(true);
  });
  it("a request key is stable for the same ask and differs for another", async () => {
    expect(await requestKey(["a", 1])).toBe(await requestKey(["a", 1]));
    expect(await requestKey(["a", 1])).not.toBe(await requestKey(["a", 2]));
  });
  it("a read the screen can't trust is not relayed", () => {
    expect(projectSteps({ actions: [] })).toBeNull();
  });
});

describe("the wiring", () => {
  const chat = fs.readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
  const migration = fs.readFileSync("supabase/migrations/20271023100000_int298_campaign_steps_chat_tools.sql", "utf8");
  it("the chat mounts the tools for a business, dispatches them on the caller's session and names what each write touches", () => {
    expect(chat).toContain('if (callerTier === "tenant") toolDefs.push(...CAMPAIGN_STEP_TOOLS as any);');
    expect(chat).toContain("dispatchCampaignStepsChat({ tenantId: tid, userId: user.id, toolName: tc.function.name, args: stepArgs, ownerText, threadId: payloadThreadId ?? null }, { caller: supabaseClient })");
    for (const [tool, target] of [["campaign_step_plan", "campaign_brief_actions"], ["process_scope_set", "paige_automations"]]) expect(chat).toContain(`${tool}: "${target}",`);
    for (const tool of CAMPAIGN_STEP_WRITE_TOOLS) expect(chat).toContain(`case "${tool}": {`);
  });
  it("the database proof runs in CI", () => {
    expect(fs.readFileSync(".github/workflows/paige-spine-contract.yml", "utf8")).toContain("supabase/tests/campaign_steps_chat_tools.sql");
  });
  it("the reads refuse another business, and the four writes ask first in Autonomy settings", () => {
    expect(migration.match(/p_expected_tenant_id IS DISTINCT FROM public\.current_user_tenant_id\(\)/g)).toHaveLength(2);
    expect(migration).toContain("RETURN public.get_campaign_brief_actions(p_expected_tenant_id, p_brief_id);");
    expect(migration).toContain("RETURN public.get_process_scope(p_process_id);");
    for (const tool of CAMPAIGN_STEP_WRITE_TOOLS) expect(migration).toContain(`('${tool}',`);
    expect(migration).toContain("coalesce(a.mode,'confirm')");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.read_campaign_steps(uuid, uuid) FROM PUBLIC, anon, service_role;");
  });
});
