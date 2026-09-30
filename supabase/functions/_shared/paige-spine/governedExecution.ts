/**
 * THE SHARED GOVERNED EXECUTION SEAM — one pathway, whichever door knocked.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Everything PAIGE may perform is governed today by a sequence that lives INLINE in the Chat
 * handler: classify the action, clamp the autonomy lane, refuse `owner_only`, refuse an
 * unclassified mutation, then spend a server-held proposal. That sequence is correct. Its problem
 * is its address: it is a run of statements in one 8,000-line function, so it is reachable by
 * exactly one caller. Every other caller — an automation, an agent, a skill, a future MCP surface —
 * either re-implements it, or does without it.
 *
 * Doing without it is not hypothetical. `paige-mcp` ships 118 tools (117 when this was written;
 * two were added since, and a count in prose rots silently — `MCP_TOOL_COUNT` is now CI-asserted),
 * imports neither
 * `action-risk.ts` nor `toolConfirmation.ts`, never calls `resolve_tool_autonomy`, and until
 * 2026-09-02 hard-deleted client records on a boolean the model wrote (#784). It was not built
 * carelessly; it was built where the gate could not be reached.
 *
 * So this module is the sequence, extracted as a decision, callable by anyone.
 *
 * THE ONE PROPERTY THAT MATTERS
 * -----------------------------
 * **No caller gains permission by arriving through a different door.** `door` is recorded for the
 * audit line and is read NOWHERE else in this file — there is no branch on it, and a test asserts
 * that every door produces byte-identical decisions for identical inputs. A CI guard asserts the
 * absence of such a branch, because a property proven only by a test is a property a later edit can
 * quietly remove.
 *
 * THE CAPABILITY-STATUS GATE — THE SAME PROPERTY, EXTENDED FROM THE ACT TO ITS AVAILABILITY
 * -----------------------------------------------------------------------------------------
 * Door-blindness stops a caller gaining permission by arriving differently. It does NOT, on its
 * own, stop a caller reaching a capability the product has decided this tenant cannot use — because
 * "what this tenant may do right now" (tier, connection, a shipped seam, present evidence) lived
 * only in the Capability Gateway that decides what to expose to Chat. A capability the Gateway
 * hides from Chat stayed reachable from an MCP client, a durable job, or a delegated subagent,
 * since none of them asked the Gateway and nothing here re-checked. `decideGovernedExecution` is
 * where every door converges, so the re-check belongs here: `capability.availability` is resolved
 * by the SAME capability-status composition the Gateway uses, and a capability that is
 * `needs_setup` / `planned` / `not_for_tier` / `unavailable` refuses at step 5.5 through every
 * door, byte-identically — the door-blind property applied to the act's availability rather than
 * to the act. A delegated specialist therefore inherits no standing: it re-passes the decision at
 * execution, and the status is re-resolved for its tenant, not carried from whoever delegated it.
 *
 * HONEST ABOUT ADOPTION (§13). The gate enforces only as far as its callers re-resolve the status.
 * The field is OPTIONAL and does NOT fail closed on absence — the one field here that does not —
 * because the dimension is being adopted incrementally and refusing every un-migrated caller would
 * be an outage. Absent, or the explicit `"unknown"`, means "not re-resolved": the gate is a no-op
 * and NOT a claim of availability. The MCP door declares `"unknown"` today (its reads are unchanged,
 * its mutations already refuse structurally); wiring the real resolution into MCP, durable jobs and
 * subagent execution is named, sequenced follow-up, not something this slice claims as done.
 *
 * IT CONSUMES AN APPROVAL RESULT. IT NEVER PRODUCES ONE.
 * ------------------------------------------------------
 * This module does NOT call `decideToolConfirmation`, and must not: that gate (#711) is superseded
 * and unwired, a CI rule refuses any adoption of it, and an earlier version of this header said the
 * approve/deny call was delegated to it — the exact opposite instruction to what the code does and
 * what the doctrine requires.
 *
 * What actually happens: an approval is REQUIRED to reach this seam already redeemed — the result of
 * the adapter's atomic single-use claim, carried in `GovernedApproval` as the stored arguments plus
 * the capability they were approved for.
 *
 * **"Already redeemed" is an adapter OBLIGATION, exactly like the tenancy assertion below, and for
 * the same reason: the seam has no evidence the claim happened.** `readClaim` proves only that the
 * value is a plain object, and the execute branch proves only that `claimedFor` matches. So
 * `{ claimedArgs: request.args, claimedFor: capability.id }` built from request data is accepted and
 * executed. An adapter that fabricates the claim result defeats this boundary, and no check here
 * can catch it — writing "arrives already redeemed" as though the seam established it would invite
 * precisely the trust this module exists to withhold.
 *
 * This module validates that result — the shape, the capability binding, and that stored arguments
 * are what execute — and classification is delegated
 * to `classifyAction`, unchanged. It adds only the layers that were previously inline and therefore
 * unavailable: identity, the tenancy assertion, capability identity, access, the clamp, the
 * fail-closed refusals, and a structured audit record. Adding a second way to PROVE approval is the
 * failure `docs/doctrine/one-approval-gate.md` exists to stop, and it is not what this is.
 *
 * WHY THIS SEAM IS STRICTER THAN CHAT, AND WHY THAT IS THE SAFE DIRECTION
 * ----------------------------------------------------------------------
 * Chat currently has two ways to redeem an approval. Channel 1 is a fingerprint the surface echoes
 * in the request BODY, which the model cannot write to. Channel 2 tolerates the model's own
 * `confirm: true` for non-`high` actions, because five of Chat's six surfaces render no approval
 * card and a rule only one caller can obey is an outage rather than a rule.
 *
 * **This seam carries Channel 1 forward and does not carry Channel 2.** It has no boolean input at
 * all: the only thing that can turn a `confirm` lane into an execution is a `claimedArgs` that is a
 * plain object together with a `claimedFor` equal to the declared capability. That is the STRUCTURE
 * of a redeemed claim, and it is all this module verifies — whether an atomic single-use redemption
 * actually happened is the adapter's obligation, exactly as the caveat above says. Stating it as
 * "a successful atomic claim" here described provenance the seam cannot see, which is the same
 * overstatement this file has now corrected on all four inputs. That is deliberate and it is
 * one-directional — the shared path is at
 * least as strict as Chat for every action, and stricter for `ordinary` ones. Chat's inline
 * sequence is untouched by this slice, so nothing a person can do today changes; Channel 2 stays a
 * Chat-local tolerance with a known reason, and it does not become the platform's contract.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DEFINE
 * -------------------------------------------
 * The durable outcome interface belongs to the Rail workstream. This seam REQUIRES a mutating
 * capability to name an outcome channel and refuses when one is absent — which records the
 * dependency and fails closed — but the shape of what travels on that channel is not defined here
 * and must not be invented here.
 *
 * PURITY
 * ------
 * No I/O, no Deno globals, no clock, no randomness. The caller resolves the facts — who is
 * authenticated, which tenant the SERVER derived, what the access policy said, what the atomic
 * claim returned — and this decides. That keeps it exercisable from `src/**` vitest exactly as
 * `toolConfirmation.ts` is, and it keeps the decision reviewable as one readable function.
 */
