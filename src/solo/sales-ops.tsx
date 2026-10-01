// @ts-nocheck
// Campaigns → Sales — the workspace's SALES OPERATIONS surface.
//
// ─── WHAT THIS TAB IS FOR, AND THE BOUNDARY IT SITS ON ───────────────────────────────────────
//
// Settings → Billing is what this workspace pays PAIGE. This tab is the other direction of money
// entirely: what the workspace charges its OWN clients. §38 draws the line and it is absolute —
// PAIGE is never merchant of record for a tenant→client charge, so nothing on this surface
// collects, holds, schedules, or routes money. It records; the money leg runs on the workspace's
// own processor.
//
// Two functions in this repo DO move money and are deliberately never imported here:
// `tenant-checkout-session` (destination charges on Paige's platform account — the live §38
// violation recorded against #458) and `tenant-stripe-connect` (mints a real Stripe Express
// account). Both create external provider state. Everything on this surface is a database record.
//
// ─── CATALOG OWNS THE OFFER. THIS TAB MAKES IT OPERATIONAL. ──────────────────────────────────
//
// There is exactly ONE offer record — `tenant_products`, read through `useCatalogOffers` and
// written through `save_solo_offer`. Sales does not keep a second catalog, a Sales-only SKU, a
// shadow price, or its own offer id (§18). The quick-create below calls the SAME rpc the Catalog
// editor calls and hands the result straight back to Catalog for the full setup. If this file ever
// grows a `products` array of its own, that is the bug.
//
// ─── WHY THE FIGURES ARE SO SPARSE ───────────────────────────────────────────────────────────
//
// Every number here is a count of rows that exist, and nothing is summed into revenue, forecast,
// or campaign attribution. `tenant_orders` is the only monetary record a Solo workspace has today,
// and an order does not name a campaign — `utm_campaign` lives on `analytics_events` and
// `referral_clicks`, never on the order — so send → click → order does not join. Attribution
// therefore is not shown at all, rather than shown badly (§13).
import React from "react";
import { Ic } from "./_shared";
import { useCatalogOffers } from "./useCatalogOffers";
import { money, minorUnitDigits } from "./catalog-offers";
import {
  useSoloSalesOps,
  DECLARED_PROCESSORS,
  DECLARED_METHODS,
} from "./useSoloSalesOps";
import { useSoloCommercialTerms } from "./useSoloCommercialTerms";
import { useSoloAgreementSignings, TRAIL_LIMIT } from "./useSoloAgreementSignings";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import "./sales-ops.css";
import { SalesDialogPortal, useSalesDraftExit } from "./sales-dialog";
import { useLocation, useNavigate } from "react-router-dom";
import { deriveSalesCommand } from "./sales/deriveSalesCommand";
import { deriveScenario } from "./sales/salesScenario";

/**
 * The five shapes a Solo business can sell on. Deliberately not narrower: the owner's instruction
 * was not to artificially restrict what a business can sell, and `custom_quote` is what stops a
 * bespoke arrangement having to pretend to be one of the other four.
 */
const TERM_LABEL = {
  one_time: "One-off",
  recurring: "Recurring",
  installment: "In instalments",
  deposit: "Deposit",
  custom_quote: "Custom",
};

const CADENCE_LABEL = {
  one_time: "once",
  day: "daily",
  week: "weekly",
  month: "monthly",
  year: "yearly",
};

/**
 * Five states and a sixth READING. There is no `paid`, `invoiced` or `delivered`, because this
 * record can observe none of them — it holds what was agreed, never what happened afterwards.
 *
 * This is the ENGAGEMENT's state: whether the work is running, paused or finished. It is NOT the
 * signature's state, and since the owner's 2026-09-22 ruling the two are kept apart on purpose —
 * see `SIGNATURE_STATE` below.
 */
const AGREEMENT_STATE = {
  draft: { label: "Draft", tone: "opportunity" },
  active: { label: "Active", tone: "ok" },
  paused: { label: "Paused", tone: "warn" },
  completed: { label: "Completed", tone: "n" },
  cancelled: { label: "Cancelled", tone: "n" },
  unrecognised: { label: "Not readable", tone: "n" },
};

/**
 * The SIGNATURE's state — a different fact from the engagement's, and the owner ruled they must
 * never be merged: a document can be signed while the work has not started, and the work can be
 * running under a document nobody ever countersigned.
 *
 * There is no `Signed` separate from `Completed`. With one signer the two cannot be told apart, so
 * carrying both would put a word on the screen that nothing in the record could distinguish (§13).
 * `Expired` is DERIVED by the adapter from the state plus the clock, because nothing in this build
 * walks the table to flip it — see `useSoloAgreementSignings.displayState`.
 *
 * `none` is not a stored value either: it is what a commercial record with no document says, and
 * saying "Draft" there would claim a document exists.
 */
const SIGNATURE_STATE = {
  none: { label: "No document", tone: "n" },
  draft: { label: "Not sent", tone: "opportunity" },
  sent: { label: "Sent", tone: "warn" },
  viewed: { label: "Opened", tone: "warn" },
  partially_signed: { label: "Partly signed", tone: "warn" },
  completed: { label: "Completed", tone: "ok" },
  declined: { label: "Declined", tone: "bad" },
  voided: { label: "Stopped", tone: "n" },
  expired: { label: "Link expired", tone: "bad" },
  unrecognised: { label: "Not readable", tone: "n" },
};

/** The life `agreement-send` gives a signing token, mirrored from `SIGNING_TOKEN_TTL_DAYS` in
 * `_shared/agreements/token.ts`. Stated rather than chosen: the send endpoint takes no duration,
 * so offering one here would be a control the server does not honour. */
const SEND_TTL_DAYS = 30;

/** How long a signing link stays alive. Real choices, all of them finishable — never a free text
 * field that would let somebody type a link that outlives the arrangement it commits. */
const LINK_DAYS = [7, 14, 30];

/** The signature state with its lit dot. The dot lives INSIDE the shared `.pill` rather than in a
 * second pill primitive, so its colour is the pill's own and the two can never disagree (§11/§18). */
function SignaturePill({ state }) {
  const read = SIGNATURE_STATE[state] || SIGNATURE_STATE.unrecognised;
  return (
    <Pill tone={read.tone}>
      <span className="so-sigdot" aria-hidden="true" />
      {read.label}
    </Pill>
  );
}

/** The workspace's own words for each declared processor. Stripe is one of seven, never the assumed one. */
const PROCESSOR_LABEL = {
  stripe: "Stripe",
  paypal: "PayPal",
  square: "Square",
  bank_merchant: "A bank merchant account",
  quickbooks_payments: "QuickBooks Payments",
  manual: "Invoiced and paid manually",
  not_yet: "Nothing yet",
};

const METHOD_LABEL = {
  cards: "Cards",
  ach: "ACH",
  zelle: "Zelle",
  wire: "Wire",
  check: "Check",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  crypto: "Crypto",
  other: "Other",
};

const ORDER_STATUS = {
  pending: { label: "Awaiting payment", tone: "warn" },
  complete: { label: "Paid", tone: "ok" },
  failed: { label: "Payment failed", tone: "bad" },
  refunded: { label: "Refunded", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "none" },
  unrecognised: { label: "State not recognised", tone: "none" },
};

/* `OFFER_STATE` and `CADENCE` were read only by the offer table and its detail drawer, both of
 * which were removed with the Find-an-offer band (owner ruling, 2026-09-22). `CADENCE_LABEL` above
 * is the one cadence vocabulary that survives, and it is the one the agreement rows already used —
 * keeping a second, differently-capitalised copy of the same five words would be the fork §18
 * exists to stop. */

function when(value, calendarDate = false) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", ...(calendarDate ? { timeZone: "UTC" } : {}) }).format(date);
}

/* The audit trail needs the MINUTE, not the day. `when()` above prints a date, so three events
 * nine minutes apart would render identically and the order the trail exists to prove would be
 * invisible. Approved format: "22 Sep \u00b7 4:12 PM". */
function stamp(value) {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time not recorded";
  const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  return `${day} \u00b7 ${time}`;
}

/* The same moment in prose rather than in a column: "18 Sep 2026 at 9:31 AM". The seal states when
 * the counterparty signed, and a date alone under-reports a fact the trail below already carries to
 * the minute — the two must not disagree about how precisely this is known. */
function momentOf(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // Joined explicitly rather than by `dateStyle`+`timeStyle` together, which in several locales
  // renders "Sep 18, 2026, 9:31 AM" — a second comma where the sentence wants a preposition.
  const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date);
  return `${day} at ${time}`;
}

/**
 * The SHARED pill, not a local one. The first version of this file declared `.so-pill` with its own
 * height, size, tracking and ground — a fork of `solo-tokens.css`'s live `.pill`, whose three
 * tone→token mappings it copied exactly. The fork was not free: its darker ground took the neutral
 * tone from 4.50:1 to 3.79:1 in dark mode, below AA for text that small, on the readiness panel's
 * primary state signal. §11 says add to the layer rather than fork a one-off, and the layer already
 * had this.
 */
function Pill({ tone, children }) {
  const cls = tone === "ok" ? "pill pill-ok"
    : tone === "warn" ? "pill pill-warn"
    : tone === "bad" ? "pill pill-bad"
    : tone === "opportunity" ? "pill pill-v"
    : "pill pill-n";
  return <span className={cls}>{children}</span>;
}

/**
 * One readiness answer. `state` is what the record actually supports:
 *   ok      — recorded and usable
 *   warn    — recorded but incomplete, or something is waiting on a person
 *   none    — nothing recorded yet; this is a normal first-use answer, not a failure
 *   unknown — could not be read. NEVER collapsed into `none`: "you have none" and "I could not
 *             look" are different sentences and only one of them is the person's fault.
 */
function ReadyRow({ state, label, detail, action, word: override }) {
  // `unknown` covers two different absences and they need different words. "Not readable" is true
  // when a READ failed or authority forbade it; it is a lie for a row that never queried anything,
  // which is why the agreements row passes its own word. Asserting a failure that did not happen is
  // the same class of error as asserting a zero the record does not prove.
  const word = override ?? (state === "ok" ? "Ready"
    : state === "warn" ? "Needs you"
    : state === "unknown" ? "Not readable"
    : "Not set up");
  // `none` reads VIOLET, not grey. Grey says "dead"; a business that has not recorded its offers
  // yet has an opportunity in front of it, and §23 says the colour carries that rather than a
  // neutral fill. `unknown` stays neutral — a thing we could not read is genuinely inert.
  const tone = state === "ok" ? "ok"
    : state === "warn" ? "warn"
    : state === "unknown" ? "none"
    : "opportunity";
  return (
    <div className="so-ready-row">
      <Pill tone={tone}>{word}</Pill>
      <span className="so-ready-text">
        <b>{label}</b>
        <small>{detail}</small>
      </span>
      <span className="so-ready-act">{action}</span>
    </div>
  );
}

/**
 * What makes `aria-modal="true"` true. Declaring it without enforcing it is a claim the DOM does
 * not honour: Tab walks straight out of the panel into the page behind the scrim, and on close the
 * focus lands wherever the browser decides. `DetailDrawer` in `growth2.tsx` already implements all
 * three parts; this is the same contract for the two editors on this surface, not a second
 * invention of it.
 *
 * Returns the ref to put on the panel. It takes NO arguments on purpose: Escape stays with the
 * caller, because only the caller knows whether a save is in flight and must not be interrupted.
 * The first version declared `(onClose, busy)` and used neither — parameters that read as though
 * this hook handles dismissal when it does not.
 */
function useModalDialog() {
  const panelRef = React.useRef(null);
  React.useEffect(() => {
    const previous = document.activeElement;
    // Everything the shell already rendered goes inert, so a screen reader's virtual cursor and
    // Tab both stay inside the panel.
    const background = document.querySelectorAll(
      ".solo-campaigns > .campaigns-nav, .solo-campaigns > .campaigns-scroll",
    );
    background.forEach((node) => node.setAttribute("inert", ""));

    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      background.forEach((node) => node.removeAttribute("inert"));
      // Focus goes back to whatever opened this, so the keyboard does not restart at the top.
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return panelRef;
}

/**
 * How this business takes money from its clients. A DECLARATION, not a connection — the editor says
 * so in those words, because a control labelled "connect" that only writes a database column is the
 * exact over-claim §13 exists to stop. Recording "Square" here is exactly as complete as recording
 * "Stripe": the surface is processor-agnostic by construction (§38), and PAIGE never touches the
 * account either way.
 */
function PaymentEditor({ data, onClose }) {
  const [processor, setProcessor] = React.useState(data.processor || "");
  const [methods, setMethods] = React.useState([...data.methods]);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const firstRef = React.useRef(null);
  const panelRef = useModalDialog();

  React.useEffect(() => { firstRef.current?.focus(); }, []);
  const { close, confirmation, alive } = useSalesDraftExit({ processor, methods: [...methods].sort() }, busy, onClose);

  const toggle = (method) => setMethods((current) =>
    current.includes(method) ? current.filter((m) => m !== method) : [...current, method]);

  const save = async () => {
    setBusy(true);
    setNotice(null);
    const outcome = await data.declarePaymentHandling(processor, methods).catch(() => ({ ok: false, message: "We could not confirm the save. Check your connection and try again." }));
    if (!alive.current) return;
    setBusy(false);
    if (outcome.ok) { onClose(); return; }
    // The form STAYS OPEN on a refusal. Closing it would discard the answer on top of telling
    // someone it did not save.
    setNotice(outcome.message || "That could not be saved. Nothing was changed.");
  };

  return (
    <SalesDialogPortal>
      <button className="so-editor-scrim" tabIndex={-1} aria-label="Close" onClick={close} />
      <aside ref={panelRef} className="so-editor" role="dialog" aria-modal="true" aria-labelledby="so-pay-title">
        <header className="so-editor-head">
          <div style={{ flex: 1 }}>
            <h2 id="so-pay-title">How your clients pay you</h2>
            <p>
              This records how money reaches your business. It does not connect an account, move
              money, or give Paige access to your processor. Paige is not merchant of record. What you pay Paige belongs in Settings → Billing.
            </p>
          </div>
          <button className="btn btn-s" onClick={close} disabled={busy} aria-label="Close">
            <Ic.x size={14} />
          </button>
        </header>

        <div className="so-editor-body" inert={busy ? "" : undefined}>
          <fieldset className="so-field">
            <legend>Processor</legend>
            <div className="so-pick">
              {DECLARED_PROCESSORS.map((key, index) => (
                <button
                  key={key}
                  type="button"
                  ref={index === 0 ? firstRef : undefined}
                  aria-pressed={processor === key}
                  onClick={() => setProcessor(key)}
                >{PROCESSOR_LABEL[key]}</button>
              ))}
            </div>
          </fieldset>

          <fieldset className="so-field">
            <legend>Methods you accept</legend>
            <div className="so-pick">
              {DECLARED_METHODS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={methods.includes(key)}
                  onClick={() => toggle(key)}
                >{METHOD_LABEL[key]}</button>
              ))}
            </div>
          </fieldset>
        </div>

        <footer className="so-editor-foot">
          <span role={notice ? "alert" : "status"} className="so-editor-note" data-tone={notice ? "bad" : "plain"}>
            {notice || (processor
              ? "Records your payment handling. No processor is connected."
              : "Choose a processor, or say Nothing yet — both are real answers.")}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={close} disabled={busy}>Cancel</button>
          <button className="btn btn-s btn-p" onClick={save} disabled={busy || !processor}>
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
        {confirmation}
      </aside>
    </SalesDialogPortal>
  );
}

/**
 * Quick offer creation. It collects only enough to make a VALID CANONICAL DRAFT and then hands the
 * person to Catalog for everything else — variants, inventory, fulfilment, rich copy, campaign
 * positioning. It calls `save_solo_offer`, the same rpc the Catalog editor calls, so exactly one
 * offer record exists and it carries one id, one price and one status (§18).
 *
 * Cancelling creates nothing. There is no draft row written on open and none to clean up.
 */
