// #1140 — comms-mailbox-command: the governed door for reversible Gmail mailbox
// organization. Mirrors comms-email-command's shape (authenticated actor,
// server-derived tenant, owner/admin seat, canonical single-use approval,
// decideDeclaredCapability, decision receipt, execute the STORED call) minus the
// email operation machinery organize does not need: organize kinds are idempotent
// state transitions with exact undos, not one-shot sends.
//
// The door alone: resolves the message + mailbox policy server-side (personal
// mailboxes answer ONLY to the bound owner; inactive connectors refuse — revoked
// consent), verifies the gmail.modify scope, claims the approval, performs ONE
// provider call (labels.modify / messages.trash / messages.untrash — there is no
// delete path in this door at all), records the canonical mirror + undo window,
// and reads the result back. Unsubscribe one-click targets come ONLY from the
// message's own recorded List-Unsubscribe header, never from the request.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { confirmFingerprint } from "../_shared/confirm-fingerprint.ts";
import { decideDeclaredCapability } from "../_shared/capability-kit/decision.ts";
import { COMMS_MAILBOX_ORGANIZE_CAPABILITY } from "../_shared/paige-spine/domains/comms.ts";
import { COMMS_MAILBOX_ORGANIZE_TOOL, parseOrganizeCommand, unsubscribeHttpsTarget, UUID, type OrganizeCommand } from "../_shared/inbox-intelligence/organize.ts";
import { decideContentRead, hasOrganizeScope } from "../_shared/inbox-intelligence/policy.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json", "Cache-Control": "no-store" };
const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const refused = (status: number, code: string, note?: string) => response(status, { ok: false, outcome: "refused", code, ...(note ? { note } : {}) });

