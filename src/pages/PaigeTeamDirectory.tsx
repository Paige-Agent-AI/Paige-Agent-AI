import type { LucideIcon } from "lucide-react";
import {
  Users2,
  ShieldCheck,
  Megaphone,
  HeartHandshake,
  GraduationCap,
  Target,
  Cog,
  Sparkles,
  Wand2,
  Bot,
  Zap,
  Gem,
  Star,
  Rocket,
  Cpu,
} from "lucide-react";
import { PageShell, PageHeader, SectionCard, GlyphPlate, EmptyState, VP_ROSTER, type VP } from "@/components/ui/page";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenantSpecialists, type TenantSpecialist } from "@/hooks/usePaigeOrchestrator";

/**
 * PaigeTeamDirectory — the canonical "About Your Paige Team" page (#244).
 *
 * The ONE place a tenant / operator / agency learns who Paige and her six VPs are
 * and what each of them does. It is the "learn about them" layer of the three-layer
 * VP framework: chat = talk to them, Command Center = see them work, THIS page =
 * learn about them.
 *
 * SINGLE SOURCE OF TRUTH (§12/§18). Every VP name + remit comes from the exported
 * {@link VP_ROSTER} (#243) — this page never re-declares the roster. The only
 * page-local copy is the one-line "what they do" description and the display icon,
 * both keyed `Record<VP, …>` so a roster change is a TypeScript error here, not a
 * silent drift.
 *
 * TRI-SCOPE (§9/§35). The SAME six VPs serve all three surfaces; only the framing
 * subhead flips with `scope`. The roster is identical everywhere — one component,
 * a scope prop set by the route (never a user-facing switcher).
 *
 * NOT A PICKER (§20/§21). A read-only directory: PAIGE + her six VPs as cards. No
 * tabs, chips, modes, or agent-selector — nothing makes the human classify a
 * request or pick a VP before talking to Paige.
 *
 * NO GOLD ON AN ACT (§11). A learn-about page has no act/approve/on moment, so no
 * gold is spent on one: the specialist grid plates rest on the indigo hairline
 * (`ring="indigo"`), the remit chips are neutral, there is no gold fill/text and no
 * armed ring. The only gold present is the shared GlyphPlate's platform-standard
 * faint rest hairline on the header plate (the same one every PageHeader carries)
 * and the Paige brand mark itself (the identity, never a CTA). Token-only, AA in
 * both themes, compact header (§11 banner rule — content leads).
 *
 * §36 — instantly legible: a non-technical user reads "these are the members of my
 * Paige team and what each one does" in about five seconds.
 *
 * CUSTOM SPECIALISTS (#247, §14 keepers). On the tenant AND agency surfaces, a
 * second section below the VP grid surfaces the caller's OWN Paige-forged
 * specialists — the "keepers" Paige builds for a job THIS account does often. It
 * is absent operator-side: the operator is the platform, not a tenant, so it has
 * no per-tenant forged roster of its own (and never a cross-tenant aggregate —
 * §51). The seven VPs are everyone's (VP_ROSTER, `tenant_id IS NULL`); the custom
 * specialists are this caller's alone (`tenant_id = current_user_tenant_id()`),
 * read tenant-scoped by RLS (§9/§51 — see {@link useTenantSpecialists}). On the
 * agency surface that resolver returns the AGENCY PARENT's own single tenant, so
 * an agency sees the keepers IT forged — never a merged roster of its sub-accounts
 * (the RLS floor makes an aggregate structurally impossible; no SECURITY DEFINER
 * bypass is added — §45). A sub-account likewise sees only its own. Still a
 * READ/LEARN surface:
 * forging a new specialist is a §20 chat act, so this section offers at most an
 * "ask Paige in chat" invite — never a create-form, picker, or manage control
 * (those live operator-side in SubAgentsAdmin at /admin/sub-agents, a different
 * audience §9). Tenant-private only: no Marketplace-share / for-hire / publish UI
 * (owner ruling 2026-08-04 — that expansion is Wave 10, hard out of scope here).
 */

export type PaigeTeamScope = "tenant" | "operator" | "agency";

