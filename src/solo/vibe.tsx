// Vibe Studio — the Solo creative surface, opened from Campaigns.
//
// LINEAGE (this workstream's collision map):
//   canonical       — THIS surface. Studio home ("What should Paige build?") opens one project per
//                     brief; inside a project the owner works with Paige in the owner-locked layout C
//                     (chat, stage, timeline) and publishes to Marketing › Overview (src/solo/studio/*).
//                     Images & video keeps the direct media tools, moved unchanged into
//                     studio/MediaTools.tsx.
//   legacy-operator — deleted in this rebuild (the unrouted pages/admin Studio pages and the
//                     components/admin/studio files only they used). LivePreview, DocumentPreview
//                     and studio.ts stay: live surfaces still render through them.
//   fixture-only    — src/agency/vibe.tsx.
//
// ONE SESSION (§19/§21): no artifact-type tabs and no pre-classification gate. The brief decides what
// Paige builds; the project holds whatever she makes. Unpublished work lives here as drafts;
// published work lives in Marketing › Overview (capture points).
import React from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { handOffPaigePrompt } from "@/lib/paigePromptHandoff";
import { StudioHome, StudioRail } from "./studio/StudioHome";
import { StudioSession } from "./studio/StudioSession";
import { MediaTools } from "./studio/MediaTools";
import { listSessions, plainError, type StudioSession as Session } from "./studio/studio-data";
import "./studio/studio.css";

export { VsStars } from "./studio/VsStars";

// seedBrief is set ONLY when a project was just created from Studio home. Reopening a project never
// passes it: threads are per person, so a teammate (or an expired thread) would otherwise rebuild it.
type View = { name: "home" } | { name: "media" } | { name: "session"; id: string; seedBrief: string | null };

/** A shell-bound navigation pointer. Original native readers revalidate access;
 * these fields cannot confer permission or seed a new generation. */
export type StudioLaunch = { key: string; tenantId: string; actorId: string; sessionId?: string; pendingStartId?: string };
type StudioWindowProps = {
  onBack: () => void;
  openPaige?: () => void;
  minimized?: boolean;
  onMinimize?: () => void;
  launch?: StudioLaunch;
  onProjectChange?: (sessionId: string | null) => void;
  onStartPending?: (requestId: string | null) => void;
};

export const VibeStudio = (props: StudioWindowProps) => {
  const { activeTenantId, activeTenant, activeUserId } = useTenantContext();
  if (!activeTenantId || !activeUserId) return null;
  const launch = props.launch?.tenantId === activeTenantId && props.launch.actorId === activeUserId ? props.launch : undefined;
  return <StudioWorkspaceWindow key={`${activeUserId}:${activeTenantId}`} {...props} launch={launch} tenantId={activeTenantId} tenantSlug={activeTenant?.slug ?? ""} />;
};

function StudioWorkspaceWindow({ onBack, openPaige, minimized = false, onMinimize, launch, onProjectChange, onStartPending, tenantId, tenantSlug }: StudioWindowProps & { tenantId: string; tenantSlug: string }) {
  const [view, setView] = React.useState<View>(() => launch?.sessionId ? { name: "session", id: launch.sessionId, seedBrief: null } : { name: "home" });
  const [sessions, setSessions] = React.useState<Session[] | null>(null);
  const [sessionsError, setSessionsError] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  const listEpoch = React.useRef(0);
  React.useEffect(() => { const epoch = listEpoch; alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  const lastLaunch = React.useRef(launch?.key);
  React.useEffect(() => {
    if (!launch || lastLaunch.current === launch.key) return;
    lastLaunch.current = launch.key;
    if (launch.sessionId) setView({ name: "session", id: launch.sessionId, seedBrief: null });
  }, [launch]);
  React.useEffect(() => { onProjectChange?.(view.name === "session" ? view.id : null); }, [view, onProjectChange]);

  // "Plan/Review with NEXUS" (roster doctrine, EXP06): the handoff PREFILLS the owner's global
  // PAIGE composer — addressed to NEXUS, editable, never sent — and closes the Studio so the chat
  // is reachable. It never relabels the Studio's design conversation, and no artifact byline changes.
  // Without a shell that can open the chat there is no affordance at all (a stranded prefill would
  // be a dishonest entry), so the callback itself is absent.
  const onNexusHandoff = React.useMemo(
    () => openPaige
      ? (prompt: string) => { handOffPaigePrompt(prompt); (onMinimize ?? onBack)(); openPaige(); }
      : undefined,
    [onBack, onMinimize, openPaige]);

  const refresh = React.useCallback(() => {
    const epoch = ++listEpoch.current;
    listSessions()
      .then((s) => { if (alive.current && epoch === listEpoch.current) { setSessions(s); setSessionsError(null); } })
      .catch((e) => { if (alive.current && epoch === listEpoch.current) { setSessions([]); setSessionsError(plainError(e, "Your drafts couldn't be loaded.")); } });
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  // On Studio home and in Images & video, Esc closes the Studio (an open native select keeps its own
  // Esc). Inside a project, the project owns Esc and steps back here first.
  React.useEffect(() => {
    if (minimized || view.name === "session") return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === "SELECT") return;
      onBack();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onBack, view.name, minimized]);

  // The Studio is a modal surface over the Solo shell: Tab and Shift+Tab wrap inside it instead of
  // walking into the app hidden behind it.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => { rootRef.current?.toggleAttribute("inert", minimized); }, [minimized]);
  React.useEffect(() => {
    if (minimized) return;
    const k = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (e.key !== "Tab" || !root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")]
        .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && root.contains(active);
      if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [minimized]);
  React.useEffect(() => {
    if (!minimized && rootRef.current && !rootRef.current.contains(document.activeElement)) {
      rootRef.current.querySelector<HTMLElement>("textarea:not(:disabled), button:not(:disabled), [tabindex='0']")?.focus({ preventScroll: true });
    }
  }, [minimized]);

  return (
    <div id="solo-studio-window" ref={rootRef} className="vs-studio" role="dialog" aria-modal={minimized ? undefined : true} aria-label="Vibe Studio" hidden={minimized}>
      {view.name === "session" ? (
        <StudioSession
          key={view.id}
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          sessionId={view.id}
          seedBrief={view.seedBrief}
          onNexusHandoff={onNexusHandoff}
          onMinimize={onMinimize}
          minimized={minimized}
          onScopeRefused={onBack}
          onBack={() => { setView({ name: "home" }); refresh(); }}
        />
      ) : (
        <div className="vs-home">
          <StudioRail
            view={view.name === "media" ? "media" : "home"}
            sessions={sessions}
            onBack={onBack}
            onMinimize={onMinimize}
            onHome={() => setView({ name: "home" })}
            onMedia={() => setView({ name: "media" })}
            onOpen={(s) => setView({ name: "session", id: s.id, seedBrief: null })}
          />
          {view.name === "media" ? (
            <div className="vs-main" data-vibe-scroll-owner><MediaTools /></div>
          ) : (
            <StudioHome sessions={sessions} sessionsError={sessionsError} tenantId={tenantId} tenantSlug={tenantSlug} recoverStartId={launch?.pendingStartId} onStartPending={onStartPending} onNexusHandoff={onNexusHandoff} onOpen={(id, brief) => setView({ name: "session", id, seedBrief: brief })} />
          )}
        </div>
      )}
    </div>
  );
}
