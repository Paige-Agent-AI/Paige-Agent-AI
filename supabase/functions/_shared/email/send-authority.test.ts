// Executed proof for who may make the platform send a transactional email (send-authority.ts).
// Runs under Deno in CI (ci.yml).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideSendAuthority, type SendAuthorityDeps, type SendRequestFields } from "./send-authority.ts";

const USER = "00000000-0000-4000-8000-0000000000u1";
const REL = "00000000-0000-4000-8000-0000000000r1";

// A caller as the send function sees it. The publishable key is a signed token with no user in it,
// so it reaches the function as "not internal, no verified user" — exactly the no-token case.
function caller(o: {
  internal?: boolean;
  userId?: string | null;
  operator?: boolean;
  primary?: string | null;
  canSeeRelationship?: boolean;
}): SendAuthorityDeps {
  return {
    isInternalCaller: async () => o.internal === true,
    verifiedUserId: async () => o.userId ?? null,
    callerIsOperator: async () => o.operator === true,
    primaryEmail: async () => o.primary ?? null,
    relationshipEmail: async (id) => (o.canSeeRelationship && id === REL ? "client@broker.test" : null),
  };
}

const req = (p: Partial<SendRequestFields>): SendRequestFields => ({
  templateName: "role-invitation",
  recipientEmail: "victim@elsewhere.test",
  recipientUserId: null,
  relationshipId: null,
  ...p,
});

Deno.test("no token is refused", async () => {
  assertEquals(await decideSendAuthority(req({}), caller({})), { ok: false, status: 401, error: "sign_in_required" });
});

Deno.test("the publishable key alone is refused, for every template including the user ones", async () => {
  for (const templateName of ["role-invitation", "support-ticket-created", "broker-client-invite", "solo-beta-welcome"]) {
    const d = await decideSendAuthority(req({ templateName, relationshipId: REL }), caller({ userId: null }));
    assertEquals(d.ok, false, templateName);
  }
});

Deno.test("an internal platform caller may send any template to the recipient it resolved", async () => {
  assertEquals(await decideSendAuthority(req({}), caller({ internal: true })), { ok: true, kind: "internal" });
});

Deno.test("a signed-in person cannot send a template that is not user-sendable", async () => {
  assertEquals(
    await decideSendAuthority(req({ templateName: "role-invitation" }), caller({ userId: USER })),
    { ok: false, status: 403, error: "template_not_user_sendable" },
  );
});

Deno.test("a self template goes to the caller's own address, whatever recipient the request names", async () => {
  assertEquals(
    await decideSendAuthority(req({ templateName: "support-ticket-created" }), caller({ userId: USER, primary: "me@solo.test" })),
    { ok: true, kind: "user", userId: USER, recipientEmail: "me@solo.test", recipientUserId: USER },
  );
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

Deno.test("a broker invite goes to the relationship's client, and only if the caller can see it", async () => {
  const t = "broker-client-invite";
  assertEquals(
    await decideSendAuthority(req({ templateName: t }), caller({ userId: USER, canSeeRelationship: true })),
    { ok: false, status: 400, error: "relationship_required" },
  );
  assertEquals(
    await decideSendAuthority(req({ templateName: t, relationshipId: REL }), caller({ userId: USER })),
    { ok: false, status: 403, error: "relationship_not_yours" },
  );
  assertEquals(
    await decideSendAuthority(req({ templateName: t, relationshipId: REL }), caller({ userId: USER, canSeeRelationship: true })),
    { ok: true, kind: "user", userId: USER, recipientEmail: "client@broker.test", recipientUserId: null },
  );
});
