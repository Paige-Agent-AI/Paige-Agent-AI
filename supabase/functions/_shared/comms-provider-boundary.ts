/** Server-only provider authority floor. This does not grant send authorization. */
export const COMMS_PROVIDER_EXECUTION_DISABLED = "COMMS_PROVIDER_EXECUTION_DISABLED";
export type CommsProviderScope = {
  tenantId?: string | null;
  actorUserId?: string | null;
  recipientEmail?: string | null;
};
export type CommsProviderBoundaryClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
export async function commsProviderExecutionAllowed(
  admin: CommsProviderBoundaryClient,
  scope: CommsProviderScope,
): Promise<boolean> {
  if (!scope || (!scope.tenantId && !scope.actorUserId && !scope.recipientEmail)) return false;
  try {
    const { data, error } = await admin.rpc("comms_provider_execution_allowed", {
      _tenant_id: scope.tenantId ?? null,
      _actor_user_id: scope.actorUserId ?? null,
      _recipient_email: scope.recipientEmail ?? null,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

