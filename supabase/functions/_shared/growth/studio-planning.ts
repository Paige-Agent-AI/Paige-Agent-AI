export const STUDIO_PLAN_APPROVAL = "Approve this plan and start the private build.";
// The existing Studio session stores this startup marker, never conversation messages.
// Planning and approval receipts themselves live exclusively in its native chat thread.
export const STUDIO_PLANNING_START = { role: "system", content: "", studio_workflow_version: "plan_first_v1" } as const;

export function startsStudioPlanning(transcript: unknown): boolean {
  const marker: unknown = Array.isArray(transcript) ? transcript[0] : null;
  return marker !== null && typeof marker === "object" && "studio_workflow_version" in marker
    && marker.studio_workflow_version === STUDIO_PLANNING_START.studio_workflow_version;
}

export const STUDIO_PLANNING_CORE = [
  "NEXUS STUDIO PLANNING. The owner is still shaping the brief. Do not build, render, save, publish or suggest that any of those steps have run.",
  "If the audience, intended next step or a material design decision is unclear, use ask_choices to ask a concise clarification. When an open answer is better, omit the options.",
  "When the brief is ready, call ask_choices with studio_plan_ready set to true and no options. In its prompt give the proposed format, audience, primary action, design direction and a short reason. Mention a contrasting direction when useful. Keep the plan under 300 characters.",
  "Discuss refinements to the plan until the owner uses the explicit plan approval. A plan approval authorizes beginning creative work only. It never approves a save, spending, a provider effect, or publication.",
].join("\n");

export type StudioWorkflow =
  | { kind: "planning" }
  | { kind: "proposal"; askId: string }
  | { kind: "build"; askId: string }
  | { kind: "settled"; askId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readStudioWorkflow(bundle: unknown, role: "user" | "assistant"): StudioWorkflow | null {
  if (!bundle || typeof bundle !== "object") return null;
  const { studio_workflow: state, paige_ask: ask, paige_resume: claim, studio_plan_ask_id: settled } = bundle as Record<string, unknown>;
  if (role === "user") {
    if (state === "planning") return { kind: state };
    if (state === "build" && claim && typeof claim === "object" && "key" in claim && typeof claim.key === "string") {
      const matched = /^answer:(.+)$/.exec(claim.key);
      if (matched && UUID.test(matched[1])) return { kind: "build", askId: matched[1] };
    }
    return null;
  }
  if (state === "settled" && typeof settled === "string" && UUID.test(settled)) return { kind: "settled", askId: settled };
  if (state !== "proposal" || !ask || typeof ask !== "object" || !("ask_id" in ask)
    || typeof ask.ask_id !== "string" || !UUID.test(ask.ask_id)) return null;
  return { kind: "proposal", askId: ask.ask_id };
}

type StudioProofKind = "proposal" | "build" | "settled";
export type StudioProofScope = { actorId: string; tenantId: string; threadId: string };
const encoder = new TextEncoder();

async function studioProofKey(secret: string) {
  return await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function studioProofInput(scope: StudioProofScope, kind: StudioProofKind, askId: string, question: string) {
  return encoder.encode(JSON.stringify(["paige-studio-workflow-v1", scope.actorId, scope.tenantId, scope.threadId, kind, askId, question]));
}

export async function signStudioWorkflow(secret: string, scope: StudioProofScope, kind: StudioProofKind, askId: string, question = "") {
  const proof = await crypto.subtle.sign("HMAC", await studioProofKey(secret), studioProofInput(scope, kind, askId, question));
  return Array.from(new Uint8Array(proof), byte => byte.toString(16).padStart(2, "0")).join("");
}

// The original caller append RPC accepts arbitrary JSON. Only Edge-signed
// records may open a gated phase or initiate a build.
export async function verifyStudioWorkflow(
  secret: string, scope: StudioProofScope, bundle: unknown, role: "user" | "assistant",
) {
  const workflow = readStudioWorkflow(bundle, role);
  if (!workflow || workflow.kind === "planning") return null;
  const record = bundle as { studio_proof?: unknown; paige_ask?: { question?: unknown } };
  if (typeof record.studio_proof !== "string" || !/^[0-9a-f]{64}$/.test(record.studio_proof)) return null;
  const question = workflow.kind === "proposal" ? record.paige_ask?.question : "";
  if (typeof question !== "string") return null;
  const signature = Uint8Array.from(record.studio_proof.match(/../g)!, pair => Number.parseInt(pair, 16));
  const valid = await crypto.subtle.verify("HMAC", await studioProofKey(secret), signature,
    studioProofInput(scope, workflow.kind, workflow.askId, question));
  return valid ? workflow : null;
}

export function studioPlanningAllowsTool(name: string) {
  return name === "ask_choices";
}

const PRIVATE_STUDIO_BUILD_TOOLS = new Set([
  "ask_choices", "capability_status", "growth_list",
  "growth_page_generate", "growth_page_save", "growth_form_save",
  "growth_funnel_generate", "growth_funnel_build",
  "draft_marketing_content", "content_save", "generate_image",
]);

export function studioPlanBuildAllowsTool(name: string) {
  return PRIVATE_STUDIO_BUILD_TOOLS.has(name);
}

export function projectStudioWorkflow(
  turns: readonly { studioWorkflow?: StudioWorkflow | null }[],
  newProject: boolean,
): { phase: "planning" | "build"; proposal: string | null; pendingBuild: string | null } {
  let phase: "planning" | "build" = newProject ? "planning" : "build";
  let pendingBuild: string | null = null;
  let claimed = false;
  for (const [index, turn] of turns.entries()) {
    const marker = turn.studioWorkflow;
    if (!claimed && (marker?.kind === "planning" || marker?.kind === "proposal")) phase = "planning";
    if (marker?.kind === "build") {
      const previous = turns[index - 1]?.studioWorkflow;
      if (previous?.kind === "proposal" && previous.askId === marker.askId) {
        phase = "build";
        claimed = true;
        pendingBuild = marker.askId;
      }
    }
    if (marker?.kind === "settled" && pendingBuild === marker.askId) pendingBuild = null;
  }
  const last = turns.at(-1)?.studioWorkflow;
  return { phase, proposal: phase === "planning" && last?.kind === "proposal" ? last.askId : null, pendingBuild };
}
