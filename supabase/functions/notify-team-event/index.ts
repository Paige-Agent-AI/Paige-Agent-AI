// Unified team-event notifier — task assignments, new form submissions,
// and contact-to-coach assignments. Called by Postgres triggers, mirrors the
// notify-approval-event pattern: insert into paige_admin_notifications +
// send a transactional email per recipient.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  resolveCanonicalAppPath,
  type CanonicalDestination,
  type CanonicalTier,
} from "../_shared/canonical-app-url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_BASE = "https://paigeagent.ai";

type Event =
  | "task_assigned"
  | "form_submission"
  | "contact_assigned"
  | "booking_created";

interface Payload {
  event: Event;
  // Task
  task_id?: string;
  assignee_user_id?: string;
  // Form submission
  submission_id?: string;
  // Contact assignment
  contact_id?: string;
  coach_user_id?: string;
  tenant_id?: string;
  // Booking created
  booking_id?: string;
  host_user_ids?: string[];
}

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Internal-only. Both legitimate callers — the public-booking edge function
  // and the fire_team_event() Postgres trigger — present the service-role key
  // as their bearer. This function runs as service-role and does NO per-row
  // tenant/ownership check, so without this gate a public caller could pass a
  // guessed booking_id/contact_id + their own user_id and have another tenant's
  // guest PII delivered to them (or spam-notify an arbitrary user).
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (bearer !== serviceKey) return json({ error: "forbidden" }, 403);

  const supabase = createClient(supabaseUrl, serviceKey);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!body.event) return json({ error: "event required" }, 400);

  type Recipient = { user_id: string; email?: string; name?: string };
  const recipients: Recipient[] = [];
  let title = "";
  let bodyText = "";
  let tenantId: string | null = body.tenant_id ?? null;
  let destination: CanonicalDestination = "home";
  let severity: "info" | "warning" | "urgent" = "info";
  let contactId: string | null = null;
  let workflowKey = `team.${body.event}`;

  const resolveUser = async (uid: string): Promise<Recipient | null> => {
    if (!uid) return null;
    const [{ data: au }, { data: p }] = await Promise.all([
      supabase.auth.admin.getUserById(uid),
      supabase
        .from("profiles")
        .select("display_name, first_name, last_name")
        .eq("user_id", uid)
        .maybeSingle(),
    ]);
    return {
      user_id: uid,
      email: au?.user?.email ?? undefined,
      name:
        p?.display_name ||
        [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() ||
        undefined,
    };
  };

  if (body.event === "task_assigned") {
    if (!body.task_id || !body.assignee_user_id) {
      return json({ error: "task_id and assignee_user_id required" }, 400);
    }
    const { data: task } = await supabase
      .from("tasks")
      .select("id,title,description,due_date,deal_id,tenant_id")
      .eq("id", body.task_id)
      .maybeSingle();
    if (!task) return json({ error: "task not found" }, 404);
    title = `New task assigned: ${task.title ?? "Task"}`;
    bodyText = `${task.description ?? ""}${task.due_date ? `\nDue ${new Date(task.due_date).toLocaleDateString()}` : ""}`.trim();
    tenantId = task.tenant_id ?? tenantId;
    destination = "tasks";
    const r = await resolveUser(body.assignee_user_id);
    if (r) recipients.push(r);
  } else if (body.event === "form_submission") {
    if (!body.submission_id) return json({ error: "submission_id required" }, 400);
    const { data: sub } = await supabase
      .from("growth_form_submissions")
      .select("id,tenant_id,form_id,contact_id,payload_json,source")
      .eq("id", body.submission_id)
      .maybeSingle();
    if (!sub) return json({ error: "submission not found" }, 404);
    contactId = sub.contact_id ?? null;
    const { data: form } = await supabase
      .from("growth_forms")
      .select("name")
      .eq("id", sub.form_id)
      .maybeSingle();
    title = `New form submission: ${form?.name ?? "Form"}`;
    const preview = sub.payload_json
      ? Object.entries(sub.payload_json as Record<string, unknown>)
          .slice(0, 4)
          .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
          .join("\n")
      : "";
    bodyText = `Source: ${sub.source ?? "direct"}\n\n${preview}`;
    tenantId = sub.tenant_id ?? tenantId;
    destination = "marketplace_submissions";
    severity = "info";

    // Recipients: the active owners and admins of the business the submission belongs to — its
    // tenant membership, never the global role table. No tenant, no recipients.
    const { data: memberRows } = sub.tenant_id
      ? await supabase
          .from("tenant_members")
          .select("user_id")
          .eq("tenant_id", sub.tenant_id)
          .eq("status", "active")
          .in("role", ["owner", "admin"])
      : { data: [] as Array<{ user_id: string }> };
    const userIds = Array.from(new Set((memberRows ?? []).map((r) => r.user_id as string)));
    for (const uid of userIds) {
      const r = await resolveUser(uid);
      if (r) recipients.push(r);
    }
  } else if (body.event === "contact_assigned") {
    if (!body.contact_id || !body.coach_user_id) {
      return json({ error: "contact_id and coach_user_id required" }, 400);
    }
    contactId = body.contact_id;
    const { data: c } = await supabase
      .from("clients")
      .select("id, first_name, last_name, business_name, tenant_id")
      .eq("id", body.contact_id)
      .maybeSingle();
    const name =
      [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim() ||
      c?.business_name ||
      "a client";
    title = `New client assigned: ${name}`;
    bodyText = `You've been assigned as the coach for ${name}.`;
    tenantId = c?.tenant_id ?? tenantId;
    destination = "contacts";
    const r = await resolveUser(body.coach_user_id);
    if (r) recipients.push(r);
  } else if (body.event === "booking_created") {
    if (!body.booking_id || !body.host_user_ids?.length) {
      return json({ error: "booking_id and host_user_ids required" }, 400);
    }
    const { data: booking } = await supabase
      .from("internal_bookings")
      .select("id,title,guest_name,start_at,timezone,contact_id,tenant_id")
      .eq("id", body.booking_id)
      .maybeSingle();
    if (!booking) return json({ error: "booking not found" }, 404);
    contactId = booking.contact_id ?? null;
    const whenLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: booking.timezone || "America/New_York", weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(new Date(booking.start_at));
    title = `New booking: ${booking.guest_name ?? "a guest"}`;
    bodyText = `${booking.title ?? "Session"} — ${whenLabel}`;
    tenantId = booking.tenant_id ?? tenantId;
    destination = "calendar";
    // Every host in the group (round-robin picks one; collective attends all;
    // class always has exactly one) gets their own in-app + email notice.
    for (const uid of Array.from(new Set(body.host_user_ids))) {
      const r = await resolveUser(uid);
      if (r) recipients.push(r);
    }
  } else {
    return json({ error: `unknown event: ${body.event}` }, 400);
  }

  let link: string | null = null;
  if (tenantId) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("account_type, account_number")
      .eq("id", tenantId)
      .maybeSingle();
    if (tenant) {
      link = resolveCanonicalAppPath({
        actor: "account",
        tier: String(tenant.account_type ?? "") as CanonicalTier,
        account: tenant.account_number,
        destination,
      });
    }
  }

  // In-app notifications. A missing mounted capability is intentionally non-clickable
  // instead of emitting a dead or legacy address.
  const notifRows = recipients.map((r) => ({
    severity,
    title,
    body: bodyText,
    link_to: link,
    source_workflow_key: workflowKey,
    contact_id: contactId,
    assigned_user_id: r.user_id,
    scope: "assigned_user",
  }));
  if (notifRows.length) {
    const { error: nErr } = await supabase.from("paige_admin_notifications").insert(notifRows);
    if (nErr) console.error("notif insert error", nErr);
  }

  // Emails
  const emailResults: unknown[] = [];
  for (const r of recipients) {
    if (!r.email) continue;
    try {
      const idKey =
        body.event === "task_assigned"
          ? `task-${body.task_id}-${r.user_id}`
          : body.event === "form_submission"
            ? `submission-${body.submission_id}-${r.user_id}`
            : body.event === "booking_created"
              ? `booking-${body.booking_id}-${r.user_id}`
              : `contact-${body.contact_id}-${body.coach_user_id}`;
      const res = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          templateName: "team-event-notification",
          recipientEmail: r.email,
          idempotencyKey: idKey,
          templateData: {
            recipientName: r.name,
            eventType: body.event,
            title,
            body: bodyText,
            actionUrl: link ? `${APP_BASE}${link}` : null,
          },
        }),
      });
      // The provider's answer, not the HTTP call, decides whether this email was sent.
      const sent = await res.json().then((j) => j?.success === true && j?.sent === true).catch(() => false);
      emailResults.push({ to: r.email, status: res.status, sent });
    } catch (err) {
      emailResults.push({ to: r.email, sent: false, error: (err as Error).message });
    }
  }

  const emailsFailed = emailResults.filter((e) => (e as { sent?: boolean }).sent !== true).length;
  return json({
    success: emailsFailed === 0,
    event: body.event,
    recipients: recipients.length,
    emails: emailResults,
    emails_failed: emailsFailed,
  });
});
