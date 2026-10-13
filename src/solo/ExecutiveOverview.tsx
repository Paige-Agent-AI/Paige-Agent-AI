/**
 * ExecutiveOverview — the owner's front office (E2-6, owner-authorized 2026-10-13: "an AI
 * Executive Command Center", not "another collection of disconnected widgets").
 *
 * WHAT THIS SURFACE IS. The Command Center's landing: where the owner sees their whole
 * company through PAIGE's intelligence and moves to act. Four movements, one screen:
 *   1. BUSINESS INTELLIGENCE — the live domains' figures, risks and not-available reasons,
 *      read fresh from the one business review (useBusinessReview → the paige-business-review
 *      seam → the fabric composer → the INT-340 issuer on the caller's own session). Not a
 *      dashboard of guesses: every number carries the composer's own window note, and a real
 *      zero stays visibly different from not-available.
 *   2. PAIGE'S EXECUTIVE BRIEFING — the conversational entry. One working line: the owner's
 *      own mission question, which opens PAIGE. No fake preview text.
 *   3. PAIGE ACTIVITY & DECISIONS — the real filed actions waiting on a person
 *      (useSoloPendingActions → paige_actions, the one action bus), routed to the ONE
 *      approval home (PAIGE chat) per the Trust Compass ruling — never a second inbox.
 *   4. STRATEGY — the Game Plan and Systems Check stay one click away, connected, not
 *      demoted: real in-app routes to the existing tabs.
 *
 * DESIGN: Operate mode on the app's Obsidian/Minimal tokens (--pg-*). Definition rows over
 * icon-card scaffolds; severity carries meaning through the existing ok/warn/bad trio;
 * every interactive element is a real control with a visible focus state; reduced motion is
 * honored by not animating content in; one column that works from 320px up.
 */
import React from "react";
import { ArrowRight, MessageSquareText, ShieldCheck } from "lucide-react";
import { useBusinessReview, type BusinessReviewSnapshot, type ReviewDomain } from "./data/useBusinessReview";
import { useSoloPendingActions } from "./data/useSoloPendingActions";