/** Fixed display order — the orchestrator leads, then her six specialists. */
const ORDER: VP[] = ["PAIGE", "VERA", "NEXUS", "CURA", "MENTOR", "MERIT", "ZION"];

/**
 * The one-line "what they do", in the house voice (§3), for ordinary businesses.
 * Funding/credit stays opt-in. Keyed by `VP` so it can never miss a roster
 * member or name one that doesn't exist.
 */
const WHAT_THEY_DO: Record<VP, string> = {
  PAIGE: "Runs your whole team and hands each job to the right specialist.",
  VERA: "Explains your business performance, financial evidence and risks.",
  NEXUS: "Fills your pipeline — campaigns, content, and reaching new clients.",
  CURA: "Keeps every client cared for, onboarded, and moving forward.",
  MENTOR: "Builds and delivers your programs, sessions, and materials.",
  MERIT: "Turns interest into signed clients and keeps revenue on track.",
  ZION: "Handles the busywork behind the scenes so nothing slips.",
};

/** The embossed display glyph for each VP (indigo plate, never gold — §11). */
const VP_ICON: Record<VP, LucideIcon> = {
  PAIGE: Users2, // Paige renders as the brand mark on the lead card; this is a fallback.
  VERA: ShieldCheck,
  NEXUS: Megaphone,
  CURA: HeartHandshake,
  MENTOR: GraduationCap,
  MERIT: Target,
  ZION: Cog,
};

/** Scope only frames the subhead; the roster is identical across all three (§9/§35). */
const SCOPE_SUBHEAD: Record<PaigeTeamScope, string> = {
  tenant: "The team working inside your practice.",
  operator: "The team Paige runs across the platform.",
  agency: "The team Paige runs across your book of accounts.",
};

/**
 * The shared team-member card — one home for the card style (§12/§18) so the VP
 * grid and the custom-specialist grid can never drift apart. Gold-free by design
 * (§11): indigo plate, neutral remit chip. `remit` is optional and guards a
 * missing value (a forged specialist may have no department set — §13, never a
 * fabricated chip).
 */
