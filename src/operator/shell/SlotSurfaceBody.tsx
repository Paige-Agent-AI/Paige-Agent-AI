/**
 * Resolves a slot/view address to what actually renders there.
 *
 * Three outcomes, in this order (`viewSources.ts` decides which):
 *   1. a BESPOKE component that already reads live data — mounted with its real hook;
 *   2. one or more PORTED CD panel specs — the surface's designed shape, figures still stand-ins;
 *   3. ABSENCE — nothing shipped answers this view, so it says so.
 *
 * (3) is why this file exists. Rendering a header, a tab row and an empty section is the
 * blank-screen failure this console has already been rejected for twice; an absence that names
 * what is missing is the designed alternative and reads as a decision rather than a bug.
 *
 * HOOK ORDER IS UNCONDITIONAL. Every read is declared on every render and gated by its own
 * `enabled` flag, the shape `useFleet`/`useCompass` already use — an inactive surface costs
 * nothing, and no early return can change how many hooks ran.
 */
import { lazy, Suspense, useCallback, useState } from "react";
import type { OperatorSlot } from "@/operator/ia/operatorIA";
import { viewSlug } from "@/operator/ia/operatorIA";
import { viewSource } from "@/operator/ia/viewSources";
import { getPanelSpec } from "@/operator/surfaces/panelSpecs";
import { useCompass } from "@/operator/data/useCompass";
import { useKnowledge } from "@/operator/data/useKnowledge";
import { isOwnerTier, useOperatorStanding } from "@/lib/auth/operatorStanding";

/**
 * ELEVATION IS DISTANCE FROM `--pg-env` (the console's token rule; first written up as the v3
 * pack's "Ruling F", 2026-08-23 — reference, not authority, per root `CLAUDE.md` §00).
 * `--pg-surface` sits ABOVE canvas in dark and BELOW it in light, so the role inverts between
 * themes and a plate painted on it RECEDES in light. A plate that rises off the canvas — a card,
 * a KPI tile, a control, a popover — paints `--pg-raised` in BOTH themes; `--pg-surface` is kept
 * for regions that genuinely recede (a well, an inset strip, a sunken list).
 *
 * AND FILL ALONE CANNOT CARRY IT. In light, `--pg-raised` `#fffdf8`
 * on `--pg-canvas` `#fbf9f5` is three units — correct, and invisible on its own. Separation on a
 * raised plate is `--pg-rim` PLUS `--pg-lift-1`: the rim is a seated inset pair (a top highlight
 * and a bottom shade, L21/L28) and the lift is the outer cast (L22/L29). Carrying the rim alone
 * left only insets, which read as a plain outline against the 1.5px border — a "hairline
 * outline" rather than a raised plate. Both tokens ship at the pack's values; this is where they
 * are spent.
 * The pack pairs them exactly this way at L9420 and L9477: `var(--pg-rim), var(--pg-lift-N)`.
 *
 * AND WHY THE RIM WAS NOT PAINTING AT ALL — measured, not inferred. `shadow-[shadow:var(--pg-rim)]`
 * does NOT compile to a box-shadow. Tailwind 3 cannot type a bare `var()` and resolves the
 * `shadow-` arbitrary value to `--tw-shadow-COLOUR`; the emitted rule is
 * `{--tw-shadow-color: var(--pg-rim)}` (verified in the built CSS), which recolours a shadow
 * that was never declared, so `getComputedStyle(...).boxShadow` came back `none` on every one
 * of these plates in BOTH themes. All the separation on screen was the 1.5px border — which is
 * exactly why it read as "a plain border." The `shadow:` data-type hint
 * (`shadow-[shadow:var(--pg-rim),var(--pg-lift-1)]`) is what makes Tailwind emit `box-shadow`,
 * the same hint `text-[length:var(--pg-t-body)]` already uses throughout this console.
 */

