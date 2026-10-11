// Ads — its own Solo department, directly below Marketing (owner ruling 2026-10-10, INT-342; it was a
// Marketing tab until then). Marketing owns demand strategy and campaign briefs; Ads owns paid media.
// The north star and the build sequence after this move: docs/product/int342-marketing-convergence.md §M.
//
// This route owns the address and the links out; the desk itself is unchanged (marketing-ads.tsx), so
// its reads, read policy and not-read states are exactly what shipped under Marketing. The five views
// are subtabs, `/solo/{account}/ads/{view}`, so a view is a history entry and survives a reload.
// Nothing here runs, pauses, pays for or publishes anything.
import React from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { subtabPath } from "@/lib/routing/tierBranches";
import { adsAddress } from "./ads-routing";
import { MarketingAds, adsViewOf } from "./marketing-ads";
import "./solo-campaigns.css";

export function AdsWorkspace({ tenantId }: { tenantId: string | null }) {
  const [view, setView] = useSubtabRoute("solo", "ads", "overview");
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const account = params.account ?? null;
  const go = React.useCallback((branch: string, subtab: string) => {
    if (account) navigate(subtabPath("solo", account, branch, subtab));
  }, [account, navigate]);

  // A `?view=` (the shape the Marketing tab used) lands on that view's own address; a view already in
  // the path wins over a stale one in the query.
  const queryView = new URLSearchParams(location.search).get("view");
  if (account && queryView !== null) {
    const pathView = (params["*"] || "").split("/")[1] || null;
    return <Navigate replace to={adsAddress(account, pathView ?? queryView, location.search, location.hash)}/>;
  }

  return <div className="solo-campaigns" data-ads-view={view}>
    <h1 className="campaigns-sr-only">Ads</h1>
    <div className="campaigns-scroll">
      <MarketingAds
        tenantId={tenantId}
        view={adsViewOf(view)}
        onView={setView}
        onOpenIntegrations={account ? () => go("settings", "integrations") : null}
        onOpenAudience={() => go("growth", "audience")}
        onOpenAnalytics={() => go("growth", "analytics")}
        onOpenCampaigns={() => go("growth", "campaigns")}
      />
    </div>
  </div>;
}
