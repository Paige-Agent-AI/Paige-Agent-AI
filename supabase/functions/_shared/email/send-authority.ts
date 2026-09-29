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
//     the app. Each is listed below with WHO may send it and WHERE it may go; the recipient and the words are
//     bound on the server, never taken from the request, except for platform-operator templates.
//   * Everyone else — no token, the publishable key alone, or a signed-in person asking for a
//     template not listed — is refused.
//
// Pure: every lookup is injected, so the decision is unit-tested without a network.

export type UserPolicy =
  /** The confirmation for a support ticket the caller filed. Goes to the caller's sign-in address
   *  (not a user-settable contact field), is built only from that ticket's row, and is capped per
   *  hour. The caller names the ticket; nothing else in the request reaches the email. */
  | { kind: "own_ticket" }
  /** Sent by a platform operator (super_admin / platform_admin) to a person they are serving. */
  | { kind: "operator" };

export const USER_SENDABLE_TEMPLATES: Readonly<Record<string, UserPolicy>> = Object.freeze({
  "support-ticket-created": { kind: "own_ticket" },
  "support-ticket-reply": { kind: "operator" },
  "support-ticket-resolved": { kind: "operator" },
  "feature-request-status-update": { kind: "operator" },
  "affiliate-commission-paid": { kind: "operator" },
  "affiliate-approved-welcome": { kind: "operator" },
});

export interface SendAuthorityDeps {
  /** Service-role bearer or valid cron token. */
  isInternalCaller(): Promise<boolean>;
  /** The verified signed-in user behind the bearer, or null (no token, the publishable key, expired). */
  verifiedUserId(): Promise<string | null>;
  /** is_platform_operator() for the verified caller. */
  callerIsOperator(): Promise<boolean>;
  /** The address the user signs in with (auth.users), or null. */
  signInEmail(userId: string): Promise<string | null>;
  /** The support ticket with this id, only if this user filed it; otherwise null. */
  ownTicket(userId: string, ticketId: string): Promise<OwnTicket | null>;
  /** True when this caller is over the hourly cap for this template. */
  overHourlyLimit(userId: string, templateName: string, max: number): Promise<boolean>;
}

export interface OwnTicket {
  ticketNumber: string | null;
  subject: string | null;
  category: string | null;
  priority: string | null;
}

/** Hourly cap on support-ticket confirmations per person. */
export const TICKET_CONFIRMATIONS_PER_HOUR = 5;

export interface SendRequestFields {
  templateName: string;
  recipientEmail: string | null;
  recipientUserId: string | null;
  ticketId: string | null;
}

export type SendAuthority =
  | { ok: true; kind: "internal" }
  | {
    ok: true;
    kind: "user";
    userId: string;
    recipientEmail: string;
    recipientUserId: string | null;
    /** When set, replaces the caller's templateData entirely. */
    templateData?: Record<string, unknown>;
  }
  | { ok: false; status: 401 | 403 | 400 | 429; error: string };

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
    case "own_ticket": {
      if (!req.ticketId) return { ok: false, status: 400, error: "ticket_required" };
      const ticket = await deps.ownTicket(userId, req.ticketId);
      if (!ticket) return { ok: false, status: 403, error: "ticket_not_yours" };
      const email = await deps.signInEmail(userId);
      if (!email) return { ok: false, status: 403, error: "no_sign_in_email" };
      if (await deps.overHourlyLimit(userId, req.templateName, TICKET_CONFIRMATIONS_PER_HOUR)) {
        return { ok: false, status: 429, error: "rate_limited" };
      }
      return {
        ok: true,
        kind: "user",
        userId,
        recipientEmail: email,
        recipientUserId: userId,
        templateData: {
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          category: ticket.category,
          priority: ticket.priority,
        },
      };
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
  }
}
