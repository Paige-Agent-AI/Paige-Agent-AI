/**
 * /app/billing/:invoiceId — one invoice the business issued to its customer (E09 Slice 5, "Payments").
 *
 * The frozen invoice document, as the business issued it, plus a payment panel that says plainly where
 * the invoice stands: what is owed, whether the business has sent a payment link, and if so a single
 * gold "Pay" that opens that exact link in a new tab. When no link has been sent, the customer can ask
 * for one in their conversation with the business; nothing here creates a payment request (§38).
 *
 * Every read re-resolves the customer relationship on the server (§9). The document comes from the
 * shared invoice renderer through the scoped document function, the payment state from the read-only
 * payment-request projection, parsed by the one existing parser. The page never names a processor.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Check, ExternalLink, FileDown, FlaskConical, Loader2, MessageSquare, Printer, ReceiptText, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  INVOICE_DISPLAY_LABEL,
  invoiceDateLabel,
  invoiceDisplayState,
  invoiceInstantLabel,
  liveProviderMinor,
  paymentLinkRequestHref,
  readPortalInvoicePayment,
  useClientPortalInvoices,
  type PortalInvoice,
  type PortalPaymentRead,
} from "@/hooks/useClientPortalInvoices";
import { useClientPortalBrand } from "@/hooks/useClientPortalBrand";
import { customerPaymentRequestCopy, formatPaymentMinor, type CustomerPaymentRequest } from "@/solo/sales/customerPaymentRequest";
import { downloadInvoicePdf, readInvoicePdf } from "@/solo/sales/invoicePdf";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const QUIET_HOVER = "hover:bg-muted hover:text-foreground";
const LINK_BUTTON = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium ${QUIET_HOVER} ${FOCUS}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Request states where a fresh link from the business is the way forward. */
const ASK_AGAIN = new Set(["expired", "failed", "cancelled", "customer_action_required"]);
/** Request states where money may be moving and the balance updates on its own once confirmed. A
 *  "settled" request has already been allocated, so with money still owed it is a paid part payment. */
const IN_FLIGHT = new Set(["provider_accepted", "outcome_unknown"]);

