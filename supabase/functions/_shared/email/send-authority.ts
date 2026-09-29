// Who may make the platform send a transactional email, and to whom.
//
// `send-transactional-email` sends from the platform's verified domain. Before this module it had no
// in-body check: the gateway's verify_jwt only asks for a validly signed token, and the publishable
// (anon) key IS one — it ships in the public site's JavaScript — so any visitor could send any
// template to any address with any content, From and Reply-To. That is an open relay on the domain
// every legitimate platform email depends on.
//
// The rule now:
//   * INTERNAL — a platform edge function or cron job (service-role bearer or cron token, through the
//     one shared gate `isAuthorizedInternalCaller`). It has already authorized its own caller and
//     derived the recipient, so it may send any template.
//   * USER — a verified signed-in person, for the few templates a person legitimately triggers from
//     the app. Each is listed below with WHO may send it and WHERE it may go; the recipient is bound
//     on the server, never taken from the request, except for platform-operator templates.
//   * Everyone else — no token, the publishable key alone, or a signed-in person asking for a
//     template not listed — is refused.
//
// Pure: every lookup is injected, so the decision is unit-tested without a network.

export type UserPolicy =
  /** Goes to the caller's own primary address. */
  | { kind: "self" }
  /** Sent by a platform operator (super_admin / platform_admin) to a person they are serving. */
  | { kind: "operator" }
  /** A broker's invite or note to one of their clients: goes to that client relationship's address,
   *  and only if the caller can read the relationship (row-level security decides who can). */
  | { kind: "broker_relationship" };

export const USER_SENDABLE_TEMPLATES: Readonly<Record<string, UserPolicy>> = Object.freeze({
  "support-ticket-created": { kind: "self" },
  "support-ticket-reply": { kind: "operator" },
  "support-ticket-resolved": { kind: "operator" },
  "feature-request-status-update": { kind: "operator" },
  "affiliate-commission-paid": { kind: "operator" },
  "affiliate-approved-welcome": { kind: "operator" },
  "broker-client-invite": { kind: "broker_relationship" },
});

export interface SendAuthorityDeps {
  /** Service-role bearer or valid cron token. */
  isInternalCaller(): Promise<boolean>;
  /** The verified signed-in user behind the bearer, or null (no token, the publishable key, expired). */
  verifiedUserId(): Promise<string | null>;
  /** is_platform_operator() for the verified caller. */
  callerIsOperator(): Promise<boolean>;
  /** The user's primary email (user_contact_methods). */
  primaryEmail(userId: string): Promise<string | null>;
  /** client_email of a broker relationship read AS THE CALLER, or null when the caller cannot see it. */
  relationshipEmail(relationshipId: string): Promise<string | null>;
}

export interface SendRequestFields {
  templateName: string;
  recipientEmail: string | null;
  recipientUserId: string | null;
  relationshipId: string | null;
}

export type SendAuthority =
  | { ok: true; kind: "internal" }
  | { ok: true; kind: "user"; userId: string; recipientEmail: string; recipientUserId: string | null }
  | { ok: false; status: 401 | 403 | 400; error: string };

export async function decideSendAuthority(
  req: SendRequestFields,
  deps: SendAuthorityDeps,
): Promise<SendAuthority> {
  if (await deps.isInternalCaller()) return { ok: true, kind: "internal" };

  const userId = await deps.verifiedUserId();
  if (!userId) return { ok: false, status: 401, error: "sign_in_required" };

  const policy = USER_SENDABLE_TEMPLATES[req.templateName];
  if (!policy) return { ok: false, status: 403, error: "template_not_user_sendable" };

  switch (policy.kind) {
    case "self": {
      const own = await deps.primaryEmail(userId);
      if (!own) return { ok: false, status: 403, error: "no_primary_email" };
      return { ok: true, kind: "user", userId, recipientEmail: own, recipientUserId: userId };
    }
    case "operator": {
      if (!(await deps.callerIsOperator())) return { ok: false, status: 403, error: "operator_required" };
      if (!req.recipientEmail) return { ok: false, status: 400, error: "recipient_required" };
      return {
        ok: true,
        kind: "user",
        userId,
        recipientEmail: req.recipientEmail,
        recipientUserId: req.recipientUserId,
      };
    }
    case "broker_relationship": {
      if (!req.relationshipId) return { ok: false, status: 400, error: "relationship_required" };
      const to = await deps.relationshipEmail(req.relationshipId);
      if (!to) return { ok: false, status: 403, error: "relationship_not_yours" };
      return { ok: true, kind: "user", userId, recipientEmail: to, recipientUserId: null };
    }
  }
}
