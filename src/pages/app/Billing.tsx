/**
 * /app/billing — "Payments": the invoices a business has issued to its customer (E09 Slice 5).
 *
 * Only invoices the business issued to this customer: open, past due, partly or fully paid, and voided
 * ones the customer may already hold. Never a draft, an imported record, another client's invoice, or
 * anything about how the business runs its books. The headline is what is owed, in a sentence; each
 * invoice opens its own page with the document and, when the business sent one, its payment link.
 *
 * Read-only by design. Nothing here starts a payment: the customer pays only through a link the business
 * sent, on the business's own payment provider (§38), and that link lives on the invoice's own page.
 * The page never names a payment processor.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, Check, Home, Loader2, MessageSquare, ReceiptText, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  INVOICE_DISPLAY_LABEL,
  invoiceDateLabel,
  invoiceDisplayState,
  invoiceInstantLabel,
  liveProviderMinor,
  owedPhrase,
  PAYMENTS_MESSAGE_HREF,
  useClientPortalInvoices,
  type PortalInvoice,
  type PortalInvoiceDisplay,
} from "@/hooks/useClientPortalInvoices";
import { useClientPortalBrandState } from "@/hooks/useClientPortalBrand";
import { formatPaymentMinor } from "@/solo/sales/customerPaymentRequest";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/**
 * The shared outline and ghost buttons hover-fill with --secondary, which is near-black in light theme
 * under a dark label. Every quiet control here hovers to muted with the label in foreground instead,
 * the same treatment as Sessions and Progress.
 */
const QUIET_HOVER = "hover:bg-muted hover:text-foreground";
const LINK_BUTTON = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium ${QUIET_HOVER} ${FOCUS}`;

const PILL_CLASS: Record<PortalInvoiceDisplay, string> = {
  open: "border-transparent bg-primary/10 text-foreground",
  partially_paid: "border-transparent bg-primary/10 text-foreground",
  past_due: "border-destructive/50 text-foreground",
  paid: "border-success/40 bg-success/10 text-foreground",
  // Nothing more is asked for, but no money moved: never the success treatment.
  test_settled: "border-border text-foreground",
  // A filled box like the others, so its edge meets the same right edge; muted, never a state colour.
  voided: "border-transparent bg-muted text-muted-foreground",
};

function StatusPill({ display }: { display: PortalInvoiceDisplay }) {
  return (
    <span
      data-testid="invoice-status"
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${PILL_CLASS[display]}`}
    >
      {display === "paid" && <Check aria-hidden="true" className="h-3 w-3 text-success" />}
      {display === "past_due" && <AlertCircle aria-hidden="true" className="h-3 w-3 text-destructive" />}
      {INVOICE_DISPLAY_LABEL[display]}
    </span>
  );
}

/** "Issued Oct 2 · Due Oct 16", in the viewer's zone for the issue moment and as written for the due date. */
function MetaLine({ invoice, nowMs }: { invoice: PortalInvoice; nowMs: number }) {
  const display = invoiceDisplayState(invoice);
  const issued = <>Issued <time dateTime={invoice.issued_at}>{invoiceInstantLabel(invoice.issued_at, nowMs)}</time></>;
  if (display === "voided") return <p className="mt-0.5 text-sm text-muted-foreground">{issued} · Nothing owed</p>;
  if (!invoice.due_date || invoice.remaining_minor === 0) return <p className="mt-0.5 text-sm text-muted-foreground">{issued}</p>;
  const due = <time dateTime={invoice.due_date}>{invoiceDateLabel(invoice.due_date, nowMs)}</time>;
  return (
    <p className="mt-0.5 text-sm text-muted-foreground">
      {issued} · {display === "past_due" ? <span data-testid="past-due" className="font-medium text-foreground">Was due {due}</span> : <>Due {due}</>}
    </p>
  );
}

