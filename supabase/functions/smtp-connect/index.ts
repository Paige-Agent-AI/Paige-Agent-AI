// Connects a tenant's OWN generic SMTP server so send-message can send outbound email
// through it (provider='smtp', #141c). The tenant enters host/port/username/password/from;
// this function SSRF-guards the host/port, does an honest reachability handshake, stores
// {user,pass} ONLY in Vault as a JSON blob (never a column, never a log), and provisions the
// tenant's channel_connectors row.
//
// §18 REUSE — this is the gmail-oauth-callback shape MINUS OAuth (there is no code exchange /
// userinfo for a bring-your-own SMTP server): the admin has_role gate, the server-side
// tenant resolve from profiles (never the body, §9), the write_channel_secret-under-service-role
// step, and the connector upsert are all the SAME pattern. The Vault bridge (write/read_channel_secret),
// the SSRF guard, and the transport live in _shared/smtp.ts (§18 one home) — this fn is the
// provisioning caller.
//
// §9 CREDENTIAL MODEL: SMTP has TWO secret fields (user, pass), so — unlike Twilio/Gmail's one
// secret — they are JSON.stringify'd into ONE Vault secret ({user,pass}) addressed by a stable
// ref (smtp_credentials:<tenantId>). The non-secret host/port/secure live in channel_connectors.config
// (jsonb). The password is NEVER logged and NEVER echoed.
//
// §9 SEND-ONLY / NO inbound_address: a bring-your-own SMTP server is OUTBOUND only, so this
// connector deliberately leaves inbound_address NULL. That sidesteps the GLOBAL
// uq_channel_connectors_inbound_address unique index entirely (no cross-tenant collision surface
// to reason about — the reason the Gmail flow needs its 3-branch same-tenant guard). One-SMTP-
// per-tenant is enforced by keying the reconnect/update on (tenant_id, provider='smtp').
//
// §13 HONEST HANDSHAKE: before provisioning we run a real reachability probe (TCP/TLS connect to
// the host on the given port, then close — NO mail sent). On failure we return a structured error
// and do NOT vault or provision, so a coach never sees a fake "Connected" for an unreachable host.
// HONEST LIMIT (§13): denomailer exposes no AUTH-only primitive and a send-based probe would deliver
// a real email, so this handshake proves REACHABILITY (host answers on the port), not credential
// validity — the first real send surfaces any auth error honestly through send-message's structured
// result. Stated plainly, not implied away.
//
// CONFIG-GATED (§13): the transport dep is self-contained; verify_jwt=true (config.toml default).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertHostAllowed } from "../_shared/smtp.ts";
import { resolveTenantForUser } from "../_shared/tenant-for-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** A stable Vault secret NAME for a tenant's SMTP {user,pass} blob (§12 naming convention). */
function smtpVaultRef(tenantId: string): string {
  return `smtp_credentials:${tenantId}`;
}

interface ConnectBody {
  host?: unknown;
  port?: unknown;
  secure?: unknown;
  username?: unknown;
  password?: unknown;
  from_address?: unknown;
  from_name?: unknown;
}

/**
 * Honest reachability handshake (§13): open a socket to the SSRF-validated host on the given
 * port and close it — proves the server answers, sends NO mail. Implicit-TLS (465 / secure)
 * does a TLS connect (servername = host for SNI); STARTTLS ports do a plain TCP connect. A
 * short timeout keeps a dead host from hanging the request. Returns null on success, or a
 * machine reason code on failure.
 */
