import { N8N_MANAGEMENT_CAPABILITIES } from './domains/n8n_management.ts';
import { BUSINESS_MISSION_CAPABILITIES } from "./domains/business_mission.ts";
import { SPINE_ACTION_CLASSIFICATIONS, type SpineCapability } from "./contracts.ts";
import { PIPELINE_CRM_ACTIONS, PIPELINE_DEAL_STAGE_EVIDENCE } from "./domains/pipeline.ts";
import { BUSINESS_CONTEXT_READINESS } from "./domains/business_context.ts";
import { TEAM_AUTHORITY } from "./domains/team.ts";
import { N8N_CONNECTION_READINESS } from "./domains/n8n.ts";
import { SOCIAL_PRESENCE } from "./domains/social.ts";
import { CAMPAIGN_BRIEF_CAPABILITIES } from "./domains/campaigns.ts";
import { COMMS_MESSAGES_READ } from "./domains/comms.ts";
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
// Still NOT registered, each for a stated reason rather than an oversight: SEND and RESEND execute
// the `agreement-send` EDGE function, which this file's validator rejects, so they are governed by
// _shared/action-risk.ts + the inline confirm gate exactly as calendar_link_send is; DRAFT and VOID
// have clean `public.*` executors but are mutations, held back deliberately so the read half lands
// first. See domains/agreement.ts for the full boundary.
import { AGREEMENT_CAPABILITIES } from "./domains/agreement.ts";
import { LONG_FORM_CAPABILITIES } from "./domains/long_form.ts";

export const PAIGE_SPINE_CAPABILITIES = [PIPELINE_DEAL_STAGE_EVIDENCE, BUSINESS_CONTEXT_READINESS, TEAM_AUTHORITY, SOCIAL_PRESENCE, N8N_CONNECTION_READINESS, ...N8N_MANAGEMENT_CAPABILITIES, ...BUSINESS_MISSION_CAPABILITIES, ...CAMPAIGN_BRIEF_CAPABILITIES, ...CALENDAR_PRESET_CAPABILITIES, ...CALENDAR_LINK_CAPABILITIES, ...AGREEMENT_CAPABILITIES, ...LONG_FORM_CAPABILITIES, COMMS_MESSAGES_READ, INTEGRATIONS_LIST, INTEGRATIONS_HEALTH, CONTACT_EVENT_STATUS, ...PIPELINE_CRM_ACTIONS, ...CONTACT_CRM_ACTIONS] as const;

const KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const SERVER_SYMBOL_PATTERN = /^public\.[a-z][a-z0-9_]*$/;
const CHAT_TOOL_PATTERN = /^[a-z][a-z0-9_]*$/;
const MUTATING = new Set(["mutate", "external_effect"]);

export function validateSpineRegistry(capabilities: readonly SpineCapability[]): string[] {
  const findings: string[] = [];
  const seen = new Set<string>();
  for (const capability of capabilities) {
    if (seen.has(capability.key)) findings.push(`duplicate capability key: ${capability.key}`);
    seen.add(capability.key);
    if (!KEY_PATTERN.test(capability.key)) findings.push(`${capability.key}: capability key must be stable domain.capability snake case`);
    if (capability.key.split(".", 1)[0] !== capability.domain) findings.push(`${capability.key}: capability key namespace must match domain ${capability.domain}`);
    if (!capability.domain || !capability.owner || !capability.humanSurface) findings.push(`${capability.key}: domain, owner, and human surface are required`);
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
      if (!SPINE_ACTION_CLASSIFICATIONS.includes(action.classification)) findings.push(`${capability.key}: unsupported action classification ${action.classification}`);
      if (!SERVER_SYMBOL_PATTERN.test(action.executor) && !(action.executor === "edge.paige-ai-chat" && N8N_MANAGEMENT_CAPABILITIES.some(entry => entry.key === capability.key && entry.action.chatTool === action.chatTool && entry.action.classification === action.classification && entry.action.riskPolicyKey === action.riskPolicyKey && entry.action.approvalAuthority === action.approvalAuthority))) findings.push(`${capability.key}: action executor must be an exact public server symbol`);
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
