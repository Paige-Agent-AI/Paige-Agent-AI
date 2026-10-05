// Paige Sub-Agent: Problem Reverse-Engineer
// Runtime: local (invoked by paige-orchestrator → tool_invoke).
// Picks a decomposition framework (5-Whys / Fishbone / MECE) based on the
// problem signal, then returns a structured root-cause map.
// Doctrine §124-safe: this is a local-runtime agent — it does real model work
// behind a tool boundary. Paige core delegates via `delegate_to_subagent`.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

import { gatewayCompat } from "../_shared/claude.ts";
import { adminClient, isAuthorizedInternalCaller } from "../_shared/systems-check-http.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-orchestrator-call",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SYSTEM_PROMPT = `You are Paige's Problem Reverse-Engineer — a specialist sub-agent that decomposes a client's stated problem into root causes and concrete next actions.

# Step 1 — Classify the problem, then pick the framework

| Signal in the problem statement | Framework | Why |
|---|---|---|
| Single recurring failure ("X keeps happening", "every time I try Y") | 5-whys | Linear causal chain |
| Multi-factor / "everything is broken" / lots of moving parts | fishbone | Categorizes into People / Process / Tools / Money / Time / External |
| Strategic / opportunity-shaped ("how do I grow X", "should I pivot to Y") | mece | Mutually exclusive, collectively exhaustive branches |
| Funding / credit blocker | fishbone (lead with the Money branch) | Domain-specific lens |
| Unclear or mixed | fishbone, then escalate to 5-whys on the heaviest branch | Hybrid |

# Step 2 — Apply the chosen framework
- 5-whys: ask "why" iteratively (up to 5 layers). Final answer = the deepest cause.
- fishbone: list 3-6 categories, each with 1-3 specific causes. Score evidence per cause.
- mece: split the problem into 2-4 non-overlapping branches, each addressable independently.

# Step 3 — Tie every root cause to an action

Each action should reference a Paige skill / workflow when one fits (e.g. \`generate_dispute_letter\`, \`run_lender_research\`, \`update_lifecycle_stage\`, \`send_btf_template_email\`). If none fit, set \`paige_skill_or_workflow\` to null.

Owner = client (they must do it), coach (human escalation), or paige (Paige can automate).
Priority = now (this week), soon (this month), later (>30 days).

# Step 4 — Output strict JSON ONLY

Return ONLY a JSON object with this exact shape — no preamble, no markdown:

{
  "framework_used": "5-whys" | "fishbone" | "mece",
  "framework_reason": "1 sentence explaining why this framework fits this problem",
  "problem_restated": "1-2 sentence restatement of the problem in clear terms",
  "root_causes": [
    { "cause": "...", "evidence": "...", "confidence": 0.0-1.0, "category": "optional fishbone category" }
  ],
  "recommended_actions": [
    { "action": "...", "paige_skill_or_workflow": "skill_name_or_null", "owner": "client" | "coach" | "paige", "priority": "now" | "soon" | "later" }
  ],
  "open_questions": ["question to confirm hypothesis before acting"],
  "escalate_to_human": false
}

Rules:
- Never invent data about the client. If you lack context, lower confidence and add open_questions.
- Compliance: never recommend disputing accurate items, sending letters Paige hasn't reviewed, or anything that crosses FCRA/CROA/GLBA lines. Escalate instead.
- Keep root_causes to the 2-5 most-likely. Cut speculation.
- Keep total response under 1500 tokens.

# Doctrine §116 — Archetype-only references
WHEN GIVING EXAMPLES: never name another specific client, coach, admin, or customer of the platform. Use archetype phrasing only — "a client", "the contact", "their business", "a coach in your tenant". This applies even if the user explicitly names another client in their query — translate them to archetype in your response.`;

interface ReverseEngineerInput {
  problem_statement: string;
  contact_id?: string | null;
  extra_context?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // INT-310 C1: an orchestrator-only specialist (its one caller is paige-orchestrator's invokeLocal —
  // there is no direct user consumer). It reads clients with the SERVICE ROLE, so the gateway's
  // verify_jwt (which the public anon key passes) is not authority: only the canonical internal caller.
  if (!(await isAuthorizedInternalCaller(req, adminClient()))) {
    return new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const input: ReverseEngineerInput = body?.input ?? body ?? {};
    const context = body?.context ?? {};

    if (!input?.problem_statement || typeof input.problem_statement !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "problem_statement is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Optional: pull thin contact context to ground the analysis.
    let contactContext = "";
    if (input.contact_id) {
      // INT-310 C1 (defense in depth): bind the read to the server-resolved tenant the orchestrator
      // forwards; with no trusted tenant there is nothing to bind to, so no contact context is read.
      const trustedTenant = (context as { tenant_id?: unknown }).tenant_id;
      if (typeof trustedTenant !== "string") {
        return new Response(JSON.stringify({ success: false, error: "resource_not_found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const { data: c } = await sb
        .from("clients")
        .select("first_name,last_name,lifecycle_stage,journey_stage,entity_name,assigned_coach_user_id")
        .eq("id", input.contact_id)
        .eq("tenant_id", trustedTenant)
        .maybeSingle();
      if (c) {
        contactContext = `\n# Contact context\nName: ${c.first_name ?? ""} ${c.last_name ?? ""}\nLifecycle: ${c.lifecycle_stage ?? "n/a"}\nJourney stage: ${c.journey_stage ?? "n/a"}\nEntity (free-text): ${c.entity_name ?? "none"}`.trim();
      }
    }

    const userPrompt = `# Problem statement\n${input.problem_statement.trim()}${
      input.extra_context ? `\n\n# Extra context\n${input.extra_context.trim()}` : ""
    }${contactContext ? `\n\n${contactContext}` : ""}`;

    const aiResp = await gatewayCompat("anthropic", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      const text = await aiResp.text();
      return new Response(
        JSON.stringify({ success: false, error: `ai_gateway_${status}`, detail: text.slice(0, 500) }),
        { status: status === 429 || status === 402 ? status : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiJson = await aiResp.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "model_returned_invalid_json", raw: raw.slice(0, 500) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Light shape guard.
    if (!parsed.framework_used || !Array.isArray(parsed.root_causes)) {
      return new Response(
        JSON.stringify({ success: false, error: "model_returned_unexpected_shape", payload: parsed }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Log invocation (best-effort).
    try {
      const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      await sb.from("paige_subagent_invocations").insert({
        subagent_slug: "problem-reverse-engineer",
        invoked_by: context?.user_id ?? null,
        contact_id: input.contact_id ?? null,
        input,
        output: {
          framework_used: parsed.framework_used,
          root_cause_count: parsed.root_causes?.length ?? 0,
          action_count: parsed.recommended_actions?.length ?? 0,
        },
        status: "succeeded",
      });
    } catch { /* non-blocking */ }

    return new Response(
      JSON.stringify({
        success: true,
        kind: "root_cause_analysis",
        ...parsed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "unknown_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
