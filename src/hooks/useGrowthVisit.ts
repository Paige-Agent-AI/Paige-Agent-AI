// Records a visit to a public page, funnel or standalone form once it has loaded (INT-298 MBC 7a), and continues
// the same visit as a funnel visitor moves through its steps. One home for the effect the three public renderers
// share; the rules live in src/lib/growth-visit.ts and on the server.
import { useEffect, useRef } from "react";
import { readUtm } from "@/lib/growth";
import { clearActiveVisit, recordGrowthVisit, type GrowthVisitKind } from "@/lib/growth-visit";

export function useGrowthVisit(kind: GrowthVisitKind, targetId: string | null | undefined, step = 0): void {
  const token = useRef<string | null>(null);

  // Each step (and the first view) records; the server continues the same visit for the same target.
  useEffect(() => {
    if (!targetId) return;
    let gone = false;
    recordGrowthVisit(kind, targetId, { step, utm: readUtm() }).then((t) => {
      if (gone) return;
      token.current = t;
    });
    return () => { gone = true; };
  }, [kind, targetId, step]);

  // Leaving the target forgets its visit, so a later form elsewhere is never linked to it.
  useEffect(() => {
    if (!targetId) return;
    return () => { clearActiveVisit(token.current); token.current = null; };
  }, [kind, targetId]);
}
