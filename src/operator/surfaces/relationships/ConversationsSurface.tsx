import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useCompanyConversations, type WelcomeDelivery } from "@/operator/data/useCompanyConversations";
import { viewPath } from "@/operator/shell/operatorAddress";

const TONES: Record<string, string> = {
  sent: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  pending: "bg-muted text-muted-foreground border-border",
  sending: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  retryable_failure: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  needs_attention: "bg-red-500/10 text-red-600 border-red-500/20",
};

const dt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "-";

export default function ConversationsSurface(_props: { onAnnounce?: (msg: string) => void }) {
  const { data, error, loading } = useCompanyConversations();
  const [tab, setTab] = useState<"welcome" | "log">("welcome");
  const [selected, setSelected] = useState<WelcomeDelivery | null>(null);
  const s = data?.summary;
  const welcomes = data?.welcome_deliveries ?? [];
  const sends = useMemo(() => (data?.send_log ?? []).slice(0, 30), [data]);

  return (
    <div className="min-w-0">
      <div className="border-b border-[var(--pg-line)] px-6 py-4">
        <h1 className="text-[18px] font-semibold">Conversations</h1>
        <p className="mt-0.5 text-[12px] text-[var(--pg-muted)]">
          {loading ? "Reading the company communication records..."
            : s ? `${s.welcome_sent} welcome emails sent / ${s.welcome_pending} pending / ${s.welcome_attention} need attention / ${s.total_sends} total sends` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2 border-b border-[var(--pg-line)] px-6 py-2">
        <button onClick={() => setTab("welcome")} aria-pressed={tab === "welcome"}
          className={cn("rounded-full border px-3 py-1 text-[11px] font-medium", tab === "welcome" ? "border-[var(--pg-ink)] bg-[var(--pg-ink)] text-white" : "border-[var(--pg-line)] text-[var(--pg-muted)]")}>
          Welcome emails ({welcomes.length})
        </button>
        <button onClick={() => setTab("log")} aria-pressed={tab === "log"}
          className={cn("rounded-full border px-3 py-1 text-[11px] font-medium", tab === "log" ? "border-[var(--pg-ink)] bg-[var(--pg-ink)] text-white" : "border-[var(--pg-line)] text-[var(--pg-muted)]")}>
          Send log ({sends.length})
        </button>
      </div>
      {loading ? (
        <div className="p-6" aria-busy="true" role="status">Loading the company communication records...</div>
      ) : error ? (
        <div className="p-6"><p role="alert" className="text-orange-600">Conversations could not load ({error}).</p></div>
      ) : tab === "welcome" ? (
        welcomes.length === 0 ? (
          <div className="p-6"><p role="status" className="text-[13px] text-[var(--pg-muted)]">No welcome emails yet.</p></div>
        ) : (
          <div className="px-6 py-4">
            <table className="w-full min-w-[560px] text-left text-[12px]">
              <caption className="sr-only">Welcome email deliveries</caption>
              <thead><tr className="border-b border-[var(--pg-line)] text-[var(--pg-muted)]">
                <th className="py-2 pr-3">Customer</th><th className="pr-3">State</th><th className="pr-3">Attempts</th><th className="pr-3">Last error</th><th className="pr-3">Sent</th>
              </tr></thead>
              <tbody>
                {welcomes.map(w => (
                  <tr key={w.user_id} tabIndex={0} role="button" onClick={() => setSelected(w)}
                    onKeyDown={e => { if (e.key === "Enter") setSelected(w); }}
                    className="cursor-pointer border-b border-[var(--pg-line)] hover:bg-[var(--pg-line)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <td className="py-2.5 pr-3 font-mono text-[10px]">{w.user_id.slice(0, 8)}</td>
                    <td className="pr-3"><span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", TONES[w.state] ?? "")}>{w.state}</span></td>
                    <td className="pr-3 tabular-nums">{w.attempts}</td>
                    <td className="pr-3 font-mono text-[10px]">{w.last_error ?? "-"}</td>
                    <td className="pr-3">{dt(w.sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : sends.length === 0 ? (
        <div className="p-6"><p role="status" className="text-[13px] text-[var(--pg-muted)]">No sends recorded yet.</p></div>
      ) : (
        <div className="px-6 py-4">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <caption className="sr-only">Transactional send log</caption>
            <thead><tr className="border-b border-[var(--pg-line)] text-[var(--pg-muted)]">
              <th className="py-2 pr-3">Recipient</th><th className="pr-3">Template</th><th className="pr-3">Status</th><th className="pr-3">Date</th>
            </tr></thead>
            <tbody>
              {sends.map((entry, i) => (
                <tr key={i} className="border-b border-[var(--pg-line)]">
                  <td className="py-2.5 pr-3">{entry.recipient}</td>
                  <td className="pr-3">{entry.template}</td>
                  <td className="pr-3">{entry.status}</td>
                  <td className="pr-3">{dt(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true" aria-label="Welcome delivery detail">
          <div className="w-full max-w-sm rounded-lg border border-[var(--pg-line)] bg-card p-5 shadow-lg">
            <div className="flex items-start justify-between">
              <h2 className="text-[16px] font-semibold">Welcome email</h2>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">X</button>
            </div>
            <div className="mt-4 space-y-2 text-[11px]">
              <div><span className="text-muted-foreground">State: </span><span className="font-medium">{selected.state}</span></div>
              <div><span className="text-muted-foreground">Attempts: </span><span className="font-medium">{selected.attempts}</span></div>
              {selected.last_error && <div><span className="text-muted-foreground">Last error: </span><span className="font-mono text-[10px]">{selected.last_error}</span></div>}
              {selected.provider_message_id && <div><span className="text-muted-foreground">Provider receipt: </span><span className="font-mono text-[10px]">{selected.provider_message_id}</span></div>}
              <div><span className="text-muted-foreground">First attempt: </span>{dt(selected.first_attempt_at)}</div>
              {selected.sent_at && <div><span className="text-muted-foreground">Sent: </span>{dt(selected.sent_at)}</div>}
            </div>
            <div className="mt-4">
              <Link to={viewPath("relationships", "Customers")} className="text-[11px] text-[var(--pg-muted)] underline underline-offset-2">View customer</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
