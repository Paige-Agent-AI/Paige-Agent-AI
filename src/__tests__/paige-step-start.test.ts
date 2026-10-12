/**
 * C2b — THE START OF A TOOL STEP (docs/delivery/paige-conversational-loop-c2.md).
 *
 * `describeStepStart` (supabase/functions/_shared/paige-turn/step-start.ts) words a tool step while it
 * runs; `describeStep` (paige-ai-chat) words it once it has returned. These pin:
 *   - PARITY: every tool describeStep names has a decision about its START — a present-tense label,
 *     describeStep's own (already present-tense) label, or an explicit "never announced" — and no
 *     decision names a tool describeStep does not know;
 *   - every START label is present tense, short, from a fixed vocabulary, and never a past-tense claim;
 *   - a START never carries `detail` (the model's own query must not ride a START);
 *   - doors, web_fetch and unknown names are never announced.
 *
 * describeStep lives in the edge function, which imports Deno URLs, so it is read out of the source
 * and transpiled on its own (its specialist label helper is injected from the real shared module).
 */
import { specialistStepLabel } from "../../supabase/functions/_shared/paige-turn/specialist-step-label";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Step = { label: string; group: string; detail?: string } | null;
type DescribeStep = (tc: unknown, res: unknown) => Step;
type StepStartModule = {
  describeStepStart: (tc: unknown, describeFinished: DescribeStep) => Step;
  STEP_START_LABELS: Readonly<Record<string, string>>;
  STEP_START_SAME_LABEL: ReadonlySet<string>;
  STEP_NO_START: Readonly<Record<string, string>>;
};

