import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// Marketing from chat (INT-298 MBC slice 6c): PAIGE reads a campaign's steps, plans one, records what came of
// a finished step and judges it against its aim; and she reads or sets which form or campaign starts a
// form-started process. Every call runs the SAME functions the Campaigns dossier calls
// (configure_campaign_brief_actions / get_campaign_brief_actions, 20271021200000 + 20271022100000) or the
// process-scope seam (configure_process_scope / get_process_scope, 20271022100000), on the signed-in person's
// own session, so the database decides who may: the business's owner or an admin (or the platform owner).
// There is no chat-only step store, no second action ledger and no Marketing execution engine: a step IS a
// `paige_actions` row filed through `file_action` at `confirm`.
//
// WHAT THE WRITES ARE.
//  · Plan: one record-only step (`marketing.campaign_action`) on a campaign. It waits for the owner's approval
//    on the action list; approving it records it. Nothing is drafted, sent, published or spent. `ordinary`.
//  · Record a result / judge it: what the owner said happened, on a step a run or an approval finished (or one
//    that failed), and a met / partly met / not met verdict. In-business statements, never measured figures.
//    `ordinary`.
//  · Set a process's scope: which form(s) or campaign start a form-started process. It never switches a
//    process on, but re-scoping a live one changes which submissions run it, so it is `high`: the chat always
//    asks first, whatever autonomy the owner has given (risk clamp).
//
// The model-facing tool JSON and the dispatcher live in _shared/campaign-steps-chat.ts.

