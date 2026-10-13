// Capability SIGNAL construction (Main Paige Operational Chat · P3b) — PURE.
//
// Piece 3a is the decision core (CapabilitySignal[] → one honest availability each). This is the
// layer above it: it turns the facts the edge dispatch resolves server-side — the caller's tier
// (getActorTier), the ceiling-clamped autonomy lanes (resolve_tool_autonomy), the Spine maturity
// (getSpineCapability) and the real per-tenant connection/provider state — into the signals the core
// grades. It is side-effect-free and imports ONLY types (erased at transpile) so it is unit-testable
// through the port; the async resolution lives in the edge fn, never here.
//
// WHY THIS IS THE MANIFEST (§13/§36/§70, the "what can you do here?" grounding): Paige's tool list
// and persona make her SOUND like she can do everything the instant she is asked, while some of those
// are NOT governed, executable paths. This manifest is the single honest answer — it declares WHICH
// capability families exist and their shape, and the edge dispatch feeds each one its REAL maturity
// (Spine registry where one exists), connection/provider state, and autonomy lane. Two honesty
// directions, both load-bearing:
//   - ANTI-OVER-CLAIM: an action whose governed seam is not registered / not wired into chat (social
//     publish, SMS send, team manage, skills-in-chat, secure browser) resolves through a `null`/
//     UNAVAILABLE maturity → "planned": Paige says it is not something she can do here yet (never
//     implies she can, never falsely claims it doesn't exist).
//   - ANTI-UNDER-CLAIM (the 2026-09-12 completion): several capabilities that GENUINELY ship as
//     governed chat tools — research, document creation, saving to the knowledge base, planning, and
//     delegating to a specialist (the §8 team) — were previously omitted, so "what can you do here?"
//     stayed silent about them. They are modeled now, each grounded in its real lane + (for research)
//     a real provider signal.
// Maturity is NEVER a hoped-for value (§947/§13). It is read from the Spine registry where a row
// exists; for the shipped-but-unregistered chat tools it is synthesized LIVE from the SAME evidence
// the CRM pair uses — a shipped, action-risk-CLASSIFIED, chat-DISPATCHED tool — and each such key is
// documented inline and pinned by the signals test's grounding guard so a future UNDOCUMENTED
// hardcode still fails. Adding a capability is adding a signal here — the decision core does not
// change (§18).

import type { CapabilitySignal } from "./resolver.ts";
import type { Tier } from "../actorTier.ts";

type Maturity = "LIVE" | "PARTIAL" | "UNAVAILABLE";
type Lane = "auto" | "confirm" | "off";

/**
 * The server-resolved facts for this caller+tenant. The edge dispatch resolves each one from the
 * verified JWT (never the body): the tier via getActorTier, each lane via resolve_tool_autonomy
 * (ceiling-clamped), each maturity via getSpineCapability(key)?.maturity ?? null (a `null` means the
 * registry has NO governed seam for that capability → the core reports it "planned"), and the
 * connection/provider facts via live reads. Nothing here is taken from the model.
 */
export interface CapabilityFacts {
  /** The caller's server-resolved tier (getActorTier). A sealed client seat gets nothing. */
  callerTier: Tier;

  // ── Ceiling-clamped autonomy lanes (resolve_tool_autonomy) for the mutating verbs we model ──
  /** resolve_tool_autonomy("crm_create_contact"). */
  contactCreateLane: Lane;
  /** resolve_tool_autonomy("crm_advance_journey_stage") — the native journey-advance write (Layer C · C2). */
  journeyAdvanceLane: Lane;
  /** Native internal observation; schedule authorization is separately owner-only. */
  weeklyCommitmentLane?: Lane;
  /** resolve_tool_autonomy("campaign_brief_create"). */
  campaignCreateLane: Lane;
  /** resolve_tool_autonomy("n8n_run_workflow") — moot until n8n is connected, carried for correctness. */
  workflowsLane: Lane;
  /** resolve_tool_autonomy("document_generate"). */
  documentCreateLane: Lane;
  /** resolve_tool_autonomy("save_to_knowledge_base"). */
  knowledgeSaveLane: Lane;
  /** resolve_tool_autonomy("plan_create"). */
  planningCreateLane: Lane;
  /** resolve_tool_autonomy("delegate_to_subagent") — high-risk, so the ceiling clamps it to confirm/off. */
  delegateLane: Lane;

