import { describe, expect, it } from "vitest";
import { projectStudioWorkflow, readStudioWorkflow, resolveStudioBuildClaim, signStudioWorkflow, startsStudioPlanning, STUDIO_PLANNING_START, studioBuildOutcomeUnconfirmed, studioPlanBuildAllowsTool, studioPlanningAllowsTool, verifyStudioWorkflow } from "../../../supabase/functions/_shared/growth/studio-planning";

const askId = "19fb714e-60d4-4c7b-adaf-1089dc8c3a60";
const olderAskId = "829115a0-7ad1-4f01-8339-1e94c21569f9";
const planning = { studioWorkflow: readStudioWorkflow({ studio_workflow: "planning" }, "user") };
const plan = { studioWorkflow: readStudioWorkflow({ studio_workflow: "proposal", paige_ask: { ask_id: askId } }, "assistant") };
const claim = { studioWorkflow: readStudioWorkflow({ studio_workflow: "build", paige_resume: { key: `answer:${askId}` } }, "user") };

describe("Studio planning phase", () => {
  it("opens new projects in planning and leaves legacy projects in their workspace", () => {
    expect(startsStudioPlanning([STUDIO_PLANNING_START])).toBe(true);
    expect(projectStudioWorkflow([], true)).toEqual({ phase: "planning", proposal: null, pendingBuild: null });
    expect(projectStudioWorkflow([], false)).toEqual({ phase: "build", proposal: null, pendingBuild: null });
  });

  it("restores a pending plan or its adjacent native claim after reload", () => {
    expect(projectStudioWorkflow([planning, plan], false)).toEqual({ phase: "planning", proposal: askId, pendingBuild: null });
    expect(projectStudioWorkflow([planning, plan, claim], false)).toEqual({ phase: "build", proposal: null, pendingBuild: askId });
    expect(projectStudioWorkflow([planning, plan, claim, {}], false)).toEqual({ phase: "build", proposal: null, pendingBuild: askId });
    expect(projectStudioWorkflow([planning, plan, claim, planning, plan], false)).toEqual({ phase: "build", proposal: null, pendingBuild: askId });
    const settled = { studioWorkflow: readStudioWorkflow({ studio_workflow: "settled", studio_plan_ask_id: askId }, "assistant") };
    expect(projectStudioWorkflow([planning, plan, claim, settled], true)).toEqual({ phase: "build", proposal: null, pendingBuild: null });
  });

  it("only returns to planning when the original build is explicitly reopened", () => {
    const reopen = { studioWorkflow: readStudioWorkflow({ studio_workflow: "proposal", paige_ask: { ask_id: olderAskId, reopens: askId } }, "assistant") };
    expect(projectStudioWorkflow([planning, plan, claim, reopen], true))
      .toEqual({ phase: "planning", proposal: olderAskId, pendingBuild: null });
    const different = { studioWorkflow: readStudioWorkflow({ studio_workflow: "proposal", paige_ask: { ask_id: olderAskId, reopens: olderAskId } }, "assistant") };
    expect(projectStudioWorkflow([planning, plan, claim, different], true))
      .toEqual({ phase: "build", proposal: null, pendingBuild: askId });
  });

  it("requires a server proof for the exact proposal, actor, workspace and thread", async () => {
    const scope = { actorId: "owner", tenantId: "workspace", threadId: "studio-thread" };
    const secret = "test-secret";
    const question = "Build a clear workshop landing page";
    const unsigned = { studio_workflow: "proposal", paige_ask: { ask_id: askId, question } };
    const studio_proof = await signStudioWorkflow(secret, scope, "proposal", askId, question);
    const signed = { ...unsigned, studio_proof };

    expect(await verifyStudioWorkflow(secret, scope, signed, "assistant")).toEqual({ kind: "proposal", askId });
    expect(await verifyStudioWorkflow(secret, scope, unsigned, "assistant")).toBeNull();
    expect(await verifyStudioWorkflow(secret, scope, { ...signed, paige_ask: { ask_id: askId, question: "Changed direction" } }, "assistant")).toBeNull();
    for (const key of ["actorId", "tenantId", "threadId"] as const) {
      expect(await verifyStudioWorkflow(secret, { ...scope, [key]: "different" }, signed, "assistant")).toBeNull();
    }
    expect(await verifyStudioWorkflow(secret, scope, { studio_workflow: "settled", studio_plan_ask_id: askId, studio_proof }, "assistant")).toBeNull();
    const reopened = { ...unsigned, paige_ask: { ...unsigned.paige_ask, reopens: olderAskId } };
    expect(await verifyStudioWorkflow(secret, scope, { ...reopened, studio_proof }, "assistant")).toBeNull();
    const reopenedProof = await signStudioWorkflow(secret, scope, "proposal", askId, question, olderAskId);
    expect(await verifyStudioWorkflow(secret, scope, { ...reopened, studio_proof: reopenedProof }, "assistant"))
      .toEqual({ kind: "proposal", askId, reopens: olderAskId });
  });

  it("does not promote an interrupted or superseded plan claim", () => {
    expect(projectStudioWorkflow([planning, plan, {}, claim], false)).toEqual({ phase: "planning", proposal: null, pendingBuild: null });
    const old = { studioWorkflow: readStudioWorkflow({ studio_workflow: "build", paige_resume: { key: `answer:${olderAskId}` } }, "user") };
    expect(projectStudioWorkflow([planning, plan, old], false)).toEqual({ phase: "planning", proposal: null, pendingBuild: null });
    expect(readStudioWorkflow({ studio_workflow: "build" }, "user")).toBeNull();
    expect(readStudioWorkflow({ studio_workflow: "proposal", paige_ask: { ask_id: askId } }, "user")).toBeNull();
  });

  it("retains the original claim past unsigned rows and signed replies that lost adjacency", async () => {
    const scope = { actorId: "owner", tenantId: "workspace", threadId: "studio-thread" };
    const secret = "test-secret";
    const buildRow = async (seq: number, id: string) => ({
      seq, bundle_ref: { studio_workflow: "build", paige_resume: { key: `answer:${id}` },
        studio_proof: await signStudioWorkflow(secret, scope, "build", id) },
    });
    const original = await buildRow(3, olderAskId);
    const superseded = await buildRow(6, askId);
    const unsigned = { seq: 8, bundle_ref: { ...superseded.bundle_ref, studio_proof: undefined } };
    const question = "Build the workshop page";
    const previous = {
      role: "assistant", bundle_ref: { studio_workflow: "proposal", paige_ask: { ask_id: olderAskId, question },
        studio_proof: await signStudioWorkflow(secret, scope, "proposal", olderAskId, question) },
    };
    const readPrevious = async (seq: number) => seq === original.seq ? previous : { role: "user", bundle_ref: null };

    expect(await resolveStudioBuildClaim(secret, scope, [unsigned, superseded, original], readPrevious))
      .toEqual({ seq: original.seq, askId: olderAskId });
    expect(await resolveStudioBuildClaim(secret, scope, [unsigned, superseded], readPrevious)).toBeNull();
  });

  it("plans with questions only and starts a private build without offering publication", () => {
    expect(studioPlanningAllowsTool("ask_choices")).toBe(true);
    for (const tool of ["growth_page_generate", "growth_page_save", "generate_image", "growth_form_publish"]) {
      expect(studioPlanningAllowsTool(tool)).toBe(false);
    }
    expect(studioPlanBuildAllowsTool("growth_page_generate")).toBe(true);
    for (const tool of ["growth_page_publish", "growth_funnel_publish", "growth_form_publish", "social_publish", "crm_create_contact"]) {
      expect(studioPlanBuildAllowsTool(tool)).toBe(false);
    }
  });

  it("keeps an unknown native build result distinct from completed, refused or pending approval", () => {
    expect(studioBuildOutcomeUnconfirmed(JSON.stringify({ success: false, outcome_unknown: true }))).toBe(true);
    expect(studioBuildOutcomeUnconfirmed(JSON.stringify({ outcome: "capability_outcome_unknown" }))).toBe(true);
    expect(studioBuildOutcomeUnconfirmed(JSON.stringify({ success: true, content_id: "original" }))).toBe(false);
    expect(studioBuildOutcomeUnconfirmed(JSON.stringify({ success: false, needs_confirm: true }))).toBe(false);
    expect(studioBuildOutcomeUnconfirmed(JSON.stringify({ success: false, error: "invalid_arguments" }))).toBe(false);
  });
});
