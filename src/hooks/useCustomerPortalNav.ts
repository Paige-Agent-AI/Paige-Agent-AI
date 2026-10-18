import { useDashboardMode } from "@/contexts/DashboardModeContext";
import { useClientPortalBrandState, type ClientPortalBrandState } from "@/hooks/useClientPortalBrand";
import { useClientPortalConfigState } from "@/hooks/useClientPortalConfig";
import { usePlaybook } from "@/lib/playbook";
import { resolvePortalCatalog } from "@/lib/playbook/resolve";
import { assemblePortalNav, type PortalNavSection, type PortalViewer } from "@/lib/portal/portalMenu";

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
  const sections = assemblePortalNav({ catalog, overlay: config.modules, viewer });
  // Staff never wait on the customer read; a failed relationship read is "known enough" to render the floors.
  const ready = isAdmin || (!brandLoading && (!isCustomer || !configLoading));
  return { sections, viewer, ready, brandState };
}
