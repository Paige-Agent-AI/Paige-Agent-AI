import { useLayoutEffect, useSyncExternalStore } from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { getScopedUserId, subscribeScopedUser } from "@/lib/scopedUser";
import { setComposerDraftSessionScope } from "@/lib/paigeComposerScopeState";

const subscribePersona = (changed: () => void) => subscribeScopedUser(() => changed());
const serverPersona = () => null;

/** Binds ephemeral draft recovery to the existing resolved account; grants no authority. */
export function ComposerDraftSessionBinding() {
  const context = useTenantContext();
  const { soloStandalone } = useTierFeatures();
  const { isImpersonating } = useImpersonation();
  const scopedUser = useSyncExternalStore(subscribePersona, getScopedUserId, serverPersona);
  const eligible = context.accountContextStatus === "ready" && context.accountContextLoading === false
    && context.isPlatformStaff === false && context.isPlatformOwner === false
    && context.soloShellEnabled === true && soloStandalone && isImpersonating === false
    && scopedUser === null && Boolean(context.activeUserId && context.activeTenantId)
    && context.activeTenant?.id === context.activeTenantId;

  useLayoutEffect(() => {
    setComposerDraftSessionScope(context.accountContextStatus === "resolving"
      ? { kind: "unresolved" }
      : eligible
        ? { kind: "ready", tenantId: context.activeTenantId!, userId: context.activeUserId! }
        : { kind: "clear" });
    // No unmount cleanup: a full reload must retain the tab's unsent input.
    // Actual sign-out, actor/eligibility or persona changes retire it above.
  }, [context.accountContextStatus, context.activeTenantId, context.activeUserId, eligible]);
  return null;
}