const OperatorPanel = lazy(() => import("@/operator/surfaces/OperatorPanel"));
const FleetConsole = lazy(() => import("@/operator/surfaces/FleetConsole"));
const SystemsCheckSurface = lazy(() => import("@/operator/surfaces/SystemsCheckSurface"));
const FleetHistorySurface = lazy(() => import("@/operator/surfaces/FleetHistorySurface"));
const FleetAlertRulesSurface = lazy(() => import("@/operator/surfaces/FleetAlertRulesSurface"));
// FleetTeamPulseSurface is gone, not merely undispatched: the v3 pack draws Team Pulse nowhere,
// analytics/platform-health renders the pack's own Platform health surface, and the retired-pack
// component was stripped on 2026-09-23 (§30). What is owed to the v3 Settings → Team port is the
// roster READ, which survives at @/operator/data/useTeamPulse.ts — see the §58 record in
// viewSources.ts.
const PlatformHealthSurface = lazy(() => import("@/operator/surfaces/PlatformHealthSurface"));
const TrustCompass = lazy(() => import("@/operator/surfaces/TrustCompass"));
const KnowledgeSurface = lazy(() => import("@/operator/surfaces/KnowledgeSurface"));
const CampaignsActive = lazy(() => import("@/operator/surfaces/campaigns/CampaignsActive"));
const CatalogSurface = lazy(() => import("@/operator/surfaces/campaigns/CatalogSurface"));
const SalesSurface = lazy(() => import("@/operator/surfaces/campaigns/SalesSurface"));
const SocialSurface = lazy(() => import("@/operator/surfaces/campaigns/SocialSurface"));
const PeopleSurface = lazy(() => import("@/operator/surfaces/relationships/PeopleSurface"));
const ConversationsSurface = lazy(
  () => import("@/operator/surfaces/relationships/ConversationsSurface"),
);
const SegmentsSurface = lazy(() => import("@/operator/surfaces/relationships/SegmentsSurface"));
const StorefrontSurface = lazy(() => import("@/operator/surfaces/marketplace/StorefrontSurface"));
const SetupSurface = lazy(() => import("@/operator/surfaces/settings/SetupSurface"));
const CapabilitiesSurface = lazy(() => import("@/operator/surfaces/settings/CapabilitiesSurface"));
const IntelligenceSurface = lazy(() => import("@/operator/surfaces/settings/IntelligenceSurface"));
const ConnectionsSettings = lazy(() => import("@/operator/surfaces/settings/SettingsDestinations").then((m) => ({ default: m.ConnectionsSettings })));
const AnalyticsSettings = lazy(() => import("@/operator/surfaces/settings/SettingsDestinations").then((m) => ({ default: m.AnalyticsSettings })));
const BillingSettings = lazy(() => import("@/operator/surfaces/settings/SettingsDestinations").then((m) => ({ default: m.BillingSettings })));
const TeamSettings = lazy(() => import("@/operator/surfaces/settings/SettingsDestinations").then((m) => ({ default: m.TeamSettings })));
const MarketCatalogSurface = lazy(
  () => import("@/operator/surfaces/marketplace/MarketCatalogSurface"),
);
const PublishersSurface = lazy(() => import("@/operator/surfaces/marketplace/PublishersSurface"));

/**
 * THE FOUR v3 SURFACES THAT WERE PORTED AND NEVER MOUNTED (Claude Design audit, 2026-08-23).
 *
 * *"~370 KB of ported pack surface that never reaches a screen… That is a dispatch problem, not
 * a port problem — most of it is one file away from being on screen."* Correct about the
 * dispatch. The size is the part worth re-measuring, and it changes what may be mounted.
 *
 * **Only FOUR of the unmounted files are ports of THIS pack.** Every surface under `surfaces/`
 * was checked for which pack it cites, allowing for a citation wrapped across comment lines:
 *
 *   v3 (`PAIGE Super Admin Shell v3.dc.html`) ..... 93 KB — the four below
 *   SUPERSEDED (`Super Admin Shell.dc.html`) ..... 232 KB — MarketplaceSurfaces ·
 *       CalendarSurfaces · PipelineSurfaces · SettingsSurfaces · AnalyticsSurfaces ·
 *       SocialSurfaces · ComposeSurface · SupportThread · OperatorChatRail
 *
 * The 232 KB is a port of the pack the owner ruled dead on 2026-08-22. `SettingsSurfaces.tsx`
 * names its source in its own header — *"Claude Design's five settings surfaces, on CD's one
 * panel layout (Super Admin Shell.dc.html)"* — and cites L5024 / L6382 / L6857 / L6334 / L4968,
 * which in v3 land on a deal-notes foot, a mark style and `segVals`. Different document.
 *
 * **Mounting those would inject the retired design into the new shell** — the exact failure the
 * redesign exists to end, arriving through the fix for it. They are not mounted here. They are
 * §30 strip candidates, and that is its own slice with its own evidence.
 */
const CalendarWeekField = lazy(() =>
  import("@/operator/surfaces/CalendarFieldSurface").then((m) => ({ default: m.CalendarWeekField })));
const SubmissionsQueue = lazy(() =>
  import("@/operator/surfaces/MarketplaceSubmissionsSurface").then((m) => ({ default: m.SubmissionsQueue })));
const IntegrationsSurface = lazy(() => import("@/operator/surfaces/IntegrationsSurface"));

