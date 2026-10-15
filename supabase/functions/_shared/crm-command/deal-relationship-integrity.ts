/** Read-side diagnostics only. A title match never authorizes relationship assignment. */
export type UnlinkedDealCandidate = {
  id: string;
  tenant_id: string;
  contact_client_id: string | null;
  title: string;
  pipeline_id: string;
  stage_id: string;
  status: string;
};

const words = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Only receives a client reference already authorized by the shared Chat scope. */
export function preserveResolvedDealClient(
  command: Record<string, unknown>, resolvedClientRef: string | null,
): Record<string, unknown> {
  if (command.action !== "deal.create" || !resolvedClientRef
    || command.client_ref !== undefined || (command.contact_id !== undefined && command.contact_id !== null)) return { ...command };
  return { ...command, client_ref: resolvedClientRef };
}

export const UNLINKED_DEAL_REASONS = ["anonymous_prospect", "early_stage_prospect", "import_pending_identity"] as const;

export function dealCreateRelationshipIssue(command: Record<string, unknown>): string | null {
  if (command.action !== "deal.create") return command.unlinked_reason === undefined ? null : "Unlinked intent is only valid for deal creation.";
  const hasClient = typeof command.client_ref === "string" && command.client_ref.trim().length > 0
    || typeof command.contact_id === "string" && command.contact_id.trim().length > 0;
  if (hasClient) return command.unlinked_reason === undefined ? null : "Choose a resolved client or an intentionally unlinked prospect, not both.";
  if (UNLINKED_DEAL_REASONS.includes(command.unlinked_reason as typeof UNLINKED_DEAL_REASONS[number])) return null;
  return "Resolve the canonical client first. If the named client is ambiguous or unresolved, ask; only an explicitly unlinked prospect may omit the relationship.";
}

export function projectDealRelationshipIntegrity(input: {
  tenantId: string;
  linkedDealCount: number;
  clientLabels: string[];
  unlinkedDeals: UnlinkedDealCandidate[];
  queryFailed: boolean;
  truncated: boolean;
}) {
  if (input.queryFailed) return {
    status: "UNVERIFIED", next_action: "RETRY_READ", can_auto_link: false,
    explanation: "The relationship check failed. Do not conclude that no opportunity exists or create a replacement.",
    candidates: [],
  };
  const labels = input.clientLabels.map(words).filter((label) => label.length >= 3);
  const candidates = input.unlinkedDeals.filter((deal) =>
    deal.tenant_id === input.tenantId && deal.contact_client_id === null
    && labels.some((label) => (` ${words(deal.title)} `).includes(` ${label} `))
  ).map(({ id, title, pipeline_id, stage_id, status }) => ({ id, title, pipeline_id, stage_id, status }));
  return {
    status: candidates.length ? "POSSIBLE_RELATIONSHIP_GAP" : input.linkedDealCount ? "LINKED" : "NO_LINKED_DEALS_IN_CHECKED_SCOPE",
    next_action: candidates.length ? "ASK_USER" : input.truncated ? "CONTINUE_READ" : "READ_WORKSPACE_BEFORE_NEW_CREATE",
    can_auto_link: false,
    matching_basis: "title resemblance only; not canonical relationship evidence",
    truncated: input.truncated,
    explanation: candidates.length
      ? "Unlinked opportunities in this workspace resemble this client. Do not claim no deal exists, create a replacement or assign on name alone. Resolve canonical evidence or ask the owner; any assignment uses governed deal.assign_contact."
      : "This is a bounded relationship read, not proof that an opportunity does not exist.",
    candidates,
  };
}
