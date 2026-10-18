import { useCallback, useRef, useState, type CSSProperties } from "react";
import { useTheme } from "next-themes";
import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { OperationsClientArtifactReview } from "@/solo/operations/OperationsClientArtifactReview";
import { useClientPortalReleasedWork, type PortalReleaseScope } from "@/hooks/useClientPortalReleasedWork";
import type { ClientReleasedDelivery } from "@/solo/operations/operations-client-delivery-discovery";

/**
 * E09 Slice 4 (4B) — "Work for your review" on /app/documents, above the customer's library.
 *
 * Rebuilt from draft #2156's ClientReleasedWork. It renders only when there is something to say: released
 * work, or a read that failed. Each row opens a page-local dialog (not #2156's provider around every
 * route) hosting the unchanged Operations review, whose accept / request-changes run through
 * operations_delivery_client_decide_scoped and are reported only from that component's own readback.
 * The dialog itself carries the portal's tokens; it adds no Solo theme class of its own.
 */
const STATE_LABEL: Record<ClientReleasedDelivery["state"], string> = {
  awaiting_client: "Waiting for you",
  client_revision_requested: "You asked for changes",
  accepted: "Accepted",
};

type Open = { scope: PortalReleaseScope; release: ClientReleasedDelivery; epoch: number; instance: number };

export function ClientReleasedWork({ businessName, accentStyle }: { businessName: string; accentStyle?: CSSProperties }) {
  const released = useClientPortalReleasedWork();
  const { resolvedTheme, forcedTheme } = useTheme();
  const theme = (forcedTheme ?? resolvedTheme) === "dark" ? "dark" : "light";
  const [open, setOpen] = useState<Open | null>(null);
  const [notice, setNotice] = useState("");
  const opener = useRef<HTMLButtonElement | null>(null);
  const guard = useRef<{ instance: number; check: () => boolean } | null>(null);
  const instances = useRef(0);
  const work = released.work;
  // An open review belongs to the identity that opened it; an actor change closes it without asking.
  const shown = open && open.epoch === released.epoch ? open : null;

  const registerCloseGuard = useCallback((check: () => boolean) => {
    const entry = { instance: instances.current, check };
    guard.current = entry;
    return () => { if (guard.current === entry) guard.current = null; };
  }, []);
  const close = () => {
    const entry = guard.current;
    let allowed = true;
    try { allowed = !entry || entry.instance !== shown?.instance || entry.check() === true; } catch { allowed = false; }
    if (!allowed) { setNotice("Finish or clear your review note before closing."); return; }
    setOpen(null); setNotice("");
  };

  if (!work || work.kind === "hidden" || work.kind === "scope_changed") return null;
  if (work.kind === "ready" && work.releases.length === 0 && work.unavailableCount === 0 && !work.hasMore) return null;

  return (
    <section aria-labelledby="client-released-work-title" className="space-y-4" data-client-released-work>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id="client-released-work-title" className="text-base font-semibold">Work for your review</h2>
          <p className="max-w-prose text-sm text-muted-foreground">Work {businessName} has finished and sent you. Review it, then accept it or ask for changes.</p>
        </div>
        <Button variant="ghost" disabled={released.reading} onClick={() => void released.refresh()}>{released.reading ? "Checking…" : "Check again"}</Button>
      </div>
      {work.kind === "unavailable" ? (
        <p role="status" className="max-w-prose text-sm">Work sent for your review couldn’t be checked just now. Try again in a moment.</p>
      ) : (
        <>
          {work.releases.length > 0 && (
            <ul className="divide-y divide-border border-y border-border">
              {work.releases.map(release => (
                <li key={release.release_id} className="flex flex-wrap items-center gap-4 py-4">
                  <FileCheck2 aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 basis-40">
                    <h3 className="line-clamp-2 break-words text-sm font-medium" title={release.title}>{release.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Version {release.revision_no} · <span className={release.state === "awaiting_client" ? "font-medium text-foreground" : undefined}>{STATE_LABEL[release.state]}</span>
                    </p>
                  </div>
                  <Button variant={release.state === "awaiting_client" ? "default" : "outline"}
                    style={release.state === "awaiting_client" ? accentStyle : undefined}
                    aria-label={`Review ${release.title}, version ${release.revision_no}`}
                    onClick={event => {
                      opener.current = event.currentTarget; setNotice("");
                      setOpen({ scope: work.scope, release, epoch: released.epoch, instance: ++instances.current });
                    }}>
                    {release.state === "awaiting_client" ? "Review" : "View"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {(work.unavailableCount > 0 || work.hasMore) && (
            <p role="status" className="text-sm text-muted-foreground">
              {work.unavailableCount > 0 ? `${work.unavailableCount === 1 ? "One item" : `${work.unavailableCount} items`} couldn’t be shown right now. ` : ""}
              {work.hasMore ? "This shows your 40 most recent items." : ""}
            </p>
          )}
        </>
      )}
      <Dialog open={!!shown} onOpenChange={next => { if (!next) close(); }}>
        {shown && (
          <DialogContent overlayClassName="motion-reduce:!animate-none"
            className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-3xl motion-reduce:!animate-none [&>button]:min-h-[44px] [&>button]:min-w-[44px]"
            onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }}>
            <DialogTitle className="sr-only">Review {shown.release.title}</DialogTitle>
            <DialogDescription className="sr-only">Read this version, then accept it or ask {businessName} for changes.</DialogDescription>
            {notice && <p role="status" className="mx-6 mt-6 rounded-md border border-border p-3 text-sm">{notice}</p>}
            <OperationsClientArtifactReview key={shown.instance} actorId={shown.scope.actorId} tenantId={shown.scope.tenantId}
              releaseId={shown.release.release_id} theme={theme} registerCloseGuard={registerCloseGuard}
              onVerifiedDecision={async () => { await released.refresh(); }} />
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
