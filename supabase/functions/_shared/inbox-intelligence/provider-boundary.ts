// QA #1832 — the Communications/managed-sender no-real-provider-execution boundary.
//
// ONE server-side seam every tenant-scoped provider rail consults before dispatch:
// a synthetic QA workspace (tenants.features->>'qa_no_provider_execution' = 'true',
// set by the Identity lane at provisioning) can READ everything its role allows but
// can never cause an actual email/SMS/voice provider effect, credential use, or
// spend — fail-closed at the marker, regardless of connector state or provisioning.
//
// Failure mode of the CHECK itself: a transient lookup error answers NOT blocked —
// an erroneous refusal for every ordinary tenant would be the blanket send shutdown
// the assignment forbids; the marker is the fail-closed element, not a DB blip.
// Ordinary tenants (marker false/absent) are byte-for-byte unchanged.
//
// Enforced at: send-message (the ONE unified rail — direct sends, the governed
// comms-email executor, marketing dispatch, the scheduled drainer's releases, and
// every retry that re-enters it) and send-transactional-email (tenant flows:
// invites, welcome, booking, notifications). Pure module: no Deno imports.

export const QA_NO_PROVIDER_EXECUTION_CODE = "QA_NO_PROVIDER_EXECUTION";

/** The minimal admin surface the boundary needs (structural for tests). */
export interface BoundaryAdmin {
  rpc(name: "tenant_blocks_provider_execution", args: { p_tenant: string }): Promise<{ data: unknown; error: unknown }>;
}

export const QA_BOUNDARY_REFUSAL_NOTE =
  "This is a synthetic QA workspace: real provider sends are disabled on the server. Nothing was sent, and nothing can be sent from this workspace.";

export async function providerExecutionBlocked(admin: BoundaryAdmin, tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const { data, error } = await admin.rpc("tenant_blocks_provider_execution", { p_tenant: tenantId });
    if (error) return false; // see header: a check blip is never a blanket shutdown
    return data === true;
  } catch {
    return false;
  }
}
