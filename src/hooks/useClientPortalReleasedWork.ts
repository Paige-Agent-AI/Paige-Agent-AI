import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readClientPortalSelfProfile } from "@/lib/client-portal-self-profile";
import { readClientReleasedDeliveries, type ClientReleasedDelivery } from "@/solo/operations/operations-client-delivery-discovery";

/**
 * E09 Slice 4 (4B) — the work a business released to the signed-in customer for review, on /app/documents.
 *
 * Reworked from draft #2156. Its list logic is kept: the unchanged Operations discovery reader
 * (readClientReleasedDeliveries, 40-row limit, partial-list counts) and invalidation when the signed-in
 * actor changes. Its link read is replaced: the customer is identified by client_portal_self_profile —
 * the same server-resolved relationship /app/documents uses — never by reading the CRM `clients` table,
 * which a customer's session cannot see (clients_customer_raw_boundary).
 *
 * Releases exist only for standalone, top-level businesses (owner decision D3). For any other business the
 * reviews RPC refuses with DELIVERY_CLIENT_REVIEWS_UNAVAILABLE; that is "not offered here", so the section
 * is hidden instead of reporting a failure the customer can do nothing about.
 */

export type PortalReleaseScope = Readonly<{ actorId: string; tenantId: string; clientId: string }>;
export type PortalReleasedWork =
  | { kind: "ready"; scope: PortalReleaseScope; releases: ClientReleasedDelivery[]; unavailableCount: number; hasMore: boolean }
  /** Signed out, no customer relationship, more than one business, or releases not offered for this business. */
  | { kind: "hidden" }
  /** The read failed or the server answered outside the promised shape. */
  | { kind: "unavailable" }
  | { kind: "scope_changed" };

export const PORTAL_RELEASE_LIMIT = 40;
type Reply = { data: unknown; error: unknown };
const errorOf = (value: unknown) => value && typeof value === "object" ? value as { code?: unknown; message?: unknown } : null;

/** The customer relationship as the server resolves it for this session. Null when there is none. */
async function readScope(): Promise<PortalReleaseScope | "hidden" | "unavailable"> {
  const before = await supabase.auth.getUser();
  if (before.error || !before.data.user) return "hidden";
  const actorId = before.data.user.id;
  const result = await supabase.rpc("client_portal_self_profile");
  // 42501 covers a session linked to more than one business; Documents itself names that state.
  if (errorOf(result.error)?.code === "42501" || (!result.error && !result.data)) return "hidden";
  const profile = result.error ? null : readClientPortalSelfProfile(result.data, actorId);
  if (!profile) return "unavailable";
  const after = await supabase.auth.getUser();
  if (after.error || after.data.user?.id !== actorId) return "hidden";
  return Object.freeze({ actorId, tenantId: profile.tenant_id, clientId: profile.id });
}

/** One read of the caller's released work. Never reads the `clients` table. */
export async function readPortalReleasedWork(current: () => boolean): Promise<PortalReleasedWork> {
  try {
    const scope = await readScope();
    if (!current()) return { kind: "scope_changed" };
    if (scope === "hidden" || scope === "unavailable") return { kind: scope };
    let notOffered = false;
    const result = await readClientReleasedDeliveries({
      getActor: async () => {
        const user = await supabase.auth.getUser();
        return current() && !user.error ? user.data.user?.id ?? null : null;
      },
      // The SAME relationship, re-proved: a different client or business mid-read is a refusal.
      getTenant: async () => {
        const fresh = await readScope();
        return typeof fresh === "object" && fresh.actorId === scope.actorId && fresh.clientId === scope.clientId
          && fresh.tenantId === scope.tenantId ? fresh.tenantId : null;
      },
      rpc: async (name, args) => {
        if (!current() || name !== "operations_delivery_client_reviews_scoped" || args.p_expected_actor_id !== scope.actorId
          || args.p_expected_tenant_id !== scope.tenantId || args.p_limit !== PORTAL_RELEASE_LIMIT) {
          return { data: null, error: { code: "PORTAL_SCOPE_REFUSED" } };
        }
        const reply = await (supabase.rpc(name as never, args as never) as unknown as PromiseLike<Reply>);
        const e = errorOf(reply.error);
        if (e?.code === "42501" && typeof e.message === "string" && /DELIVERY_CLIENT_REVIEWS_UNAVAILABLE/.test(e.message)) notOffered = true;
        return reply;
      },
    }, { actorId: scope.actorId, tenantId: scope.tenantId }, current);
    if (!current()) return { kind: "scope_changed" };
    if (result.kind === "ready") return { ...result, scope };
    if (notOffered) return { kind: "hidden" };
    return result.kind === "scope_changed" ? { kind: "scope_changed" } : { kind: "unavailable" };
  } catch {
    return current() ? { kind: "unavailable" } : { kind: "scope_changed" };
  }
}

export type ClientPortalReleasedWorkState = {
  /** null until the first read for this identity lands. */
  work: PortalReleasedWork | null;
  reading: boolean;
  /** Bumped whenever the signed-in identity changes: any open review belongs to the old one. */
  epoch: number;
  refresh: () => Promise<PortalReleasedWork | null>;
};

/**
 * The list's lifetime. A read that lands after the signed-in actor changed is dropped, the list is
 * cleared on any actor change, and it refreshes on window focus / when the tab becomes visible. Releases
 * are not in the realtime publication, so there is no subscription.
 */
export function useClientPortalReleasedWork(): ClientPortalReleasedWorkState {
  const [work, setWork] = useState<PortalReleasedWork | null>(null);
  const [reading, setReading] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const life = useRef({ alive: true, epoch: 0, read: 0, actor: undefined as string | null | undefined });

  const refresh = useCallback(async () => {
    const l = life.current;
    if (!l.alive) return null;
    const generation = l.epoch, request = ++l.read;
    const current = () => l.alive && l.epoch === generation && l.read === request;
    setReading(true);
    const result = await readPortalReleasedWork(current);
    if (!current()) return null;
    setWork(result.kind === "scope_changed" ? null : result);
    setReading(false);
    return result;
  }, []);

  useEffect(() => {
    const l = life.current;
    l.alive = true;
    void refresh();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!l.alive) return;
      const next = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && (l.actor === undefined || l.actor === next)) { l.actor = next; return; }
      if (next === l.actor && event !== "SIGNED_OUT") return;
      l.actor = next; ++l.epoch; ++l.read;
      setEpoch(l.epoch); setWork(null); setReading(false);
      // Never call the SDK while its auth callback holds the lock.
      const generation = l.epoch;
      queueMicrotask(() => { if (l.alive && l.epoch === generation) void refresh(); });
    });
    const resume = () => { if (l.alive && (typeof document === "undefined" || document.visibilityState !== "hidden")) void refresh(); };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      l.alive = false; ++l.epoch; ++l.read;
      subscription.unsubscribe();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh]);

  return { work, reading, epoch, refresh };
}