const KIND_SUMMARY: Record<string, string> = {
  label: "add a label", unlabel: "remove a label", archive: "archive", unarchive: "unarchive",
  trash: "move to Trash (recoverable)", untrash: "restore from Trash",
  unsubscribe_propose: "unsubscribe from this mailing list", unsubscribe_send: "send the unsubscribe request",
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return refused(405, "METHOD_NOT_ALLOWED");
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, serviceKey);
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return refused(401, "UNAUTHENTICATED");

  let body: Record<string, unknown> & { expected_tenant_id: string };
  let command: OrganizeCommand;
  try {
    const raw = await req.text();
    if (raw.length > 20000) throw new TypeError("BODY_TOO_LARGE");
    const parsed = object(JSON.parse(raw));
    if (!parsed || !["expected_tenant_id", "command", "approved_fingerprint"].every((key) => key in parsed || key === "approved_fingerprint")
      || Object.keys(parsed).some((key) => !["expected_tenant_id", "command", "approved_fingerprint"].includes(key))) throw new TypeError("INVALID_BODY");
    if (typeof parsed.expected_tenant_id !== "string" || !UUID.test(parsed.expected_tenant_id)) throw new TypeError("INVALID_SCOPE");
    if (parsed.approved_fingerprint !== undefined && (typeof parsed.approved_fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(parsed.approved_fingerprint))) throw new TypeError("INVALID_FINGERPRINT");
    command = parseOrganizeCommand(parsed.command);
    body = { ...parsed, expected_tenant_id: parsed.expected_tenant_id.toLowerCase() } as typeof body;
  } catch { return refused(400, "MAILBOX_COMMAND_INVALID"); }

  const { data: tenantId, error: tenantError } = await caller.rpc("current_user_tenant_id");
  if (tenantError || typeof tenantId !== "string" || tenantId !== body.expected_tenant_id) return refused(409, "WORKSPACE_CHANGED");
  const stillCurrent = async () => {
    const { data, error } = await caller.rpc("current_user_tenant_id");
    return !error && data === tenantId;
  };
  const { data: member } = await admin.from("tenant_members").select("role,status").eq("tenant_id", tenantId).eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (!["owner", "admin"].includes(member?.role ?? "")) return refused(403, "MAILBOX_FORBIDDEN", "Only a business owner or admin can organize the connected mailbox.");
  const { data: profile, error: profileError } = await admin.from("profiles").select("active_tenant_id").eq("user_id", user.id).maybeSingle();
  if (profileError) return refused(503, "MAILBOX_AUTHORITY_UNAVAILABLE");
  if (typeof profile?.active_tenant_id !== "string" || profile.active_tenant_id.toLowerCase() !== tenantId) return refused(409, "WORKSPACE_CHANGED");

  // Resolve the message + its mailbox SERVER-side. Nothing about the mailbox is
  // ever taken from the request.
  if (!(await stillCurrent())) return refused(409, "WORKSPACE_CHANGED");
  const { data: messageRow, error: messageError } = await admin.from("messages")
    .select("id,tenant_id,connector_id,subject,meta,provider_message_id,thread_key")
    .eq("id", command.message_id).eq("tenant_id", tenantId).maybeSingle();
  if (messageError || !messageRow?.connector_id) return refused(422, "MESSAGE_NOT_IN_WORKSPACE");

  const { data: connector, error: connectorError } = await admin.from("channel_connectors")
    .select("id,tenant_id,provider,mailbox_class,mailbox_owner_user_id,mailbox_scopes,status,active,inbound_address,credentials_vault_ref")
    .eq("id", messageRow.connector_id).maybeSingle();
  if (connectorError || !connector || connector.tenant_id !== tenantId) return refused(422, "MESSAGE_NOT_IN_WORKSPACE");

  // THE two-mailbox policy, enforced here on every command (undo included).
  const policy = decideContentRead({ callerUserId: user.id, callerTenantId: tenantId, mailboxTenantId: connector.tenant_id, mailbox: connector });
  if (!policy.allowed) {
    const note = policy.code === "MAILBOX_INACTIVE"
      ? "That mailbox is disconnected, so its messages cannot be organized right now."
      : policy.code === "PERSONAL_MAILBOX_NOT_OWNER"
        ? "This is a private mailbox only its owner connected, so it cannot be organized from this seat."
        : "This workspace cannot organize that mailbox.";
    return refused(policy.code === "MAILBOX_INACTIVE" ? 409 : 403, policy.code, note);
  }
  if (connector.provider !== "gmail") {
    return refused(422, "MAILBOX_PROVIDER_UNSUPPORTED", "Organization is wired for Gmail mailboxes in this pilot; this connector is another provider.");
  }
  if (!hasOrganizeScope(connector)) {
    return refused(409, "MAILBOX_SCOPE_REVOKED", "The mailbox consent no longer includes organization (gmail.modify); the owner can reconnect it from settings.");
  }
  const gmailId = String(messageRow.provider_message_id ?? "");
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(gmailId)) return refused(422, "MESSAGE_NOT_SYNCED", "That message is not a synced Gmail message.");

  // Unsubscribe targets come ONLY from the message's own recorded header.
  const recorded = object(object(messageRow.meta)?.list_unsubscribe);
  const httpsTarget = unsubscribeHttpsTarget(typeof recorded?.https === "string" ? recorded.https : null);
  if ((command.kind === "unsubscribe_propose" || command.kind === "unsubscribe_send") && !httpsTarget) {
    return refused(422, "UNSUBSCRIBE_TARGET_ABSENT", "This message did not carry a usable one-click unsubscribe target, so there is nothing safe to send.");
  }

  const requestArgs: Record<string, unknown> = { expected_tenant_id: tenantId, command, message_subject: messageRow.subject ?? "(no subject)", mailbox_address: connector.inbound_address };
  const summary = `Gmail ${KIND_SUMMARY[command.kind] ?? command.kind}${command.kind === "label" || command.kind === "unlabel" ? ` "${command.label}"` : ""} on "${(messageRow.subject ?? "(no subject)").slice(0, 80)}"`;
  const preview = {
    kind: "mailbox_organize", mailbox: connector.inbound_address, message_subject: (messageRow.subject ?? "(no subject)").slice(0, 120),
    action: KIND_SUMMARY[command.kind] ?? command.kind, ...(command.kind === "label" || command.kind === "unlabel" ? { label: command.label } : {}),
    ...(httpsTarget && command.kind.startsWith("unsubscribe") ? { unsubscribe_target_host: new URL(httpsTarget).host } : {}),
    reversible: true,
  };

  // The canonical gate + the atomic single-use redemption of one server-issued proposal.
  const { data: resolvedLane } = await caller.rpc("resolve_tool_autonomy", { _tenant_id: tenantId, _tool_key: COMMS_MAILBOX_ORGANIZE_TOOL });
  // An unreadable lane answers "confirm" — the classification below outranks it anyway.
  const lane = typeof resolvedLane === "string" && ["auto", "confirm", "off"].includes(resolvedLane) ? resolvedLane : "confirm";
  const requestNonce = crypto.randomUUID();
  let claimedArgs: Record<string, unknown> | null | undefined;
  if (body.approved_fingerprint !== undefined) {
    claimedArgs = null;
    const { data: claimed, error } = await admin.from("paige_pending_confirmations")
      .update({ consumed_at: new Date().toISOString() }).eq("user_id", user.id).eq("tenant_id", tenantId)
      .eq("tool_name", COMMS_MAILBOX_ORGANIZE_TOOL).eq("fingerprint", body.approved_fingerprint)
      .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
      .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
      .neq("issued_in_request", requestNonce).gt("expires_at", new Date().toISOString()).select("args").maybeSingle();
    if (!error) claimedArgs = object(claimed?.args);
  }

  const decision = decideDeclaredCapability(COMMS_MAILBOX_ORGANIZE_CAPABILITY, {
    caller: { authenticated: true, userId: user.id, principal: "person", tenantId, tenantSource: "server", door: "other", access: { allowed: true, reason: "Active tenant owner or admin." } },
    capability: { id: COMMS_MAILBOX_ORGANIZE_TOOL, effect: "mutate", outcomeChannel: "record_capability_run", availability: "needs_approval" },
    approval: { autonomyLane: lane, ...(claimedArgs !== undefined ? { claimedArgs, claimedFor: COMMS_MAILBOX_ORGANIZE_TOOL } : {}) }, requestArgs,
  });
  const { error: auditError } = await admin.from("paige_audit_log").insert({ actor_user_id: user.id, actor_role: `comms:${member?.role}`, tenant_id: tenantId, action: "comms.mailbox_organize_decision", target_type: "message", target_id: command.message_id,
    payload: { capability: COMMS_MAILBOX_ORGANIZE_TOOL, decision: decision.kind, risk: decision.risk, kind: command.kind } });
  if (decision.kind === "refuse") return response(403, { ok: false, outcome: "refused", code: decision.code, message: decision.message, audit_recorded: !auditError });
  if (auditError) return refused(503, "MAILBOX_DECISION_RECEIPT_FAILED");

  if (decision.kind === "propose") {
    if (!(await stillCurrent())) return refused(409, "WORKSPACE_CHANGED");
    const fingerprint = await confirmFingerprint(COMMS_MAILBOX_ORGANIZE_TOOL, requestArgs);
    const now = new Date().toISOString();
    const { data: proposal, error: proposalError } = await admin.from("paige_pending_confirmations").insert({
      user_id: user.id, tenant_id: tenantId, thread_id: null, scoped_client_id: null, tool_name: COMMS_MAILBOX_ORGANIZE_TOOL,
      fingerprint, issued_in_request: requestNonce, server_issued_at: now, args: requestArgs, summary,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }).select("summary,expires_at").maybeSingle();
    if (proposalError || !proposal) return response(503, { ok: false, outcome: "refused", code: "APPROVAL_STORE_UNAVAILABLE" });
    return response(202, { ok: false, outcome: "approval_required", capability: COMMS_MAILBOX_ORGANIZE_TOOL, fingerprint, summary: proposal.summary, expires_at: proposal.expires_at, preview });
  }

  // Execute the STORED command only.
  const stored = object(decision.args);
  let storedCommand: OrganizeCommand;
  try { storedCommand = parseOrganizeCommand(stored?.command); } catch { return refused(403, "APPROVAL_CLAIM_INVALID"); }
  if (JSON.stringify(storedCommand) !== JSON.stringify(command)) return refused(403, "APPROVAL_CLAIM_INVALID");
  if (!(await stillCurrent())) return refused(409, "WORKSPACE_CHANGED");

  // Re-prove the mailbox policy at execution time (the connector may have moved
  // between the card and the claim).
  const { data: connectorNow } = await admin.from("channel_connectors")
    .select("id,tenant_id,provider,mailbox_class,mailbox_owner_user_id,mailbox_scopes,status,active,credentials_vault_ref")
    .eq("id", messageRow.connector_id).maybeSingle();
  const policyNow = connectorNow ? decideContentRead({ callerUserId: user.id, callerTenantId: tenantId, mailboxTenantId: connectorNow.tenant_id ?? tenantId, mailbox: connectorNow }) : null;
  if (!connectorNow || !policyNow?.allowed || !hasOrganizeScope(connectorNow) || connectorNow.provider !== "gmail") {
    return refused(409, "MAILBOX_SCOPE_REVOKED", "The mailbox changed or its consent no longer covers organization. Nothing was changed.");
  }

  // The refresh token lives in Vault; the access token never persists (§9/§34).
  const { data: refreshToken, error: secretError } = await admin.rpc("read_channel_secret", { _ref: connectorNow.credentials_vault_ref });
  if (secretError || typeof refreshToken !== "string" || !refreshToken) return refused(503, "MAILBOX_CREDENTIAL_UNAVAILABLE");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "", client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "", grant_type: "refresh_token" }),
  });
  const tokenJson = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !tokenJson?.access_token) return response(502, { ok: false, outcome: "refused", code: "MAILBOX_TOKEN_REFRESH_FAILED", note: "The mailbox connection could not be authorized just now; nothing was changed." });
  const authHeaders = { Authorization: `Bearer ${tokenJson.access_token}`, "Content-Type": "application/json" };

  // ONE provider call per approved command, chosen by kind. There is no delete.
  let providerCall: { status: number; body: unknown } | null = null;
  try {
    if (command.kind === "archive" || command.kind === "unarchive" || command.kind === "label" || command.kind === "unlabel") {
      let addLabelIds: string[] = [], removeLabelIds: string[] = [];
      if (command.kind === "archive") removeLabelIds = ["INBOX"];
      if (command.kind === "unarchive") addLabelIds = ["INBOX"];
      if (command.kind === "label" || command.kind === "unlabel") {
        // Map the canonical slug to the Gmail label named paige-<slug>, creating it if absent.
        const listRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", { headers: authHeaders });
        const listJson = await listRes.json().catch(() => null);
        if (!listRes.ok || !Array.isArray(listJson?.labels)) return response(502, { ok: false, outcome: "failed", code: "MAILBOX_LABELS_UNAVAILABLE" });
        const wanted = `paige-${command.label}`;
        const existing = (listJson.labels as { id?: string; name: string }[]).find((label) => label.name === wanted && typeof label.id === "string");
        let labelId: string;
        if (existing?.id) {
          labelId = existing.id;
        } else {
          const createRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", { method: "POST", headers: authHeaders, body: JSON.stringify({ name: wanted, labelListVisibility: "labelShow", messageListVisibility: "show" }) });
          const created = await createRes.json().catch(() => null) as { id?: string } | null;
          if (!createRes.ok || typeof created?.id !== "string") return response(502, { ok: false, outcome: "failed", code: "MAILBOX_LABEL_CREATE_FAILED" });
          labelId = created.id;
        }
        if (command.kind === "label") addLabelIds = [labelId];
        else removeLabelIds = [labelId];
      }
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}/modify`, { method: "POST", headers: authHeaders, body: JSON.stringify({ addLabelIds, removeLabelIds }) });
      providerCall = { status: res.status, body: await res.json().catch(() => null) };
    } else if (command.kind === "trash" || command.kind === "untrash") {
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}/${command.kind}`, { method: "POST", headers: authHeaders, body: "{}" });
      providerCall = { status: res.status, body: await res.json().catch(() => null) };
    } else if (command.kind === "unsubscribe_propose") {
      providerCall = { status: 200, body: { proposed: true } }; // no provider write: the proposal is the record
    } else if (command.kind === "unsubscribe_send") {
      const res = await fetch(httpsTarget!, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "List-Unsubscribe": "One-Click" }, body: "List-Unsubscribe=One-Click" });
      providerCall = { status: res.status, body: await res.text().then(() => null).catch(() => null) };
    }
  } catch {
    providerCall = null;
  }

  if (!providerCall) return response(503, { ok: false, outcome: "outcome_unknown", code: "MAILBOX_PROVIDER_UNANSWERED", note: "The mailbox request has no verified response. Do not assume it applied." });
  if (providerCall.status >= 500 || providerCall.status === 429) {
    return response(503, { ok: false, outcome: "outcome_unknown", code: "MAILBOX_PROVIDER_UNANSWERED", note: "The mailbox service did not answer. Proposing it again re-applies the same state; nothing is duplicated." });
  }
  if (providerCall.status >= 400) {
    return response(502, { ok: false, outcome: "failed", code: "MAILBOX_PROVIDER_REFUSED", note: "Gmail refused the change, so the mailbox was not changed." });
  }

  // Canonical mirror + undo window (service-only), then the readback.
  const { error: mirrorError } = await admin.rpc("record_mailbox_organize", {
    _message_id: command.message_id, _kind: command.kind,
    _label: command.kind === "label" || command.kind === "unlabel" ? command.label : null,
    _actor_user_id: user.id, _provider_result: { status: providerCall.status },
  });
  if (mirrorError) return response(503, { ok: false, outcome: "outcome_unknown", code: "MAILBOX_MIRROR_UNAVAILABLE", note: "The mailbox changed but the record could not be written. Proposing it again re-checks the same message." });

  const undo: Record<string, string> = { archive: "unarchive", unarchive: "archive", trash: "untrash", untrash: "trash", label: "unlabel", unlabel: "label", unsubscribe_propose: "unsubscribe_send" };
  return response(200, {
    ok: true, outcome: "applied", capability: COMMS_MAILBOX_ORGANIZE_TOOL,
    kind: command.kind, message_id: command.message_id,
    ...(command.kind === "label" || command.kind === "unlabel" ? { label: command.label } : {}),
    undo_kind: undo[command.kind] ?? null,
    ...(command.kind === "unsubscribe_send" ? { unsubscribed: true } : {}),
    ...(command.kind === "unsubscribe_propose" && httpsTarget ? { unsubscribe_target_host: new URL(httpsTarget).host } : {}),
    note: command.kind === "trash"
      ? "Moved to Gmail's Trash, where it stays recoverable for 30 days. Never called a deletion."
      : "Applied exactly as approved.",
  });
});
