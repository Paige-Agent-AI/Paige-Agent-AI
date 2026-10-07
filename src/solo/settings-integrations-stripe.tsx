import { useEffect, useRef } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { stripeMerchantWords, useStripeMerchant } from "./data/useStripeMerchant";
import { armOAuthReturn } from "./data/oauthReturn";

/** Merchant setup only. It neither authorizes invoice actions nor moves customer money. */
export function StripeMerchantDrawer({ merchant, onClose }: {
  merchant: ReturnType<typeof useStripeMerchant>; onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null); const close = useRef<HTMLButtonElement>(null);
  const active = useRef(false);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    active.current = true;
    const opener = document.activeElement as HTMLElement | null; close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onCloseRef.current(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      const controls = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]'))
        .filter(el => el.offsetParent !== null);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => { active.current = false; window.removeEventListener("keydown", key); if (opener && document.contains(opener)) opener.focus(); };
  }, []);
  const begin = async () => {
    const path = `${window.location.pathname}?stripe_setup=return`;
    const url = await merchant.begin(`${window.location.origin}${path}`);
    if (url && active.current) { armOAuthReturn(path); window.location.assign(url); }
  };
  const fact = (value: boolean) => merchant.checkedAt ? merchant.state === "unverified" ? "Needs checking" : value ? "Enabled" : "Not enabled" : "Not verified";
  return <div className="ig-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="ig-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="stripe-merchant-title">
      <header><div><h2 id="stripe-merchant-title">Stripe · customer payments</h2></div>
        <button type="button" className="ig-close" ref={close} onClick={onClose} aria-label="Close Stripe setup"><X aria-hidden size={18} /></button></header>
      <div className="ig-panel-body" tabIndex={0} aria-label="Stripe merchant setup details">
        <p className="ig-lede">Connect the payment account your business uses to receive customer money.</p>
        {merchant.loading ? <p className="ig-state" role="status">Reading this workspace’s Stripe connection…</p> : <>
          <dl className="ig-facts">
            <div><dt>Connection</dt><dd>{stripeMerchantWords[merchant.state]}</dd></div>
            <div><dt>Environment</dt><dd>{merchant.environment === "test" ? "TEST · no real money" : merchant.environment === "live" ? "LIVE · real payments" : "Not verified"}</dd></div>
            <div><dt>Customer payments</dt><dd>{fact(merchant.chargesEnabled)}</dd></div>
            <div><dt>Payouts to your business</dt><dd>{fact(merchant.payoutsEnabled)}</dd></div>
            <div><dt>Business details</dt><dd>{merchant.checkedAt ? merchant.state === "unverified" ? "Needs checking" : merchant.detailsSubmitted ? "Submitted" : "Still required" : "Not verified"}</dd></div>
            <div><dt>Sales payment access</dt><dd>{fact(merchant.paymentPermission)}</dd></div>
            {merchant.checkedAt && <div><dt>Last provider check</dt><dd>{new Date(merchant.checkedAt).toLocaleString()}</dd></div>}
          </dl>
          {merchant.state === "outcome_unknown" && <p className="ig-note" role="status">We could not confirm account setup yet. Refresh status to reconcile the existing attempt. Another account will not be created automatically.</p>}
          {merchant.state === "unverified" && <p className="ig-note">Check Stripe again before relying on this connection.</p>}
          {merchant.state === "setup_incomplete" && <p className="ig-note">Continue on Stripe to finish your business details, then return here and refresh status.</p>}
          {merchant.state === "restricted" && <p className="ig-note">Stripe has not enabled customer payments. Continue setup on Stripe to review what is required.</p>}
          {merchant.state === "ready" && <p className="ig-note">Stripe currently permits payment requests. Each invoice action still needs its own authorization; this is not proof that a payment has settled.</p>}
          {merchant.error ? <p className="ig-error" role="alert">Connection status is unavailable. Nothing is being claimed as ready. Refresh status before continuing.</p>
            : merchant.message && <p className="ig-error" role="alert">{merchant.message}</p>}
          {!merchant.canManage && !merchant.error && <p className="ig-note">Only a workspace owner or admin can manage this merchant connection.</p>}
          <div className="ig-actions">
            {merchant.canManage && <button type="button" className="ig-btn" data-primary
              disabled={merchant.busy || merchant.error || !merchant.environment || merchant.state === "outcome_unknown"}
              onClick={() => void begin()}><ExternalLink aria-hidden size={14} />
              {merchant.busy ? "Checking Stripe…" : `${merchant.connected ? "Continue Stripe setup" : "Connect Stripe"}${merchant.environment ? ` (${merchant.environment.toUpperCase()})` : ""}`}</button>}
            <button type="button" className="ig-btn" disabled={merchant.busy} onClick={() => void (merchant.canManage ? merchant.refresh() : merchant.reload())}>
              <RefreshCw aria-hidden size={14} />Refresh status</button>
          </div>
          {merchant.busy && <p className="ig-state" role="status">Waiting for confirmed Stripe state…</p>}
        </>}
      </div>
      <footer><span>Customer money goes to your business. Your PAIGE subscription stays separate.</span></footer>
    </aside>
  </div>;
}
