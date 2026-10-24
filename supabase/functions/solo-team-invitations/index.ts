import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/**
 * `expectedTenantId` is the workspace the caller believes it is acting in — the Team screen sends
 * the `tenant_id` it rendered the roster and the workspace name from; Paige sends the tenant the
 * conversation is about. It is NOT trusted here and is not resolved here. It travels to
 * `solo_team_invite_authority`, which proves the actor's active owner/admin membership in that exact
 * workspace and refuses otherwise. A client can therefore use it to ABORT a call and can never use
 * it to select a workspace it has no authority in.
 *
 * It is deliberately not defaulted, not inferred, and not validated into something plausible here.
 * The whole defect this endpoint was repaired for was a server that filled in a workspace nobody
 * named, so a missing value must reach the database and be refused there, by the one authority.
 */
type InviteAction =
  | {
      action: "create";
      expectedTenantId?: string;
      email?: string;
      permission?: string;
      jobTitle?: string;
      responsibilities?: string;
    }
  | { action: "resend" | "revoke" | "archive"; expectedTenantId?: string; inviteId?: string };

type PreparedInvite = {
  id?: string;
  token?: string;
  email?: string;
  expires_at?: string;
  tenant_id?: string;
};

/**
 * Every refusal this seam RAISES on purpose, as COMPLETE messages. Sourced from
 * `20261047000000`, which re-bodies the resolver and all three invitation functions and therefore
 * restates every validation raise itself — nothing from `20260901001520` executes on this path any
 * more. A sentence not on this list did not come from us, so it is not shown to anyone.
 *
 * MATCHED BY EQUALITY, NOT `includes()`. Round 3 of the adversarial read: Postgres embeds the
 * offending value in its own messages (`invalid input syntax for type uuid: "<value>"`), and
 * `inviteId` reaches the uuid cast unvalidated — so with substring matching a caller sending
 * `inviteId: "team invitation not found"` would have carried an authored phrase past the filter
 * and been shown raw PostgREST text. Every entry here is a whole message, so equality costs
 * nothing and closes it.
 */
