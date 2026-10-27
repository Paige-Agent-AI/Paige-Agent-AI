// _shared/agreements/notify.ts — telling people what happened (INT-163).
//
// THE RULE THIS FILE EXISTS TO HOLD: a failed notification NEVER changes the record. Sealing is the
// legal act; an email announces it. If the announcement fails, the agreement is still completed, the
// signature still stands, and what we do is log loudly and let the owner see the truth in their
// workspace. Rolling back a sealed legal document because a mail provider had a bad minute would be
// destroying evidence to fix a delivery problem.
//
// Everything here therefore returns an outcome and throws nothing at its callers.

export type NotifyOutcome = { sent: boolean; reason?: string };

interface NotifyInput {
  supabaseUrl: string;
  serviceKey: string;
  templateName: string;
  recipientEmail: string;
  tenantId: string;
  /** Recorded on the send log for observability. The shared sender does NOT dedupe on it. */
  idempotencyKey: string;
  templateData: Record<string, unknown>;
}

export async function notify(input: NotifyInput): Promise<NotifyOutcome> {
  // Absent provider is an honest outcome, not an error to bury. The send path refuses BEFORE
  // freezing an agreement for exactly this reason; by the time we are notifying, the act has
  // already happened and there is nothing to undo. send-transactional-email sends through SendGrid with the
  // platform Mail Send key (Experience 03), so that key is the provider this checks for.
  if (!Deno.env.get("SENDGRID_MAIL_SEND_API_KEY")) {
    console.warn("[agreements] no email provider configured — notification not sent", {
      template: input.templateName,
    });
    return { sent: false, reason: "needs_config" };
  }
  try {
    const res = await fetch(`${input.supabaseUrl}/functions/v1/send-transactional-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.serviceKey}`,
        apikey: input.serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        templateName: input.templateName,
        recipientEmail: input.recipientEmail,
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
        templateData: input.templateData,
      }),
    });
    // A 200 IS NOT A DELIVERY. `send-transactional-email` answers a suppressed recipient with HTTP
    // 200 and `{success:false, reason:'email_suppressed'}` — so testing the status code alone
    // reported a completion notice as sent when nothing left the building. A notification that
    // claims to have gone out and did not is the §13 failure this whole file is built around.
    let body: Record<string, unknown> = {};
    try { body = await res.json(); } catch { /* non-JSON → not a delivery */ }
    if (!res.ok || body?.success !== true) {
      console.error("[agreements] notification not delivered", {
        template: input.templateName,
        status: res.status,
        reason: String(body?.reason ?? body?.error ?? "unknown").slice(0, 120),
      });
      return { sent: false, reason: String(body?.reason ?? `sender_${res.status}`) };
    }
    return { sent: true };
  } catch (e) {
    console.error("[agreements] notification could not be delivered", {
      template: input.templateName, error: String(e),
    });
    return { sent: false, reason: "unreachable" };
  }
}

/**
 * Who to tell when something happens on an agreement.
 *
 * Resolved rather than assumed: `tenants` carries no contact column (its `brand` jsonb holds a
 * `support_email`, which is a PUBLIC-facing address and the wrong place to send "somebody signed
 * your contract"). So this walks the workspace's own OWNER membership to that person's account
 * address, preferring an explicit brand support address only if no owner can be resolved.
 *
 * Returns null rather than a guess. A notification sent to the wrong address is worse than one that
 * did not go: the caller logs the gap and the owner still sees the truth in their workspace.
 */
export async function ownerNotificationEmail(
  db: { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => Promise<any> } } },
  tenantId: string,
): Promise<string | null> {
  const { data: owner } = await db.from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId).eq("role", "owner").eq("status", "active")
    .order("joined_at", { ascending: true })
    .limit(1).maybeSingle();

  if (owner?.user_id) {
    try {
      const { data } = await db.auth.admin.getUserById(String(owner.user_id));
      const email = data?.user?.email as string | undefined;
      if (email && email.includes("@")) return email;
    } catch (e) {
      console.error("[agreements] owner address could not be resolved", { tenantId, error: String(e) });
    }
  }

  const { data: tenant } = await db.from("tenants").select("brand").eq("id", tenantId).maybeSingle();
  const support = (tenant?.brand as { support_email?: string } | null)?.support_email;
  return support && support.includes("@") ? support : null;
}

/**
 * The address the ESIGN disclosure tells a signer to contact for a paper copy or to withdraw consent.
 *
 * WHY THIS IS NOT COSMETIC. Items 1, 3, 4 and 6 of the disclosure promise the signer a route to a
 * human. The first version of this interpolated the literal string "the sender of this agreement",
 * so every signer read "contact Acme at the sender of this agreement" — and, because the disclosure
 * is hashed into the consent evidence, that defective notice was permanently recorded as the thing
 * they agreed to. A promise addressed to nobody is worse than no promise.
 *
 * Prefers the workspace's public support address, because this one is meant to be given out, and
 * falls back to the owner's own address. Returns null when there is neither — and the send path
 * REFUSES on null rather than shipping a notice with a hole in it.
 */
export async function tenantContactForDisclosure(
  db: { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => Promise<any> } } },
  tenantId: string,
): Promise<string | null> {
  const { data: tenant } = await db.from("tenants").select("brand").eq("id", tenantId).maybeSingle();
  const support = (tenant?.brand as { support_email?: string } | null)?.support_email;
  if (support && support.includes("@")) return support;
  return await ownerNotificationEmail(db, tenantId);
}
