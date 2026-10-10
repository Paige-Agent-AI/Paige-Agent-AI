// Helpers Marketing's tabs share: a tenant-scoped read (useTenantRead), its loading and error frame
// (Frame), the tab's own acts (TabActions), Ask PAIGE, the honest "not available yet" list (NotYet), and
// who may read the saved library (useLibraryAccess). Content lives in marketing-content.tsx, Ads in
// marketing-ads.tsx, Audience in marketing-audience.tsx, Email in marketing-email.tsx.
//   marketing_content (the saved library) RLS: is_tenant_admin of the row's business, or the platform
//   owner (20270542000000), which is the same test the briefs read reports as can_manage, so a member
//   who cannot read it is told so rather than shown an empty library.
import React from "react";
import { useSoloCampaignBriefs } from "./useSoloCampaignBriefs";

export type Phase = "loading" | "ready" | "error";
type Read<T> = { phase: Phase; rows: T; retry: () => void };

/** A tenant-scoped read that ignores answers for a tenant the page has left. `load` null = not yet. */
export function useTenantRead<T>(tenantId: string | null, empty: T, load: ((tenantId: string) => Promise<T>) | null): Read<T> {
  const [state, setState] = React.useState<{ tenantId: string | null; phase: Phase; rows: T }>({ tenantId: null, phase: "loading", rows: empty });
  const [attempt, setAttempt] = React.useState(0);
  const loadRef = React.useRef(load);
  loadRef.current = load;
  const enabled = Boolean(load);
  React.useEffect(() => {
    if (!tenantId || !loadRef.current) return;
    let live = true;
    setState({ tenantId, phase: "loading", rows: empty });
    loadRef.current(tenantId)
      .then((rows) => { if (live) setState({ tenantId, phase: "ready", rows }); })
      .catch((error) => { console.error("[marketing] read failed", error); if (live) setState({ tenantId, phase: "error", rows: empty }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `empty` is a constant per call site
  }, [tenantId, attempt, enabled]);
  const current = state.tenantId === tenantId;
  return { phase: current ? state.phase : "loading", rows: current ? state.rows : empty, retry: () => setAttempt((n) => n + 1) };
}

/** Opens PAIGE with a question in her composer. She drafts; nothing is sent until the owner says so. */
export function AskPaigeButton({ label, prompt }: { label: string; prompt: string }) {
  return <button type="button" className="btn btn-s" onClick={() => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt } }))}>{label}</button>;
}

export function Frame({ phase, retry, noun, children }: { phase: Phase; retry: () => void; noun: string; children: React.ReactNode }) {
  if (phase === "loading") return <div className="campaigns-skeleton mp-skeleton" role="status" aria-busy="true" aria-label={`Loading ${noun}`}><span/><span/><span/></div>;
  if (phase === "error") return <div className="campaigns-state mp-state"><h3>{`Your ${noun} could not load`}</h3><p>Nothing was changed. Try again.</p><button className="btn btn-s" onClick={retry}>Try again</button></div>;
  return <>{children}</>;
}

/** The tab's own acts, right-aligned above its panels. The tab strip already names the tab, so
 *  nothing here repeats its name or what it is for (owner, 2026-10-04: no redundant words). */
export function TabActions({ children }: { children: React.ReactNode }) {
  return <div className="mp-actions">{children}</div>;
}

/** The honest list: each missing piece, and why. */
export function NotYet({ items }: { items: { title: string; detail: string }[] }) {
  return <section className="campaigns-surface mo-panel mp-notyet" aria-label="Not available yet">
    <div className="mo-panel-head"><div><h2>Not available yet</h2><p>What this tab will do once it is built. Nothing here is estimated.</p></div></div>
    <ul className="mp-list">{items.map((item) => <li key={item.title}><span className="mp-list-main"><strong>{item.title}</strong><small>{item.detail}</small></span></li>)}</ul>
  </section>;
}

/** Who may read the saved library: admins of this workspace (the same test its read policy applies). */
export function useLibraryAccess(): "checking" | "allowed" | "denied" {
  const briefs = useSoloCampaignBriefs();
  if (briefs.phase === "ready") return briefs.canManage ? "allowed" : "denied";
  // If the briefs read fails, still try the library; its own error state then speaks for it.
  return briefs.phase === "error" || briefs.phase === "unavailable" ? "allowed" : "checking";
}

export const LIBRARY_DENIED = "Your workspace's saved library is visible to its owners and admins.";

export type PublishedWork = { phase: string; pages: number; funnels: number; forms: number; unpublished: number };
