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
import { Activity, Image as ImageIcon, Layers, Sparkles, TrendingUp, Users } from "lucide-react";
import { ADS_VIEWS, MarketingAds, adsViewOf, ADS_ASK_PROMPT, type AdsView } from "./marketing-ads";
import { AskPaigeButton } from "./marketing-planned";
import "./solo-campaigns.css";

// The department strip every Solo department carries (Marketing, Sales): full width under the header,
// icon and label per view, the active one underlined, and the department's own action at the far end.
const VIEW_ICONS: Record<AdsView, typeof Activity> = { overview: Activity, campaigns: Layers, creative: ImageIcon, audiences: Users, performance: TrendingUp };

export function AdsWorkspace({ tenantId, businessName }: { tenantId: string | null; businessName?: string | null }) {
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

  const current = adsViewOf(view);
  return <div className="solo-campaigns" data-ads-view={view}>
    <h1 className="campaigns-sr-only">Ads</h1>
    <AdsTabs current={current} onView={setView}/>
    <div id="ads-tabpanel" role="tabpanel" aria-labelledby={`ads-tab-${current}`} className="campaigns-scroll">
      <MarketingAds
        tenantId={tenantId}
        businessName={businessName ?? null}
        view={current}
        onView={setView}
        onOpenIntegrations={account ? () => go("settings", "integrations") : null}
        onOpenAudience={() => go("growth", "audience")}
        onOpenAnalytics={() => go("growth", "analytics")}
        onOpenCampaigns={() => go("growth", "campaigns")}
        onOpenSales={account ? () => go("sales", "overview") : null}
      />
    </div>
  </div>;
}

function AdsTabs({ current, onView }: { current: AdsView; onView: (view: AdsView) => void }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  // As Marketing's strip does: when the strip scrolls (PAIGE expanded, narrow widths), the selected view
  // is brought into it, so a bookmark to Performance never opens with its tab hidden past the edge.
  React.useLayoutEffect(() => {
    document.getElementById(`ads-tab-${current}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current]);
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? ADS_VIEWS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + ADS_VIEWS.length) % ADS_VIEWS.length;
    onView(ADS_VIEWS[next].key);
    refs.current[next]?.focus({ preventScroll: true });
  };
  return <div className="campaigns-nav">
    <div className="campaigns-tabs" role="tablist" aria-label="Ads views">
      {ADS_VIEWS.map((item, index) => {
        const Icon = VIEW_ICONS[item.key];
        return <button key={item.key} ref={(node) => { refs.current[index] = node; }} id={`ads-tab-${item.key}`} role="tab" aria-controls="ads-tabpanel" aria-selected={current === item.key} tabIndex={current === item.key ? 0 : -1} onClick={() => onView(item.key)} onKeyDown={(event) => onKeyDown(event, index)}><Icon size={14} aria-hidden="true"/><span>{item.label}</span></button>;
      })}
    </div>
    <AskPaigeButton className="btn-p campaigns-studio" icon={<Sparkles size={13} aria-hidden="true"/>} label="Ask PAIGE for ad copy" prompt={ADS_ASK_PROMPT}/>
  </div>;
}
