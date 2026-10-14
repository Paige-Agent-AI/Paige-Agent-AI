/**
 * useSoloGamePlan — the Business Game Plan view-model (§18: COMPOSE existing released,
 * tenant-safe hooks; never a new query family).
 *
 * WHAT IT COMPOSES (each resolves its own tenant from the session — this hook passes NO
 * tenant_id anywhere, §9):
 *   • useCommandCenter        → greeting · approvals · attention · metrics            (LIVE)
 *   • useSoloSetupBrief       → business identity / website / sending identity + per-field
 *                               provenance (owner_confirmed | connection_sourced |
 *                               needs_confirmation) — the honest proof-state signal, reused
 *   • useCatalogOffers        → offers foundation                                     (LIVE)
 *   • useSoloKnowledge        → knowledge foundation (real indexed count)             (LIVE)
 *   • useSoloPendingActions   → work Paige stopped on, waiting on the owner           (LIVE)
 *   • useSystemsCheck("tenant") → readiness findings, the strongest priority signal   (LIVE)
 *   • useSoloActivityFeed     → recorded workspace activity, the durable Rail path     (LIVE)
 *
 * §13 TRUTH RULES honoured here:
 *   • Every visible number has a real numerator + denominator + source (coverage = grounded/total
 *     over the five foundations this hook actually reads; never a fabricated score).
 *   • There is NO goals/priorities store — priorities are DERIVED from real gaps + findings +
 *     waiting work, ranked deterministically, and labelled as derived.
 *   • Work in motion is the recorded Rail feed. An empty *ready* read is "No recorded work yet"
 *     (owner correction 2026-09-05) — never "nothing happened", never a fabricated feed.
 *   • Owner attribution is honest: a setup gap is the OWNER's; a Paige-drafted action or an
 *     at-risk-client move is Paige's (she drafts, the owner approves).
 *   • The view-model carries NO route strings and NO internal identifiers for display — the
 *     component maps a semantic `destination` to a real route/handler, and all copy is plain.
 */
import { useCallback, useMemo } from "react";
import { useCommandCenter } from "./useCommandCenter";
import { useSoloSetupBrief, type SoloSetupSaveResult } from "./useSoloSetupBrief";
import { useCatalogOffers } from "../useCatalogOffers";
import { useSoloKnowledge } from "./useSoloKnowledge";
import { useSoloPendingActions } from "./useSoloPendingActions";
import { useSoloActivityFeed, elapsedLabel, departmentLabel, type SoloActivityStatus } from "./useSoloActivityFeed";
import { useSystemsCheck } from "@/hooks/useSystemsCheck";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useSoloCampaignBriefs, type CampaignBrief } from "../useSoloCampaignBriefs";
import {
  prepareOwnerConfirmedBrief, applySetupProposal, EMPTY_SOLO_SETUP_BRIEF,
  type SoloSetupBrief, type SoloSetupProposal, type SetupFactSource,
} from "../settings-setup-contract";

/** Where a move or foundation item sends the owner. The COMPONENT maps this to a real route or
 *  to opening the one PAIGE conversation — the hook never emits a URL or an internal name. */
export type GamePlanDestination =
  | "setup"
  | "catalog"
  | "connections"
  | "systems-check"
  | "knowledge"
  | "clients"
  | "paige";

export type ProofState = "live" | "partial" | "input" | "blocked";
export type FoundationStatus = "grounded" | "incomplete" | "needs-input";

// ── Strategy-desk view-model (owner-approved reimagination, 2026-09-06) ──────────────────────
// The desk's SPINE is the owner's approved strategy — not a readiness list. Every value carries a
// SOURCE class so the owner always sees how sure Paige is (§13). Systems Check is DEMOTED to a
// supporting dependency, never the backbone.
export type SourceClass = "fact" | "direction" | "recommendation" | "assumption" | "unavailable" | "owed" | "blocked";

/** The editable planning fields — a strict subset of the business brief, all admin-writable so both
 *  owners and operational admins can persist them through the existing setup save seam (§18). */
export type PlanBriefField =
  | "annualDirection" | "goals90Day" | "currentPriority"
  | "successDefinition" | "constraints" | "operatingPreferences" | "doNotAssume";

export const PLAN_BRIEF_FIELDS: PlanBriefField[] = [
  "annualDirection", "goals90Day", "currentPriority",
  "successDefinition", "constraints", "operatingPreferences", "doNotAssume",
];

export interface PlanBrief {
  fields: Record<PlanBriefField, string>;
  /** Per-field provenance source, so an owner-confirmed direction reads differently from a Paige guess. */
  provenance: Partial<Record<PlanBriefField, SetupFactSource>>;
  /** Any planning field is set — the desk has an approved spine to show (vs. first-run). */
  hasPlan: boolean;
  canEdit: boolean;
  saving: boolean;
  /** A Paige-proposed revision awaiting the owner (apply/dismiss), or null. */
  pendingProposal: SoloSetupProposal | null;
  /** True when the pending proposal only touches the plan fields shown here — so an inline Apply
   *  can never persist unseen identity fields. A mixed proposal is routed to Setup instead (§13). */
  proposalPlanOnly: boolean;
  updatedAt?: string;
  /** Persist an owner edit of the planning fields — merges over the full brief, stamps owner_confirmed
   *  provenance on changed fields only, optimistic-concurrency guarded. Returns the setup save result. */
  save: (next: Partial<Record<PlanBriefField, string>>) => Promise<SoloSetupSaveResult>;
  /** Apply the pending Paige-proposed revision (owner accepts it), then persist. */
  applyProposal: () => Promise<SoloSetupSaveResult | { ok: false; kind: "failed"; error: string }>;
  /** Reject the pending proposal — the approved plan is unchanged. */
  dismissProposal: () => Promise<{ ok: boolean; error?: string }>;
}

