import { Link } from "react-router-dom";
import { useTeamPulse } from "@/operator/data/useTeamPulse";
import { getPanelSpec } from "@/operator/surfaces/panelSpecs";
import OperatorPanel from "@/operator/surfaces/OperatorPanel";
import { viewPath } from "@/operator/shell/operatorAddress";

const section = "min-w-0 border-t border-[var(--pg-line)] py-5 text-[13px] leading-relaxed";
const heading = "mb-2 text-[16px] font-medium text-[var(--pg-ink)]";
const muted = "max-w-[72ch] text-[var(--pg-muted)]";
const link = "inline-flex min-h-[44px] items-center text-[var(--pg-ink)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ConnectionsSettings() {
  return <div className="min-w-0">
    <section className={section}><h2 className={heading}>Connected identities and accounts</h2>
      <p className={muted}>Connections belong to an explicit account and grant. A supported integration does not establish that an identity is connected or that PAIGE may act through it.</p>
      <p role="status" className="mt-4 text-[var(--pg-muted)]">UNAVAILABLE · A verified platform connection inventory is not connected to this Operator view.</p>
    </section>
    <section className={section}><h2 className={heading}>Email, messaging and calendars</h2>
      <p className={muted}>Provider identity, consented scopes, expiry, rotation and revocation must come from their canonical connection records. No token, credential or customer account is displayed here.</p>
      <Link className={link} to={viewPath("settings", "Integrations")}>Explore available integration adapters</Link>
    </section>
    <section className={section}><h2 className={heading}>Provisioned numbers</h2><p className={muted}>Number inventory keeps its own tab and readiness state. It is not reported as a connected communication channel.</p>
      <Link className={link} to={viewPath("settings", "Numbers")}>Open Numbers</Link></section>
  </div>;
}
export function AnalyticsSettings() {
  return <div className="min-w-0">
    <section className={section}><h2 className={heading}>Measurement and alerts</h2><p className={muted}>Review the platform's existing analytics destinations or configure alert rules in this category. Intelligence evaluations remain with PAIGE Intelligence.</p></section>
    <ul className="min-w-0 divide-y divide-[var(--pg-line)]">{["Fleet", "Relationships", "Campaigns", "Autonomy", "Platform health"].map((name) => <li key={name}><Link className={link} to={viewPath("analytics", name)}>Open {name.toLowerCase()} analytics</Link></li>)}</ul>
    <p className={`${muted} mt-4`}>Each destination reports its own source and readiness. These links do not establish that every analytics source is available.</p>
  </div>;
}
export function BillingSettings() {
  return <div className="min-w-0"><section className={section}><h2 className={heading}>Platform billing and subscriptions</h2>
    <p className={muted}>Platform subscriptions, payment methods and invoices need an authorized billing account and a canonical read contract.</p>
    <p role="status" className="mt-4 text-[var(--pg-muted)]">UNAVAILABLE · A platform billing read and change workflow is not connected here.</p>
    <p className={`${muted} mt-4`}>No payment method, balance, invoice or plan has been inferred from customer records. This destination cannot create a charge or change a subscription.</p>
  </section><section className={section}><h2 className={heading}>Financial reporting</h2><p className={muted}>The existing financial analytics remain in their original platform destination.</p>
    <Link className={link} to={viewPath("analytics", "Fleet")}>Open fleet financial analytics</Link></section></div>;
}
export function TeamSettings() {
  const roster = useTeamPulse(true);
  const roles = getPanelSpec("settings", "team", "roles");
  return <div className="min-w-0"><section className={section} aria-busy={roster.loading}>
    <h2 className={heading}>Platform team</h2><p className={muted}>Platform Operator seats from the existing staff registry. Customer team members remain in their own account settings.</p>
    {roster.loading ? <p role="status" className="mt-4">Loading platform staff…</p> : roster.error ? <p role="alert" className="mt-4">Platform staff could not load or access was refused. Leave and reopen Team to retry.</p> : roster.seats.length === 0 ? <p role="status" className="mt-4">No platform staff records returned.</p> :
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[400px] text-left"><caption className="sr-only">Registered Platform Operator staff</caption><thead><tr><th className="py-2">Name</th><th>Email</th><th>Role</th></tr></thead><tbody>{roster.seats.map((seat) => <tr key={seat.userId} className="border-t border-[var(--pg-line)]"><td className="py-3 pr-3">{seat.fullName ?? "Name not recorded"}</td><td className="break-all pr-3">{seat.email}</td><td>{seat.role === "super_admin" ? "Platform owner" : "Platform administrator"}</td></tr>)}</tbody></table></div>}
    <p className={`${muted} mt-4`}>Seat membership is recorded evidence. Utilization and activity are not measured here. This view grants no new access or invitations.</p>
  </section>{roles && <OperatorPanel spec={roles} />}</div>;
}
