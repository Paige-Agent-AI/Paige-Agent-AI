// content-draft — Paige drafts marketing content for a tenant: social posts,
// ad copy, email campaigns, captions, blog outlines, SMS broadcasts. Pure draft
// (no side effects), tenant-branded, in the tenant's voice. Sending anything is a
// separate, approval-gated action (§8). Tenant-generic (§2) — no consumer-finance
// framing unless the tenant's own brief is about it.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { chatCompletionCompat } from "../_shared/claude.ts";
import { claudeVoicePolish, pickRoute, routedChatCompletion } from "../_shared/model-router.ts";
import { resolveStudioCaller } from "../_shared/studio-caller.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Channel = "social_post" | "ad_copy" | "email_campaign" | "caption" | "blog_outline" | "sms_broadcast";

const CHANNEL_GUIDE: Record<Channel, string> = {
  social_post: "A punchy social post (LinkedIn/Instagram/Facebook). 1–3 short paragraphs, a strong hook first line, 2–4 relevant hashtags at the end.",
  ad_copy: "Paid-ad copy: a scroll-stopping headline (<40 chars), primary text (<125 words), and a clear CTA. Return them labeled.",
  email_campaign: "A marketing email: a subject line, a preheader, and a body (<220 words) with one clear CTA. Return them labeled.",
  caption: "A short, high-energy caption (<220 chars) with 2–4 hashtags.",
  blog_outline: "A blog-post outline: a working title, a one-line angle, and 4–7 H2 section headers each with a one-line note.",
  sms_broadcast: "A single SMS broadcast under 160 characters, with a clear CTA and no links unless asked.",
};

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in model output");
  return JSON.parse(raw.slice(start, end + 1));
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const authed = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await authed.auth.getUser();
    if (uErr || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const channel: Channel = (["social_post","ad_copy","email_campaign","caption","blog_outline","sms_broadcast"].includes(body?.channel) ? body.channel : "social_post");
    const brief = String(body?.brief ?? body?.topic ?? "").trim();
    const tone = String(body?.tone ?? "").trim();
    const count = Math.max(1, Math.min(3, Number(body?.variations) || 1));
    // §9: the workspace comes from the caller's session and they must own or administer it — never a
    // body tenant id (that let anyone holding the platform-wide admin role read another workspace's
    // name and voice).
    const caller = await resolveStudioCaller(authed, user.id, body?.tenant_id);
    if (!caller.ok) {
      return new Response(JSON.stringify({ error: caller.error, forbidden: true }), {
        status: caller.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const tenantId: string = caller.tenantId;
    if (brief.length < 5) {
      return new Response(JSON.stringify({ error: "Give a brief: what's the content about, and any key points." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Pull the tenant's brand/voice so the draft sounds like them.
    let brandName = ""; let brandVoice = "";
    if (tenantId) {
      const admin = createClient(supabaseUrl, supabaseServiceKey);
      const { data: t } = await admin.from("tenants").select("name, brand").eq("id", tenantId).maybeSingle();
      brandName = (t as any)?.name ?? "";
      const brand = (t as any)?.brand ?? {};
      brandVoice = brand?.voice ?? brand?.tone ?? "";
    }

    const SYSTEM = `You are Paige, the marketing content writer for a client-based service business${brandName ? ` called "${brandName}"` : ""}. Write high-converting, on-brand marketing content.
${brandVoice ? `Brand voice: ${brandVoice}.` : "Voice: direct, confident, human — never corporate filler."}
CHANNEL: ${CHANNEL_GUIDE[channel]}
COPY CRAFT: name a specific outcome and timeframe, never a vague benefit — "your first paying client in 30 days" beats "grow your business." Agitate a real, named problem the reader recognizes in themselves before you resolve it. Write with an actual point of view, not corporate-anonymous voice. Every claim is a concrete number, or it's cut — a hollow adjective is never doing the work a number should do.
TIER CHECK: before you return a draft, grade it. Premier copy is marketplace-scale — specific and sharp enough that a stranger would act on it now. Low-tier copy is generic filler dressed up as content. Ask yourself plainly: "is this the kind of copy that helps this business sell and make real money, or did I just generate something to satisfy the request?" If it's the latter, rewrite it before returning it.
RULES: Write for a broad client-based-services audience (coaches, consultants, agencies, advisors) unless the brief says otherwise. Do NOT invent statistics, testimonials, or guarantees. Do NOT introduce consumer-finance/credit/lending framing unless the brief is explicitly about that. Never use "AI-powered", "streamline", "seamless", or "empower".
Return ONLY JSON: {"drafts":[{"title":"short label","content":"the full copy for this channel"}]}. Produce exactly ${count} distinct draft${count > 1 ? "s" : ""}.`;

    const messages = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Brief: ${brief}${tone ? `\nTone: ${tone}` : ""}` },
    ];
    // Drafting is high-volume internal work — route it through the model router so it can
    // ride the cheap open-model tier when Featherless is configured. Claude is the safety
    // net: if the routed draft doesn't parse as our JSON, retry once on Claude reasoning.
    const route = pickRoute("internal_first_draft");
    let parsed: any;
    try {
      const data = await routedChatCompletion("internal_first_draft", { messages, response_format: { type: "json_object" } });
      parsed = extractJson(data?.choices?.[0]?.message?.content ?? "");
    } catch {
      const retry = await chatCompletionCompat({ messages, response_format: { type: "json_object" } }, "reasoning");
      parsed = extractJson(retry?.choices?.[0]?.message?.content ?? "");
    }
    const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts.slice(0, 3).map((d: any) => ({
      title: String(d?.title ?? channel).slice(0, 80),
      content: String(d?.content ?? "").slice(0, 4000),
    })) : [];

    // This copy goes to a real client/lead once the coach approves and sends it — it is
    // client-facing, not internal, even though drafting itself rides the cheap tier. When the
    // cheap pass actually drafted on an open model, give it the router's own promised Claude
    // voice-polish pass before it comes back for approval (model-router.ts's documented
    // safety net: "cheap models draft, Claude ships").
    if (route.provider === "featherless" && drafts.length) {
      await Promise.all(drafts.map(async (d) => {
        d.content = (await claudeVoicePolish(d.content, brandVoice)).slice(0, 4000);
      }));
    }

    return new Response(JSON.stringify({ channel, drafts }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("content-draft error:", e);
    return new Response(JSON.stringify({ error: e?.message || "Failed to draft content" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
