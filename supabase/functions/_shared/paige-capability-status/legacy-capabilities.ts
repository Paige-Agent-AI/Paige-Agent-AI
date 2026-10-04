// Legacy capability classification — the C0b worklist (docs/delivery/paige-conversational-loop-r0.md §24).
//
// Every chat tool that is on PAIGE's model surface but NOT yet registered in the Spine registry, one row
// each, classified by the C0a crew on main 0065fa74 (owner rulings 2026-10-04 §9: classify first, then
// migrate by bounded domain, and delete dead debt instead of formalising it). The projection reads a row
// ONLY while its tool is unregistered; registering a tool in the Spine makes the row unreachable and
// capability-discovery-lint requires it to be deleted in the same change.
//
// This file and scripts/ci/capability-declaration-baseline.json must name exactly the same tools —
// both may only shrink. A NEW tool can therefore never land here: it must be Spine-registered, which is
// what makes it discoverable with no conversation-layer change.
//
// gapClass (owner's six): missing_spine_registration · missing_kit_metadata · registered_missing_readiness
//   · obsolete_dead_path (delete) · duplicate_superseded (delete) · internal_only_not_self_described
// readiness: only resolvers that exist in C0a are named; every other dependency is "none" here and is
//   modelled when its domain batch registers the tool (C0b) — "none" never claims setup either way.

import type { LegacyDeclarationLike } from "./projection.ts";

export type LegacyGapClass =
  | "missing_spine_registration"
  | "missing_kit_metadata"
  | "registered_missing_readiness"
  | "obsolete_dead_path"
  | "duplicate_superseded"
  | "internal_only_not_self_described";

export interface LegacyCapabilityRow extends LegacyDeclarationLike {
  gapClass: LegacyGapClass;
  /** Does the CHAT gate require this workspace's owner or an admin? (the C0b batch needs it) */
  workspaceAdmin: boolean;
}

export const LEGACY_CAPABILITIES: Readonly<Record<string, LegacyCapabilityRow>> = Object.freeze({
  action_advance: { domain: "action_bus", effect: "mutate", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  action_file: { domain: "action_bus", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  action_get: { domain: "action_bus", effect: "read", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  action_list: { domain: "action_bus", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  propose_action: { domain: "action_bus", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  delegate_to_subagent: { domain: "agents", effect: "external_effect", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  forge_subagent: { domain: "agents", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  list_subagents: { domain: "agents", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  automation_draft: { domain: "automations", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  automation_list: { domain: "automations", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  automation_set_grant: { domain: "automations", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  automation_set_state: { domain: "automations", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  automation_triggers_list: { domain: "automations", effect: "read", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  propose_business_brief_update: { domain: "business_profile", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  update_business_profile: { domain: "business_profile", effect: "mutate", selfDescribe: false, readiness: "none", gapClass: "duplicate_superseded", workspaceAdmin: true },
  calendar_book_meeting: { domain: "calendar", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  calendar_link_send: { domain: "calendar", effect: "external_effect", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  comms_buy_number: { domain: "communications", effect: "external_effect", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  comms_connection_summary: { domain: "communications", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  comms_draft_registration: { domain: "communications", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  comms_list_numbers: { domain: "communications", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  comms_name_number: { domain: "communications", effect: "mutate", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  comms_registration_status: { domain: "communications", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  comms_search_numbers: { domain: "communications", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  comms_set_primary_number: { domain: "communications", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  author_event_kind: { domain: "crm_clients", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  crm_add_note: { domain: "crm_clients", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  crm_file_document: { domain: "crm_clients", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  crm_get_contact_summary: { domain: "crm_clients", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  crm_list_documents: { domain: "crm_clients", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  crm_list_tasks: { domain: "crm_clients", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  crm_search_contacts: { domain: "crm_clients", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  get_client_rail: { domain: "crm_clients", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  list_event_kinds: { domain: "crm_clients", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  update_client_data: { domain: "crm_clients", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  get_current_rates: { domain: "funding_optin", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  search_funding_marketplace: { domain: "funding_optin", effect: "read", selfDescribe: false, readiness: "none", gapClass: "obsolete_dead_path", workspaceAdmin: false },
  search_regional_lenders: { domain: "funding_optin", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  search_sba_lenders: { domain: "funding_optin", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  marketplace_browse: { domain: "integrations_mcp", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  draft_marketing_content: { domain: "marketing", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  plan_add_milestone: { domain: "planning", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  plan_assign_task: { domain: "planning", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  plan_create: { domain: "planning", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  plan_list: { domain: "planning", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  plan_remove_item: { domain: "planning", effect: "mutate", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  plan_set_reminder: { domain: "planning", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  plan_update_item: { domain: "planning", effect: "mutate", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  capability_status: { domain: "platform_meta", effect: "read", selfDescribe: false, readiness: "none", gapClass: "internal_only_not_self_described", workspaceAdmin: true },
  improvement_decide: { domain: "platform_meta", effect: "mutate", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  improvement_list: { domain: "platform_meta", effect: "read", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  improvement_propose: { domain: "platform_meta", effect: "mutate", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  deep_research: { domain: "research_knowledge", effect: "read", selfDescribe: true, readiness: "research_provider", gapClass: "missing_spine_registration", workspaceAdmin: false },
  document_generate: { domain: "research_knowledge", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  document_pending_reviews: { domain: "research_knowledge", effect: "read", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  document_resume_review: { domain: "research_knowledge", effect: "read", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  save_to_knowledge_base: { domain: "research_knowledge", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  web_fetch: { domain: "research_knowledge", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: false },
  web_search: { domain: "research_knowledge", effect: "read", selfDescribe: true, readiness: "research_provider", gapClass: "missing_spine_registration", workspaceAdmin: false },
  crm_list_deals: { domain: "sales", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  crm_pipeline_summary: { domain: "sales", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  pipeline_archive_preview: { domain: "sales", effect: "read", selfDescribe: false, readiness: "none", gapClass: "internal_only_not_self_described", workspaceAdmin: true },
  pipeline_catalogue: { domain: "sales", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  pipeline_configure: { domain: "sales", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  pipeline_folder_archive_preview: { domain: "sales", effect: "read", selfDescribe: false, readiness: "none", gapClass: "internal_only_not_self_described", workspaceAdmin: true },
  crm_list_team: { domain: "team", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  member_grant_role: { domain: "team", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  member_revoke_role: { domain: "team", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  presence_is_online: { domain: "team", effect: "read", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  presence_who_online: { domain: "team", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  team_invite_member: { domain: "team", effect: "external_effect", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  team_invite_resend: { domain: "team", effect: "external_effect", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  team_invite_revoke: { domain: "team", effect: "mutate", selfDescribe: false, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  team_set_permission: { domain: "team", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  team_set_work_profile: { domain: "team", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  ask_choices: { domain: "vibe_studio", effect: "read", selfDescribe: false, readiness: "none", gapClass: "internal_only_not_self_described", workspaceAdmin: false },
  generate_image: { domain: "vibe_studio", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  growth_funnel_generate: { domain: "vibe_studio", effect: "read", selfDescribe: false, readiness: "none", gapClass: "internal_only_not_self_described", workspaceAdmin: true },
  growth_list: { domain: "vibe_studio", effect: "read", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  growth_page_generate: { domain: "vibe_studio", effect: "read", selfDescribe: false, readiness: "none", gapClass: "internal_only_not_self_described", workspaceAdmin: true },
});
