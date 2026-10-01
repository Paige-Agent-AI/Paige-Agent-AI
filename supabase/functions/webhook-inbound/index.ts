import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { phoneNotSavedMessage, setUserPrimaryAddress } from "../_shared/user-contact-methods.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Validate Authorization header matches service role key
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
    return json(401, { success: false, message: "Unauthorized" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const {
      contact_id,
      first_name,
      last_name,
      email,
      phone,
      entity_name,
      pmePhase,
      notes,
      ghl_pipeline_id,
      ghl_opportunity_id,
      location_id,
    } = body;

    // Basic validation
    if (!email || !first_name || !last_name) {
      return json(400, { success: false, message: "email, first_name, and last_name are required" });
    }

    // Check if user already exists in auth.users
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      (u: { email?: string }) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (existingUser) {
      // User exists — update their profile
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({
          full_name: `${first_name} ${last_name}`,
          ghl_contact_id: contact_id || null,
          pme_phase: pmePhase || null,
        })
        .eq("user_id", existingUser.id);

      if (profileErr) {
        return json(400, { success: false, message: profileErr.message });
      }

      // A phone in the webhook becomes the person's primary phone; the numbers they already
      // hold stay. (A webhook without a phone no longer erases theirs.)
      // The profile update above has already committed, so a refused phone is recorded in the
      // audit row and reported as exactly that — never as a failed update, and never with the
      // database's own text (it stays in the log).
      let phoneError: unknown = null;
      try {
        await setUserPrimaryAddress(supabase, existingUser.id, "phone", phone ? String(phone) : null);
      } catch (e) {
        phoneError = e;
        console.error("[webhook-inbound] phone_write_failed", { user_id: existingUser.id, message: (e as Error).message });
      }

      // Log the webhook event
      await supabase.from("audit_logs").insert({
        user_id: existingUser.id,
        entity: "client",
        action: "updated_via_ghl_webhook",
        data: {
          contact_id,
          entity_name,
          pmePhase,
          notes,
          ghl_pipeline_id,
          ghl_opportunity_id,
          location_id,
          ...(phoneError ? { phone_saved: false } : {}),
        },
      });

      if (phoneError) {
        return json(422, {
          success: false,
          action: "profile_updated",
          user_id: existingUser.id,
          message: `The profile was updated. ${phoneNotSavedMessage(phoneError)}`,
        });
      }

      return json(201, {
        success: true,
        action: "profile_updated",
        user_id: existingUser.id,
      });
    }

    // User does not exist — create invitation
    const token = crypto.randomUUID();

    const { data: invitation, error: invErr } = await supabase
      .from("invitations")
      .insert({
        email: email.toLowerCase(),
        role: "user",
        token,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      })
      .select("id, email, role, expires_at")
      .single();

    if (invErr) {
      return json(400, { success: false, message: invErr.message });
    }

    // Log the webhook event
    await supabase.from("audit_logs").insert({
      entity: "invitation",
      action: "created_via_ghl_webhook",
      entity_id: invitation.id,
      data: {
        contact_id,
        first_name,
        last_name,
        email,
        entity_name,
        pmePhase,
        notes,
        ghl_pipeline_id,
        ghl_opportunity_id,
        location_id,
      },
    });

    return json(201, {
      success: true,
      action: "invitation_created",
      invitation_id: invitation.id,
      email: invitation.email,
    });
  } catch (error) {
    console.error("webhook-inbound error:", error);
    return json(500, { success: false, message: "Internal server error" });
  }
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
