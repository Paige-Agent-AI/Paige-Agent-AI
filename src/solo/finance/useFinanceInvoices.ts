import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listInvoiceRecords, type InvoiceRecord } from "../sales/invoiceLifecycleApi";
import type { BillingRpc } from "../sales/billingDrafts";
interface ReadState { identity: string; phase: "loading" | "ready" | "error" | "denied" | "unavailable"; rows: InvoiceRecord[]; hasMore: boolean; cursor: string | null; readAt: string | null }
/** Sales owns the read and server authorization. No raw-table fallback or second ledger. */
export function useFinanceInvoices(epoch: string | null | undefined) {
 const [attempt, setAttempt] = useState(0);
 const [authRevision, setAuthRevision] = useState(0);
 const [page, setPage] = useState<string | null>(null);
 const identity = `${epoch ?? "unresolved"}:${attempt}:${authRevision}`;
 const current = useRef(identity); current.current = identity;
 const [state, setState] = useState<ReadState>({ identity: "", phase: "loading", rows: [], hasMore: false, cursor: null, readAt: null });
 useEffect(() => { const { data } = supabase.auth.onAuthStateChange(() => { current.current = "authentication changed"; setPage(null); setAuthRevision(n => n + 1); }); return () => data.subscription.unsubscribe(); }, []);
 useEffect(() => { setPage(null); }, [epoch, attempt, authRevision]);
 useEffect(() => {
  let alive = true;
  if (!epoch) { setState({ identity, phase: "unavailable", rows: [], hasMore: false, cursor: null, readAt: null }); return; }
  // A page cursor belongs only to the identity that produced it.
  if (page && state.identity !== identity) return;
  setState(previous => ({ identity, phase: "loading", rows: page && previous.identity === identity ? previous.rows : [], hasMore: false, cursor: null, readAt: page && previous.identity === identity ? previous.readAt : null }));
  void listInvoiceRecords(supabase.rpc.bind(supabase) as unknown as BillingRpc, epoch, page).then(result => {
   if (!alive || current.current !== identity) return;
   if (result.ok === false) { setState({ identity, phase: result.outcome === "refused" ? "denied" : "error", rows: [], hasMore: false, cursor: null, readAt: null }); return; }
   setState(previous => ({ identity, phase: "ready", rows: page && previous.identity === identity ? [...previous.rows, ...result.value.rows].filter((row, i, rows) => rows.findIndex(item => item.id === row.id) === i) : result.value.rows, hasMore: result.value.hasMore, cursor: result.value.nextCursor, readAt: page && previous.identity === identity ? previous.readAt : new Date().toISOString() }));
  });
  return () => { alive = false; };
 // state is read only at page transition; including it would cause an issuance loop.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [epoch, identity, page]);
 useEffect(() => {
  const refresh = () => { if (document.visibilityState === "visible") { setPage(null); setAttempt(n => n + 1); } };
  const timer = window.setInterval(refresh, 60_000);
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => { window.clearInterval(timer); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
 }, []);
 const visible = state.identity === identity ? state : { identity, phase: "loading" as const, rows: [], hasMore: false, cursor: null, readAt: null };
 return { ...visible, retry: () => { setPage(null); setAttempt(n => n + 1); }, loadMore: () => { if (visible.phase === "ready" && visible.hasMore && visible.cursor) setPage(visible.cursor); } };
}
