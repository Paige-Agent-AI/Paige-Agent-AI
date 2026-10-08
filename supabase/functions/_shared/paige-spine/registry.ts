import { N8N_MANAGEMENT_CAPABILITIES } from './domains/n8n_management.ts';
import { ZAPIER_MANAGEMENT_CAPABILITIES } from './domains/zapier_management.ts';
import { GHL_MANAGEMENT_CAPABILITIES } from './domains/ghl_management.ts';
import { BUSINESS_MISSION_CAPABILITIES } from "./domains/business_mission.ts";
import { SPINE_ACTION_CLASSIFICATIONS, type SpineCapability } from "./contracts.ts";
import { PIPELINE_CRM_ACTIONS, PIPELINE_DEAL_STAGE_EVIDENCE } from "./domains/pipeline.ts";
import { BUSINESS_CONTEXT_READINESS } from "./domains/business_context.ts";
import { TEAM_AUTHORITY } from "./domains/team.ts";
import { N8N_CONNECTION_READINESS } from "./domains/n8n.ts";
import { SOCIAL_PRESENCE } from "./domains/social.ts";
import { CAMPAIGN_BRIEF_CAPABILITIES } from "./domains/campaigns.ts";
import { COMMS_MESSAGES_READ, COMMS_EMAIL_SEND } from "./domains/comms.ts";
import { INTEGRATIONS_LIST, INTEGRATIONS_HEALTH } from "./domains/integrations_surface.ts";
import { CONTACT_CRM_ACTIONS, CONTACT_EVENT_STATUS } from "./domains/contact.ts";
// Booking-preset lifecycle capabilities (create/revise/publish/pause/list + the S1
// duplicate/archive/restore). ADOPTED with the Chat wiring in the same change (E5): the
// handler declares CALENDAR_PRESET_TOOLS through the adapter spread and dispatches them to
// the canonical create/update/publish/pause/duplicate/archive/restore + get_calendar_presets
// RPCs via calendar-preset-tenant-brain.ts, so the LIVE chatBinding the validator requires is
// now true (§10/§13). No second preset model — the UI and Paige drive the same RPCs.
import { CALENDAR_PRESET_CAPABILITIES } from "./domains/calendar_preset.ts";
// E7 — governed calendar-link sharing: the TWO READS (prepare, social_copy) register here
// (clean public.<symbol> executors). The SEND (calendar_link_send) is governed via
// _shared/action-risk.ts + the inline confirm gate, NOT this manifest (see calendar_link.ts).
import { CALENDAR_LINK_CAPABILITIES } from "./domains/calendar_link.ts";
// INT-178 — agreements, the READ half, and a correction to what stood here before (§13).
//
// The previous comment said "DRAFT, VOID and STATUS register here". They did not. INT-163 shipped
// the e-signature engine and this array held ZERO agreement capabilities, so PAIGE could not see an
// agreement at all — a comment describing intent that was never delivered, which reads to the next
// session exactly like a fact. What registers now is the two READS (list, status), both executing
// the clean `public.paige_agreement_overview` seam.
//
// Registered as of the agreements PR: SEND (external_effect on public.issue_agreement_signing_link)
// and DRAFT (on save_paige_agreement). History, for the next reader of this seam: the agreement
// tools were once unregistered because their orchestrator is an edge function this file's validator
// rejects; the send's public executor settled that. add_signer, resend and void remain unshipped and
// so unregistered. See domains/agreement.ts for the full boundary.
import { AGREEMENT_CAPABILITIES } from "./domains/agreement.ts";
import { LONG_FORM_CAPABILITIES } from "./domains/long_form.ts";
// Vibe Studio standalone forms: save a working copy, publish it (migration 20270537000000).
import { GROWTH_FORM_CAPABILITIES } from "./domains/growth_form.ts";
// Vibe Studio pages and funnels, and saving copy to the content library — declared the way forms are,
// over the same RPCs the Studio uses. Declarations only: the tool JSON and dispatch stay in Chat.
import { GROWTH_PAGE_CAPABILITIES } from "./domains/growth_page.ts";
import { GROWTH_FUNNEL_CAPABILITIES } from "./domains/growth_funnel.ts";
import { MARKETING_CONTENT_CAPABILITIES } from "./domains/marketing_content.ts";
import { SALES_INVOICE_CAPABILITIES } from "./domains/sales_invoice.ts";
import { MERCHANT_SPINE_CAPABILITIES } from "../sales-payments/merchant-capability.ts";
import { SALES_COLLECTION_CAPABILITIES } from "./domains/sales_collections.ts";
import { EMAIL_CAMPAIGN_CAPABILITIES } from "./domains/email_campaigns.ts";
import { PLANNING_WRITE_CAPABILITIES } from "./domains/planning_writes.ts";
import { PLANNING_READ_CAPABILITIES } from "./domains/planning.ts";
import { ACTION_BUS_READ_CAPABILITIES } from "./domains/action_bus.ts";
import { AUTOMATION_READ_CAPABILITIES } from "./domains/automations.ts";
import { DOCUMENT_REVIEW_READ_CAPABILITIES } from "./domains/research_knowledge.ts";
import { CRM_CLIENT_READ_CAPABILITIES } from "./domains/crm_clients.ts";
import { PLATFORM_META_READ_CAPABILITIES } from "./domains/platform_meta.ts";
import { TEAM_READ_CAPABILITIES } from "./domains/team_reads.ts";
import { CRM_OPERATOR_READ_CAPABILITIES } from "./domains/crm_operator_reads.ts";
import { PIPELINE_READ_CAPABILITIES } from "./domains/pipeline_reads.ts";
import { C0B_EXISTING_WRITE_CAPABILITIES } from "./domains/c0b_existing_writes.ts";
import { TEAM_INVITATION_CAPABILITIES } from "./domains/team_invitations.ts";
import { C0B_INCUMBENT_ADAPTER_CAPABILITIES } from "./domains/c0b_incumbent_adapters.ts";
import { C0B_CLIENT_WRITE_CAPABILITIES } from "./domains/c0b_client_writes.ts";
import { C0B_RESOURCE_OPERATION_CAPABILITIES } from "./domains/c0b_resource_operations.ts";
import { C0B_FUNDING_STUDIO_CAPABILITIES } from "./domains/c0b_funding_studio_adapters.ts";

