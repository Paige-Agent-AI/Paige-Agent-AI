// Returns the auth.users list to admins/coaches.
// Uses the service role client because supabase.auth.admin.* cannot be called
// from the browser. Validates the caller's JWT and verifies they have an
// admin or coach role before returning anything.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Caller-scoped client for auth verification
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } =
      await callerClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    // Verify caller has admin or coach role
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roles, error: rolesErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (rolesErr) {
      return json({ error: "Failed to verify role" }, 500);
    }
    const roleList = (roles || []).map((r: { role: string }) => r.role);
    const isPlatformOwner = roleList.includes("super_admin");
    if (!roleList.includes("admin") && !isPlatformOwner) {
      return json({ error: "Forbidden" }, 403);
    }

    const { data: activeProfile } = await admin
      .from("profiles")
      .select("active_tenant_id")
      .eq("user_id", userId)
      .maybeSingle();
    const { data: memberRows } = await admin
      .from("tenant_members")
      .select("tenant_id, user_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("joined_at", { ascending: true });
    const activeTenantId = activeProfile?.active_tenant_id ?? memberRows?.[0]?.tenant_id ?? null;

    let allowedUserIds: Set<string> | null = null;
    if (!isPlatformOwner) {
      if (!activeTenantId) return json({ users: [] });
      const { data: tenantUsers, error: tenantUsersErr } = await admin
        .from("tenant_members")
        .select("user_id")
        .eq("tenant_id", activeTenantId)
        .eq("status", "active");
      if (tenantUsersErr) return json({ error: "Failed to resolve tenant users" }, 500);
      allowedUserIds = new Set((tenantUsers ?? []).map((r: { user_id: string }) => r.user_id));
    }

    // Page through up to 5,000 users so the admin panel sees relevant users.
    const perPage = 1000;
    const collected: Array<{
      id: string;
      email: string | null;
      created_at: string;
      last_sign_in_at: string | null;
    }> = [];

    for (let page = 1; page <= 5; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) {
        return json({ error: error.message }, 500);
      }
      for (const u of data.users) {
        if (allowedUserIds && !allowedUserIds.has(u.id)) continue;
        collected.push({
          id: u.id,
          email: u.email ?? null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
        });
      }
      if (data.users.length < perPage) break;
    }

    return json({ users: collected, tenant_id: activeTenantId, scoped: !isPlatformOwner });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