  // ── Real Spine maturities (getSpineCapability(key)?.maturity ?? null). null ⇒ UNAVAILABLE ⇒ planned ──
  /** integrations.list (read surface). */
  integrationsListMaturity: Maturity | null;
  /** pipeline.deal_stage_evidence (read of deal stages — NOT deal management). */
  pipelineEvidenceMaturity: Maturity | null;
  /** comms.messages_read (inbox read). */
  commsReadMaturity: Maturity | null;
  /** comms.send — no governed tenant send path is registered, so this resolves null ⇒ planned. */
  commsSendMaturity: Maturity | null;
  /** social.presence (read of the accounts the workspace has recorded). */
  socialPresenceMaturity: Maturity | null;
  /** social.publish — no governed publish path is registered, so this resolves null ⇒ planned. */
  socialPublishMaturity: Maturity | null;
  /** team.authority (read of the roster and roles). */
  teamAuthorityMaturity: Maturity | null;
  /** team.manage — no governed member-management path is registered, so this resolves null ⇒ planned. */
  teamManageMaturity: Maturity | null;
  /** campaign.list (read). */
  campaignListMaturity: Maturity | null;
  /** campaign.create (mutate — drafting a campaign brief). */
  campaignCreateMaturity: Maturity | null;
  /** integrations.n8n_run_workflow (external effect — running an automation). */
  workflowsMaturity: Maturity | null;

  // ── Real per-tenant connection / provider facts ──
  /** Is the tenant's own n8n instance connected? (loadN8nReadinessForChat → status === "available"). */
  workflowsConnected: boolean;
  /**
   * Is a public-web research provider configured? The research tools (web_search/deep_research) ship
   * and degrade honestly to `configured:false` when the provider key is absent, so the manifest gates
   * research on this REAL signal (the edge fn reads the provider key's presence — never the value),
   * exactly as n8n gates on the connection: configured ⇒ live, absent ⇒ needs_setup (§13/§947).
   */
  researchProviderConfigured: boolean;

  /**
   * Does the caller hold the owner-ops role these tools actually require? The chat's owner block
   * gates every one of these tools (the reads included) on `admin | coach | super_admin`, derived
   * server-side from `user_roles`. The caller's TIER alone does not prove that role — a non-admin
   * tenant member is a non-client tier but cannot drive any of these — so the manifest must AND the
   * role in, or it would tell such a member she can do things the tool gate will refuse (§13/§51:
   * the block and the tool must agree on WHO). Resolved from the verified JWT's user id; false when
   * unknown, so the manifest never over-claims on an unresolved role.
   */
  ownerOpsEligible: boolean;
}

// A sealed client seat (actorTier CLIENT_SEAT_ALLOW) can neither see/create contacts nor reach any
// of these tenant-operator surfaces, so "eligible" = the caller is any non-client tier. This mirrors
// the chat's SHIPPED runtime gate for these tools, which is a ROLE gate (admin/coach/super_admin),
// not a tier-feature gate — there is no server-importable getTierFeatureSet (it is frontend-only).
// The finer Agency-CRM question is the open owner decision (task #124 — tierFeatures currently
// grants Agency the CRM cluster), so Agency is modeled eligible to MATCH current shipped behavior;
// that is flagged here, not silently faked (§13).
const eligibleForTenantBook = (tier: Tier): boolean => tier !== "client";