/** A planning horizon the owner switches between; each reveals a slice of the plan. */
export interface PlanHorizon {
  id: "annual" | "quarter";
  label: string;
  sub: string;
  direction: string;
  outcome: string;
  defined: boolean;
}

/** A strategic/campaign play, sourced from the owner's real campaign briefs (owner-authored records). */
export interface PlayCard {
  id: string;
  name: string;
  objective: string;
  audience: string;
  angle: string;
  window: string;
  channels: string;
  outcome: string;
  successSignal: string;
  offerName: string | null;
  status: string;
  blocked: boolean;
}

export type PlaysStatus = "resolving" | "loading" | "ready" | "error" | "unavailable";

/** A decision or opportunity on the desk, each labelled by how sure Paige is (source class). */
export interface DecisionItem {
  id: string;
  title: string;
  detail: string;
  source: SourceClass;
  /** True when this is waiting on an owner call. */
  waiting: boolean;
  destination: GamePlanDestination;
  evidence: string;
}

/** A supporting dependency (a demoted Systems Check finding) that can block a play — never the spine. */
export interface DependencyItem {
  id: string;
  title: string;
  reason: string;
  blocking: boolean;
}

export interface FoundationItem {
  key: string;
  label: string;
  status: FoundationStatus;
  note: string;
  destination: GamePlanDestination;
  /** True when this foundation's status reflects a READ OUTAGE, not owner inaction — so the
   *  roll-up never counts a failed read as work the owner still has "to finish" (§13). */
  degraded?: boolean;
}

export interface GamePlanMove {
  id: string;
  title: string;
  why: string;
  owner: "you" | "paige";
  proof: ProofState;
  /** Present only on a blocked move — the plain-language reason + how it clears. */
  blockedReason?: string;
  /** Plain-language evidence (no table/route/provider names — corr #3). */
  evidence: string;
  /** What happens when the owner takes it. */
  outcome: string;
  destination: GamePlanDestination;
  ctaLabel: string;
}

export interface MotionItem {
  id: string;
  title: string;
  summary: string | null;
  byPaige: boolean;
  actorAgent: string | null;
  department: string;
  when: string;
}

export interface GamePlanMotion {
  status: SoloActivityStatus;
  items: MotionItem[];
  /** Freshness context for the recorded feed (corr #1). */
  freshness: string;
}

/** Minimal shapes for the loosely-typed fields the composed hooks expose — read-only, only the
 *  keys this view-model actually consumes, so no `any` reaches the derivation logic. */
type AttentionLike = { at_risk_clients?: number; follow_ups_due?: number };
type OfferLike = { availability?: string };
type BriefLike = {
  publicName?: string; legalName?: string; dbaName?: string; website?: string; industry?: string;
  provenance?: Record<string, { source?: string } | undefined>;
};

export interface SoloGamePlanView {
  loading: boolean;
  error: boolean;
  /** Genuinely nothing yet — a fresh workspace (drives the first-run experience). */
  empty: boolean;
  greeting: { name: string; dateLabel: string; salutation: string };
  narrative: string;
  /** Summary chips. Each carries the real surface that backs its claim so it can be opened (§36). */
  attention: Array<{ label: string; tone: ProofState; destination: GamePlanDestination }>;
  bestMove: GamePlanMove | null;
  priorities: GamePlanMove[];
  foundation: FoundationItem[];
  /** Real numerator/denominator over the foundations this hook reads. `degraded` counts foundations
   *  whose status reflects a read OUTAGE, kept apart from owner-actionable work (§13). */
  coverage: { grounded: number; partial: number; degraded: number; total: number; caption: string };
  motion: GamePlanMotion;
  /** First-run setup steps, only meaningful in the empty state. */
  firstRun: Array<{ label: string; hint: string; destination: GamePlanDestination }>;
  // ── strategy-desk outputs (owner-approved reimagination) ──────────────────────────────────
  /** The editable strategy spine (persists via the setup brief seam). */
  planBrief: PlanBrief;
  /** Planning horizons the owner switches between. */
  horizons: PlanHorizon[];
  /** Strategic/campaign plays from the owner's real campaign briefs. */
  plays: PlayCard[];
  playsStatus: PlaysStatus;
  /** Decision & opportunity desk items, each source-labelled. */
  decisions: DecisionItem[];
  /** Whether the drafts read behind `decisions` resolved. On an OUTAGE (`pending.error`) this is
   *  "unavailable" so the deck never announces "All caught up" over a queue it couldn't check (§13). */
  decisionsStatus: "ready" | "unavailable";
  /** Supporting dependencies (demoted Systems Check) that can block a play. */
  dependencies: DependencyItem[];
  /** Whether the Systems Check read behind `dependencies` actually resolved. On an OUTAGE
   *  (`checks.isError`) this is "unavailable" so the card never asserts a verified "All clear"
   *  over a read that failed (§13) — the same honesty the surface applies to setup/cc. */
  dependenciesStatus: "ready" | "unavailable";
  refresh: () => void;
}

const firstToken = (name: string): string => name.trim().split(/\s+/)[0] || name.trim();

