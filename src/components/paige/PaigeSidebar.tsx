// The command-center right rail (cc-spec §2). The BODY (customer selector + live
// feed) is natural-height and reusable; the desktop workspace flows it inside one
// scroll column with the Customize button pinned to the aside floor, while the
// mobile sheet wraps the same body in its own scroll + floor. One implementation,
// no re-build.
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomerSelector } from "./CustomerSelector";
import { CustomerMiniCard } from "./CustomerMiniCard";
import { LiveActionFeed } from "./LiveActionFeed";
import { PaigeRailFeed } from "./PaigeRailFeed";
import { PaigeWhosHere } from "./PaigeWhosHere";
import type { FocusedClient } from "./commandCenterTypes";
import type { ApprovalQueueRow } from "@/hooks/usePendingApprovals";

interface Props {
  focused: FocusedClient | null;
  onFocus: (client: FocusedClient) => void;
  onClear: () => void;
  onCustomize: () => void;
  approvals: ApprovalQueueRow[];
  approvalsLoading: boolean;
  /** Active tenant id — powers the tenant-wide live rail strip. Null → placeholder. */
  tenantId: string | null;
}

/** Customer selector + live action feed, natural height (no wrapper scroll/floor). */
export function PaigeSidebarBody({ focused, onFocus, onClear, approvals, approvalsLoading, tenantId }: Omit<Props, "onCustomize">) {
  return (
    <div className="space-y-3">
      {/* Customer selector */}
      <div className="space-y-2 rounded-lg border bg-card/60 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Work a customer</p>
        {focused ? (
          <CustomerMiniCard client={focused} onClear={onClear} />
        ) : (
          <>
            <CustomerSelector onSelect={onFocus} />
            <p className="text-xs text-muted-foreground">Pick someone and Paige focuses on them.</p>
          </>
        )}
      </div>

      {/* Who's here — live presence roster (§148): see who's on the platform right now */}
      <div className="rounded-lg border bg-card/60 p-3">
        <PaigeWhosHere />
      </div>

      {/* Live action feed */}
      <div className="rounded-lg border bg-card/60 p-3">
        <LiveActionFeed approvals={approvals} approvalsLoading={approvalsLoading} focused={focused} />
      </div>

      {/* Across your clients — live (tenant-wide Context Rail, STEP 3) */}
      <div className="rounded-lg border bg-card/60 p-3">
        <PaigeRailFeed tenantId={tenantId} />
      </div>
    </div>
  );
}

/** The Customize-Paige floor button — gold OUTLINE (S2), never solid. */
export function CustomizeFloor({ onCustomize }: { onCustomize: () => void }) {
  return (
    <Button
      onClick={onCustomize}
      variant="outline"
      className="w-full border-accent/50 text-accent hover:bg-accent/10 hover:text-accent"
    >
      <SlidersHorizontal className="mr-2 h-4 w-4" /> Customize Paige
    </Button>
  );
}

/** Full rail — used by the mobile sheet. The body scrolls; Customize is pinned. */
export function PaigeSidebar({ onCustomize, ...body }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <PaigeSidebarBody {...body} />
      </div>
      <div className="shrink-0 border-t p-3">
        <CustomizeFloor onCustomize={onCustomize} />
      </div>
    </div>
  );
}
