import React from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { loadStudioBusinessTargets, type StudioBusinessTarget } from "./studio-data";
import type { StudioBusinessSource, StudioContextTarget } from "./business-context";

/** Explicit selection of minimal business identity. It never reads saved client
 * facts, writes a record, or confers access; native Start/save rechecks the source. */
type BusinessSelectorProps = {
  tenantId: string; target: StudioContextTarget; selected?: StudioBusinessSource;
  disabled?: boolean; onSelect: (business: StudioBusinessTarget | null) => void;
};
export function StudioBusinessSelector(props: BusinessSelectorProps) {
  if (props.target.kind !== "client" && props.target.kind !== "prospect") return null;
  return <CurrentBusinessSelector {...props} />;
}
function CurrentBusinessSelector({ tenantId, target, selected, disabled = false, onSelect }: BusinessSelectorProps) {
  const account = useTenantContext();
  const currentAccount = account.accountContextStatus === "ready" && !account.accountContextLoading
    && !!account.activeUserId && account.activeTenantId === tenantId && account.activeTenant?.id === tenantId;
  const key = `${currentAccount ? account.activeUserId : "unavailable"}:${tenantId}:${target.kind}:${"reference" in target ? target.reference : ""}`;
  const scopeRef = React.useRef<{ key: string; live: boolean; pending: boolean; controller?: AbortController }>({ key, live: true, pending: false });
  if (scopeRef.current.key !== key) {
    scopeRef.current.live = false; scopeRef.current.controller?.abort();
    scopeRef.current = { key, live: true, pending: false };
  }
  const scope = scopeRef.current;
  const [state, setState] = React.useState<{ key: string; query: string; phase: "idle" | "loading" | "ready" | "error"; rows: StudioBusinessTarget[] }>({ key, query: "", phase: "idle", rows: [] });
  const view = state.key === key ? state : { key, query: "", phase: "idle" as const, rows: [] };
  const uid = React.useId();
  React.useEffect(() => {
    scope.live = true;
    return () => { scope.live = false; scope.controller?.abort(); };
  }, [scope]);
  const locked = disabled || !currentAccount || view.phase === "loading";
  async function search() {
    if (disabled || !currentAccount || scope.pending || !scope.live || scopeRef.current !== scope) return;
    scope.pending = true;
    const controller = new AbortController(); scope.controller = controller;
    const current = () => scope.live && scopeRef.current === scope && !controller.signal.aborted;
    let expired!: () => void;
    const cancelled = new Promise<null>(resolve => { expired = () => resolve(null); controller.signal.addEventListener("abort", expired, { once: true }); });
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    setState({ key, query: view.query, phase: "loading", rows: [] });
    try {
      const rows = await Promise.race([loadStudioBusinessTargets(tenantId, view.query, controller.signal), cancelled]);
      if (scope.live && scopeRef.current === scope) setState({ key, query: view.query, phase: current() && rows ? "ready" : "error", rows: current() && rows ? rows : [] });
    } catch { if (scope.live && scopeRef.current === scope) setState({ key, query: view.query, phase: "error", rows: [] }); }
    finally { window.clearTimeout(timer); controller.signal.removeEventListener("abort", expired); scope.pending = false; }
  }
  return <div className="vs-context-business">
    <div className="vs-context-field">
      <label htmlFor={`${uid}-query`}>Find an existing business</label>
      <input id={`${uid}-query`} type="search" maxLength={120} value={view.query} disabled={locked}
        placeholder="Business name" onChange={event => setState({ key, query: event.target.value, phase: "idle", rows: [] })} />
    </div>
    <div className="vs-context-targets"><button type="button" disabled={locked} onClick={() => void search()}>{view.phase === "loading" ? "Searching…" : "Search businesses"}</button></div>
    {view.phase === "ready" && !!view.rows.length && <div className="vs-context-field">
      <label htmlFor={`${uid}-business`}>Choose a business</label>
      <select id={`${uid}-business`} disabled={locked} value="" onChange={event => {
        if (locked || !scope.live || scopeRef.current !== scope) return;
        const business = view.rows.find(row => row.id === event.target.value);
        if (business) onSelect(business);
      }}><option value="" disabled>Choose a business</option>{view.rows.map(row => <option key={row.id} value={row.id}>{row.entity_name}</option>)}</select>
    </div>}
    {view.phase === "ready" && !view.rows.length && <p className="vs-context-note" role="status">No matching business is available in this search. You can use project details below.</p>}
    {view.phase === "error" && <p className="vs-context-note" role="status">These businesses could not be read. Try the same search again or use project details below.</p>}
    {selected && <p className="vs-context-note">Selected business: {"label" in target && target.label ? target.label : "saved business identity"}. Other details below belong to this project.</p>}
    {selected && <button type="button" className="vs-context-reset" disabled={locked} onClick={() => onSelect(null)}>Use project details only</button>}
    {!selected && <p className="vs-context-note">Optional. Selecting a business uses its identity only; enter any other details for this project.</p>}
  </div>;
}
