import { describe, expect, it } from "vitest";
import { projectStudioWorkflow, readStudioWorkflow, startsStudioPlanning, STUDIO_PLANNING_START, studioPlanBuildAllowsTool, studioPlanningAllowsTool } from "../../../supabase/functions/_shared/growth/studio-planning";

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
    expect(projectStudioWorkflow([planning, plan, claim, {}], false)).toEqual({ phase: "build", proposal: null, pendingBuild: null });
    expect(projectStudioWorkflow([planning, plan, claim, planning, plan], false)).toEqual({ phase: "build", proposal: null, pendingBuild: null });
  });

  it("does not promote an interrupted or superseded plan claim", () => {
    expect(projectStudioWorkflow([planning, plan, {}, claim], false)).toEqual({ phase: "planning", proposal: null, pendingBuild: null });
    const old = { studioWorkflow: readStudioWorkflow({ studio_workflow: "build", paige_resume: { key: `answer:${olderAskId}` } }, "user") };
    expect(projectStudioWorkflow([planning, plan, old], false)).toEqual({ phase: "planning", proposal: null, pendingBuild: null });
    expect(readStudioWorkflow({ studio_workflow: "build" }, "user")).toBeNull();
    expect(readStudioWorkflow({ studio_workflow: "proposal", paige_ask: { ask_id: askId } }, "user")).toBeNull();
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
});
