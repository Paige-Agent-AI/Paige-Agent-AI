import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// STAFF roles only. Client/consumer invites must NOT go through this function —
// it emits the operator /accept-invite dashboard link and, on accept, routes by
// role into the operator app (§9). A CLIENT is invited via the portal path
// (create_tenant_invite_token kind='consumer' + send-portal-invite → /join), so
// 'user' and 'client' are deliberately excluded here: a miswired caller passing
// them now fails loudly instead of silently dropping a client into the dashboard.
// "Coach" is a title a business gives its people, never a role an invitation grants.
const VALID_ROLES = [
  "moderator", "admin",
  "affiliate", "sales_rep", "broker", "cs_rep", "finance", "viewer",
] as const;
type InviteRole = typeof VALID_ROLES[number];

interface InvitationRequest {
  email: string;
  role: InviteRole;
  templateName?: string;
  message?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");

    // Accept admin OR platform owner (Antonio)
    const [{ data: ownerCheck }, { data: roleData }] = await Promise.all([
      supabase.rpc("is_platform_owner"),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle(),
    ]);

    if (!ownerCheck && !roleData) throw new Error("Insufficient permissions");

    const body: InvitationRequest = await req.json();
    const { email, role, templateName, message } = body;
    if (!email || !role) throw new Error("Email and role are required");
    if (!VALID_ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);

    console.log(`Creating invitation for ${email} with role ${role}`);

    // Get inviter's name + active tenant for the email. Tenant membership is
    // required for live CRM/pipeline RLS visibility; app roles alone are not enough.
    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("full_name, active_tenant_id")
      .eq("user_id", user.id)
      .single();
    const { data: inviterMemberships } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .limit(1);
    const inviterName = inviterProfile?.full_name || user.email || "An administrator";
    const inviterTenantId = inviterProfile?.active_tenant_id || inviterMemberships?.[0]?.tenant_id || null;

    // 1. Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);

    let targetUserId: string;

    if (existingUser) {
      // User already exists — just assign the role
      targetUserId = existingUser.id;
      console.log("User already exists, assigning role:", targetUserId);
    } else {
      // 2. Create the user account (pre-populate with email, confirmed)
      const tempPassword = crypto.randomUUID() + "Aa1!"; // Strong temp password
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true, // Pre-confirm so they don't need email verification
        user_metadata: { invited_by: user.id, invited_role: role },
      });

      if (createError) throw new Error(`Failed to create user: ${createError.message}`);
      targetUserId = newUser.user.id;
      console.log("Created new user:", targetUserId);
    }

    // 3. Do NOT grant the role or tenant membership yet. An invite must stay
    // PENDING until the person actually signs up — accept-invite grants the
    // user_role and upserts tenant_members (status 'active', joined_at now) when
    // they set their password. Granting here made invitees show as active
    // members before they'd ever accepted. The pre-created auth user above only
    // exists so accept-invite can set their password; it carries no role/tenant
    // access until acceptance. The pending state is the invitations row itself
    // (accepted_at IS NULL), which MembersAdmin renders as a pending invite.

    // 4. Mint our own opaque token; the BEFORE INSERT trigger hashes it and clears the plaintext.
    const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    // 5. Create invitation record (token gets hashed by trg_hash_invitation_token).
    const { data: invitation, error: inviteError } = await supabase
      .from("invitations")
      .insert({
        email,
        role,
        invited_by: user.id,
        token: rawToken,
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        template_name: templateName ?? null,
        tenant_id: inviterTenantId,
        metadata: { ...(message ? { message } : {}), invited_by_name: inviterName },
      })
      .select()
      .single();

    if (inviteError) throw inviteError;

    // Invite URL points at our unified /accept-invite page; the edge function
    // hashes the raw token, looks it up, and routes by role on consume.
    const inviteUrl = `https://paigeagent.ai/accept-invite?token=${rawToken}`;

    // 6. Send branded invitation email
    const roleLabels: Record<string, string> = {
      admin: "Administrator", moderator: "Moderator",
      affiliate: "Affiliate Partner",
      sales_rep: "Sales Rep", broker: "Broker", cs_rep: "Customer Success",
      finance: "Finance", viewer: "Viewer",
    };
    const roleLabel = roleLabels[role] || role;

    // §6/§9: a tenant's staff invite wears the TENANT's brand, not the platform's.
    // Resolve up the parent chain (child inherits its agency's logo/color); the
    // resolver floors unset colors to the platform tokens, never the master brand.
    // No tenant (platform-owner invite with no active tenant) → Paige defaults.
    let brandName: string | null = null;
    let brandLogoUrl: string | null = null;
    let brandColor: string | null = null;
    if (inviterTenantId) {
      const { data: brandRows } = await supabase.rpc("resolve_tenant_brand", { _tenant_id: inviterTenantId });
      const rb = (Array.isArray(brandRows) ? brandRows[0] : brandRows) as
        | { tenant_name?: string; primary_color?: string; logo_url?: string | null }
        | null;
      if (rb) {
        brandName = rb.tenant_name ?? null;
        brandLogoUrl = rb.logo_url ?? null;
        brandColor = rb.primary_color ?? null;
      }
    }

    const { error: emailError } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: templateName || "role-invitation",
        recipientEmail: email,
        idempotencyKey: `invite-${invitation.id}`,
        tenantId: inviterTenantId,
        templateData: { role: roleLabel, inviteUrl, invitedBy: inviterName, message: message ?? null, brandName, brandLogoUrl, brandColor },
      },
    });

    const emailSent = !emailError;
    if (emailError) {
      console.error("Failed to send invitation email:", emailError);
    } else {
      console.log("Invitation email queued successfully");
    }

    // 7. Log audit event
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      entity: "invitation",
      action: "user_invited",
      entity_id: invitation.id,
      data: { invited_email: email, role, target_user_id: targetUserId, tenant_id: inviterTenantId },
    });

    return new Response(
      JSON.stringify({ success: true, invitation, emailSent, userCreated: !existingUser }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-admin-invitation:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