import { classifyAction, riskReason, unclassifiedWriteReason, type ActionRisk } from "../action-risk.ts";
// TYPE-ONLY, deliberately. The one home for "what can this tenant do with this capability right
// now" is the capability-status resolver (§18); the seam borrows its vocabulary so the gate below
// and the resolver can never disagree about what `needs_setup` means. No runtime value crosses this
// import — the availability is an ADAPTER ASSERTION like every other field on the boundary, and the
// seam has no signal gatherer of its own to produce one.
import type { CapabilityAvailability } from "../paige-capability-status/resolver.ts";

// DELIBERATELY NOT IMPORTED: `../toolConfirmation.ts`.
//
// That module (#711) is a pure `decideToolConfirmation` over a `{ ok, reason }` claim, and it is
// the obvious thing to delegate to. It is also, by the Chat handler's own merge note at
// `paige-ai-chat/index.ts:7922`, "in the tree UNWIRED" — superseded on 2026-09-02 by the inline
// sequence over `paige_pending_confirmations`, which is a superset: it executes the STORED
// arguments rather than re-running what the model re-authored, and it proves the proposal predates
// the turn by REQUEST identity rather than by a timestamp.
//
// So importing it would wrap the mechanism production does NOT use, and would quietly promote a
// superseded design to the platform's shared contract — which is an approval-semantics change, and
// those belong to the Chat build. This seam therefore models the LIVE contract, whose whole shape
// is: an atomic claim returns the stored arguments, or null.

/** Which surface called. Recorded for audit. Never read by a decision — that is the whole point. */
export type GovernedDoor = "chat" | "automation" | "agent" | "skill" | "mcp" | "other";

/**
 * Who is asking. **Both `tenantId` and `tenantSource` are populated by the ADAPTER, and the seam
 * cannot tell a server-derived tenant from a request-supplied one.**
 *
 * EVERY FIELD ON THIS BOUNDARY IS AN ADAPTER ASSERTION, NOT A FACT THIS SEAM ESTABLISHES.
 *
 * Read that as the rule for the whole type rather than a caveat on one field, because it was
 * learned one field at a time and that is the expensive way. Each of these passes every check:
 *
 *     { authenticated: true, userId: request.userId }        no credential was verified
 *     { tenantId: request.workspaceId, tenantSource: "server" }   a request naming its own tenant
 *     { access: { allowed: true } }                          no policy was consulted
 *     { autonomyLane: request.lane }                         no workspace setting was resolved
 *     { id: "crm_create_contact", effect: "mutate",
 *       outcomeChannel: "rail" }                             naming a DIFFERENT act than the one
 *                                                            about to run — see GovernedCapability
 *     requestArgs selecting another operation                the fourth input, inline on the
 *                                                            function signature, bound to nothing
 *
 * The seam enforces that a caller MAKES each assertion and refuses without it. Making the assertion
 * TRUE is the adapter's obligation, and nothing here can verify any of them — this module has no
 * credential, no policy engine, no autonomy store and no claim table. It is a decision function
 * over what it is told.
 *
 * So each field below documents what the ADOPTER must establish before setting it. Read them as
 * obligations you are required to honour, never as guarantees you are receiving. An adapter that
 * populates any of them from request data defeats this boundary, and the boundary cannot tell.
 */
