// pipeline-suggest — Paige reads a tenant's program and proposes a sales/delivery
// pipeline with ordered stages tailored to it. Read/propose only; the actual
// create happens through the governed pipeline_configure command on the tenant's approval
// (§8 propose→confirm). Tenant-generic: no funding/credit framing unless the
// tenant's OWN program is explicitly about it (§2/§9).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { gatewayCompat } from "../_shared/claude.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are Paige, an expert operations strategist for client-based service businesses (coaches, consultants, agencies, advisors). A business owner has given you their PROGRAM — a description, outline, or document of the offer they run for clients. Your job: infer what the program is and design the sales/delivery PIPELINE that fits it, so the owner can track every client's progress through it.

Return ONLY a JSON object (no prose, no code fences) with this exact shape:
{
  "program_summary": "1-2 sentences, in the owner's own terms, on what this program is and who it serves.",
  "proposed_pipeline": {
    "name": "A short, specific pipeline name in the program's own language (e.g. 'Consulting Engagement', 'Coaching Journey', 'Agency Onboarding').",
    "description": "One line on what moving a client across these stages represents.",
    "stages": [
      { "label": "Stage name", "probability": 0-100, "stage_type": "open|won|lost", "rationale": "One line: what has to be true for a client to be in this stage." }
    ]
  }
}

RULES:
- 4 to 7 stages. Exactly ONE stage_type "won" (the successful end) and exactly ONE "lost" (the drop-off end); the rest are "open".
- Probabilities increase monotonically across the open stages (early = low, late = high); the "won" stage is 100, the "lost" stage is 0.
- Name the stages in the tenant's OWN vocabulary drawn from their program — mirror their phases, milestones, and outcomes. Do not impose a generic Lead→Won template if the program implies richer stages.
- Stay tenant-generic. Do NOT introduce funding, credit, FICO, lending, or bureau language UNLESS the owner's program is itself explicitly about those topics. If the program is generic coaching/consulting/agency work, keep the stages generic.
- Voice: direct and confident. No filler.`;

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model output");
  return JSON.parse(raw.slice(start, end + 1));
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const authed = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await authed.auth.getUser();
    if (userErr || !user) throw new Error("Unauthorized");

    // Role gate: admin only.
    const { data: roleRows } = await authed.from("user_roles").select("role").eq("user_id", user.id);
    const roles = (roleRows || []).map((r: any) => r.role);
    if (!roles.some((r: string) => r === "admin" || r === "super_admin")) {
      return new Response(JSON.stringify({ error: "Admin access required." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { program_text } = await req.json();
    if (!program_text || String(program_text).trim().length < 20) {
      return new Response(JSON.stringify({ error: "Provide a description of your program (a paragraph or more)." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await gatewayCompat("anthropic", {
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Here is my program:\n\n${String(program_text).slice(0, 12000)}` },
        ],
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Inference failed (${resp.status}): ${err.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content);

    // Normalize + guard the shape so the client and the create RPC can trust it.
    const stagesIn = Array.isArray(parsed?.proposed_pipeline?.stages) ? parsed.proposed_pipeline.stages : [];
    const stages = stagesIn.slice(0, 7).map((s: any, i: number) => ({
      label: String(s?.label ?? `Stage ${i + 1}`).slice(0, 60),
      probability: Math.max(0, Math.min(100, Number(s?.probability) || 0)),
      stage_type: ["open", "won", "lost"].includes(s?.stage_type) ? s.stage_type : "open",
      rationale: String(s?.rationale ?? "").slice(0, 200),
    }));

    return new Response(
      JSON.stringify({
        program_summary: String(parsed?.program_summary ?? "").slice(0, 600),
        proposed_pipeline: {
          name: String(parsed?.proposed_pipeline?.name ?? "Client Pipeline").slice(0, 60),
          description: String(parsed?.proposed_pipeline?.description ?? "").slice(0, 200),
          stages,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("pipeline-suggest error:", e);
    return new Response(JSON.stringify({ error: e?.message || "Failed to suggest a pipeline" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