/** One invoice: the whole row opens it. The right column says what is owed, then where it stands. */
function InvoiceRow({ invoice, nowMs }: { invoice: PortalInvoice; nowMs: number }) {
  const display = invoiceDisplayState(invoice);
  // Settled by real money and a test payment reads "Partially paid", but nothing more is owed on it.
  const owing = invoice.remaining_minor > 0 && (display === "open" || display === "past_due" || display === "partially_paid");
  const testNote = invoice.test_provider_minor > 0 && display !== "test_settled" && display !== "voided";
  const title = invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Invoice";
  return (
    <li>
      <Link
        to={`/app/billing/${invoice.id}`}
        data-testid="invoice-row"
        data-invoice-id={invoice.id}
        className={`flex min-h-[44px] items-start gap-4 px-4 py-3 ${QUIET_HOVER} ${FOCUS} focus-visible:ring-inset`}
      >
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold">{title}</p>
          <MetaLine invoice={invoice} nowMs={nowMs} />
          {invoice.payable && (
            <p data-testid="invoice-pay-ready" className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-foreground">
              Pay online <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <p className={`text-sm tabular-nums ${owing ? "font-semibold" : "text-muted-foreground"}`}>
            {owing ? <>{formatPaymentMinor(invoice.remaining_minor, invoice.currency)} <span className="font-normal text-muted-foreground">due</span></> : formatPaymentMinor(invoice.amount_minor, invoice.currency)}
          </p>
          {(display === "partially_paid" && owing) || (display === "past_due" && invoice.remaining_minor < invoice.amount_minor) ? (
            <p className="text-xs text-muted-foreground tabular-nums">of {formatPaymentMinor(invoice.amount_minor, invoice.currency)}</p>
          ) : null}
          <StatusPill display={display} />
          {testNote && <p data-testid="invoice-test-note" className="text-xs text-muted-foreground">Includes a test payment</p>}
        </div>
      </Link>
    </li>
  );
}

/** The first read: rows the size of real ones, so nothing jumps when they land. */
function PaymentsSkeleton() {
  return (
    <div role="status" data-testid="payments-skeleton" className="space-y-4">
      <span className="sr-only">Loading your invoices…</span>
      <Skeleton className="h-7 w-2/3 motion-reduce:animate-none" />
      <div className="rounded-xl border border-border bg-card">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4 border-b border-border px-4 py-3 last:border-b-0">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3 motion-reduce:animate-none" />
              <Skeleton className="h-4 w-1/2 motion-reduce:animate-none" />
            </div>
            <div className="flex flex-col items-end gap-2">
              <Skeleton className="h-4 w-20 motion-reduce:animate-none" />
              <Skeleton className="h-5 w-16 rounded-full motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One empty-state treatment for an empty list and for an account that cannot use the page. */
function PaymentsEmpty(props: { icon: LucideIcon; title: string; description: ReactNode; action: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <EmptyState icon={props.icon} title={props.title} description={<span className="[text-wrap:balance]">{props.description}</span>} action={props.action} className="py-10" />
    </div>
  );
}

function BackHome() {
  return (
    <Link to="/app" className={LINK_BUTTON}>
      <Home aria-hidden="true" className="h-4 w-4" /> Back to Home
    </Link>
  );
}

function MessageBusiness({ businessName }: { businessName: string }) {
  return (
    <Link to={PAYMENTS_MESSAGE_HREF} className={LINK_BUTTON}>
      <MessageSquare aria-hidden="true" className="h-4 w-4" /> Message {businessName}
    </Link>
  );
}

export default function Billing() {
  const invoices = useClientPortalInvoices();
  const brandState = useClientPortalBrandState();
  const brand = brandState.brand;
  // Only a viewer the brand read resolved as NOT linked to any business is told to sign in with the invited
  // email. A viewer the menu treats as a customer (brand resolved) whom the invoice read still refuses (same-
  // business staff or a platform owner linked as a client) gets a neutral line that claims no reason; so does
  // a viewer whose brand read is still loading or failed, since why they were refused is not known here.
  const notLinked = !brandState.loading && !brandState.error && !brand?.tenant_id && !brandState.multipleBusinesses;
  const businessName = invoices.businessName ?? (brand?.tenant_name?.trim() || "your business");
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Keep "this year" in step with each fresh read.
  useEffect(() => { setNowMs(Date.now()); }, [invoices.invoices]);

  const owed = useMemo(() => owedPhrase(invoices.balances), [invoices.balances]);
  const pastDue = invoices.pastDueCount;
  const testPayment = invoices.balances.some((b) => b.test_provider_minor > 0);
  // Nothing is owed and the only money "received" was test money: it was settled, but nothing moved.
  const settledByTest = !owed && testPayment
    && invoices.balances.every((b) => liveProviderMinor(b) + b.manual_recorded_minor === 0);

  const blocked = invoices.unavailable || invoices.multipleBusinesses;
  const firstLoad = invoices.loading && !invoices.loaded;
  const empty = invoices.loaded && invoices.invoiceCount === 0;
  const open = invoices.openCount;

  return (
    <section
      aria-labelledby="payments-title"
      aria-busy={invoices.loading}
      className="mx-auto max-w-2xl [&_button]:min-h-[44px]"
    >
      {/*
        The Sessions and Documents header: the page name, then what the page holds. What is owed follows as
        its own line, a clear step under the h1 (2xl over lg) so the title and the amount never read as one size.
      */}
      <header className="space-y-1 pb-4">
        <h1 id="payments-title" className="text-2xl font-semibold tracking-tight">Payments</h1>
        {!blocked && <p className="text-sm text-muted-foreground">Invoices {businessName} has sent you.</p>}
        {!blocked && invoices.loaded && !empty && (
          <div data-testid="payments-summary" className="pt-3">
            {owed ? (
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-lg font-semibold tabular-nums [text-wrap:balance]">
                  {owed} due{open > 0 ? ` across ${open} open invoice${open === 1 ? "" : "s"}` : ""}
                </span>
                {pastDue > 0 && !invoices.hasMore && (
                  <span data-testid="payments-past-due" className="inline-flex items-center gap-1 text-sm font-medium tabular-nums">
                    <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 self-center text-destructive" /> {pastDue} past due
                  </span>
                )}
              </p>
            ) : settledByTest ? (
              <p data-testid="payments-test-settled" className="text-lg font-semibold [text-wrap:balance]">
                Settled by a test payment. No money moved.
              </p>
            ) : (
              <p data-testid="payments-paid-up" className="inline-flex items-start gap-2 text-lg font-semibold [text-wrap:balance]">
                <Check aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-success" />
                You're all paid up with {businessName}.
              </p>
            )}
            {testPayment && !settledByTest && (
              <p data-testid="payments-test-caution" className="pt-1 text-sm text-muted-foreground">Includes a test payment. The test payment moved no money.</p>
            )}
          </div>
        )}
      </header>

      {invoices.error && !blocked && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 px-4 py-3 text-sm">
          <p className="inline-flex items-center gap-2">
            <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" /> {invoices.error}
          </p>
          <Button size="sm" variant="outline" className={QUIET_HOVER} onClick={() => void invoices.refresh()}>Try again</Button>
        </div>
      )}

      {invoices.multipleBusinesses ? (
        <PaymentsEmpty
          icon={ReceiptText}
          title="Payments for more than one business isn't available yet"
          description={(
            <>
              Your account is connected to more than one business. Payments here works with one business at a time for
              now. For help in the meantime, use{" "}
              <Link to="/app/support" className={`font-medium text-foreground underline underline-offset-4 ${FOCUS}`}>Support</Link>.
            </>
          )}
          action={<BackHome />}
        />
      ) : invoices.unavailable ? (
        <PaymentsEmpty
          icon={ReceiptText}
          title="Payments isn't available on this account"
          description={notLinked
            ? "Invoices from your business show here once your account is connected to it. Sign in with the email your business invited."
            : "Invoices can't be shown to this account in the client portal."}
          action={<BackHome />}
        />
      ) : firstLoad ? (
        <PaymentsSkeleton />
      ) : !invoices.loaded ? null : empty ? (
        <PaymentsEmpty
          icon={ReceiptText}
          title={`${businessName} hasn't sent you any invoices`}
          description={`When ${businessName} sends you an invoice, you'll see what's due and can open it here.`}
          action={<MessageBusiness businessName={businessName} />}
        />
      ) : (
        <div className="space-y-3">
          <ol aria-label="Invoices" className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {invoices.invoices.map((i) => <InvoiceRow key={i.id} invoice={i} nowMs={nowMs} />)}
          </ol>
          {invoices.hasMore && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground tabular-nums">Showing {invoices.invoices.length} of {invoices.invoiceCount} invoices.</p>
              <Button
                variant="outline"
                className={QUIET_HOVER}
                disabled={invoices.loadingMore}
                onClick={() => void invoices.loadMore()}
              >
                {invoices.loadingMore && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" />}
                {invoices.loadingMore ? "Loading…" : "Show older invoices"}
              </Button>
            </div>
          )}
        </div>
      )}

      {!blocked && invoices.loaded && !empty && (
        <footer className="mt-8 border-t border-border pt-4 text-sm text-muted-foreground">
          <p>Payments are processed by {businessName}'s payment provider.</p>
          <p className="flex flex-wrap items-center gap-x-1">
            <span>Questions about a charge?</span>
            <Link
              to={PAYMENTS_MESSAGE_HREF}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-md font-medium text-foreground underline underline-offset-4 ${FOCUS}`}
            >
              Message {businessName}
            </Link>
          </p>
        </footer>
      )}
    </section>
  );
}