function QuickOffer({ offers, tenantId, onClose, onCreated }) {
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState("usd");
  const [interval, setInterval] = React.useState("");
  const [shape, setShape] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const nameRef = React.useRef(null);
  const panelRef = useModalDialog();

  React.useEffect(() => { nameRef.current?.focus(); }, []);
  const { close, confirmation, alive } = useSalesDraftExit({ name, kind, amount, currency, interval, shape }, busy, onClose);

  const named = name.trim().length > 0;

  const save = async () => {
    setBusy(true);
    setNotice(null);
    // Minor units, derived from the currency rather than a hardcoded 100 — a ¥500 offer typed as
    // 500 must not be stored as ¥50,000. The arithmetic lives in one place for exactly this reason.
    const major = amount.trim() ? Number(amount.trim()) : null;
    if (major !== null && (!Number.isFinite(major) || major < 0)) {
      setBusy(false);
      setNotice("That price could not be read, so nothing was saved.");
      return;
    }
    const digits = minorUnitDigits(currency);
    const outcome = await offers.saveOffer({
      id: null,
      // THE WORKSPACE THIS FORM WAS OPENED IN, and the reason this field is not optional.
      // `saveOffer` forwards it as `_expected_tenant_id`, and `runWrite` merges
      // `{ _expected_tenant_id: activeTenantId, ...args }` — so a draft that OMITS the key still
      // contributes `_expected_tenant_id: undefined`, which wins the spread and is then dropped
      // entirely by JSON.stringify. `save_solo_offer` declares that parameter with no DEFAULT and
      // its 14-argument overload was dropped in 20261111000000, so PostgREST resolves no function
      // and every create fails with the raw signature rendered into the footer. Captured on OPEN
      // rather than at save, so a workspace switch mid-edit is refused by the server instead of
      // silently saving into the workspace the person switched to.
      tenantId,
      name: name.trim(),
      summary: "",
      description: "",
      kind,
      deliveryShape: shape,
      pricePresentation: "",
      customerAction: "",
      category: "",
      priceAmount: major === null ? null : Math.round(major * 10 ** digits),
      priceCurrency: currency.trim() || "usd",
      priceInterval: interval,
      expectedUpdatedAt: null,
      priceId: null,
    }).catch(() => ({ ok: false }));
    if (!alive.current) return;
    setBusy(false);
    if (outcome.ok) {
      // The server reports what it actually did with the price. If it declined to write one, the
      // person is told here rather than discovering it in Catalog — silently not saving a price
      // somebody just typed is the same class of lie as inventing one.
      const note = outcome.result?.price_note;
      onCreated(outcome.result?.id ?? null, Boolean(note));
      return;
    }
    setNotice("We could not confirm the offer was saved. Check Catalog before retrying to avoid a duplicate.");
  };

  return (
    <SalesDialogPortal>
      <button className="so-editor-scrim" tabIndex={-1} aria-label="Close" onClick={close} />
      <aside ref={panelRef} className="so-editor" role="dialog" aria-modal="true" aria-labelledby="so-offer-title">
        <header className="so-editor-head">
          <div style={{ flex: 1 }}>
            <h2 id="so-offer-title">Quick offer</h2>
            <p>
              Enough to make it real. It saves as a draft in Catalog, where you can finish it —
              nothing is public until you publish it there.
            </p>
          </div>
          <button className="btn btn-s" onClick={close} disabled={busy} aria-label="Close">
            <Ic.x size={14} />
          </button>
        </header>

        <div className="so-editor-body" inert={busy ? "" : undefined}>
          <label className="so-field">
            <span>Name</span>
            <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="What do you call it?" />
          </label>
          <fieldset className="so-field">
            <legend>Kind</legend>
            <div className="so-pick">
              {[["product", "Product"], ["service", "Service"]].map(([key, text]) => (
                <button key={key} type="button" aria-pressed={kind === key}
                        onClick={() => setKind(kind === key ? "" : key)}>{text}</button>
              ))}
            </div>
          </fieldset>
          <fieldset className="so-field">
            <legend>Delivered as</legend>
            <div className="so-pick">
              {[["digital", "A download"], ["physical", "A physical item"], ["appointment", "An appointment"],
                ["program", "A program"], ["membership", "A membership"], ["hybrid", "A mix"]].map(([key, text]) => (
                <button key={key} type="button" aria-pressed={shape === key}
                        onClick={() => setShape(shape === key ? "" : key)}>{text}</button>
              ))}
            </div>
          </fieldset>
          <label className="so-field">
            <span>Price</span>
            <div className="so-money">
              <input inputMode="decimal" value={amount} placeholder="Leave blank to decide later"
                     onChange={(e) => setAmount(e.target.value)} />
              <input value={currency} onChange={(e) => setCurrency(e.target.value)}
                     aria-label="Currency" style={{ maxWidth: "70px" }} placeholder="usd" />
            </div>
          </label>
          <fieldset className="so-field">
            <legend>Price cadence</legend>
            <div className="so-pick">
              {[["one_time", "Once"], ["week", "Weekly"], ["month", "Monthly"], ["year", "Yearly"]].map(([key, text]) => (
                <button key={key} type="button" aria-pressed={interval === key}
                        onClick={() => setInterval(interval === key ? "" : key)}>{text}</button>
              ))}
            </div>
          </fieldset>
        </div>

        <footer className="so-editor-foot">
          <span role={notice ? "alert" : "status"} className="so-editor-note" data-tone={notice ? "bad" : "plain"}>
            {notice || (named
              ? "Anything left blank stays unstated, and you can finish it in Catalog."
              : "A name is all this needs to save.")}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={close} disabled={busy}>Cancel</button>
          <button className="btn btn-s btn-p" onClick={save} disabled={busy || !named}>
            {busy ? "Saving…" : "Create offer"}
          </button>
        </footer>
        {confirmation}
      </aside>
    </SalesDialogPortal>
  );
}

/**
 * An offer's name WITH what it costs, for the picker.
 *
 * The lead plan is the first active priced plan — the same reading the Catalog table takes, not a
 * "from" figure this surface computed for itself (§18: one opinion about an offer's price).
 */
/* The price and cadence ALONE, for the attach list's own column. The label this replaced fused
 * them onto the name because a native <option> can only render one string; separating them lets a
 * reader run their eye down the prices instead of re-reading every name to find them. */
function offerPriceLabel(offer) {
  const lead = (offer.prices || []).filter((p) => p.active && typeof p.unitAmount === "number")[0] || null;
  if (!lead) return "No price recorded";
  const cadence = lead.billingInterval && lead.billingInterval !== "one_time"
    ? CADENCE_LABEL[lead.billingInterval] || lead.billingInterval
    : "once";
  return `${money(lead.unitAmount, lead.currency) ?? "No amount"} · ${cadence}`;
}

/**
 * What one client agreed to. The same right-side drawer the payment and offer editors use, for the
 * same reason: a focused task that must not lose the list behind it.
 *
 * WHAT IT SENDS, AND WHAT IT REFUSES TO SEND. It sends ids and terms. It never sends a catalog
 * amount — only `catalogPriceId` — because the server reads the list price off `tenant_prices`
 * itself, so the browser cannot forge what the catalog said. And it carries the workspace it was
 * OPENED against, not the current one: sending the current tenant would make the server's refusal
 * guard unable to fire, because the caller would keep agreeing with itself.
 */
