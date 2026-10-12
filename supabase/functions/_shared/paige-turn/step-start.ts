// THE START OF A TOOL STEP (C2b, docs/delivery/paige-conversational-loop-c2.md).
//
// A tool that has passed every policy gate is announced on the step trace as `running` the moment it
// reaches its handler, and closed by `describeStep` (paige-ai-chat) when it returns. This file owns only the
// START wording, because the FINISH wording cannot be reused for it: `describeStep` is written for a
// tool that has RETURNED, and asked about one that has not it says "Bought a number", "Sent the
// agreement to 0 signers", "Created the proposed Mission" — claims about work that has not happened.
//
// THE RULES THIS FILE KEEPS:
//   - every START label is present tense ("Buying that number") and from a fixed vocabulary;
//   - a START never carries `detail`. A detail describes a finished step — mostly a count or a fixed
//     phrase, and for a few tools text the model or the workspace wrote (web_search / deep_research:
//     the model's query; comms_buy_number: the number; agreement_draft: the title). Those FINISH
//     details already reach the wire before a protected turn's final check, as they did before C2b
//     (emitStep is never held); C2b does not widen that. Keeping a START detail-free means nothing
//     new rides a START, and since the client merges a row's frames, a START's detail would survive
//     into a FINISH that had none;
//   - a tool with no START label is never announced. It still gets its FINISH, exactly as before.
//
// Every tool `describeStep` names is in exactly one of the two lists below, and a unit test reads
// `describeStep`'s cases from the edge function and holds that parity, so a new case cannot ship
// without a decision about its start (src/__tests__/paige-step-start.test.ts).
//
// Pure: no imports, no I/O.

/** Present-tense START labels, by tool name. Each is the label a person reads while the tool runs. */
export const STEP_START_LABELS: Readonly<Record<string, string>> = Object.freeze({
  // Business phone line
  comms_connection_summary: "Checking how your business is connected",
  comms_list_numbers: "Checking your business numbers",
  comms_search_numbers: "Searching available numbers",
  comms_buy_number: "Buying that number",
  comms_setup_calling: "Connecting this workspace's calling account",
  comms_name_number: "Renaming a number",
  comms_set_primary_number: "Changing which number you send from",
  comms_registration_status: "Checking your carrier registration",
  comms_draft_registration: "Drafting your carrier registration",
  // Action bus
  action_advance: "Moving that action forward",
  action_list: "Checking the team's queue",
  action_get: "Pulling up that action",
  inbox_list: "Checking the inbox",
  integrations_list: "Checking your connections",
  capability_status: "Checking what I can do here",
  contact_event_status: "Checking whether your new-contact alerts fired",
  improvement_propose: "Filing an improvement proposal",
  improvement_list: "Reviewing improvement proposals",
  improvement_decide: "Recording the improvement decision",
  propose_action: "Lining up something for your approval",
  // Missions and campaign briefs — planning records
  mission_create: "Saving the proposed Mission",
  mission_revise: "Saving a new Mission brief version",
  mission_transition: "Changing the Mission state",
  campaign_brief_create: "Creating a Campaign Brief",
  campaign_brief_revise: "Revising a Campaign Brief",
  campaign_brief_list: "Checking your campaign briefs",
  // Booking calendars
  booking_preset_create: "Creating a booking calendar",
  booking_preset_duplicate: "Duplicating a booking calendar",
  booking_preset_revise: "Revising a booking calendar",
  booking_preset_publish: "Publishing a booking calendar",
  booking_preset_pause: "Pausing a booking calendar",
  booking_preset_archive: "Archiving a booking calendar",
  booking_preset_restore: "Restoring a booking calendar",
  booking_preset_list: "Checking your booking calendars",
  calendar_link_prepare: "Preparing a booking link to share",
  calendar_link_social_copy: "Preparing social post copy",
  calendar_link_send: "Sending your booking link",
  // Marketing email (E2b) — PAIGE drafts and files for approval; she never approves or sends
  read_email_campaigns: "Checking your email campaigns",
  read_email_campaign_audience: "Counting who that campaign would reach",
  email_campaign_draft: "Saving an email draft",
  email_campaign_request_approval: "Filing an email campaign for approval",
  read_email_series: "Checking your email series",
  email_series_draft: "Writing an email series",
  email_series_request_approval: "Filing an email series for approval",
  // Agreements
  agreement_send: "Sending the agreement for signature",
  agreement_draft: "Drafting the agreement",
  agreement_list: "Checking where your agreements stand",
  agreement_status: "Checking a client's agreement",
  // CRM reads and the writes that stay in Chat's own dispatch
  crm_search_contacts: "Looking through your contacts",
  crm_get_contact_summary: "Pulling up the contact",
  crm_list_team: "Checking your team",
  presence_who_online: "Checking who's online",
  presence_is_online: "Checking if someone's online",
  crm_assign_contact: "Assigning the contact",
  pipeline_configure: "Configuring your pipeline",
  crm_pipeline_summary: "Reviewing your pipeline",
  crm_list_deals: "Reviewing your pipeline",
  crm_list_tasks: "Checking your tasks",
  member_grant_role: "Updating team access",
  member_revoke_role: "Updating team access",
  // Content, pages and images
  draft_marketing_content: "Drafting your content",
  content_save: "Saving that to your library",
  generate_image: "Creating the image",
  growth_list: "Checking your pages",
  growth_page_generate: "Designing your landing page",
  growth_page_save: "Saving your page draft",
  growth_form_save: "Saving your form draft",
  // Scheduling
  calendar_book_meeting: "Booking the meeting",
  // Research and the specialist team
  web_search: "Searching the web",
  deep_research: "Researching the live web",
  list_subagents: "Finding the right specialist",
});

