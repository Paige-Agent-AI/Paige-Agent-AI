import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// EXP08 team lifecycle — PAIGE acts on the team through the live lifecycle functions
// (migration 20271115040008: suspend, reinstate, remove, the Team conversations switch and the
// departure review) and hands open work over through the existing versioned Work writer.
// Owner rulings: docs/brain/decision-log.md, "EXP08 team lifecycle" (2026-10-26) and "EXP08 PAIGE
// team-lifecycle tools". Ledger: docs/doctrine/tier-matrix.md, "EXP08 team lifecycle".
//
// ONE AUTHORITY, THE DATABASE'S. Every call runs on the asker's own session (the caller JWT, never the
// service role), so auth.uid() is the actor. Each definer re-derives the workspace from
// current_user_tenant_id() and re-proves, in its body, the one rule: an owner acts on any admin or
// member; an admin on members only; nobody on an owner or on themselves. The tenant the chat passes is
// the server-resolved persona tenant, as _expected_tenant_id / p_expected_tenant_id: refusal-only,
// never a selector. Nothing the model passes can name a tenant or an actor.
//
// TWO READS AND FIVE APPROVED WRITES.
//   team.list_members    — public.get_solo_team_workspace: the roster, suspended people included (the
//     team context block lists active people only). Names, ids, access, status, title; never an email.
//   team.member_holdings — public.team_member_holdings: what one person still holds, with the version
//     each hand-over writer needs.
//   team.suspend_member / team.reinstate_member / team.remove_member / team.set_conversations —
//     the four lifecycle definers. `high`: the card is forced on every lane.
//   team.handover_work   — public.plan_update_item_versioned: moves one open piece of Work to another
//     active teammate, guarded by the updated_at the review returned. `high`, like crm_assign_task.
// CRM tasks, client relationships and deals move through the existing CRM tools (crm_assign_task,
// crm_assign_coach, crm_assign_contact_owner, crm_assign_deal_owner); approvals and mailboxes have no
// hand-over writer and are reported, never moved.