// `null` (no registry row resolved) degrades to UNAVAILABLE so the core says "planned" — never a
// fabricated LIVE for a seam we cannot confirm ships (§13/§947).
const mat = (m: Maturity | null): Maturity => m ?? "UNAVAILABLE";

export function buildCapabilitySignals(facts: CapabilityFacts): CapabilitySignal[] {
  // Eligible = a non-client tier AND the owner-ops role the tools actually require. ANDing the role
  // in keeps the manifest from telling a non-admin tenant member she can do what the tool gate will
  // refuse (§13/§51 — the block and the tool agree on WHO); a sealed client fails the tier half too.
  const tierEligible = eligibleForTenantBook(facts.callerTier) && facts.ownerOpsEligible;
  // Research/web is the ONE capability here NOT behind the owner-ops role gate at runtime:
  // web_search/deep_research are their own chat-dispatch branches with only the client-seat gate, so
  // any non-client seat can run them. ANDing owner-ops would UNDER-claim research to a non-admin
  // member who can in fact use it (§13/§70 — the block is shown to every non-client seat). A sealed
  // client is still excluded (eligibleForTenantBook is false for "client").
  const researchEligible = eligibleForTenantBook(facts.callerTier);

  return [
    // ── CRM ───────────────────────────────────────────────────────────────────────────────────
    // See your contacts — a shipped read (crm_search_contacts). Reads ignore the autonomy lane.
    // There is no crm.* Spine entry to read, so a LIVE read seam is synthesized from the classified
    // chat tool that genuinely ships (a documented-synthesis LIVE; the grounding guard pins the set).
    { key: "crm.search_contacts", label: "See your contacts and their details", actionKind: "read", maturity: "LIVE", tierEligible },
    // Add a contact — the star write, shipped + classified in action-risk (ordinary), confirm-gated
    // at runtime. The ceiling-clamped lane decides live vs needs_approval. (Documented LIVE synthesis.)
    { key: "crm.create_contact", label: "Add a contact", actionKind: "create", maturity: "LIVE", tierEligible, requiresConnection: false, autonomyLane: facts.contactCreateLane },
    // Move a client along their journey — the native, IN-TENANT governed write behind the §67 process
    // engine (Layer C · C2): the `crm_advance_journey_stage` act → the tenant-aware `set_journey_stage`
    // RPC. No external provider, no per-tenant connection to negotiate, so requiresConnection is false.
    // There is no crm.* Spine entry, so a LIVE read/write seam is a DOCUMENTED synthesis from the classified
    // chat tool that genuinely ships (action-risk `crm_advance_journey_stage`, ordinary — pinned by the
    // grounding guard). The ceiling-clamped lane decides live vs needs_approval; this is the canonical
    // availability the Layer C native adapter resolves THROUGH this seam (never a Layer-C inline literal).
    { key: "crm.advance_journey_stage", label: "Move a client along their journey", actionKind: "update", maturity: "LIVE", tierEligible, requiresConnection: false, autonomyLane: facts.journeyAdvanceLane },
    // Internal read adapter only. No Chat/Live binding or authenticated acceptance is implied.
    // The native Gateway additionally holds recurring reads when the canonical tool lane is not auto.
    { key: "planning.weekly_commitment_check", label: "Check your internal commitments", actionKind: "read", maturity: "PARTIAL", tierEligible, requiresConnection: false, autonomyLane: facts.weeklyCommitmentLane ?? "off" },

    // ── Connections ──────────────────────────────────────────────────────────────────────────
    // See your connected apps — the integrations read surface (integrations.list, PARTIAL today).
    { key: "integrations.list", label: "See your connected apps and integrations", actionKind: "read", maturity: mat(facts.integrationsListMaturity), tierEligible },
    // Run one of your automations — an external effect (integrations.n8n_run_workflow). Registered,
    // but gated on the tenant's OWN n8n connection: absent ⇒ needs_setup (connect n8n first), present
    // ⇒ the ceiling-clamped lane decides live vs needs_approval. Never implies Paige can run an
    // automation the tenant hasn't connected (§13/§947).
    { key: "integrations.n8n_run_workflow", label: "Run one of your automations", actionKind: "external_effect", maturity: mat(facts.workflowsMaturity), tierEligible, requiresConnection: true, connected: facts.workflowsConnected, autonomyLane: facts.workflowsLane },

    // ── Pipeline ──────────────────────────────────────────────────────────────────────────────
    // See the pipeline and deal stages — a read of deal-stage EVIDENCE (pipeline.deal_stage_evidence).
    // NOT deal management: there is no governed "move a deal" write registered, so she does not claim one.
    { key: "pipeline.deal_stage_evidence", label: "See your pipeline and deal stages", actionKind: "read", maturity: mat(facts.pipelineEvidenceMaturity), tierEligible },

    // ── Inbox / comms ───────────────────────────────────────────────────────────────────────────
    // See your inbox — a shipped read (comms.messages_read).
    { key: "comms.messages_read", label: "See your inbox messages", actionKind: "read", maturity: mat(facts.commsReadMaturity), tierEligible },
    // Send a text/SMS — NO governed tenant send path is registered (operator SMS is a separate
    // operator-only surface). A null maturity resolves to "planned", so Paige never implies she can
    // text on the tenant's behalf.
    { key: "comms.send", label: "Send a text or SMS on your behalf", actionKind: "external_effect", maturity: mat(facts.commsSendMaturity), tierEligible },

    // ── Social ──────────────────────────────────────────────────────────────────────────────────
    // See the social accounts you've recorded — a read (social.presence). Declared capture, never a
    // connection — the label says "recorded", not "connected".
    { key: "social.presence", label: "See the social accounts you've recorded", actionKind: "read", maturity: mat(facts.socialPresenceMaturity), tierEligible },
    // Post to social — the complete tenant-safe governed publish path is NOT built (owner-ruled it
    // stays unavailable until it exists; #1164 contains it server-side), and no social.publish
    // capability is registered — so it resolves "planned". Paige must not claim she can post.
    { key: "social.publish", label: "Post to your social accounts", actionKind: "external_effect", maturity: mat(facts.socialPublishMaturity), tierEligible },

    // ── Team ──────────────────────────────────────────────────────────────────────────────────────
    // See your team and roles — a read (team.authority).
    { key: "team.authority", label: "See your team and their roles", actionKind: "read", maturity: mat(facts.teamAuthorityMaturity), tierEligible },
    // Manage the team (add/remove members, change roles) — NO governed path is registered, so it
    // resolves "planned". Paige never claims she can manage the team.
    { key: "team.manage", label: "Add, remove, or change team members", actionKind: "update", maturity: mat(facts.teamManageMaturity), tierEligible },

    // ── Campaign briefs ────────────────────────────────────────────────────────────────────────
    // See your campaign briefs — a read (campaign.list).
    { key: "campaign.list", label: "See your campaign briefs", actionKind: "read", maturity: mat(facts.campaignListMaturity), tierEligible },
    // Draft a campaign brief — a governed mutation (campaign.create), confirm-gated by its lane.
    { key: "campaign.create", label: "Draft a campaign brief", actionKind: "create", maturity: mat(facts.campaignCreateMaturity), tierEligible, requiresConnection: false, autonomyLane: facts.campaignCreateLane },

    // ── Documents ─────────────────────────────────────────────────────────────────────────────
    // Create a document — shipped + classified (document_generate, ordinary), produces a real
    // artifact (refuses placeholders, gates success on a real content_id). Documented LIVE synthesis;
    // the lane decides live vs needs_approval. (Export fidelity per format is the doc-export slice's.)
    { key: "documents.create", label: "Draft a document for you", actionKind: "create", maturity: "LIVE", tierEligible, requiresConnection: false, autonomyLane: facts.documentCreateLane },

    // ── Knowledge base ─────────────────────────────────────────────────────────────────────────
    // Save to your knowledge base — shipped + classified (save_to_knowledge_base, ordinary), §15
    // confirm-gated, §13-honest (deletes the doc and reports failure if zero chunks embed). Documented
    // LIVE synthesis; the lane decides live vs needs_approval.
    { key: "knowledge.save", label: "Save something to your knowledge base", actionKind: "create", maturity: "LIVE", tierEligible, requiresConnection: false, autonomyLane: facts.knowledgeSaveLane },

    // ── Planning ──────────────────────────────────────────────────────────────────────────────
    // Plan work and set reminders — shipped + classified (plan_create/plan_set_reminder, ordinary);
    // reminders genuinely fire on a cron. Documented LIVE synthesis; the lane decides.
    { key: "planning.create", label: "Plan work and set reminders that actually fire", actionKind: "create", maturity: "LIVE", tierEligible, requiresConnection: false, autonomyLane: facts.planningCreateLane },

    // ── Your Paige team (delegation, §8) ───────────────────────────────────────────────────────
    // Put your Paige team on it — shipped + classified (delegate_to_subagent, HIGH: dispatches work
    // that executes outside the gate), role-gated, receipts a subagent_invoke Rail row. Documented
    // LIVE synthesis. This signal THREADS the ceiling-clamped lane verbatim (whatever
    // resolve_tool_autonomy("delegate_to_subagent") returns) — honest either way: an `auto` lane would
    // resolve live, confirm/off → needs_approval. The clamp itself is the autonomy RPC's job, not this
    // manifest's, so this code asserts nothing about the clamp — it reports the resolved lane faithfully.
    // This is the capability the manifest previously UNDER-CLAIMED (§8 "hiring her team").
    { key: "agentteam.delegate", label: "Put your Paige team on a task (delegate to a specialist)", actionKind: "external_effect", maturity: "LIVE", tierEligible, requiresConnection: false, autonomyLane: facts.delegateLane },

    // ── Research & web (family 3) ──────────────────────────────────────────────────────────────
    // Search the web / run public research with citations — shipped chat tools (web_search,
    // deep_research) that degrade honestly to configured:false without a provider key. The provider
    // (Firecrawl) is PLATFORM-provided, NOT a per-tenant connection — so when the key is absent this is
    // NOT a "connect this" step the tenant can take (that would misdirect them, §9/§13). It is gated on
    // the REAL provider signal as `evidenceMissing`: configured ⇒ live read; absent ⇒ unavailable
    // ("Paige can't confirm web research works for this workspace"), never a tenant-connect instruction.
    { key: "research.web", label: "Search the web and run public research with citations", actionKind: "read", maturity: "LIVE", tierEligible: researchEligible, evidenceMissing: !facts.researchProviderConfigured },

    // ── Skills in chat (family 2) — NOT wired into the cockpit ─────────────────────────────────
    // Run a skill recipe — the skills library + interpreter exist, but ONLY via the MCP server and the
    // admin Skills Hub; there is no skill tool in this chat. Hardcoded UNAVAILABLE (the SAFE direction,
    // never over-claims) ⇒ "planned": not something Paige can run from this chat yet. (A seeded skills
    // row is inventory, not a chat-reachable path — §13/§947.)
    { key: "skills.run", label: "Run one of your skill recipes from chat", actionKind: "external_effect", maturity: "UNAVAILABLE", tierEligible },

    // ── Secure browser (family 3) — worker gated off ───────────────────────────────────────────
    // Browse a site for you (secure browser) — the request boundary ships, but the worker is
    // deliberately gated off (returns 503 under setup) and there is no chat entry point. Hardcoded
    // UNAVAILABLE ⇒ "planned": not available from chat yet.
    { key: "browser.secure_session", label: "Browse a website for you (secure browser)", actionKind: "external_effect", maturity: "UNAVAILABLE", tierEligible },
  ];
}
