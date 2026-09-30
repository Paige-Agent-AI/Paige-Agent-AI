import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { createClient as createLimiterClient } from "https://esm.sh/@supabase/supabase-js@2";
import { overRateLimit } from "../_shared/rateLimit.ts";
import { operatorUserId } from "../_shared/systems-check-http.ts";

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

// This function sends platform-domain mail on an inviter's say-so, so what reaches the inbox is
// bounded: always the role-invitation template, a short personal note, names clamped to a plain
// label, a logo only from the platform's own storage, and hourly caps per inviter, per tenant and
// across the platform.
const INVITE_TEMPLATE = "role-invitation";
const MAX_MESSAGE_CHARS = 500;
const MAX_LABEL_CHARS = 60;
const INVITES_PER_HOUR = 20;
const INVITES_PER_TENANT_PER_HOUR = 50;
const INVITES_PLATFORM_PER_HOUR = 200;

/** A name as a short plain label: one line, no links, at most MAX_LABEL_CHARS. */
function plainLabel(value: unknown, fallback: string | null): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || /https?:\/\/|www\./i.test(text)) return fallback;
  return text.length > MAX_LABEL_CHARS ? `${text.slice(0, MAX_LABEL_CHARS - 1)}…` : text;
}

interface InvitationRequest {
  email: string;
  role: InviteRole;
  message?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the caller is signed in; what they may invite is decided below.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");

    const body: InvitationRequest = await req.json();
    const { email, role } = body;
    if (!email || !role) throw new Error("Email and role are required");
    if (!VALID_ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
    const message = typeof body.message === "string" && body.message.trim() ? body.message.trim() : null;
    if (message && message.length > MAX_MESSAGE_CHARS) {
      throw new Error(`Message must be ${MAX_MESSAGE_CHARS} characters or fewer`);
    }
    // The invitation carries its own accept link. A note with another one is how an invite becomes
    // a phishing mail, and anyone can start a trial tenant, so notes are link-free.
    if (message && /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|ai|app|link|info|biz|xyz|me|ly)\b/i.test(message)) {
      throw new Error("Leave links out of the note — the invitation already includes the link to join.");
    }
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
    const inviterName = plainLabel(inviterProfile?.full_name, null) ?? plainLabel(user.email, null) ?? "An administrator";
    const inviterTenantId = inviterProfile?.active_tenant_id || inviterMemberships?.[0]?.tenant_id || null;

    // Who may invite: a platform operator, or an admin of the tenant the invite is for — both
    // checked under the caller's own token. Not the global `admin` role: every tenant owner holds
    // it, so it says nothing about THIS tenant.
    const isOperator = (await operatorUserId(req)) === user.id;
    let isTenantAdmin = false;
    if (!isOperator && inviterTenantId) {
      const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: adminOfTenant } = await asCaller.rpc("is_tenant_admin", { _tenant: inviterTenantId });
      isTenantAdmin = adminOfTenant === true;
    }
    if (!isOperator && !isTenantAdmin) throw new Error("Insufficient permissions");

    const limiter = createLimiterClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
    if (
      (await overRateLimit(limiter, `invite:${user.id}`, INVITES_PER_HOUR, 3600, true)) ||
      (inviterTenantId &&
        (await overRateLimit(limiter, `invite-tenant:${inviterTenantId}`, INVITES_PER_TENANT_PER_HOUR, 3600, true))) ||
      (await overRateLimit(limiter, "invite:all", INVITES_PLATFORM_PER_HOUR, 3600, true))
    ) {
      throw new Error("Too many invitations in the last hour. Try again later.");
    }

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
        template_name: INVITE_TEMPLATE,
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
        brandName = plainLabel(rb.tenant_name, null);
        const ownStorage = `${supabaseUrl}/storage/v1/object/public/`;
        brandLogoUrl = rb.logo_url && rb.logo_url.startsWith(ownStorage) ? rb.logo_url : null;
        brandColor = rb.primary_color ?? null;
      }
    }

    const { error: emailError } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: INVITE_TEMPLATE,
        recipientEmail: email,
        idempotencyKey: `invite-${invitation.id}`,
        tenantId: inviterTenantId,
        templateData: { role: roleLabel, inviteUrl, invitedBy: inviterName, message, brandName, brandLogoUrl, brandColor },
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
