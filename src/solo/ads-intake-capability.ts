// Whether the ads-intake server functions are deployed (migration 20271021042001: every form lead lands
// in a pipeline, get_pipeline_lead_funnel, set_ad_creative_featured). They ship together, before this
// page, so the page assumes they are there. It still asks once per page load, and believes any later
// answer: if one of them comes back "function not found" (PGRST202), the page stops offering what can
// never succeed ("Feature in showroom") and stops saying a lead lands in the default pipeline.
//
// The question costs one read that changes nothing: the funnel read for no pipeline at all (a null id),
// which a deployed function refuses (PIPELINE_FORBIDDEN, 42501) and an undeployed one cannot find
// (PGRST202). A network failure answers nothing, so the page keeps its assumption.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction } from "./ads-model";

export type AdsIntakeCapability = "unknown" | "present" | "missing";

let state: AdsIntakeCapability = "unknown";
let probing: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (next: AdsIntakeCapability) => { if (state === next) return; state = next; listeners.forEach((listener) => listener()); };

/** Records what an ads-intake RPC answered: "not found" means the functions are not deployed; any other
 *  answer, a refusal included, means they are. A thrown network failure is not passed here. */
export function noteAdsIntakeAnswer(error: unknown) {
  if (isMissingFunction(error)) set("missing");
  else if (state === "unknown") set("present");
}

function probe() {
  if (state !== "unknown" || probing) return;
  probing = (async () => {
    try {
      const { error } = await supabase.rpc("get_pipeline_lead_funnel" as never, { p_pipeline_id: null, p_since: null } as never);
      noteAdsIntakeAnswer(error);
    } catch (error) {
      console.error("[ads] could not tell whether the ads-intake functions are deployed", error);
    } finally {
      probing = null;
    }
  })();
}

/** "present" or "unknown" means offer the feature; only "missing" withdraws it. `ask` false only listens
 *  (a page that is about to call one of the functions anyway lets that answer decide). */
export function useAdsIntakeCapability(ask = true): AdsIntakeCapability {
  const current = React.useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state, () => state);
  React.useEffect(() => { if (ask) probe(); }, [ask]);
  return current;
}

/** Tests only: forget what this page load learned. */
export function resetAdsIntakeCapability() { state = "unknown"; probing = null; listeners.forEach((listener) => listener()); }
