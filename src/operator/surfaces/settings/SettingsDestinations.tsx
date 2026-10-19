import { Link } from "react-router-dom";
import { useTeamPulse } from "@/operator/data/useTeamPulse";
import { useBillingOverview } from "@/operator/data/useBillingOverview";
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
  const { data, funnel, error, loading } = useBillingOverview();
  const s = data?.summary;
  const money = (cents: number | null | undefined) =>
    cents == null ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return <div className="min-w-0">
    <section className={section} aria-busy={loading}><h2 className={heading}>Platform billing and subscriptions</h2>
      <p className={muted}>PAIGE Agent AI Inc's own subscriptions and invoices — the company's L1 money, separate from every customer business's L2 revenue. Trials are contracted intent, never collected cash.</p>
      {loading ? <p role="status" className="mt-4">Loading the company's billing records…</p>
        : error ? <p role="alert" className="mt-4">Billing could not load or access was refused. Leave and reopen Billing to retry.</p>
        : !s ? <p role="status" className="mt-4">No billing records returned.</p>
        : <>
          <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><dt className="text-[var(--pg-muted)]">Collected cash</dt><dd className="text-[16px] font-medium">{money(s.collected_cash_cents)}{s.collected_cash_cents === 0 ? <span className="block text-[12px] font-normal text-[var(--pg-muted)]">no paid invoice yet</span> : null}</dd></div>
            <div><dt className="text-[var(--pg-muted)]">Real ARR (paid)</dt><dd className="text-[16px] font-medium">{money(s.arr_cents)}<span className="block text-[12px] font-normal text-[var(--pg-muted)]">{s.active_paid} live paid · {s.trialing} trialing</span></dd></div>
            <div><dt className="text-[var(--pg-muted)]">Open receivables</dt><dd className="text-[16px] font-medium">{money(s.open_receivables_cents)}{s.failed_or_open_invoices > 0 ? <span className="block text-[12px] font-normal text-[var(--pg-attention, #b45309)]">{s.failed_or_open_invoices} open or failed invoice{(s.failed_or_open_invoices === 1 ? "" : "s")}</span> : null}</dd></div>
            <div><dt className="text-[var(--pg-muted)]">Renewals ≤ 30 days</dt><dd className="text-[16px] font-medium">{s.upcoming_renewals_30d}<span className="block text-[12px] font-normal text-[var(--pg-muted)]">{s.past_due} past due · {s.canceled} canceled</span></dd></div>
          </dl>
          <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[640px] text-left"><caption className="sr-only">Company subscriptions with trial-versus-paid truth</caption>
            <thead><tr><th className="py-2 pr-3">Customer</th><th className="pr-3">Plan</th><th className="pr-3">State</th><th className="pr-3">Period / trial ends</th><th className="pr-3">Renewal</th></tr></thead>
            <tbody>{(data?.subscriptions ?? []).map((sub) => <tr key={`${sub.tenant_id ?? sub.stripe_subscription_id ?? sub.plan_slug}`} className="border-t border-[var(--pg-line)] align-top">
              <td className="py-3 pr-3">{sub.tenant_name ?? "Unknown business"}</td>
              <td className="pr-3">{sub.plan_name ?? "—"}<span className="block text-[12px] text-[var(--pg-muted)]">{sub.billing_period === "annual" ? `annual · ${money(sub.annual_cents)}` : `monthly · ${money(sub.monthly_cents)}`}</span></td>
              <td className="pr-3">{sub.is_paid ? "Paid" : sub.status === "trialing" ? <span>Trial<span className="block text-[12px] text-[var(--pg-muted)]">not cash yet</span></span> : sub.status}</td>
              <td className="pr-3">{sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : sub.trial_ends_at ? new Date(sub.trial_ends_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
              <td className="pr-3">{sub.cancel_at_period_end === true ? <span>Ends at period end</span> : sub.status === "canceled" ? "Canceled" : sub.status === "past_due" ? <span className="text-[var(--pg-attention, #b45309)]">Payment past due</span> : "Renews"}</td>
            </tr>)}</tbody></table>
          </div>
          <p className={`${muted} mt-3`}>Payment methods on file: {s.billing_accounts} billing account{(s.billing_accounts === 1 ? "" : "s")}.{(data?.billing_accounts ?? []).filter((a) => a.payment_method_brand).length > 0 ? " Card on file: " + (data?.billing_accounts ?? []).filter((a) => a.payment_method_brand).map((a) => `${a.payment_method_brand} ••${a.payment_method_last4 ?? "—"}${a.payment_method_exp_month ? ` exp ${a.payment_method_exp_month}/${a.payment_method_exp_year}` : ""}`).join(", ") + "." : " No card connected yet."}</p>
          <p className={`${muted} mt-1`}>Refunds, cancellations and plan changes stay owner-held in Stripe. This view performs no money action.</p>
        </>}
    </section>
    <section className={section}><h2 className={heading}>Invoices and payment events</h2>
      {loading ? <p role="status">Loading invoices…</p>
        : error ? <p role="status">Unavailable while billing is refused.</p>
        : (data?.invoices ?? []).length === 0 ? <p role="status" className="mt-2 text-[var(--pg-muted)]">No invoice has been issued yet — the first billing cycle has not closed. Collected cash reads $0.00 until a paid invoice exists.</p>
        : <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[560px] text-left"><caption className="sr-only">Company invoices</caption>
            <thead><tr><th className="py-2 pr-3">Invoice</th><th className="pr-3">Customer</th><th className="pr-3">Status</th><th className="pr-3">Total</th><th className="pr-3">Paid</th><th className="pr-3">Stripe</th></tr></thead>
            <tbody>{(data?.invoices ?? []).map((inv, i) => <tr key={inv.invoice_number ?? i} className="border-t border-[var(--pg-line)]">
              <td className="py-3 pr-3">{inv.invoice_number ?? "—"}</td><td className="pr-3">{inv.tenant_name ?? "—"}</td>
              <td className="pr-3">{inv.status}{inv.status === "past_due" ? <span className="block text-[12px] text-[var(--pg-attention, #b45309)]">payment failed</span> : null}</td>
              <td className="pr-3">{money(inv.total_cents)}</td>
              <td className="pr-3">{inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
              <td className="pr-3">{inv.hosted_invoice_url ? <a className={link} href={inv.hosted_invoice_url} target="_blank" rel="noreferrer">Open in Stripe</a> : "—"}</td>
            </tr>)}</tbody></table></div>}
    </section>
    <section className={section}><h2 className={heading}>Signup funnel (90 days)</h2>
      {loading ? <p role="status">Loading the funnel…</p>
        : (funnel ?? []).length === 0 ? <p role="status" className="mt-2 text-[var(--pg-muted)]">Funnel steps are not available right now.</p>
        : <ol className="mt-2 flex flex-wrap gap-x-6 gap-y-2">{(funnel ?? []).map((step, i) => <li key={step.step ?? i} className="min-w-[8rem]"><span className="block text-[12px] text-[var(--pg-muted)]">{step.step ?? "—"}</span><span className="text-[16px] font-medium">{step.count}</span></li>)}</ol>}
      <p className={`${muted} mt-3`}>The funnel reads the platform's own enrollment records — how many people reached each signup stage — never tenant business activity.</p>
    </section>
    <section className={section}><h2 className={heading}>Financial reporting</h2><p className={muted}>The existing financial analytics remain in their original platform destination.</p>
      <Link className={link} to={viewPath("analytics", "Fleet")}>Open fleet financial analytics</Link>
      <Link className={`${link} ml-4`} to={viewPath("relationships", "Customers")}>Open the Customers desk</Link>
    </section>
  </div>;
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