function AgreementEditor({ agreements, signings, offers, tenantId, existing, existingSigning, canSign, onClose, onOpenClients, onOpenCatalog, onQuickOffer, onSigningCreated }) {
  const panelRef = useModalDialog();
  const firstRef = React.useRef(null);
  const [contactId, setContactId] = React.useState(existing?.contactId ?? "");
  const [offerId, setOfferId] = React.useState(existing?.offerId ?? "");
  // The document step. `none` is what this editor did before documents existed, and it stays the
  // honest default: a workspace that only wants the commercial record on file should not have to
  // say no to anything to get it.
  const [source, setSource] = React.useState("none");
  const [file, setFile] = React.useState(null);
  const [docTitle, setDocTitle] = React.useState("");
  const [docBody, setDocBody] = React.useState("");
  const [pickerSearch, setPickerSearch] = React.useState("");
  const [pickerPage, setPickerPage] = React.useState(0);
  const picker = useCatalogOffers({ search: pickerSearch, page: pickerPage, pageSize: 5, referenceIds: offerId ? [offerId] : [] });
  /* Named once rather than re-deriving Boolean(existing?.catalogSnapshotAt) at five call sites, so
   * the lock cannot drift apart between the search, the list and the pager. */
  const offerLocked = Boolean(existing?.catalogSnapshotAt);
  const pickerOffers = [...picker.offers, ...(picker.referencedOffers || [])].filter((offer, index, rows) => rows.findIndex((o) => o.id === offer.id) === index);
  const [term, setTerm] = React.useState(existing?.termKind ?? "one_time");
  const [basis, setBasis] = React.useState(existing?.priceBasis ?? "negotiated");
  const [planId, setPlanId] = React.useState("");
  const [amount, setAmount] = React.useState(() => {
    const minor = existing?.agreedAmountMinor;
    const currency = existing?.agreedCurrency || "usd";
    return typeof minor === "number" ? String(minor / 10 ** minorUnitDigits(currency)) : "";
  });
  const [currency, setCurrency] = React.useState(existing?.agreedCurrency ?? "usd");
  const [cadence, setCadence] = React.useState(existing?.billingInterval ?? "month");
  const [instalments, setInstalments] = React.useState(
    existing?.installmentsTotal ? String(existing.installmentsTotal) : "",
  );
  const [startsOn, setStartsOn] = React.useState(existing?.startsOn ?? "");
  const [renewsOn, setRenewsOn] = React.useState(existing?.renewsOn ?? "");
  const [endsOn, setEndsOn] = React.useState(existing?.endsOn ?? "");
  const [notes, setNotes] = React.useState(existing?.notes ?? "");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");

  React.useEffect(() => { firstRef.current?.focus(); }, []);

  // The plans belonging to the chosen offer, from the canonical Catalog record the surface already
  // holds — never a second query, and never `leadPrice()`, whose "lowest active plan" is a display
  // floor. Writing against the DISPLAYED plan rather than the CHOSEN one is the exact defect
  // `save_solo_offer` had to add `_price_id` to fix.
  const chosenOffer = pickerOffers.find((o) => o.id === offerId) || null;
  const plans = (chosenOffer?.prices || []).filter((plan) => typeof plan.unitAmount === "number");
  // Changing the offer invalidates a plan chosen from the previous one, and a stale id would be
  // refused by the server ("that price is not a plan on this offer in this workspace").
  React.useEffect(() => { setPlanId(""); }, [offerId]);
  // "At your catalog price" is only offerable when there IS a catalog price to point at.
  React.useEffect(() => {
    if (!existing && picker.phase === "ready" && basis === "catalog" && plans.length === 0) setBasis("negotiated");
  }, [basis, plans.length, picker.phase]);

  const priced = amount.trim() !== "";
  // `quote_pending` is only legal on a CUSTOM arrangement — the server refuses it otherwise, and
  // the table's CHECK refuses it after that. Before this line the term defaulted to `one_time`
  // while `ready` ignored the term entirely, so choosing "Not quoted yet" from the empty state
  // enabled a Save that could only ever fail, two clicks in.
  const quoting = basis === "quote_pending";
  // An offer is now OPTIONAL (owner ruling 3, 2026-09-22): an NDA or a scope letter names no offer
  // and carries no price, and `tenant_client_agreements.offer_id` is NOT NULL — so with no offer
  // chosen there is simply no commercial row to write, and the document stands on its own. The
  // commercial terms below are therefore only required when an offer IS chosen.
  const termsReady = offerId !== "" && (Boolean(existing) || (picker.phase === "ready" && Boolean(chosenOffer)))
    && (quoting ? term === "custom_quote" : (basis === "catalog" ? (Boolean(existing) || planId !== "") : priced));
  const uploading = source === "tenant_upload";
  // The wording is not optional on an uploaded document, and the reason is the counterparty's page
  // rather than this one: the signer reads the TEXT and the countersigned PDF is built from it, so
  // a file with no wording produces a page that tells them to ask for it again. Shipping a control
  // whose successful path dead-ends on somebody else's screen is the §70 failure, not a shortcut.
  const docReady = uploading && Boolean(file) && docTitle.trim() !== "" && docBody.trim() !== "";
  const ready = contactId !== ""
    && (offerId ? termsReady : true)
    && (uploading ? docReady : true)
    // Something has to be recorded. With no offer and no document there is nothing to save, and a
    // Save that could only ever be a no-op is the control this guard refuses to enable.
    && (offerId !== "" || docReady);
  const { close, request, confirmation, alive } = useSalesDraftExit({ contactId, offerId, source, docTitle, docBody, fileName: file?.name ?? "", term, basis, planId, amount, currency, cadence, instalments, startsOn, renewsOn, endsOn, notes }, busy, onClose);

  const save = async () => {
    setBusy(true);
    setNotice("");
    const digits = minorUnitDigits(currency);
    const major = basis === "negotiated" && priced ? Number(amount) : null;
    if (offerId && major !== null && (!Number.isFinite(major) || major < 0)) {
      setBusy(false);
      setNotice("Enter an amount of zero or more.");
      return;
    }
    if (offerId && term === "installment" && (!Number.isInteger(Number(instalments)) || Number(instalments) < 2)) { setBusy(false); setNotice("Enter a whole number of instalments, two or more."); return; }
    if (offerId && ((endsOn && startsOn && endsOn < startsOn) || (term === "recurring" && renewsOn && startsOn && renewsOn < startsOn))) { setBusy(false); setNotice("End and renewal dates must be on or after the start date."); return; }

    // TWO RECORDS, WRITTEN IN ORDER, AND REPORTED SEPARATELY.
    //
    // The commercial row goes first because the document points AT it. If the second write fails
    // the first is already saved, and the footer says exactly that rather than implying the whole
    // form was lost — telling somebody nothing was saved when their terms were is the same class of
    // lie as the reverse (§13). Nothing here rolls the first write back: a signature record failing
    // is not a reason to delete terms a person had already agreed.
    let agreementId = existing?.id ?? null;
    if (offerId) {
      const saved = await saveTerms(digits, major);
      if (!alive.current) return;
      if (!saved.ok) { setBusy(false); setNotice(saved.message); return; }
      agreementId = saved.id ?? agreementId;
      if (!uploading) { setBusy(false); onClose(); return; }
    }

    if (uploading) {
      const uploaded = await signings.uploadDocument(file, tenantId);
      if (!alive.current) return;
      if (!uploaded.ok) {
        setBusy(false);
        setNotice(`${uploaded.message || "That file could not be uploaded."}${offerId ? " Your commercial terms were saved." : ""}`);
        return;
      }
      const created = await signings.createSigning({
        // THE WORKSPACE THIS FORM WAS OPENED IN. Not the current one — see the docstring.
        tenantId,
        contactId,
        // Null is legal and is what an NDA or a scope letter looks like (ruling 3).
        agreementId,
        documentTitle: docTitle.trim(),
        documentSource: "tenant_upload",
        documentBody: docBody.trim(),
        documentPath: uploaded.path,
      });
      if (!alive.current) return;
      setBusy(false);
      if (!created.ok) {
        setNotice(`${created.message || "That document could not be recorded."}${offerId ? " Your commercial terms were saved." : ""}`);
        return;
      }
      // Straight into the send step. The person came here to get a document in front of a client,
      // and stopping at "saved" would leave them hunting for how (§36).
      onSigningCreated({
        id: created.signingId,
        documentTitle: docTitle.trim(),
        contactId,
        signatureState: created.signatureState,
      });
      return;
    }

    setBusy(false);
    onClose();
  };

  /** The commercial half, unchanged in what it sends. Split out only so the two writes above read
   * in the order they happen. */
  const saveTerms = async (digits, major) => {
    const outcome = await agreements.saveAgreement({
      // THE WORKSPACE THIS FORM WAS OPENED IN. Not the current one — see the docstring.
      tenantId,
      id: existing?.id ?? null,
      contactId,
      offerId,
      termKind: term,
      priceBasis: basis,
      // An ID only — the server reads the list price off `tenant_prices` and takes the dated
      // snapshot itself, so the browser cannot forge what the catalog said.
      catalogPriceId: !existing && basis === "catalog" ? (planId || null) : null,
      // `10 ** minorUnitDigits(currency)`, never a hardcoded 100: JPY has no minor unit and KWD
      // has three, and a hardcoded exponent already shipped once as a real bug here.
      // On the catalog basis the server derives both from the plan, so sending a figure here would
      // be the browser stating what the catalog charged.
      agreedAmountMinor: quoting ? null : basis === "catalog" ? (existing?.agreedAmountMinor ?? null) : (major === null ? null : Math.round(major * 10 ** digits)),
      agreedCurrency: quoting ? null : basis === "catalog" ? (existing?.agreedCurrency ?? null) : (major === null ? null : (currency || "usd").trim().toLowerCase()),
      billingInterval: term === "recurring" ? cadence : null,
      intervalCount: term === "recurring" ? (existing?.intervalCount ?? 1) : null,
      installmentsTotal: term === "installment" && instalments.trim() !== ""
        ? Number(instalments)
        : null,
      paymentSchedule: existing?.paymentSchedule ?? null,
      startsOn: startsOn || null,
      // Only a recurring arrangement renews — the server says so in words before the CHECK can.
      renewsOn: term === "recurring" ? (renewsOn || null) : null,
      endsOn: endsOn || null,
      title: existing?.title ?? null,
      notes: notes.trim() || null,
      expectedUpdatedAt: existing?.updatedAt ?? null,
    }).catch(() => ({ ok: false, message: "We could not confirm the save. Refresh the records before retrying." }));
    if (outcome.ok) {
      const id = outcome.result && typeof outcome.result.id === "string" ? outcome.result.id : null;
      return { ok: true, id };
    }
    // A stale write is NOT a retry — retrying would overwrite whoever else saved. Say so.
    return {
      ok: false,
      message: outcome.stale
        ? "Someone else changed this while you had it open. Close and reopen it to see their version."
        : outcome.message || "That could not be saved. Nothing was changed.",
    };
  };

  return (
    <SalesDialogPortal>
      <button className="so-editor-scrim" tabIndex={-1} aria-label="Close" onClick={close} />
      <aside ref={panelRef} className="so-editor" role="dialog" aria-modal="true" aria-labelledby="so-agr-title">
        <header className="so-editor-head">
          <div style={{ flex: 1 }}>
            <h2 id="so-agr-title">{existing ? "Change these terms" : "New agreement"}</h2>
            <p>Nothing is sent until you choose to send it.</p>
          </div>
          <button className="btn btn-s btn-q" onClick={close} disabled={busy}>Cancel</button>
        </header>

        <div className="so-editor-body" inert={busy ? "" : undefined}>
          {!agreements.clients.length && <div className="so-prerequisite"><strong>Add a client first</strong><p>Create a contact in Clients, then return here to record their terms.</p><button className="btn btn-p" onClick={() => request(onOpenClients)}>Go to Clients</button></div>}

          {/* ── THE DOCUMENT ──────────────────────────────────────────────────────────────────
            * First, because it is what the client actually receives. The three sources are three
            * different answers rather than three ways of saying the same thing: one attaches a
            * contract you already have, one is honestly unavailable, and one records no document
            * at all — which is exactly what this editor did before documents existed, and stays
            * the default so nobody has to opt out of something to keep the old behaviour (§58). */}
          <h3 className="so-step">Where the document comes from</h3>
          {existingSigning ? (
            <p className="so-absent">
              <b>{existingSigning.documentTitle}</b> is already on this record
              {" — "}{(SIGNATURE_STATE[existingSigning.displayState] || SIGNATURE_STATE.unrecognised).label.toLowerCase()}.
              Send it, or stop its link, from the row on Commercial Terms. Editing here changes the
              terms only; it does not alter a document somebody may already have read.
            </p>
          ) : !canSign ? (
            // Declared through the one §60 home, never an inline account-type compare.
            <p className="so-absent">Documents are not part of this account type. The commercial terms below still record what was agreed.</p>
          ) : signings.phase === "error" ? (
            <p className="so-absent" role="alert">
              Your documents could not be read, so this is unknown rather than empty and nothing can
              be sent right now. The commercial terms below still save.{" "}
              <button className="btn btn-s" onClick={signings.retry}><Ic.arrow size={13} />Retry documents</button>
            </p>
          ) : (<>
            <div className="so-src" role="radiogroup" aria-label="The document">
              {/* The APPROVED order (§28 screen 2): the contract you already have, then Paige
                * writing one, then no document at all — which the prototype's own note calls
                * "today's behaviour preserved", and which stays the DEFAULT so nobody has to opt
                * out of something to keep what this editor did before documents existed (§58). */}
              <button type="button" role="radio" aria-checked={source === "tenant_upload"} className="so-src-card"
                      onClick={() => setSource("tenant_upload")}>
                <span className="so-src-ic so-src-ic-upload"><Ic.plus size={16} /></span>
                <b>Upload a contract</b>
                <small>You already have the wording. Kept on this record and sent to the client to sign.</small>
              </button>
              <button type="button" role="radio" aria-checked={source === "paige_draft"} className="so-src-card"
                      onClick={() => setSource("paige_draft")}>
                <span className="so-src-ic so-src-ic-paige"><Ic.spark size={16} /></span>
                <b>Paige drafts it <em className="so-src-soon">not available yet</em></b>
                {/* The approved card describes what this WILL do. The marker beside the name is
                  * what keeps it honest (§13/§70.1): nothing in this workspace writes contract
                  * wording today, so the description alone would be a promise the product cannot
                  * keep, and a bare "not available" would not say what is being waited for. */}
                <small>Tell her the scope and she writes it from your terms. You read and edit it before anyone else sees it.</small>
              </button>
              <button type="button" role="radio" aria-checked={source === "none"} className="so-src-card"
                      onClick={() => setSource("none")}>
                <span className="so-src-ic so-src-ic-none"><Ic.doc size={16} /></span>
                <b>No document — record the terms only</b>
                <small>You agreed it elsewhere and just want it written down. Nothing gets sent and nothing gets signed.</small>
              </button>
            </div>

            {source === "paige_draft" && (
              // UNAVAILABLE with a reason and a way through, never a disabled control that tells
              // somebody nothing (§70.1). One missing piece does not make the rest of this form
              // read-only — the two other sources still work and are named here.
              <p className="so-banner so-banner-warn"><Ic.shield size={15} /><span>
                <b>Paige cannot draft a contract yet.</b> Nothing in this workspace writes contract
                wording, and offering you a draft that was never written would be a lie about what
                happened. Choose <b>Upload a contract</b> to send one you already have, or{" "}
                <b>No document</b> to record the terms now and attach a document later — neither
                loses what you have typed here.
              </span></p>
            )}

            {uploading && (<>
              <label className="so-field">
                <span>The contract file</span>
                <input type="file" aria-label="The contract file"
                       accept=".pdf,.doc,.docx,.rtf,.txt,.md,application/pdf,text/plain"
                       onChange={(e) => {
                         const picked = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                         setFile(picked);
                         if (picked && !docTitle.trim()) setDocTitle(picked.name.replace(/\.[^.]+$/, ""));
                       }} />
              </label>
              <label className="so-field">
                <span>What to call it</span>
                <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)}
                       placeholder="Coaching agreement" />
              </label>
              <label className="so-field">
                <span>The wording they sign</span>
                <textarea rows={7} value={docBody} onChange={(e) => setDocBody(e.target.value)}
                          placeholder="Paste the text of your contract here." />
              </label>
              <p className="so-absent">
                The person signing reads this wording on the page and the countersigned PDF is built
                from it, so it is what they are agreeing to. Your file is kept on the record beside it.
              </p>
            </>)}
          </>)}

          <h3 className="so-step">Who it is for</h3>
          <label className="so-field">
            <span>Client</span>
            <select aria-label="Client" ref={firstRef} value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">Choose a client…</option>
              {agreements.clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </label>

          {/* ── FIND AN OFFER ─────────────────────────────────────────────────────────────────
            * This search used to be a band of its own on Commercial Terms, browsing the catalog
            * beside a table it had nothing to do with. The owner removed it (2026-09-22); the
            * capability did not go with it, it moved HERE, to the one moment an offer is actually
            * being chosen. Its two acts came with it: Quick offer lives in the empty state below
            * (this is its only call site in the repo, so losing it would have made the component
            * unreachable and left a new workspace unable to create its first offer from Sales),
            * and Open Catalog now sits in the band head on the surface behind this drawer. */}
          <h3 className="so-step">Which offer this is for</h3>
          <label className="so-field"><span>Search your Catalog</span><input type="search" disabled={offerLocked} value={pickerSearch} onChange={(e) => { setPickerSearch(e.target.value); setPickerPage(0); }} placeholder="Search your Catalog…" /></label>

          {/* THE SNAPSHOT LOCK, SAID OUT LOUD. When an offer's list price has been snapshotted the
            * choice is fixed, and until now the controls simply went dead with no reason given —
            * a disabled control that explains nothing is exactly what §70.1 refuses to count as
            * delivered. The lock itself is unchanged; what is new is that it says why. */}
          {offerLocked && (
            <p className="so-absent" role="status">
              This agreement&rsquo;s price was snapshotted when it was saved, so the offer is fixed.
              That snapshot is what keeps the terms provable after you reprice the offer in Catalog.
            </p>
          )}

          {/* THE APPROVED ATTACH LIST (§28 screen 2). This was a native &lt;select&gt; under a pager —
            * banned outright by §11, and the reason the approved pack does not use one is plainer
            * than the rule: a dropdown shows one offer at a time, so choosing meant opening it,
            * reading down, and closing it again, with the prices invisible until you did. The list
            * shows every offer and its price at once, which is how you notice you are about to
            * attach the wrong plan to somebody's contract. */}
          <div className="so-results" role="group" aria-label="Offer">
            {/* Always first, always reachable: an agreement with no price is a real thing (an NDA,
              * a scope letter), not the absence of a choice. It was the first <option>; it is the
              * first row. */}
            <button
              type="button" className="so-res" aria-pressed={!offerId} disabled={offerLocked}
              onClick={() => setOfferId("")}
            >
              <strong>No offer &mdash; this document carries no price</strong>
              <span className="so-res-sp" />
              {!offerId
                ? <span className="so-res-on">Attached</span>
                : <span className="so-res-act" aria-hidden="true">Attach</span>}
            </button>
            {pickerOffers.map((offer) => (
              <button
                key={offer.id} type="button" className="so-res"
                aria-pressed={offerId === offer.id} disabled={offerLocked}
                onClick={() => setOfferId(offer.id)}
              >
                <strong>{offer.name || "Untitled offer"}</strong>
                <span className="so-res-sp" />
                {/* The price travels beside the name rather than inside it. An offer chosen blind,
                  * by name alone, is how the wrong plan gets attached to somebody's contract. */}
                <span className="so-res-price">{offerPriceLabel(offer)}</span>
                {offerId === offer.id
                  ? <span className="so-res-on">Attached</span>
                  : <span className="so-res-act" aria-hidden="true">Attach</span>}
              </button>
            ))}
          </div>

          {/* §58 — the pager is PRESERVED, not dropped with the dropdown. The approved pack shows
            * three fixture offers and needs no pager; a real catalog has hundreds, and removing the
            * only way past the first five would be a regression dressed as fidelity. It renders
            * only when it can actually do something. */}
          {picker.phase === "error" && (
            <p className="so-absent" role="alert">
              Your Catalog could not be read, so these offers may be incomplete.{" "}
              <button className="btn btn-s" onClick={picker.retry}>Retry offers</button>
            </p>
          )}
          {picker.phase !== "error" && (pickerPage > 0 || picker.hasMore) && (
            <div className="so-page-controls">
              <span role="status">
                {picker.phase === "ready" ? `Offer page ${pickerPage + 1} · up to 5 offers` : "Loading offers…"}
              </span>
              <button className="btn btn-s" disabled={!pickerPage || picker.phase !== "ready" || offerLocked} onClick={() => setPickerPage((p) => p - 1)}>Previous</button>
              <button className="btn btn-s" disabled={!picker.hasMore || picker.phase !== "ready" || offerLocked} onClick={() => setPickerPage((p) => p + 1)}>Next</button>
            </div>
          )}
          {/* §58 — both of these came off the deleted band with the search. A search that matches
            * nothing said so there and must say so here, or the picker silently offers one option
            * and the person cannot tell an empty catalog from an unlucky word. And an offer
            * AUTHORITY that could not be read is still "I could not look", never "you may not". */}
          {offers.authorityUnknown && <p className="so-absent" role="alert">Offer editing access could not be confirmed. <button className="btn btn-s" onClick={offers.retry}>Retry offer access</button></p>}
          {/* Boolean(), not the bare values. `("" || 0)` is `0`, and React renders a numeric 0 as
            * text — so an empty search on page one printed a stray "0" under the Offer field on
            * every first open of this editor. It reads as junk output, which is exactly how it
            * looked on the desk. */}
          {(Boolean(pickerSearch) || pickerPage > 0) && picker.phase === "ready" && !pickerOffers.length && (
            /* KEPT DISTINCT from the empty-catalog state below. "Nothing matches that word" and
             * "you have no offers at all" are different facts, and a reader who cannot tell them
             * apart will go looking in Catalog for something that was never there. The approved
             * pack shows only this one because its fixtures are never empty — so its two acts are
             * adopted here, and the other state stays. */
            <div className="so-nomatch">
              <p>Nothing in your Catalog matches that.</p>
              <div className="so-nomatch-acts">
                {offers.canManage && !offerLocked && (
                  <button className="btn btn-s btn-p" onClick={() => request(onQuickOffer)}>Quick offer</button>
                )}
                <button className="btn btn-s" onClick={() => request(() => onOpenCatalog(true))}>Open Catalog</button>
              </div>
              {offers.canManage && !offerLocked && (
                <small className="so-quiet">Quick offer writes it straight into your Catalog. It opens on its own, so anything typed here is not kept.</small>
              )}
            </div>
          )}
          {!pickerSearch && !pickerPage && picker.phase === "ready" && !pickerOffers.length && (
            <div className="so-prerequisite">
              <strong>Nothing in your catalog yet</strong>
              <p>
                Catalog keeps the canonical products and services you sell. Create one now, or leave
                the offer blank and send a document that carries no price.
              </p>
              <div className="so-prereq-acts">
                {offers.canManage && <button className="btn btn-p" onClick={() => request(onQuickOffer)}>Quick offer</button>}
                <button className="btn" onClick={() => request(() => onOpenCatalog(true))}>Go to Catalog</button>
              </div>
              {offers.canManage && <small className="so-quiet">Quick offer opens on its own, so anything typed here is not kept.</small>}
            </div>
          )}

          {!offerId ? (
            <p className="so-absent">
              No offer chosen, so no amount, cadence or dates are recorded — which is what an NDA or
              a scope letter looks like. Choose one of your offers to put a price on the record.
            </p>
          ) : (<>
          <h3 className="so-step">What they agreed to pay</h3>
          <fieldset className="so-field">
            <legend>Arrangement</legend>
            <div className="so-pick">
              {Object.entries(TERM_LABEL).map(([key, text]) => (
                <button key={key} type="button" aria-pressed={term === key}
                        onClick={() => setTerm(key)}>{text}</button>
              ))}
            </div>
          </fieldset>

          {term === "recurring" ? (
            <fieldset className="so-field">
              <legend>How often</legend>
              <div className="so-pick">
                {[["week", "Weekly"], ["month", "Monthly"], ["year", "Yearly"]].map(([key, text]) => (
                  <button key={key} type="button" aria-pressed={cadence === key}
                          onClick={() => setCadence(key)}>{text}</button>
                ))}
              </div>
            </fieldset>
          ) : null}

          {term === "installment" ? (
            <label className="so-field">
              <span>How many instalments</span>
              <input inputMode="numeric" value={instalments} placeholder="2 or more"
                     onChange={(e) => setInstalments(e.target.value)} />
            </label>
          ) : null}

          <label className="so-field">
            <span>What they agreed to pay</span>
            <div className="so-money">
              <input inputMode="decimal" value={quoting ? "" : basis === "catalog" ? (existing ? String(existing.agreedAmountMinor / 10 ** minorUnitDigits(existing.agreedCurrency)) : "") : amount}
                     placeholder={basis === "quote_pending" ? "Still to be quoted"
                       : basis === "catalog" ? "Taken from the plan above" : "Amount"}
                     disabled={basis === "quote_pending" || basis === "catalog"}
                     onChange={(e) => setAmount(e.target.value)} />
              <input disabled={basis === "catalog" || quoting} value={basis === "catalog" && existing ? existing.agreedCurrency : currency} onChange={(e) => setCurrency(e.target.value)}
                     aria-label="Currency" style={{ maxWidth: "70px" }} placeholder="usd" />
            </div>
          </label>

          <fieldset className="so-field">
            <legend>This price is</legend>
            <div className="so-pick">
              {[
                ...((existing ? existing.priceBasis === "catalog" : plans.length > 0) ? [["catalog", "Your catalog price"]] : []),
                ["negotiated", "What we agreed"],
                // Only legal on a Custom arrangement, so choosing it says so rather than enabling
                // a Save that the server would refuse.
                ["quote_pending", "Not quoted yet"],
              ].map(([key, text]) => (
                <button key={key} type="button" aria-pressed={basis === key}
                        onClick={() => { setBasis(key); if (key === "quote_pending") setTerm("custom_quote"); }}>
                  {text}
                </button>
              ))}
            </div>
          </fieldset>

          {basis === "catalog" && existing && <p className="so-absent">The recorded amount and currency are preserved. Editing these terms does not re-read or change the Catalog price.</p>}
          {basis === "catalog" && !existing ? (
            <label className="so-field">
              <span>Which of your plans</span>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Choose the plan they are on…</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {money(plan.unitAmount, plan.currency) ?? "Unpriced"}
                    {plan.billingInterval && plan.billingInterval !== "one_time"
                      ? ` · ${CADENCE_LABEL[plan.billingInterval] || plan.billingInterval}`
                      : ""}
                    {plan.nickname ? ` · ${plan.nickname}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="so-field">
            <span>Starts</span>
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </label>
          {term === "recurring" ? (
            <label className="so-field">
              <span>Renews (optional)</span>
              <input type="date" value={renewsOn} onChange={(e) => setRenewsOn(e.target.value)} />
            </label>
          ) : null}
          <label className="so-field">
            <span>Ends (optional)</span>
            <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </label>
          <label className="so-field">
            <span>Notes (optional)</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
                   placeholder="Anything you want to remember about this arrangement" />
          </label>
          </>)}
        </div>

        <footer className="so-editor-foot">
          <span role={notice ? "alert" : "status"} className="so-editor-note" data-tone={notice ? "bad" : "plain"}>
            {notice || (ready
              ? (uploading
                  ? "Saves the record, then shows you how to send it. Nothing is charged, invoiced or sent until you do."
                  : existing ? "Saves these commercial terms. Nothing is charged, invoiced or sent." : "It saves as a draft. Nothing is charged, invoiced or sent.")
              : contactId === ""
                ? "Pick the client this is for."
                : uploading && !docReady
                  ? "A document needs a file, a name, and the wording they sign."
                  : offerId === ""
                    ? "Choose one of your offers, or upload a document to record instead."
                    : "Say what they agreed to pay.")}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s btn-p" onClick={save} disabled={busy || !ready}>
            {busy ? "Saving…" : existing ? "Save changes" : uploading ? "Review and send →" : "Save as draft"}
          </button>
        </footer>
        {confirmation}
      </aside>
    </SalesDialogPortal>
  );
}

/**
 * SEND FOR SIGNATURE — the step between "a document exists" and "a client has it".
 *
 * ONE LINK, SHOWN ONCE. `issue_agreement_signing_link` generates the token server-side and stores
 * only its sha256, so the raw link exists in exactly one place for exactly one moment: this panel.
 * There is no "show it again", and pretending otherwise would send somebody away with nothing. The
 * link is rendered into a read-only field they can select as well as behind a copy button, because
 * the clipboard API is not available on every browser and a control that silently does nothing is
 * how a person loses the only copy of their link (§70).
 *
 * §38: issuing this charges nobody and authorises no payment. The figure travels with the document
 * because it is what was agreed; it is a sentence, not an instrument.
 */
function SignatureSender({ signings, signing, clientName, agreedLabel, tenantId, onClose, onVoided }) {
  const panelRef = useModalDialog();
  const firstRef = React.useRef(null);
  const [days, setDays] = React.useState(14);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [link, setLink] = React.useState(null);
  const [copied, setCopied] = React.useState(false);
  const [sent, setSent] = React.useState(null);
  const [showLink, setShowLink] = React.useState(false);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  React.useEffect(() => { firstRef.current?.focus(); }, []);

  // The approved act names the person. A single-word first name where there is one, the whole
  // label where there is not, and never an empty string in the middle of a button.
  const firstName = (clientName || "").trim().split(/\s+/)[0] || "your client";
  const state = signing.displayState || signing.signatureState || "draft";
  const reissue = state === "sent" || state === "viewed" || state === "expired";
  // The public route this build actually registers. Derived from the running origin rather than a
  // configured base, so a preview deployment hands out a preview link instead of a dead one.
  const url = link ? `${window.location.origin}/sign/${link.token}` : "";

  /** The approved act. A real email to the counterparty, not a link for the owner to paste. */
  const send = async () => {
    setBusy(true);
    setNotice("");
    const outcome = await signings.sendForSignature(signing.id, tenantId, reissue)
      .catch(() => ({ ok: false, message: "That could not be confirmed, so nothing is being reported as sent." }));
    if (!alive.current) return;
    setBusy(false);
    if (!outcome.ok) { setNotice(outcome.message); return; }
    setSent(outcome);
  };

  const issue = async () => {
    setBusy(true);
    setNotice("");
    const outcome = await signings.issueLink(signing.id, days, tenantId)
      .catch(() => ({ ok: false, message: "That could not be confirmed, so no link is being shown." }));
    if (!alive.current) return;
    setBusy(false);
    // §13 — a link exists because the server handed one back, never because a promise resolved.
    if (!outcome.ok || !outcome.token) {
      setNotice(outcome.message || "No link was issued, so nothing has been sent.");
      return;
    }
    setLink({ token: outcome.token, expiresAt: outcome.expiresAt ?? null });
  };

  const stop = async () => {
    setBusy(true);
    setNotice("");
    const outcome = await signings.voidSigning(signing.id, tenantId)
      .catch(() => ({ ok: false, message: "That could not be confirmed. Check the record before trying again." }));
    if (!alive.current) return;
    setBusy(false);
    if (!outcome.ok) { setNotice(outcome.message || "The link was not stopped. Nothing was changed."); return; }
    onVoided?.();
    onClose();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      if (!alive.current) return;
      setCopied(true);
    } catch {
      if (!alive.current) return;
      // Honest, and it points at the field that is right there — never a silent no-op.
      setNotice("Your browser would not let this page copy. Select the link above and copy it yourself.");
    }
  };

  return (
    <SalesDialogPortal>
      <button className="so-editor-scrim" tabIndex={-1} aria-label="Close" onClick={onClose} />
      <aside ref={panelRef} className="so-editor" role="dialog" aria-modal="true" aria-labelledby="so-send-title">
        <header className="so-editor-head">
          <div style={{ flex: 1 }}>
            <h2 id="so-send-title">Send for signature</h2>
            <p>{sent ? "This has been sent." : "Nothing has been sent yet."}</p>
          </div>
          <button className="btn btn-s btn-q" onClick={onClose} disabled={busy}>{sent ? "Done" : "Back"}</button>
        </header>

        <div className="so-editor-body" inert={busy ? "" : undefined}>
          {/* THE APPROVED RECAP (§28 screen 3): the last screen before anything leaves the
            * building, saying plainly WHO receives it, WHAT they get and WHAT HAPPENS when they
            * sign. Only rows this surface can fill TRUTHFULLY are here — the approved screen also
            * shows the offer name and a start date, which this component is not handed, and a row
            * invented to match a picture is the opposite of a recap. */}
          <div className="so-recap">
            <div className="so-rrow"><span>To</span><span><b>{clientName || "This client"}</b></span></div>
            <div className="so-rrow"><span>Document</span><span>{signing.documentTitle}</span></div>
            <div className="so-rrow"><span>They agree to</span><span className="so-num">{agreedLabel || "No price is stated on this document"}</span></div>
            <div className="so-rrow"><span>Link expires</span><span>{SEND_TTL_DAYS} days after it is sent</span></div>
          </div>

          {sent ? (<>
            {/* §13 — a 200 is not a delivery, so this reports who was actually reached and, just
              * as plainly, who was not. A suppressed address is a real outcome, not a rounding. */}
            <p className="so-banner"><Ic.shield size={15} /><span>
              {sent.sent.length
                ? <><b>Sent.</b> {clientName || "Your client"} has a private link to this exact document{sent.sent.length > 1 ? `, as do ${sent.sent.length - 1} other signer(s)` : ""}. You will see it move to Opened and then Completed on Commercial Terms.</>
                : <><b>Nothing went out.</b> No message reached anybody, so this document is unchanged.</>}
            </span></p>
            {sent.notDelivered.length > 0 && (
              <p className="so-banner so-banner-warn" role="alert"><Ic.shield size={15} /><span>
                <b>{sent.notDelivered.length} address did not receive it.</b> That address is
                suppressed or was refused by the mail provider, so no link reached it. Fixing the
                address and sending again is what puts that right.
              </span></p>
            )}
          </>) : !link ? (<>
            {/* The gold statement the approved screen carries, in the approved words: what the
              * counterparty gets, what is sealed, and that no money moves (§38). */}
            <p className="so-banner so-banner-warn"><Ic.shield size={15} /><span>
              {clientName || "Your client"} gets a private link to this exact document. When they
              sign it, Paige seals a PDF with their signature, the wording they actually saw, and
              the time they signed it — and files it against their record. <b>No money moves.</b>{" "}
              Nothing is charged, invoiced or collected at signature.
            </span></p>
            {reissue && (
              <p className="so-absent">
                Sending again replaces the link already out there — the old one stops working the
                moment the new message goes out, and the deadline starts over.
              </p>
            )}
            {/* §58 — the copy-a-link route is a SHIPPED capability and survives the approved
              * flow becoming the primary one. It is the way through when the client's mail is
              * bouncing, and it is secondary rather than gone. */}
            {!showLink && (
              <button className="btn btn-s btn-q" ref={firstRef} onClick={() => setShowLink(true)}>
                Or copy a link to send yourself
              </button>
            )}
            {showLink && (<>
              <fieldset className="so-field">
                <legend>How long the link works</legend>
                <div className="so-pick">
                  {LINK_DAYS.map((value) => (
                    <button key={value} type="button"
                            aria-pressed={days === value} onClick={() => setDays(value)}>
                      {value} days
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="so-send-acts">
                <button className="btn btn-s" onClick={issue} disabled={busy}>
                  {busy ? "Making the link…" : reissue ? "Make a new link" : "Make the link"}
                </button>
              </div>
            </>)}
          </>) : (<>
            <label className="so-field">
              <span>The link — copy it now</span>
              <input readOnly value={url} aria-label="The signing link"
                     onFocus={(e) => e.target.select()} />
            </label>
            <div className="so-send-acts">
              <button className="btn btn-s btn-p" onClick={copy}><Ic.doc size={13} />Copy link</button>
              <span role="status" className="so-quiet">{copied ? "Copied." : ""}</span>
            </div>
            <p className="so-banner so-banner-warn"><Ic.shield size={15} /><span>
              <b>This is the only time you will see it.</b> Paige keeps a one-way fingerprint of this
              link and not the link itself, so it cannot be shown again. Send it to{" "}
              {clientName || "your client"} now — by email, by message, however you already talk.
              {link.expiresAt ? ` It stops working on ${when(link.expiresAt)}.` : ""}
            </span></p>
            <p className="so-absent">
              You will see it move to Opened and then Completed on Commercial Terms as they read and
              sign it. Nothing is charged at any point.
            </p>
          </>)}
        </div>

        <footer className="so-editor-foot">
          <span role={notice ? "alert" : "status"} className="so-editor-note" data-tone={notice ? "bad" : "plain"}>
            {notice || (sent
              ? "The record now shows this document as sent."
              : link
                ? "The record now shows this document as sent."
                : "Nothing leaves the building until you send it.")}
          </span>
          <span style={{ flex: 1 }} />
          {reissue && !link && !sent && (
            <button className="btn btn-s" onClick={stop} disabled={busy}>Stop the current link</button>
          )}
          <button className="btn btn-s" onClick={onClose} disabled={busy}>{link || sent ? "Done" : "Not yet"}</button>
          {/* GOLD, and only here. This is one of exactly two acts on this whole flow that COMMIT —
            * sending it, and signing it — which is the entire gold budget the approved pack spends
            * (§11). Naming the person is the approved wording and is also the honest one: it says
            * who is about to receive a legal document. */}
          {!link && !sent && (
            <button className="btn btn-s btn-g" onClick={send} disabled={busy}>
              {busy ? "Sending…" : `Send it to ${firstName}`}
            </button>
          )}
        </footer>
      </aside>
    </SalesDialogPortal>
  );
}

/**
 * The Sales Operations surface. `setDetail` is the Campaigns drawer `GrowthHub` already mounts, so
 * this adds no second drawer (§18) and inherits its focus trap and Escape handling. `deals` arrives
 * from the Campaigns snapshot rather than a fifth tenant read.
 */
// ── Sales Command Desk — presentational helpers (file-local) ─────────────────────────────────
// The four Sales views. IDs are the `?view=` values; the shell six-tab nav is untouched.
const SALES_VIEWS = [
  ["command", "Sales Command"],
  ["terms", "Commercial Terms"],
  ["revenue", "Revenue & Collections"],
  ["scenarios", "Sales Scenarios"],
];
const EC_LABEL = { actual: "Actual", contracted: "Contracted", dated: "Dated", open: "Open", modeled: "Modeled", unknown: "Unknown" };
// The evidence class of a FIGURE — separate from the surface TRUTH label. Never gold (§11).
/* ── 5 · COMPLETED ────────────────────────────────────────────────────────────────────────────
 *
 * The approved completion surface (§28 screen 5). A signed agreement is the one record on this
 * desk that has to be provable later, so this says three things: that it is sealed, WHAT happened
 * and when, and where to get the document.
 *
 * The trail is the engine's own append-only `paige_agreement_events`, read on demand — not
 * reconstructed from the row's timestamps. That distinction is the whole point of an audit trail:
 * four timestamps can say a document was viewed, they cannot say by which address, from which
 * device, in what order. Nothing here is invented; an event the engine did not record is simply
 * not shown. */
const EVENT_LABEL = {
  created: "Created",
  edited: "Edited",
  sent: "Sent",
  delivered: "Delivered",
  viewed: "Viewed",
  consented: "Consent recorded",
  signed: "Signed",
  declined: "Declined",
  completed: "Signed and completed",
  voided: "Stopped",
  expired: "Link expired",
  sealed: "Sealed",
  downloaded: "Copy downloaded",
  resent: "Sent again",
};
/* The events that CLOSE the ceremony carry the settled mark; everything else is in-flight. */
const EVENT_DONE = new Set(["completed", "signed", "sealed", "consented"]);

function AgreementCompletion({ signings, signing, clientName, tenantId, onClose, onOpenClients }) {
  const panelRef = useModalDialog();
  const [trail, setTrail] = React.useState({ phase: "loading", events: [], message: "", truncated: false });
  const [notice, setNotice] = React.useState("");
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  /* With no head row there is no first control to take focus, so the panel takes it: a screen
   * reader then reads the dialog and its name rather than starting mid-surface. */
  React.useEffect(() => { panelRef.current?.focus({ preventScroll: true }); }, [panelRef]);

  React.useEffect(() => {
    let current = true;
    (async () => {
      const outcome = await signings.signingEvents(signing.id, tenantId)
        .catch(() => ({ ok: false, message: "This document's history could not be read." }));
      if (!current || !alive.current) return;
      setTrail(outcome.ok
        ? { phase: "ready", events: outcome.events, message: "", truncated: outcome.truncated }
        : { phase: "error", events: [], message: outcome.message, truncated: false });
    })();
    return () => { current = false; };
  }, [signings, signing.id, tenantId]);

  const download = async () => {
    setNotice("");
    const outcome = await signings.signedCopyUrl(signing.id, tenantId)
      .catch(() => ({ ok: false, message: "That signed copy could not be opened just now." }));
    if (!outcome.ok) { setNotice(outcome.message); return; }
    window.open(outcome.url, "_blank", "noopener,noreferrer");
  };

  const who = signing.signerName || clientName || "The counterparty";

  /* Escape closes. This surface is READ-ONLY — there is no save to interrupt — so the caller-owned
   * dismissal `useModalDialog` deliberately leaves open is unambiguous here. */
  React.useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <SalesDialogPortal>
      <button className="so-editor-scrim" tabIndex={-1} aria-label="Close" onClick={onClose} />
      {/* No head row. The approved screen has ONE title and the seal carries it; a header repeating
        * "Signed and completed" immediately above the seal that says it again is a stutter, not a
        * frame. The dialog takes its accessible name from that heading, and its exits are the
        * footer's labelled Back, the scrim, and Escape. */}
      <aside
        ref={panelRef} tabIndex={-1}
        className="so-editor so-done" role="dialog" aria-modal="true" aria-labelledby="so-done-title"
      >
        <div className="so-editor-body">
          <div className="so-seal">
            <span className="so-orb" aria-hidden="true">
              <i className="so-orb-halo" /><i className="so-orb-body" /><i className="so-orb-ring" />
              <Ic.check size={30} />
            </span>
            <div>
              <h2 id="so-done-title">Signed and completed</h2>
              {/* This sentence asserted two things this surface does not know.
                *
                * "These terms are now active against their record" — signing completion does not
                * touch the commercial row, and the create-and-sign flow saves it as a DRAFT, so
                * the common case made this false. It also contradicted the closing note eight
                * lines below, which says in so many words that the commercial state is separate
                * and the owner controls it from here. The note is right; the sentence is gone.
                *
                * "The sealed PDF carries their signature" — asserted unconditionally while the
                * footer said no sealed copy is recorded. The dialog argued with itself. */}
              <p>
                {who} signed this{momentOf(signing.completedAt) ? ` on ${momentOf(signing.completedAt)}` : ""}.
                {signing.hasSealedCopy
                  ? " The sealed PDF carries their signature, the exact wording they read, and the time they signed it."
                  : " No sealed copy is recorded against it yet, so what follows is the recorded history rather than the document itself."}
              </p>
            </div>
          </div>

          <div className="so-trail">
            <div className="so-trail-hd">What happened, and when</div>
            {/* A panel headed "What happened, and when" that quietly drops the oldest events
              * presents a partial chain of custody as a complete one. It is capped for the same
              * reason any list is, so the cap is DISCLOSED rather than hidden. */}
            {trail.truncated && (
              <p className="so-absent so-trail-cut" role="status">
                Showing the {TRAIL_LIMIT} most recent events. Older ones — which may include this
                document being created and first sent — are recorded but not shown here.
              </p>
            )}
            {trail.phase === "loading" && <p className="so-absent" role="status">Reading this document's history…</p>}
            {trail.phase === "error" && <p className="so-absent" role="alert">{trail.message}</p>}
            {/* `phase === "ready"` PROVES the read completed, so "could not be read" was a
              * possibility this branch had already excluded — and it undid the very distinction
              * this lane claimed to draw, in the commit message, the PR and two evidence records.
              * The error branch above carries the failed read; this one carries only the fact. */}
            {trail.phase === "ready" && trail.events.length === 0 && (
              <p className="so-absent">
                No events are recorded against this document. The history was read successfully and
                came back empty, which is not the same as the history being unavailable.
              </p>
            )}
            {trail.phase === "ready" && trail.events.map((event) => (
              <div key={event.id} className={`so-ev${EVENT_DONE.has(event.type) ? " is-done" : ""}`}>
                <span className="so-ev-mark" aria-hidden="true" />
                <span className="so-ev-when">{stamp(event.at)}</span>
                <span className="so-ev-what">
                  <b>{EVENT_LABEL[event.type] || event.type}</b>
                  {/* Only what the engine actually recorded. A missing address or device is left
                    * out rather than filled with a plausible-looking blank. */}
                  <span>{[event.actorEmail, event.ip, event.userAgent].filter(Boolean).join(" · ") || `by ${event.actorKind}`}</span>
                </span>
              </div>
            ))}
          </div>

          <p className="so-absent so-done-note">
            The <b>signature</b> state finishes at Completed. What the agreement is worth commercially
            &mdash; active, paused, finished, cancelled &mdash; is a separate state you control from here
            on, because a signed agreement can be paused and a cancelled one is still signed.
          </p>

          {notice && <p className="so-absent" role="alert">{notice}</p>}
        </div>

        <footer className="so-editor-foot">
          {signing.hasSealedCopy
            ? <button className="btn btn-s btn-p" onClick={() => { void download(); }}><Ic.doc size={13} />Download the signed PDF</button>
            : <span className="so-quiet">This is signed, but no sealed copy is recorded against it.</span>}
          {onOpenClients && <button className="btn btn-s" onClick={() => onOpenClients(signing.contactId)}>Open {clientName || "the client"}&rsquo;s record</button>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-s btn-q" onClick={onClose}>Back to Commercial Terms</button>
        </footer>
      </aside>
    </SalesDialogPortal>
  );
}

function EcChip({ e }) {
  return <span className={`so-ec so-ec-${e}`}>{EC_LABEL[e] || e}</span>;
}
// A small icon set for moves; `Ic` has no card/refresh/target, so these few live here.
function MoveIcon({ name }) {
  const c = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  const body = {
    card: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>,
    doc: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 12h6M9 16h6" /></>,
    refresh: <><path d="M4 12a8 8 0 0113.7-5.7L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 01-13.7 5.7L4 16" /><path d="M4 20v-4h4" /></>,
    chat: <path d="M4 5h16v11H9l-5 4V5z" />,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  }[name] || <circle cx="12" cy="12" r="8" />;
  return <svg viewBox="0 0 24 24" width="16" height="16" {...c} aria-hidden="true">{body}</svg>;
}
// The Sales-local sub-navigation. Roving tabindex + arrow/Home/End, exactly like the shell strip,
// but scoped to Sales and driven by the `?view=` param so a view is deep-linkable and testable.
function SubNav({ view, setView }) {
  const onKey = (event, index) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? SALES_VIEWS.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + SALES_VIEWS.length) % SALES_VIEWS.length;
    const nextId = SALES_VIEWS[next][0];
    setView(nextId);
    // The buttons persist across a view change (only aria-selected/tabindex flip), so focusing the
    // sibling directly is safe and keeps keyboard users on the roving item.
    document.getElementById(`sales-view-${nextId}`)?.focus();
  };
  return (
    <div className="so-subnav" role="tablist" aria-label="Sales views">
      {SALES_VIEWS.map(([id, label], index) => (
        <button key={id} id={`sales-view-${id}`} role="tab" aria-selected={view === id} aria-controls="sales-view-panel"
          tabIndex={view === id ? 0 : -1} onClick={() => setView(id)} onKeyDown={(event) => onKey(event, index)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// A pulse tile value: an honest count, a formatted amount, or an em-dash — never a coerced zero.
function PulseValue({ tile }) {
  if (tile.unavailable) return <span className="so-pv so-pv-dash">—</span>;
  if (tile.count != null) return <span className="so-pv">{tile.count}{tile.unit ? <span className="so-pv-u"> {tile.unit}</span> : null}</span>;
  if (tile.amountMinor != null) return <span className="so-pv mono">{money(tile.amountMinor, tile.currency) ?? "—"}</span>;
  return <span className="so-pv so-pv-dash">—</span>;
}

// ── Sales Scenario Lab (file-local) ──────────────────────────────────────────────────────────
// A MODEL, never an action. It reads the current price from Catalog (source-backed) and the
// close-rate / opportunity evidence from the tenant's own pipeline outcomes; everything else is an
// owner assumption, labelled as one. It writes NOTHING — no price, offer, deal, campaign, payment,
// or Mission. Save-as-artifact and link-to-Mission are UNAVAILABLE until those records exist.
function ScenarioLab({ offers, deals, stages, onAskPaige }) {
  const offerList = offers.offers || [];
  const [offerId, setOfferId] = React.useState("");
  const chosen = offerList.find((o) => o.id === offerId) || offerList[0] || null;
  const lead = chosen ? (chosen.prices.filter((p) => p.active && typeof p.unitAmount === "number")[0] || null) : null;
  const currency = (lead?.currency || "usd").toLowerCase();
  const currentPriceMinor = lead ? lead.unitAmount : null;
  const [proposed, setProposed] = React.useState("");
  const [capacity, setCapacity] = React.useState("Limited");
  const [period, setPeriod] = React.useState("Next 2 quarters");
  const [closeAssume, setCloseAssume] = React.useState("");
  const [oppsAssume, setOppsAssume] = React.useState("");

  // Evidence from the tenant's OWN pipeline outcomes. A close rate needs enough closed history to
  // be evidence rather than noise; below the threshold it is honestly absent.
  // A deal whose stage is not in `stages` is NOT counted as open — matching deriveSalesCommand,
  // so a phantom stage can never inflate the opportunity/close evidence the model gates on.
  const stageTypeOf = (d) => { const s = stages.find((x) => x.id === d.stageId); return s ? s.stageType : null; };
  const won = deals.filter((d) => stageTypeOf(d) === "won").length;
  const lost = deals.filter((d) => stageTypeOf(d) === "lost").length;
  const closed = won + lost;
  const closeEvidence = closed >= 3 ? Math.round((100 * won) / closed) : null;
  const openCount = deals.filter((d) => stageTypeOf(d) === "open").length;
  const oppsEvidence = openCount > 0 ? openCount : null;

  const digits = minorUnitDigits(currency);
  const proposedMajor = proposed.trim() === "" ? null : Number(proposed);
  const proposedMinor = proposedMajor != null && Number.isFinite(proposedMajor) && proposedMajor >= 0
    ? Math.round(proposedMajor * 10 ** digits) : null;

  const model = deriveScenario({
    currentPriceMinor,
    proposedPriceMinor: proposedMinor,
    currency,
    closeRatePct: closeEvidence != null ? closeEvidence : (closeAssume.trim() === "" ? null : Number(closeAssume)),
    closeRateFromEvidence: closeEvidence != null,
    opportunities: oppsEvidence != null ? oppsEvidence : (oppsAssume.trim() === "" ? null : Number(oppsAssume)),
    opportunitiesFromEvidence: oppsEvidence != null,
  });

  const askTest = () => onAskPaige(
    `Prepare the smallest safe test of moving ${chosen?.name || "this offer"} from ${money(currentPriceMinor, currency) ?? "its current price"} to ${proposedMinor != null ? money(proposedMinor, currency) : "a proposed price"}. Draft the pitch for the next few qualified leads and track the close rate against ${closeEvidence != null ? `the ${closeEvidence}% my pipeline shows` : "my assumption"}. Do not change the live Catalog price, any deal, or any campaign.`,
  );

  return (
    <div className="so-lab">
      <div className="so-band so-lab-inputs">
        <div className="so-band-head"><h3>Scenario inputs</h3></div>
        <label className="so-labf"><span>Offer <EcChip e="contracted" /></span>
          <select value={offerId || (chosen?.id || "")} onChange={(e) => setOfferId(e.target.value)}>
            {offerList.length === 0 ? <option value="">No offers recorded</option> : offerList.map((o) => <option key={o.id} value={o.id}>{o.name || "Untitled offer"}</option>)}
          </select>
          <small className="so-labhint">{lead ? `Current price ${money(currentPriceMinor, currency) ?? "—"} · from Catalog` : "This offer has no recorded price"}</small>
        </label>
        <label className="so-labf"><span>Proposed price <EcChip e="modeled" /></span>
          <input inputMode="decimal" value={proposed} placeholder="Owner-entered" onChange={(e) => setProposed(e.target.value)} />
        </label>
        <label className="so-labf"><span>Delivery capacity <EcChip e="modeled" /></span>
          <select value={capacity} onChange={(e) => setCapacity(e.target.value)}><option>Limited</option><option>Comfortable</option><option>Open</option></select>
        </label>
        <div className="so-labf"><span>Observed close rate {closeEvidence != null ? <EcChip e="dated" /> : <EcChip e="unknown" />}</span>
          {closeEvidence != null
            ? <p className="so-labfixed mono">{closeEvidence}%<small className="so-labhint"> · from {closed} closed deals in your pipeline</small></p>
            : <><input inputMode="decimal" value={closeAssume} placeholder="No history — enter an assumption" onChange={(e) => setCloseAssume(e.target.value)} /><small className="so-labhint">No close-rate evidence yet</small></>}
        </div>
        <div className="so-labf"><span>Opportunities {oppsEvidence != null ? <EcChip e="open" /> : <EcChip e="unknown" />}</span>
          {oppsEvidence != null
            ? <p className="so-labfixed mono">{oppsEvidence}<small className="so-labhint"> · open in your pipeline</small></p>
            : <><input inputMode="numeric" value={oppsAssume} placeholder="Enter an assumption" onChange={(e) => setOppsAssume(e.target.value)} /><small className="so-labhint">No real opportunity count</small></>}
        </div>
        <label className="so-labf"><span>Time period <EcChip e="modeled" /></span>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}><option>Next quarter</option><option>Next 2 quarters</option><option>Next 12 months</option></select>
        </label>
      </div>

      <div className="so-lab-right">
        {!model.hasEvidence && <p className="so-banner so-banner-warn"><Ic.shield size={15} /><span><b>No historical evidence yet.</b> With no closed-deal history, the Evidence-supported path can't be computed — enter your own assumptions to model Conservative and Stretch, clearly marked as assumptions.</span></p>}
        <div className="so-lab-paths">
          {model.paths.map((p) => (
            <div key={p.key} className={`so-path${p.key === "evidence" ? " so-path-evi" : ""}`}>
              <div className="so-path-h"><b>{p.label}</b>{p.evidence === "modeled" ? <EcChip e="modeled" /> : <EcChip e="unknown" />}</div>
              <div className={`so-path-big${p.outcomeMinor == null ? " so-pv-dash" : " mono"}`}>{p.outcomeMinor == null ? "—" : money(p.outcomeMinor, currency)}</div>
              <div className="so-labhint">{p.note}</div>
              <div className="so-path-li"><span>Price</span><span className="mono">{proposedMinor != null ? money(proposedMinor, currency) : "—"}</span></div>
              <div className="so-path-li"><span>Close rate</span><span className="mono">{p.closeRatePct != null ? `${p.closeRatePct}%` : "—"}</span></div>
              <div className="so-path-li"><span>Opportunities</span><span className="mono">{p.opportunities != null ? p.opportunities : "—"}</span></div>
            </div>
          ))}
        </div>
        <div className="so-lab-reason">
          <div className="so-reason"><h4>What would need to be true</h4><ul><li>Price rises without dropping close rate below {closeEvidence != null ? `about ${Math.max(0, closeEvidence - 4)}%` : "your assumed rate"}.</li><li>{capacity.toLowerCase()} capacity absorbs the new load.</li><li>Enough qualified opportunities in the window.</li></ul></div>
          <div className="so-reason"><h4>What supports it</h4><ul>{closeEvidence != null ? <><li>{closed} closed deals inform the {closeEvidence}% close rate.</li><li>{openCount} open in the pipeline now.</li></> : <li className="so-quiet">No closed-deal history yet — results rest on your assumptions.</li>}<li>The current price is source-backed from Catalog.</li></ul></div>
          <div className="so-reason"><h4>What could invalidate it</h4><ul><li>Close rate drops as price rises.</li><li>Fewer opportunities than assumed.</li><li>Capacity limits fulfilment.</li></ul></div>
          <div className="so-reason"><h4>Smallest safe test Paige can prepare</h4><ul><li>Offer the new price to the next few qualified leads and compare close rate.</li><li>Paige drafts the pitch and tracks the result — no live price change.</li></ul></div>
        </div>
        <p className="so-banner so-banner-info"><Ic.shield size={15} /><span><b>This is a model.</b> Saving it as a planning artifact or linking it to a Business Mission is not available yet — no scenario or mission store exists. It never changes a live price, offer, deal, campaign, or payment.</span>
          <span className="so-lab-act"><button className="btn btn-s" disabled title="Not available yet — no scenario store">Save scenario</button><button className="btn btn-s btn-p" onClick={askTest}>Ask Paige to prepare the test</button></span></p>
      </div>
    </div>
  );
}

export function SalesOps({ setDetail, deals = [], dealsPhase = "ready", stages = [], submissions = [], submissionsPhase = "ready", submissionsRetry, onOpenCatalog, onOpenClients, onOpenPipeline, truth }) {
  const sales = useSoloSalesOps();
  const agreements = useSoloCommercialTerms();
  const signings = useSoloAgreementSignings();
  // §60 — the feature DECLARES its tiers in the one home and this reads the answer, never an inline
  // `account_type` compare. The Growth hub around this surface already requires `growth`, so this
  // gate is the capability's own declaration rather than its only defence; it is here so that
  // changing who gets documents is a one-line edit in `tierFeatures.ts` and not a hunt.
  const { has: hasTierFeature } = useTierFeatures();
  const canSign = hasTierFeature("growth");
  const [termSearch, setTermSearch] = React.useState("");
  const [termStatus, setTermStatus] = React.useState("all");
  const [termPage, setTermPage] = React.useState(0);
  // The catalog read the WHOLE surface shares: the terms table's offer-name lookup, the command
  // derivation, the Scenario Lab and Revenue. The search and paging that used to drive it belonged
  // to a band that no longer exists — the picker inside the agreement editor runs its own instance
  // with its own search, which is where choosing an offer actually happens.
  const offers = useCatalogOffers({ search: "", page: 0, pageSize: 5, referenceIds: agreements.agreements.map((a) => a.offerId) });
  const [editor, setEditor] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [sending, setSending] = React.useState(null);
  const [completed, setCompleted] = React.useState(null);
  const [success, setSuccess] = React.useState("");
  const location = useLocation();
  const navigate = useNavigate();
  // The Sales-internal view lives in a Sales-local `?view=` param — deep-linkable and testable,
  // and it never touches the shell's `useSubtabRoute` growth-subtab registry. `command` is the bare
  // default, so the desk opens on the operating view with no query.
  const rawView = new URLSearchParams(location.search).get("view");
  const view = SALES_VIEWS.some(([id]) => id === rawView) ? rawView : "command";
  const setView = React.useCallback((next) => {
    const q = new URLSearchParams(location.search);
    if (next === "command") q.delete("view"); else q.set("view", next);
    q.delete("resume");
    const search = q.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "" });
  }, [navigate, location.pathname, location.search]);
  React.useEffect(() => {
    if (new URLSearchParams(location.search).get("resume") === "terms" && agreements.phase === "ready" && offers.phase === "ready") {
      setEditor("agreement");
      // Land on Commercial Terms so the editor opens over its own view, and strip the one-shot param.
      const q = new URLSearchParams(location.search);
      q.delete("resume"); q.set("view", "terms");
      navigate({ pathname: location.pathname, search: `?${q.toString()}` }, { replace: true });
    }
  }, [location.search, agreements.phase, offers.phase, navigate, location.pathname]);

  // A workspace switch clears anything half-typed. Without this, a draft opened against one
  // workspace stays on screen under the next one. Both tenant ids are watched because each hook
  // guards its own synchronously, and the agreements drawer holds the more sensitive draft — a
  // client name bound to a negotiated amount.
  React.useEffect(() => { setEditor(null); setEditing(null); setSending(null); setCompleted(null); setSuccess(""); setTermSearch(""); setTermStatus("all"); setTermPage(0); }, [sales.tenantId, agreements.tenantId, signings.tenantId]);

  // Hooks must run in the same order while the production adapters advance from loading to ready.
  // Keeping this memo above every phase return prevents React from aborting the Sales route on the
  // first successful read. The memo remains null until both commercial sources are ready.
  const commercialReady = agreements.phase === "ready" && offers.phase === "ready";
  const commercialError = agreements.phase === "error" || offers.phase === "error";
  const model = React.useMemo(() => (commercialReady ? deriveSalesCommand({
    agreements: agreements.agreements,
    clients: agreements.clients,
    offers: offers.offers,
    referencedOffers: offers.referencedOffers,
    orders: sales.orders,
    ordersReadable: sales.ordersReadable,
    deals,
    stages,
    processor: sales.processor,
    processorUnrecognised: sales.processorUnrecognised,
  }) : null), [commercialReady, agreements.agreements, agreements.clients, offers.offers, offers.referencedOffers, sales.orders, sales.ordersReadable, deals, stages, sales.processor, sales.processorUnrecognised]);

  if (sales.phase === "resolving") {
    return (
      <div className="campaigns-state" role="status">
        <span className="campaigns-spinner" />
        Resolving this account’s Campaigns workspace…
      </div>
    );
  }
  if (sales.phase === "loading") {
    return (
      <div className="campaigns-skeleton" role="status" aria-label="Loading sales operations">
        <span /><span /><span />
      </div>
    );
  }
  if (sales.phase === "unavailable") {
    return (
      <div className="campaigns-state">
        
        <h2>Sales needs a resolved workspace</h2>
        <p>No tenant data is read until your account context is confirmed.</p>
      </div>
    );
  }
  if (sales.phase === "error") {
    return (
      <div className="campaigns-state" role="alert">
        
        <h2>Sales operations could not load</h2>
        <p>Your records were not changed. Try loading this again.</p>
        <button className="btn btn-s" onClick={sales.retry}><Ic.arrow size={13} />Retry</button>
      </div>
    );
  }

  // The DOCUMENT half of the desk, keyed to the commercial half it commits.
  //
  // `signings` arrives newest-first, so the first match is the current document for that agreement —
  // a re-issued or replaced one is the later row and wins, which is what somebody reading the
  // Signature column expects to see.
  const signingsReadable = signings.phase === "ready" && signings.readable;
  const signingFor = (agreementId) =>
    signings.signings.find((row) => row.agreementId === agreementId) || null;

  // ONE BAND, TWO RECORDS. A signing may carry no agreement at all (owner ruling 3, 2026-09-22):
  // an NDA or a scope letter names no offer and states no price. Building this list as a column
  // bolted onto the agreements table would have made those documents invisible — so the rows are
  // the UNION, and a document standing on its own is a row in its own right.
  const termRows = [
    ...agreements.agreements.map((row) => ({
      id: `agreement-${row.id}`, contactId: row.contactId, agreement: row, signing: signingFor(row.id),
    })),
    ...signings.signings.filter((row) => !row.agreementId).map((row) => ({
      id: `signing-${row.id}`, contactId: row.contactId, agreement: null, signing: row,
    })),
  ];
  const matchingTerms = termRows.filter((row) => {
    const client = agreements.clients.find((c) => c.id === row.contactId);
    // The filter names the ENGAGEMENT's state, so a document with no engagement matches only
    // "All". Sweeping it into "Draft" would put it under a word its record does not hold.
    // Signature, per the approved filter — `row.signing.displayState` rather than the engagement's
    // own `agreement.status`. A row with no document at all answers only "any".
    return (termStatus === "all" || row.signing?.displayState === termStatus)
      && (client?.name || "").toLowerCase().includes(termSearch.trim().toLowerCase());
  });
  const shownTerms = matchingTerms.slice(termPage * 5, termPage * 5 + 5);
  const processorState = sales.processorUnrecognised ? "unknown" : sales.processor === null ? "none" : sales.processor === "not_yet" ? "warn" : "ok";

  // The detail drawer `GrowthHub` already mounts (§18 — no second drawer). It shows the pair the
  // whole snapshot exists for: what this client agreed, beside what the catalog listed when it was
  // recorded. Labelled so the two can never be mistaken for each other, and dated, because a
  // snapshot without its date is not evidence.
  /** What the document says was agreed, in one sentence, for the send step. */
  const agreedLabelFor = (row) => !row ? null
    : row.agreedAmountMinor === null
      ? (row.priceBasis === "quote_pending" ? "Still to be quoted" : "No amount recorded")
      : `${money(row.agreedAmountMinor, row.agreedCurrency) ?? "No amount recorded"}${
          row.termKind === "recurring" && row.billingInterval
            ? ` · ${CADENCE_LABEL[row.billingInterval] || row.billingInterval}`
            : ""}`;

  /** Open the send step for a document, from wherever it was reached. */
  const openSender = (signing, contactId, agreement) => {
    setDetail(null);
    setSending({ ...signing, contactId, agreedLabel: agreedLabelFor(agreement) });
  };

  /** The document's own rows in the shared drawer. A record with no document says so plainly
   * rather than leaving the reader to infer it from an absence. */
  const signingRows = (signing) => !signing ? [
    ["Document", signingsReadable
      ? "None on this record"
      : signings.phase === "error" ? "Not readable — your documents could not be read" : "Not readable here"],
  ] : [
    ["Document", signing.documentTitle],
    ["Signature", (SIGNATURE_STATE[signing.displayState] || SIGNATURE_STATE.unrecognised).label],
    ["Sent", signing.sentAt ? when(signing.sentAt) : "Not sent"],
    ["Opened", signing.viewedAt ? when(signing.viewedAt) : "Not opened"],
    ["Signed", signing.completedAt
      ? `${when(signing.completedAt)}${signing.signerName ? ` · ${signing.signerName}` : ""}`
      : "Not signed"],
    ...(signing.declinedAt ? [["Declined", `${when(signing.declinedAt)}${signing.declineReason ? ` · ${signing.declineReason}` : ""}`]] : []),
    ...(signing.voidedAt ? [["Stopped", when(signing.voidedAt)]] : []),
    ["Link works until", signing.expiresAt ? when(signing.expiresAt) : "No link has been issued"],
  ];

  /**
   * Fetch the sealed copy and hand it to the browser.
   *
   * A stored path is not an address — the bucket is private — so this asks for a short-lived
   * signed URL first and only opens something once the server has returned one (§13: a link is a
   * link when it exists, not when it was requested).
   */
  const openSignedCopy = async (signing) => {
    setSuccess("");
    const result = await signings.signedCopyUrl(signing.id, signings.tenantId);
    if (!result.ok) { setSuccess(result.message); return; }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  /**
   * The acts a document offers, given the state it is actually in.
   *
   * A COMPLETED document is not actionless, and an earlier revision of this treated it as one:
   * it offered nothing at all, so an owner could see that a client had signed and had no way to
   * obtain the thing they signed. That is the §70 failure exactly — the gate is a person
   * finishing the job, and "the row says Completed" is not finishing it.
   *
   * Retrieving the copy is a READ, so it is NOT gated on `canManage`: a member who is permitted
   * to see the record is permitted to see the document, and the storage policy is what actually
   * decides. Sending and managing the link are writes and stay gated.
   *
   * A declined or unrecognised document still offers nothing, because there genuinely is nothing
   * to do to it — and a control that pretends otherwise is the dead end §70 refuses.
   */
  const signingAction = (signing, contactId, agreement) => {
    if (!canSign || !signing) return null;
    const state = signing.displayState;
    if (state === "completed") {
      // §13: the state says signed, so the sealed copy should exist. If the record does not carry
      // one, say that plainly rather than rendering a button that cannot do anything.
      // setDetail(null) first, the way openSender does: leaving the grounded-detail drawer open
      // underneath stacks two modal dialogs, and the one a screen reader lands in is then an
      // accident of DOM order rather than the one just opened.
      return (
        <button className="btn btn-p" onClick={() => { setDetail(null); setCompleted({ ...signing, contactId }); }}>
          <Ic.doc size={13} />View the signed record
        </button>
      );
    }
    if (!signings.canManage) return null;
    if (state === "declined" || state === "unrecognised") return null;
    return (
      <button className="btn btn-p" onClick={() => openSender(signing, contactId, agreement)}>
        <Ic.send size={13} />{state === "draft" ? "Send for signature" : "Manage the link"}
      </button>
    );
  };

  /** A document that stands on its own — no offer, no price (owner ruling 3). It gets the same
   * drawer, minus the commercial rows it genuinely does not have. */
  const openSigning = (signing, client) => setDetail({
    title: client?.name || "Signed document",
    actions: signingAction(signing, signing.contactId, null),
    rows: [
      ...signingRows(signing),
      ["Offer", "None — this document names no offer"],
      ["They agreed to pay", "No amount is stated on this document"],
    ],
    note: "A document with no commercial terms attached — an NDA or a scope letter looks like this. "
      + "It records agreement, not money: nothing here is an invoice, a charge, or a payment record.",
  });

  const openAgreement = (row, client, offer, signing) => setDetail({
    title: client?.name || "Client terms",
    actions: (
      <>
        {signingAction(signing, row.contactId, row)}
        {agreements.canManage ? <button className="btn btn-p" onClick={() => { setDetail(null); setEditing(row); setEditor("agreement"); }}>Edit commercial terms</button> : null}
      </>
    ),
    rows: [
      ["Offer", offer?.name || "Not readable here"],
      // The ENGAGEMENT's state, kept here rather than in the table's Signature column, because the
      // two answer different questions and the owner ruled they stay apart (2026-09-22).
      ["Engagement", (AGREEMENT_STATE[row.status] || AGREEMENT_STATE.unrecognised).label],
      ...signingRows(signing),
      ["Arrangement", TERM_LABEL[row.termKind] || "Not stated"],
      ["They agreed to pay", row.agreedAmountMinor === null
        ? (row.priceBasis === "quote_pending" ? "Still to be quoted" : "Not stated")
        : money(row.agreedAmountMinor, row.agreedCurrency) ?? "Not stated"],
      ["Catalog listed, when recorded", row.catalogSnapshotMinor === null
        ? "No catalog plan was chosen"
        : `${money(row.catalogSnapshotMinor, row.catalogSnapshotCurrency) ?? "Not stated"}${
            row.catalogSnapshotAt ? ` · ${when(row.catalogSnapshotAt)}` : ""}`],
      ["How often", row.termKind === "recurring" && row.billingInterval
        ? (CADENCE_LABEL[row.billingInterval] || row.billingInterval)
        : row.termKind === "installment" && row.installmentsTotal
          ? `${row.installmentsTotal} instalments`
          : "Not applicable"],
      ["Starts", row.startsOn ? when(row.startsOn, true) : "Not stated"],
      ["Renews", row.termKind === "recurring" ? (row.renewsOn ? when(row.renewsOn, true) : "Not stated") : "Not applicable"],
      ["Ends", row.endsOn ? when(row.endsOn, true) : "Not stated"],
      ["Notes", row.notes || "None recorded"],
    ],
    note: "What this client agreed to. It is not an invoice, a charge, or a payment record — the "
      + "catalog figure is a dated snapshot of what the offer listed at the time, and changing "
      + "the offer's price never changes it.",
  });

  /* The offer DETAIL drawer that used to live here was removed with its band (owner ruling,
   * 2026-09-22). Catalog owns the offer record and is one click away from the band head; the one
   * thing this surface genuinely needed from it — what an offer costs, while you are attaching it
   * to somebody's agreement — travels with the name in the editor's picker instead (§58: the
   * capability moved, it was not dropped). */


  // Route a move / open-work / ladder target to the REAL surface. No dead ends (§70).
  const go = (target) => {
    if (!target) return;
    switch (target.kind) {
      case "view": setView(target.view); break;
      case "catalog": if (onOpenCatalog) onOpenCatalog(); break;
      case "pipeline": if (onOpenPipeline) onOpenPipeline(); else if (onOpenCatalog) onOpenCatalog(); break;
      case "clients": if (onOpenClients) onOpenClients(); break;
      case "payment": setEditor("payment"); break;
      case "paige": window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt: target.prompt } })); break;
      default: break;
    }
  };
  const askPaige = (prompt) => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt } }));

  // The operating brief, DERIVED from real records — never a hardcoded sentence.
  const brief = (() => {
    if (!model) return "Reading your commercial records…";
    const f = model.facts; const parts = [];
    if (!f.paymentReady && f.activeTermCount > 0) parts.push(`${f.activeTermCount} active term${f.activeTermCount === 1 ? "" : "s"} awaiting a payment path`);
    if (f.proposedTermCount > 0) parts.push(`${f.proposedTermCount} proposed to confirm`);
    if (f.renewalsSoonCount > 0) parts.push(`${f.renewalsSoonCount} renewing soon`);
    if (parts.length === 0) return f.activeTermCount > 0 ? "Your commercial desk is up to date." : "Record what a client agreed to pay to start your desk.";
    const s = parts.join(" · ");
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
  })();
  // Recorded capture references only — never a sale, revenue, or attribution. Shown as a foldout.
  const routed = (submissions || []).filter((row) => row.contactId || row.dealId);
  // Active terms with a dated renewal/end inside the 60-day window — a real dated read for Revenue.
  const nowMs = Date.now();
  const renewalRows = agreements.agreements.filter((row) => {
    if (row.status !== "active") return false;
    const raw = row.renewsOn || row.endsOn; const t = raw ? Date.parse(raw) : NaN;
    return !Number.isNaN(t) && t >= nowMs && t <= nowMs + 60 * 86400000;
  });

  const contractedCurrency = model?.facts.contractedCurrency || "usd";

  return (
    <div className="so">
      {success && <div className="so-success" role="status">{success}<button className="btn btn-p" onClick={() => onOpenCatalog()}>Continue setup in Catalog</button></div>}
      {editor === "payment" && sales.canManage ? <PaymentEditor data={sales} onClose={() => setEditor(null)} /> : null}
      {editor === "offer" && offers.canManage ? (
        <QuickOffer
          offers={offers}
          tenantId={offers.tenantId}
          onClose={() => setEditor(null)}
          onCreated={(_id, warning) => { setEditor(null); setSuccess(warning ? "Your Catalog draft was created. Review its price and finish setup in Catalog." : "Your Catalog draft was created. Finish product or service setup in Catalog."); }}
        />
      ) : null}
      {editor === "agreement" && agreements.canManage ? (
        <AgreementEditor
          agreements={agreements}
          signings={signings}
          offers={offers}
          tenantId={agreements.tenantId}
          existing={editing}
          existingSigning={editing ? signingFor(editing.id) : null}
          canSign={canSign && signings.canManage}
          onOpenClients={onOpenClients}
          onOpenCatalog={onOpenCatalog}
          onQuickOffer={() => { setEditing(null); setEditor("offer"); }}
          onSigningCreated={(created) => {
            setEditor(null);
            setEditing(null);
            // Straight into the send step, carrying the client it is for so nobody has to
            // re-identify the person they just chose.
            setSending({ ...created, displayState: created.signatureState || "draft" });
          }}
          onClose={() => { setEditor(null); setEditing(null); }}
        />
      ) : null}
      {sending ? (
        <SignatureSender
          signings={signings}
          signing={sending}
          tenantId={signings.tenantId}
          clientName={agreements.clients.find((c) => c.id === sending.contactId)?.name || ""}
          agreedLabel={sending.agreedLabel}
          onClose={() => setSending(null)}
        />
      ) : null}
      {completed ? (
        <AgreementCompletion
          signings={signings}
          signing={completed}
          tenantId={signings.tenantId}
          clientName={agreements.clients.find((c) => c.id === completed.contactId)?.name || ""}
          onClose={() => setCompleted(null)}
          onOpenClients={onOpenClients}
        />
      ) : null}

      <SubNav view={view} setView={setView} />
      <div id="sales-view-panel" role="tabpanel" aria-labelledby={`sales-view-${view}`} className="so-view">

      {view === "command" && (
        <div className="so-cmd">
          <header className="so-cmd-head">
            <div className="so-cmd-lead">
              <div className="so-cmd-eyebrow"><span className="so-eyebrow">Sales Command</span></div>
              <h2>Turn agreed value into received value.</h2>
              <p className="so-cmd-brief">{brief}</p>
            </div>
            <div className="so-cmd-act">
              <button className="btn" onClick={() => askPaige("Give me a plain-English read of my commercial readiness right now — what is agreed, what is awaiting a payment path, what is renewing, and the single next move. Use only my recorded terms, pipeline and payment handling; never invent revenue or attribution.")}><Ic.spark size={14} />Ask Paige</button>
              {agreements.canManage && <button className="btn btn-p" onClick={() => { setEditing(null); setEditor("agreement"); }}><Ic.doc size={14} />Record commercial terms</button>}
            </div>
          </header>

          {commercialError ? (
            <p className="so-absent" role="alert">Your commercial records could not be read, so this is unknown rather than empty. Nothing was changed. <button className="btn btn-s" onClick={() => { agreements.retry(); offers.retry(); }}><Ic.arrow size={13} />Retry</button></p>
          ) : !model ? (
            <div className="campaigns-skeleton" role="status" aria-label="Reading commercial records"><span /><span /><span /></div>
          ) : (<>
            <div className="so-pulse" aria-label="Commercial pulse">
              {model.pulse.map((t) => (
                <div className="so-pl" key={t.key}>
                  <div className="so-pl-top"><span className={`so-pl-ic so-pl-ic-${t.key}`}><MoveIcon name={t.key === "received" ? "card" : t.key === "open" ? "target" : t.key === "renewals" ? "refresh" : "doc"} /></span><span className="so-pl-lab">{t.label}</span></div>
                  <PulseValue tile={t} />
                  <div className="so-pl-sub">{t.sub}</div>
                  <div className="so-pl-meta"><EcChip e={t.evidence} /><span className="so-src">Source: <b>{t.sourceLabel}</b></span></div>
                </div>
              ))}
            </div>

            <div className="so-2col">
              {/* The readiness ladder is a reference OVERVIEW — the secondary section. At a wide column
                * it is the full desk; at a narrow (PAIGE-expanded) column it collapses to a disclosure
                * by default so the pulse, next moves, open work and primary actions stay above the fold.
                * Wide vs narrow is decided by the .so-view container width, not the window, so the
                * default state is right whether or not PAIGE is docked. */}
              <details className="so-fold so-ladder-fold">
              <summary className="so-ladder-toggle">Commercial Readiness Ladder <span className="so-quiet">— show stages</span></summary>
              <section className="so-band so-ladder-band">
                <div className="so-band-head"><h3>Commercial Readiness Ladder</h3><small>Every state shows a real record or an honest gap — drawn from pipeline, recorded terms and payment handling. Deals and terms aren’t linked yet, so this is a readiness overview, not one deal’s journey.</small></div>
                <div className="so-ladder">
                  {model.ladder.map((col) => (
                    <div className="so-lad-col" key={col.n}>
                      <div className="so-lad-hd">
                        <span className={`so-lad-n so-lad-n-${col.status}`}>{col.n}</span>
                        <b>{col.name}</b><small>{col.sub}</small>
                        <span className={`so-lad-st so-lad-st-${col.status}`}>{col.status === "live" ? "Live" : col.status === "part" ? "Partial" : "No source"}</span>
                      </div>
                      <div className="so-lad-body">
                        {col.tenantLevel ? (
                          <div className={`so-lad-tenant ${col.tenantLevel.ready ? "is-ready" : "is-missing"}`}>
                            <Pill tone={col.tenantLevel.ready ? "ok" : "warn"}>{col.tenantLevel.ready ? "Ready" : "Not set up"}</Pill>
                            <p>{col.emptyNote}</p>
                            {!col.tenantLevel.ready && agreements.canManage ? <button className="btn btn-s" onClick={() => setEditor("payment")}>Record payment handling</button> : null}
                          </div>
                        ) : col.status === "unavailable" || col.items.length === 0 ? (
                          <p className="so-lad-empty">{col.emptyNote}</p>
                        ) : (<>
                          {col.items.slice(0, 4).map((item) => (
                            <button className="so-lad-card" key={item.id} onClick={() => go(item.target)}>
                              <b>{item.client}</b>{item.offer && <span className="so-lad-co">{item.offer}</span>}
                              {item.flag && <span className={`so-lad-flag so-lad-flag-${item.flag.tone}`}><span className="dot" />{item.flag.label}</span>}
                            </button>
                          ))}
                          {col.items.length > 4 && <button className="so-lad-more" onClick={() => go(col.items[0].target)}>+{col.items.length - 4} more</button>}
                        </>)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              </details>

              <div className="so-cmd-side">
                <section className="so-band">
                  <div className="so-band-head"><h3>Top Commercial Moves</h3></div>
                  {model.moves.length === 0 ? (
                    <p className="so-absent">No commercial move needs you right now. New proposals, renewals and payment gaps will surface here.</p>
                  ) : (
                    <div className="so-moves">
                      {model.moves.map((m) => (
                        <button className="so-move" key={m.id} onClick={() => go(m.target)}>
                          <span className="so-move-ic"><MoveIcon name={m.icon} /></span>
                          <span className="so-move-t"><b>{m.title}</b><small>{m.detail}</small></span>
                          <span className="so-move-r"><span className="so-move-who">{m.who}</span><span className="so-src">{m.sourceLabel}</span></span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="so-band">
                  <div className="so-band-head"><h3>Open Commercial Work</h3>{model.openWork.length > 5 ? <button className="btn btn-s" onClick={() => setView("terms")}>View all</button> : null}</div>
                  {model.openWork.length === 0 ? (
                    <p className="so-absent">No open commercial work. Recorded terms and open deals that need a next step appear here.</p>
                  ) : (
                    <div className="so-owt">
                      {model.openWork.slice(0, 5).map((r) => (
                        <button className="so-owt-row" key={r.id} onClick={() => go(r.target)}>
                          <span className="so-owt-cli"><span className="so-owt-av">{r.initials}</span><b>{r.client}</b></span>
                          <span className="so-owt-off">{r.offer || "—"}</span>
                          <span><Pill tone={r.stateTone}>{r.stateLabel}</Pill></span>
                          <span className="so-owt-go"><Ic.chev size={14} /></span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>

            {/* Routed captures moved here from the wrapper (§58): the read stays phase-aware — a
              * failed or unresolved snapshot read is UNKNOWN, never an empty "no activity". */}
            <details className="so-fold so-form-activity" open={submissionsPhase === "error" || submissionsPhase === "unavailable"}><summary>Recorded captures — references only (never a sale)</summary>
              {submissionsPhase === "resolving" ? (
                <div className="campaigns-state" role="status"><span className="campaigns-spinner" />Resolving this account’s Campaigns workspace…</div>
              ) : submissionsPhase === "loading" ? (
                <div className="campaigns-skeleton" role="status" aria-label="Loading routed capture activity"><span /><span /><span /></div>
              ) : submissionsPhase === "unavailable" ? (
                <div className="campaigns-state"><h2>Campaigns needs a resolved workspace</h2><p>No tenant data is read until your account context is confirmed.</p></div>
              ) : submissionsPhase === "error" ? (
                <div className="campaigns-state" role="alert"><h2>Campaigns could not load</h2><p>Your records were not changed. Try the tenant-scoped read again.</p>{submissionsRetry && <button className="btn btn-s" onClick={submissionsRetry}><Ic.arrow size={13} />Retry</button>}</div>
              ) : routed.length === 0 ? (
                <p className="so-absent">No routed form activity. Recorded contact and deal references only — never estimated revenue or campaign attribution; a submission is not a sale.</p>
              ) : (
                <div className="campaigns-list">{routed.map((row) => (
                  <button className="campaigns-list-row" key={row.id} onClick={() => setDetail({ title: "Captured activity", rows: [["Source", row.source], ["Recorded", when(row.createdAt)], ["Contact reference", row.contactId ? "Recorded" : "Not recorded"], ["Deal reference", row.dealId ? "Recorded" : "Not recorded"]], note: "No monetary value or campaign attribution is inferred." })}><span><strong>{row.source}</strong><small>{when(row.createdAt)}</small></span><span className="campaigns-row-end">Recorded <Ic.chev size={14} /></span></button>
                ))}</div>
              )}
            </details>
          </>)}
        </div>
      )}

      {view === "scenarios" && (
        commercialError ? <p className="so-absent" role="alert">Your commercial records could not be read. <button className="btn btn-s" onClick={() => { offers.retry(); }}><Ic.arrow size={13} />Retry</button></p>
        : offers.phase !== "ready" ? <div className="campaigns-skeleton" role="status" aria-label="Loading scenarios"><span /><span /><span /></div>
        : <ScenarioLab offers={offers} deals={deals} stages={stages} onAskPaige={askPaige} />
      )}

      {view === "terms" && (<>
      {/* ── ONE BAND: what each client agreed, and the document they signed to agree it ─────
        * There were two bands here. The second browsed the Catalog beside a table that had
        * nothing to do with browsing, and the owner removed it (2026-09-22). Its capabilities did
        * not go with it: the offer search, its paging and its price reading moved INTO the
        * agreement editor, where an offer is actually being chosen, and Open Catalog is in this
        * band head. */}
      <section className="so-band so-terms">
        <div className="so-band-head">
          {/* THE APPROVED HEAD, in the approved order. Every element below is the prototype's
            * (claude.ai/artifact/S271qc7uGTFXbdNoTz49VC, screen 1 "Commercial Terms", §28):
            * title, the record count as a dotted violet pill, a spacer, Open Catalog as a QUIET
            * borderless act, then the primary. An earlier pass shipped this with the acts on the
            * right, the count in green, the primary labelled "Record terms" and the orientation
            * line moved to its own row below — none of which is what was approved. */}
          <h3>Agreements and terms</h3>
          {agreements.phase === "ready" && agreements.agreementsReadable && termRows.length > 0 && (
            <span className="so-count"><span className="so-count-dot" aria-hidden="true" />{termRows.length === 1 ? "1 record" : `${termRows.length} records`}</span>
          )}
          <span className="so-sp" />
          {/* §58 — this act came off the band that was deleted. Catalog owns the offer record, and
            * this is the one place on the desk that needs to say so. Quiet, per the approved head:
            * it is a way OUT of this band, not one of its acts. */}
          {onOpenCatalog ? (
            <button className="btn btn-s btn-q" onClick={() => onOpenCatalog()}>Open Catalog</button>
          ) : null}
          {agreements.canManage
            ? <button className="btn btn-s btn-p" onClick={() => { setEditing(null); setEditor("agreement"); }}>New agreement</button>
            : agreements.phase === "ready" && agreements.agreementsReadable
              // A reader who cannot write is told WHO may — never a silently missing button (§36/§70).
              ? <span className="so-quiet">An owner or admin records this.</span>
              : null}
          {/* The two states, said apart, because the owner ruled they ARE apart (2026-09-22) and a
            * reader who assumes one word covers both will misread the column. §38 statement #1 of
            * exactly two on this band. It sits INSIDE the head, to the right of the acts, which is
            * what `flex:1 0 100%` with a 74ch cap produces — the approved layout exactly. */}
          <small>
            What each client agreed to, and the document they signed to agree it. This column tracks
            the <b>signature</b>; whether the engagement is running, paused or finished is a
            separate state that starts once it is signed. Sending an agreement bills nobody and
            charges nothing.
          </small>
        </div>

        {agreements.agreementsReadable && termRows.length > 0 && <div className="so-filters">
          <label className="so-search"><span>Find a client</span><input type="search" value={termSearch} placeholder="Search client name…" onChange={(e) => { setTermSearch(e.target.value); setTermPage(0); }} /></label>
          <label className="so-search"><span>Signature</span><select aria-label="Signature state" value={termStatus} onChange={(e) => { setTermStatus(e.target.value); setTermPage(0); }}><option value="all">Any signature state</option>{Object.entries(SIGNATURE_STATE).filter(([key]) => key !== "none" && key !== "unrecognised").map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
          <small className="so-filters-note">Searches the latest {termRows.length} loaded records (up to 200).</small>
        </div>}
        {["loading", "resolving"].includes(agreements.phase) ? <p role="status">Loading commercial terms…</p> : agreements.phase === "error" ? (
          <p className="so-absent">
            Your client terms could not be read, so this is unknown rather than empty. Nothing was
            changed.{" "}
            <button className="btn btn-s" onClick={agreements.retry}>
              <Ic.arrow size={13} />Retry
            </button>
          </p>
        ) : agreements.phase === "unavailable" ? <p className="so-absent">Client terms need a resolved workspace.</p> : agreements.authorityUnknown ? <p className="so-absent" role="alert">Your access could not be confirmed. <button className="btn btn-s" onClick={agreements.retry}>Retry access</button></p> : !agreements.agreementsReadable && agreements.agreements.length === 0 ? (
          <p className="so-absent">
            Client terms are not readable at your access level. That is different from there being
            none, so nothing is shown rather than an empty list that would read as zero.
          </p>
        ) : termRows.length === 0 && signings.phase === "error" ? (
          // BEFORE the empty copy, deliberately. Every branch below this one is keyed on
          // `agreements.*` alone, so a healthy-and-empty client-terms read used to reach the
          // "Nothing recorded yet" copy even when the DOCUMENT read had failed outright. An
          // agreement with no offer and no price (owner ruling 3 — an NDA, a scope letter) has no
          // commercial row at all and lives only in that record, so exactly the rows this band
          // could not see are the ones it was telling the owner did not exist.
          <p className="so-absent" role="alert">
            Your client terms read fine and none are recorded — but your documents could not be
            read, so this is unknown rather than empty. An agreement that carries no price lives
            only in that record, and one may be there.{" "}
            <button className="btn btn-s" onClick={signings.retry}><Ic.arrow size={13} />Retry documents</button>
          </p>
        ) : termRows.length === 0 ? (
          // A COMPOSED first-use state, not a grey sentence in an empty frame. The band used to
          // render one paragraph and leave the rest of the viewport blank, which reads as a page
          // that failed to load rather than one waiting to be used. The prerequisite is still named
          // plainly and still points at the surface that fixes it — never a control that does
          // nothing (§70.1) — but the ACT is the thing the eye lands on.
          <div className="so-blank">
            <span className="so-blank-mark" aria-hidden="true"><Ic.doc size={22} /></span>
            <h4>{agreements.clients.length === 0 ? "Add a client first" : "Nothing agreed yet"}</h4>
            <p>
              {agreements.clients.length === 0
                ? "Terms attach a client to what they agreed to pay. No clients are recorded in this workspace yet."
                : (offers.phase === "ready" && offers.offers.length === 0)
                  ? "Write down what a client agreed to pay, or send them a document to sign. Recording terms opens with a quick offer inside it, so nothing has to exist in your catalog first."
                  : "Write down what a client agreed to pay, or send them a document to sign. An agreement can carry no price at all — an NDA or a scope letter is a row of its own."}
            </p>
            {agreements.clients.length === 0
              ? (onOpenClients ? <div className="so-blank-acts"><button className="btn btn-p" onClick={() => onOpenClients()}>Go to Clients <Ic.arrow size={13} /></button></div> : null)
              : agreements.canManage ? (
                <div className="so-blank-acts">
                  <button className="btn btn-p" onClick={() => { setEditing(null); setEditor("agreement"); }}>New agreement</button>
                  {onOpenCatalog ? <button className="btn btn-s" onClick={() => onOpenCatalog()}>Open Catalog <Ic.arrow size={12} /></button> : null}
                </div>
              ) : null}
          </div>
        ) : (
          <div className="so-table" role="table" aria-label="Agreements and terms">
            <div className="so-tr so-th so-tr-5" role="row">
              <span role="columnheader">Client</span>
              <span role="columnheader">Document</span>
              <span role="columnheader">Signature</span>
              <span role="columnheader">Agreed</span>
              <span role="columnheader">Terms</span>
            </div>
            {shownTerms.map((entry) => {
              const row = entry.agreement;
              const signing = entry.signing;
              const state = row ? (AGREEMENT_STATE[row.status] || AGREEMENT_STATE.unrecognised) : null;
              const client = agreements.clients.find((c) => c.id === entry.contactId);
              const offer = row ? [...offers.offers, ...(offers.referencedOffers || [])].find((o) => o.id === row.offerId) : null;
              // "No document" is a claim about the record, so it is only made when the record was
              // actually readable. Otherwise the cell says it could not look (§13).
              const signatureState = signing ? signing.displayState
                : signingsReadable ? "none"
                : "unrecognised";
              return (
                <button
                  className="so-tr so-tr-5 so-row"
                  role="row"
                  key={entry.id}
                  onClick={() => row
                    ? openAgreement(row, client, offer, signing)
                    : openSigning(signing, client)}
                >
                  <span role="cell" className="so-cell-name">
                    {/* A client the caller cannot read is NAMED as unreadable, never blanked into
                      * an em-dash that would read as "no client". */}
                    {client?.name || (agreements.clientsReadable ? "Not recorded" : "Not readable here")}
                  </span>
                  <span role="cell" className="so-doc" data-none={signing ? undefined : "1"}>
                    <Ic.doc size={14} />
                    <span>{signing ? signing.documentTitle : signingsReadable ? "No document — terms only" : "Not readable"}</span>
                  </span>
                  <span role="cell"><SignaturePill state={signatureState} /></span>
                  <span role="cell" className="so-num">
                    {!row ? "—"
                      : row.agreedAmountMinor === null
                        ? (row.priceBasis === "quote_pending" ? "To be quoted" : "—")
                        : money(row.agreedAmountMinor, row.agreedCurrency) ?? "—"}
                  </span>
                  <span role="cell" className="so-quiet">
                    {!row ? "No offer or price on this document" : (<>
                      {(TERM_LABEL[row.termKind] || "Not stated")}
                      {row.termKind === "recurring" && row.billingInterval
                        ? ` · ${CADENCE_LABEL[row.billingInterval] || row.billingInterval}`
                        : ""}
                      {row.termKind === "installment" && row.installmentsTotal
                        ? ` · ${row.installmentsTotal}×`
                        : ""}
                      {/* The engagement's own state rides here rather than taking the Signature
                        * column, so nothing that shipped stopped being visible at a glance (§58). */}
                      <span className="so-engage"> · {state.label}</span>
                    </>)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {termRows.length > 0 && agreements.agreementsReadable && <div className="so-page-controls"><span>{matchingTerms.length === 0 ? "No matching terms" : "Page " + (termPage + 1) + " · " + matchingTerms.length + " matching loaded records"}</span><button className="btn btn-s" disabled={termPage === 0} onClick={() => setTermPage((p) => p - 1)}>Previous</button><button className="btn btn-s" disabled={(termPage + 1) * 5 >= matchingTerms.length} onClick={() => setTermPage((p) => p + 1)}>Next</button></div>}
        {signings.phase === "error" && <p className="so-absent" role="alert">Your documents could not be read, so the Signature column is unknown rather than empty. Your commercial terms above are unaffected. <button className="btn btn-s" onClick={signings.retry}><Ic.arrow size={13} />Retry documents</button></p>}
      </section>
      </>)}

      {view === "revenue" && (<>
      <div className="so-band-head so-rev-lead"><h3>Revenue &amp; Collections</h3><small>A sales-facing commercial view — not a payment processor. Paige never holds this money; it reaches you directly. Nothing here is charged, collected, or settled.</small></div>
      <div className="so-rev-top">
        <section className="so-band so-rev-card">
          <div className="so-band-head"><h3>Actual received</h3><EcChip e="unknown" /></div>
          <div className="so-rev-empty">
            <p className="so-absent">{sales.processor === null ? "You haven’t recorded how your clients pay you." : "Payment handling is recorded, but no verified receipts are imported — Paige doesn’t connect your processor or move money."} Actual received stays empty until a real source proves it.</p>
            {sales.canManage && <button className="btn btn-s btn-p" onClick={() => setEditor("payment")}>{sales.processor === null ? "Record payment handling" : "Change payment handling"}</button>}
          </div>
        </section>
        <section className="so-band so-rev-card">
          <div className="so-band-head"><h3>Contracted value on record</h3><EcChip e="contracted" /></div>
          {!model ? <div className="campaigns-skeleton" role="status"><span /></div> : (<>
            <div className="so-rev-figure"><span className="so-num mono">{model.facts.contractedOnceMinor > 0 ? (money(model.facts.contractedOnceMinor, contractedCurrency) ?? "—") : "—"}</span><span className="so-rev-fnote">{model.facts.activeTermCount === 0 ? "No active terms recorded" : model.facts.contractedOnceMinor > 0 ? "One-time on active terms" : "No one-time value — recurring shown monthly"}</span></div>
            <div className="so-rev-facts">
              <span><b className="mono">{model.facts.contractedMrrMinor > 0 ? (money(model.facts.contractedMrrMinor, contractedCurrency) ?? "—") : "—"}</b>/mo recurring</span>
              <span><b className="mono">{model.facts.activeTermCount}</b> active {model.facts.activeTermCount === 1 ? "term" : "terms"}</span>
              {model.facts.mixedCurrency && <span className="so-quiet">+ other currencies, not summed</span>}
            </div>
            <p className="so-src">Source: <b>Recorded terms</b> · recurring shown monthly, never annualized</p>
          </>)}
        </section>
      </div>

      <section className="so-band">
        <div className="so-band-head"><h3>Renewals &amp; expiring terms</h3><EcChip e="dated" /></div>
        {renewalRows.length === 0 ? (
          <p className="so-absent">No active terms renew or end in the next 60 days. This is a real read of your recorded renewal and end dates — never an invented reminder.</p>
        ) : (
          <div className="so-table" role="table" aria-label="Renewals and expiring terms">
            {renewalRows.map((row) => {
              const client = agreements.clients.find((c) => c.id === row.contactId);
              const raw = row.renewsOn || row.endsOn;
              const days = Math.max(0, Math.round((Date.parse(raw) - nowMs) / 86400000));
              return (
                <div className="so-tr so-tr-4" role="row" key={row.id}>
                  <span role="cell" className="so-cell-name">{client?.name || (agreements.clientsReadable ? "Not recorded" : "Not readable here")}</span>
                  <span role="cell" className="so-quiet">{row.renewsOn ? "Renews" : "Ends"} {when(raw, true)}</span>
                  <span role="cell"><Pill tone={days <= 30 ? "warn" : "opportunity"}>{days}d</Pill></span>
                  <span role="cell"><button className="btn btn-s" onClick={() => askPaige(`Prepare a renewal note for ${client?.name || "this client"} — their terms ${row.renewsOn ? "renew" : "end"} ${when(raw, true)}. Review the value delivered from my records; do not send anything.`)}>Prepare with Paige</button></span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="so-band so-payment"><div className="so-band-head"><h3>Payment handling</h3><small>Records how you accept payment. No processor connection or money collection.</small></div>
        <ReadyRow
          state={processorState}
          label="How your clients pay you"
          detail={
            sales.processorUnrecognised
              ? "Something is recorded that this version cannot read."
              : sales.processor === null
                ? "Not recorded yet. Paige never holds this money — it reaches you directly."
                : sales.processor === "not_yet"
                  ? "Recorded as nothing yet."
                  : `${PROCESSOR_LABEL[sales.processor]}${sales.methods.length
                      ? ` · ${sales.methods.map((m) => METHOD_LABEL[m]).join(", ")}`
                      : " · no methods recorded"}`
          }
          action={sales.canManage ? (
            // `btn-p`, not `btn-g`. Gold is the act (§11) and `btn-g` is the Solo shell's gold
            // button — but its own pair, `--gold` on `--gold-tint`, measures 2.72:1 in light mode,
            // far under AA, and this render pass caught it the moment these buttons took it. A
            // primary action nobody can read is the opposite of what "more vibrant" asked for, so
            // the acts take the shell's violet primary (white on `--violet`, ~7:1) instead. The
            // gold-button measurement is reported to CD rather than fixed here — `.btn-g` is a
            // shared primitive and the sibling Catalog tab ships it on "New offer" today.
            <button className="btn btn-s btn-p" onClick={() => setEditor("payment")}>
              {sales.processor === null ? "Record it" : "Change"}
            </button>
          ) : (
            <small className="so-quiet">
              {sales.authorityUnknown
                ? "Whether you can change this could not be read."
                : "An owner or admin records this."}
            </small>
          )}
        />

      </section>
      {/* ── commercial activity ───────────────────────────────────────────────────────────── */}
      <section className="so-band">
        <div className="so-band-head">
          <h3>Commercial activity</h3>
          <small>Recorded payments only. Nothing here is a forecast, a total, or campaign attribution.</small>
        </div>

        {!sales.ordersReadable ? (
          <p className="so-absent">
            Commercial activity is not readable at your access level. That is different from there
            being none, so nothing is shown rather than an empty list that would read as zero.
          </p>
        ) : sales.orders.length === 0 ? (
          <p className="so-absent">
            No payment records are available here. This surface does not connect your processor or import payments.
          </p>
        ) : (
          <details className="so-activity"><summary>View {sales.orders.length} recent payment records</summary><div className="so-table" role="table" aria-label="Commercial activity">
            <div className="so-tr so-th so-tr-4" role="row">
              <span role="columnheader">Who</span>
              <span role="columnheader">State</span>
              <span role="columnheader">Amount</span>
              <span role="columnheader">Recorded</span>
            </div>
            {sales.orders.map((order) => {
              const state = ORDER_STATUS[order.status] || ORDER_STATUS.unrecognised;
              return (
                <div className="so-tr so-tr-4" role="row" key={order.id}>
                  <span role="cell" className="so-cell-name">
                    {order.customerName || order.customerEmail || "Not recorded"}
                  </span>
                  <span role="cell"><Pill tone={state.tone}>{state.label}</Pill></span>
                  <span role="cell" className={`so-num so-num--${state.tone}`}>
                    {money(order.amountTotal, order.currency) ?? "—"}
                  </span>
                  <span role="cell" className="so-quiet">{when(order.createdAt)}</span>
                </div>
              );
            })}
          </div></details>
        )}
      </section>
      </>)}

      </div>
    </div>
  );
}

export default SalesOps;
