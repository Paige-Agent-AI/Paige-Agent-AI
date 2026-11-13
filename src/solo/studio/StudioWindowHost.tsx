import React from "react";
import { Maximize2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTenantContext } from "@/hooks/useTenantContext";
import { STUDIO_SESSION_ID } from "./studio-reference";
import type { StudioLaunch } from "../vibe";

const VibeStudio = React.lazy(() => import("../vibe").then(m => ({ default: m.VibeStudio })));
type WindowState = { launch: StudioLaunch; minimized: boolean };

/** The original shell Studio host, kept above route content. URL state carries
 * only a project navigation pointer; native readers own every access decision. */
export function StudioWindowHost({ openPaige }: { openPaige?: () => void }) {
  const { activeTenantId, activeUserId } = useTenantContext();
  const location = useLocation(), navigate = useNavigate();
  const currentSearch = React.useRef(location.search);
  currentSearch.current = location.search;
  const [windowState, setWindowState] = React.useState<WindowState | null>(null);
  const scope = activeTenantId && activeUserId ? `${activeUserId}:${activeTenantId}` : null;
  const priorScope = React.useRef(scope);
  const hadScope = React.useRef(scope !== null);
  const restored = React.useRef(false);
  const pendingStart = React.useRef<string | undefined>(undefined);
  const returnFocus = React.useRef<{ button: HTMLButtonElement; owner: HTMLElement } | null>(null);
  const focusPending = React.useRef(false);
  const current = windowState?.launch.actorId === activeUserId && windowState.launch.tenantId === activeTenantId ? windowState : null;

  const pointer = React.useCallback((sessionId?: string, minimized = false, pendingStartId?: string) => {
    const params = new URLSearchParams(location.search);
    if (sessionId) params.set("studio", sessionId); else params.delete("studio");
    if (sessionId && minimized) params.set("studio_min", "1"); else params.delete("studio_min");
    if (pendingStartId) params.set("studio_start", pendingStartId); else params.delete("studio_start");
    const search = params.toString();
    if (search !== location.search.replace(/^\?/, "")) navigate({ pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash }, { replace: true });
  }, [location.pathname, location.search, location.hash, navigate]);

  React.useEffect(() => {
    if (!hadScope.current && scope) { hadScope.current = true; priorScope.current = scope; }
    if (priorScope.current !== scope) {
      priorScope.current = scope; restored.current = true;
      pendingStart.current = undefined;
      setWindowState(null); returnFocus.current = null; focusPending.current = false;
      pointer();
      return;
    }
    if (restored.current || !activeTenantId || !activeUserId) return;
    restored.current = true;
    const params = new URLSearchParams(location.search), id = params.get("studio"), pending = params.get("studio_start");
    pendingStart.current = pending && STUDIO_SESSION_ID.test(pending) ? pending : undefined;
    if (id && STUDIO_SESSION_ID.test(id) || pending && STUDIO_SESSION_ID.test(pending)) setWindowState({
      launch: { key: crypto.randomUUID(), tenantId: activeTenantId, actorId: activeUserId, ...(id && STUDIO_SESSION_ID.test(id) ? { sessionId: id } : {}), ...(pending && STUDIO_SESSION_ID.test(pending) ? { pendingStartId: pending } : {}) },
      minimized: params.get("studio_min") === "1",
    });
  }, [scope, activeTenantId, activeUserId, location.search, pointer]);

  React.useEffect(() => {
    if (!activeTenantId || !activeUserId) return;
    const open = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const target = event.detail?.returnFocus;
      const owner = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-tenant-shell]") : null;
      if (!(target instanceof HTMLButtonElement) || !target.isConnected || target.disabled || !owner
        || !target.hasAttribute("data-solo-vibe-studio-launcher") || target.closest('[hidden],[aria-hidden="true"],[inert]')) return;
      const id: unknown = event.detail?.sessionId;
      if (id !== undefined && (typeof id !== "string" || !STUDIO_SESSION_ID.test(id))) return;
      returnFocus.current = { button: target, owner }; focusPending.current = false;
      setWindowState(previous => {
        const sameScope = previous?.launch.actorId === activeUserId && previous.launch.tenantId === activeTenantId;
        if (sameScope && (!id || id === previous.launch.sessionId)) return { ...previous, minimized: false };
        const pending = pendingStart.current ?? new URLSearchParams(currentSearch.current).get("studio_start");
        return { launch: { key: crypto.randomUUID(), actorId: activeUserId, tenantId: activeTenantId, ...(typeof id === "string" ? { sessionId: id } : {}), ...(!id && pending && STUDIO_SESSION_ID.test(pending) ? { pendingStartId: pending } : {}) }, minimized: false };
      });
    };
    window.addEventListener("paige-studio", open);
    return () => window.removeEventListener("paige-studio", open);
  }, [activeTenantId, activeUserId]);

  React.useEffect(() => {
    if (current) pointer(current.launch.sessionId, current.minimized, current.launch.pendingStartId);
    else if (pendingStart.current) pointer(undefined, false, pendingStart.current);
  }, [current, pointer]);
  React.useLayoutEffect(() => {
    if (!focusPending.current || (current && !current.minimized)) return;
    focusPending.current = false;
    const source = returnFocus.current;
    if (source?.button.isConnected && source.owner.isConnected && !source.button.disabled
      && source.button.closest("[data-tenant-shell]") === source.owner
      && !source.button.closest('[hidden],[aria-hidden="true"],[inert]') && source.button.getClientRects().length > 0) source.button.focus({ preventScroll: true });
  }, [current]);
  const close = React.useCallback(() => { focusPending.current = true; setWindowState(null); pointer(undefined, false, pendingStart.current); }, [pointer]);
  const minimize = React.useCallback(() => { focusPending.current = true; setWindowState(s => s ? { ...s, minimized: true } : s); }, []);
  const projectChanged = React.useCallback((id: string | null) => {
    if (id !== null && !STUDIO_SESSION_ID.test(id)) return;
    setWindowState(s => !s || s.launch.sessionId === (id ?? undefined) ? s : { ...s, launch: { ...s.launch, sessionId: id ?? undefined } });
  }, []);
  const startPending = React.useCallback((requestId: string | null) => {
    if (requestId !== null && !STUDIO_SESSION_ID.test(requestId)) return;
    pendingStart.current = requestId ?? undefined;
    setWindowState(s => s ? { ...s, launch: { ...s.launch, pendingStartId: requestId ?? undefined } } : s);
  }, []);

  return <>
    {current && <React.Suspense fallback={<div role="status">Opening Studio…</div>}><VibeStudio
      launch={current.launch} minimized={current.minimized} onMinimize={minimize} onBack={close}
      onProjectChange={projectChanged} onStartPending={startPending} openPaige={openPaige} /></React.Suspense>}
    {current?.minimized && <button type="button" className="vs-restore" aria-controls="solo-studio-window" onClick={() => setWindowState(s => s ? { ...s, minimized: false } : s)}><Maximize2 size={15} aria-hidden="true" />Restore Studio</button>}
  </>;
}