const scope = { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] } as const;
const availability = { resolver: "paige-capability-status", states: ["live", "needs_approval", "not_for_tier", "unavailable"] } as const;
const receipt = { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" } as const;
const surface = "/solo/:account/growth/campaigns";
const uuid = { type: "string", format: "uuid" } as const;
const words = (max: number) => ({ type: "string", maxLength: max }) as const;
export const STEP_KINDS = ["email", "social", "page", "form", "funnel", "content", "ads", "event", "outreach", "sales_handoff", "other"] as const;
export const VERDICTS = ["met", "partly_met", "not_met"] as const;

export const CAMPAIGN_STEPS_READ_CAPABILITY = defineCapability({
  identity: { id: "campaign_steps.read", version: 1, domain: "marketing_actions", owner: "marketing", humanSurface: surface,
    description: "Read a campaign's steps (or every live campaign's) with each step's real state from the action list, its aim, any recorded result and its judgement." },
  input: objectInputSchema({
    description: "Which campaign.",
    properties: { campaign_id: { ...uuid, description: "A campaign id. Leave it out to read every live campaign's steps." } },
    required: [],
  }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("campaign_steps.list.read") },
  tenantScope: scope, availability,
  providerBinding: { kind: "internal", operation: "public.read_campaign_steps", connectionResolver: null },
  idempotency: { mode: "not_applicable" }, receipt, outcome: { projector: "capability-record" },
});

export const CAMPAIGN_STEP_PLAN_CAPABILITY = defineCapability({
  identity: { id: "campaign_step_plan", version: 1, domain: "marketing_actions", owner: "marketing", humanSurface: surface,
    description: "Plan one step on a campaign: it goes on the action list waiting for the owner's approval. Nothing is drafted, sent, published or spent." },
  input: objectInputSchema({
    description: "The step to plan.",
    properties: {
      campaign_id: { ...uuid, description: "The campaign this step carries out." },
      step: { ...words(200), description: "What the step is, in the owner's words, e.g. \"Invite past clients to the spring intake\"." },
      tactic: { ...words(120), description: "The tactic it belongs to, e.g. \"Win-back email\". Reuse a tactic the campaign already has when it fits." },
      kind: { type: "string", enum: STEP_KINDS, description: "What kind of step it is." },
      due_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Optional day it is due, YYYY-MM-DD." },
      aim: { ...words(500), description: "Optional: what the owner expects it to achieve, e.g. \"Ten replies\"." },
    },
    required: ["campaign_id", "step", "tactic", "kind"],
  }),
  effect: "mutation",
  governance: { actionRiskKey: "campaign_step_plan", risk: "ordinary", approval: "confirm", requiredPermission: ownerGrantablePermission("campaign_step_plan.execute") },
  tenantScope: scope, availability,
  providerBinding: { kind: "internal", operation: "public.configure_campaign_brief_actions", connectionResolver: null },
  idempotency: { mode: "required", key: "Derived from the business, the person, the conversation and the step as asked: the same step asked again in the same conversation returns the step already planned.", readback: "public.read_campaign_steps", replay: "return_recorded_result" },
  receipt, outcome: { projector: "capability-record" },
});

export const CAMPAIGN_STEP_RECORD_RESULT_CAPABILITY = defineCapability({
  identity: { id: "campaign_step_record_result", version: 1, domain: "marketing_actions", owner: "marketing", humanSurface: surface,
    description: "Record what the owner said happened on a finished campaign step, as stated; never a measured figure." },
  input: objectInputSchema({
    description: "The step and what happened.",
    properties: {
      campaign_id: uuid, step_id: { ...uuid, description: "A step id from read_campaign_steps." },
      what_happened: { ...words(500), description: "What happened, in the owner's words." },
      figure: { type: "number", description: "Optional number the owner gave, e.g. 12. Only a number the owner wrote in this conversation." },
    },
    required: ["campaign_id", "step_id", "what_happened"],
  }),
  effect: "mutation",
  governance: { actionRiskKey: "campaign_step_record_result", risk: "ordinary", approval: "confirm", requiredPermission: ownerGrantablePermission("campaign_step_record_result.execute") },
  tenantScope: scope, availability,
  providerBinding: { kind: "internal", operation: "public.configure_campaign_brief_actions", connectionResolver: null },
  idempotency: { mode: "required", key: "Derived from the business, the person, the conversation and the result as stated; the same result again returns the one recorded.", readback: "public.read_campaign_steps", replay: "return_recorded_result" },
  receipt, outcome: { projector: "capability-record" },
});

export const CAMPAIGN_STEP_JUDGE_CAPABILITY = defineCapability({
  identity: { id: "campaign_step_judge", version: 1, domain: "marketing_actions", owner: "marketing", humanSurface: surface,
    description: "Judge a step's recorded result against its aim as met, partly met or not met, as the owner decided." },
  input: objectInputSchema({
    description: "The step and the judgement.",
    properties: {
      campaign_id: uuid, step_id: { ...uuid, description: "A step id from read_campaign_steps." },
      verdict: { type: "string", enum: VERDICTS, description: "The owner's judgement." },
      note: { ...words(500), description: "Optional reason, in the owner's words." },
    },
    required: ["campaign_id", "step_id", "verdict"],
  }),
  effect: "mutation",
  governance: { actionRiskKey: "campaign_step_judge", risk: "ordinary", approval: "confirm", requiredPermission: ownerGrantablePermission("campaign_step_judge.execute") },
  tenantScope: scope, availability,
  providerBinding: { kind: "internal", operation: "public.configure_campaign_brief_actions", connectionResolver: null },
  idempotency: { mode: "required", key: "Derived from the business, the person, the conversation and the judgement; a step is judged once, and the same judgement again returns it.", readback: "public.read_campaign_steps", replay: "return_recorded_result" },
  receipt, outcome: { projector: "capability-record" },
});

export const PROCESS_SCOPE_READ_CAPABILITY = defineCapability({
  identity: { id: "process_scope.read", version: 1, domain: "marketing_actions", owner: "marketing", humanSurface: surface,
    description: "Read which form or campaign starts a form-started process, by name, and whether it can be switched on." },
  input: objectInputSchema({
    description: "Which process.",
    properties: { process_id: { ...uuid, description: "A process id from automation_list." } },
    required: ["process_id"],
  }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("process_scope.read") },
  tenantScope: scope, availability,
  providerBinding: { kind: "internal", operation: "public.read_process_scope", connectionResolver: null },
  idempotency: { mode: "not_applicable" }, receipt, outcome: { projector: "capability-record" },
});

export const PROCESS_SCOPE_SET_CAPABILITY = defineCapability({
  identity: { id: "process_scope_set", version: 1, domain: "marketing_actions", owner: "marketing", humanSurface: surface,
    description: "Set which form or forms, or which campaign, start a form-started process. It never switches the process on." },
  input: objectInputSchema({
    description: "Exactly one of form_ids or campaign_id.",
    properties: {
      process_id: { ...uuid, description: "A process id from automation_list." },
      form_ids: { type: "array", minItems: 1, maxItems: 50, items: uuid, description: "The forms that start it. Give this or campaign_id, not both." },
      campaign_id: { ...uuid, description: "A campaign: the process runs only for forms attached to it. Give this or form_ids, not both." },
    },
    required: ["process_id"],
  }),
  effect: "mutation",
  governance: { actionRiskKey: "process_scope_set", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("process_scope_set.execute") },
  tenantScope: scope, availability,
  providerBinding: { kind: "internal", operation: "public.configure_process_scope", connectionResolver: null },
  idempotency: { mode: "required", key: "Convergent: setting the same scope again writes the same condition (the seam replaces any earlier scope), so a retry never adds a second one.", readback: "public.read_process_scope", replay: "reconcile_then_return" },
  receipt, outcome: { projector: "capability-record" },
});

const entry = (key: string, chatTool: string, classification: "read" | "mutate", executor: string, risk: "read_only" | "ordinary" | "high",
  seat: "member" | "workspace-admin", kinds: readonly string[], projector: string, railVisibility: string, idempotency: string): SpineCapability => ({
  key, domain: "marketing_actions", owner: "marketing", humanSurface: surface, readiness: "none",
  action: { classification, executor, chatTool, seatAuthority: seat, riskPolicyKey: risk, approvalAuthority: classification === "read" ? "none" : "chat-canonical", idempotency },
  outcome: { kinds, projector, railVisibility },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
});

export const MARKETING_ACTION_CAPABILITIES: readonly SpineCapability[] = [
  entry("marketing_actions.steps_read", "read_campaign_steps", "read", "public.read_campaign_steps", "read_only", "member",
    ["available", "refused"], "public.read_campaign_steps", "Read only; no Rail write. A member reads states without step names.",
    "Read-only on the caller's own session; the active business is checked before and after."),
  entry("marketing_actions.step_plan", "campaign_step_plan", "mutate", "public.configure_campaign_brief_actions", "ordinary", "workspace-admin",
    ["planned", "refused", "needs_input", "outcome_unknown"], "public.read_campaign_steps",
    "Recorded after a fresh read shows the step on the campaign; nothing is drafted, sent or published, and it waits for approval.",
    "Keyed to the business, person, conversation and step as asked; a replay returns the step already planned."),
  entry("marketing_actions.step_record_result", "campaign_step_record_result", "mutate", "public.configure_campaign_brief_actions", "ordinary", "workspace-admin",
    ["recorded", "refused", "needs_input", "outcome_unknown"], "public.read_campaign_steps",
    "Recorded after a fresh read shows the result on the step, as stated; never a measured figure.",
    "Keyed to the business, person, conversation and result; a replay returns the result recorded."),
  entry("marketing_actions.step_judge", "campaign_step_judge", "mutate", "public.configure_campaign_brief_actions", "ordinary", "workspace-admin",
    ["judged", "refused", "outcome_unknown"], "public.read_campaign_steps",
    "Recorded after a fresh read shows the verdict on the step.",
    "Keyed to the business, person, conversation and verdict; a step is judged once."),
  entry("marketing_actions.process_scope_read", "read_process_scope", "read", "public.read_process_scope", "read_only", "member",
    ["available", "refused"], "public.read_process_scope", "Read only; no Rail write.",
    "Read-only on the caller's own session; the active business is checked before and after."),
  entry("marketing_actions.process_scope_set", "process_scope_set", "mutate", "public.configure_process_scope", "high", "workspace-admin",
    ["scoped", "refused", "needs_input", "outcome_unknown"], "public.read_process_scope",
    "Recorded after a fresh read shows the process scoped as asked; it never switches a process on.",
    "Convergent: the seam replaces any earlier scope; the Chat confirmation fingerprint is the execute-once guard."),
];