function port(path: string): StepStartModule {
  const src = readFileSync(path, "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out: Record<string, unknown> = {};
  new Function("require", "exports", js)((k: string) => { throw new Error(`unexpected runtime import: ${k}`); }, out);
  return out as StepStartModule;
}

const { describeStepStart, STEP_START_LABELS, STEP_START_SAME_LABEL, STEP_NO_START } =
  port("supabase/functions/_shared/paige-turn/step-start.ts");

const CHAT = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const describeStepSource = (() => {
  const from = CHAT.indexOf("function toolResultReportsFailure");
  const to = CHAT.indexOf("// One home for turning a client_ref");
  if (from < 0 || to < 0 || to < from) throw new Error("describeStep could not be located in paige-ai-chat/index.ts");
  return CHAT.slice(from, to);
})();
const describeStep: DescribeStep = (() => {
  const js = ts.transpileModule(`${describeStepSource}\nexports.describeStep = describeStep;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out: { describeStep?: DescribeStep } = {};
  new Function("exports", "specialistStepLabel", js)(out, specialistStepLabel);
  if (!out.describeStep) throw new Error("describeStep did not transpile");
  return out.describeStep;
})();

// Every name describeStep decides on: its `case`s, and the ones it tests by name (web_fetch).
const describeStepCases = [...new Set([...describeStepSource.matchAll(/(?:case |name === )"([a-z0-9_]+)"/g)].map((m) => m[1]))];
const startNames = Object.keys(STEP_START_LABELS);
const sameNames = [...STEP_START_SAME_LABEL] as string[];
const noStartNames = Object.keys(STEP_NO_START);
const call = (name: string, args: Record<string, unknown> = {}) => ({ id: "toolu_1", function: { name, arguments: JSON.stringify(args) } });

const PRESENT_TENSE = /^[A-Z][a-z]+ing\b/;
const PAST_CLAIM = /^(Bought|Sent|Created|Saved|Published|Drafted|Revised|Archived|Paused|Restored|Duplicated|Changed|Renamed|Checked|Filed|Added|Moved|Booked|Prepared|Found|Couldn't|Could not|Did not)\b/;

describe("describeStepStart — parity with describeStep", () => {
  it("reads describeStep's cases out of the edge function (the reader works)", () => {
    expect(describeStepCases.length).toBeGreaterThan(60);
    expect(describeStepCases).toContain("comms_buy_number");
    expect(describeStepCases).toContain("web_fetch");
  });

  it("every tool describeStep names has exactly one START decision", () => {
    for (const name of describeStepCases) {
      const decisions = [startNames.includes(name), sameNames.includes(name), noStartNames.includes(name)].filter(Boolean).length;
      expect({ name, decisions }).toEqual({ name, decisions: 1 });
    }
  });

  it("no START decision names a tool describeStep does not know (no stale entries)", () => {
    for (const name of [...startNames, ...sameNames, ...noStartNames]) {
      expect({ name, known: describeStepCases.includes(name) }).toEqual({ name, known: true });
    }
  });
});

describe("describeStepStart — what a START says", () => {
  it("every announced tool gets a present-tense label of at most 60 characters, its finished group, and no detail", () => {
    for (const name of [...startNames, ...sameNames]) {
      const start = describeStepStart(call(name), describeStep);
      expect(start, name).not.toBeNull();
      expect(start.label, name).toMatch(PRESENT_TENSE);
      expect(start.label, name).not.toMatch(PAST_CLAIM);
      expect(start.label.length, name).toBeLessThanOrEqual(60);
      expect(Object.keys(start).sort(), name).toEqual(["group", "label"]);
      expect(start.group, name).toBe(describeStep(call(name), null)!.group);
    }
  });

  it("is never the past-tense claim describeStep would make with no result", () => {
    // The reason this file exists: describeStep(tc, null) on these says the work already happened.
    for (const name of ["comms_buy_number", "agreement_send", "mission_create", "booking_preset_publish", "calendar_link_send"]) {
      expect(describeStep(call(name), null)!.label, name).toMatch(PAST_CLAIM);
      expect(describeStepStart(call(name), describeStep)!.label, name).toMatch(PRESENT_TENSE);
    }
  });

  it("carries no detail even where the finished step quotes the model's own words", () => {
    const query = "PRIVATE-QUERY-MARKER client onboarding";
    expect(describeStep(call("web_search", { query }), null)!.detail).toBe(query);
    expect(describeStepStart(call("web_search", { query }), describeStep)).toEqual({ label: "Searching the web", group: "shared" });
    expect(describeStep(call("deep_research", { question: query }), null)!.detail).toBe(query);
    expect(describeStepStart(call("deep_research", { question: query }), describeStep)).toEqual({ label: "Researching the live web", group: "shared" });
    expect(describeStep(call("comms_buy_number", { phone_number: "+15550100" }), null)!.detail).toBe("+15550100");
    expect(describeStepStart(call("comms_buy_number", { phone_number: "+15550100" }), describeStep)).toEqual({ label: "Buying that number", group: "owner" });
  });

  it("action_file stays fixed and delegation requires a scoped roster", () => {
    expect(describeStepStart(call("action_file", { to_department: "marketing" }), describeStep)).toEqual({ label: "Filing this to Marketing", group: "owner" });
    expect(describeStepStart(call("action_file", { to_department: "client_experience" }), describeStep)).toEqual({ label: "Filing this to Client Experience", group: "client" });
    // A department outside the fixed set falls back, exactly as the finished step does.
    expect(describeStepStart(call("action_file", { to_department: "PRIVATE-DEPT-MARKER" }), describeStep)).toEqual({ label: "Filing this to Owner Ops", group: "owner" });
    expect(describeStepStart(call("delegate_to_subagent", { slug: "research-analyst" }), describeStep)).toEqual({ label: "Bringing in a specialist", group: "shared" });
    expect(describeStepStart(call("delegate_to_subagent", { slug: "made-up" }), describeStep)).toEqual({ label: "Bringing in a specialist", group: "shared" });
  });

  it("never announces a door, web_fetch, an always-refused tool, an undispatched name, or an unknown one", () => {
    for (const name of [...noStartNames, "not_a_tool", "update_client_data", "search_regional_lenders", "marketplace_browse", ""]) {
      expect(describeStepStart(call(name), describeStep), name).toBeNull();
    }
    expect(describeStepStart(null, describeStep)).toBeNull();
    expect(describeStepStart({ function: {} }, describeStep)).toBeNull();
  });

  it("names every door tool describeStep labels as never announced", () => {
    for (const name of ["crm_create_contact", "crm_update_contact", "crm_log_activity", "deal_create", "deal_move_stage", "growth_page_publish", "growth_form_publish"]) {
      expect(noStartNames, name).toContain(name);
    }
  });
});