function TeamMemberCard({
  icon,
  name,
  remit,
  description,
}: {
  icon: LucideIcon;
  name: string;
  remit?: string | null;
  description: string;
}) {
  return (
    <SectionCard className="h-full">
      <div className="flex items-start gap-3">
        <GlyphPlate icon={icon} size="md" ring="indigo" />
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold leading-tight text-foreground">
            {name}
          </h3>
          {remit && (
            <span className="mt-1 inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {remit}
            </span>
          )}
        </div>
      </div>
      {description && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
    </SectionCard>
  );
}

function VpCard({ id }: { id: VP }) {
  const { name, remit } = VP_ROSTER[id];
  return <TeamMemberCard icon={VP_ICON[id]} name={name} remit={remit} description={WHAT_THEY_DO[id]} />;
}

/**
 * The remit chip for a forged specialist — its department, else its domain,
 * with null/blank guards (§13: never render an empty or fabricated chip). Both
 * `name` and `description` come verbatim from the `paige_subagents` row, never
 * hardcoded (§243/§12).
 */
function specialistRemit(s: TenantSpecialist): string | undefined {
  return s.department?.trim() || s.domain?.trim() || undefined;
}

/**
 * A fixed palette of neutral, agent-flavored glyphs (§11 indigo plate, never gold).
 * Forged rows carry no icon field, so we give each keeper its OWN distinct mark —
 * the individuation that makes the VP grid read as a team of individuals (§6/§25).
 */
const SPECIALIST_GLYPHS: LucideIcon[] = [Sparkles, Wand2, Bot, Zap, Gem, Star, Rocket, Cpu];

/**
 * Deterministic, stable per-specialist glyph keyed on the slug hash. It is
 * arbitrary-but-stable — NOT a fabricated domain claim (§13): the same keeper
 * always gets the same mark, but the mark asserts nothing about what it does
 * (the name + remit carry the meaning). This is why the section no longer wears
 * one identical Sparkles on every card (design-crew #247).
 */
function specialistIcon(slug: string): LucideIcon {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return SPECIALIST_GLYPHS[h % SPECIALIST_GLYPHS.length];
}

/**
 * The invite line that points forging back to chat (§20 — spin-up is a chat act,
 * never a create-form here). Non-gold, informational (§11).
 */
const FORGE_INVITE = "Ask Paige in chat to build you a specialist for a job you do often — she'll forge one for your practice and it'll show up here.";

/**
 * "Specialists Paige built for your practice" — the tenant's own forged keepers
 * (#247). PURE and prop-driven so it renders under {@link renderToStaticMarkup}
 * in tests without touching Supabase; the container ({@link CustomSpecialistsSection})
 * owns the RLS-scoped read.
 *
 * States (§11/§13): loading → neutral skeletons (never a bare "Loading…"); empty
 * → a crafted invite to ask Paige (never a fabricated/placeholder specialist);
 * error → a quiet, HONEST notice (never the "you have none" invite when the truth
 * is we couldn't read) — the section stays visible so a tenant who HAS specialists
 * gets a signal instead of the whole section silently vanishing (design-crew #247).
 */
export function CustomSpecialistsView({
  specialists,
  loading,
  error,
}: {
  specialists: TenantSpecialist[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <section aria-label="Your custom specialists" className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Specialists Paige built for your practice
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The specialists Paige forged for the work you do most — yours alone, native to your practice.
        </p>
      </div>

      {error ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your specialists could not be loaded right now — refresh to try again.
        </p>
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <SectionCard key={i} className="h-full">
              <div className="flex items-start gap-3">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/3 rounded-full" />
                </div>
              </div>
              <Skeleton className="mt-3 h-4 w-full" />
            </SectionCard>
          ))}
        </div>
      ) : specialists.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={Sparkles}
            title="No custom specialists yet"
            description={FORGE_INVITE}
          />
        </SectionCard>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {specialists.map((s) => (
              <TeamMemberCard
                key={s.slug}
                icon={specialistIcon(s.slug)}
                name={s.name}
                remit={specialistRemit(s)}
                description={s.description}
              />
            ))}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Need another? Ask Paige in chat to forge a specialist for any job you do often.
          </p>
        </>
      )}
    </section>
  );
}

/** Container — owns the tenant-scoped RLS read; renders the pure view above. */
function CustomSpecialistsSection() {
  const { specialists, loading, error } = useTenantSpecialists();
  return <CustomSpecialistsView specialists={specialists} loading={loading} error={error} />;
}

export function PaigeTeamDirectory({ scope }: { scope: PaigeTeamScope }) {
  const paige = VP_ROSTER.PAIGE;
  const specialists = ORDER.filter((id) => id !== "PAIGE");

  return (
    <PageShell width="default">
      <PageHeader
        variant="plain"
        icon={Users2}
        title="Your Paige Team"
        description={SCOPE_SUBHEAD[scope]}
      />

      {/* Lead card — Paige, the orchestrator. Carries the "how you work with your
          team" line so the three ways to engage (chat · watch · learn) land in one
          read (§36), then hands off to the specialist grid. */}
      <SectionCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <PaigeCommandMark animated={false} className="h-14 w-14 shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold leading-tight text-foreground">
                {paige.name}
              </h2>
              <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {paige.remit}
              </span>
            </div>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {WHAT_THEY_DO.PAIGE} Talk to any of them in chat, watch them work, and get to
              know the six specialists Paige leads below.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* The six specialists. A directory, not a picker — the cards teach who's on
          the team; the tenant never selects a VP here (§20/§21). */}
      <section aria-label="Paige's specialists" className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Her specialists
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {specialists.map((id) => (
            <VpCard key={id} id={id} />
          ))}
        </div>
      </section>

      {/* The caller's OWN forged keepers (#247) — shown on the tenant AND agency
          surfaces, each reading its OWN tenant's rows via the same RLS-scoped hook
          (agency = the agency parent's own keepers, a sub-account = its own; never
          a cross-tenant aggregate — §9/§51). Absent operator-side: the operator is
          the platform, not a tenant, and has no per-tenant forged roster. */}
      {scope !== "operator" && <CustomSpecialistsSection />}
    </PageShell>
  );
}

export default PaigeTeamDirectory;