export type GovernedCaller = {
  /** ADAPTER MUST: verify a real credential — a JWT signature or an equivalent server-side check
   *  — before setting this. The seam reads the boolean and cannot check what produced it. */
  authenticated: boolean;
  /** ADAPTER MUST: derive this from the verified credential (`auth.uid()`), never from a request
   *  field. Null when there is none. */
  userId: string | null;
  /**
   * WHETHER A PERSON OR A MACHINE IS BEHIND THE CREDENTIAL. Defaults to `"person"`, so an adapter
   * that says nothing gets the stricter reading and nothing already written changes meaning.
   *
   * ADAPTER MUST: set `"service"` only for a verified NON-PERSON credential — a platform API key, a
   * service-role automation, a scheduled job — and `"person"` whenever a human session is behind
   * the call. Setting `"service"` to dodge the identity check for a human session is the assertion
   * failure this whole type is about.
   *
   * WHY IT EXISTS. Four of the six doors this seam declares (`automation`, `agent`, `skill`, `mcp`)
   * routinely have no `auth.uid()` at all, and the identity check below required one — so every
   * one of them was refused `unauthenticated` before it could be adopted. That is not strictness,
   * it is an unusable seam: a machine credential is a real, verified identity, it just is not a
   * person's.
   *
   * WHAT IT DELIBERATELY DOES NOT DO. It grants nothing. A service principal still needs a
   * server-resolved tenant, an access verdict, a classified capability and — for a mutation — the
   * same approval every person needs. The one rule this seam does NOT yet carry is "a machine
   * credential can never be the person whose yes an approval is"; the MCP door enforces that today
   * by refusing every mutation at the door, and the seam-level rule belongs with the slice that
   * makes a mutation executable again. Do not read this field's absence from the mutation path as
   * permission — read it as work that is named and not yet done.
   */
  principal?: "person" | "service";
  /** ADAPTER MUST: resolve this server-side. A request-supplied workspace id here is a
   *  cross-tenant hole the seam cannot see. */
  tenantId: string | null;
  /** How `tenantId` was obtained. Anything but "server" is refused — but "server" is a CLAIM the
   *  adapter makes about its own work, not a property this seam can confirm. */
  tenantSource: "server" | "request" | "unknown";
  /** Audit only. */
  door: GovernedDoor;
  /**
   * The surface's own role/access verdict. This seam does not own the platform's role model (§53
   * tiers, staff roles, scopes differ per surface), so it requires the verdict rather than guessing
   * it — and treats an absent verdict as a refusal, never as permission.
   *
   * ADAPTER MUST: derive `allowed` from the applicable server-side policy. `{ allowed: true }` from
   * a request field or a permissive default passes the only check there is. An earlier version of
   * this comment said "ALREADY EVALUATED", which reads as a guarantee that evaluation happened.
   */
  access?: { allowed: boolean; reason?: string };
};

/**
 * What is being performed. `id` is the canonical action-risk key — the one capability identity.
 *
 * THE SAME RULE AS THE OTHER TWO TYPES, AND THIS ONE IS THE SHARPEST EDGE. An earlier version of
 * this file said the assertion rule was stated "on both exported types". There are three, and the
 * one left out is the one that names the act:
 *
 *     { id: "crm_create_contact", effect: "mutate", outcomeChannel: "rail" }
 *
 * passed to a DELETE executor classifies as ordinary, requires no claim, and auto-executes.
 * `classifyAction` validates the risk mapping for a NAME; it cannot bind that name — or `effect` —
 * to the executor the adapter is actually about to run. And this module has no Rail, so any
 * non-empty `outcomeChannel` satisfies the mutation requirement whether or not a durable outcome
 * is ever emitted.
 */
