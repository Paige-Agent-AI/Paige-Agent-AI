// Vibe Studio — the Solo creative surface, opened from Campaigns.
//
// LINEAGE (this workstream's collision map):
//   canonical       — THIS surface. Studio home ("What should Paige build?") opens one project per
//                     brief; inside a project the owner works with Paige in the owner-locked layout C
//                     (chat, stage, timeline) and publishes to the Catalog (src/solo/studio/*).
//                     Images & video keeps the direct media tools, moved unchanged into
//                     studio/MediaTools.tsx.
//   legacy-operator — deleted in this rebuild (the unrouted pages/admin Studio pages and the
//                     components/admin/studio files only they used). LivePreview, DocumentPreview
//                     and studio.ts stay: live surfaces still render through them.
//   fixture-only    — src/agency/vibe.tsx.
//
// ONE SESSION (§19/§21): no artifact-type tabs and no pre-classification gate. The brief decides what
// Paige builds; the project holds whatever she makes. Unpublished work lives here as drafts;
// published work lives in the Catalog.
import React from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { StudioHome, StudioRail } from "./studio/StudioHome";
import { StudioSession } from "./studio/StudioSession";
import { MediaTools } from "./studio/MediaTools";
import { listSessions, plainError, type StudioSession as Session } from "./studio/studio-data";
import "./studio/studio.css";

export { VsStars } from "./studio/VsStars";

type View = { name: "home" } | { name: "media" } | { name: "session"; id: string; seedBrief: string | null };

export const VibeStudio = ({ onBack }: { onBack: () => void }) => {
  const { activeTenantId, activeTenant } = useTenantContext();
  const [view, setView] = React.useState<View>({ name: "home" });
  const [sessions, setSessions] = React.useState<Session[] | null>(null);
  const [sessionsError, setSessionsError] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    if (!activeTenantId) return;
    listSessions()
      .then((s) => { setSessions(s); setSessionsError(null); })
      .catch((e) => { setSessions([]); setSessionsError(plainError(e, "Your drafts couldn't be loaded.")); });
  }, [activeTenantId]);
  React.useEffect(() => { refresh(); }, [refresh]);

  // On Studio home and in Images & video, Esc closes the Studio (an open native select keeps its own
  // Esc). Inside a project, the project owns Esc and steps back here first.
  React.useEffect(() => {
    if (view.name === "session") return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === "SELECT") return;
      onBack();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onBack, view.name]);

  return (
    <div className="vs-studio" role="dialog" aria-modal="true" aria-label="Vibe Studio">
      {view.name === "session" && activeTenantId ? (
        <StudioSession
          key={view.id}
          tenantId={activeTenantId}
          tenantSlug={activeTenant?.slug ?? ""}
          sessionId={view.id}
          seedBrief={view.seedBrief}
          onBack={() => { setView({ name: "home" }); refresh(); }}
        />
      ) : (
        <div className="vs-home">
          <StudioRail
            view={view.name === "media" ? "media" : "home"}
            sessions={sessions}
            onBack={onBack}
            onHome={() => setView({ name: "home" })}
            onMedia={() => setView({ name: "media" })}
            onOpen={(s) => setView({ name: "session", id: s.id, seedBrief: s.seedBrief })}
          />
          {view.name === "media" ? (
            <div className="vs-main" data-vibe-scroll-owner><MediaTools /></div>
          ) : (
            <StudioHome sessions={sessions} sessionsError={sessionsError} onOpen={(id, brief) => setView({ name: "session", id, seedBrief: brief })} />
          )}
        </div>
      )}
    </div>
  );
};
