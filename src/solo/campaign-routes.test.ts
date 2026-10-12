import { describe, expect, it } from "vitest";
import { readCampaignRoutes } from "./useSoloCampaigns";

// get_form_campaign_routes (20271026100000): one row per form that has a campaign route.
describe("readCampaignRoutes", () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    form_id: "f1", brief_id: "b1", brief_name: "Spring consults", pipeline_id: "p1", pipeline_name: "Consults", stage_id: "s1", stage_label: "Discovery", ...extra,
  });

  it("keys each route by its form", () => {
    expect(readCampaignRoutes({ routes: [row()] }).get("f1")).toEqual({
      briefId: "b1", briefName: "Spring consults", pipelineId: "p1", pipelineName: "Consults", stageId: "s1", stageLabel: "Discovery",
    });
  });

  it("drops a row it cannot place rather than inventing a destination", () => {
    const routes = readCampaignRoutes({ routes: [row({ form_id: null }), row({ form_id: "f2", stage_id: "" }), row({ form_id: "f3", pipeline_id: 7 }), "nope"] });
    expect(routes.size).toBe(0);
  });

  it("names what the server left blank, and reads a missing or malformed answer as no routes", () => {
    expect(readCampaignRoutes({ routes: [row({ brief_name: null, pipeline_name: " ", stage_label: undefined })] }).get("f1")).toMatchObject({
      briefName: "Untitled campaign", pipelineName: "Untitled pipeline", stageLabel: "its first open stage",
    });
    expect(readCampaignRoutes(null).size).toBe(0);
    expect(readCampaignRoutes({ routes: "x" }).size).toBe(0);
  });
});
