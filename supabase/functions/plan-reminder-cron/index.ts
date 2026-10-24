import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";
import { databaseAnswered } from "../_shared/approval-outcome.ts";
// Planning reminder runner. Invoked by pg_cron every minute (guarded by a
// shared token). Finds due plan_items of type 'reminder' that haven't fired,
// and delivers them so a reminder Paige "set" actually lands — an in-app ping
// for the assignee (or the whole team), plus a branded email when the reminder
// asked for one. Each reminder is claimed by stamping reminded_at BEFORE it's
// delivered. The conditional claim also rechecks the due record/version; a
// cancelled, postponed or revised snapshot cannot start delivery. Only a known
// pre-dispatch failure or single-statement database refusal releases our own
// unchanged claim. An ambiguous notification write remains held for readback.
// A reminder with no reachable recipient is
// marked cancelled/undeliverable so it doesn't retry forever.
//
// This is the honest other half of "set a reminder": Paige files the row via
// plan_set_reminder, and this worker is what makes it fire on time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// The pg_cron trigger token lives ONLY in Supabase Vault (task #145) — never in
// source or env. Each trigger is authorized by the service-role RPC
// public.verify_cron_token against the x-cron-token header the cron job builds
// via public.cron_token_header(); no literal token exists in this file.
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("PLATFORM_DEFAULT_EMAIL_FROM") ?? "Paige Agent AI <notifications@paigeagent.ai>";