const AUTHORED_REFUSALS = [
  // solo_team_invite_authority
  "not authorized to manage team invitations",
  "the workspace for this invitation was not named",
  "only an owner or admin may manage team invitations in that workspace",
  // create_solo_team_invite
  "team invitations may grant only Admin or Member",
  "a valid email address is required",
  "work profile is too long",
  "this person already belongs to the workspace",
  // resend_solo_team_invite
  "team invitation not found",
  "an accepted invitation cannot be resent",
  // revoke_solo_team_invite
  "pending team invitation not found",
  // archive_solo_team_invite. On this list because these two sentences were WRITTEN for an
  // operator; a raise that is not listed here is replaced with a generic line, which for
  // "revoke it before clearing it" would hide the one instruction that resolves the refusal.
  "that invitation is not on this workspace",
  "that invitation is still live; revoke it before clearing it",
  // this function's own throws
  "not authorized: this invitation resolved to a different workspace than the one requested",
  "Invitation could not be prepared",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization") ?? "";
  if (!url || !anonKey || !serviceKey || !authorization.startsWith("Bearer ")) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const authed = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: userError } = await authed.auth.getUser();
  if (userError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  let body: InviteAction;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid request" }, 400); }
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Passed through untouched, including when absent. `?? null` rather than a fallback: the database
  // is the only thing entitled to decide that a workspace was not named.
  const expectedTenantId = typeof body.expectedTenantId === "string" ? body.expectedTenantId : null;

  // A DEPLOY-WINDOW REFUSAL, not an authorization one. Migrations, edge functions and the
  // frontend ship as three independent pipelines off one merge, so an operator holding an
  // already-loaded Team page across the deploy sends the pre-merge body, with no workspace in
  // it. Without this they would hit the database's authority refusal and be told they may not
  // manage invitations — false, and the exact class of false statement this endpoint was just
  // repaired to stop making. Say what actually happened and what fixes it.
  //
  // This does NOT weaken the server-side proof: the database refuses a missing workspace
  // independently, and a caller still cannot select a workspace it has no authority in.
  if (!expectedTenantId) {
    return json({
      ok: false,
      error: "This page is out of date, so it could not say which workspace to invite into. Reload Team and try again.",
    }, 400);
  }

  try {
    if (body.action === "revoke") {
      if (!body.inviteId) return json({ ok: false, error: "Invitation is required" }, 400);
      const { error } = await admin.rpc("revoke_solo_team_invite", {
        _actor: user.id,
        _expected_tenant_id: expectedTenantId,
        _invite_id: body.inviteId,
      });
      if (error) throw error;
      return json({ ok: true, state: "revoked" });
    }

    // ARCHIVE. Clearing a finished invitation off the operator's list — deliberately NOT a delete.
    // A revoked invitation is evidence that somebody's access was withdrawn, and #799 removed the
    // browser roles' DELETE on the sibling membership table for that same reason. Like revoke, it
    // sends no email, so it returns before the send block below.
    if (body.action === "archive") {
      if (!body.inviteId) return json({ ok: false, error: "Invitation is required" }, 400);
      const { error } = await admin.rpc("archive_solo_team_invite", {
        _actor: user.id,
        _expected_tenant_id: expectedTenantId,
        _invite_id: body.inviteId,
      });
      if (error) throw error;
      return json({ ok: true, state: "archived" });
    }

    let invite: PreparedInvite | null = null;
    if (body.action === "create") {
      const { data, error } = await admin.rpc("create_solo_team_invite", {
        _actor: user.id,
        _expected_tenant_id: expectedTenantId,
        _email: String(body.email ?? ""),
        _permission: String(body.permission ?? "member"),
        _job_title: body.jobTitle ?? null,
        _responsibilities: body.responsibilities ?? null,
      });
      if (error) throw error;
      invite = data as PreparedInvite | null;
    } else if (body.action === "resend") {
      if (!body.inviteId) return json({ ok: false, error: "Invitation is required" }, 400);
      const { data, error } = await admin.rpc("resend_solo_team_invite", {
        _actor: user.id,
        _expected_tenant_id: expectedTenantId,
        _invite_id: body.inviteId,
      });
      if (error) throw error;
      invite = data as PreparedInvite | null;
    } else {
      return json({ ok: false, error: "Unsupported action" }, 400);
    }

    if (!invite?.token || !invite.email) throw new Error("Invitation could not be prepared");
    // The database now returns the workspace it actually acted in. Checking it here costs one
    // comparison and means a reintroduced fallback surfaces as a refusal instead of as a token in a
    // stranger's inbox. Checked BEFORE the send, because an email cannot be recalled.
    if (expectedTenantId && invite.tenant_id && invite.tenant_id !== expectedTenantId) {
      throw new Error("not authorized: this invitation resolved to a different workspace than the one requested");
    }
    const { data: sendData, error: sendError } = await admin.functions.invoke("send-portal-invite", {
      // Keep the already verified human caller at the shared sender boundary;
      // the service client prepares native records but is not a human identity.
      headers: { Authorization: authorization },
      body: { token: invite.token, email: invite.email },
    });
    const emailed = !sendError && sendData?.emailed === true;
    return json({
      ok: true,
      invitationId: invite.id,
      expiresAt: invite.expires_at,
      tenantId: invite.tenant_id ?? null,
      emailed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Team invitation failed";
    // An authority refusal is a 403, not a generic 400. `was not named` is listed explicitly: it is
    // an authorization refusal from the same resolver, but its wording contains none of the older
    // phrases, and a §37 response-consumer miss here would silently downgrade it to a 400.
    const denied = /only an owner|only an owner or admin|not authorized|was not named/i.test(message);
    // ONLY THE SENTENCES THIS SEAM AUTHORED TRAVEL TO A PERSON.
    //
    // The Team screen now shows this string verbatim — which is the point, because these sentences
    // were written for an operator. But `message` is whatever was thrown, and a PostgrestError's
    // message is raw Postgres/PostgREST text. During this very PR's deploy window (migrations,
    // edge functions and the frontend are three independent pipelines off one merge) PostgREST
    // answers PGRST202 and the operator would have read
    //   "Could not find the function public.create_solo_team_invite(_actor, _email, …) in the
    //    schema cache"
    // — a backend function signature in product copy (§11), and useless to the person reading it.
    // Same class for an invalid-uuid cast or any unhandled raise inside the RPC.
    //
    // So the honest sentences pass through and everything else is logged and replaced. Caught by
    // the second round of adversarial review, on a fix from the first.
    const authored = AUTHORED_REFUSALS.includes(message);
    if (!authored) console.error("[solo-team-invitations] unrecognised failure:", message);
    return json({
      ok: false,
      error: authored
        ? message
        : "The invitation could not be completed just now. Reload Team and try again — if it keeps happening, tell us.",
    }, denied ? 403 : authored ? 400 : 500);
  }
});
