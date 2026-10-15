import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { executeVerifiedMissionMutation, type MissionToolName } from "../_shared/business-mission-tenant-brain.ts";
import { recordCapabilityRun } from "../_shared/capability-record.ts";
import { executeVerifiedMissionTargetMutation, type MissionTargetTool } from "../_shared/business-mission-targets/native.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const allowedTools = new Set<MissionToolName>(["mission_create", "mission_revise", "mission_transition"]);
const targetTools = new Set<MissionTargetTool>(["mission_target_save", "mission_target_transition"]);

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return response(405, { success: false, verified: false, code: "METHOD_NOT_ALLOWED" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return response(401, { success: false, verified: false, code: "MISSION_UNAUTHENTICATED" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return response(503, { success: false, verified: false, code: "MISSION_ACTION_UNAVAILABLE" });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return response(400, { success: false, verified: false, code: "BAD_JSON" });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return response(400, { success: false, verified: false, code: "BAD_JSON" });
  }
  const tool = body.tool;
  const args = body.args;
  if (typeof tool !== "string" || !(allowedTools.has(tool as MissionToolName) || targetTools.has(tool as MissionTargetTool)) || !args || typeof args !== "object" || Array.isArray(args)) {
    return response(400, { success: false, verified: false, code: "MISSION_ACTION_INVALID" });
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) {
    return response(401, { success: false, verified: false, code: "MISSION_UNAUTHENTICATED" });
  }

  const { data: tenantId, error: tenantError } = await caller.rpc("current_user_tenant_id");
  if (tenantError || typeof tenantId !== "string" || !tenantId) {
    return response(403, { success: false, verified: false, code: "MISSION_TENANT_NOT_RESOLVED" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = targetTools.has(tool as MissionTargetTool) ? await executeVerifiedMissionTargetMutation({
    caller,
    expectedTenantId: tenantId,
    actorId: user.id,
    tool: tool as MissionTargetTool,
    args: args as Record<string, unknown>,
    // This owner-UI door is distinct from any future Chat executor. The existing
    // Rail display uses these private native keys to credit the actual person.
    recordRun: (run) => recordCapabilityRun(admin, { ...run, capabilityKey: "owner_" + run.capabilityKey }),
  }) : await executeVerifiedMissionMutation({
    caller,
    expectedTenantId: tenantId,
    actorId: user.id,
    tool: tool as MissionToolName,
    args: args as Record<string, unknown>,
    requestSource: "owner_ui",
    recordRun: (run) => recordCapabilityRun(admin, run),
  });

  return response(200, result);
});
