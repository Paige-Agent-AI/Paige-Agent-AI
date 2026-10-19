import { useDashboardMode } from "@/contexts/DashboardModeContext";
import { useClientPortalBrandState, type ClientPortalBrandState } from "@/hooks/useClientPortalBrand";
import { useClientPortalConfigState } from "@/hooks/useClientPortalConfig";
import { usePlaybook } from "@/lib/playbook";
import { resolvePortalCatalog } from "@/lib/playbook/resolve";
import { assemblePortalNav, portalNavWithoutAccess, type PortalNavSection, type PortalViewer } from "@/lib/portal/portalMenu";
import { useShellCustomerIdentity } from "@/lib/portal/customerIdentity";

/**
 * E09 Slice M — the customer portal menu for the signed-in viewer, computed ONCE (§18/§57). AppNav renders it;
 * any customer page that asks "is X in my menu?" (Messages' "Browse resources first") reads the same sections,
 * so a hint can never disagree with the menu beside it.
 *
 * A customer cannot read their business's `tenants` row (RLS), so their catalog is the server's `_catalog` in
 * the portal config; staff, who have no customer relationship, keep their own Playbook read.
 *
 * `ready` is false until everything that decides THIS viewer's menu has resolved: the relationship, and for a
 * customer of one business, their business's config. Until then a caller shows a skeleton, never a menu built
 * from the generic catalog that then changes under the customer (the Resources flicker).
 *
 * A person whose access is not active (inside the /app shell: no customer frame, not staff) gets Home only, and
 * the menu waits until the shell knows that, so pages that would refuse them never appear and then vanish.
 */
export interface CustomerPortalNav {
  sections: PortalNavSection[];
  viewer: PortalViewer;
  ready: boolean;
  brandState: ClientPortalBrandState;
}

export function useCustomerPortalNav(): CustomerPortalNav {
  const { isAdmin } = useDashboardMode();
  const pb = usePlaybook();
  const brandState = useClientPortalBrandState();
  const { config, loading: configLoading } = useClientPortalConfigState();
  const { brand, loading: brandLoading, error: brandError, multipleBusinesses } = brandState;
  const relationshipKnown = !brandLoading && !brandError;
  const isCustomer = relationshipKnown && !!brand?.tenant_id && !multipleBusinesses;
  const viewer: PortalViewer = { isStaff: isAdmin, isCustomer, brandResolved: !!brand };
  const catalog = config.catalog ? resolvePortalCatalog(config.catalog) : pb.portal.modules;
  const identity = useShellCustomerIdentity();
  const assembled = assemblePortalNav({ catalog, overlay: config.modules, viewer });
  const noAccess = !isAdmin && !isCustomer && identity?.viewer === "inactive";
  const sections = noAccess ? portalNavWithoutAccess(assembled) : assembled;
  // Staff never wait on the customer read; a failed relationship read is "known enough" to render the floors.
  // A non-customer inside the shell also waits for the shell to know whether they are staff or inactive.
  const identityPending = !isAdmin && !isCustomer && identity?.checking === true;
  const ready = isAdmin || (!brandLoading && (!isCustomer || !configLoading) && !identityPending);
  return { sections, viewer, ready, brandState };
}
