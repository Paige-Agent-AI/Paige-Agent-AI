import type { PortalInvitation } from "./portalDashboardModel";
import { invitationDeliveryText } from "./portalInvitationEvidence";

const when = (value: string) => Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Time not recorded";

/** Read-only projection of the already authorized native result; never invokes a sender. */
export function PortalInvitationHistory({ invitations, contactId }: { invitations: PortalInvitation[]; contactId: string }) {
  const rows = invitations.filter(row => row.contact_id === contactId);
  return <section className="opd-invitation-history" aria-label="Invitation history">
    <h4>Invitation history</h4>
    {!rows.length ? <p>No invitations are recorded for this client.</p> : <ol>
      {rows.map(row => {
        const events = row.delivery?.history ?? [];
        const delivery = invitationDeliveryText(events[events.length - 1]);
        return <li key={row.id}><details>
          <summary><span>{row.email || "Recipient not recorded"}</span><span>{delivery.label}</span></summary>
          <p>Prepared <time dateTime={row.created_at}>{when(row.created_at)}</time>.</p>
          <p>{row.last_used_at ? <>Invitation accepted <time dateTime={row.last_used_at}>{when(row.last_used_at)}</time>.</>
            : row.revoked_at ? <>Invitation canceled <time dateTime={row.revoked_at}>{when(row.revoked_at)}</time>.</>
            : <>Invitation expires <time dateTime={row.expires_at}>{when(row.expires_at)}</time>.</>}</p>
          <p>{delivery.detail}</p>
          {!!events.length && <ol aria-label="Recorded email events">{events.map(event => <li key={event.id}>
            <span>{invitationDeliveryText(event).label}</span><time dateTime={event.at}>{when(event.at)}</time>
          </li>)}</ol>}
          {row.delivery?.truncated && <p>Showing the latest 50 recorded email events for this invitation.</p>}
        </details></li>;
      })}
    </ol>}
    <p className="opd-footnote">Email delivery, invitation acceptance and portal visits are separate. Missing evidence does not confirm a send or a visit.</p>
  </section>;
}
