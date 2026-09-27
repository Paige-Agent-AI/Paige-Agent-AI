import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOperatorIdentity } from "../_shared/operator-identity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Resolve the inviting party's DISPLAY NAME present-only from the inviting user's
// tenant (§45/§9) — the practice's own brand, never a hardcoded operator name. Returns
// undefined when nothing resolves so the email template degrades to a neutral "your
// admin" line rather than inventing an identity.
async function resolveInviterName(
  supabase: ReturnType<typeof createClient>,
  invitedById: string | null,
): Promise<string | undefined> {
  if (!invitedById) return undefined;
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("active_tenant_id").eq("user_id", invitedById).maybeSingle(),
    supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", invitedById)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .limit(1),
  ]);
  const tenantId =
    (profile as { active_tenant_id?: string | null } | null)?.active_tenant_id ??
    (memberships as Array<{ tenant_id?: string }> | null)?.[0]?.tenant_id ??
    null;
  const operator = await resolveOperatorIdentity(supabase, tenantId);
  return operator.signer_name ?? operator.from_name ?? operator.product_name ?? undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Validate API key
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, message: "Missing or invalid Authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = authHeader.replace("Bearer ", "");
    
    // Hash the key and check against stored hashes
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

    const { data: keyRecord, error: keyError } = await supabase
      .from("platform_api_keys")
      .select("id, is_active")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();

    if (keyError || !keyRecord) {
      return new Response(JSON.stringify({ success: false, message: "Invalid API key" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body
    const body = await req.json();
    const { action, data: actionData } = body;

    if (!action) {
      return new Response(JSON.stringify({ success: false, message: "Missing 'action' field" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result: Record<string, unknown>;

    switch (action) {
      case "create_client": {
        const { first_name, last_name, email, phone, entity_name, entity_type, funding_goal, notes } = actionData || {};
        if (!email || !first_name || !last_name) {
          return res(400, { success: false, message: "first_name, last_name, and email are required" });
        }

        // Create auth user
        const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { full_name: `${first_name} ${last_name}` },
        });

        if (authErr) {
          return res(400, { success: false, message: `Failed to create user: ${authErr.message}` });
        }

        // Update profile with extra fields
        const userId = authUser.user.id;
        await supabase.from("profiles").update({
          full_name: `${first_name} ${last_name}`,
          phone: phone || null,
        }).eq("user_id", userId);

        // If entity info provided, create a business
        if (entity_name) {
          await supabase.from("businesses").insert({
            legal_name: entity_name,
            entity_type: entity_type || null,
            owner_user_id: userId,
          });
        }

        // Log activity
        await supabase.from("audit_logs").insert({
          user_id: userId,
          entity: "client",
          action: "created_via_webhook",
          data: { funding_goal, notes, source: "inbound_webhook" },
        });

        result = { success: true, message: "Client created", client_id: userId };
        break;
      }

      case "update_client_profile": {
        const { client_id, ...profileFields } = actionData || {};
        if (!client_id) return res(400, { success: false, message: "client_id is required" });

        const updateData: Record<string, unknown> = {};
        if (profileFields.full_name) updateData.full_name = profileFields.full_name;
        if (profileFields.phone) updateData.phone = profileFields.phone;
        if (profileFields.address) updateData.address = profileFields.address;

        const { error } = await supabase.from("profiles").update(updateData).eq("user_id", client_id);
        if (error) return res(400, { success: false, message: error.message });

        result = { success: true, message: "Client profile updated" };
        break;
      }

      case "complete_milestone": {
        const { client_id, milestone_name } = actionData || {};
        if (!client_id || !milestone_name) return res(400, { success: false, message: "client_id and milestone_name required" });

        await supabase.from("audit_logs").insert({
          user_id: client_id,
          entity: "milestone",
          action: "completed_via_webhook",
          data: { milestone_name, completed_at: new Date().toISOString() },
        });

        result = { success: true, message: `Milestone '${milestone_name}' completed` };
        break;
      }

      case "add_activity_note": {
        const { client_id, note } = actionData || {};
        if (!client_id || !note) return res(400, { success: false, message: "client_id and note required" });

        await supabase.from("audit_logs").insert({
          user_id: client_id,
          entity: "activity",
          action: "note_added_via_webhook",
          data: { note, added_at: new Date().toISOString() },
        });

        result = { success: true, message: "Activity note added" };
        break;
      }

      case "log_communication": {
        const {
          client_id,
          channel,
          message_type,
          subject,
          preview,
          status,
          provider_message_id,
          error_message,
        } = actionData || {};
        if (!client_id || !channel || !message_type) {
          return res(400, { success: false, message: "client_id, channel, and message_type are required" });
        }
        if (!["email", "sms", "voice", "push", "ghl", "other"].includes(channel)) {
          return res(400, { success: false, message: "channel must be one of: email, sms, voice, push, ghl, other" });
        }

        const { error } = await supabase.from("communication_log").insert({
          user_id: client_id,
          channel,
          message_type,
          subject: subject || null,
          preview: preview || null,
          status: status || "sent",
          provider_message_id: provider_message_id || null,
          error_message: error_message || null,
        });

        if (error) return res(400, { success: false, message: error.message });

        result = { success: true, message: "Communication logged" };
        break;
      }


      case "log_funding": {
        const { client_id, amount, lender_name, product_type, date_secured } = actionData || {};
        if (!client_id || !amount || !lender_name || !product_type || !date_secured) {
          return res(400, { success: false, message: "client_id, amount, lender_name, product_type, and date_secured required" });
        }

        const { error } = await supabase.from("funding_secured").insert({
          user_id: client_id,
          amount,
          lender_name,
          product_type,
          date_secured,
        });

        if (error) return res(400, { success: false, message: error.message });

        // Fire outbound webhook
        try {
          await supabase.functions.invoke("fire-outbound-webhooks", {
            body: {
              event_type: "funding_logged",
              data: { client_id, lender_name, amount, product_type },
            },
          });
        } catch (_) { /* best effort */ }

        result = { success: true, message: "Funding event logged" };
        break;
      }

      case "trigger_score_recalculation": {
        const { client_id } = actionData || {};
        if (!client_id) return res(400, { success: false, message: "client_id required" });

        await supabase.from("audit_logs").insert({
          user_id: client_id,
          entity: "pme_score",
          action: "recalculation_triggered_via_webhook",
          data: { triggered_at: new Date().toISOString() },
        });

        result = { success: true, message: "Score recalculation triggered" };
        break;
      }

      case "invite_user": {
        const { email, first_name, last_name, ghl_contact_id, tier, invited_by_email } = actionData || {};
        if (!email || !tier) {
          return res(400, { success: false, message: "email and tier are required" });
        }
        if (!["premium", "vip"].includes(String(tier).toLowerCase())) {
          return res(400, { success: false, message: "tier must be 'premium' or 'vip'" });
        }

        // Resolve invited_by user_id (fallback to platform owner)
        let invitedById: string | null = null;
        if (invited_by_email) {
          const { data: u } = await supabase.auth.admin.listUsers();
          invitedById = u?.users?.find((x: { email?: string }) => x.email?.toLowerCase() === String(invited_by_email).toLowerCase())?.id ?? null;
        }
        if (!invitedById) {
          const { data: owner } = await supabase
            .from("app_settings_owner")
            .select("owner_email")
            .maybeSingle();
          if (owner?.owner_email) {
            const { data: u2 } = await supabase.auth.admin.listUsers();
            invitedById = u2?.users?.find((x: { email?: string }) => x.email?.toLowerCase() === String(owner.owner_email).toLowerCase())?.id ?? null;
          }
        }
        if (!invitedById) {
          return res(500, { success: false, message: "Could not resolve invited_by user" });
        }

        // Generate plaintext token (trigger will hash + null out token column)
        const plaintextToken = crypto.randomUUID() + "-" + crypto.randomUUID();
        const { data: inv, error: invErr } = await supabase
          .from("invitations")
          .insert({
            email: String(email).toLowerCase(),
            role: "user",
            invited_by: invitedById,
            token: plaintextToken,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .select("id")
          .single();

        if (invErr || !inv) {
          return res(400, { success: false, message: invErr?.message ?? "Failed to create invitation" });
        }

        // Audit trail (captures ghl_contact_id + tier for the bridge)
        await supabase.from("audit_logs").insert({
          user_id: invitedById,
          entity: "invitation",
          action: "invite_user_via_webhook",
          entity_id: inv.id,
          data: { email, first_name, last_name, ghl_contact_id, tier, source: "n8n_bridge" },
        });

        // Send branded invite email via the registered template
        const inviteUrl = `https://paigeagent.ai/auth?invite=${plaintextToken}`;
        const displayName = [first_name, last_name].filter(Boolean).join(" ").trim();
        // §45: the inviter shown is the inviting practice's OWN identity, resolved
        // present-only from its tenant — never a hardcoded operator ("Antonio Cook").
        const inviterName = await resolveInviterName(supabase, invitedById);
        try {
          await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName: "role-invitation",
              recipientEmail: String(email).toLowerCase(),
              idempotencyKey: `invite-${inv.id}`,
              templateData: {
                role: String(tier).toLowerCase() === "vip" ? "VIP Member" : "Premium Member",
                inviteUrl,
                invitedBy: inviterName,
                recipientName: displayName || undefined,
              },
            },
          });
        } catch (sendErr) {
          console.error("invite_user email send failed:", sendErr);
          // Invitation row exists; bridge can retry email separately
          return res(207, { success: true, invitation_id: inv.id, email_sent: false, message: "Invitation created but email send failed" });
        }

        result = { success: true, invitation_id: inv.id, email_sent: true };
        break;
      }

      case "create_coach_assignment": {
        const { coach_email, coach_first_name, coach_last_name, client_user_ids } = actionData || {};
        if (!coach_email || !Array.isArray(client_user_ids)) {
          return res(400, { success: false, message: "coach_email and client_user_ids[] are required" });
        }

        const normalizedEmail = String(coach_email).toLowerCase();
        let coachUserId: string | null = null;
        let inviteSent = false;

        // Find existing auth user
        const { data: existing } = await supabase.auth.admin.listUsers();
        coachUserId = existing?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === normalizedEmail)?.id ?? null;

        // Create if missing
        if (!coachUserId) {
          const fullName = [coach_first_name, coach_last_name].filter(Boolean).join(" ").trim() || normalizedEmail;
          const { data: created, error: createErr } = await supabase.auth.admin.createUser({
            email: normalizedEmail,
            email_confirm: true,
            user_metadata: { full_name: fullName },
          });
          if (createErr || !created?.user) {
            return res(400, { success: false, message: `Failed to create coach user: ${createErr?.message ?? "unknown"}` });
          }
          coachUserId = created.user.id;

          // Send invite via role-invitation template
          const plaintextToken = crypto.randomUUID() + "-" + crypto.randomUUID();
          const { data: inv } = await supabase
            .from("invitations")
            .insert({
              email: normalizedEmail,
              // "Coach" is a title, never a role: the invitation grants the plain user role, and
              // the assignment below is what lets this person see their clients.
              role: "user",
              invited_by: coachUserId, // self-ref placeholder; will be overridden below if owner found
              token: plaintextToken,
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .select("id")
            .maybeSingle();

          if (inv) {
            try {
              await supabase.functions.invoke("send-transactional-email", {
                body: {
                  templateName: "role-invitation",
                  recipientEmail: normalizedEmail,
                  idempotencyKey: `coach-invite-${inv.id}`,
                  templateData: {
                    role: "Team member",
                    inviteUrl: `https://paigeagent.ai/auth?invite=${plaintextToken}`,
                    // §45: no inviting tenant is resolvable on this bridge path, so the
                    // inviter is omitted present-only (the template shows a neutral
                    // "your admin" line) — never a hardcoded operator ("Antonio Cook").
                  },
                },
              });
              inviteSent = true;
            } catch (e) {
              console.error("coach invite email failed:", e);
            }
          }
        }

        // Bulk-insert coach_clients (idempotent via unique pair if present, otherwise best-effort dedupe)
        let assignmentsCreated = 0;
        if (client_user_ids.length > 0) {
          const rows = client_user_ids.map((cid: string) => ({
            coach_user_id: coachUserId,
            client_user_id: cid,
            status: "active",
          }));
          const { data: inserted, error: ccErr } = await supabase
            .from("coach_clients")
            .upsert(rows, { onConflict: "coach_user_id,client_user_id", ignoreDuplicates: true })
            .select("id");
          if (ccErr) {
            return res(400, { success: false, message: `coach_clients upsert failed: ${ccErr.message}` });
          }
          assignmentsCreated = inserted?.length ?? 0;
        }

        await supabase.from("audit_logs").insert({
          user_id: coachUserId,
          entity: "coach_clients",
          action: "create_coach_assignment_via_webhook",
          data: { coach_email: normalizedEmail, client_user_ids, invite_sent: inviteSent },
        });

        result = {
          success: true,
          coach_user_id: coachUserId,
          assignments_created: assignmentsCreated,
          invite_sent: inviteSent,
        };
        break;
      }

      case "assign_coach_to_client": {
        const { coach_email, client_ids } = actionData || {};
        if (!coach_email || !Array.isArray(client_ids) || client_ids.length === 0) {
          return res(400, { success: false, message: "coach_email and client_ids[] required" });
        }
        const normalizedEmail = String(coach_email).toLowerCase().trim();

        // Look up coach by email
        const { data: coachUsers, error: lookupErr } = await supabase.auth.admin.listUsers();
        if (lookupErr) {
          return res(500, { success: false, message: `Coach lookup failed: ${lookupErr.message}` });
        }
        const coach = coachUsers.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
        if (!coach) {
          return res(404, { success: false, message: `Coach not found: ${coach_email}` });
        }

        // Assign coach to each client record
        const { data: updated, error: updateErr } = await supabase
          .from("clients")
          .update({ assigned_coach_user_id: coach.id })
          .in("id", client_ids)
          .select("id, linked_user_id");

        if (updateErr) {
          return res(500, { success: false, message: `Assignment failed: ${updateErr.message}` });
        }

        await supabase.from("audit_logs").insert({
          user_id: coach.id,
          entity: "clients",
          action: "assign_coach_via_webhook",
          data: { coach_email: normalizedEmail, client_ids, assigned_count: updated?.length || 0 },
        });

        result = {
          success: true,
          coach_user_id: coach.id,
          assignments_updated: updated?.length || 0,
          client_ids: updated?.map((r) => r.id) || [],
        };
        break;
      }



      default:

        return res(400, { success: false, message: `Unknown action: ${action}` });
    }

    // Log inbound event
    await supabase.from("webhook_event_log").insert({
      direction: "inbound",
      event_type: action,
      payload_summary: { action, has_data: !!actionData },
      request_payload: body,
      http_status: 200,
      status: "success",
    });

    return res(200, result);
  } catch (error) {
    console.error("Inbound webhook error:", error);

    // Log failure
    try {
      await supabase.from("webhook_event_log").insert({
        direction: "inbound",
        event_type: "unknown",
        payload_summary: { error: error.message },
        http_status: 500,
        status: "failed",
      });
    } catch (_) {}

    return res(500, { success: false, message: "Internal server error" });
  }
});

function res(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
    },
  });
}