const fmtValue = (m: { value: number | null; unit: string; currency?: string }): string => {
  if (m.value === null) return "—";
  if (m.unit === "currency_minor" && m.currency) {
    const major = m.value / 100;
    return `${m.currency} ${major.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (m.unit === "percent") return `${m.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  return m.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

/** Live domains in the owner's reading order, with their departmental destination. */
const DOMAIN_ORDER: { key: string; label: string; to: (account: string) => string; destLabel: string }[] = [
  { key: "payments", label: "Payments & collections", to: (a) => `/solo/${a}/finance`, destLabel: "Open Finance" },
  { key: "sales_pipeline", label: "Sales pipeline", to: (a) => `/solo/${a}/sales`, destLabel: "Open Sales" },
  { key: "operations", label: "Operations & Systems Check", to: (a) => `/solo/${a}/command-center/systems-check`, destLabel: "Open Systems Check" },
  { key: "clients", label: "Clients", to: (a) => `/solo/${a}/clients`, destLabel: "Open Clients" },
];

const COVERAGE_LABEL: Record<string, string> = { complete: "Complete read", partial: "Partial read" };
const SEVERITY_RANK: Record<string, number> = { act: 0, watch: 1, info: 2 };
const SEVERITY_COLOR: Record<string, string> = { act: "var(--bad)", watch: "var(--warn)", info: "var(--pg-muted)" };

const Pill = ({ tone, children }: { tone: "ok" | "warn" | "bad" | "mute"; children: React.ReactNode }) => (
  <span style={{
    fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
    padding: "2px 8px", borderRadius: 999,
    color: tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : "var(--pg-muted)",
    background: tone === "ok" ? "var(--ok-tint)" : tone === "warn" ? "var(--warn-tint)" : tone === "bad" ? "var(--bad-tint)" : "var(--surface-sunk)",
  }}>{children}</span>
);

const DomainSection = ({ domain, label, dest }: { domain: ReviewDomain; label: string; dest: { href: string; label: string } | null }) => {
  const risks = [...domain.risks].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
  return (
    <section aria-labelledby={`exec-domain-${domain.domain}`} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "18px 0", borderBottom: "1px solid var(--pg-line-soft)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <h3 id={`exec-domain-${domain.domain}`} style={{ fontSize: 13, fontWeight: 750, color: "var(--pg-ink)", margin: 0 }}>{label}</h3>
        {domain.coverage === "partial" ? <Pill tone="warn">Partial</Pill> : <Pill tone="ok">Current</Pill>}
        {dest && (
          <a href={dest.href} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 650, color: "var(--pg-gold)", textDecoration: "none" }}>
            {dest.label}<ArrowRight size={12} aria-hidden="true" />
          </a>
        )}
      </div>
      {domain.coverage_note ? <p style={{ margin: 0, fontSize: 11, color: "var(--pg-muted)" }}>{domain.coverage_note}</p> : null}
      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {domain.headline.map((m) => (
          <div key={m.key} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
            <dt style={{ fontSize: 12, color: "var(--pg-ink-2)", minWidth: 0, flex: "1 1 160px" }}>{m.label}</dt>
            <dd style={{ margin: 0, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--pg-ink)" }}>
              {fmtValue(m)}
              {m.window_note ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 500, color: "var(--pg-muted)" }}>{m.window_note}</span> : null}
            </dd>
          </div>
        ))}
        {domain.headline.length === 0 && domain.coverage !== "none" ? (
          <div><dd style={{ margin: 0, fontSize: 12, color: "var(--pg-muted)" }}>No headline figures recorded for this period — a complete read with nothing in the books.</dd></div>
        ) : null}
      </dl>
      {risks.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {risks.map((r, i) => (
            <li key={`${r.kind}-${i}`} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, color: "var(--pg-ink-2)" }}>
              <span aria-hidden="true" style={{ flex: "0 0 auto", width: 7, height: 7, borderRadius: 999, background: SEVERITY_COLOR[r.severity] ?? "var(--pg-muted)", alignSelf: "center" }} />
              <span>{r.summary}{r.severity === "act" ? <strong style={{ color: "var(--pg-ink)", marginLeft: 6, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>needs attention</strong> : null}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {domain.changes.map((c, i) => (
        <p key={i} style={{ margin: 0, fontSize: 11, color: "var(--pg-muted)" }}>{c.summary}</p>
      ))}
    </section>
  );
};

const ExecutiveOverview = ({ account, accountEpoch, openPaige }: { account?: string | null; accountEpoch?: string | null; openPaige?: () => void }) => {
  const review = useBusinessReview(accountEpoch ?? null);
  const pendingRead = useSoloPendingActions(accountEpoch ?? null);
  const pending = { ...pendingRead, count: pendingRead.items.length };
  const acc = account ?? "account";

  return (
    <div style={{ minHeight: "100%", overflowY: "auto", background: "var(--pg-canvas)" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "clamp(16px, 3vw, 32px) clamp(14px, 3vw, 28px) 48px", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* PAIGE'S EXECUTIVE BRIEFING — the conversational entry, one honest line. */}
        <section aria-label="PAIGE's executive briefing" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, borderRadius: 14, border: "1px solid var(--pg-line)", background: "var(--pg-spine)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MessageSquareText size={15} color="var(--pg-gold)" aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "var(--pg-ink)" }}>PAIGE's executive briefing</h2>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--pg-ink-2)", lineHeight: 1.55 }}>
            Ask in your own words — the briefing below is the same review PAIGE reads when you ask her how the business is doing.
          </p>
          <button
            type="button"
            onClick={openPaige}
            style={{
              alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 7,
              padding: "9px 14px", borderRadius: 10, border: "1px solid var(--pg-line-authority)",
              background: "transparent", color: "var(--pg-ink)", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}
          >
            “How's my business doing, what needs attention, and what should we work on today?”
          </button>
        </section>

        {/* BUSINESS INTELLIGENCE — fresh from the one review; truthful states only. */}
        <section aria-label="Business intelligence" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, paddingBottom: 4 }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "var(--pg-ink)" }}>Business intelligence</h2>
            {review.state === "ready" ? (
              <span style={{ fontSize: 10.5, color: "var(--pg-muted)" }}>
                {review.snapshot.period.label} · {new Date(review.snapshot.period.start).toLocaleDateString()} – {new Date(review.snapshot.period.end).toLocaleDateString()} · {review.snapshot.period.timezone} · read {new Date(review.snapshot.composed_at).toLocaleTimeString()}
              </span>
            ) : null}
          </div>

          {review.state === "loading" ? (
            <div role="status" aria-live="polite" style={{ padding: "22px 0", fontSize: 12, color: "var(--pg-muted)" }}>
              Reading your business review…
            </div>
          ) : review.state === "failed" ? (
            <div role="alert" style={{ padding: "22px 0", fontSize: 12, color: "var(--bad)" }}>{review.message}</div>
          ) : (
            <>
              {DOMAIN_ORDER.map(({ key, label, to, destLabel }) => {
                const entry = review.snapshot.domains[key];
                if (!entry) return null;
                if (entry.status === "unavailable" || entry.status === "degraded" || !entry.data) {
                  return (
                    <section key={key} aria-labelledby={`exec-domain-${key}`} style={{ padding: "18px 0", borderBottom: "1px solid var(--pg-line-soft)" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <h3 id={`exec-domain-${key}`} style={{ fontSize: 13, fontWeight: 750, color: "var(--pg-ink)", margin: 0 }}>{label}</h3>
                        <Pill tone={entry.status === "degraded" ? "warn" : "mute"}>{entry.status === "degraded" ? "Degraded" : "Not available"}</Pill>
                      </div>
                      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--pg-muted)" }}>
                        {entry.reason === "not_connected" ? "Not connected yet — nothing is invented here." : entry.reason ? `This area could not be read (${entry.reason.replace(/_/g, " ")}). No figures are shown rather than guessed.` : "This area could not be read right now."}
                      </p>
                    </section>
                  );
                }
                return <DomainSection key={key} domain={entry.data} label={label} dest={{ href: to(acc), label: destLabel }} />;
              })}
              {/* Requested-but-silent domains are still named — never skipped. */}
              {review.snapshot.requested
                .filter((d) => !DOMAIN_ORDER.some(({ key }) => key === d) && !review.snapshot.domains[d])
                .length > 0 ? (
                <p style={{ margin: 0, padding: "14px 0", fontSize: 11, color: "var(--pg-muted)" }}>
                  {review.snapshot.requested.filter((d) => !DOMAIN_ORDER.some(({ key }) => key === d) && !review.snapshot.domains[d]).join(", ")} — not available yet.
                </p>
              ) : null}
            </>
          )}
        </section>

        {/* PAIGE ACTIVITY & DECISIONS — the real action bus, routed to the one approval home. */}
        <section aria-label="PAIGE activity and decisions" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, borderRadius: 14, border: "1px solid var(--pg-line)", background: "var(--pg-spine)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={15} color="var(--pg-gold)" aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "var(--pg-ink)" }}>PAIGE activity &amp; decisions</h2>
            {pending.loading ? <Pill tone="mute">Reading…</Pill> : pending.error ? <Pill tone="warn">Read failed</Pill> : pending.count > 0 ? <Pill tone="warn">{pending.count} waiting on you</Pill> : <Pill tone="ok">Nothing waiting</Pill>}
          </div>
          {pending.error ? (
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--pg-muted)" }}>Paige's held work could not be read right now. Nothing changed.</p>
          ) : !pending.loading && pending.count === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--pg-ink-2)" }}>Nothing is held for your approval. When Paige drafts work that needs your yes, it waits here.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 7 }}>
              {(pending.items ?? []).slice(0, 5).map((item) => (
                <li key={item.id} style={{ fontSize: 12, color: "var(--pg-ink-2)" }}>
                  <span style={{ color: "var(--pg-gold)", fontWeight: 650, marginRight: 6 }}>{item.department}</span>
                  {item.title}
                </li>
              ))}
              {pending.count > 5 ? <li style={{ fontSize: 11, color: "var(--pg-muted)" }}>+ {pending.count - 5} more</li> : null}
            </ul>
          )}
          {pending.count > 0 ? (
            <button
              type="button"
              onClick={openPaige}
              style={{
                alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 13px", borderRadius: 10, border: "1px solid var(--pg-line-authority)",
                background: "transparent", color: "var(--pg-ink)", fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >
              Review with Paige<ArrowRight size={12} aria-hidden="true" />
            </button>
          ) : null}
          <p style={{ margin: 0, fontSize: 10.5, color: "var(--pg-muted)" }}>
            Approvals live in one place — Paige's chat confirm card. This list is the same record ({pending.count > 0 ? `${pending.count} filed` : "currently empty"}), not a second inbox.
          </p>
        </section>

        {/* STRATEGY — the connected planning surfaces, one click. */}
        <nav aria-label="Strategy" style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "4px 0" }}>
          <a href={`/solo/${acc}/command-center/business-game-plan`} style={{ flex: "1 1 200px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--pg-line)", textDecoration: "none", color: "var(--pg-ink)", fontSize: 12, fontWeight: 650 }}>
            Business Game Plan<ArrowRight size={13} color="var(--pg-gold)" aria-hidden="true" />
          </a>
          <a href={`/solo/${acc}/command-center/systems-check`} style={{ flex: "1 1 200px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--pg-line)", textDecoration: "none", color: "var(--pg-ink)", fontSize: 12, fontWeight: 650 }}>
            Systems Check<ArrowRight size={13} color="var(--pg-gold)" aria-hidden="true" />
          </a>
        </nav>
      </div>
    </div>
  );
};

export { ExecutiveOverview };
