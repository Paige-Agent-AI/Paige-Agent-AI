import { markupToHtml, sourceOf } from './email-markup.ts';
import {
  EMAIL_CAMPAIGNS_READ_CAPABILITY, EMAIL_CAMPAIGN_AUDIENCE_READ_CAPABILITY,
  EMAIL_CAMPAIGN_DRAFT_CAPABILITY, EMAIL_CAMPAIGN_REQUEST_APPROVAL_CAPABILITY,
} from './paige-spine/domains/email_campaigns.ts';

// Marketing email from chat (E2b). PAIGE reads campaigns, sees who one would reach, writes or changes a draft,
// and files a draft for the owner's approval. Every call runs on the signed-in person's own session (the
// caller client, never the service role) and names the business the chat is in, so the database decides
// scope. PAIGE never approves and never sends; the tool descriptions say so, and so does every result.
//
// A write tool's parameters are a fresh copy: the chat adds its `confirm` property to every gated tool,
// and a declaration's own input is frozen.
const writable = (schema: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(schema));
export const EMAIL_CAMPAIGN_TOOLS = [
  {type:'function',function:{name:'read_email_campaigns',description:'Read this business\'s email campaigns (newest first), or pass campaign_id for one campaign\'s current version: its words, audience, schedule, goal, sender, approval state, and the audience choices (stages, sources, tags) its contacts carry. Read before changing a campaign. Shows no recipient names or addresses.',parameters:EMAIL_CAMPAIGNS_READ_CAPABILITY.input}},
  {type:'function',function:{name:'read_email_campaign_audience',description:'Count who one email campaign would reach today, and how many are left out because they have no address, opted out, are suppressed, or (for a newsletter) never subscribed. Counts only. Also reports today\'s sending limit and whether the business postal address is set.',parameters:EMAIL_CAMPAIGN_AUDIENCE_READ_CAPABILITY.input}},
  {type:'function',function:{name:'email_campaign_draft',description:'Write a new email campaign draft (omit campaign_id) or change the current draft of one (pass campaign_id from read_email_campaigns). Only include fields you are setting. Write the body in plain marks, one per line: "# Heading", "- item", "[link text](https://...)", "[[Button text|https://...]]", blank line between paragraphs. Do not invent links, offers, dates or names; ask for any you need. The audience is a rule over the stages, sources and tags read_email_campaigns lists (empty means everyone who can be emailed), plus inactive_days for contacts not emailed in that many days, or a saved segment_id. Setting audience replaces the whole rule and any saved segment, so read the campaign first and include what should stay. Give send_at with the owner\'s UTC offset (ask their time zone if unknown), or leave it out. The sender is the business\'s connected email first; the owner changes it in the editor. A draft sends nothing. This saves the email into Marketing > Email; draft_marketing_content is only for words to paste somewhere else. A campaign awaiting approval, approved or sent cannot be changed here; the owner uses Make changes or Edit and send again in Marketing > Email.',parameters:writable(EMAIL_CAMPAIGN_DRAFT_CAPABILITY.input)}},
  {type:'function',function:{name:'email_campaign_request_approval',description:'File one campaign\'s current draft for the owner\'s approval. This freezes that version and counts its recipients; it does NOT approve or send. Only the owner or an admin approves and sends, in Marketing > Email or Approvals. Needs a subject, a body, the business postal address, a working sender and at least one person who can receive it.',parameters:writable(EMAIL_CAMPAIGN_REQUEST_APPROVAL_CAPABILITY.input)}},
] as const;
export const EMAIL_CAMPAIGN_TOOL_NAMES = new Set<string>(EMAIL_CAMPAIGN_TOOLS.map((t) => t.function.name));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Reply = { data: unknown; error: unknown };
export type EmailCampaignChatDeps = { caller: { rpc(name: string, args: Record<string, unknown>): PromiseLike<Reply> } };
type Turn = { thread_id: string | null; user_turn_ordinal: number; user_turn: unknown };
export type EmailCampaignChatContext = { tenantId: string | null; userId: string; toolName: string; args: Record<string, unknown>; turn: Turn };
// `invalid` is a request this adapter would not send (malformed arguments): nothing reached the business,
// so it is not recorded as the business's activity.
export type EmailCampaignOutcome = 'succeeded' | 'refused' | 'invalid' | 'failed' | 'outcome_unknown';
export type EmailCampaignChatResult = { outcome: EmailCampaignOutcome; content: Record<string, unknown>; runId?: string };