import { isReadinessResolverId } from "../paige-capability-status/readiness.ts";

export const PAIGE_SPINE_CAPABILITIES = [PIPELINE_DEAL_STAGE_EVIDENCE, BUSINESS_CONTEXT_READINESS, TEAM_AUTHORITY, SOCIAL_PRESENCE, N8N_CONNECTION_READINESS, ...N8N_MANAGEMENT_CAPABILITIES, ...ZAPIER_MANAGEMENT_CAPABILITIES, ...GHL_MANAGEMENT_CAPABILITIES, ...BUSINESS_MISSION_CAPABILITIES, ...CAMPAIGN_BRIEF_CAPABILITIES, ...CALENDAR_PRESET_CAPABILITIES, ...CALENDAR_LINK_CAPABILITIES, ...AGREEMENT_CAPABILITIES, ...LONG_FORM_CAPABILITIES, ...GROWTH_FORM_CAPABILITIES, ...GROWTH_PAGE_CAPABILITIES, ...GROWTH_FUNNEL_CAPABILITIES, ...MARKETING_CONTENT_CAPABILITIES, ...SALES_INVOICE_CAPABILITIES, ...MERCHANT_SPINE_CAPABILITIES, ...SALES_COLLECTION_CAPABILITIES, ...EMAIL_CAMPAIGN_CAPABILITIES, ...PLANNING_READ_CAPABILITIES, ...PLANNING_WRITE_CAPABILITIES, ...ACTION_BUS_READ_CAPABILITIES, ...AUTOMATION_READ_CAPABILITIES, ...DOCUMENT_REVIEW_READ_CAPABILITIES, ...CRM_CLIENT_READ_CAPABILITIES, ...PLATFORM_META_READ_CAPABILITIES, ...TEAM_READ_CAPABILITIES, ...CRM_OPERATOR_READ_CAPABILITIES, ...PIPELINE_READ_CAPABILITIES, ...C0B_EXISTING_WRITE_CAPABILITIES, ...TEAM_INVITATION_CAPABILITIES, ...C0B_INCUMBENT_ADAPTER_CAPABILITIES, ...C0B_CLIENT_WRITE_CAPABILITIES, ...C0B_RESOURCE_OPERATION_CAPABILITIES, ...C0B_FUNDING_STUDIO_CAPABILITIES, COMMS_MESSAGES_READ, COMMS_EMAIL_SEND, INTEGRATIONS_LIST, INTEGRATIONS_HEALTH, CONTACT_EVENT_STATUS, ...PIPELINE_CRM_ACTIONS, ...CONTACT_CRM_ACTIONS] as const;

const KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const SERVER_SYMBOL_PATTERN = /^public\.[a-z][a-z0-9_]*$/;
const CHAT_TOOL_PATTERN = /^[a-z][a-z0-9_]*$/;
const MUTATING = new Set(["mutate", "external_effect"]);

// The edge chat executor exception: `edge.paige-ai-chat` is not a public server symbol, so a
// capability may claim it ONLY by being a declared entry of one of the edge-executor domains
// (management adapters and verified stored-state reads). The entry's chatTool, classification,
// risk policy, and approval authority must match the declaration; CI also proves the actual binding.
const EDGE_CHAT_EXECUTOR_CAPABILITIES = [...N8N_MANAGEMENT_CAPABILITIES, ...ZAPIER_MANAGEMENT_CAPABILITIES, ...GHL_MANAGEMENT_CAPABILITIES, ...AUTOMATION_READ_CAPABILITIES, ...DOCUMENT_REVIEW_READ_CAPABILITIES, ...CRM_CLIENT_READ_CAPABILITIES.filter(cap => cap.action.executor === "edge.paige-ai-chat"), ...PLATFORM_META_READ_CAPABILITIES, ...CRM_OPERATOR_READ_CAPABILITIES] as const;

export function validateSpineRegistry(capabilities: readonly SpineCapability[]): string[] {
  const findings: string[] = [];
  const seen = new Set<string>();
  for (const capability of capabilities) {
    if (seen.has(capability.key)) findings.push(`duplicate capability key: ${capability.key}`);
    seen.add(capability.key);
    if (!KEY_PATTERN.test(capability.key)) findings.push(`${capability.key}: capability key must be stable domain.capability snake case`);
    if (capability.key.split(".", 1)[0] !== capability.domain) findings.push(`${capability.key}: capability key namespace must match domain ${capability.domain}`);
    if (!capability.domain || !capability.owner || !capability.humanSurface) findings.push(`${capability.key}: domain, owner, and human surface are required`);
    if (capability.readiness !== undefined && !isReadinessResolverId(capability.readiness)) findings.push(`${capability.key}: unknown readiness resolver ${String(capability.readiness)}`);
    if (capability.evidence) {
      const evidence = capability.evidence;
      if (!evidence.signalKinds.length) findings.push(`${capability.key}: evidence requires at least one signal kind`);
      if (!SERVER_SYMBOL_PATTERN.test(evidence.adapter)) findings.push(`${capability.key}: evidence adapter must be an exact public server symbol`);
      if (!evidence.audience || !evidence.freshness) findings.push(`${capability.key}: evidence audience and freshness are required`);
      if (evidence.staleAfterDays <= 0 || evidence.projectionWindowDays < evidence.staleAfterDays) findings.push(`${capability.key}: evidence projection window must cover its stale boundary`);
      if (!evidence.sourceSystem || !evidence.sourceActorTypes.length || !evidence.classification || !evidence.lifecycle || !evidence.safeSummary || !evidence.referencePrefix) findings.push(`${capability.key}: evidence requires exact safe value metadata`);
      const factEntries = Object.entries(evidence.factValues);
      if (!factEntries.length || factEntries.some(([, values]) => !values.length)) findings.push(`${capability.key}: evidence requires allowed values for every fact key`);
    }
    if (capability.action) {
      const action = capability.action;
      if (action.seatAuthority !== undefined && !["member", "workspace-admin", "door-seat"].includes(action.seatAuthority))
        findings.push(`${capability.key}: unsupported seat authority ${String(action.seatAuthority)}`);
      if (!SPINE_ACTION_CLASSIFICATIONS.includes(action.classification)) findings.push(`${capability.key}: unsupported action classification ${action.classification}`);
      const merchantExecutor = action.executor === "edge.tenant-stripe-connect"
        && MERCHANT_SPINE_CAPABILITIES.some(entry => !!entry.action && entry.key === capability.key
          && entry.action.chatTool === action.chatTool && entry.action.classification === action.classification
          && entry.action.riskPolicyKey === action.riskPolicyKey && entry.action.approvalAuthority === action.approvalAuthority);
      const chatExecutor = action.executor === "edge.paige-ai-chat"
        && EDGE_CHAT_EXECUTOR_CAPABILITIES.some(entry => !!entry.action && entry.key === capability.key
          && entry.action.chatTool === action.chatTool && entry.action.classification === action.classification
          && entry.action.riskPolicyKey === action.riskPolicyKey && entry.action.approvalAuthority === action.approvalAuthority);
      const invitationExecutor = action.executor === "edge.solo-team-invitations"
        && TEAM_INVITATION_CAPABILITIES.some(entry => entry.key === capability.key
          && entry.action.chatTool === action.chatTool && entry.action.classification === action.classification
          && entry.action.riskPolicyKey === action.riskPolicyKey && entry.action.approvalAuthority === action.approvalAuthority
          && entry.action.seatAuthority === action.seatAuthority && entry.selfDescribe === capability.selfDescribe
          && entry.readiness === capability.readiness);
      // Admission here is metadata shape only. Registry lint independently pins
      // each exact incumbent dispatch, identity scope and executable dependency.
      const incumbentExecutor = action.executor.startsWith("edge.")
        && [...C0B_INCUMBENT_ADAPTER_CAPABILITIES, ...C0B_CLIENT_WRITE_CAPABILITIES, ...C0B_RESOURCE_OPERATION_CAPABILITIES, ...C0B_FUNDING_STUDIO_CAPABILITIES].some(entry => entry.key === capability.key
          && entry.action.executor === action.executor && entry.action.chatTool === action.chatTool
          && entry.action.classification === action.classification && entry.action.riskPolicyKey === action.riskPolicyKey
          && entry.action.approvalAuthority === action.approvalAuthority && entry.action.seatAuthority === action.seatAuthority
          && entry.selfDescribe === capability.selfDescribe && entry.readiness === capability.readiness
          && entry.chatBinding === capability.chatBinding);
      if (!SERVER_SYMBOL_PATTERN.test(action.executor) && !merchantExecutor && !chatExecutor && !invitationExecutor && !incumbentExecutor)
        findings.push(`${capability.key}: action executor must be an exact public server symbol`);
      if (MUTATING.has(action.classification)) {
        if (action.approvalAuthority !== "chat-canonical") findings.push(`${capability.key}: mutating actions require chat-canonical approval authority`);
        if (capability.chatBinding !== "LIVE") findings.push(`${capability.key}: mutating actions require a LIVE Chat binding`);
        if (!action.chatTool || !CHAT_TOOL_PATTERN.test(action.chatTool)) findings.push(`${capability.key}: mutating actions require an exact Chat tool name`);
        if (!(["ordinary", "high"] as const).includes(action.riskPolicyKey as "ordinary" | "high")) findings.push(`${capability.key}: mutating actions require an ordinary or high canonical risk policy`);
        if (action.classification === "external_effect" && action.riskPolicyKey !== "high") findings.push(`${capability.key}: external effects require high canonical risk`);
        if (!action.idempotency.trim()) findings.push(`${capability.key}: mutating actions require idempotency metadata`);
      } else if (action.classification === "read") {
        if (action.riskPolicyKey !== "read_only") findings.push(`${capability.key}: read actions must use read_only risk policy`);
        if (action.approvalAuthority !== "none") findings.push(`${capability.key}: read actions cannot claim approval authority`);
      }
    }
    if (capability.outcome) {
      if (!capability.outcome.kinds.length || !capability.outcome.projector) findings.push(`${capability.key}: outcomes require kinds and a safe projector`);
      if (!capability.outcome.railVisibility) findings.push(`${capability.key}: outcomes require Rail visibility metadata`);
    }
  }
  return findings;
}

const REGISTRY_FINDINGS = validateSpineRegistry(PAIGE_SPINE_CAPABILITIES);
if (REGISTRY_FINDINGS.length) throw new Error(`Invalid PAIGE Spine registry: ${REGISTRY_FINDINGS.join("; ")}`);

export function getSpineCapability(key: string): SpineCapability | undefined {
  return PAIGE_SPINE_CAPABILITIES.find((capability) => capability.key === key);
}
