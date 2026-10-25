import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlyphPlate } from "@/components/ui/page";
import { type CustomerUpdateManifest, usePlatformUpdate } from "@/hooks/usePlatformUpdate";
import { useScopedUserId } from "@/hooks/useScopedUserId";
import { useHasUnsavedWork } from "@/hooks/useBeforeUnloadGuard";

type BannerViewProps = {
  updateAvailable: boolean;
  customerUpdate: CustomerUpdateManifest | null;
  recentRelease: CustomerUpdateManifest | null;
  reload: () => boolean;
  dismiss: () => void;
};

function isEditableTarget(target: Element | null) {
  return !!target?.closest("input, textarea, select, [contenteditable='true']");
}

function useEditingFocus() {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const update = () => setEditing(isEditableTarget(document.activeElement));
    const afterFocusOut = () => requestAnimationFrame(update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", afterFocusOut);
    update();
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", afterFocusOut);
    };
  }, []);
  return editing;
}

function releaseTitle(release: CustomerUpdateManifest) {
  return release.releaseName.toLowerCase().includes(release.version.toLowerCase())
    ? release.releaseName
    : `${release.releaseName} ${release.version}`;
}

export function PlatformUpdateBannerView({ updateAvailable, customerUpdate, recentRelease, reload, dismiss }: BannerViewProps) {
  const reduce = useReducedMotion();
  const detailId = useId();
  const editing = useEditingFocus();
  const unsavedWork = useHasUnsavedWork();
  const [expanded, setExpanded] = useState(false);
  const [reloadBlocked, setReloadBlocked] = useState(false);
  const release = customerUpdate ?? recentRelease;
  const show = updateAvailable || !!recentRelease;

  const handleReload = () => {
    setReloadBlocked(!reload());
  };

  if (editing || unsavedWork) return null;

  return (
    <AnimatePresence>
      {show && (
        <motion.section
          aria-label="Paige update"
          initial={reduce ? { opacity: 1 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30 }}
          className="fixed inset-x-0 bottom-4 z-[100] mx-auto w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-xl border border-border bg-card/95 text-card-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80"
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <GlyphPlate icon={RefreshCw} size="sm" ring="indigo" />
            <div className="min-w-0 flex-1" role="status" aria-live="polite">
              <p className="text-sm font-medium leading-snug">
                {release ? `${releaseTitle(release)} is ready` : "An update is ready"}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                {reloadBlocked
                  ? "Finish or save your current work before reloading."
                  : release?.customerOutcome ?? "Reload when you’re ready to use the latest build."}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {release && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    onClick={() => setExpanded((value) => !value)}
                    className="min-h-11 px-3 text-xs"
                  >
                    What&apos;s new
                    <ChevronDown className={`ml-1 h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </Button>
                )}
                {updateAvailable && (
                  <Button variant="gold" size="sm" onClick={handleReload} className="min-h-11 shrink-0">
                    Reload
                  </Button>
                )}
              </div>
            </div>
            <button
              type="button"
              aria-label="Dismiss update notice"
              onClick={dismiss}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {release && expanded && (
            <div id={detailId} className="max-h-[min(55vh,28rem)] overflow-y-auto border-t border-border px-4 py-3 text-xs leading-relaxed">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-foreground">What changed</dt>
                  <dd className="mt-0.5 text-muted-foreground">{release.whatChanged}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Who it affects</dt>
                  <dd className="mt-0.5 text-muted-foreground">{release.whoCanUseIt}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">What you can do now</dt>
                  <dd className="mt-0.5 text-muted-foreground">{release.ownerAction}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Availability</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {release.status.map((status) => <span key={status} className="rounded-full border border-border bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">{status}</span>)}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-medium text-foreground">Known limitations</dt>
                  <dd className="mt-0.5 text-muted-foreground">{release.knownLimitations}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-medium text-foreground">Safe next step</dt>
                  <dd className="mt-0.5 text-muted-foreground">{release.safeNextStep}</dd>
                </div>
              </dl>
            </div>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}

export function PlatformUpdateBanner() {
  const platformUpdate = usePlatformUpdate();
  const userId = useScopedUserId();
  if (userId === null) return null;
  return <PlatformUpdateBannerView {...platformUpdate} />;
}