/**
 * `ComposeOutbound` is the FOURTH v3 port and is deliberately NOT mounted here — reported, not
 * dropped. It is the composer out of `convoVals` (v3 L5241-L5470), and `convoVals` is a 315-line
 * three-pane console: channel filters, the thread list, the thread, and the person rail that is
 * the same record People lists. The composer is one pane of it.
 *
 * Mounting it alone at `relationships/conversations` would put a v3 composer on screen with no
 * threads to compose against — trading the retired console's panels for a fragment, which is not
 * obviously the better trade and is a question about what renders where. So Conversations keeps
 * its current panels until `convoVals` is ported, and that port is the slice that mounts this.
 */

/** A crafted hold, not a bare "Loading…" — the surfaces below are code-split. */
function Holding() {
  return (
    <div className="min-w-0 space-y-3" aria-busy="true">
      <div className="h-4 w-40 animate-pulse rounded bg-[var(--pg-workspace)]" />
      <div className="h-24 w-full animate-pulse rounded-[12px] bg-[color-mix(in_srgb,var(--pg-workspace)_60%,transparent)]" />
    </div>
  );
}

export default function SlotSurfaceBody({ slot, view }: { slot: OperatorSlot; view?: string }) {
  const active = view ?? slot.views[0];
  const src = active ? viewSource(slot.id, viewSlug(active)) : null;
  const bespoke = src?.bespoke;

  // Is this session the platform owner? The one server answer, through the one client home.
  // null = not answered yet (resolving, or could not verify): callers wait, never read it as "no".
  const standing = useOperatorStanding();
  const isOwner =
    standing.phase === "known" ? isOwnerTier(standing.standing) : standing.phase === "signed_out" ? false : null;
  const compass = useCompass(bespoke === "TrustCompass");
  const knowledge = useKnowledge(bespoke === "KnowledgeSurface");

  /**
   * The pack's `announcement` channel, as the polite live region stage2 §8 specifies: *"Scope
   * changes, act completion and interruption announce through one polite live region."* It sits
   * here rather than in the shell only because the shell has no announcements of its own yet —
   * when `cycleScope` / `exitScope` land theirs, this moves up and there is ONE (§18).
   */
  const [said, setSaid] = useState("");
  const announce = useCallback((m: string) => setSaid(m), []);

  /**
   * A contextual summon has no body ported yet — `openSummon` on the shell takes a `CapabilityId`,
   * which is the ten palette verbs, not the pack's twenty-eight summons. So a control that opens
   * one cannot open anything today, and §13 forbids a control that silently does nothing: it says
   * what it needs instead. When the summon bodies land this becomes `onSummon(id)` and the
   * announcement goes with it.
   */
  const summonNotWired = useCallback((what: string) => () => {
    setSaid(what + " is drawn in the pack and its panel is not ported yet. Nothing opened.");
  }, []);

  if (bespoke) {
    return (
      <Suspense fallback={<Holding />}>
        <p aria-live="polite" className="sr-only">{said}</p>
        {bespoke === "FleetConsole" && <FleetConsole isPlatformOwner={isOwner} />}
        {bespoke === "SystemsCheckSurface" && <SystemsCheckSurface />}
        {bespoke === "FleetHistorySurface" && <FleetHistorySurface />}
        {bespoke === "FleetAlertRulesSurface" && <FleetAlertRulesSurface />}
        {bespoke === "PlatformHealthSurface" && <PlatformHealthSurface />}
        {bespoke === "IntelligenceSurface" && <IntelligenceSurface key={`${slot.id}/${active}`} />}
        {bespoke === "ConnectionsSettings" && <ConnectionsSettings />}
        {bespoke === "AnalyticsSettings" && <AnalyticsSettings />}
        {bespoke === "BillingSettings" && <BillingSettings />}
        {bespoke === "TeamSettings" && <TeamSettings />}
        {/* Read-only until the lane WRITE path lands: no `onCommit`, and the surface says so
            itself rather than offering a control that silently discards the movement. */}
        {bespoke === "TrustCompass" && (
          <TrustCompass departments={compass.departments} loading={compass.loading} error={compass.error} />
        )}
        {bespoke === "KnowledgeSurface" && (
          <KnowledgeSurface domains={knowledge.domains} loading={knowledge.loading} error={knowledge.error} />
        )}

        {/* THE CAMPAIGNS MONEY SPINE · BUILD-ORDER Layer 3b, ported as ONE group because they
            share one contract: Active's `Sells`/`Booked` is the join from a campaign to a
            catalogue row, and Sales sums the lines that join produces. Porting them apart would
            have meant reading that contract three times and drifting.

            Each takes NO rows. Structure before data — the shape ports, every figure with no
            read behind it renders an em-dash, and the slot's authored absence says what is
            missing and why. Layer 6 hands them real rows and nothing about the render changes.

            The one figure that is already real is the campaign grant: `clampGrant` runs it
            through the SAME scale the Trust Compass ceiling uses, so a campaign can never read
            a grant the platform's rung does not permit. */}
        {bespoke === "CampaignsActive" && <CampaignsActive />}
        {bespoke === "CatalogSurface" && <CatalogSurface />}
        {bespoke === "SalesSurface" && <SalesSurface />}
        {bespoke === "SocialSurface" && <SocialSurface />}

        {/* THE RELATIONSHIPS GROUP · BUILD-ORDER Layer 3a, ported as ONE group for the same
            reason as the money spine: they share a contract. A thread points at a person, a
            segment is a rule over the People book, and each surface's acts open the other two.

            Each takes NO rows — structure before data — and each renders the slot's own authored
            absence in place of a table that would otherwise read as a bug. Conversations is also
            the slice that finally mounts `ComposeOutbound`: it was ported ahead of its host and
            has been sitting behind a reachability exemption ever since, because a composer with
            no threads to compose against is a fragment. It has its host now. */}
        {bespoke === "PeopleSurface" && <PeopleSurface onAnnounce={announce} />}
        {bespoke === "ConversationsSurface" && <ConversationsSurface onAnnounce={announce} />}
        {bespoke === "SegmentsSurface" && <SegmentsSurface />}

        {/* THE MARKETPLACE GROUP · BUILD-ORDER Layer 3c. Submissions already shipped as
            `SubmissionsQueue`; these are the other three views of the same slot, and they read
            the same five kinds and four publisher classes out of `marketplaceVocabulary.ts`,
            which is why that module was written as a shared home before any of them existed.

            None takes rows. What IS already real on all three is the ceiling arithmetic: a
            listing's requested grant is ranked against the platform's stored Trust Compass rung,
            so nothing can read "Installed" when the platform would not let it act. With no rung
            stored, every state reads plainly and the capped figure is an em-dash — the pack
            defaults that ceiling to 2, and inheriting a demo default would have the console
            assert a governance rung nobody set. */}
        {bespoke === "StorefrontSurface" && <StorefrontSurface onAnnounce={announce} />}
        {bespoke === "SetupSurface" && <SetupSurface onAnnounce={announce} />}
        {bespoke === "CapabilitiesSurface" && <CapabilitiesSurface onAnnounce={announce} />}
        {bespoke === "MarketCatalogSurface" && <MarketCatalogSurface />}
        {bespoke === "PublishersSurface" && <PublishersSurface />}

        {/* The four v3 ports, mounted. Each takes `null` where a read belongs and renders the
            pack's own absence for it — which is what they were built to do, so they are correct
            on screen before a single hook exists. Wiring each read is its own slice. */}
        {bespoke === "CalendarWeekField" && (
          <CalendarWeekField
            days={null}
            events={null}
            onOpenCalSet={summonNotWired("Calendar settings")}
            onAnnounce={announce}
          />
        )}
        {bespoke === "SubmissionsQueue" && (
          <SubmissionsQueue
            submissions={null}
            onOpen={summonNotWired("The submission")}
            onAnnounce={announce}
          />
        )}
        {bespoke === "IntegrationsSurface" && (
          <IntegrationsSurface onOpen={() => summonNotWired("The vendor panel")()} />
        )}
      </Suspense>
    );
  }

  const specs = (src?.panels ?? [])
    .map((key) => {
      const [a, b, c] = key.split("/");
      return getPanelSpec(a, b, c);
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (specs.length) {
    return (
      <Suspense fallback={<Holding />}>
        <div className="flex min-w-0 flex-col gap-4">
          {specs.map((spec, i) => (
            <OperatorPanel key={src!.panels![i]} spec={spec} />
          ))}
        </div>
      </Suspense>
    );
  }

  return <Absence slot={slot} />;
}

/** The IA's own words where it has them; otherwise the honest general form. */
function Absence({ slot }: { slot: OperatorSlot }) {
  const title = slot.absence?.title ?? "Not wired yet";
  const body =
    slot.absence?.body ??
    "This view is specified and has a place in the console, but no surface behind it reads live data yet. It is listed here so it is visible rather than missing.";
  return (
    <div className="min-w-0 max-w-[68ch] rounded-[12px] border border-border bg-[var(--pg-raised)] p-6 shadow-[shadow:var(--pg-rim),var(--pg-lift-1)]">
      <h2 className="min-w-0 text-[13px] font-semibold text-foreground">{title}</h2>
      <p className="mt-2 min-w-0 text-[13px] leading-[1.6] text-muted-foreground">{body}</p>
    </div>
  );
}