export type GovernedCapability = {
  /** ADAPTER MUST: pass the canonical `action-risk.ts` key of the act it is ABOUT TO PERFORM. A
   *  mismatched name silently reclassifies the risk, and the seam cannot detect it. */
  id: string;
  /** ADAPTER MUST: state the executor's real effect — and pair it with an honest `id`, because the
   *  two are checked TOGETHER. `effect: "read"` alone does not bypass anything: a classified
   *  mutation name is refused `effect_mismatch`, and an unclassified name that reads as a write is
   *  refused `unclassified_mutation`.
   *
   *  The bypass needs BOTH halves false — an `id` that reaches the read branch, declared `read`
   *  over a mutating executor — which then skips classification, clamp, approval and outcome in
   *  one move. TWO kinds of `id` reach that branch, not one:
   *
   *    - an unclassified name that reads as a query (`unclassifiedWriteReason` returns null
   *      because `MUTATION_VERB` does not match it), and
   *    - an unclassified name on `action-risk.ts`'s `NON_MUTATING_EXEMPT` list, which
   *      `unclassifiedWriteReason` clears BEFORE consulting `MUTATION_VERB` — so a write-shaped
   *      name such as `growth_page_generate` passes too.
   *
   *  Saying the bypass needs a "read-LOOKING" id was therefore wrong in the direction that matters:
   *  it named a smaller set of dangerous descriptors than actually exists. The exempt names are
   *  exempt because the acts they name persist nothing; the hazard is an adapter borrowing one of
   *  them to describe an executor that does. An earlier version of this comment blamed `effect`
   *  alone, overstating the hazard; this one had understated its shape. */
  effect: "read" | "mutate";
  /**
   * Opaque name of the durable outcome channel this mutation reports on. REQUIRED for a mutation.
   * Owned by the Rail workstream; its payload shape is deliberately not defined in this file.
   *
   * ADAPTER MUST: name a channel that actually records the outcome. The seam checks only that the
   * string is present — it has no Rail to ask.
   */
  outcomeChannel?: string;
  /**
   * WHAT THIS TENANT MAY DO WITH THIS CAPABILITY RIGHT NOW, re-resolved at EXECUTION time.
   *
   * This is the dimension that closes the last inheritance gap. The other fields prove WHO is
   * asking and WHAT the act is; this proves the capability is actually usable for this workspace at
   * the moment it runs — tier eligibility, a required connection, a shipped seam, present evidence —
   * the same composition the Capability Gateway uses to decide what to even expose to Chat. Without
   * it, a capability hidden from one door (Chat shows no tool) stays reachable through another (an
   * MCP client, a durable job, a delegated subagent) because nothing at the shared seam re-checks
   * it. With it, the SAME status that hides a capability also refuses it here, through every door,
   * byte-identically — which is "no caller gains permission by arriving a different way," extended
   * from the act to the act's availability.
   *
   * Only `live` and `needs_approval` proceed (the autonomy/approval steps below then decide whether
   * a human's yes is required). `needs_setup`, `planned`, `not_for_tier` and `unavailable` refuse
   * here, before classification, because no approval makes an unbuilt, unconnected, or
   * out-of-tier capability runnable.
   *
   * NOT FAIL-CLOSED ON ABSENCE, and deliberately so — the one field on this boundary that is not.
   * `access` absent is a refusal because every caller already resolves access; the capability-status
   * dimension is being adopted INCREMENTALLY, so refusing every caller that has not yet wired the
   * resolver would be an outage, not a rule. Absent — or the explicit `"unknown"` — therefore means
   * "this caller did not re-resolve status", the gate is a NO-OP, and it is NOT a claim that the
   * capability is available. The MCP door declares `"unknown"` today (its reads are unaffected and
   * its mutations already refuse structurally); wiring the real resolution there, and in durable
   * jobs and subagent execution, is named, sequenced follow-up.
   *
   * ADAPTER SHOULD: resolve this server-side at execution via the capability-status resolver when it
   * can, never cache it from when the tool was exposed, and never take it from request data. A
   * request-supplied `"live"` reaches the execute path exactly like a request-supplied autonomy lane
   * does — the seam recognises the value, not its provenance — so a caller that re-resolves buys the
   * gate's protection, and one that does not simply leaves the gate inert for itself.
   */
  availability?: CapabilityAvailability | "unknown";
};

/**
 * The approval facts, as the server resolved them. There is deliberately no boolean here.
 *
 * `claimedArgs` is the entire approval contract, and it mirrors the live mechanism exactly: the
 * caller performs the atomic compare-and-set against the canonical proposal store and hands over
 * what came back. A successful claim IS the stored arguments — there is no separate "it worked"
 * flag to get out of step with them, so this module never HANDS BACK arguments the approval did
 * not carry.
 *
 * ADAPTER MUST dispatch only a `kind: "execute"` decision, and run exactly `decision.args`.
 * An earlier version of this sentence said there was "no way" to execute an approved action with
 * other arguments, and the doctrine called it "unrepresentable". Both overstated: this module is
 * PURE and owns no executor, so an adapter is free to ignore the decision and run its original
 * `requestArgs`, or to dispatch on a refusal. The sweep that corrected this claim on all four
 * INPUTS never turned around and asked the same question of the OUTPUT, which is where the rule
 * is ultimately kept or broken.
 *
 *   undefined  no approval was attempted
 *   null       an approval was attempted and nothing backed it   (fails closed)
 *   object     the STORED arguments, claimed once, ready to run
 *   ANY OTHER  malformed — refused outright, never coerced (see `readClaim`)
 *
 * The annotation below is a promise the CALLER makes, not a constraint this module can rely on:
 * the value arrives from a database row or parsed JSON, where TypeScript has no reach. So the
 * shape is checked at runtime, and a `true` arriving here is the exact bare boolean the canonical
 * rule forbids as approval — refused loudly rather than quietly treated as absent.
 *
 * AND THE SAME RULE AS `GovernedCaller`: every field here is an adapter assertion. This module has
 * no autonomy store and no claim table, so it cannot check that the lane came from a setting or
 * that any compare-and-set ever ran.
 */