const object = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown, max: number): string | null => typeof v === 'string' ? v.slice(0, max) : null;
const count = (v: unknown): number | null => Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : null;

// The words a refusal carries, for the person reading the chat. Codes come from the RPCs' RAISE text.
const REFUSALS: Record<string, string> = {
  not_signed_in: 'You need to be signed in to work on email campaigns.',
  not_permitted: 'Only the owner or an admin of this business can work on email campaigns.',
  active_account_changed: 'The active business changed. Reopen Marketing › Email in the business you mean, then ask again.',
  not_for_this_account: 'Email campaigns run inside each business, not the agency account. Switch to the business you mean and ask again.',
  campaign_not_found: 'That campaign is not in this business. Read the campaigns again and use one of them.',
  campaign_awaiting_approval: 'That campaign is waiting for approval, so it cannot be changed here. The owner can use Make changes in Marketing › Email, which withdraws the waiting approval.',
  campaign_approved: 'That campaign is already approved. Stop it in Marketing › Email before changing it.',
  campaign_stopped: 'That campaign was stopped or paused, so it can\'t be changed here. The owner can start a new version of it in Marketing › Email.',
  too_long: 'That is more than an email campaign can hold. Shorten the message or narrow the audience, then try again.',
  campaign_already_sent: 'That campaign has been sent. Use Edit and send again in Marketing › Email to start a new version; it never reaches anyone this campaign already reached.',
  not_an_editable_draft: 'That version is no longer a draft. Read the campaign again.',
  not_the_current_version: 'A newer draft of that campaign exists. Read the campaign again.',
  schedule_in_past: 'That send time is in the past. Pick a time ahead, or leave it unscheduled.',
  audience_invalid: 'I couldn\'t read that audience. Choose by stage, source, tag, or how long since someone was last emailed.',
  segment_not_found: 'That saved segment is not in this business. Read the campaign again to see the saved segments.',
  subject_required: 'The campaign needs a subject before it can be filed for approval.',
  body_required: 'The campaign needs a message before it can be filed for approval.',
  postal_address_missing: 'The business postal address is not set, and every marketing email must carry it. Add it in Settings › Connections › Registration, then file again.',
  no_eligible_recipients: 'Nobody in this audience can receive email today. I can count who is left out and why.',
  over_daily_cap: 'This audience is larger than today\'s sending limit. Narrow the audience or split it into two campaigns.',
  sender_not_found: 'The chosen sender is no longer connected. The owner can pick another in the editor\'s From.',
  sender_needs_attention: 'The sender needs attention before it can send. The owner can reconnect it or pick another in the editor\'s From.',
};
function refusalCode(error: unknown): string | null {
  // A CHECK the database enforces (a body or an audience over its size limit) refused the write whole.
  if ((object(error)?.code as string | undefined) === '23514') return 'too_long';
  const message = String((object(error)?.message as string | undefined) ?? '');
  const match = /^([a-z_]{3,40})$/.exec(message.trim());
  return match && REFUSALS[match[1]] ? match[1] : match ? match[1] : null;
}
function refused(code: string): EmailCampaignChatResult {
  return { outcome: 'refused', content: { success: false, code, error: REFUSALS[code] ?? 'That was refused. Read the campaign again before trying anything else.', note: 'Nothing was changed by this call.' } };
}

/** Key order normalised, so two equal objects compare equal however they were built or stored. */
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;

/** The key that makes one chat request create at most one campaign, however often it is retried. The chat
 *  settles it into the arguments before the approval fingerprint, so the approved call redeems the same key. */
