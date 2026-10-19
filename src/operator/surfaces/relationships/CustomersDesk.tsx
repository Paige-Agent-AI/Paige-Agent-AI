import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  useCommercialCustomers,
  useCustomerHistory,
  type CommercialCustomer,
} from "@/operator/data/useCommercialCustomers";

/**
 * O-1 Customers Desk — the company's one commercial book for PAIGE Inc.
 *
 * Replaces the "drawn, not wired" placeholder with a real, connected surface:
 * every row is a genuine enrollment from the canonical L1 records, every
 * drill-down shows the full lifecycle from the same authoritative sources
 * the fulfillment chain wrote. No tenant-private L2 content ever crosses
 * this boundary.
 *
 * Design: the existing v3 Operator visual system — plate hierarchy, badge
 * tones, the two-pane record fold below 720px — matching FleetConsole's
 * proven interaction quality.
 */

type StageFilter = "all" | "trialing" | "fulfilled" | "attention" | "pending";

const STAGE_LABELS: Record<string, string> = {
  fulfilled: "Fulfilled",
  checkout_open: "Checkout open",
  verification_pending: "Verifying",
  needs_intake: "Needs intake",
  needs_checkout: "Needs checkout",
};

const SUB_TONES: Record<string, string> = {
  trialing: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  past_due: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  canceled: "bg-muted text-muted-foreground border-border",
};

const WELCOME_TONES: Record<string, string> = {
  sent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  pending: "bg-muted text-muted-foreground border-border",
  retryable_failure: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  needs_attention: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  sending: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

function Badge({ tone, children }: { tone?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone ?? "bg-muted text-muted-foreground border-border",
      )}
    >
      {children}
    </span>
  );
}

function StatusDot({ ok, attention }: { ok: boolean; attention?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full shrink-0",
        ok ? "bg-emerald-500" : attention ? "bg-red-500" : "bg-orange-500",
      )}
    />
  );
}

