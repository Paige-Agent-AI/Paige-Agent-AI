type OwnerEvidence = { primaryEmail: string; ownerUserId: string | null; emailVerified: boolean; signedCheckout: boolean };

type OwnerAuthority = {
  read(): Promise<OwnerEvidence | null>;
  create(input: { email: string; email_confirm: false; app_metadata: { solo_beta_protected_reference: string } }): Promise<void>;
  bind(ownerUserId: string): Promise<boolean>;
};

/** Auth never gives this checkout flow a session. The caller supplies a
 * service-only authority scoped by the protected receipt and browser grant. */
export async function prepareProtectedSoloOwner(referenceId: string, authority: OwnerAuthority) {
  let owner = await authority.read();
  if (!owner?.signedCheckout) return { ok: false, code: "owner_preparation_unavailable" } as const;
  if (!owner.ownerUserId) {
    try {
      await authority.create({
        email: owner.primaryEmail,
        email_confirm: false,
        app_metadata: { solo_beta_protected_reference: referenceId },
      });
    } catch {
      // Committing Auth can win before its response is lost, or another caller
      // can win the unique email. Adoption depends on the exact server marker.
    }
    owner = await authority.read();
  }
  if (!owner?.signedCheckout || !owner.ownerUserId || !await authority.bind(owner.ownerUserId)) {
    return { ok: false, code: "owner_preparation_unavailable" } as const;
  }
  return { ok: true, emailVerified: owner.emailVerified } as const;
}