const scope = { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] } as const;
const availability = { resolver: "paige-capability-status", states: ["live", "not_for_tier", "unavailable"] } as const;
const writeAvailability = { resolver: "paige-capability-status", states: ["live", "needs_approval", "not_for_tier", "unavailable"] } as const;
const receipt = { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" } as const;
const surface = "/solo/:account/settings/team";
const READ_RAIL = "One available chat read records a capability receipt keyed on the chat tool, never the names or items read. It changes nothing.";
const WRITE_RAIL = "Every outcome of the approved card (done, refused, unknown) records a capability receipt keyed on the chat tool; never a name or an item title.";

const member = { type: "string", format: "uuid", maxLength: 36, description: "The teammate's user_id, exactly as the team context block or team_list_members returned it. Never a name." } as const;

export const TEAM_LIST_MEMBERS_CAPABILITY = defineCapability({
  identity: { id: "team.list_members", version: 1, domain: "team", owner: "paige-team", humanSurface: surface,
    description: "This workspace's team, suspended people included: each person's name, user_id, access (owner, admin or member), status (active or suspended) and title. Never an email address. Read-only." },
  input: objectInputSchema({
    description: "Optional search words and paging.",
    properties: {
      search: { type: "string", maxLength: 80, description: "Optional: part of a name or title to look for." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "How many people to return, 1 to 50. Defaults to 25." },
      offset: { type: "integer", minimum: 0, maximum: 10000, description: "How many to skip, for the next page. Defaults to 0." },
    },
    required: [],
  }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("team.members.read") },
  tenantScope: scope,
  availability,
  providerBinding: { kind: "internal", operation: "public.get_solo_team_workspace", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt,
  outcome: { projector: "capability-record" },
});

export const TEAM_MEMBER_HOLDINGS_CAPABILITY = defineCapability({
  identity: { id: "team.member_holdings", version: 1, domain: "team", owner: "paige-team", humanSurface: surface,
    description: "What one teammate still holds in this workspace: open work, CRM tasks, client relationships, deals, assigned approvals and connected mailboxes, with counts and the exact next step to hand each movable item to someone else. Read-only." },
  input: objectInputSchema({
    description: "Whose holdings to read.",
    properties: { member_user_id: member },
    required: ["member_user_id"],
  }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("team.members.holdings_read") },
  tenantScope: scope,
  availability,
  providerBinding: { kind: "internal", operation: "public.team_member_holdings", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt,
  outcome: { projector: "capability-record" },
});

export const TEAM_SUSPEND_MEMBER_CAPABILITY = defineCapability({
  identity: { id: "team.suspend_member", version: 1, domain: "team", owner: "paige-team", humanSurface: surface,
    description: "Suspend one admin or member of this workspace after the person approves the card: a reversible hold that keeps their seat, records and Team Hub memberships while they cannot use the workspace." },
  input: objectInputSchema({ description: "Who. The person approves exactly this on the card.", properties: { member_user_id: member }, required: ["member_user_id"] }),
  effect: "mutation",
  governance: { actionRiskKey: "team_suspend_member", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("team.members.suspend") },
  tenantScope: scope,
  availability: writeAvailability,
  providerBinding: { kind: "internal", operation: "public.suspend_solo_team_member", connectionResolver: null },
  idempotency: { mode: "required", key: "State-keyed: the definer suspends only an ACTIVE seat and refuses an already-suspended one, so a replayed approval changes nothing. The confirmation claim is the execute-once guard.",
    readback: "public.suspend_solo_team_member reads back the stored status (caller JWT) and raises unless it is suspended", replay: "reconcile_then_return" },
  receipt,
  outcome: { projector: "capability-record" },
});

export const TEAM_REINSTATE_MEMBER_CAPABILITY = defineCapability({
  identity: { id: "team.reinstate_member", version: 1, domain: "team", owner: "paige-team", humanSurface: surface,
    description: "Reinstate one suspended admin or member of this workspace after the person approves the card: their access comes back as it was." },
  input: objectInputSchema({ description: "Who. The person approves exactly this on the card.", properties: { member_user_id: member }, required: ["member_user_id"] }),
  effect: "mutation",
  governance: { actionRiskKey: "team_reinstate_member", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("team.members.reinstate") },
  tenantScope: scope,
  availability: writeAvailability,
  providerBinding: { kind: "internal", operation: "public.reinstate_solo_team_member", connectionResolver: null },
  idempotency: { mode: "required", key: "State-keyed: the definer reinstates only a SUSPENDED seat and refuses an active one, so a replayed approval changes nothing. The confirmation claim is the execute-once guard.",
    readback: "public.reinstate_solo_team_member reads back the stored status (caller JWT) and raises unless it is active", replay: "reconcile_then_return" },
  receipt,
  outcome: { projector: "capability-record" },
});

export const TEAM_REMOVE_MEMBER_CAPABILITY = defineCapability({
  identity: { id: "team.remove_member", version: 1, domain: "team", owner: "paige-team", humanSurface: surface,
    description: "Remove one admin or member from this workspace after the person approves a card that says what they still hold. Deletes the membership only; authored records and history stay." },
  input: objectInputSchema({ description: "Who. The person approves exactly this on the card.", properties: { member_user_id: member }, required: ["member_user_id"] }),
  effect: "mutation",
  governance: { actionRiskKey: "team_remove_member", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("team.members.remove") },
  tenantScope: scope,
  availability: writeAvailability,
  providerBinding: { kind: "internal", operation: "public.remove_solo_team_member", connectionResolver: null },
  idempotency: { mode: "required", key: "State-keyed: a removed seat no longer exists, so a replay is refused (not on the team) and removes nothing. The confirmation claim is the execute-once guard.",
    readback: "public.remove_solo_team_member checks ROW_COUNT = 1 inside its transaction and returns the removed membership id (caller JWT)", replay: "reconcile_then_return" },
  receipt,
  outcome: { projector: "capability-record" },
});

export const TEAM_SET_CONVERSATIONS_CAPABILITY = defineCapability({
  identity: { id: "team.set_conversations", version: 1, domain: "team", owner: "paige-team", humanSurface: surface,
    description: "Turn one admin or member's Team conversations (Team Hub channels and direct messages) on or off after the person approves the card. Off removes no membership and leaves their assigned work alone." },
  input: objectInputSchema({
    description: "Who, and on or off. The person approves exactly this on the card.",
    properties: { member_user_id: member, on: { type: "boolean", description: "true to turn Team conversations on, false to turn them off." } },
    required: ["member_user_id", "on"],
  }),
  effect: "mutation",
  governance: { actionRiskKey: "team_set_conversations", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("team.members.conversations") },
  tenantScope: scope,
  availability: writeAvailability,
  providerBinding: { kind: "internal", operation: "public.set_solo_team_member_team_hub_access", connectionResolver: null },
  idempotency: { mode: "required", key: "Value-keyed: setting the value it already has writes nothing and returns changed:false, so a replayed approval converges. The confirmation claim is the execute-once guard.",
    readback: "public.set_solo_team_member_team_hub_access returns the stored value and whether it changed (caller JWT)", replay: "reconcile_then_return" },
  receipt,
  outcome: { projector: "capability-record" },
});

export const TEAM_HANDOVER_WORK_CAPABILITY = defineCapability({
  identity: { id: "team.handover_work", version: 1, domain: "team", owner: "paige-team", humanSurface: surface,
    description: "Hand one open piece of work a teammate holds to another active teammate after the person approves the card. Its status and due date stay as they are." },
  input: objectInputSchema({
    description: "Which piece of work, the version read, and who receives it.",
    properties: {
      item_id: { type: "string", format: "uuid", maxLength: 36, description: "The work item's id, exactly as team_member_holdings returned it." },
      expected_updated_at: { type: "string", minLength: 10, maxLength: 64, description: "The item's updated_at, exactly as team_member_holdings returned it." },
      assigned_to_user_id: { type: "string", format: "uuid", maxLength: 36, description: "The active teammate who receives it, as a user_id from the team context block or team_list_members." },
    },
    required: ["item_id", "expected_updated_at", "assigned_to_user_id"],
  }),
  effect: "mutation",
  governance: { actionRiskKey: "team_handover_work", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("team.members.handover_work") },
  tenantScope: scope,
  availability: writeAvailability,
  providerBinding: { kind: "internal", operation: "public.plan_update_item_versioned", connectionResolver: null },
  idempotency: { mode: "required", key: "Version-keyed: p_expected_updated_at is the row's updated_at at review; the definer raises PLAN_WORK_CHANGED (40001) once the row has moved, so a replayed approval cannot move it twice. The confirmation claim is the execute-once guard.",
    readback: "public.plan_update_item_versioned returns ok, item_id, tenant_id and actor_id (caller JWT), checked against the request", replay: "reconcile_then_return" },
  receipt,
  outcome: { projector: "capability-record" },
});

const read = (key: string, executor: string, chatTool: string, seatAuthority: "member" | "door-seat", idempotency: string) => ({
  key, domain: "team", owner: "paige-team", humanSurface: surface, readiness: "none",
  action: { classification: "read", executor, chatTool, seatAuthority, riskPolicyKey: "read_only", approvalAuthority: "none", idempotency },
  outcome: { kinds: ["available", "needs_input", "refused", "unavailable"], projector: executor, railVisibility: READ_RAIL },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
}) as const satisfies SpineCapability;
const write = (key: string, executor: string, chatTool: string, idempotency: string) => ({
  key, domain: "team", owner: "paige-team", humanSurface: surface, readiness: "none", selfDescribe: true,
  action: { classification: "mutate", executor, chatTool, seatAuthority: "door-seat", riskPolicyKey: "high", approvalAuthority: "chat-canonical", idempotency },
  outcome: { kinds: ["capability_run"], projector: "public.record_capability_run", railVisibility: WRITE_RAIL },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
}) as const satisfies SpineCapability;

// Seat authority declares the EXISTING admission each definer enforces: the roster admits any active
// seat; the review and every write admit only an active owner/admin seat in the acting workspace
// (door-seat), so a person without one hears it before any card rather than after approving one.
export const TEAM_LIST_MEMBERS = read("team.list_members", "public.get_solo_team_workspace", "team_list_members", "member",
  "Original caller JWT; the definer derives the workspace from current_user_tenant_id(), requires an active seat there and writes nothing. The chat refuses a roster whose tenant is not the persona tenant.");
export const TEAM_MEMBER_HOLDINGS = read("team.member_holdings", "public.team_member_holdings", "team_member_holdings", "door-seat",
  "Original caller JWT and the server-resolved tenant as _expected_tenant_id (refusal-only); the definer re-proves owner/admin authority over that person and writes nothing.");
export const TEAM_SUSPEND_MEMBER = write("team.suspend_member", "public.suspend_solo_team_member", "team_suspend_member",
  "State-keyed: only an active seat is suspended, a replay is refused and changes nothing; caller JWT, so auth.uid() is the actor. Server tenant as _expected_tenant_id. Never from Live or a standing grant (high).");
export const TEAM_REINSTATE_MEMBER = write("team.reinstate_member", "public.reinstate_solo_team_member", "team_reinstate_member",
  "State-keyed: only a suspended seat is reinstated, a replay is refused and changes nothing; caller JWT. Server tenant as _expected_tenant_id. Never from Live or a standing grant (high).");
export const TEAM_REMOVE_MEMBER = write("team.remove_member", "public.remove_solo_team_member", "team_remove_member",
  "State-keyed: a removed seat is gone, so a replay is refused (not on the team) and removes nothing; caller JWT. Server tenant as _expected_tenant_id. The card states what the person still holds. Never from Live or a standing grant (high).");
export const TEAM_SET_CONVERSATIONS = write("team.set_conversations", "public.set_solo_team_member_team_hub_access", "team_set_conversations",
  "Value-keyed: setting the current value writes nothing (changed:false); caller JWT. Server tenant as _expected_tenant_id. Never from Live or a standing grant (high).");
export const TEAM_HANDOVER_WORK = write("team.handover_work", "public.plan_update_item_versioned", "team_handover_work",
  "Version-keyed on p_expected_updated_at (PLAN_WORK_CHANGED, 40001, once the row moved); p_expected_actor_id is the caller and p_expected_tenant_id the server tenant; caller JWT. Status and due date are sent as null, which the writer reads as unchanged. Never from Live or a standing grant (high).");

export const TEAM_LIFECYCLE_CAPABILITIES = [TEAM_LIST_MEMBERS, TEAM_MEMBER_HOLDINGS, TEAM_SUSPEND_MEMBER, TEAM_REINSTATE_MEMBER, TEAM_REMOVE_MEMBER, TEAM_SET_CONVERSATIONS, TEAM_HANDOVER_WORK] as const;

const RULE = "The database decides who may do this: the owner acts on admins and members, an admin acts on members only, and nobody acts on the owner or on themselves. If they are not allowed, say so plainly; do not look for another way round it.";

// Model-facing tool JSON, authored COMPACT (`name:"…"` never alone on its own line) so
// chat-tool-registry-lint does not count it as a hand-wired Chat tool: it enters Chat through the
// adapter spread. A write tool's parameters are a fresh copy, because the chat adds its `confirm`
// property to every gated tool and a declaration's own input is frozen.
const writable = (schema: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(schema));
export const TEAM_LIFECYCLE_READ_TOOLS = [
  {type:"function" as const,function:{name:"team_list_members",description:"This workspace's team as the server sees it now, INCLUDING suspended people, whom the team context block leaves out: each person's name, user_id, access (owner, admin or member), status (active or suspended) and title. Use it to find someone to reinstate, or anyone you cannot see in the team context block. Never shows email addresses. Read-only.",parameters:TEAM_LIST_MEMBERS_CAPABILITY.input}},
  {type:"function" as const,function:{name:"team_member_holdings",description:`What one teammate still holds here: open work, CRM tasks, client relationships, deals, approvals assigned to them and their connected mailboxes, with true counts. Read it BEFORE proposing to suspend or remove someone, tell the person what they hold, and offer to hand it over first. Every movable item comes with the exact tool and arguments to hand it over; fill in the receiver's user_id and use them as given, one card per item. Approvals and mailboxes cannot be handed over; say so. ${RULE} Read-only.`,parameters:TEAM_MEMBER_HOLDINGS_CAPABILITY.input}},
];
export const TEAM_LIFECYCLE_WRITE_TOOLS = [
  {type:"function" as const,function:{name:"team_suspend_member",description:`Suspend a teammate: a reversible hold. They keep their seat, assigned work, records and Team Hub memberships, but cannot use this workspace until reinstated. Read team_member_holdings first and offer to hand their work over. Nothing happens until the person approves the card, and it never runs from voice. ${RULE} Never say it is done until this reports success.`,parameters:writable(TEAM_SUSPEND_MEMBER_CAPABILITY.input)}},
  {type:"function" as const,function:{name:"team_reinstate_member",description:`Reinstate a suspended teammate: their access comes back as it was. Suspended people are not in the team context block; find their user_id with team_list_members. Nothing happens until the person approves the card. ${RULE} Never say it is done until this reports success.`,parameters:writable(TEAM_REINSTATE_MEMBER_CAPABILITY.input)}},
  {type:"function" as const,function:{name:"team_remove_member",description:`Remove a teammate from this workspace for good: their seat is deleted and they lose access at once; their authored records and history stay, and anything still assigned to them stays assigned to them. ALWAYS read team_member_holdings first, tell the person what they still hold and offer to hand it over BEFORE proposing removal; suspending is the reversible alternative. Bringing them back means a new invitation. Nothing happens until the person approves the card, which states what they still hold. ${RULE} Never say it is done until this reports success.`,parameters:writable(TEAM_REMOVE_MEMBER_CAPABILITY.input)}},
  {type:"function" as const,function:{name:"team_set_conversations",description:`Turn a teammate's Team conversations on or off. Off: they cannot read or post in any Team Hub channel or direct message; nothing is deleted and their assigned work is untouched. On: they rejoin every open team channel and keep the private ones they had. Nothing happens until the person approves the card. ${RULE} Never say it is done until this reports success.`,parameters:writable(TEAM_SET_CONVERSATIONS_CAPABILITY.input)}},
  {type:"function" as const,function:{name:"team_handover_work",description:`Hand one open piece of work (from team_member_holdings) to another active teammate. Use the item_id and expected_updated_at exactly as team_member_holdings returned them. Its status and due date stay as they are. CRM tasks, clients and deals are not this tool; use the tool team_member_holdings names for each. Nothing happens until the person approves the card. If it says the work changed, read team_member_holdings again; never retry with an old version. Never say it is done until this reports success.`,parameters:writable(TEAM_HANDOVER_WORK_CAPABILITY.input)}},
];
export const TEAM_LIFECYCLE_TOOLS = [...TEAM_LIFECYCLE_READ_TOOLS, ...TEAM_LIFECYCLE_WRITE_TOOLS];
export const TEAM_LIFECYCLE_READ_TOOL_NAMES: ReadonlySet<string> = new Set(TEAM_LIFECYCLE_READ_TOOLS.map((t) => t.function.name));
export const TEAM_LIFECYCLE_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(TEAM_LIFECYCLE_WRITE_TOOLS.map((t) => t.function.name));
/** The writes whose card names one teammate by member_user_id (the hand-over names its receiver). */
export const TEAM_LIFECYCLE_MEMBER_TOOL_NAMES: ReadonlySet<string> = new Set(["team_suspend_member", "team_reinstate_member", "team_remove_member", "team_set_conversations"]);
