/**
 * /app/agreements — the agreements a business sent its customer, on the Sales Agreements engine (E09 Slice A).
 *
 * Who sees what:
 *   - A customer of one business sees that business's agreements to them: what waits for their signature
 *     first, then everything else. "Review and sign" opens the existing signing page (/sign/:token, frozen
 *     §28) with a fresh link; a signed agreement's sealed copy downloads or opens here.
 *   - Everyone else — staff, a login with no customer relationship — sees exactly what this route showed
 *     before: the PaigeAgent terms they accepted (MyAgreements, unchanged, §58). Customers reach that record
 *     too, from the link at the foot of this page (/app/agreements/platform). A read that FAILS before the
 *     login is known to be a customer is not evidence that it is one: unless the brand resolver independently
 *     knows the login as a customer, it gets MyAgreements too, never the customer error card.
 *
 * The only gold on the page is the first "Review and sign" (§11): the one act. Every other signable row
 * carries the same action as a quiet button, so a long list never turns into a wall of gold.
 *
 * Opening an agreement here REPLACES the signing link the business emailed (owner decision D-A4); the page
 * says so beside the action, because a customer who later opens that email deserves to know why it stopped.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Download, ExternalLink, FileSignature, Home, Loader2, MessageSquare, ShieldCheck, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PORTAL_AGREEMENTS_LIMIT,
  fetchSignedCopy,
  goToSigningPage,
  openAgreementForSigning,
  signedCopyFilename,
  useClientPortalAgreements,
  type PortalAgreement,
  type PortalAgreementState,
} from "@/hooks/useClientPortalAgreements";
import { useClientPortalBrandState, type ClientPortalBrand } from "@/hooks/useClientPortalBrand";
import { ASK_FOR_NEW_LINK_HREF, PLATFORM_TERMS_HREF, openFailureCopy, signNoteCopy, type AgreementCopy } from "@/lib/portal/agreementsCopy";

const MyAgreements = lazy(() => import("@/pages/MyAgreements"));

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/**
 * The shared outline and ghost buttons hover-fill with --secondary, which is near-black in light theme under
 * a dark label. Every quiet control here hovers to muted with the label in foreground instead, the same
 * treatment as Progress and Sessions.
 */
