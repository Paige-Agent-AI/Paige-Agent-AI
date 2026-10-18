import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readClientPortalSelfProfile } from "@/lib/client-portal-self-profile";
import { readPortalDocumentList } from "@/lib/client-portal-documents";
import { readPortalReleasedWork } from "@/hooks/useClientPortalReleasedWork";

/**
 * The customer home's Documents tile (E09 Slice 4): the same two reads as /app/documents, at their
 * smallest. Counts come from client_portal_documents(p_limit => 1).summary, so they cover every file
 * regardless of the limit; "awaiting review" counts released work still waiting for the customer.
 * A failed read never shows as zero. The released-work read is one page (newest first), so when
 * it has more, awaitingReviewMore says the count is a floor, never an exact total.
 */
export type PortalDocumentsGlance =
  | { state: "loading" }
  | { state: "ready"; shared: number; fromYou: number; awaitingReview: number; awaitingReviewMore: boolean }
  | { state: "unavailable" }
  | { state: "error" };

type Reply = { data: unknown; error: { code?: string } | null };

export async function readPortalDocumentsGlance(current: () => boolean = () => true): Promise<PortalDocumentsGlance> {
  const identity = await supabase.auth.getUser();
  if (identity.error || !identity.data.user) return { state: "unavailable" };
  const actor = identity.data.user.id;
  const profile = await supabase.rpc("client_portal_self_profile");
  if (profile.error?.code === "42501" || (!profile.error && !profile.data)) return { state: "unavailable" };
  const p = profile.error ? null : readClientPortalSelfProfile(profile.data, actor);
  if (!p) return { state: "error" };
  const scope = { actor, tenant: p.tenant_id, contact: p.id };
  const [docs, released] = await Promise.all([
    supabase.rpc("client_portal_documents" as never, { p_tenant_id: scope.tenant, p_limit: 1, p_before: null } as never) as unknown as PromiseLike<Reply>,
    readPortalReleasedWork(current),
  ]);
  if (docs.error?.code === "42501" || (!docs.error && docs.data === null)) return { state: "unavailable" };
  if (docs.error) return { state: "error" };
  const page = readPortalDocumentList(docs.data, scope);
  // Released work that could not be read is not counted, and not reported as zero waiting either.
  if (released.kind === "unavailable") return { state: "error" };
  const awaitingReview = released.kind === "ready" ? released.releases.filter(r => r.state === "awaiting_client").length : 0;
  const awaitingReviewMore = released.kind === "ready" && released.hasMore;
  return { state: "ready", shared: page.summary.shared, fromYou: page.summary.from_you, awaitingReview, awaitingReviewMore };
}

export function usePortalDocumentsGlance(enabled = true): PortalDocumentsGlance {
  const [glance, setGlance] = useState<PortalDocumentsGlance>({ state: "loading" });
  useEffect(() => {
    if (!enabled) { setGlance({ state: "unavailable" }); return; }
    let cancelled = false;
    setGlance({ state: "loading" });
    readPortalDocumentsGlance(() => !cancelled)
      .then(next => { if (!cancelled) setGlance(next); })
      .catch(() => { if (!cancelled) setGlance({ state: "error" }); });
    return () => { cancelled = true; };
  }, [enabled]);
  return glance;
}