export async function emailCampaignRequestKey(tenant: string, actor: string, args: Record<string, unknown>, turn: Turn): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical({ namespace: 'email_campaign_draft_v1', tenant, actor, args, turn }))));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ALLOWED: Record<string, readonly string[]> = {
  read_email_campaigns: ['campaign_id', 'limit'],
  read_email_campaign_audience: ['campaign_id'],
  email_campaign_draft: ['request_key', 'campaign_id', 'name', 'kind', 'subject', 'preview_text', 'body', 'audience', 'segment_id', 'send_at', 'goal'],
  email_campaign_request_approval: ['campaign_id'],
};
const KINDS = new Set(['standard', 'newsletter', 'announcement', 'promotion', 'reengagement', 'event', 'welcome', 'custom']);
const GOALS = new Set(['none', 'form_submission', 'booking', 'deal_created', 'invoice_paid']);
// The owner reads `error`; `fix` is for PAIGE, and names the fields she has to correct. Neither changed anything.
const invalid = (fix: string): EmailCampaignChatResult => ({ outcome: 'invalid', content: { success: false, error: 'That request could not be used.', fix, note: 'Nothing was changed by this call. Do not mention internal field or tool names to the owner.' } });

/** The audience rule PAIGE may set: the editor's own shape, nothing else. */
function audienceRule(value: unknown): Record<string, unknown> | null | 'invalid' {
  if (value === undefined) return null;
  const a = object(value);
  if (!a || Object.keys(a).some((k) => !['stages', 'sources', 'tags', 'inactive_days'].includes(k))) return 'invalid';
  const rule: Record<string, unknown> = {};
  for (const key of ['stages', 'sources', 'tags'] as const) {
    if (a[key] === undefined) continue;
    const items = a[key];
    if (!Array.isArray(items) || items.length > 40 || items.some((i) => typeof i !== 'string' || !i.trim() || i.length > 120)) return 'invalid';
    if (items.length) rule[key] = [...new Set(items.map((i) => (i as string).trim()))];
  }
  if (a.inactive_days !== undefined && a.inactive_days !== null) {
    if (!Number.isInteger(a.inactive_days) || Number(a.inactive_days) < 1 || Number(a.inactive_days) > 3650) return 'invalid';
    rule.inactive_days = a.inactive_days;
  }
  return rule;
}

function campaignView(data: Record<string, unknown>): Record<string, unknown> {
  const campaign = object(data.campaign) ?? {};
  const version = object(data.version) ?? {};
  const bodyHtml = typeof version.body_html === 'string' ? version.body_html : '';
  const source = sourceOf(bodyHtml);
  const choices = object(data.choices) ?? {};
  const keys = (v: unknown) => Array.isArray(v) ? v.map((x) => object(x)).filter(Boolean).map((x) => ({ key: text(x!.key, 120), contacts: count(x!.count) })) : [];
  return {
    campaign: { id: campaign.id, name: text(campaign.name, 200), kind: campaign.kind, status: campaign.status, paused_because: text(campaign.blocked_reason, 300) },
    version: {
      version_no: count(version.version_no), state: version.state, subject: text(version.subject, 300), preview_text: text(version.preheader, 300),
      // The marks the email was written in, so PAIGE can change it and the owner can keep editing it.
      body: source ?? null, body_written_as_html: source === null ? bodyHtml.slice(0, 6000) : undefined,
      body_note: source === null && bodyHtml ? 'This email was written as HTML. Replacing its body rewrites it in plain marks and drops its formatting, so ask the owner first.' : undefined,
      audience: object(version.audience) ?? {}, segment_id: version.segment_id ?? null, segment_name: text(version.segment_name, 200),
      send_at: version.scheduled_for ?? null, goal: version.conversion_goal, recipients_when_filed: count(version.expected_recipients),
    },
    from: text(data.from, 320), approval: data.approval_status ?? null, last_declined_reason: text(data.last_declined_reason, 500),
    saved_segments: Array.isArray(data.segments) ? data.segments.map((s) => object(s)).filter(Boolean).map((s) => ({ id: s!.id, name: text(s!.name, 200) })) : [],
    audience_choices: { stages: keys(choices.stages), sources: keys(choices.sources), tags: keys(choices.tags) },
  };
}

