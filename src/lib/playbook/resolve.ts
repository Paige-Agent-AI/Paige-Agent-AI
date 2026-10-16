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
import type { IntakeField, JourneyStage, Playbook, ProbingQuestion, QuickAction } from "./types";

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

function coercePlaybook(raw: unknown): Playbook | null {
  if (!isRecord(raw)) return null;
  const persona = raw.persona;
  if (!isRecord(persona) || typeof persona.greeting !== "string" || typeof persona.name !== "string") {
    return null;
  }
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
      ? (raw.portal as Playbook["portal"])
      : generalDefault.portal,
  };
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

    const authored = coercePlaybook(features.playbook_config);
    if (authored) return authored;

    const slug = typeof features.playbook === "string" ? features.playbook : null;
    return getPlaybookBySlug(slug);
  } catch {
    return generalDefault;
  }
}
