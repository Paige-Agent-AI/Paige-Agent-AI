// Playbook — public entry point.
//
// Surfaces read the ACTIVE playbook via usePlaybook() instead of hardcoding
// vertical strings. It resolves per-tenant from the tenant's authored config
// (see ./resolve), so each coach's Paige is native to their practice; an
// unconfigured tenant (and the Paige Agent AI platform account itself) falls
// back to the neutral, vertical-agnostic default.

import { useEffect, useState } from "react";
import { generalDefault } from "./presets";
import { resolveActivePlaybook } from "./resolve";
import type { Playbook } from "./types";

export * from "./types";
export { generalDefault, coachingDefault, fitnessCoach, businessConsultant, marketingAgency, PLAYBOOK_LIBRARY, RESOLVABLE_PLAYBOOKS } from "./presets";
export { getPlaybookBySlug, resolveActivePlaybook } from "./resolve";

/**
 * The synchronous neutral default. Use this only where a non-reactive default
 * is needed before the tenant's authored playbook has resolved; live surfaces
 * should use the usePlaybook() hook so they update once the tenant loads.
 */
export function getActivePlaybook(): Playbook {
  return generalDefault;
}

/**
 * React hook — the active tenant's playbook. Starts at the neutral coaching
 * default and updates once the tenant's authored config resolves, so call
 * sites can treat the return as a ready Playbook without a loading branch.
 */
export function usePlaybook(enabled = true): Playbook {
  const [playbook, setPlaybook] = useState<Playbook>(generalDefault);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) return;
    resolveActivePlaybook().then((pb) => {
      if (!cancelled) setPlaybook(pb);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return playbook;
}
