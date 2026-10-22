import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useShellCustomerIdentity } from "@/lib/portal/customerIdentity";
import { captureClientPortalAuthorization, withClientPortalBusiness } from "@/lib/client-portal-scope";
import { readClientPortalSelfProfile } from "@/lib/client-portal-self-profile";
import { readPortalDocumentList } from "@/lib/client-portal-documents";
import { readPortalReleasedWork, type PortalReleaseScope } from "@/hooks/useClientPortalReleasedWork";

/** Original Documents summary and Operations review facts for the same verified relationship.
 * Counts come from the native summary, never the returned page length. A failed or partial
 * review read cannot claim zero; hasMore marks a successful review count as a floor. */
export type PortalDocumentsGlance =
  | { state: "loading" }
  | { state: "ready"; shared: number; fromYou: number; awaitingReview: number; awaitingReviewMore: boolean }
  | { state: "unavailable" }
  | { state: "error" };
type Reply = { data: unknown; error: { code?: string } | null };
type Request = PromiseLike<Reply> & { setHeader(name: string, value: string): Request };
const same = (a: PortalReleaseScope, b: PortalReleaseScope) => a.actorId === b.actorId && a.tenantId === b.tenantId && a.clientId === b.clientId;

/** An ephemeral bounded read, not another authorization registry or durable executor. */
export async function readPortalDocumentsGlance(current: () => boolean = () => true, requested?: PortalReleaseScope): Promise<PortalDocumentsGlance> {
  let active = true, timer: ReturnType<typeof setTimeout> | undefined;
  const live = () => active && current();
  const original = async (): Promise<PortalDocumentsGlance> => {
    if (!live()) return { state: "unavailable" };
    const identity = await supabase.auth.getUser();
    if (!live() || identity.error || !identity.data.user) return { state: "unavailable" };
    const actor = identity.data.user.id;
    if (requested && actor !== requested.actorId) return { state: "unavailable" };
    const authorization = await captureClientPortalAuthorization(supabase.auth, actor, live);
    if (!live()) return { state: "unavailable" };
    const profileRead = async (expected?: PortalReleaseScope) => {
      let q = expected ? supabase.rpc("client_portal_self_profile", {p_tenant_id: expected.tenantId}) : supabase.rpc("client_portal_self_profile");
      if (expected) q = withClientPortalBusiness(q, expected.tenantId);
      if (!live()) return null;
      const result = await q.setHeader("Authorization", authorization);
      if (!live() || result.error || !result.data) return null;
      const p = readClientPortalSelfProfile(result.data, actor, expected?.tenantId);
      const scope = p ? {actorId: actor, tenantId: p.tenant_id, clientId: p.id} : null;
      return scope && (!expected || same(scope, expected)) ? scope : null;
    };
    const scope = await profileRead(requested);
    if (!scope || !live()) return { state: "unavailable" };
    const docsRequest = withClientPortalBusiness(supabase.rpc("client_portal_documents" as never,
      {p_tenant_id: scope.tenantId, p_limit: 1, p_before: null} as never) as unknown as Request, scope.tenantId).setHeader("Authorization", authorization);
    const [docs, released] = await Promise.all([docsRequest, readPortalReleasedWork(live, scope)]);
    if (!live()) return { state: "unavailable" };
    if (docs.error?.code === "42501" || !docs.error && docs.data === null) return { state: "unavailable" };
    if (docs.error || released.kind === "unavailable" || released.kind === "scope_changed") return { state: "error" };
    if (released.kind === "hidden" && released.reason !== "not_offered") return { state: "error" };
    if (released.kind === "ready" && (!same(released.scope, scope) || released.unavailableCount > 0)) return { state: "error" };
    const page = readPortalDocumentList(docs.data, {actor, tenant: scope.tenantId, contact: scope.clientId});
    const finalScope = await profileRead(scope);
    const after = await supabase.auth.getUser();
    if (!live() || !finalScope || after.error || after.data.user?.id !== actor) return { state: "unavailable" };
    return {state: "ready", shared: page.summary.shared, fromYou: page.summary.from_you,
      awaitingReview: released.kind === "ready" ? released.releases.filter(r => r.state === "awaiting_client").length : 0,
      awaitingReviewMore: released.kind === "ready" && released.hasMore};
  };
  try {
    return await Promise.race([original(), new Promise<PortalDocumentsGlance>(resolve => {
      timer = setTimeout(() => {active = false; resolve({state: "error"});}, 20_000);
    })]);
  } catch { return live() ? {state: "error"} : {state: "unavailable"}; }
  finally { active = false; clearTimeout(timer); }
}

export function usePortalDocumentsGlance(enabled = true): PortalDocumentsGlance {
  const identity = useShellCustomerIdentity();
  const frame = identity?.viewer === "customer" ? identity.frame : null;
  const requested = frame ? {actorId: frame.actorId, tenantId: frame.profile.tenant_id, clientId: frame.profile.id} : undefined;
  const key = identity ? JSON.stringify([identity.viewer, requested?.actorId, requested?.tenantId, requested?.clientId]) : "legacy";
  const available = enabled && (!identity || identity.viewer === "staff" || !!frame && identity.phase === "ready" && !identity.checking);
  const [glance, setGlance] = useState<PortalDocumentsGlance>({state: "loading"});
  const life = useRef({key, available, generation: 0, request: 0, signedOut: false});
  const shown = useRef(-1);
  if (life.current.key !== key || life.current.available !== available) life.current = {...life.current, key, available, generation: life.current.generation + 1};
  const generation = life.current.generation;
  const actor = requested?.actorId, tenant = requested?.tenantId, client = requested?.clientId;
  useEffect(() => {
    let listening = true;
    const l = life.current;
    const current = () => listening && l === life.current && l.generation === generation && l.available && !l.signedOut;
    const refresh = () => {
      if (!current()) return;
      const request = ++l.request;
      const live = () => current() && l.request === request;
      setGlance({state: "loading"});
      void readPortalDocumentsGlance(live, actor && tenant && client ? {actorId: actor, tenantId: tenant, clientId: client} : undefined)
        .then(value => {if (live()) {shown.current = generation; setGlance(value);}});
    };
    const {data: {subscription}} = supabase.auth.onAuthStateChange((event, session) => {
      if (!listening) return;
      const observed = life.current;
      if (observed.signedOut && event !== "SIGNED_IN") return;
      if (event === "INITIAL_SESSION" && session) return;
      if (event === "SIGNED_OUT" || !session) {
        ++observed.request; observed.signedOut = true; shown.current = observed.generation; setGlance({state: "unavailable"}); return;
      }
      observed.signedOut = false;
      ++observed.request; shown.current = -1; setGlance({state: "loading"});
      queueMicrotask(refresh);
    });
    window.addEventListener("focus", refresh); refresh();
    return () => {listening = false; ++l.request; subscription.unsubscribe(); window.removeEventListener("focus", refresh);};
  }, [generation, actor, tenant, client]);
  if (!available) return enabled ? {state: "loading"} : {state: "unavailable"};
  if (life.current.signedOut) return {state: "unavailable"};
  return shown.current === generation ? glance : {state: "loading"};
}
