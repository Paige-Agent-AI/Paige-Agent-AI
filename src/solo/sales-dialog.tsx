import React from "react";
import { createPortal } from "react-dom";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";

type SalesNavigateEvent = Event & { destination: { url: string } };
type SalesNavigation = {
  addEventListener(type: "navigate", listener: (event: SalesNavigateEvent) => void): void;
  removeEventListener(type: "navigate", listener: (event: SalesNavigateEvent) => void): void;
};

/** Keep Sales editors inside Solo's theme, but outside the inert background. */
export function SalesDialogPortal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.querySelector(".solo-campaigns") ?? document.body);
}

export function useSalesDraftExit(draft: unknown, busy: boolean, onClose: () => void, options?: { uncertain?: boolean; recordedDraftFound?: boolean }) {
  const initial = React.useRef(JSON.stringify(draft));
  const [, refreshBaseline] = React.useReducer((value: number) => value + 1, 0);
  const uncertain = options?.uncertain === true;
  const recordedDraftFound = options?.recordedDraftFound === true;
  const dirty = initial.current !== JSON.stringify(draft) || uncertain || recordedDraftFound;
  const bypass = React.useRef(false);
  const retainedRequestLocation = React.useRef<string | null>(null);
  useBeforeUnloadGuard(dirty || busy, bypass);
  const [pending, setPending] = React.useState<null | (() => void)>(null);
  const confirmationRef = React.useRef<HTMLDivElement>(null);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const request = React.useCallback((action = onClose) => {
    if (busy) return;
    if (dirty) setPending(() => action);
    else action();
  }, [busy, dirty, onClose]);
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      // A native editor popup owns its dismissal. The same Sales leave guard
      // remains authoritative for a later, unhandled Escape or navigation.
      if (event.target instanceof Element && event.target.closest('[role="listbox"], [role="menu"]')) return;
      event.preventDefault();
      if (pending) setPending(null); else request();
    };
    // Browser Back/Forward and same-document navigation in browsers with Navigation API.
    // Full-page exits also retain the standard beforeunload protection.
    const navigation = (window as Window & { navigation?: SalesNavigation }).navigation;
    const openedAccount = location.pathname.split("/").slice(0, 3).join("/");
    const sameAccount = (url: string) => new URL(url, location.href).pathname.split("/").slice(0, 3).join("/") === openedAccount;
    const navigate = (event: SalesNavigateEvent) => {
      if (!sameAccount(event.destination.url)) return;
      if (retainedRequestLocation.current === new URL(event.destination.url, location.href).href) return;
      if (bypass.current || !event.cancelable || (!dirty && !busy)) return;
      event.preventDefault();
      if (!busy) setPending(() => () => { bypass.current = true; window.location.assign(event.destination.url); });
    };
    // Sales declares this original request BEFORE calling the router. Waiting
    // only for the browser Navigation event is too late: keyboard focus could
    // already advance even though the route is refused. Reuse this ONE guard.
    const salesNavigate=(event:Event)=>{
      if(event.defaultPrevented||bypass.current||(!dirty&&!busy))return;
      const proceed=(event as CustomEvent<{proceed?:unknown}>).detail?.proceed;
      if(typeof proceed!=='function')return;
      event.preventDefault();
      if(!busy)setPending(()=>()=>{
        // Another registered editor remains authoritative after this editor's
        // explicit leave choice. No callback skips a different work guard.
        const forwarded=new CustomEvent('paige:sales-before-navigation',{cancelable:true,detail:{proceed}});
        if(window.dispatchEvent(forwarded))proceed();
      });
    };
    const openedUrl = location.href;
    const openedState = history.state;
    let restoring = false;
    let pendingDestination = "";
    const pop = (event: PopStateEvent) => {
      if (restoring) { restoring = false; event.stopImmediatePropagation(); if (!busy) setPending(() => () => { bypass.current = true; window.location.assign(pendingDestination); }); return; }
      if (bypass.current || (!dirty && !busy) || !sameAccount(location.href)) return;
      const destination = location.href;
      event.stopImmediatePropagation();
      const delta = typeof openedState?.idx === "number" && typeof event.state?.idx === "number" ? openedState.idx - event.state.idx : 0;
      if (delta) { restoring = true; pendingDestination = destination; history.go(delta); return; }
      else history.pushState(openedState, "", openedUrl);
      if (!busy) setPending(() => () => { bypass.current = true; window.location.assign(destination); });
    };
    if (!navigation) window.addEventListener("popstate", pop, true);
    document.addEventListener("keydown", key);
    window.addEventListener('paige:sales-before-navigation',salesNavigate);
    navigation?.addEventListener("navigate", navigate);
    return () => {
      window.removeEventListener("popstate", pop, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener('paige:sales-before-navigation',salesNavigate);
      navigation?.removeEventListener("navigate", navigate);
    };
  }, [dirty, busy, pending, request]);
  React.useLayoutEffect(() => {
    const panel = confirmationRef.current;
    if (!pending || !panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const siblings = [...(panel.parentElement?.children ?? [])].filter(node => node !== panel);
    siblings.forEach(node => node.setAttribute("inert", ""));
    panel.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { siblings.forEach(node => node.removeAttribute("inert")); previous?.isConnected && previous.focus(); };
  }, [pending]);
  const confirmation = pending ? <div className="so-discard" ref={confirmationRef} role="alertdialog" aria-modal="true" aria-labelledby="so-discard-title" aria-describedby="so-discard-description" onKeyDown={event => {
    if (event.key !== "Tab") return;
    event.preventDefault(); event.stopPropagation();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    buttons[document.activeElement === buttons[0] ? 1 : 0]?.focus();
  }}>
    <h3 id="so-discard-title">{recordedDraftFound ? "Leave this wording?" : uncertain ? "Leave while the save is unconfirmed?" : "Discard unsaved changes?"}</h3>
    <p id="so-discard-description">{recordedDraftFound ? "A retained draft was found. Leaving this editor does not apply its current wording to that record. Review the recorded draft before making corrections." : uncertain ? "An earlier save may still complete. You can check the original request when you return." : "Your changes have not been saved. Continue editing to keep working."}</p>
    <button className="btn btn-p" onClick={() => setPending(null)}>Continue editing</button>
    <button className="btn" onClick={() => { const action = pending; bypass.current = true; setPending(null); action(); }}>{recordedDraftFound ? "Leave current editor" : uncertain ? "Leave and check later" : "Discard changes"}</button>
  </div> : null;
  // Only a verified canonical receipt permits the caller's immediate transition
  // from the editor to that original record. This does not authorize a write.
  const exitAfterSave = (action = onClose) => { bypass.current = true; action(); };
  // Explicit entry/retirement of one editor's reviewed baseline. Never adopt a
  // background read automatically, and never bypass another editor's guard.
  const adoptBaseline = React.useCallback((baseline: unknown) => { initial.current = JSON.stringify(baseline); bypass.current = false; setPending(null); refreshBaseline(); }, []);
  // A same-document recovery checkpoint is not an exit or a saved-work receipt.
  // Permit one explicit opaque request kind and business, only for the SAME
  // agreement. Keep dirty/busy/beforeunload and every other guard active.
  const retainRequestLocation = (url: string, replace: () => void, kind:'signer'|'document'='signer') => {
    const current = new URL(location.href);
    let target: URL;
    try { target = new URL(url, location.href); } catch { return false; }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (target.origin !== current.origin || target.pathname !== current.pathname || target.hash !== current.hash
      || current.searchParams.getAll('agreement').length!==1||target.searchParams.getAll('agreement').length!==1
      || !uuid.test(current.searchParams.get('agreement') ?? '') || target.searchParams.get('agreement') !== current.searchParams.get('agreement')) return false;
    const requestKey=kind==='document'?'agreement_document_request':'agreement_signer_request',otherKey=kind==='document'?'agreement_signer_request':'agreement_document_request';
    const id = target.searchParams.get(requestKey), business = target.searchParams.get('agreement_business');
    if(current.searchParams.has(otherKey)||target.searchParams.has(otherKey)||target.searchParams.getAll(requestKey).length > 1 || target.searchParams.getAll('agreement_business').length > 1
      || (id !== null ? !uuid.test(id) || !uuid.test(business ?? '') : business !== null)) return false;
    for (const key of [requestKey, 'agreement_business']) { current.searchParams.delete(key); target.searchParams.delete(key); }
    current.searchParams.sort(); target.searchParams.sort();
    if (current.search !== target.search) return false;
    const destination = new URL(url, location.href).href;
    retainedRequestLocation.current = destination;
    try { replace(); return location.href === destination; }
    catch { return false; }
    finally { retainedRequestLocation.current = null; }
  };
  return { close: () => request(), request, confirmation, alive, exitAfterSave, adoptBaseline, retainRequestLocation };
}