const QUIET_HOVER = "hover:bg-muted hover:text-foreground";
const LINK_BUTTON = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium ${QUIET_HOVER} ${FOCUS}`;
const INLINE_LINK = `inline-flex min-h-[44px] items-center gap-1.5 rounded-md font-medium text-foreground underline underline-offset-4 ${FOCUS}`;
/**
 * A link that finishes a sentence: inline, so it wraps with the words instead of dropping to a line of its own,
 * with vertical padding that grows the press area to a 44px target without moving a single line.
 */
const SENTENCE_LINK = `rounded-sm py-[14px] font-medium text-foreground underline underline-offset-4 [box-decoration-break:clone] ${FOCUS}`;

function stateLabel(state: PortalAgreementState, business: string): string {
  switch (state) {
    case "awaiting_you": return "Waiting for you";
    case "awaiting_signature": return "Waiting for a signature";
    case "awaiting_business": return `Waiting for ${business}`;
    case "awaiting_countersign": return `Waiting for ${business}`;
    case "awaiting_others": return "Waiting for others";
    case "signed": return "Signed";
    case "declined": return "Declined";
    case "withdrawn": return "Withdrawn";
    case "expired": return "Expired";
    default: return "Not available";
  }
}

function viewerTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}
/** "Mon, Nov 3" in the viewer's zone; the year only when it is not this year. */
function dayLabel(iso: string, tz: string, nowMs: number): string {
  const d = new Date(iso);
  const year = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(x);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz, weekday: "short", month: "short", day: "numeric", ...(year(d) === year(new Date(nowMs)) ? {} : { year: "numeric" }),
  }).format(d);
}

/** The one date that matters for where the agreement stands. */
function DateLine({ a, tz, nowMs }: { a: PortalAgreement; tz: string; nowMs: number }) {
  const at = (label: string, iso: string) => <>{label} <time dateTime={iso}>{dayLabel(iso, tz, nowMs)}</time></>;
  if (a.state === "awaiting_you" && a.sign_note === "link_expired") return a.expires_at ? <>{at("Link expired", a.expires_at)}</> : null;
  if (a.state === "awaiting_you" && a.sign_note !== "link_revoked" && a.expires_at) return <>{at("Sign by", a.expires_at)}</>;
  if (a.state === "signed") return a.completed_at ? <>{at("Signed", a.completed_at)}</> : <>Signed</>;
  if (a.state === "expired") return a.expires_at ? <>{at("Expired", a.expires_at)}</> : <>Expired</>;
  return a.sent_at ? <>{at("Sent", a.sent_at)}</> : null;
}

/**
 * Where the agreement stands. Filled reads as needing you, a quiet tint as finished, plain as everything
 * else. Below `sm` the pill column is dropped and the state leads the date line instead, so a long title
 * never wraps beside a wide pill on a phone.
 */
function StatePill({ state, business }: { state: PortalAgreementState; business: string }) {
  const cls = state === "awaiting_you"
    ? "border-transparent bg-primary/10 text-foreground"
    : state === "signed" ? "border-success/40 bg-success/10 text-foreground" : "border-border text-muted-foreground";
  return (
    <span
      data-testid="agreement-state"
      className={`hidden max-w-[14rem] shrink-0 truncate whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium sm:inline-block ${cls}`}
    >
      {stateLabel(state, business)}
    </span>
  );
}

type RowBusy = "open" | "download" | "view" | null;

function AskNewLinkButton({ business }: { business: string }) {
  return (
    <Link to={ASK_FOR_NEW_LINK_HREF} className={LINK_BUTTON} data-testid="ask-new-link">
      <MessageSquare aria-hidden="true" className="h-4 w-4" /> Ask {business} for a new link
    </Link>
  );
}

/** Words, then the Messages link either finishing the sentence or standing as its own action. */
function CopyWithAsk({ copy, business }: { copy: AgreementCopy; business: string }) {
  if (copy.ask !== "inline") return <>{copy.text}</>;
  return (
    <>
      {copy.text}{" "}
      <Link to={ASK_FOR_NEW_LINK_HREF} className={SENTENCE_LINK} data-testid="ask-new-link-inline">ask {business} for a new link</Link>.
    </>
  );
}

function AgreementRow({ a, business, tz, nowMs, primary, onRefresh, tenantId }: {
  a: PortalAgreement; business: string; tz: string; nowMs: number;
  /** The first signable row carries the page's one gold act. */
  primary: boolean;
  onRefresh: () => void;
  tenantId: string | null;
}) {
  const [busy, setBusy] = useState<RowBusy>(null);
  const [problem, setProblem] = useState<AgreementCopy | null>(null);
  /**
   * The server asked this customer to wait (TRY_AGAIN_LATER): the row's button goes quiet, not gold, so it stops
   * inviting another refused press. A fresh read of the list (a new row object) lifts it.
   */
  const [throttled, setThrottled] = useState(false);
  useEffect(() => { setThrottled(false); }, [a]);
  const alive = useRef(true);
  // Set on every mount, not only the first: StrictMode mounts, unmounts and mounts again, and a flag that only ever
  // goes false would drop every answer after the first remount.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const signHere = async () => {
    setProblem(null);
    setBusy("open");
    const result = await openAgreementForSigning(a.id, tenantId);
    if (!alive.current) return;
    if (result.ok === true) {
      goToSigningPage(result.token);
      return;
    }
    setBusy(null);
    setProblem(openFailureCopy(result.code, business, result.note));
    if (result.code === "TRY_AGAIN_LATER") setThrottled(true);
    if (result.code === "NOT_SIGNABLE" || result.code === "CLIENT_AGREEMENT_UNAVAILABLE" || result.code === "NOT_SIGNABLE_HERE") onRefresh();
  };

  const copy = async (download: boolean) => {
    setProblem(null);
    setBusy(download ? "download" : "view");
    // A tab opened by the click itself survives the wait for the bytes; one opened afterwards may be blocked.
    const tab = download ? null : window.open("", "_blank");
    if (tab) tab.opener = null;
    const result = await fetchSignedCopy(a.id, tenantId, download);
    if (!alive.current) { tab?.close(); return; }
    setBusy(null);
    if (result.ok === false) {
      tab?.close();
      setProblem({ text: "We couldn't get the signed copy just now. Nothing changed; try again in a moment.", ask: null });
      return;
    }
    const url = URL.createObjectURL(result.blob);
    if (tab) tab.location.href = url;
    else {
      const link = document.createElement("a");
      link.href = url;
      if (download) link.download = signedCopyFilename(a.title);
      else { link.target = "_blank"; link.rel = "noopener noreferrer"; }
      document.body.append(link);
      link.click();
      link.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const label = stateLabel(a.state, business);
  const date = <DateLine a={a} tz={tz} nowMs={nowMs} />;
  // In "Waiting for you" the group heading already says where these stand; a pill on every row would repeat it.
  const showState = a.state !== "awaiting_you";
  const gold = primary && !throttled;
  let note: ReactNode = null;
  let actions: ReactNode = null;
  if (a.can_sign) {
    actions = (
      <Button
        size="sm"
        variant={gold ? "gold" : "outline"}
        className={gold ? "" : QUIET_HOVER}
        disabled={busy !== null}
        aria-busy={busy === "open"}
        onClick={() => void signHere()}
        data-testid="review-and-sign"
      >
        {busy === "open" ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <FileSignature aria-hidden="true" />}
        {busy === "open" ? "Opening…" : "Review and sign"}
      </Button>
    );
  } else if (a.state === "awaiting_you" || a.state === "awaiting_signature") {
    const copy = signNoteCopy(a.sign_note ?? "use_email_link", business);
    note = <CopyWithAsk copy={copy} business={business} />;
    if (copy.ask === "button") actions = <AskNewLinkButton business={business} />;
  } else if (a.state === "signed" && a.can_download) {
    actions = (
      <>
        <Button size="sm" variant="outline" className={QUIET_HOVER} disabled={busy !== null} aria-busy={busy === "download"} onClick={() => void copy(true)} data-testid="download-signed">
          {busy === "download" ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Download aria-hidden="true" />}
          {busy === "download" ? "Downloading…" : "Download signed copy"}
        </Button>
        <Button size="sm" variant="ghost" className={QUIET_HOVER} disabled={busy !== null} aria-busy={busy === "view"} onClick={() => void copy(false)} data-testid="open-signed">
          {busy === "view" ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ExternalLink aria-hidden="true" />}
          {busy === "view" ? "Opening…" : "Open"}
        </Button>
      </>
    );
  } else if (a.state === "signed") {
    note = <>The signed copy isn&apos;t ready to download yet.</>;
  } else if (a.state === "expired") {
    actions = <AskNewLinkButton business={business} />;
  } else if (a.state === "withdrawn") {
    note = <>{business} withdrew this agreement. There&apos;s nothing to sign.</>;
  } else if (a.state === "awaiting_business") {
    note = <>{business} signs first. You&apos;ll be able to sign once they have.</>;
  } else if (a.state === "awaiting_countersign") {
    note = <>You&apos;ve signed. It&apos;s complete once {business} signs.</>;
  } else if (a.state === "awaiting_others") {
    note = <>You&apos;ve signed. It&apos;s complete once everyone else has.</>;
  }

  return (
    <li data-testid="agreement-row" data-agreement-id={a.id} data-state={a.state} className="py-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-medium [text-wrap:pretty]">{a.title}</h3>
          {a.engagement_title && (
            <p data-testid="engagement-title" className="mt-0.5 break-words text-sm text-muted-foreground">For {a.engagement_title}</p>
          )}
          <p className="mt-0.5 text-sm text-muted-foreground">
            {/* Signed and Expired: the date line already says it ("Signed Thu, Oct 15"), so the phone does not repeat it. */}
            {showState && a.state !== "signed" && a.state !== "expired" && (
              <span data-testid="state-inline" className="sm:hidden">{label}{date ? " · " : ""}</span>
            )}
            {date}
          </p>
          {note && <p data-testid="agreement-note" className="mt-1 text-sm text-foreground">{note}</p>}
        </div>
        {showState && <StatePill state={a.state} business={business} />}
      </div>
      {problem && (
        <p role="alert" data-testid="agreement-problem" className="mt-2 flex items-start gap-2 text-sm text-foreground">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span><CopyWithAsk copy={problem} business={business} /></span>
        </p>
      )}
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
    </li>
  );
}

function AgreementsSkeleton() {
  return (
    <div role="status" data-testid="agreements-skeleton" className="rounded-xl border border-border bg-card px-4">
      <span className="sr-only">Loading your agreements…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3 border-b border-border py-4 last:border-b-0">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-1/3 motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-5 w-24 rounded-full motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function AgreementsEmpty(props: { icon: LucideIcon; title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <EmptyState icon={props.icon} title={props.title} description={<span className="[text-wrap:balance]">{props.description}</span>} action={props.action} className="py-10" />
    </div>
  );
}

function PlatformTermsLink() {
  return (
    <footer className="mt-8 border-t border-border pt-4 text-sm text-muted-foreground">
      <Link to={PLATFORM_TERMS_HREF} data-testid="platform-terms-link" className={INLINE_LINK}>
        <ShieldCheck aria-hidden="true" className="h-4 w-4 text-muted-foreground" /> PaigeAgent terms you&apos;ve accepted
      </Link>
    </footer>
  );
}

function Group({ id, title, children, hint }: { id: string; title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h2>
      {hint && <p data-testid="replaces-email-link" className="mb-2 text-sm text-muted-foreground">{hint}</p>}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card px-4">{children}</ul>
    </section>
  );
}

function CustomerAgreements({ view, brand }: { view: ReturnType<typeof useClientPortalAgreements>; brand: ClientPortalBrand | null }) {
  const business = view.businessName || brand?.tenant_name?.trim() || "your business";
  const tz = useMemo(viewerTimeZone, []);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { setNowMs(Date.now()); }, [view.agreements]);

  const waiting = view.agreements.filter((a) => a.state === "awaiting_you");
  const rest = view.agreements.filter((a) => a.state !== "awaiting_you");
  const firstSignable = waiting.find((a) => a.can_sign)?.id ?? null;
  const summary = view.summary;
  const firstLoad = view.loading && !summary;
  const refresh = () => { void view.refresh(); };
  const row = (a: PortalAgreement) => (
    <AgreementRow key={a.id} a={a} business={business} tz={tz} nowMs={nowMs} primary={a.id === firstSignable} onRefresh={refresh} tenantId={view.tenantId} />
  );

  return (
    <section aria-labelledby="agreements-title" aria-busy={view.loading} className="mx-auto max-w-2xl [&_a]:min-h-[44px] [&_button]:min-h-[44px]">
      <header className="space-y-1 pb-4">
        <h1 id="agreements-title" className="text-2xl font-semibold tracking-tight [text-wrap:balance]">
          {view.multipleBusinesses || !summary ? "Agreements" : `Agreements with ${business}`}
        </h1>
        {summary && summary.awaiting_you > 0 && (
          <p data-testid="agreements-summary" className="text-xl font-semibold tracking-tight tabular-nums">
            {summary.awaiting_you} waiting for your signature
          </p>
        )}
        {summary && view.agreements.length > 0 && summary.awaiting_you === 0 && (
          <p data-testid="agreements-summary" className="text-sm text-muted-foreground">Nothing is waiting for your signature.</p>
        )}
      </header>

      {view.error && !view.multipleBusinesses && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 px-4 py-3 text-sm">
          <p className="inline-flex items-center gap-2">
            <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" /> {view.error}
          </p>
          <Button size="sm" variant="outline" className={QUIET_HOVER} onClick={refresh}>Try again</Button>
        </div>
      )}

      {view.multipleBusinesses ? (
        <AgreementsEmpty
          icon={FileSignature}
          title="Agreements for more than one business aren't available here yet"
          description="Your account is connected to more than one business. Each business emails its own signing links; if you can't use one, ask that business for a new link."
          action={<Link to="/app" className={LINK_BUTTON}><Home aria-hidden="true" className="h-4 w-4" /> Back to Home</Link>}
        />
      ) : firstLoad ? (
        <AgreementsSkeleton />
      ) : !summary ? null : view.agreements.length === 0 ? (
        <AgreementsEmpty
          icon={FileSignature}
          title={`${business} hasn't sent you any agreements`}
          description={`When ${business} sends you an agreement, you can read it, sign it and download your signed copy here.`}
        />
      ) : (
        <div className="space-y-8">
          {waiting.length > 0 && (
            <Group
              id="agreements-waiting"
              title="Waiting for you"
              hint={firstSignable ? `Opening an agreement here replaces the signing link ${business} emailed you.` : undefined}
            >
              {waiting.map(row)}
            </Group>
          )}
          {rest.length > 0 && (
            <Group id="agreements-rest" title={waiting.length > 0 ? "Everything else" : "Your agreements"}>
              {rest.map(row)}
            </Group>
          )}
          {view.hasMore && (
            <p className="text-sm text-muted-foreground">Showing the {PORTAL_AGREEMENTS_LIMIT} most relevant agreements.</p>
          )}
        </div>
      )}

      <PlatformTermsLink />
    </section>
  );
}

function PlatformTermsPage() {
  return (
    <Suspense fallback={<AgreementsSkeleton />}>
      <MyAgreements />
    </Suspense>
  );
}

export default function Agreements() {
  const view = useClientPortalAgreements();
  const brandState = useClientPortalBrandState();
  // Not a customer of a business (staff, or a login with no relationship): the page this route always was.
  if (view.unavailable) return <PlatformTermsPage />;
  if (!view.customerConfirmed && !view.multipleBusinesses) {
    // Nothing yet says this login is a customer: no customer header or footer, just the shape of a list.
    if (!view.error) return <div className="mx-auto max-w-2xl"><AgreementsSkeleton /></div>;
    // The read FAILED (a network error, or the function missing or not yet granted). That says nothing about who
    // this is, so staff and unlinked logins keep the page they always had (§58). Only a login the brand
    // resolver independently knows as a customer gets the customer "couldn't load" card.
    if (brandState.loading) return <div className="mx-auto max-w-2xl"><AgreementsSkeleton /></div>;
    const knownCustomer = !!brandState.brand?.tenant_id || brandState.multipleBusinesses;
    if (!knownCustomer) return <PlatformTermsPage />;
  }
  return <CustomerAgreements view={view} brand={brandState.brand} />;
}
