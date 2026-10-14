import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { getScopedUserId, subscribeScopedUser } from "@/lib/scopedUser";
import { supabase } from "@/integrations/supabase/client";
import { readWeeklyOwner, type WeeklyBrowserScope, type WeeklyOwnerRead } from "./weekly-owner-read";

const subscribePersona = (changed: () => void) => subscribeScopedUser(() => changed());
const serverPersona = () => null;
/** Presentation eligibility only; each read still proves canonical session, tenant and owner authority. */
export function useWeeklyOwnerAudience() {
  const context = useTenantContext();
  const persona = useImpersonation();
  const scopedUser = useSyncExternalStore(subscribePersona, getScopedUserId, serverPersona);
  const eligible = !context.loading && context.accountContextStatus === "ready" && !context.isPlatformStaff &&
    Boolean(context.activeUserId && context.activeTenantId) && context.soloShellEnabled && !persona.isImpersonating && scopedUser === null;
  return { context, eligible, key: `${eligible}:${context.activeUserId}:${context.activeTenantId}:${persona.target?.contactId}:${scopedUser}` };
}

/** A fresh canonical read on entry/focus/manual refresh. No cache, persistence, timer schedule or tool offer. */
export function useWeeklyResponsibility(enabled = true) {
  const audience = useWeeklyOwnerAudience();
  const { context } = audience;
  const eligible = enabled && audience.eligible;
  const key = `${enabled}:${audience.key}`;
  const generation = useRef({ key, epoch: 0 });
  if (generation.current.key !== key) generation.current = { key, epoch: generation.current.epoch + 1 };
  const scope = useRef<WeeklyBrowserScope | null>(null);
  scope.current = eligible ? { actorId: context.activeUserId!, tenantId: context.activeTenantId!, epoch: generation.current.epoch } : null;
  const request = useRef(0);
  const invalidate = useCallback(() => { request.current++; }, []);
  const [read, setRead] = useState<{ key: string; value: WeeklyOwnerRead }>({ key, value: { status: "loading" } });
  const refresh = useCallback(async () => {
    const captured = scope.current, ticket = ++request.current;
    if (!captured) { setRead({ key, value: { status: "refused" } }); return; }
    setRead({ key, value: { status: "loading" } });
    const value = await readWeeklyOwner(captured, supabase as unknown as Parameters<typeof readWeeklyOwner>[1], () => getScopedUserId() === null ? scope.current : null);
    if (ticket === request.current && scope.current?.epoch === captured.epoch && generation.current.key === key) setRead({ key, value });
  }, [key]);
  useEffect(() => {
    scope.current = eligible ? { actorId: context.activeUserId!, tenantId: context.activeTenantId!, epoch: generation.current.epoch } : null;
    void refresh();
    const focused = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focused);
    document.addEventListener("visibilitychange", focused);
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") {
        generation.current.epoch++;
        if (event === "SIGNED_OUT") scope.current = null;
        else if (scope.current) scope.current = { ...scope.current, epoch: generation.current.epoch };
        invalidate();
        setRead({ key, value: { status: "unavailable" } });
        // Do not issue a Supabase call inside its auth event lock.
      }
    });
    return () => { invalidate(); if (generation.current.key === key) scope.current = null; window.removeEventListener("focus", focused); document.removeEventListener("visibilitychange", focused); data.subscription.unsubscribe(); };
  }, [key, refresh, eligible, context.activeUserId, context.activeTenantId, invalidate]);
  return { read: !eligible ? { status: "refused" } as WeeklyOwnerRead : read.key === key ? read.value : { status: "loading" } as WeeklyOwnerRead, refresh };
}
