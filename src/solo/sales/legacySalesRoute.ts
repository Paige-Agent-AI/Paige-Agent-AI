/** Navigation compatibility only: account authorization remains with the Solo shell. */
export function legacySalesRoute(account: string | null, segment: string, search: string, hash: string): string | null {
  if (!account || !["sales", "pipeline", "catalog"].includes(segment)) return null;
  const query = new URLSearchParams(search);
  if (segment === "catalog" && ["all", "page", "form", "funnel"].includes(query.get("type") ?? "")) return null;
  for (const key of ["returnTo", "redirect", "next", "tenant", "tenantId", "tenant_id", "account", "role", "token", "access_token", "refresh_token"]) query.delete(key);
  let destination = segment === "pipeline" ? "pipeline" : segment === "catalog" ? "offers" : "overview";
  if (segment === "sales") {
    const view = query.get("view");
    // Clients returns and unfinished editor handoffs take precedence over a stale view.
    if (query.get("resume") === "terms" || view === "terms" || view === "agreements") {
      destination = "agreements";
      query.delete("view");
    } else if (["invoices", "recurring", "payments", "revenue", "scenarios"].includes(view ?? "")) destination = "payments";
    else query.delete("view");
  }
  const suffix = query.toString();
  return `/solo/${encodeURIComponent(account)}/sales/${destination}${suffix ? `?${suffix}` : ""}${hash}`;
}