export type GovernedApproval = {
  /** ADAPTER MUST: resolve this from the workspace's autonomy setting server-side. A
   *  request-supplied `"auto"` reaches the execute path on an ordinary mutation with no claim at
   *  all — the seam recognises the VALUE and clamps `high`; it cannot see where the value came
   *  from. */
  autonomyLane: "auto" | "confirm" | "off" | string;
  /** ADAPTER MUST: set this ONLY to the result of a real atomic single-use claim against the
   *  canonical proposal store, and the arguments must be the ones that store held.
   *  `{ claimedArgs: request.args, claimedFor: capability.id }` satisfies `readClaim` and executes.
   *  The redemption is the adapter's to perform and the adapter's to get right. */
  claimedArgs?: Record<string, unknown> | null;
  /**
   * The capability id the claim was redeemed AGAINST, as the caller resolved it.
   *
   * Required whenever `claimedArgs` carries stored arguments, and NOT optional in effect: a stored
   * claim that does not say what it approved is refused. "I do not know which capability this
   * approval was for" is not a weaker form of "it was for this one".
   *
   * Without it the seam honours an approval across capabilities — measured before this existed, an
   * approval a human granted for an ordinary `crm_create_contact` executed a `high`
   * `crm_delete_contact`, because the seam sees only the claim's RESULT and the live mechanism
   * binds tool identity in the fingerprint the caller consumed. That binding has to be restated
   * here or it is lost at exactly the boundary this module exists to be.
   *
   * A string, deliberately, and never a boolean: it names WHAT was approved. It cannot express
   * THAT something was approved, so it is not a second approval channel.
   */
  claimedFor?: string;
};

/**
 * What the caller's claim actually IS, decided by shape rather than by trusting the annotation.
 *
 * `GovernedApproval.claimedArgs` is typed `Record<string, unknown> | null`, but this is a boundary:
 * the value comes back from an atomic claim against the proposal store — a database row, or JSON
 * parsed from one — and a type annotation constrains neither. The live claim helper in the Chat
 * handler already accepts only a non-array object and maps everything else to null; a shared seam
 * that assumed its callers had done the same would be trusting exactly the caller it exists to
 * check.
 *
 * "absent" and "failed" both ask; "malformed" REFUSES rather than degrading to either. A `true`
 * reaching this parameter is the bare boolean the canonical rule forbids as approval, and quietly
 * reading it as "no approval offered" would answer a broken caller with a polite re-ask instead of
 * telling it that it tried to approve with a flag.
 */
type Claim =
  | { state: "absent" }
  | { state: "failed" }
  | { state: "malformed" }
  | { state: "stored"; args: Record<string, unknown> };

function readClaim(value: unknown): Claim {
  if (value === undefined) return { state: "absent" };
  if (value === null) return { state: "failed" };
  if (typeof value !== "object" || Array.isArray(value)) return { state: "malformed" };
  // A PLAIN object, not merely an object. A claim comes back from the proposal store as JSON, so a
  // Date, a Map or a class instance could never be one — and measuring rather than reasoning about
  // this was worth it: `new Fake()` with an own `approved = true` executed, carrying that field
  // through as the stored arguments. Nothing was granted that the caller could not already have
  // passed as a plain object, but "the stored call" has to MEAN the stored call, and a Map whose
  // entries vanish under property access is not one.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return { state: "malformed" };
  return { state: "stored", args: value as Record<string, unknown> };
}

export type GovernedRefusalCode =
  | "tenant_not_server_derived"
  | "unauthenticated"
  | "tenant_unresolved"
  | "capability_unidentified"
  | "access_denied"
  | "capability_not_for_tier"
  | "capability_unavailable"
  | "capability_planned"
  | "capability_needs_setup"
  | "unclassified_mutation"
  | "effect_mismatch"
  | "owner_only"
  | "outcome_channel_undeclared"
  | "service_principal_may_not_mutate"
  | "autonomy_off"
  | "autonomy_lane_unrecognized"
  | "approval_claim_malformed"
  | "approval_claim_capability_mismatch";

/** Every refusal this seam can produce. Exported so a test can prove the list is covered. */
export const GOVERNED_REFUSAL_CODES: readonly GovernedRefusalCode[] = Object.freeze([
  "tenant_not_server_derived", "unauthenticated", "tenant_unresolved", "capability_unidentified",
  "access_denied",
  "capability_not_for_tier", "capability_unavailable", "capability_planned", "capability_needs_setup",
  "unclassified_mutation", "effect_mismatch", "owner_only",
  "service_principal_may_not_mutate",
  "outcome_channel_undeclared", "autonomy_off", "autonomy_lane_unrecognized",
  "approval_claim_malformed", "approval_claim_capability_mismatch",
] as const);

/**
 * The audit line. Carries no arguments and no secrets on purpose — it records what was DECIDED and
 * why, which is what an audit answers, and arguments are the part most likely to hold personal
 * data.
 */
export type GovernedAudit = {
  capability: string;
  effect: "read" | "mutate";
  door: GovernedDoor;
  tenantId: string | null;
  userId: string | null;
  /** Whether a person or a machine credential was behind the call, as the adapter asserted it. */
  principal: "person" | "service";
  risk: ActionRisk | "unclassified";
  laneRequested: string;
  laneEffective: string;
  clamped: boolean;
  decision: "execute" | "propose" | "refuse";
  refusal?: GovernedRefusalCode;
};

export type GovernedDecision =
  /** Run it, with exactly these arguments. */
  | { kind: "execute"; args: unknown; risk: ActionRisk | "unclassified"; audit: GovernedAudit }
  /** Do not run. Mint a proposal and ask. `revalidate` = an approval was asserted and nothing backed it. */
  | { kind: "propose"; revalidate: boolean; risk: ActionRisk | "unclassified"; audit: GovernedAudit }
  /** Do not run, and there is no approval that would change that. */
  | { kind: "refuse"; code: GovernedRefusalCode; message: string; reason: string | null;
      risk: ActionRisk | "unclassified"; audit: GovernedAudit };

