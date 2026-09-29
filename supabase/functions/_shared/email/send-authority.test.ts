// Executed proof for who may make the platform send a transactional email (send-authority.ts).
// Runs under Deno in CI (ci.yml).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideSendAuthority,
  safeFromDisplayName,
  type SendAuthorityDeps,
  type SendRequestFields,
  USER_SENDABLE_TEMPLATES,
} from "./send-authority.ts";

const USER = "00000000-0000-4000-8000-0000000000u1";
const TICKET = "00000000-0000-4000-8000-0000000000t1";

// A caller as the send function sees it. The publishable key is a signed token with no user in it,
// so it reaches the function as "not internal, no verified user" — exactly the no-token case.
function caller(o: {
  internal?: boolean;
  userId?: string | null;
  operator?: boolean;
  signIn?: string | null;
  ownsTicket?: boolean;
  ticketNumber?: string;
  overLimit?: boolean;
  overPlatformLimit?: boolean;
}): SendAuthorityDeps {
  return {
    isInternalCaller: async () => o.internal === true,
    verifiedUserId: async () => o.userId ?? null,
    callerIsOperator: async () => o.operator === true,
    signInEmail: async () => o.signIn ?? null,
    ownTicket: async (userId, id) =>
      o.ownsTicket && userId === USER && id === TICKET
        ? { ticketNumber: o.ticketNumber ?? "PT-01042", category: "technical_issue", priority: "normal" }
        : null,
    overHourlyLimit: async () => o.overLimit === true,
    overPlatformHourlyLimit: async () => o.overPlatformLimit === true,
  };
}

const req = (p: Partial<SendRequestFields>): SendRequestFields => ({
  templateName: "role-invitation",
  recipientEmail: "victim@elsewhere.test",
  recipientUserId: null,
  ticketId: null,
  ...p,
});

Deno.test("no token is refused", async () => {
  assertEquals(await decideSendAuthority(req({}), caller({})), { ok: false, status: 401, error: "sign_in_required" });
});

Deno.test("the publishable key alone is refused, for every template including the user ones", async () => {
  for (const templateName of ["role-invitation", "solo-beta-welcome", ...Object.keys(USER_SENDABLE_TEMPLATES)]) {
    const d = await decideSendAuthority(req({ templateName, ticketId: TICKET }), caller({ userId: null }));
    assertEquals(d, { ok: false, status: 401, error: "sign_in_required" }, templateName);
  }
});

Deno.test("an internal platform caller may send any template to the recipient it resolved", async () => {
  assertEquals(await decideSendAuthority(req({}), caller({ internal: true })), { ok: true, kind: "internal" });
});

Deno.test("a signed-in person cannot send a template that is not user-sendable", async () => {
  const names = ["role-invitation", "broker-client-invite", "affiliate-application-received", "constructor", "toString", "__proto__", "hasOwnProperty"];
  for (const templateName of names) {
    assertEquals(
      await decideSendAuthority(req({ templateName }), caller({ userId: USER })),
      { ok: false, status: 403, error: "template_not_user_sendable" },
      templateName,
    );
  }
});

Deno.test("a ticket confirmation needs a ticket the caller filed", async () => {
  const t = "support-ticket-created";
  assertEquals(
    await decideSendAuthority(req({ templateName: t }), caller({ userId: USER, ownsTicket: true, signIn: "me@solo.test" })),
    { ok: false, status: 400, error: "ticket_required" },
  );
  assertEquals(
    await decideSendAuthority(req({ templateName: t, ticketId: TICKET }), caller({ userId: USER, signIn: "me@solo.test" })),
    { ok: false, status: 403, error: "ticket_not_yours" },
  );
  assertEquals(
    await decideSendAuthority(
      req({ templateName: t, ticketId: TICKET }),
      caller({ userId: USER, ownsTicket: true, signIn: "me@solo.test", overLimit: true }),
    ),
    { ok: false, status: 429, error: "rate_limited" },
  );
  assertEquals(
    await decideSendAuthority(
      req({ templateName: t, ticketId: TICKET }),
      caller({ userId: USER, ownsTicket: true, signIn: "me@solo.test", overPlatformLimit: true }),
    ),
    { ok: false, status: 429, error: "rate_limited" },
  );
});

Deno.test("a ticket confirmation carries no caller-written text: a rewritten ticket number is dropped", async () => {
  const d = await decideSendAuthority(
    req({ templateName: "support-ticket-created", ticketId: TICKET }),
    caller({ userId: USER, ownsTicket: true, signIn: "me@solo.test", ticketNumber: "Your account is locked, visit evil.test" }),
  );
  assertEquals(d.ok && d.kind === "user" ? d.templateData : null, {
    ticketNumber: null,
    category: "technical_issue",
    priority: "normal",
  });
});

Deno.test("a ticket confirmation goes to the sign-in address, with words from the ticket row only", async () => {
  const d = await decideSendAuthority(
    req({ templateName: "support-ticket-created", ticketId: TICKET }),
    caller({ userId: USER, ownsTicket: true, signIn: "me@solo.test" }),
  );
  assertEquals(d, {
    ok: true,
    kind: "user",
    userId: USER,
    recipientEmail: "me@solo.test",
    recipientUserId: USER,
    templateData: { ticketNumber: "PT-01042", category: "technical_issue", priority: "normal" },
  });
});

Deno.test("an operator template needs a platform operator", async () => {
  assertEquals(
    await decideSendAuthority(req({ templateName: "support-ticket-reply" }), caller({ userId: USER })),
    { ok: false, status: 403, error: "operator_required" },
  );
  assertEquals(
    await decideSendAuthority(req({ templateName: "support-ticket-reply" }), caller({ userId: USER, operator: true })),
    { ok: true, kind: "user", userId: USER, recipientEmail: "victim@elsewhere.test", recipientUserId: null },
  );
});

Deno.test("a tenant-chosen From name is a plain short label or nothing", () => {
  assertEquals(safeFromDisplayName("Summit Advisory & Co."), "Summit Advisory & Co.");
  assertEquals(safeFromDisplayName("  Summit \n Advisory "), "Summit Advisory");
  for (const bad of [
    "Account locked, visit https://evil.test",
    "Verify at www.evil.test",
    "Support <help@evil.test>",
    'Quote " break',
    "x".repeat(61),
    "",
    null,
  ]) {
    assertEquals(safeFromDisplayName(bad), null, String(bad));
  }
});