/**
 * Tools whose START label is `describeStep`'s own: it is already present tense and built from a fixed
 * vocabulary (a validated department name; a fixed specialist name), and it does not depend on the
 * result. Their group comes from the same call.
 */
export const STEP_START_SAME_LABEL: ReadonlySet<string> = new Set(["action_file", "delegate_to_subagent"]);

/**
 * Tools `describeStep` names that are NEVER announced, and why. Each still gets its FINISH (or none),
 * exactly as before C2b.
 */
export const STEP_NO_START: Readonly<Record<string, string>> = Object.freeze({
  // describeStep never renders it: a silent retrieval, not a work chip.
  web_fetch: "never rendered",
  // Fail closed at dispatch, every time: the provider is not available for any workspace.
  social_post: "always refused at dispatch",
  social_analytics: "always refused at dispatch",
  social_accounts: "always refused at dispatch",
  // Labelled, but no dispatch branch handles it: it would answer "Unknown tool".
  get_business_snapshot: "no dispatch",
  // THE DOORS decide remotely — authority, approval and execution in one call — so nothing can be
  // announced before their answer. They never reach the START point anyway (each `continue`s ahead
  // of dispatch); they are listed so the parity is explicit.
  growth_page_publish: "publish door",
  growth_form_publish: "publish door",
  crm_create_contact: "CRM door",
  crm_update_contact: "CRM door",
  crm_log_activity: "CRM door",
  deal_create: "CRM door",
  deal_move_stage: "CRM door",
});

type StepGroup = "owner" | "client" | "shared";
type DescribeFinished = (tc: unknown, res: unknown) => { label: string; group: StepGroup; detail?: string } | null;

/**
 * The START of one tool call: a present-tense label and the group its FINISH will carry, or null when
 * this tool is never announced. Never carries `detail`.
 */
export function describeStepStart(
  tc: { function?: { name?: unknown } } | null | undefined,
  describeFinished: DescribeFinished,
): { label: string; group: StepGroup } | null {
  const name = typeof tc?.function?.name === "string" ? tc.function.name : "";
  if (!name || Object.prototype.hasOwnProperty.call(STEP_NO_START, name)) return null;
  const fixed = Object.prototype.hasOwnProperty.call(STEP_START_LABELS, name) ? STEP_START_LABELS[name] : null;
  if (fixed === null && !STEP_START_SAME_LABEL.has(name)) return null;
  // The group (and, for the two above, the label) from the finished wording, asked with no result:
  // neither depends on one.
  const finished = describeFinished(tc, null);
  if (!finished) return null;
  return { label: fixed ?? finished.label, group: finished.group };
}
