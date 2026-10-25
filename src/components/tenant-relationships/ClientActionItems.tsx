import { RefreshCw } from "lucide-react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useClientActionsOwner, type OwnerActionScope, type OwnerCustomerAction } from "@/hooks/useClientActionsOwner";
import "./client-shared-work.css";
import "./client-action-items.css";

const responseLabel = { accepted: "Accepted", declined: "Declined", question: "Question", completed: "Marked complete" };
function status(item: OwnerCustomerAction) {
  if (item.is_expired || item.status === "expired") return "Expired";
  if (item.status === "customer_declined") return "Declined";
  if (item.status === "customer_acted") return "Customer responded";
  return item.responses[0]?.response_type === "question" ? "Customer asked a question" : "Awaiting a response";
}
const stamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ClientActionItems({ contactId, clientName }: { contactId: string; clientName: string }) {
  const context = useTenantContext();
  const scope = context.activeUserId && context.activeTenantId && !context.accountContextLoading && context.accountContextStatus === "ready"
    ? { actor: context.activeUserId, tenant: context.activeTenantId, contact: contactId } : null;
  return <section id="client-action-items" className="trc-record-section trc-shared trc-customer-actions" aria-labelledby="trc-action-items-title">
    {scope ? <ClientActionItemsScope key={`${scope.actor}:${scope.tenant}:${scope.contact}`} scope={scope} clientName={clientName} />
      : <div className="trc-action-body"><h3 id="trc-action-items-title">Customer action items</h3><p role="status">{context.accountContextLoading ? "Checking your workspace…" : "Your workspace access could not be verified."}</p></div>}
  </section>;
}
function ClientActionItemsScope({ scope, clientName }: { scope: OwnerActionScope; clientName: string }) {
  const read = useClientActionsOwner(scope), data = read.data;
  return <>
    <header className="trc-shared-head"><div className="trc-shared-heading">
      <h3 id="trc-action-items-title">Customer action items</h3><p>Requests shared with {clientName} and their saved responses.</p>
    </div><button type="button" className="trc-shared-refresh" aria-label="Refresh customer action items" disabled={read.phase === "loading"} onClick={() => void read.refresh()}><RefreshCw aria-hidden="true" /> Refresh</button></header>
    <div className="trc-action-body" aria-busy={read.phase === "loading" || undefined}>
      {read.phase === "loading" && <p role="status">Checking saved action items…</p>}
      {read.phase === "refused" && <p role="alert">Your access to these action items could not be verified.</p>}
      {read.phase === "error" && <p role="alert">Saved action items could not be loaded. Check your connection and refresh.</p>}
      {read.phase === "ready" && data && <>
        {data.access_state !== "open" ? <p className="trc-action-note">Portal access is {data.access_state === "ended" ? "ended" : "paused"}. Shared history remains here.</p>
          : !data.joined && <p className="trc-action-note">This customer has not joined their Portal.</p>}
        {!data.shared_context_consent && <p className="trc-action-note">Shared context is not allowed by the customer. They control this consent in their Portal.</p>}
        {!data.actions.length && <p>No action items have been shared with this customer.</p>}
        {data.actions.map(item => <article className="trc-action-item" key={item.id}>
          <h4>{item.title}</h4><div className="trc-action-meta"><span>{status(item)}</span><span>Created <time dateTime={item.created_at}>{stamp(item.created_at)}</time></span></div>
          {item.body && <p className="trc-action-words">{item.body}</p>}
          {item.responses.map(response => <blockquote key={response.id}>
            <div className="trc-action-meta"><strong>{responseLabel[response.response_type]}</strong><time dateTime={response.created_at}>{stamp(response.created_at)}</time></div>
            {response.response_text && <p className="trc-action-words">{response.response_text}</p>}
          </blockquote>)}
          {item.more_responses && <p className="trc-action-note">Showing the newest 100 responses for this item.</p>}
        </article>)}
        {data.more_actions && <p className="trc-action-note">Showing the newest 100 action items.</p>}
      </>}
    </div>
  </>;
}