function salutationFor(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** A finding's severity → a coarse ordering weight (lower = more urgent). */
function severityRank(sev: string | null | undefined): number {
  switch (sev) {
    case "blocking": return 0;
    case "high": return 1;
    case "medium": return 2;
    default: return 3;
  }
}

/**
 * The honest, action-safe TITLE for a failing systems-check move. `paige_interpretation` is owner-
 * facing "STATE — next step" copy (e.g. "No payment processor declared yet — tell Paige which
 * processor…"); the STATE clause before the dash is the true present state and makes a title that
 * never asserts an unachieved goal (§13). Falls back to a neutral action title, never a raw
 * check_name (corr #3).
 */
function checkStateTitle(interp: string | null | undefined): string {
  const text = (interp || "").trim();
  if (!text) return "Resolve a setup check";
  // Split on the em/en dash separator the authored "STATE — next step" copy uses. NOT a bare spaced
  // hyphen: a STATE clause may legitimately contain " - ", and truncating there would drop real state.
  const state = text.split(/\s+[—–]\s+/)[0].trim();
  if (state && state.length <= 90) return state;
  return "Resolve a setup check";
}

export function useSoloGamePlan(account: string, workspaceId?: string | null): SoloGamePlanView {
  const cc = useCommandCenter();
  const setup = useSoloSetupBrief();
  const catalog = useCatalogOffers();
  const knowledge = useSoloKnowledge();
  const pending = useSoloPendingActions(workspaceId ?? null); // §9 — scope to the viewed workspace, like the activity feed
  const checks = useSystemsCheck("tenant");
  const activity = useSoloActivityFeed(workspaceId);
  const campaigns = useSoloCampaignBriefs();
  const { activeTenant, activeTenantId, isPlatformStaff } = useTenantContext();

  // §57 identity: the personal greeting belongs to the person WHOSE workspace this is. The
  // signed-in user's name is only theirs to show when the active workspace is genuinely their own —
  // otherwise an operator/super-admin viewing a tenant would see their OWN name pasted over someone
  // else's HQ (the exact operator-name-over-another-tenant's-workspace mislabel the owner flagged).
  //
  // The reliable signal is NOT `owner_user_id`: it is NULL on prod for every sub-account and for
  // some solo tenants, so keying on it would greet real owners "there" on their own workspace.
  // Instead: RLS scopes a NON-staff user to only their OWN tenants, and platform staff are never
  // auto-scoped into a tenant (they reach any tenant only by act-as / the operator switcher). So a
  // non-staff viewer with an active workspace is, by construction, in their own workspace; a
  // platform operator is not, and is greeted neutrally rather than with a borrowed identity (§13).
  //
  // KNOWN, HONEST LIMITATION (§13): an agency PARENT who switches into a sub-account's Solo shell is
  // also non-staff, so they would be greeted by their own name over the child workspace. Because a
  // sub-account carries no `owner_user_id`, distinguishing that case robustly needs a per-workspace
  // owner seam (get_user_primary_tenant) not read here — documented, not silently assumed away.
  const viewerOwnsWorkspace = !isPlatformStaff && !!activeTenantId;

  const refresh = useCallback(() => {
    cc.refresh();
    setup.refresh();
    catalog.retry();
    knowledge.refresh();
    pending.refresh();
    checks.refresh();
    activity.refresh();
    campaigns.retry?.();
  }, [cc, setup, catalog, knowledge, pending, checks, activity, campaigns]);

  // ── FOUNDATION — five dimensions this hook actually reads, each source-backed ────────────
  const foundation = useMemo<FoundationItem[]>(() => {
    const brief = (setup.brief ?? {}) as BriefLike;
    const prov = brief.provenance ?? {};
    const items: FoundationItem[] = [];

    // 1. Business identity
    const name = (brief.publicName || brief.legalName || brief.dbaName || "").trim();
    items.push({
      key: "identity",
      label: "Business identity",
      status: !name ? "needs-input" : brief.industry ? "grounded" : "incomplete",
      note: !name ? "Add your business name" : brief.industry ? name : `${name} — add your industry`,
      destination: "setup",
    });

    // 2. Website / online presence (provenance is the proof signal)
    const site = (brief.website || "").trim();
    const siteSource = prov.website?.source;
    items.push({
      key: "website",
      label: "Website",
      status: !site
        ? "needs-input"
        : siteSource === "owner_confirmed"
          ? "grounded"
          : "incomplete",
      note: !site
        ? "Add your website so PAIGE can ground your presence"
        : siteSource === "owner_confirmed"
          ? site
          : `${site} — confirm this is right`,
      destination: "setup",
    });

    // 3. Offers (real catalog read)
    const offersReady = catalog.phase === "ready";
    const offerCount = Array.isArray(catalog.offers) ? catalog.offers.length : 0;
    const activeOffers = Array.isArray(catalog.offers)
      ? (catalog.offers as OfferLike[]).filter((o) => o.availability === "active").length
      : 0;
    items.push({
      key: "offers",
      label: "Offers",
      status: !offersReady ? "incomplete" : offerCount === 0 ? "needs-input" : "grounded",
      // `!offersReady` here means the catalog READ errored/is unavailable (loading is gated at the
      // surface), so this is a read outage, not owner inaction (§13).
      degraded: !offersReady,
      note: !offersReady
        ? "Offers unavailable right now"
        : offerCount === 0
          ? "No offer yet — this blocks revenue moves"
          : activeOffers > 0
            ? `${activeOffers} active offer${activeOffers === 1 ? "" : "s"}`
            : `${offerCount} offer${offerCount === 1 ? "" : "s"} drafted`,
      destination: "catalog",
    });

    // 4. Sending identity (can PAIGE send email for you)
    const sender = (setup.managedSendingEmail || "").trim();
    items.push({
      key: "sender",
      label: "Sending identity",
      status: sender ? "grounded" : "needs-input",
      note: sender ? "Email sending is set up" : "Not set up — email moves stay blocked",
      destination: "connections",
    });

    // 5. Knowledge (real indexed count) — a failed read reads "couldn't load", never "add a source".
    const knowErr = !!knowledge.error;
    const docs = typeof knowledge.documentsIndexed === "number" ? knowledge.documentsIndexed : 0;
    items.push({
      key: "knowledge",
      label: "Knowledge",
      status: knowErr ? "incomplete" : docs === 0 ? "needs-input" : docs < 3 ? "incomplete" : "grounded",
      // A failed knowledge read is a read outage, not owner inaction (§13).
      degraded: knowErr,
      note: knowErr
        ? "Couldn't load your knowledge right now"
        : docs === 0
          ? "Add a source so PAIGE can answer with your material"
          : `${docs} source${docs === 1 ? "" : "s"}${docs < 3 ? " — add more for depth" : ""}`,
      destination: "knowledge",
    });

    return items;
  }, [setup.brief, setup.managedSendingEmail, catalog.phase, catalog.offers, knowledge.documentsIndexed, knowledge.error]);

  const coverage = useMemo(() => {
    const grounded = foundation.filter((f) => f.status === "grounded").length;
    // A read outage ("degraded") is neither grounded nor owner-actionable "to finish" — count it
    // apart so the caption never blames a failed read on owner inaction (§13, peer-gate finding).
    const degraded = foundation.filter((f) => f.degraded).length;
    const partial = foundation.filter((f) => f.status === "incomplete" && !f.degraded).length;
    const needed = foundation.filter((f) => f.status === "needs-input").length;
    const total = foundation.length;
    const degradedTail = degraded > 0 ? ` ${degraded} couldn't load right now.` : "";
    const caption =
      grounded === total
        ? "Every foundation is grounded. PAIGE has enough to plan and act with you."
        : grounded === 0 && degraded === 0
          ? "PAIGE grounds the plan from what you set up. Start with your Business Context."
          : `${grounded} grounded, ${partial} to finish, ${needed} still needed.${degradedTail} PAIGE plans from what you've set.`;
    return { grounded, partial, degraded, total, caption };
  }, [foundation]);

  // ── PRIORITIES — derived from real gaps + findings + waiting work, ranked ────────────────
  const { bestMove, priorities } = useMemo(() => {
    type Ranked = GamePlanMove & { rank: number };
    const candidates: Ranked[] = [];

    // Systems Check failing findings (strongest real signal).
    const findings = Array.isArray(checks.findings) ? checks.findings : [];
    for (const f of findings) {
      if (f.status !== "fail") continue;
      const blocking = f.severity_at_finding === "blocking";
      candidates.push({
        id: `check:${f.id}`,
        // A FAILING check's title must describe the real state, never the achieved GOAL. The
        // Systems Check `CHECK_DESTINATIONS.title` is a goal-state assertion ("You can take
        // payment") — true only when the check PASSES, and misleading on a blocked/failing move
        // (§13; the owner's payment-processor concern). `paige_interpretation` is owner-facing
        // "STATE — next step" copy, so its STATE clause is the honest title; the full line stays
        // as the reason. Never leak a raw engineering check_name (corr #3).
        title: checkStateTitle(f.paige_interpretation),
        why: f.paige_interpretation || "This check needs attention before the work it guards can run.",
        owner: "you",
        proof: blocking ? "blocked" : "partial",
        blockedReason: blocking
          ? `${f.paige_interpretation || "A required system isn't ready."} Clear it and this move unblocks.`
          : undefined,
        evidence: "From this workspace's latest system check.",
        outcome: "Opens Systems Check at the finding; the drafts and plan are kept.",
        // The move always routes to Systems Check, so the CTA must SAY Systems Check — never borrow
        // CHECK_DESTINATIONS' page breadcrumb, which would label a button for a page it doesn't open
        // (corr #4 — an action must go where it says).
        destination: "systems-check",
        ctaLabel: "Open Systems Check",
        rank: severityRank(f.severity_at_finding),
      });
    }

    // Offers gap blocks revenue — a high-value owner move.
    const offersItem = foundation.find((f) => f.key === "offers");
    if (offersItem && offersItem.status === "needs-input") {
      candidates.push({
        id: "gap:offers",
        title: "Add your first offer",
        why: "Everything commercial — pricing, proposals, follow-ups — waits on one real offer.",
        owner: "you",
        proof: "input",
        evidence: "You have no offer set up yet.",
        outcome: "PAIGE can build pricing and follow-ups around it.",
        destination: "catalog",
        ctaLabel: "Open Catalog",
        rank: 1.5,
      });
    }

    // Work Paige drafted, waiting on the owner.
    if (Array.isArray(pending.items) && pending.items.length > 0) {
      const n = pending.items.length;
      candidates.push({
        id: "pending:drafts",
        title: `Review ${n} draft${n === 1 ? "" : "s"} waiting on you`,
        why: pending.items[0]?.rationale || "PAIGE prepared these and stopped for your approval.",
        owner: "paige",
        proof: "live",
        evidence: `${n} item${n === 1 ? "" : "s"} PAIGE drafted and is holding for you.`,
        outcome: "You review and approve; PAIGE completes each one and records it.",
        destination: "paige",
        ctaLabel: "Open PAIGE",
        rank: 2,
      });
    }

    // Identity / website setup gaps.
    for (const item of foundation) {
      if ((item.key === "identity" || item.key === "website") && item.status === "needs-input") {
        candidates.push({
          id: `gap:${item.key}`,
          title: item.key === "identity" ? "Complete your Business Context" : "Add your website",
          why:
            item.key === "identity"
              ? "PAIGE can't ground a plan until she knows who you are and who you serve."
              : "Your website grounds your positioning and the pages PAIGE builds.",
          owner: "you",
          proof: "input",
          evidence: "This foundation isn't set up yet.",
          outcome: "The rest of the plan builds itself from it.",
          destination: "setup",
          rank: 3,
          ctaLabel: "Open Setup",
        });
      }
    }

    // Attention: clients going quiet / follow-ups — Paige can draft, owner approves.
    const at = (cc.attention ?? {}) as AttentionLike;
    if ((at.at_risk_clients ?? 0) > 0) {
      const n = at.at_risk_clients as number;
      candidates.push({
        id: "attn:atrisk",
        title: `Re-engage ${n} client${n === 1 ? "" : "s"} before they lapse`,
        why: "These crossed your usual quiet threshold. PAIGE can draft a note in your voice for each.",
        owner: "paige",
        proof: "live",
        evidence: `${n} contact${n === 1 ? "" : "s"} flagged at risk in your book.`,
        outcome: "PAIGE drafts the outreach; you approve and she sends.",
        destination: "clients",
        ctaLabel: "See the clients",
        rank: 5,
      });
    }
    if ((at.follow_ups_due ?? 0) > 0) {
      const n = at.follow_ups_due as number;
      candidates.push({
        id: "attn:followups",
        title: `${n} follow-up${n === 1 ? "" : "s"} due`,
        why: "Contacts are due a touch. PAIGE can prepare each follow-up for your approval.",
        owner: "paige",
        proof: "live",
        evidence: `${n} follow-up${n === 1 ? "" : "s"} due in your book.`,
        outcome: "PAIGE drafts them; you approve and she sends.",
        destination: "clients",
        ctaLabel: "See what's due",
        rank: 5.5,
      });
    }

    // Sending identity + knowledge gaps (lower priority).
    const sender = foundation.find((f) => f.key === "sender");
    if (sender && sender.status === "needs-input") {
      candidates.push({
        id: "gap:sender",
        title: "Set up your email sender",
        why: "Until email sending is set up, PAIGE can draft outreach but can't send it.",
        owner: "you",
        proof: "input",
        evidence: "No sending identity is set up.",
        outcome: "PAIGE can send approved messages for you.",
        destination: "connections",
        ctaLabel: "Open Connections",
        rank: 6,
      });
    }
    const know = foundation.find((f) => f.key === "knowledge");
    if (know && (know.status === "needs-input" || know.status === "incomplete")) {
      candidates.push({
        id: "gap:knowledge",
        title: "Add a knowledge source",
        why: "More of your material lets PAIGE answer clients with depth and citations.",
        owner: "you",
        proof: know.status === "needs-input" ? "input" : "partial",
        evidence: "PAIGE has little of your material to answer from.",
        outcome: "PAIGE reindexes and can answer with your own content.",
        destination: "knowledge",
        ctaLabel: "Open Knowledge",
        rank: 8,
      });
    }

    candidates.sort((a, b) => a.rank - b.rank);

    // The two strongest priority signals — the systems check and the pending-drafts queue — each
    // has an OUTAGE state distinct from "returned nothing". An all-clear must never be asserted over
    // a read that failed or hasn't settled (§13, peer-gate MAJOR): a `[]` from an errored
    // `checks`/`pending` read is "couldn't check", not "nothing is blocked or waiting".
    //
    // Fallback when no candidate surfaced.
    let best: GamePlanMove | null = candidates[0] ?? null;
    if (!best && !cc.loading && !setup.loading && !checks.loading && !pending.loading) {
      best = (checks.isError || pending.error)
        // A settled read FAILED and nothing else surfaced — say so honestly and route to the read
        // that failed; never claim all-clear over a blind signal.
        ? {
            id: "degraded:signals",
            title: "Couldn't fully check what needs you",
            why: checks.isError
              ? "PAIGE couldn't read your systems check just now, so she can't confirm what's blocked. Open it to see the latest."
              : "PAIGE couldn't load your drafts queue just now, so she can't confirm what's waiting. Open PAIGE to check.",
            owner: "you",
            proof: "partial",
            evidence: checks.isError
              ? "Your systems check didn't respond on this load."
              : "Your drafts queue didn't respond on this load.",
            outcome: "Opens the exact place to see the latest; nothing is lost.",
            destination: checks.isError ? "systems-check" : "paige",
            ctaLabel: checks.isError ? "Open Systems Check" : "Open PAIGE",
          }
        : {
            id: "fallback:paige",
            title: "Ask PAIGE what to focus on next",
            why: "Your foundation is set and nothing's blocking. Bring PAIGE a goal and she'll build the plan with you.",
            owner: "paige",
            proof: "live",
            evidence: "Nothing is blocked or waiting right now.",
            outcome: "PAIGE proposes the next moves for your approval.",
            destination: "paige",
            ctaLabel: "Open PAIGE",
          };
    }

    const rest = candidates
      .filter((c) => c.id !== best?.id)
      .slice(0, 4)
      .map(({ rank: _rank, ...m }) => m);

    return { bestMove: best, priorities: rest };
  }, [
    checks.findings, checks.loading, checks.isError,
    pending.items, pending.loading, pending.error,
    foundation, cc.attention, cc.loading, setup.loading,
  ]);

  // ── WORK IN MOTION — the recorded Rail feed, four honest states (corr #1) ────────────────
  const motion = useMemo<GamePlanMotion>(() => {
    const items: MotionItem[] = activity.items.map((a) => ({
      id: a.id,
      title: a.title,
      summary: a.summary,
      byPaige: a.byPaige,
      actorAgent: a.actorAgent,
      department: departmentLabel(a.departmentSlug),
      when: elapsedLabel(a.occurredAt),
    }));
    const freshness =
      activity.status === "ready" && items.length === 0
        ? "No recorded work yet"
        : activity.status === "ready" && items[0]
          ? `Latest ${items[0].when}`
          : "";
    return { status: activity.status, items, freshness };
  }, [activity.items, activity.status]);

  // ── SURFACE-LEVEL loading / error / empty ───────────────────────────────────────────────
  // checks + pending are IN the loading gate so the surface never commits a premature all-clear
  // frame before the two strongest priority signals have settled (§13, peer-gate MAJOR).
  const loading =
    cc.loading || setup.loading || catalog.phase === "resolving" || catalog.phase === "loading"
    || knowledge.loading || checks.loading || pending.loading;
  // §13 — a failed read is "couldn't load", never rendered as "you have nothing". Setup is the
  // grounding spine and the command-center is the operating-brief spine; a failure in either makes
  // the surface honestly unreliable (a lone knowledge-read error degrades only its own tile, below).
  const error = !!setup.error || !!cc.isError;

  const attentionTotal =
    ((cc.attention as AttentionLike)?.at_risk_clients ?? 0) +
    ((cc.attention as AttentionLike)?.follow_ups_due ?? 0);
  // Day-one only when the reads genuinely settled empty — never on a failed read, and deferring to
  // useCommandCenter.empty (which also weighs active clients) so a client-heavy tenant never sees it.
  // A workspace where the owner has SET a plan direction, or has authored campaign briefs, is NOT
  // first-run — the first-run screen would falsely claim "no approved direction" and HIDE the real
  // strategy/plays (§13/§70, Codex P1). Those two signals join the empty decision.
  const briefRec = (setup.brief ?? {}) as Partial<Record<PlanBriefField, string>>;
  const hasPlanBriefSet = PLAN_BRIEF_FIELDS.some((fld) => typeof briefRec[fld] === "string" && (briefRec[fld] as string).trim().length > 0);
  const hasCampaignBriefs = Array.isArray(campaigns.briefs) && campaigns.briefs.length > 0;
  const empty =
    !loading &&
    !!cc.empty &&
    !knowledge.error &&
    !pending.error &&
    !hasPlanBriefSet &&
    !hasCampaignBriefs &&
    coverage.grounded === 0 &&
    (Array.isArray(catalog.offers) ? catalog.offers.length : 0) === 0 &&
    (knowledge.documentsIndexed ?? 0) === 0 &&
    (pending.items?.length ?? 0) === 0 &&
    (cc.counts?.approvals ?? 0) === 0 &&
    attentionTotal === 0;

  const greeting = useMemo(() => {
    const now = new Date();
    // Greet by the signed-in person's name only when BOTH hold (§57/§13):
    //  (1) they own this active workspace (viewerOwnsWorkspace), AND
    //  (2) the name is a GENUINE personal name — not the business-name fallback.
    // `cc.greeting.name` (useCommandCenter) resolves to `authName || activeTenant.name || "there"`, so
    // when the signed-in owner has no display name it silently becomes the WORKSPACE name. Voicing the
    // business name as if it were a person ("Good evening, <business>") is the same identity mislabel —
    // so a name equal to the workspace name (or the neutral "there") is treated as "no personal name"
    // and we greet neutrally rather than voice a business name as a person.
    const ccName = (cc.greeting?.name || "").trim();
    const workspaceName = (activeTenant?.name || "").trim();
    const nameIsPersonal = !!ccName && ccName !== "there" && ccName !== workspaceName;
    const name = viewerOwnsWorkspace && nameIsPersonal ? firstToken(ccName) : "there";
    return {
      name,
      dateLabel: now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
      salutation: salutationFor(now),
    };
  }, [cc.greeting?.name, activeTenant?.name, viewerOwnsWorkspace]);

  // Each summary chip carries the REAL surface that backs it, so a confident count is never a dead
  // label — clicking it opens the supporting surface where the evidence lives (owner request, §36).
  const attention = useMemo(() => {
    const chips: Array<{ label: string; tone: ProofState; destination: GamePlanDestination }> = [];
    if (bestMove?.proof === "blocked")
      chips.push({ label: "1 move blocked", tone: "blocked", destination: bestMove.destination });
    const n = cc.counts?.approvals ?? 0;
    if (n > 0)
      chips.push({ label: `${n} draft${n === 1 ? "" : "s"} waiting`, tone: "live", destination: "paige" });
    const at = (cc.attention ?? {}) as AttentionLike;
    if ((at.at_risk_clients ?? 0) > 0)
      chips.push({ label: `${at.at_risk_clients} contact${at.at_risk_clients === 1 ? "" : "s"} at risk`, tone: "partial", destination: "clients" });
    if ((at.follow_ups_due ?? 0) > 0)
      chips.push({ label: `${at.follow_ups_due} follow-up${at.follow_ups_due === 1 ? "" : "s"} due`, tone: "live", destination: "clients" });
    // Honest indicator that a priority signal is BLIND — present regardless of what else surfaced,
    // so a failed read is never invisible behind an otherwise-confident brief (§13, peer-gate). It
    // routes to the surface where the owner can re-check the failed read.
    if (checks.isError) chips.push({ label: "Couldn't check your systems", tone: "partial", destination: "systems-check" });
    if (pending.error) chips.push({ label: "Couldn't load your drafts", tone: "partial", destination: "paige" });
    return chips;
  }, [bestMove?.proof, bestMove?.destination, cc.counts?.approvals, cc.attention, checks.isError, pending.error]);

  const signalsDegraded = !!checks.isError || !!pending.error;
  const narrative = useMemo(() => {
    if (bestMove?.proof === "blocked")
      return "Your plan is ready, but the top move is blocked. Clear the blocker and PAIGE can act.";
    if (coverage.grounded < coverage.total) {
      const remaining = coverage.total - coverage.grounded - coverage.degraded;
      const tail = coverage.degraded > 0 ? " Some readiness reads didn't respond just now." : "";
      if (remaining <= 0)
        return `PAIGE has grounded ${coverage.grounded} of ${coverage.total} foundations.${tail} PAIGE plans from what you've set.`;
      return `PAIGE has grounded ${coverage.grounded} of ${coverage.total} foundations. ${
        remaining === 1 ? "One is left" : `${remaining} are left`
      } — the next move builds from what you set.${tail}`;
    }
    if ((cc.counts?.approvals ?? 0) > 0 || attentionTotal > 0)
      return "Foundations are set and work is moving. Here's what needs you and the best move to make now.";
    // Foundations are set and nothing else surfaced — but only claim all-clear when the priority
    // reads actually answered; otherwise say plainly that PAIGE couldn't fully check (§13).
    if (signalsDegraded)
      return "Your foundations are set, but PAIGE couldn't fully check what needs you just now. Open the flagged item to see the latest.";
    return "Foundations are set. Bring PAIGE a goal and she'll build the next moves with you.";
  }, [bestMove?.proof, coverage.grounded, coverage.total, coverage.degraded, cc.counts?.approvals, attentionTotal, signalsDegraded]);

  const firstRun = useMemo(
    () => [
      { label: "Complete your Business Context", hint: "Who you serve and what you sell", destination: "setup" as const },
      { label: "Add your first offer", hint: "So PAIGE knows what work to move", destination: "catalog" as const },
      { label: "Connect one operating system", hint: "Calendar or email, to act for real", destination: "connections" as const },
    ],
    [],
  );

  // ── STRATEGY-DESK derivations (owner-approved reimagination) ──────────────────────────────
  // The editable plan spine rides the EXISTING setup-brief save seam (§18 one home) — an owner edit
  // of these planning fields persists exactly as Solo Settings → Setup does, provenance-stamped and
  // optimistic-concurrency guarded. Nothing here fabricates strategy: empty fields read as honest
  // absence, and a Paige suggestion is a pending PROPOSAL the owner applies or dismisses (§13).
  const setupBrief = (setup.brief ?? EMPTY_SOLO_SETUP_BRIEF) as SoloSetupBrief;

  const planBrief = useMemo<PlanBrief>(() => {
    const fields = {} as Record<PlanBriefField, string>;
    const provenance: Partial<Record<PlanBriefField, SetupFactSource>> = {};
    for (const f of PLAN_BRIEF_FIELDS) {
      fields[f] = typeof setupBrief[f] === "string" ? (setupBrief[f] as string) : "";
      const src = setupBrief.provenance?.[f]?.source;
      if (src) provenance[f] = src;
    }
    const hasPlan = PLAN_BRIEF_FIELDS.some((f) => fields[f].trim().length > 0);

    // The confirmation label must reflect when the PLAN fields were confirmed, not the whole-record
    // `updatedAt` (which advances on any unrelated Setup save, fabricating recency — Codex P2). Use
    // the latest confirmedAt among the plan fields' own provenance; undefined ⇒ the label omits a date.
    let planConfirmedAt: string | undefined;
    for (const f of PLAN_BRIEF_FIELDS) {
      const at = setupBrief.provenance?.[f]?.confirmedAt;
      if (typeof at === "string" && (!planConfirmedAt || at > planConfirmedAt)) planConfirmedAt = at;
    }

    // Is the pending proposal confined to the plan fields THIS surface shows? A proposal patch can
    // also carry identity fields (legalName/publicName/website); applying those from a banner that
    // shows only a free-form reason would overwrite unseen business truth (Codex P1). A mixed
    // proposal is routed to Setup (where every field is shown + staged), never inline-applied here.
    const proposalPatchKeys = Object.keys(setup.pendingProposal?.patch ?? {});
    const proposalPlanOnly =
      proposalPatchKeys.length > 0 && proposalPatchKeys.every((k) => (PLAN_BRIEF_FIELDS as string[]).includes(k));

    const save = (next: Partial<Record<PlanBriefField, string>>) => {
      const merged: SoloSetupBrief = { ...EMPTY_SOLO_SETUP_BRIEF, ...setupBrief };
      for (const f of PLAN_BRIEF_FIELDS) if (typeof next[f] === "string") merged[f] = next[f] as string;
      const confirmed = prepareOwnerConfirmedBrief(merged, new Date().toISOString(), setupBrief, {});
      // A plain owner edit passes proposalId=null — it must NOT resolve/consume a pending Paige
      // proposal the owner never acted on (matches the sibling Setup seam; only applyProposal below
      // passes the proposal id). Consuming it on an unrelated edit is a §13 surprise + §37 divergence.
      return setup.save(confirmed, setup.businessOwners ?? [], null);
    };
    const applyProposal = async () => {
      const proposal = setup.pendingProposal ?? null;
      if (!proposal) return { ok: false as const, kind: "failed" as const, error: "No proposal to apply." };
      // Refuse to apply a proposal that reaches beyond the plan fields shown here — it must be
      // reviewed in Setup where its identity fields are displayed and staged (Codex P1).
      const patchKeys = Object.keys(proposal.patch ?? {});
      if (!(patchKeys.length > 0 && patchKeys.every((k) => (PLAN_BRIEF_FIELDS as string[]).includes(k)))) {
        return { ok: false as const, kind: "failed" as const, error: "This proposal also changes your business details — review it in Setup." };
      }
      const applied = applySetupProposal({ ...EMPTY_SOLO_SETUP_BRIEF, ...setupBrief }, proposal);
      const confirmed = prepareOwnerConfirmedBrief(applied, new Date().toISOString(), setupBrief, {});
      return setup.save(confirmed, setup.businessOwners ?? [], proposal.id);
    };
    const dismissProposal = () => setup.dismissProposal(setup.pendingProposal?.id ?? "");

    return {
      fields, provenance, hasPlan,
      canEdit: !!setup.canEdit,
      saving: !!setup.saving,
      pendingProposal: setup.pendingProposal ?? null,
      proposalPlanOnly,
      updatedAt: planConfirmedAt,
      save, applyProposal, dismissProposal,
    };
  }, [setupBrief, setup]);

  const horizons = useMemo<PlanHorizon[]>(() => {
    const f = planBrief.fields;
    return [
      { id: "annual", label: "Annual", sub: "This year", direction: f.annualDirection, outcome: f.successDefinition, defined: !!f.annualDirection.trim() },
      { id: "quarter", label: "This quarter", sub: "90 days", direction: f.currentPriority || f.goals90Day, outcome: f.goals90Day, defined: !!(f.currentPriority.trim() || f.goals90Day.trim()) },
    ];
  }, [planBrief.fields]);

  const playsStatus = (campaigns.phase ?? "loading") as PlaysStatus;
  const plays = useMemo<PlayCard[]>(() => {
    const rows: CampaignBrief[] = campaigns.phase === "ready" && Array.isArray(campaigns.briefs) ? campaigns.briefs : [];
    return rows.map((b) => ({
      id: b.id,
      name: (b.name || b.objective || "Campaign play").trim(),
      objective: b.objective || "",
      audience: b.audience || "",
      angle: b.positioning || "",
      window: b.timing || "",
      channels: Array.isArray(b.channels) ? b.channels.join(", ") : "",
      outcome: b.desiredOutcome || "",
      successSignal: b.successDefinition || "",
      offerName: b.offerName ?? null,
      status: b.lifecycleStatus || "draft",
      blocked: b.lifecycleStatus === "blocked",
    }));
  }, [campaigns.phase, campaigns.briefs]);

  // Supporting dependencies — the DEMOTED Systems Check (blocking/high fails only), never the spine.
  const dependencies = useMemo<DependencyItem[]>(() => {
    const findings = Array.isArray(checks.findings) ? checks.findings : [];
    return findings
      .filter((f) => f.status === "fail" && (f.severity_at_finding === "blocking" || f.severity_at_finding === "high"))
      .sort((a, b) => severityRank(a.severity_at_finding) - severityRank(b.severity_at_finding))
      .map((f) => ({
        id: `dep:${f.id}`,
        title: checkStateTitle(f.paige_interpretation),
        reason: f.paige_interpretation || "This setup check needs attention before the work it guards can run.",
        blocking: f.severity_at_finding === "blocking",
      }));
  }, [checks.findings]);

  // A failed systems-check read must never render as a verified "All clear" — an empty `findings`
  // from an ERRORED read is "couldn't check", not "nothing is blocking" (§13, peer-gate MAJOR).
  const dependenciesStatus: "ready" | "unavailable" = checks.isError ? "unavailable" : "ready";

  // Decision & opportunity desk — real signals only, each source-labelled honestly (§13). Paige-drafted
  // work and at-risk / follow-up nudges are RECOMMENDATIONS the owner decides on; never fabricated.
  const decisions = useMemo<DecisionItem[]>(() => {
    const out: DecisionItem[] = [];
    const drafts = Array.isArray(pending.items) ? pending.items : [];
    if (drafts.length > 0) {
      out.push({
        id: "decision:drafts",
        title: `Review ${drafts.length} draft${drafts.length === 1 ? "" : "s"} Paige is holding`,
        detail: drafts[0]?.rationale || "Paige prepared these and stopped for your approval.",
        source: "recommendation", waiting: true, destination: "paige",
        evidence: `${drafts.length} item${drafts.length === 1 ? "" : "s"} Paige drafted, waiting on you.`,
      });
    }
    const at = (cc.attention ?? {}) as AttentionLike;
    if ((at.at_risk_clients ?? 0) > 0) {
      const n = at.at_risk_clients as number;
      out.push({
        id: "decision:atrisk",
        title: `Re-engage ${n} client${n === 1 ? "" : "s"} before they lapse`,
        detail: "These crossed your usual quiet threshold. Paige can draft a note in your voice for each.",
        source: "recommendation", waiting: false, destination: "clients",
        evidence: `${n} contact${n === 1 ? "" : "s"} flagged at risk in your book.`,
      });
    }
    if ((at.follow_ups_due ?? 0) > 0) {
      const n = at.follow_ups_due as number;
      out.push({
        id: "decision:followups",
        title: `${n} follow-up${n === 1 ? "" : "s"} due`,
        detail: "Contacts are due a touch. Paige can prepare each follow-up for your approval.",
        source: "recommendation", waiting: false, destination: "clients",
        evidence: `${n} follow-up${n === 1 ? "" : "s"} due in your book.`,
      });
    }
    return out;
  }, [pending.items, cc.attention]);

  // A failed drafts read must never render as "All caught up" — an empty `decisions` from an errored
  // pending read is "couldn't check", not "nothing waiting" (§13, Codex P2).
  const decisionsStatus: "ready" | "unavailable" = pending.error ? "unavailable" : "ready";

  return {
    loading,
    error,
    empty,
    greeting,
    narrative,
    attention,
    bestMove,
    priorities,
    foundation,
    coverage,
    motion,
    firstRun,
    planBrief,
    horizons,
    plays,
    playsStatus,
    decisions,
    decisionsStatus,
    dependencies,
    dependenciesStatus,
    refresh,
  };
}