async function readCampaign(deps: EmailCampaignChatDeps, tenantId: string, campaignId: string): Promise<Record<string, unknown> | null> {
  const reply = await deps.caller.rpc('read_email_campaigns', { p_expected_tenant_id: tenantId, p_campaign_id: campaignId });
  return reply.error ? null : object(reply.data);
}

export async function dispatchEmailCampaignChat(ctx: EmailCampaignChatContext, deps: EmailCampaignChatDeps): Promise<EmailCampaignChatResult> {
  if (!ctx.tenantId || !UUID.test(ctx.tenantId)) return invalid('Email campaigns are not available without an active business.');
  const allowed = ALLOWED[ctx.toolName];
  if (!allowed) return invalid('That email action is not available.');
  const given = object(ctx.args);
  if (!given) return invalid('That request was not readable.');
  // `confirm` is the chat's own compatibility field on every gated tool; approval never travels in it.
  const { confirm: _compat, ...args } = given;
  if (Object.keys(args).some((k) => !allowed.includes(k))) return invalid('That request had fields this action does not take.');
  const givenId = args.campaign_id ?? null;
  if (givenId !== null && (typeof givenId !== 'string' || !UUID.test(givenId))) return invalid('campaign_id must be an id from read_email_campaigns.');
  const campaignId = givenId as string | null;

  if (ctx.toolName === 'read_email_campaigns') {
    const limit = args.limit ?? 20;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) return invalid('limit must be between 1 and 50.');
    try {
      const reply = await deps.caller.rpc('read_email_campaigns', { p_expected_tenant_id: ctx.tenantId, p_campaign_id: campaignId, p_limit: limit });
      if (reply.error) { const code = refusalCode(reply.error); return code ? refused(code) : { outcome: 'failed', content: { success: false, error: 'The campaigns could not be read right now.' } }; }
      const data = object(reply.data);
      if (!data) throw new Error('unreadable');
      if (campaignId) return { outcome: 'succeeded', content: { success: true, ...campaignView(data) } };
      const rows = Array.isArray(data.campaigns) ? data.campaigns.map((r) => object(r)).filter(Boolean).map((r) => ({
        id: r!.id, name: text(r!.name, 200), kind: r!.kind, status: r!.status, version_no: count(r!.version_no),
        version_state: r!.version_state, subject: text(r!.subject, 300), send_at: r!.scheduled_for ?? null, updated_at: r!.updated_at,
      })) : [];
      return { outcome: 'succeeded', content: { success: true, campaigns: rows, note: rows.length ? 'Pass a campaign id to read one in full.' : 'This business has no email campaigns yet.' } };
    } catch { return { outcome: 'failed', content: { success: false, error: 'The campaigns could not be read right now.' } }; }
  }

  if (ctx.toolName === 'read_email_campaign_audience') {
    if (!campaignId) return invalid('campaign_id is required.');
    try {
      const reply = await deps.caller.rpc('read_email_campaign_audience', { p_expected_tenant_id: ctx.tenantId, p_campaign_id: campaignId });
      if (reply.error) { const code = refusalCode(reply.error); return code ? refused(code) : { outcome: 'failed', content: { success: false, error: 'The audience could not be counted right now.' } }; }
      const d = object(reply.data);
      if (!d || count(d.eligible) === null) throw new Error('unreadable');
      return { outcome: 'succeeded', content: {
        success: true, campaign_id: d.campaign_id, version_no: count(d.version_no), state: d.state,
        can_receive_today: count(d.eligible), matched: count(d.matched),
        left_out: { no_address: count(d.no_address), opted_out: count(d.opted_out), suppressed: count(d.suppressed), not_subscribed_to_newsletter: count(d.no_consent) },
        newsletter_subscribers_only: d.newsletter_subscribers_only === true, segment_name: text(d.segment_name, 200),
        recipients_when_filed: count(d.frozen_recipients),
        daily_limit: count(d.daily_cap), sent_last_24h: count(d.used_last_24h), remaining_today: count(d.remaining_today),
        postal_address_set: d.postal_address_set === true,
        note: 'These are counts for today. The exact list is frozen when the draft is filed for approval.',
      } };
    } catch { return { outcome: 'failed', content: { success: false, error: 'The audience could not be counted right now.' } }; }
  }

  if (ctx.toolName === 'email_campaign_draft') {
    if (args.kind !== undefined && !KINDS.has(String(args.kind))) return invalid('kind is not one of the campaign kinds.');
    if (args.goal !== undefined && !GOALS.has(String(args.goal))) return invalid('goal is not one of the conversion goals.');
    for (const [key, max] of [['name', 200], ['subject', 300], ['preview_text', 300], ['body', 20000]] as const) {
      if (args[key] !== undefined && (typeof args[key] !== 'string' || (args[key] as string).length > max)) return invalid(`${key} must be text of at most ${max} characters.`);
    }
    const rule = audienceRule(args.audience);
    if (rule === 'invalid') return invalid('audience may only hold stages, sources and tags (lists of text) and inactive_days.');
    const segment = args.segment_id;
    if (segment !== undefined && segment !== null && (typeof segment !== 'string' || !UUID.test(segment))) return invalid('segment_id must be an id from read_email_campaigns.');
    // A saved segment decides the audience whenever one is set, so a rule and a segment together would save
    // one audience and send to another. One or the other.
    if (rule !== null && typeof segment === 'string') return invalid('Give either an audience rule or a saved segment_id, not both.');
    let sendAt: string | null | undefined = undefined;
    if (args.send_at !== undefined) {
      if (args.send_at === null) sendAt = null;
      // A time without its offset would be read in the server's zone, not the owner's: require one.
      else if (typeof args.send_at !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(args.send_at) || Number.isNaN(Date.parse(args.send_at))) return invalid('send_at must be an ISO date and time with the owner\'s UTC offset, for example 2026-10-10T09:00:00-05:00. Ask the owner\'s time zone if you do not know it.');
      else sendAt = new Date(args.send_at).toISOString();
    }
    const bodyHtml = typeof args.body === 'string' ? markupToHtml(args.body) : null;
    if (args.request_key !== undefined && (typeof args.request_key !== 'string' || !UUID.test(args.request_key))) return invalid('That request could not be matched; ask again.');
    const { request_key: settledKey, ...content } = args;
    const requestKey = campaignId ? null : typeof settledKey === 'string' ? settledKey : await emailCampaignRequestKey(ctx.tenantId, ctx.userId, content, ctx.turn);
    let saved: Record<string, unknown> | null;
    try {
      const reply = await deps.caller.rpc('email_campaign_draft', {
        p_expected_tenant_id: ctx.tenantId, p_campaign_id: campaignId, p_request_key: requestKey,
        p_name: args.name ?? null, p_kind: args.kind ?? null, p_subject: args.subject ?? null, p_preheader: args.preview_text ?? null,
        p_body_html: bodyHtml, p_audience: rule,
        p_segment_id: typeof segment === 'string' ? segment : null, p_clear_segment: segment === null || rule !== null,
        p_scheduled_for: sendAt ?? null, p_clear_schedule: sendAt === null, p_conversion_goal: args.goal ?? null,
      });
      if (reply.error) {
        const code = refusalCode(reply.error);
        // A refusal the database named changed nothing. Anything else may or may not have been saved.
        if (code) return refused(code);
        return { outcome: 'outcome_unknown', content: { success: false, outcome: 'outcome_unknown', error: 'The draft may or may not have been saved.', note: 'Read the campaigns before trying again; do not say it was saved.' } };
      }
      saved = object(reply.data);
    } catch {
      return { outcome: 'outcome_unknown', content: { success: false, outcome: 'outcome_unknown', error: 'The draft may or may not have been saved.', note: 'Read the campaigns before trying again; do not say it was saved.' } };
    }
    const savedId = saved?.campaign_id;
    if (typeof savedId !== 'string' || !UUID.test(savedId)) return { outcome: 'outcome_unknown', content: { success: false, outcome: 'outcome_unknown', error: 'The draft may or may not have been saved.', note: 'Read the campaigns before trying again; do not say it was saved.' } };
    // Read it back. Only a draft that now carries what was written counts as saved.
    const back = await readCampaign(deps, ctx.tenantId, savedId).catch(() => null);
    const version = object(back?.version);
    const camp = object(back?.campaign);
    const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
    const matches = !!version && !!camp && version.id === saved!.version_id && version.state === 'draft'
      && (args.subject === undefined || version.subject === args.subject)
      && (args.preview_text === undefined || version.preheader === args.preview_text)
      && (bodyHtml === null || version.body_html === bodyHtml)
      && (args.name === undefined || camp.name === String(args.name).trim() || !String(args.name).trim())
      && (args.kind === undefined || camp.kind === args.kind)
      && (args.goal === undefined || version.conversion_goal === args.goal)
      && (rule === null || (same(version.audience, rule) && version.segment_id == null))
      && (typeof segment !== 'string' || version.segment_id === segment)
      && (segment !== null || version.segment_id == null)
      && (sendAt === undefined || (sendAt === null ? version.scheduled_for == null : Date.parse(String(version.scheduled_for)) === Date.parse(sendAt)));
    if (!matches) return { outcome: 'outcome_unknown', runId: savedId, content: { success: false, outcome: 'outcome_unknown', campaign_id: savedId, error: 'The draft was written but could not be confirmed.', note: 'Read the campaign before saying it was saved.' } };
    const created = saved!.created === true;
    const replayed = saved!.replayed === true;
    // A create is one act however often it is retried, so its receipt is keyed to the create key; each change
    // to a draft is its own act, keyed by the call.
    return { outcome: 'succeeded', runId: requestKey ? `create:${requestKey}` : undefined, content: {
      success: true, campaign_id: savedId, version_no: count(version!.version_no), created: created && !replayed, replayed,
      subject: text(version!.subject, 300), send_at: version!.scheduled_for ?? null,
      note: `${replayed ? 'This draft was already saved from the same request; nothing new was made' : created ? 'Saved as a new draft' : 'The draft is updated'}. Nothing was sent. The owner can open it in Marketing › Email, or ask you to file it for approval.`,
    } };
  }

  // email_campaign_request_approval
  if (!campaignId) return invalid('campaign_id is required.');
  let filed: Record<string, unknown> | null;
  try {
    const reply = await deps.caller.rpc('email_campaign_submit_for_approval', { p_expected_tenant_id: ctx.tenantId, p_campaign_id: campaignId });
    if (reply.error) {
      const code = refusalCode(reply.error);
      if (code) return refused(code);
      return { outcome: 'outcome_unknown', content: { success: false, outcome: 'outcome_unknown', error: 'It may or may not have been filed for approval.', note: 'Read the campaign before trying again; do not say it was filed.' } };
    }
    filed = object(reply.data);
  } catch {
    return { outcome: 'outcome_unknown', content: { success: false, outcome: 'outcome_unknown', error: 'It may or may not have been filed for approval.', note: 'Read the campaign before trying again; do not say it was filed.' } };
  }
  const back = await readCampaign(deps, ctx.tenantId, campaignId).catch(() => null);
  const version = object(back?.version);
  if (!filed || !version || version.id !== filed.version_id || version.state !== 'locked' || back?.approval_status !== 'pending') {
    return { outcome: 'outcome_unknown', runId: campaignId, content: { success: false, outcome: 'outcome_unknown', campaign_id: campaignId, error: 'It was filed but could not be confirmed.', note: 'Read the campaign before saying it is waiting for approval.' } };
  }
  const recipients = count(filed.recipients);
  const cost = typeof filed.cost_bound_usd === 'number' ? filed.cost_bound_usd : Number(filed.cost_bound_usd ?? 0);
  return { outcome: 'succeeded', runId: String(filed.approval_id), content: {
    success: true, campaign_id: campaignId, version_no: count(version.version_no), waiting_for_approval: true, replayed: filed.replayed === true,
    recipients, from: text(filed.from_address, 320), cost_bound_usd: Number.isFinite(cost) ? cost : null,
    note: 'Filed for approval. Nothing is sent until the owner or an admin approves it in Marketing › Email or Approvals. You cannot approve or send it.',
  } };
}