async function reachabilityProbe(host: string, port: number, secure: boolean): Promise<string | null> {
  const controllerTimeout = 8000;
  let conn: Deno.Conn | null = null;
  const probe = (async (): Promise<string | null> => {
    try {
      conn = secure
        ? await Deno.connectTls({ hostname: host, port, servername: host })
        : await Deno.connect({ hostname: host, port });
      return null;
    } catch (e) {
      return `smtp_host_unreachable: ${String((e as Error).message).slice(0, 200)}`;
    }
  })();
  // Close the socket exactly when the connect SETTLES — including when the timeout won the
  // race and the connect resolves LATE. Closing only after Promise.race would leak a late
  // socket (conn is still null at race time), so bind cleanup to the probe itself.
  void probe.finally(() => {
    try {
      conn?.close();
    } catch {
      /* best-effort */
    }
  });
  const timeout = new Promise<string>((resolve) =>
    setTimeout(() => resolve("smtp_host_unreachable: connect timed out"), controllerTimeout)
  );
  return await Promise.race([probe, timeout]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const userSupa = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userSupa.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // §9: provisioning the tenant-wide SMTP SENDING identity is an admin action — the SAME
    // gate the Gmail connect/disconnect apply. has_role is global; tenant is bound server-side below.
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Read + validate the typed body BEFORE anything (§9/§13). ──
    let body: ConnectBody;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const host = typeof body.host === "string" ? body.host.trim() : "";
    const portNum = typeof body.port === "number" ? body.port : Number(body.port);
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fromAddress = typeof body.from_address === "string" ? body.from_address.trim() : "";
    const fromName = typeof body.from_name === "string" ? body.from_name.trim() : null;
    // Default secure from the port (465 = implicit TLS); allow an explicit override.
    const secure = typeof body.secure === "boolean" ? body.secure : portNum === 465;

    if (!host || !Number.isFinite(portNum) || !username || !password || !fromAddress) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Basic from-address shape (a real send would fail otherwise) — honest early reject (§13/§31).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
      return new Response(JSON.stringify({ error: "invalid_from_address" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── SSRF/port allowlist gate BEFORE any socket (§9). ──
    const guard = await assertHostAllowed(host, portNum);
    if (!guard.ok) {
      return new Response(JSON.stringify({ error: guard.error ?? "smtp_host_not_allowed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Honest reachability handshake (§13) — do NOT vault/provision on failure. ──
    const probeErr = await reachabilityProbe(host, portNum, secure);
    if (probeErr) {
      return new Response(JSON.stringify({ error: "smtp_host_unreachable", detail: probeErr }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Resolve the tenant SERVER-SIDE from the caller's user id (§9 — never body). ──
    // Was `profiles.tenant_id` keyed on `profiles.id`: a non-existent column read
    // with a surrogate key, so every caller got `no_tenant_for_user`. See
    // `_shared/tenant-for-user.ts` for the production measurement.
    // This endpoint is called with the caller's own JWT, so the workspace they
    // are standing in is one RPC away on the USER client — no signed state
    // needed. Passing it matters for the same reason it matters in the OAuth
    // callbacks: without it a multi-workspace person's SMTP server attaches to
    // whichever tenant ranks first rather than the one they configured it in.
    const { data: activeTenant } = await userSupa.rpc("current_user_tenant_id");
    const resolved = await resolveTenantForUser(
      admin, user.id, typeof activeTenant === "string" ? activeTenant : null,
    );
    const tenantId = resolved.tenantId;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "no_tenant_for_user" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Store {user,pass} ONLY in Vault as a JSON blob (§9/§34) — never a column, never a log. ──
    const ref = smtpVaultRef(tenantId);
    const { error: vaultErr } = await admin.rpc("write_channel_secret", {
      _ref: ref,
      _secret: JSON.stringify({ user: username, pass: password }),
      _description: `SMTP credentials for tenant ${tenantId} (${fromAddress})`,
    });
    if (vaultErr) {
      // Never echo the credentials; a vault failure is a real failure (§13).
      return new Response(JSON.stringify({ error: "vault_write_failed", detail: vaultErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Provision the channel_connectors row. SEND-ONLY → inbound_address stays NULL, so the
    //    global inbound_address unique index has no collision surface. One-SMTP-per-tenant is
    //    keyed on (tenant_id, provider='smtp'): reconnect our own row, else insert. ──
    const connectorFields = {
      channel_type: "email",
      provider: "smtp",
      from_address: fromAddress,
      from_name: fromName,
      display_name: fromName ?? fromAddress,
      credentials_vault_ref: ref,
      // Non-secret transport config lives here (jsonb), NEVER the creds (§9).
      config: { host, port: portNum, secure },
      status: "active",
      active: true,
    };

    const { data: ownRow } = await admin
      .from("channel_connectors")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("channel_type", "email")
      .eq("provider", "smtp")
      .maybeSingle();

    if (ownRow?.id) {
      const { error: updErr } = await admin
        .from("channel_connectors")
        .update({ ...connectorFields, updated_at: new Date().toISOString() })
        .eq("id", ownRow.id)
        .eq("tenant_id", tenantId); // belt-and-suspenders §9 scope
      if (updErr) {
        return new Response(JSON.stringify({ error: "connector_update_failed", detail: updErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // Fresh insert. tenant_id is set EXPLICITLY (§9) — under service role the
      // set_channel_connector_tenant() trigger coalesces to new.tenant_id since
      // current_user_tenant_id() is null in a service-role context.
      const { error: insErr } = await admin
        .from("channel_connectors")
        .insert({ ...connectorFields, tenant_id: tenantId });
      if (insErr) {
        return new Response(JSON.stringify({ error: "connector_insert_failed", detail: insErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, from_address: fromAddress }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error).message ?? err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
