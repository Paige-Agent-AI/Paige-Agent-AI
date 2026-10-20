// ---------------------------------------------------------------------------
// Playbook resolution — active playbook for the current tenant.
// ---------------------------------------------------------------------------
// A tenant's Paige is tenant-authored (doctrine §7): the playbook is resolved
// from the tenant's own config, never hardcoded to a vertical. Resolution order
// for the active tenant (from `profiles.active_tenant_id` → `tenants.features`):
//
//   1. `features.playbook_config` — a FULL authored Playbook object stored as
//      tenant DATA. This is how a tenant with a specialized practice (e.g. a
//      credit-repair academy) carries its own persona/journey/intake without a
//      single line of that vertical living in platform code (§2).
//   2. `features.playbook` — a slug into the shared starter library (the
//      coaching-neutral presets a new tenant picks from at onboarding).
//   3. Fallback → the neutral coaching default.
//
// The platform/master account ("Paige Agent AI") is not a client-facing tenant,
// so it simply resolves to the coaching default.

import { supabase } from "@/integrations/supabase/client";
import { generalDefault, RESOLVABLE_PLAYBOOKS } from "./presets";
import type { IntakeField, JourneyStage, Playbook, PortalConfig, ProbingQuestion, QuickAction } from "./types";
import { boundCatalogModules, type PortalCatalogInput } from "@/hooks/useClientPortalConfig";

/** Resolve a playbook by slug, falling back to the coaching default. */
export function getPlaybookBySlug(slug?: string | null): Playbook {
  if (!slug) return generalDefault;
  // Resolve over the FULL set (incl. opt-in verticals like funding) so an
  // already-opted-in tenant's stored slug still renders its persona, even though
  // funding is not offered as a picker default (§2). See presets.ts.
  return RESOLVABLE_PLAYBOOKS.find((p) => p.slug === slug) ?? generalDefault;
}

// --- Shape guards for a tenant-authored playbook stored as JSON data ---------
// Defensive: tenant config is untrusted data; a malformed authored playbook must
// degrade to the coaching default rather than render a broken portal.

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** coercePlaybook's acceptance test, on its own: an object whose persona has a string name and greeting. */
const isUsableAuthored = (raw: unknown): raw is Record<string, unknown> & { persona: Record<string, unknown> & { name: string; greeting: string } } =>
  isRecord(raw) && isRecord(raw.persona) && typeof raw.persona.greeting === "string" && typeof raw.persona.name === "string";

function coercePlaybook(raw: unknown): Playbook | null {
  if (!isUsableAuthored(raw)) return null;
  const persona = raw.persona;
  const arr = <T,>(v: unknown, min = 0): T[] => (Array.isArray(v) && v.length >= min ? (v as T[]) : []);
  // Merge over the coaching default so a partial authored playbook still yields
  // a complete, renderable Playbook (missing sections inherit sane neutral copy).
  return {
    slug: typeof raw.slug === "string" ? raw.slug : generalDefault.slug,
    name: typeof raw.name === "string" ? raw.name : generalDefault.name,
    vertical: typeof raw.vertical === "string" ? raw.vertical : generalDefault.vertical,
    persona: {
      name: persona.name,
      role: typeof persona.role === "string" ? persona.role : generalDefault.persona.role,
      greeting: persona.greeting,
      tone: typeof persona.tone === "string" ? persona.tone : generalDefault.persona.tone,
      domain: typeof persona.domain === "string" ? persona.domain : generalDefault.persona.domain,
    },
    quickActions: arr<QuickAction>(raw.quickActions, 1).length
      ? arr<QuickAction>(raw.quickActions)
      : generalDefault.quickActions,
    probingQuestions: arr<ProbingQuestion>(raw.probingQuestions),
    journey: arr<JourneyStage>(raw.journey, 1).length
      ? arr<JourneyStage>(raw.journey)
      : generalDefault.journey,
    // An authored [] means no questions; only absent/non-array intake inherits the starter.
    intake: Array.isArray(raw.intake) ? arr<IntakeField>(raw.intake) : generalDefault.intake,
    portal: isRecord(raw.portal) && Array.isArray((raw.portal as { modules?: unknown }).modules)
      ? (raw.portal as unknown as Playbook["portal"])
      : generalDefault.portal,
  };
}

/** The Playbook a tenant's `features` resolve to: authored and usable, else its slug, else the default. */
export function resolveActivePlaybookFromFeatures(features: Record<string, unknown>): Playbook {
  const authored = coercePlaybook(features.playbook_config);
  if (authored) return authored;
  return getPlaybookBySlug(typeof features.playbook === "string" ? features.playbook : null);
}

// --- The portal menu catalog (E09 Slice M) ------------------------------------
// A customer cannot read `tenants` (RLS), so the server hands them only the menu inputs — `_catalog` from
// get_client_portal_config — and the client resolves them with coercePlaybook's precedence. The owner side
// derives the SAME input from its own `tenants.features`, so both ends resolve one catalog (§57).

/** The `_catalog` the server computes, derived from `tenants.features` on the owner side. */
export function catalogInputFromFeatures(features: Record<string, unknown> | null | undefined): PortalCatalogInput {
  const f = isRecord(features) ? features : {};
  const config = f.playbook_config;
  const portal = isRecord(config) ? config.portal : undefined;
  return {
    slug: typeof f.playbook === "string" ? f.playbook : null,
    authoredUsable: isUsableAuthored(config),
    modules: boundCatalogModules(isRecord(portal) ? portal.modules : undefined),
  };
}

/** The portal module catalog for a catalog input: authored modules, else the slug's, else the default's. */
export function resolvePortalCatalog(input: PortalCatalogInput | null | undefined): PortalConfig["modules"] {
  if (!input) return generalDefault.portal.modules;
  if (input.authoredUsable) return input.modules ?? generalDefault.portal.modules;
  return getPlaybookBySlug(input.slug).portal.modules;
}

/**
 * Resolve the active tenant's playbook. Reads the signed-in user's active
 * tenant, then that tenant's authored config. Any failure (no session, no
 * tenant, unconfigured, malformed) resolves to the neutral coaching default —
 * this never throws into a render path.
 */
export async function resolveActivePlaybook(): Promise<Playbook> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return generalDefault;

    const { data: profile } = await supabase
      .from("profiles")
      .select("active_tenant_id")
      .eq("user_id", uid)
      .maybeSingle();
    const tenantId = profile?.active_tenant_id;
    if (!tenantId) return generalDefault;

    const { data: tenant } = await supabase
      .from("tenants")
      .select("features")
      .eq("id", tenantId)
      .maybeSingle();
    const features = (tenant?.features ?? {}) as Record<string, unknown>;
    return resolveActivePlaybookFromFeatures(features);
  } catch {
    return generalDefault;
  }
}