/**
 * THE ONE GOVERNED PATHWAY.
 *
 * Order matters and each step fails CLOSED. Read top to bottom: identity, tenancy, capability,
 * access, classification, outcome, autonomy, approval, arguments.
 */
export function decideGovernedExecution(input: {
  caller: GovernedCaller;
  capability: GovernedCapability;
  approval: GovernedApproval;
  /**
   * The arguments the caller wants to run. Never used on an APPROVED path — that path runs
   * `approval.claimedArgs`, which is the whole point of storing them.
   *
   * On a MUTATION they are used only on an `auto` lane. On a genuine READ they are used on EVERY
   * lane, because step 6 returns before step 8 ever validates one: a read declared `confirm`,
   * `off`, or an unrecognised lane still executes. That is deliberate rather than an oversight —
   * an autonomy lane governs acts, and a read changes nothing for it to govern — but it is stated
   * here because the earlier "ONLY on an `auto` lane" made a non-auto lane look like a brake on
   * reads that it is not. If a lane should ever gate reads, that is a behaviour change with its own
   * decision to make, not something to infer from this comment.
   *
   * ADAPTER MUST: pass arguments that belong to the declared `capability.id` and to the executor
   * about to run them. This is the FOURTH adapter input and it carries the same rule as the three
   * exported types — nothing here binds these arguments to the capability, so arguments selecting a
   * different operation reproduce exactly the gap described on `GovernedCapability.id`. They are
   * returned verbatim for a genuine read and for an ordinary `auto`-lane mutation.
   */
  requestArgs: unknown;
}): GovernedDecision {
  const { caller, capability, approval, requestArgs } = input;
  const risk = classifyAction(capability.id);
  const laneRequested = approval.autonomyLane;

  const principal = caller.principal ?? "person";
  const base = {
    capability: capability.id,
    effect: capability.effect,
    door: caller.door,
    tenantId: caller.tenantId,
    userId: caller.userId,
    principal,
    risk,
    laneRequested,
  };
  const refuse = (
    code: GovernedRefusalCode, message: string, laneEffective = laneRequested, clamped = false,
  ): GovernedDecision => ({
    kind: "refuse", code, message, reason: riskReason(capability.id), risk,
    audit: { ...base, laneEffective, clamped, decision: "refuse", refusal: code },
  });

  // 1 — TENANCY PROVENANCE, before anything else. A tenant the caller chose is not a tenant.
  if (caller.tenantSource !== "server") {
    return refuse("tenant_not_server_derived",
      "The workspace for this action was not resolved by the server, so it cannot run.");
  }

  // 2 — IDENTITY. A verified credential is required in every case; whether it must belong to a
  // PERSON depends on what the adapter says is behind it. A `person` principal with no `userId` is
  // an adapter that never resolved who is asking, and that is the case this check was written for.
  // A `service` principal legitimately has none — see `GovernedCaller.principal`, and note that it
  // buys a machine nothing beyond reaching the checks below.
  if (!caller.authenticated) {
    return refuse("unauthenticated", "This action needs a verified credential behind it.");
  }
  if (principal === "person" && !caller.userId) {
    return refuse("unauthenticated", "This action needs a signed-in person behind it.");
  }

  // 3 — TENANT.
  if (!caller.tenantId) {
    return refuse("tenant_unresolved", "No workspace could be resolved for this action.");
  }

  // 4 — CAPABILITY IDENTITY. An unnamed capability cannot be classified, so it cannot be governed.
  if (typeof capability.id !== "string" || capability.id.trim() === "") {
    return refuse("capability_unidentified", "This action has no capability identity, so it cannot run.");
  }

  // 5 — ACCESS. An ABSENT verdict is a refusal. A surface that forgot to evaluate access must not
  // read as a surface that evaluated it and said yes.
  if (caller.access?.allowed !== true) {
    return refuse("access_denied",
      caller.access?.reason ?? "This account is not permitted to perform this action.");
  }

  // 5.5 — CAPABILITY STATUS, re-resolved at execution. A capability this tenant cannot actually use
  // right now cannot run through ANY door, regardless of how the caller arrived — which is the
  // door-blind property extended from the ACT to the act's AVAILABILITY. A capability hidden from
  // Chat (no tool exposed) must not stay reachable from an MCP client, a durable job, or a delegated
  // subagent, and this is the one place every door converges to make that impossible.
  //
  // Before classification deliberately: an out-of-tier, unbuilt, unconnected or unconfirmed
  // capability is refused whether it reads or writes, and no approval is a path out — the fix is to
  // make it available, not to approve it harder. `live` and `needs_approval` proceed (the steps
  // below decide whether a human's yes is required); `"unknown"` is a declared non-adoption and
  // passes the gate as a no-op (it is not a claim of availability — see `GovernedCapability`).
  switch (capability.availability) {
    case undefined:
    case "unknown":
    case "live":
    case "needs_approval":
      break; // proceed — availability does not block; the steps below decide the rest.
    case "not_for_tier":
      return refuse("capability_not_for_tier",
        "This isn't available for this account type, so it can't run.");
    case "unavailable":
      return refuse("capability_unavailable",
        "Paige can't confirm this works for this workspace yet, so it wasn't run.");
    case "planned":
      return refuse("capability_planned",
        "This isn't built yet, so it can't run.");
    case "needs_setup":
      return refuse("capability_needs_setup",
        "This needs a connection or setup step first, so it wasn't run.");
    default:
      // FAIL CLOSED on a status this seam does not recognise. This is the fail-closed layer, so a
      // future CapabilityAvailability member that nobody mapped here must REFUSE, never silently
      // proceed — the same direction as the unrecognised-autonomy-lane guard in step 8. The
      // "proceed" set above is the explicit allowlist (including absent and "unknown"); everything
      // else is blocked until it is deliberately classified. Found by the §39 peer-gate: the prior
      // switch had `break` arms with code after it, so a new member would have fallen through and
      // executed.
      return refuse("capability_unavailable",
        "This capability's availability could not be recognised, so it wasn't run.");
  }

  // 6 — CLASSIFICATION, and the two ways a declaration can lie about itself.
  //
  // A capability declared `read` that is CLASSIFIED as a mutation is a mis-declaration, and the
  // permissive reading of it would skip every step below. A capability declared `read` whose NAME
  // reads as a write and which is unclassified is the same problem one step earlier — that is the
  // runtime backstop `action-risk.ts` exposes, applied here rather than only in the Chat handler.
  if (capability.effect === "read") {
    if (risk !== "unclassified") {
      return refuse("effect_mismatch",
        "This action is declared as a read but is classified as a change, so it cannot run.");
    }
    if (unclassifiedWriteReason(capability.id)) {
      return refuse("unclassified_mutation",
        "This action has no risk classification, so it cannot run.");
    }
    // A genuine read. Nothing below applies to it.
    return {
      kind: "execute", args: requestArgs, risk,
      audit: { ...base, laneEffective: laneRequested, clamped: false, decision: "execute" },
    };
  }

  // A mutation with no classification is refused. There is no approval path out of this: the fix is
  // to classify the capability, not to approve it harder.
  if (risk === "unclassified") {
    return refuse("unclassified_mutation", "This action has no risk classification, so it cannot run.");
  }

  // `owner_only` is not "needs stronger approval" — no approval reaches it, through any door. It is
  // the operator's decision in their settings, because an assistant that can be talked into more
  // authority has no ceiling.
  if (risk === "owner_only") {
    return refuse("owner_only",
      "This is the operator's decision to make in their settings, not something that can be done from here.");
  }

  // A MACHINE CREDENTIAL IS NOBODY'S YES. `principal: "service"` exists so a verified non-person
  // credential can reach a READ (see `GovernedCaller.principal`); it must not become a way to
  // perform a change with no person anywhere in the loop. Every approval this seam honours is a
  // human's, redeemed once — and a service principal has no human to redeem one, so an `auto` lane
  // would otherwise auto-execute an ordinary mutation for a key rather than for anyone.
  //
  // Placed AFTER `owner_only` deliberately: that refusal is a property of the ACT and is the more
  // specific truth, so a service caller attempting an owner-only action still hears the real
  // reason rather than a caller-shaped one.
  //
  // An automation acting on a person's standing grant is not an exception to this — it is an
  // adapter that has a person and should say so, by resolving the grant's owner into `userId` and
  // declaring `principal: "person"`. "Nobody is behind this" is exactly the case being refused.
  if (principal === "service") {
    return refuse("service_principal_may_not_mutate",
      "A connected app or automation cannot make this change on its own.");
  }

  // 7 — OUTCOME. A change nobody can see afterwards is not a governed change. The channel's shape
  // belongs to the Rail workstream; this only requires that one was declared.
  if (typeof capability.outcomeChannel !== "string" || capability.outcomeChannel.trim() === "") {
    return refuse("outcome_channel_undeclared",
      "This change declares no durable outcome, so its result could not be shown to the operator.");
  }

  // 8 — AUTONOMY FLOOR.
  //
  // FAIL CLOSED ON A LANE THIS SEAM DOES NOT RECOGNISE. This check exists because its absence was
  // a real fail-OPEN, found by an exhaustive sweep of the decision space after 55 hand-written
  // tests missed it. The lane arrives as `"auto" | "confirm" | "off" | string`, and the widening to
  // `string` is not cosmetic — the caller resolves this value, so a typo, a casing difference
  // (`"AUTO"`), an empty string from a failed lookup, or an `undefined` all reach here. With only
  // `off` and `confirm` branching below, EVERY other value fell through to the tail `execute` —
  // which ran a `high` action with no claim and no approval at all.
  //
  // Guessing is what produced that hole, so an unrecognised lane is refused rather than coerced to
  // a safe default: a lane the server could not resolve is a broken autonomy resolution, and the
  // honest answer is to stop, not to pick one.
  if (laneRequested !== "auto" && laneRequested !== "confirm" && laneRequested !== "off") {
    return refuse("autonomy_lane_unrecognized",
      "The autonomy setting for this workspace could not be read, so this action was not run.");
  }

  // One-directional, exactly as the Chat handler applies it: a stored `auto` preference cannot
  // retire the approval a `high` action's class exists to require. `off` always survives — a brake
  // is the operator's to pull at any class.
  const clamped = laneRequested === "auto" && risk === "high";
  const laneEffective = clamped ? "confirm" : laneRequested;

  // 9 — APPROVAL. Note what is and is not here. There is no boolean to inspect, so the
  // model-asserted channel is structurally unreachable on this seam rather than merely
  // discouraged (#784). The only thing that turns a `confirm` lane into an execution is a claim
  // that came back holding the stored call.
  //
  // `off` first: a brake is the operator's to pull at any class.
  if (laneEffective === "off") {
    return refuse("autonomy_off", "This action is turned off for this workspace.", laneEffective, clamped);
  }

  // 9 — THE CLAIM, read by SHAPE. Done once, before any lane that could EXECUTE branches on it.
  //
  // NOT universal, and the earlier "no path can reach a decision having skipped the check" was
  // false: a genuine read returns at step 6 and an `off` mutation returns just above, both before
  // this line — so a read carrying `claimedArgs: true` executes rather than being refused
  // `approval_claim_malformed`. That is harmless, because neither of those paths consults the
  // claim for anything, and validating it there would refuse callers over a field their decision
  // never reads. What the check DOES guarantee is the part that matters: no lane that can execute
  // a mutation reaches its decision without it.
  const claim = readClaim(approval.claimedArgs);
  if (claim.state === "malformed") {
    return refuse("approval_claim_malformed",
      "The approval that came back was not a stored call, so nothing was run.",
      laneEffective, clamped);
  }

  // 10 — ARGUMENTS. A claim that produced stored arguments IS the call, on EVERY lane. The caller's
  // own `requestArgs` are not consulted when one exists, which is what stops a swapped recipient or
  // a re-authored amount reaching the write: the model never restates the call, so it cannot drift
  // it.
  //
  // "on every lane" is the part that was wrong. This used to be inside the `confirm` branch, so an
  // ordinary capability whose lane read `auto` fell through to the tail and ran `requestArgs` while
  // holding a real claim — burning a single-use approval and then executing DIFFERENT arguments
  // than the ones approved. That needs no attacker: an adapter that claims before reading the lane,
  // or a workspace that moved from `confirm` to `auto` between proposal and redemption, produces it.
  // Stored arguments are therefore authoritative wherever they exist, and the lane decides only
  // whether an approval was REQUIRED — never whether a granted one is honoured.
  if (claim.state === "stored") {
    // The claim must say WHAT it approved, and it must be this. An approval is for one capability;
    // honouring it for another turns a human's yes to a create into a yes to a delete.
    if (approval.claimedFor !== capability.id) {
      return refuse("approval_claim_capability_mismatch",
        "That approval was not granted for this action, so it was not run.",
        laneEffective, clamped);
    }
    return { kind: "execute", args: claim.args, risk,
             audit: { ...base, laneEffective, clamped, decision: "execute" } };
  }

  if (laneEffective === "confirm") {
    // Nothing runnable was claimed, so there is nothing to run: ask. `revalidate` distinguishes "no
    // approval was offered" from "one was offered and nothing backed it", which is the difference
    // between a first ask and asking again about an action that has moved on.
    return { kind: "propose", revalidate: claim.state === "failed", risk,
             audit: { ...base, laneEffective, clamped, decision: "propose" } };
  }

  // A claim that was ATTEMPTED and failed never becomes an unapproved auto-execute. Reaching here
  // on `auto` means the caller tried to redeem an approval and nothing backed it; running the
  // caller's own arguments at that point would silently convert a failed approval into a granted
  // one. Ask again instead.
  if (claim.state === "failed") {
    return { kind: "propose", revalidate: true, risk,
             audit: { ...base, laneEffective, clamped, decision: "propose" } };
  }

  // The ONLY remaining lane is `auto`, the only risk `ordinary`, and the only claim state `absent` —
  // `high` was clamped to `confirm` above, `owner_only` and unclassified were refused, every
  // unrecognised lane was refused, and a stored, malformed or failed claim each returned already.
  // No approval was required and none was attempted, so the request's own arguments are the call.
  //
  // Asserted rather than assumed: this used to be a bare fallthrough, and a bare fallthrough is
  // what let an unrecognised lane execute a `high` action.
  //
  // DELIBERATELY REDUNDANT, AND MEASURED AS SUCH. Given the unrecognised-lane refusal in step 8,
  // this branch is unreachable today — mutation testing confirms it: removing EITHER guard alone
  // leaves the suite green, because the other still catches it, while removing BOTH fails two
  // tests. That is defence in depth on a hole that already bit once, not dead weight. Do not
  // delete this because it "cannot fire", and do not delete step 8's check because "the tail
  // covers it" — each is only unreachable while the other stands.
  if (laneEffective !== "auto" || risk !== "ordinary") {
    return refuse("autonomy_lane_unrecognized",
      "This action did not resolve to a runnable autonomy state, so it was not run.",
      laneEffective, clamped);
  }
  return {
    kind: "execute", args: requestArgs, risk,
    audit: { ...base, laneEffective, clamped, decision: "execute" },
  };
}