export function CustomersDesk() {
  const { data, error, loading } = useCommercialCustomers();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<StageFilter>("all");
  const [search, setSearch] = useState("");

  const customers = data?.customers ?? [];
  const summary = data?.summary;

  const filtered = useMemo(() => {
    let list = customers;
    if (filter === "trialing") {
      list = list.filter((c) => c.subscription_status === "trialing");
    } else if (filter === "fulfilled") {
      list = list.filter((c) => c.enrollment_state === "fulfilled");
    } else if (filter === "pending") {
      list = list.filter((c) => c.enrollment_state !== "fulfilled");
    } else if (filter === "attention") {
      list = list.filter(
        (c) =>
          c.welcome_state === "needs_attention" ||
          c.welcome_state === "retryable_failure" ||
          (c.enrollment_state !== "fulfilled" && c.subscription_status !== null) ||
          c.last_event_error !== null,
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          (c.business_name ?? "").toLowerCase().includes(q) ||
          String(c.account_number ?? "").includes(q) ||
          (c.reference_id ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [customers, filter, search]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground py-20 justify-center">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Reading the commercial book…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm font-medium text-foreground">Couldn't read the customer book</p>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          This read requires a Platform Operator role. Verify your access or contact support.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Summary band */}
      {summary && (
        <div className="grid grid-cols-2 gap-2 px-4 pt-3 pb-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Enrollments", value: summary.total_enrollments },
            { label: "Active trials", value: summary.active_trials },
            { label: "Active paid", value: summary.active_paid },
            { label: "Welcomes sent", value: summary.welcomes_sent },
            { label: "Needing attention", value: summary.welcomes_needing_attention + summary.pending },
            { label: "Collected", value: "$0.00", hint: "Until Stripe confirms a real collection" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">{s.value}</p>
              {s.hint && <p className="mt-0.5 text-[10px] text-muted-foreground/70">{s.hint}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Filter + search row */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
        <div className="flex gap-1">
          {([
            ["all", "All"],
            ["trialing", "Trialing"],
            ["fulfilled", "Fulfilled"],
            ["pending", "Pending"],
            ["attention", "Attention"],
          ] as Array<[StageFilter, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                filter === key
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by business, account #, or reference…"
          className="ml-auto w-full max-w-56 rounded-md border border-border bg-background px-3 py-1 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-foreground/30"
        />
      </div>

      {/* Two-pane: list + drill */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden px-4 pb-4 lg:flex-row flex-col">
        {/* List */}
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto rounded-lg border border-border",
            selected && "hidden lg:block",
          )}
        >
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {customers.length === 0
                  ? "No enrollments yet. The first customer signup will appear here."
                  : "No customers match this filter."}
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card/95 backdrop-blur">
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Stage</th>
                  <th className="px-3 py-2 font-medium">Subscription</th>
                  <th className="px-3 py-2 font-medium">Welcome</th>
                  <th className="px-3 py-2 font-medium text-right">Trial ends</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <CustomerRow
                    key={c.user_id}
                    customer={c}
                    selected={selected === c.user_id}
                    onSelect={() => setSelected(c.user_id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Drill-down */}
        {selected && (
          <CustomerDrilldown
            userId={selected}
            onBack={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

function CustomerRow({
  customer,
  selected,
  onSelect,
}: {
  customer: CommercialCustomer;
  selected: boolean;
  onSelect: () => void;
}) {
  const trialDays = daysUntil(customer.trial_ends_at);
  const attention =
    customer.welcome_state === "needs_attention" ||
    (customer.enrollment_state !== "fulfilled" && customer.subscription_status !== null);

  return (
    <tr
      onClick={onSelect}
      className={cn(
        "cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/50",
        selected && "bg-muted",
      )}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <StatusDot
            ok={customer.enrollment_state === "fulfilled" && customer.welcome_state === "sent"}
            attention={attention}
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {customer.business_name ?? "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {customer.account_number ? `Acct ${customer.account_number}` : "No workspace"} ·{" "}
              {STAGE_LABELS[customer.enrollment_state] ?? customer.enrollment_state}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <Badge>{STAGE_LABELS[customer.enrollment_state] ?? customer.enrollment_state}</Badge>
      </td>
      <td className="px-3 py-2.5">
        <Badge tone={SUB_TONES[customer.subscription_status ?? ""] ?? undefined}>
          {customer.subscription_status ?? "No subscription"}
        </Badge>
      </td>
      <td className="px-3 py-2.5">
        <Badge tone={WELCOME_TONES[customer.welcome_state ?? ""] ?? undefined}>
          {customer.welcome_state ?? "—"}
        </Badge>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
        {trialDays !== null ? (
          <span className={cn(trialDays <= 7 && "text-orange-500 font-medium")}>
            {trialDays}d
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function CustomerDrilldown({ userId, onBack }: { userId: string; onBack: () => void }) {
  const { data: h, error, loading } = useCustomerHistory(userId);

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground py-20 justify-center lg:w-[420px] lg:shrink-0">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Reading lifecycle…
      </div>
    );
  }

  if (error || !h) {
    return (
      <div className="lg:w-[420px] lg:shrink-0 rounded-lg border border-border p-6 text-center">
        <p className="text-sm font-medium">Couldn't read this customer</p>
        <p className="mt-1 text-xs text-muted-foreground">{error ?? "No record found"}</p>
        <button onClick={onBack} className="mt-3 text-xs underline text-muted-foreground">
          Back to list
        </button>
      </div>
    );
  }

  return (
    <div className="lg:w-[420px] lg:shrink-0 overflow-y-auto rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <button
          onClick={onBack}
          className="mb-2 text-xs text-muted-foreground hover:text-foreground lg:hidden"
          type="button"
        >
          ← Back
        </button>
        <h3 className="font-semibold text-foreground">{h.intake?.business_name ?? "Customer"}</h3>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {h.workspace && (
            <Badge>
              Acct {h.workspace.account_number} · {h.workspace.account_type}
            </Badge>
          )}
          {h.subscription && (
            <Badge tone={SUB_TONES[h.subscription.status] ?? undefined}>
              {h.subscription.status}
            </Badge>
          )}
          {h.welcome && (
            <Badge tone={WELCOME_TONES[h.welcome.state] ?? undefined}>
              Welcome: {h.welcome.state}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-4 px-4 py-3 text-xs">
        {/* Enrollment */}
        <Section title="Enrollment">
          <Row label="State" value={h.enrollment?.state ?? "—"} />
          <Row label="Reference" value={h.enrollment?.reference_id?.slice(0, 8) ?? "—"} mono />
          <Row
            label="Enrolled"
            value={h.enrollment?.enrolled_at ? new Date(h.enrollment.enrolled_at).toLocaleDateString() : "—"}
          />
          <Row label="Stripe customer" value={h.enrollment?.stripe_customer ?? "—"} mono />
          <Row label="Stripe subscription" value={h.enrollment?.stripe_subscription ?? "—"} mono />
        </Section>

        {/* Subscription */}
        {h.subscription && (
          <Section title="Subscription">
            <Row label="Status" value={h.subscription.status} />
            <Row label="Provider" value={h.subscription.provider_mode} />
            <Row
              label="Trial started"
              value={h.subscription.trial_started_at ? new Date(h.subscription.trial_started_at).toLocaleDateString() : "—"}
            />
            <Row
              label="Trial ends"
              value={h.subscription.trial_ends_at ? new Date(h.subscription.trial_ends_at).toLocaleDateString() : "—"}
            />
            <Row label="Cancel at period end" value={h.subscription.cancel_at_period_end ? "Yes" : "No"} />
            <Row label="Collected" value="$0.00 (trial — not cash)" muted />
          </Section>
        )}

        {/* Workspace */}
        {h.workspace && (
          <Section title="Workspace">
            <Row label="Account" value={String(h.workspace.account_number)} />
            <Row label="Name" value={h.workspace.name} />
            <Row label="Status" value={h.workspace.status} />
            <Row label="Beta entitled" value={h.workspace.beta_entitled ? "Yes" : "No"} />
          </Section>
        )}

        {/* Welcome email */}
        {h.welcome && (
          <Section title="Welcome email">
            <Row label="State" value={h.welcome.state} />
            <Row label="Attempts" value={String(h.welcome.attempts)} />
            {h.welcome.last_error && <Row label="Last error" value={h.welcome.last_error} mono />}
            {h.welcome.provider_message_id && (
              <Row label="Provider receipt" value={h.welcome.provider_message_id} mono />
            )}
          </Section>
        )}

        {/* Webhook events */}
        {h.webhook_events.length > 0 && (
          <Section title={`Stripe events (${h.webhook_events.length})`}>
            {h.webhook_events.map((e, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-muted-foreground">{e.type}</span>
                <Badge>{e.state}</Badge>
              </div>
            ))}
          </Section>
        )}

        {/* Fulfillment receipts */}
        {h.fulfillment_receipts.length > 0 && (
          <Section title={`Receipts (${h.fulfillment_receipts.length})`}>
            {h.fulfillment_receipts.map((r) => (
              <div key={r.event_id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-muted-foreground">{r.outcome}</span>
                <span className="text-[10px] text-muted-foreground/60">{r.reference_id?.slice(0, 8)}</span>
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono, muted }: { label: string; value: string; mono?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate text-right",
          mono && "font-mono text-[10px]",
          muted && "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
