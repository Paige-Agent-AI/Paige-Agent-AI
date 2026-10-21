import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useCompanyPeople, type CompanyPerson } from "@/operator/data/useCompanyPeople";
import { viewPath } from "@/operator/shell/operatorAddress";

type PeopleFilter = "all" | "fulfilled" | "in-progress" | "no-workspace";
const FILTER_LABELS: Record<PeopleFilter, string> = {
  all: "All", fulfilled: "Enrolled", "in-progress": "In progress", "no-workspace": "No workspace",
};
function monogram(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}
export default function PeopleSurface(_props: { onAnnounce?: (msg: string) => void }) {
  const { data, error, loading } = useCompanyPeople();
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CompanyPerson | null>(null);
  const people = useMemo(() => {
    let l = data?.people ?? [];
    if (filter === "fulfilled") l = l.filter(p => p.enrollment_state === "fulfilled");
    if (filter === "in-progress") l = l.filter(p => !["fulfilled","canceled","expired"].includes(p.enrollment_state));
    if (filter === "no-workspace") l = l.filter(p => !p.has_workspace);
    const q = search.toLowerCase();
    if (q) l = l.filter(p => `${p.name} ${p.business_name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q));
    return l;
  }, [data, filter, search]);
  const summary = data?.summary;
  return (
    <div className="min-w-0">
      <div className="border-b border-[var(--pg-line)] px-6 py-4">
        <h1 className="text-[18px] font-semibold">People</h1>
        <p className="mt-0.5 text-[12px] text-[var(--pg-muted)]">
          {loading ? "Reading the company contact book…" : summary ? `${summary.total} people connected to PAIGE Inc — ${summary.fulfilled} enrolled, ${summary.in_progress} in progress` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2 border-b border-[var(--pg-line)] px-6 py-2">
        {(Object.keys(FILTER_LABELS) as PeopleFilter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={cn("rounded-full border px-3 py-1 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === f ? "border-[var(--pg-ink)] bg-[var(--pg-ink)] text-white" : "border-[var(--pg-line)] text-[var(--pg-muted)]")}>
            {FILTER_LABELS[f]}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, business, or email…"
          className="flex-1 rounded-md border border-[var(--pg-line)] bg-transparent px-3 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Search people" />
      </div>
      {loading ? <div className="p-6" aria-busy="true" role="status">Loading the company contact book…</div>
      : error ? <div className="p-6"><p role="alert" className="text-[var(--pg-attention,#b45309)]">People could not load or access was refused ({error}). Leave and reopen to retry.</p></div>
      : !summary || summary.total === 0 ? <div className="p-6"><p role="status" className="text-[13px] text-[var(--pg-muted)]">No people yet. The first signup will appear here.</p></div>
      : people.length === 0 ? <div className="p-6"><p role="status" className="text-[13px] text-[var(--pg-muted)]">{search ? "No people match your search." : `No people in the ${FILTER_LABELS[filter]} filter.`}</p></div>
      : (
        <div className="px-6 py-4">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <caption className="sr-only">PAIGE Inc company contacts</caption>
            <thead><tr className="border-b border-[var(--pg-line)] text-[var(--pg-muted)]">
              <th className="py-2 pr-3">Person</th><th className="pr-3">Business</th><th className="pr-3">Stage</th><th className="pr-3">Workspace</th><th className="pr-3">Enrolled</th>
            </tr></thead>
            <tbody>
              {people.map(p => (
                <tr key={p.user_id} tabIndex={0} role="button" onClick={() => setSelected(p)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setSelected(p); }}
                  className="cursor-pointer border-b border-[var(--pg-line)] hover:bg-[var(--pg-line)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground" aria-hidden="true">{monogram(p.name)}</span>
                      <span><span className="block font-medium">{p.name}</span>{p.email && <span className="block text-[10px] text-muted-foreground">{p.email}</span>}</span>
                    </span>
                  </td>
                  <td className="pr-3">{p.business_name ?? "\u2014"}</td>
                  <td className="pr-3">{p.enrollment_state === "fulfilled" ? "Enrolled" : p.enrollment_state}</td>
                  <td className="pr-3">{p.workspace_name ?? "\u2014"}</td>
                  <td className="pr-3">{p.enrolled_at ? new Date(p.enrolled_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true" aria-label={selected.name}>
          <div className="w-full max-w-md rounded-lg border border-[var(--pg-line)] bg-card p-5 shadow-lg">
            <div className="flex items-start justify-between">
              <div><h2 className="text-[16px] font-semibold">{selected.name}</h2><p className="mt-0.5 text-[11px] text-[var(--pg-muted)]">{selected.email}</p></div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close">✕</button>
            </div>
            <dl className="mt-4 space-y-2 text-[11px]">
              {selected.business_name && <div><dt className="text-muted-foreground">Business</dt><dd className="font-medium">{selected.business_name}</dd></div>}
              {selected.industry && <div><dt className="text-muted-foreground">Industry</dt><dd className="font-medium">{selected.industry}</dd></div>}
              {selected.team_size && <div><dt className="text-muted-foreground">Team size</dt><dd className="font-medium">{selected.team_size}</dd></div>}
              <div><dt className="text-muted-foreground">Enrollment</dt><dd className="font-medium">{selected.enrollment_state}</dd></div>
              <div><dt className="text-muted-foreground">Workspace</dt><dd className="font-medium">{selected.workspace_name ?? "Not provisioned"}</dd></div>
            </dl>
            <div className="mt-4 flex gap-3 text-[11px]">
              <Link to={viewPath("relationships", "Customers")} className="text-[var(--pg-muted)] underline underline-offset-2 hover:text-foreground">View in Customers →</Link>
              <Link to={viewPath("settings", "Billing")} className="text-[var(--pg-muted)] underline underline-offset-2 hover:text-foreground">View in Billing →</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
