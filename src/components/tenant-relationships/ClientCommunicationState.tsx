import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PauseCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { readClientCommunicationState, type ClientCommunicationState as State } from "@/lib/client-portal-preferences";
import { communicationRows, reachDay as day } from "./clientCommunicationRows";
import "./client-communication-state.css";

/**
 * E09 Slice 6 — "How {client} can be reached", on the Solo client record under "Shared with {client}".
 *
 * READ-ONLY by design. Email, texts, updates and data sharing are the client's own choices, recorded
 * through their portal account, a STOP/START reply or their unsubscribe link; the business never
 * creates one for them (owner decisions D1/D3, reviewer B1). This section shows the SAME derivation
 * the client's own account and every send gate use (read_client_communication_state →
 * _client_communication_state), so what the owner reads is what Paige's sends will respect. The one
 * staff control — pausing email or texts — lives in Conversations, its one home (§18), and this
 * section links there instead of growing a second switch.
 */
/**
 * `accessState` (E09 Slice 7 round 3): the record's portal access state. When a Pause, Restore or End on this record
 * changes it, the card reads again, so its Portal row never keeps saying "Joined" for a client just paused.
 */
type Props = { contactId: string; clientName: string; account: string | null; accessState?: string };
type Phase = { phase: "loading" } | { phase: "no_workspace" } | { phase: "refused" } | { phase: "error" } | { phase: "ready"; state: State };

export function ClientCommunicationState({ contactId, clientName, account, accessState }: Props) {
  const { activeTenantId, accountContextLoading } = useTenantContext();
  const [read, setRead] = useState<Phase>({ phase: "loading" });
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const first = clientName.trim().split(/\s+/)[0] || clientName;

  useEffect(() => {
    const opened = ++generation.current;
    if (accountContextLoading) { setRead({ phase: "loading" }); return; }
    if (!activeTenantId) { setRead({ phase: "no_workspace" }); return; }
    setRead({ phase: "loading" });
    // The owner read is newer than the generated Database types; keep the call shape local.
    const call = supabase.rpc("read_client_communication_state" as never, { _expected_tenant_id: activeTenantId, _contact_id: contactId } as never) as unknown as PromiseLike<{ data: unknown; error: { code?: string } | null }>;
    Promise.resolve(call).then(answer => {
      if (generation.current !== opened) return;
      const data = answer?.data ?? null, error = answer?.error ?? null;
      if (error?.code === "42501") { setRead({ phase: "refused" }); return; }
      const parsed = error ? null : readClientCommunicationState(data, { tenantId: activeTenantId, contactId });
      setRead(parsed ? { phase: "ready", state: parsed } : { phase: "error" });
    }, () => { if (generation.current === opened) setRead({ phase: "error" }); });
  }, [activeTenantId, accountContextLoading, contactId, refresh, accessState]);

  const conversations = account ? `/solo/${account}/clients/conversations?contact=${encodeURIComponent(contactId)}` : null;
  return (
    <section className="trc-record-section trc-reach" aria-labelledby="trc-reach-title" aria-busy={read.phase === "loading" || undefined}>
      <div className="trc-reach-head">
        <div className="trc-reach-heading">
          <h3 id="trc-reach-title">How {clientName} can be reached</h3>
          <p>What Paige’s emails and texts to {first} will respect right now, and who set it.</p>
        </div>
        {read.phase !== "loading" && read.phase !== "no_workspace" && read.phase !== "refused" && (
          <button type="button" className="trc-reach-refresh" onClick={() => setRefresh(n => n + 1)}><RefreshCw aria-hidden />Refresh</button>
        )}
      </div>
      {read.phase === "loading" && (
        <>
          <span className="sr-only" role="status">Checking how {clientName} can be reached…</span>
          <ul className="trc-reach-rows" aria-hidden="true">{[0, 1, 2].map(i => <li key={i} className="trc-reach-row trc-reach-skeleton"><b /><b /></li>)}</ul>
        </>
      )}
      {read.phase === "no_workspace" && <p className="trc-reach-state" role="status">Open a business workspace to see how this client can be reached.</p>}
      {read.phase === "refused" && <p className="trc-reach-state" role="status">Only the business owner or an admin can see how {clientName} can be reached.</p>}
      {read.phase === "error" && (
        <div className="trc-reach-state" role="alert">
          <p>We couldn’t check how {clientName} can be reached.</p>
          <button type="button" className="trc-reach-quiet" onClick={() => setRefresh(n => n + 1)}><RefreshCw aria-hidden />Try again</button>
        </div>
      )}
      {read.phase === "ready" && (
        <>
          <dl className="trc-reach-rows">
            {communicationRows(read.state).map(row => (
              <div key={row.label} className="trc-reach-row" data-paused={row.paused || undefined}>
                <dt>{row.label}</dt>
                <dd>
                  <span className="trc-reach-value">{row.paused && <PauseCircle aria-hidden />}{row.value}</span>
                  {(row.by || day(row.at ?? null)) && (
                    <span className="trc-reach-by">{[row.by ? `Set by ${row.by}` : null, day(row.at ?? null)].filter(Boolean).join(" · ")}</span>
                  )}
                  {row.note && <span className="trc-reach-note">{row.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
          <div className="trc-reach-foot">
            {/* True for a business pause (you lift it), D1 (texts are never turned on from the portal) and D7
                (consent the business records itself is labelled as the business's). */}
            <p>What {first} turns off stays off until they turn it back on. Texts come on only from a START reply, a sign-up form, or consent your business records itself, which shows as Set by your business. You can pause email or texts in Conversations, and lift any pause {first} didn’t set.</p>
            {conversations && <Link className="trc-reach-quiet" to={conversations}>Open Conversations</Link>}
          </div>
        </>
      )}
    </section>
  );
}
