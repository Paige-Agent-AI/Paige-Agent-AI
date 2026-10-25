export function useCommandCenter() {
  const query = new URLSearchParams(location.search);
  const approval = query.get("state") === "approval";
  return {
    accountEpoch: query.get("workspace") === "b" ? "test-tenant-b" : "test-tenant-a",
    approvals: approval ? [{ id: "test-approval", dept: "Operations", title: "Review an internal project note",
      preview: "Synthetic decision only. No backend or business action.", type: "Draft", urgency: "today", aging: "1h" }] : [],
    metrics: [], departments: [], attention: null,
    greeting: { name: "Owner", dateLabel: "Saturday, August 29", summary: "One signal needs attention." },
    loading: false, isError: false, refresh: () => undefined,
    // Deliberately pending fixture ports, never an execution or a success receipt.
    approve: () => new Promise(() => {}), decline: () => new Promise(() => {}),
  };
}