const PLANNING_URL = "/app/planning";

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shell(brandName: string, accent: string, heading: string, lead: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 0;"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border:1px solid #e7e8ec;border-radius:14px;overflow:hidden;">
      <tr><td style="height:5px;background:${esc(accent)};"></td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#98a0ae;font-weight:bold;">${esc(brandName)}</div>
        <h1 style="color:#101828;font-size:20px;margin:10px 0 6px;">${esc(heading)}</h1>
        <p style="color:#475467;font-size:15px;line-height:1.5;margin:0 0 8px;">${esc(lead)}</p>
        ${body ? `<p style="color:#667085;font-size:14px;line-height:1.5;margin:8px 0 14px;">${esc(body)}</p>` : ""}
      </td></tr>
      <tr><td style="padding:16px 32px 26px;border-top:1px solid #eef0f3;">
        <p style="color:#98a0ae;font-size:12px;margin:0;">You set this reminder in ${esc(brandName)}. It won't repeat.</p>
      </td></tr>
    </table></td></tr></table></body></html>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_KEY || !to) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
    });
    return res.ok;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");

  // Service-role client is built first so it can authorize the trigger below.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Authorize the cron trigger against the Vault-held token via a service-role
  // RPC (task #145): the secret exists only in Vault, so we verify the received
  // header rather than compare to any local literal. verify_jwt is off, so this
  // is the ONLY gate — fail CLOSED on any RPC error or a non-true result (§13).
  const cronToken = req.headers.get("x-cron-token") ?? "";
  const { data: cronOk, error: cronErr } = await admin.rpc("verify_cron_token", { _token: cronToken });
  if (cronErr || cronOk !== true) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const nowIso = new Date().toISOString();

  // Due, unfired reminders that are still open. Small batch per run; cron reruns.
  const { data: due, error: dueErr } = await admin
    .from("plan_items")
    .select("id, tenant_id, plan_id, title, summary, remind_at, remind_channel, remind_target, assigned_to_user_id, created_by, metadata, updated_at")
    .eq("item_type", "reminder")
    .is("reminded_at", null)
    .not("status", "in", "(done,cancelled)")
    .lte("remind_at", nowIso)
    .order("remind_at", { ascending: true })
    .limit(200);
  if (dueErr) {
    return new Response(JSON.stringify({ ok: false, error: dueErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // Cache tenant brand (name + accent) so a team blast hits Resend once per tenant.
  const brandCache = new Map<string, { name: string; accent: string }>();
  async function brandFor(tenantId: string): Promise<{ name: string; accent: string }> {
    if (brandCache.has(tenantId)) return brandCache.get(tenantId)!;
    let name = "Paige Agent AI", accent = "#EBB94C";
    const { data: rb } = await admin.rpc("resolve_tenant_brand", { _tenant_id: tenantId });
    const b = Array.isArray(rb) ? rb[0] : rb;
    if (b) {
      name = b.product_name || b.tenant_name || name;
      accent = b.accent_color || accent;
    }
    const out = { name, accent };
    brandCache.set(tenantId, out);
    return out;
  }

  // Resolve an auth email for a user id (email channel only). Cached per run.
  const emailCache = new Map<string, string | null>();
  async function emailFor(userId: string): Promise<string | null> {
    if (emailCache.has(userId)) return emailCache.get(userId)!;
    let email: string | null = null;
    try {
      const { data } = await admin.auth.admin.getUserById(userId);
      email = data?.user?.email ?? null;
    } catch { email = null; }
    emailCache.set(userId, email);
    return email;
  }

  let claimed = 0, inApp = 0, emailed = 0, teamFanned = 0, emailBlocked = 0;
  const failures: { id: string; error: string; outcome_unknown?: boolean }[] = [];

  for (const r of due ?? []) {
    if (typeof r.updated_at !== "string" || !r.updated_at) {
      failures.push({ id: r.id as string, error: "reminder version unavailable" });
      continue;
    }
    // Revalidate the same native record at claim time, not only at list time.
    // updated_at is the existing NOT NULL Planning version, never an account gate.
    const { data: claimRow, error: claimErr } = await admin
      .from("plan_items")
      .update({ reminded_at: nowIso })
      .eq("id", r.id)
      .eq("tenant_id", r.tenant_id)
      .eq("item_type", "reminder")
      .eq("updated_at", r.updated_at)
      .not("status", "in", "(done,cancelled)")
      .lte("remind_at", nowIso)
      .is("reminded_at", null)
      .select("id, updated_at")
      .maybeSingle();
    if (claimErr) { failures.push({ id: r.id as string, error: claimErr.message }); continue; }
    if (!claimRow) continue; // lost the claim to a concurrent run
    if (claimRow.id !== r.id || typeof claimRow.updated_at !== "string"
      || !Number.isFinite(Date.parse(claimRow.updated_at))) {
      failures.push({ id: r.id as string, error: "reminder claim unconfirmed", outcome_unknown: true });
      continue;
    }
    claimed++;

    // An absent write acknowledgement does not establish that nothing landed.
    let delivered = false;
    let notificationAttempted = false;
    let notificationRefused = false;
    try {
      // Who gets pinged: the whole active team, or the single assignee/creator.
      let recipients: string[] = [];
      if (r.remind_target === "team") {
        const { data: members, error: memberError } = await admin
          .from("tenant_members")
          .select("user_id")
          .eq("tenant_id", r.tenant_id)
          .eq("status", "active");
        if (memberError) throw memberError;
        recipients = Array.from(new Set((members ?? [])
          .map((member: { user_id?: string | null }) => member.user_id)
          .filter((userId): userId is string => typeof userId === "string" && Boolean(userId))));
        teamFanned++;
      } else {
        const who = (r.assigned_to_user_id || r.created_by) as string | null;
        recipients = who ? [who] : [];
      }

      if (recipients.length === 0) {
        // Genuinely undeliverable (team with no active members, or a self-reminder
        // whose user was deleted). Keep the claim stamped so it becomes TERMINAL —
        // releasing it would re-scan and re-fail this row every minute forever.
        // Record why on the row so it's explainable.
        const { data: terminal, error: terminalError } = await admin.from("plan_items").update({
          status: "cancelled",
          metadata: { ...(r.metadata || {}), undeliverable: true, undeliverable_reason: "no active recipient at fire time" },
        }).eq("id", r.id).eq("tenant_id", r.tenant_id).eq("reminded_at", nowIso)
          .eq("updated_at", claimRow.updated_at).select("id").maybeSingle();
        failures.push({ id: r.id as string, error: !terminalError && terminal?.id === r.id
          ? "no recipients (marked undeliverable)" : "undeliverable state unconfirmed or record changed" });
        continue;
      }

      const title = (r.title as string) || "Reminder";
      const summary = (r.summary as string) || "";
      const channel = (r.remind_channel as string) || "in_app";

      // In-app notification is the baseline; uncertainty must not invite replay.
      const rows = recipients.map((uid) => ({
        user_id: uid,
        type: "task_reminder",
        title,
        message: summary || "You asked Paige to remind you.",
        action_url: `${PLANNING_URL}?item=${r.id}`,
        is_read: false,
        metadata: { plan_item_id: r.id, plan_id: r.plan_id, remind_target: r.remind_target, source: "paige_planning" },
      }));
      notificationAttempted = true;
      const { error: notifErr } = await admin.from("notifications").insert(rows);
      if (notifErr) {
        notificationRefused = databaseAnswered(notifErr);
        throw notifErr;
      }
      delivered = true; // ping landed — from here on, never release the claim
      inApp += rows.length;

      // Email channel additionally sends a branded note to each recipient.
      if (channel === "email") {
        if (!(await commsProviderExecutionAllowed(admin, { tenantId: r.tenant_id }))) {
          // Internal delivery has landed; retain the claim and never retry email.
          // This records external refusal without cancelling the internal reminder.
          const { data: blocked, error } = await admin.from("plan_items").update({
            metadata: { ...(r.metadata || {}), provider_execution: "blocked", reason: "COMMS_PROVIDER_EXECUTION_DISABLED" },
          }).eq("id", r.id).eq("tenant_id", r.tenant_id).eq("reminded_at", nowIso)
            .eq("updated_at", claimRow.updated_at).select("id").maybeSingle();
          emailBlocked++;
          failures.push({ id: r.id as string, error: error || blocked?.id !== r.id
            ? "blocked state persistence unconfirmed or record changed" : "COMMS_PROVIDER_EXECUTION_DISABLED" });
          continue;
        }
        const brand = await brandFor(r.tenant_id as string);
        const html = shell(brand.name, brand.accent, title, summary || "This is your reminder.", "");
        for (const uid of recipients) {
          const to = await emailFor(uid);
          if (to && await sendEmail(to, `Reminder: ${title}`, html)) emailed++;
        }
      }
      // sms channel: the in-app ping still fired above; text delivery rides the
      // shared SMS worker once a per-tenant number is connected (not wired yet).
    } catch (e: unknown) {
      // Only a known pre-dispatch failure or answered single INSERT refusal can
      // retry. Compare the exact acknowledged claim version before releasing it;
      // a snooze/newer claim must not be cleared by this old request's cleanup.
      if (!delivered && (!notificationAttempted || notificationRefused)) {
        if (typeof claimRow.updated_at === "string" && claimRow.updated_at) {
          try {
            const { data: released, error: releaseError } = await admin.from("plan_items")
              .update({ reminded_at: null }).eq("id", r.id).eq("tenant_id", r.tenant_id)
              .eq("reminded_at", nowIso).eq("updated_at", claimRow.updated_at)
              .select("id").maybeSingle();
            if (!releaseError && released?.id === r.id) claimed--;
            else failures.push({ id: r.id as string, error: "claim release unconfirmed or record changed" });
          } catch {
            failures.push({ id: r.id as string, error: "claim release unconfirmed" });
          }
        }
      }
      const detail = e && typeof e === "object" && "message" in e ? e.message : e;
      failures.push({ id: r.id as string, error: String(detail || e),
        ...(!delivered && notificationAttempted && !notificationRefused ? { outcome_unknown: true } : {}) });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, scanned: (due ?? []).length, claimed, in_app: inApp, emailed, email_blocked: emailBlocked, team_fanned: teamFanned, failed: failures.length, failures }),
    { headers: { "Content-Type": "application/json" } },
  );
});
