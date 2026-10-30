export type ComposerScopeIdentity = Readonly<{
  tenantId: string;
  userId: string;
  focusedClientId: string;
  focusedBusinessMissionId: string;
}>;

type ComposerScopeIdentityCandidate = Readonly<{
  tenantId: string | null | undefined;
  userId: string | null | undefined;
  focusedClientId?: string | null;
  focusedBusinessMissionId?: string | null;
}>;

export const COMPOSER_FOCUS_NONE = "none";

export const COMPOSER_SCOPE_FIELDS = [
  "tenantId",
  "userId",
  "focusedClientId",
  "focusedBusinessMissionId",
] as const satisfies readonly (keyof ComposerScopeIdentity)[];

type MissingComposerScopeField = Exclude<
  keyof ComposerScopeIdentity,
  (typeof COMPOSER_SCOPE_FIELDS)[number]
>;
type AssertNoMissingComposerScopeField<T extends never> = T;
export type ComposerScopeFieldCoverage = AssertNoMissingComposerScopeField<MissingComposerScopeField>;

export function createComposerScopeIdentity(
  candidate: ComposerScopeIdentityCandidate,
): ComposerScopeIdentity | null {
  if (!candidate.tenantId || !candidate.userId) return null;
  return {
    tenantId: candidate.tenantId,
    userId: candidate.userId,
    focusedClientId: candidate.focusedClientId?.trim() || COMPOSER_FOCUS_NONE,
    focusedBusinessMissionId: candidate.focusedBusinessMissionId?.trim() || COMPOSER_FOCUS_NONE,
  };
}

export function composerScopeIdentityKey(identity: ComposerScopeIdentity): string {
  return JSON.stringify([
    identity.tenantId,
    identity.userId,
    identity.focusedClientId,
    identity.focusedBusinessMissionId,
  ]);
}