/** The scoped document function, called as the signed-in customer. The server derives the client. */
function documentUrl(invoiceId: string, tenantId: string, format?: "pdf") {
  const params = new URLSearchParams({ portal: "1", invoice_id: invoiceId, tenant_id: tenantId });
  if (format) params.set("format", format);
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-invoice-document?${params}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("SIGNED_OUT");
  return { Authorization: `Bearer ${data.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
}

type PaymentView =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error" }
  | PortalPaymentRead;

/**
 * Who settled it, without naming a processor: the provider confirmed money that moved, or the business
 * recorded it. Test-mode receipts are not money that moved, so they never count as "confirmed".
 */
function paidBy(invoice: PortalInvoice, businessName: string): string {
  const provider = liveProviderMinor(invoice) > 0, recorded = invoice.manual_recorded_minor > 0;
  if (provider && recorded) return `Confirmed by ${businessName}'s payment provider and recorded by ${businessName}.`;
  if (provider) return `Confirmed by ${businessName}'s payment provider.`;
  if (recorded) return `Recorded by ${businessName}.`;
  return `${businessName} shows nothing owed on this invoice.`;
}

/** Why there is no link to pay from, without assuming which processor the business uses (§38). */
function noLinkCopy(request: CustomerPaymentRequest, businessName: string, nowMs: number): string {
  if (request.state !== "customer_action_required") return customerPaymentRequestCopy(request.state);
  // The link the business sent ran out: that is known, so say it.
  if (request.expiresAt !== null && request.expiresAt <= nowMs) return customerPaymentRequestCopy("expired");
  // Otherwise the request carries no link this page can open: another processor, a link for a different
  // amount, or one whose merchant account changed. None of those is the customer's to diagnose.
  return `${businessName} hasn't sent a link you can pay from here.`;
}

function AskForLink({ invoice, businessName }: { invoice: PortalInvoice; businessName: string }) {
  return (
    <Link to={paymentLinkRequestHref(invoice.invoice_number)} data-testid="ask-payment-link" className={LINK_BUTTON}>
      <MessageSquare aria-hidden="true" className="h-4 w-4" /> Ask {businessName} for a payment link
    </Link>
  );
}

function PaymentPanel({ invoice, payment, businessName, onRetry, checking }: {
  invoice: PortalInvoice; payment: PaymentView; businessName: string; onRetry: () => void; checking: boolean;
}) {
  const display = invoiceDisplayState(invoice);
  const ready = payment.state === "ready" ? payment : null;
  const remaining = ready ? ready.remainingMinor : invoice.remaining_minor;
  const testMinor = Math.max(invoice.test_provider_minor, ready?.testProviderMinor ?? 0);
  const request = ready?.request ?? null;
  const settledByTest = display !== "voided" && remaining === 0 && testMinor > 0;
  // Payment moves only between the customer and the business's processor; in test mode, it doesn't move.
  const testMode = ready?.environment === "test";
  // A paid part payment made in test mode already says, in its own words, that it moved no money.
  const testPartSettled = remaining > 0 && request?.state === "settled" && testMode;
  const caution = testMinor > 0 && !settledByTest && !testPartSettled && (
    <p data-testid="test-caution" className="text-sm text-muted-foreground">
      Includes a test payment of {formatPaymentMinor(testMinor, invoice.currency)}. The test payment moved no money.
    </p>
  );

  let body: ReactNode;
  if (display === "voided") {
    body = (
      <p data-testid="payment-void" className="text-base font-semibold">This invoice was voided. Nothing is owed.</p>
    );
  } else if (payment.state === "unavailable") {
    // The list showed it as owed a moment ago; the read now refuses (access changed, or it is no longer
    // issued to this customer). Say only what is known; the list is re-read underneath.
    body = (
      <p data-testid="payment-unavailable" className="text-base font-semibold">This invoice isn't available to pay here right now.</p>
    );
  } else if (settledByTest) {
    const real = liveProviderMinor(invoice) > 0 || invoice.manual_recorded_minor > 0;
    body = (
      <div data-testid="payment-test-settled" className="space-y-1">
        <p className="text-xl font-semibold tracking-tight [text-wrap:balance]">
          {real ? "Settled, partly by a test payment." : "Settled by a test payment. No money moved."}
        </p>
        {real && <p className="text-sm text-muted-foreground">{paidBy(invoice, businessName)} The test payment moved no money.</p>}
      </div>
    );
  } else if (remaining === 0) {
    body = (
      <div data-testid="payment-paid" className="space-y-1">
        <p className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-success" /> Paid in full
        </p>
        <p className="text-sm text-muted-foreground">{paidBy(invoice, businessName)}</p>
      </div>
    );
  } else {
    const owed = formatPaymentMinor(remaining, invoice.currency);
    body = (
      <div className="space-y-3">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span data-testid="payment-owed" className="text-xl font-semibold tracking-tight tabular-nums">{owed} due</span>
          {remaining < invoice.amount_minor && (
            <span className="text-sm text-muted-foreground tabular-nums">of {formatPaymentMinor(invoice.amount_minor, invoice.currency)}</span>
          )}
        </p>
        {payment.state === "loading" || payment.state === "idle" ? (
          <div role="status" data-testid="payment-checking" className="space-y-2">
            <span className="sr-only">Checking for a payment link…</span>
            <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
            <Skeleton className="h-11 w-40 motion-reduce:animate-none" />
          </div>
        ) : payment.state === "error" ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <p className="inline-flex items-center gap-2"><AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" /> We couldn't check for a payment link.</p>
            <Button size="sm" variant="outline" className={QUIET_HOVER} onClick={onRetry}>Try again</Button>
          </div>
        ) : request?.url ? (
          <div data-testid="payment-payable" className="space-y-2">
            {(request.amountMinor !== remaining || request.currency !== invoice.currency) && (
              <p className="text-sm">{businessName} has requested a payment of <span className="font-semibold tabular-nums">{formatPaymentMinor(request.amountMinor, request.currency)}</span>.</p>
            )}
            {testMode && (
              <p data-testid="test-link" className="flex items-center gap-1.5 text-sm font-medium">
                <FlaskConical aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />Test link: no money will move
              </p>
            )}
            <a
              href={request.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="pay-now"
              className={cn(buttonVariants({ variant: "gold" }), "min-h-[44px] px-6 motion-reduce:hover:translate-y-0", FOCUS)}
            >
              Pay {formatPaymentMinor(request.amountMinor, request.currency)}
              <ExternalLink aria-hidden="true" className="ml-1.5 h-4 w-4" />
            </a>
            <p className="text-sm text-muted-foreground">
              Opens {businessName}'s secure payment page in a new tab. Your balance here updates once the payment is confirmed.
            </p>
          </div>
        ) : request?.state === "settled" ? (
          // The business asked for part of the balance and that payment landed; the rest is still owed.
          <div data-testid="payment-part-settled" className="space-y-2">
            <p className="text-sm font-medium">
              {testMode
                ? <>Your test payment of <span className="tabular-nums">{formatPaymentMinor(request.amountMinor, request.currency)}</span> went through. The test payment moved no money.</>
                : <>Your payment of <span className="tabular-nums">{formatPaymentMinor(request.amountMinor, request.currency)}</span> was confirmed.</>}
            </p>
            <p className="text-sm">{businessName} hasn't sent a link for the rest yet.</p>
            <AskForLink invoice={invoice} businessName={businessName} />
          </div>
        ) : request ? (
          <div data-testid="payment-request-state" className="space-y-2">
            <p className="text-sm font-medium">
              {noLinkCopy(request, businessName, Date.now())}
            </p>
            {testMode && IN_FLIGHT.has(request.state) && (
              <p data-testid="test-request" className="flex items-center gap-1.5 text-sm font-medium">
                <FlaskConical aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />Test payment: no money will move
              </p>
            )}
            {IN_FLIGHT.has(request.state) && <p className="text-sm text-muted-foreground">Your balance here updates once the payment is confirmed.</p>}
            {ASK_AGAIN.has(request.state) && <AskForLink invoice={invoice} businessName={businessName} />}
          </div>
        ) : (
          <div data-testid="payment-no-link" className="space-y-2">
            <p className="text-sm">{businessName} hasn't sent a payment link for this invoice.</p>
            <AskForLink invoice={invoice} businessName={businessName} />
          </div>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby="payment-heading" data-testid="payment-panel" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="payment-heading" className="text-sm font-semibold text-muted-foreground">Payment</h2>
        {invoice.status === "issued" && remaining > 0 && (payment.state === "ready") && (
          <Button size="sm" variant="ghost" className={QUIET_HOVER} disabled={checking} onClick={onRetry}>
            <RotateCw aria-hidden="true" className={`mr-1.5 h-3.5 w-3.5 ${checking ? "animate-spin motion-reduce:animate-none" : ""}`} /> Check again
          </Button>
        )}
      </div>
      {body}
      {caution}
    </section>
  );
}

export default function BillingInvoice() {
  const { invoiceId = "" } = useParams();
  const validId = UUID.test(invoiceId);
  const list = useClientPortalInvoices();
  const brand = useClientPortalBrand();
  const businessName = list.businessName ?? (brand?.tenant_name?.trim() || "your business");
  const invoice = useMemo(() => list.invoices.find((i) => i.id === invoiceId) ?? null, [list.invoices, invoiceId]);
  const nowMs = Date.now();

  // An invoice past the first page is found by reading on, page by page, never by guessing.
  const { loaded, hasMore, loadingMore, error: listError, loadMore } = list;
  useEffect(() => {
    if (validId && !invoice && loaded && hasMore && !loadingMore && !listError) void loadMore();
  }, [validId, invoice, loaded, hasMore, loadingMore, listError, loadMore]);
  const notFound = !validId || (list.loaded && !invoice && !list.hasMore);

  const tenantId = list.tenantId;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // The payment link, read-only, for an issued invoice with something owed.
  const [payment, setPayment] = useState<PaymentView>({ state: "idle" });
  const [checking, setChecking] = useState(false);
  const paymentSeq = useRef(0);
  const needsPayment = !!invoice && invoice.status === "issued" && invoice.remaining_minor > 0;
  const readPayment = useCallback(async (quiet = false) => {
    if (!invoice || !tenantId) return;
    const seq = ++paymentSeq.current;
    if (!quiet) setPayment({ state: "loading" });
    setChecking(true);
    try {
      const next = await readPortalInvoicePayment({ invoiceId: invoice.id, tenantId });
      if (alive.current && seq === paymentSeq.current) setPayment(next);
    } catch {
      if (alive.current && seq === paymentSeq.current) setPayment({ state: "error" });
    } finally {
      if (alive.current && seq === paymentSeq.current) setChecking(false);
    }
  }, [invoice, tenantId]);
  const paymentKey = invoice ? `${invoice.id}:${invoice.remaining_minor}:${invoice.payable}:${invoice.status}` : "";
  useEffect(() => {
    if (!needsPayment) { paymentSeq.current += 1; setPayment({ state: "idle" }); setChecking(false); return; }
    void readPayment();
    // Re-read when the invoice's own balance or link flag changes (the list refreshes on focus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentKey, needsPayment, tenantId]);
  // Coming back from the business's payment page: check again without blanking what is shown.
  useEffect(() => {
    if (!needsPayment) return;
    const again = () => { if (document.visibilityState !== "hidden") void readPayment(true); };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); };
  }, [needsPayment, readPayment]);
  // A refusal for an invoice the list still shows as owed means the list is behind: re-read it, once per
  // refusal. It then drops the invoice (not theirs any more) or shows where it now stands (voided, paid).
  const { refresh: refreshList } = list;
  useEffect(() => {
    if (payment.state === "unavailable") void refreshList();
  }, [payment.state, refreshList]);
  // A link stops being offered the moment it expires, even with the page left open.
  const expiresAt = payment.state === "ready" && payment.request?.url ? payment.request.expiresAt : null;
  useEffect(() => {
    if (expiresAt === null) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const left = expiresAt - Date.now();
      if (left <= 0) setPayment((p) => (p.state === "ready" && p.request ? { ...p, request: { ...p.request, url: null } } : p));
      else timer = setTimeout(check, Math.min(left, 2_147_483_647));
    };
    check();
    return () => clearTimeout(timer);
  }, [expiresAt]);

  // The frozen document, as the business issued it.
  const [html, setHtml] = useState<string | null>(null);
  const [docError, setDocError] = useState(false);
  const [docAttempt, setDocAttempt] = useState(0);
  const docFor = invoice && tenantId ? `${tenantId}:${invoice.id}` : null;
  useEffect(() => {
    if (!docFor || !invoice || !tenantId) return;
    const controller = new AbortController();
    setHtml(null);
    setDocError(false);
    void (async () => {
      try {
        const response = await fetch(documentUrl(invoice.id, tenantId), {
          headers: await authHeaders(), signal: controller.signal, cache: "no-store", referrerPolicy: "no-referrer",
        });
        if (!response.ok || !response.headers.get("content-type")?.startsWith("text/html")) throw new Error("UNAVAILABLE");
        const text = await response.text();
        if (!controller.signal.aborted) setHtml(text);
      } catch {
        if (!controller.signal.aborted) setDocError(true);
      }
    })();
    return () => controller.abort();
    // The document is frozen at issue; it re-reads only for another invoice or an explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docFor, docAttempt]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState(900);
  const fit = useCallback(() => {
    const doc = frame.current?.contentDocument;
    const h = doc?.documentElement?.scrollHeight;
    if (h && Number.isFinite(h)) setFrameHeight(Math.min(Math.max(h, 320), 12_000));
  }, []);
  useEffect(() => {
    if (!html) return;
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [html, fit]);

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfNotice, setPdfNotice] = useState("");
  const pdf = async (print: boolean) => {
    if (!invoice || !tenantId || pdfBusy) return;
    const popup = print ? window.open("about:blank", "_blank") : null;
    if (popup) popup.opener = null;
    setPdfBusy(true);
    setPdfNotice("");
    try {
      const blob = await readInvoicePdf(documentUrl(invoice.id, tenantId, "pdf"), await authHeaders());
      if (!alive.current) { popup?.close(); return; }
      if (print) {
        if (!popup) throw new Error("POPUP_BLOCKED");
        const url = URL.createObjectURL(blob);
        popup.location.replace(url);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        downloadInvoicePdf(blob, invoice.invoice_number ?? "document");
      }
    } catch {
      popup?.close();
      if (alive.current) setPdfNotice("The PDF couldn't be opened. Try again, or allow the PDF window to open.");
    } finally {
      if (alive.current) setPdfBusy(false);
    }
  };

  const title = invoice?.invoice_number ? `Invoice ${invoice.invoice_number}` : "Invoice";
  const blocked = list.unavailable || list.multipleBusinesses;
  const waiting = !notFound && !invoice && !blocked && (!list.loaded || list.hasMore) && !list.error;
  const display = invoice ? invoiceDisplayState(invoice) : null;

  return (
    <section aria-labelledby="invoice-title" aria-busy={waiting} className="mx-auto max-w-3xl [&_button]:min-h-[44px]">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <Link to="/app/billing" className={`-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground ${QUIET_HOVER} ${FOCUS}`}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Payments
        </Link>
        {invoice && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className={QUIET_HOVER} disabled={!html || pdfBusy} onClick={() => void pdf(true)}>
              <Printer aria-hidden="true" className="mr-1.5 h-4 w-4" /> Open PDF / print
            </Button>
            <Button variant="outline" size="sm" className={QUIET_HOVER} disabled={!html || pdfBusy} onClick={() => void pdf(false)}>
              <FileDown aria-hidden="true" className="mr-1.5 h-4 w-4" /> Download PDF
            </Button>
          </div>
        )}
      </div>
      {pdfBusy && <p role="status" className="pb-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="mr-1.5 inline h-4 w-4 animate-spin align-[-0.2em] motion-reduce:animate-none" />Preparing the PDF…</p>}
      {pdfNotice && <p role="alert" className="pb-2 text-sm">{pdfNotice}</p>}

      <header className="space-y-1 pb-4">
        <h1 id="invoice-title" className="text-2xl font-semibold tracking-tight">{notFound || blocked ? "Invoice" : title}</h1>
        {invoice && display && (
          // Each date stays whole, "from" stays with the business name, and pretty wrapping keeps the name from
          // leaving one word on a line of its own at phone width; a long name can still wrap, so nothing overflows.
          <p data-testid="invoice-subline" className="text-sm text-muted-foreground [text-wrap:pretty]">
            <span data-testid="invoice-state" className="whitespace-nowrap font-medium text-foreground">
              {display === "past_due" && <AlertCircle aria-hidden="true" className="mr-1 inline-block h-3.5 w-3.5 align-[-0.125em] text-destructive" />}
              {INVOICE_DISPLAY_LABEL[display]}
            </span>
            {" · "}<span className="whitespace-nowrap">Issued <time dateTime={invoice.issued_at}>{invoiceInstantLabel(invoice.issued_at, nowMs)}</time></span>
            {invoice.due_date && display !== "voided" && <> · <span className="whitespace-nowrap">Due <time dateTime={invoice.due_date}>{invoiceDateLabel(invoice.due_date, nowMs)}</time></span></>}
            {" · "}from{"\u00a0"}{businessName}
          </p>
        )}
      </header>

      {list.error && !blocked && !invoice && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 px-4 py-3 text-sm">
          <p className="inline-flex items-center gap-2"><AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" /> {list.error}</p>
          <Button size="sm" variant="outline" className={QUIET_HOVER} onClick={() => void list.refresh()}>Try again</Button>
        </div>
      )}

      {blocked || notFound ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={ReceiptText}
            title={blocked ? "Payments isn't available on this account" : "This invoice isn't available"}
            description={blocked
              ? "Invoices from your business show here once your account is connected to one business."
              : `It may have been replaced, or it isn't one ${businessName} sent to you. Your invoices are listed in Payments.`}
            action={<Link to="/app/billing" className={LINK_BUTTON}><ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to Payments</Link>}
            className="py-10"
          />
        </div>
      ) : waiting ? (
        <div role="status" data-testid="invoice-skeleton" className="space-y-4">
          <span className="sr-only">Opening the invoice…</span>
          <Skeleton className="h-28 w-full rounded-xl motion-reduce:animate-none" />
          <Skeleton className="h-96 w-full rounded-xl motion-reduce:animate-none" />
        </div>
      ) : invoice ? (
        <div className="space-y-4">
          <PaymentPanel invoice={invoice} payment={payment} businessName={businessName} checking={checking} onRetry={() => void readPayment(payment.state === "ready")} />
          <section aria-label="Invoice document" className="overflow-hidden rounded-xl border border-border bg-card">
            {docError ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm">
                <p className="inline-flex items-center gap-2"><AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" /> We couldn't open the invoice document.</p>
                <Button size="sm" variant="outline" className={QUIET_HOVER} onClick={() => setDocAttempt((n) => n + 1)}>Try again</Button>
              </div>
            ) : html ? (
              <iframe
                ref={frame}
                title={`${title} document`}
                sandbox="allow-same-origin allow-modals"
                srcDoc={html}
                onLoad={fit}
                style={{ height: frameHeight }}
                className="block w-full border-0"
              />
            ) : (
              <div role="status" data-testid="document-loading" className="p-4">
                <span className="sr-only">Opening the invoice document…</span>
                <Skeleton className="h-96 w-full motion-reduce:animate-none" />
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
