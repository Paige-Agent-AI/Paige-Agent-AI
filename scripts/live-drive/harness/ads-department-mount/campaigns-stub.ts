// Replaces only the Campaigns/Sales workspace read for the Ads harness: Marketing's fixture
// (../marketing-mount/stubs.ts) with the fictional business's Sales pipelines, stages and deals laid in,
// and each submission's ad tag (utm_content). Both Ads (scope "pipeline") and Marketing read this.
import { useSoloCampaigns as marketingCampaigns } from "../marketing-mount/stubs";
import { deals, pipelines, stages, submissions } from "./ads-fixtures";
import { mode } from "../marketing-mount/mode";

const workspace = { pipelines, stages, deals };
export function useSoloCampaigns() {
  const state = marketingCampaigns();
  if (mode === "first") return { ...state, pipelineWorkspace: { ...state.pipelineWorkspace, pipelines: [], stages: [], deals: [] } };
  return { ...state, submissions: state.submissions.length ? submissions : state.submissions, pipelineWorkspace: { ...state.pipelineWorkspace, ...workspace } };
}
