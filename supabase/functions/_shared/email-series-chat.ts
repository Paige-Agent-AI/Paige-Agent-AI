import { markupToHtml, sourceOf } from './email-markup.ts';
import { placeholderTokens } from './growth-blocks.ts';
import {
  EMAIL_SERIES_READ_CAPABILITY, EMAIL_SERIES_DRAFT_CAPABILITY, EMAIL_SERIES_REQUEST_APPROVAL_CAPABILITY,
} from './paige-spine/domains/email_campaigns.ts';

// Marketing email series from chat (E3c). PAIGE reads the business's series, writes a whole series — who
// enters, every email and its wait, when people leave — and files it for the owner's one approval. Everything
// underneath is E3: the same series records, the same owner functions the series view calls, the same tick,
// worker, sender rules, footer, unsubscribe and daily limit. Every call runs on the signed-in person's own
// session and names the business the chat is in, so the database decides scope. PAIGE never approves,
// starts, pauses, stops or sends a series; those stay with a person in Marketing › Email.
//
// PAIGE WRITES; SHE DOES NOT INVENT. A link, a price or a fill-in token she was not given is refused before
// anything is written: a link must be one of the business's own live pages, booking pages or confirmed
// website, already in the series, or given by the owner in this conversation; a price must be a recorded
// price, already in the series, or a number the owner wrote. The refusal names the missing fact and changes
// nothing, so she asks the owner and writes again (missing-fact continuation is the chat's ordinary next
// turn; there is no resume store here). Offers, deadlines, guarantees and results are held by the tool
// description and the business context PAIGE is given, not by a check here.
const writable = (schema: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(schema));
export const EMAIL_SERIES_TOOLS = [
  {type:'function',function:{name:'read_email_series',description:'Read this business\'s email series (welcome, nurture and win-back emails that send by themselves), or pass series_id for one series in full: who enters, every email with its wait and words, when people leave, the sender, who would enter today, who is waiting to enter, how it is doing, and its approval state. Also returns the business\'s own live links (pages, forms, funnels, booking pages, confirmed website) and recorded prices, the only links and prices you may use without asking. Read before changing a series. Shows no recipient addresses.',parameters:EMAIL_SERIES_READ_CAPABILITY.input}},
  {type:'function',function:{name:'email_series_draft',description:'Write a new email series draft (omit series_id; give kind and the emails) or change one (pass series_id from read_email_series). A series is a set of emails that send by themselves to each person who enters, one after another. emails is the WHOLE list in order (one to ten) and replaces what the draft had, so read the series first and include every email that should stay. Each email: subject, optional preview_text, body, and its wait — email 1 waits from when the person enters, each later one from when the previous was sent (wait_days 0-90, wait_hours 0-23); give the wait for every email after the first. Write the body in plain marks, one per line: "# Heading", "- item", "[link text](https://...)", "[[Button text|https://...]]", blank line between paragraphs. Use only facts you were given: the business context, its approved knowledge, the links and prices read_email_series returns, and what the owner tells you. Never invent an offer, price, deadline, link, guarantee, client result, product detail or claim, and never leave a fill-in like [Your name] or {{first_name}}; if a fact is missing, ask the owner for it. entry: "new_contacts" (people added after the series starts) or "matching" (anyone who matches now or later). audience is a rule over stages, sources and tags read_email_series lists (empty means everyone who can be emailed), plus inactive_days (people not contacted in at least that many days), or a saved segment_id; it replaces the whole rule. leave_on_goal ends someone\'s series when they reach it (form_submission, booking, deal_created, invoice_paid or none); leave_when_unmatched ends it when they stop matching. The sender is the business\'s connected email first; the owner changes it in the series view. A draft sends nothing. A series waiting for approval cannot be changed here (the owner uses Make changes); a running series keeps sending its approved emails until the change is approved; a stopped series cannot be changed (the owner starts a copy).',parameters:writable(EMAIL_SERIES_DRAFT_CAPABILITY.input)}},
  {type:'function',function:{name:'email_series_request_approval',description:'File one series\' draft for the owner\'s approval. This freezes every email, wait, rule and the sender under one approval; it does NOT approve, start or send anything. Only the owner or an admin approves, in Marketing › Email or Approvals. Once approved, the series sends by itself to everyone who enters that version, within the daily sending limit, until it is paused or stopped; any later change needs a new approval. Needs every email written, the business postal address, a working sender, and (for "matching") no more people matching now than the daily limit.',parameters:writable(EMAIL_SERIES_REQUEST_APPROVAL_CAPABILITY.input)}},
] as const;
export const EMAIL_SERIES_TOOL_NAMES = new Set<string>(EMAIL_SERIES_TOOLS.map((t) => t.function.name));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Reply = { data: unknown; error: unknown };
export type EmailSeriesChatDeps = { caller: { rpc(name: string, args: Record<string, unknown>): PromiseLike<Reply> } };
type Turn = { thread_id: string | null; user_turn_ordinal: number; user_turn: unknown };
export type EmailSeriesChatContext = {
  tenantId: string | null; userId: string; toolName: string; args: Record<string, unknown>; turn: Turn;
  /** Everything the owner wrote in this conversation: the facts they gave PAIGE. */
  ownerText: string;
  /** The public site the business's pages and booking links are served from. */
  publicSiteUrl: string;
};
// `invalid` reached nothing (malformed, or a fact PAIGE was not given), so it is not the business's activity.
export type EmailSeriesOutcome = 'succeeded' | 'refused' | 'invalid' | 'failed' | 'outcome_unknown';
export type EmailSeriesChatResult = { outcome: EmailSeriesOutcome; content: Record<string, unknown>; runId?: string };

const object = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown, max: number): string | null => typeof v === 'string' ? v.slice(0, max) : null;
const count = (v: unknown): number | null => Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : null;

const REFUSALS: Record<string, string> = {
  not_signed_in: 'You need to be signed in to work on email series.',
  not_permitted: 'Only the owner or an admin of this business can work on email series.',
  active_account_changed: 'The active business changed. Reopen Marketing › Email in the business you mean, then ask again.',
  not_for_this_account: 'Email series run inside each business, not the agency account. Switch to the business you mean and ask again.',
  series_not_found: 'That series is not in this business. Read the series again and use one of them.',
  series_awaiting_approval: 'That series is waiting for approval, so it cannot be changed here. The owner can use Make changes in the series, which withdraws the waiting approval.',
  series_stopped: 'That series was stopped, and a stopped series cannot be changed or restarted. The owner can use Start a copy in the series to make a new one from it.',
  not_an_editable_draft: 'That series has no draft to change. Read it again.',
  nothing_to_file: 'That series has no change waiting to be filed; what it has is already approved.',
  steps_required: 'The series needs at least one email before it can be filed.',
  step_incomplete: 'Every email in the series needs a subject and words before it can be filed.',
  too_many_steps: 'A series holds at most ten emails.',
  postal_address_missing: 'The business postal address is not set, and every marketing email must carry it. Add it in Settings › Connections › Registration, then file again.',
  over_daily_cap: 'More people match this series right now than the business can email in a day. Narrow who enters, or choose "new contacts" so it starts with people added from now on.',
  sender_not_found: 'The series\' sender is no longer connected. The owner can pick another sender in the series.',
  sender_needs_attention: 'The sender needs attention before it can send. The owner can reconnect it or pick another sender in the series.',
  rule_invalid: 'I couldn\'t use that rule for who enters. Choose by stage, source, tag, or how long since someone was last contacted.',
  segment_not_found: 'That saved segment is not in this business. Read the series again to see the saved segments.',
  entry_mode_invalid: 'Who enters must be new contacts or anyone who matches.',
  goal_invalid: 'That is not one of the goals a series can end on.',
  steps_invalid: 'The emails could not be used. Give one to ten emails, each with a subject, words and a wait.',
  kind_invalid: 'That is not one of the series kinds.',
  too_long: 'That is more than a series can hold. Shorten the emails, then try again.',
};
function refusalCode(error: unknown): string | null {
  if ((object(error)?.code as string | undefined) === '23514') return 'too_long';
  const message = String((object(error)?.message as string | undefined) ?? '');
  const match = /^([a-z_]{3,40})$/.exec(message.trim());
  return match ? match[1] : null;
}
function refused(code: string, detail?: unknown): EmailSeriesChatResult {
  const extra = typeof detail === 'string' && detail.trim() ? ` ${detail.trim().slice(0, 200)}` : '';
  return { outcome: 'refused', content: { success: false, code, error: (REFUSALS[code] ?? 'That was refused. Read the series again before trying anything else.') + extra, note: 'Nothing was changed by this call.' } };
}
const invalid = (fix: string): EmailSeriesChatResult => ({ outcome: 'invalid', content: { success: false, error: 'That request could not be used.', fix, note: 'Nothing was changed by this call. Do not mention internal field or tool names to the owner.' } });
const unknown = (what: string, id?: string): EmailSeriesChatResult => ({ outcome: 'outcome_unknown', runId: id, content: {
  success: false, outcome: 'outcome_unknown', series_id: id, error: `${what} may or may not have happened.`, note: 'Read the series before trying again; do not say it was done.' } });

/** Key order normalised, so two equal objects compare equal however they were built or stored. */
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;

/** The key that makes one chat request create at most one series, however often it is retried. The chat
 *  settles it into the arguments before the approval fingerprint, so the approved call redeems the same key. */
export async function emailSeriesRequestKey(tenant: string, actor: string, args: Record<string, unknown>, turn: Turn): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical({ namespace: 'email_series_draft_v1', tenant, actor, args, turn }))));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ALLOWED: Record<string, readonly string[]> = {
  read_email_series: ['series_id'],
  email_series_draft: ['request_key', 'series_id', 'kind', 'name', 'entry', 'audience', 'segment_id', 'leave_on_goal', 'leave_when_unmatched', 'emails'],
  email_series_request_approval: ['series_id'],
};
const KINDS = new Set(['welcome', 'nurture', 'reengagement', 'custom']);
const GOALS = new Set(['none', 'form_submission', 'booking', 'deal_created', 'invoice_paid']);
const STEP_KEYS = new Set(['wait_days', 'wait_hours', 'subject', 'preview_text', 'body']);

/** The audience rule PAIGE may set: the rule builder's own shape, nothing else. */
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

// ── Facts PAIGE was given ─────────────────────────────────────────────────────────────────────────────

const PLATFORM_HOSTS = ['paigeagent.ai', 'app.paigeagent.ai'];
const hostOf = (raw: string): string | null => { try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
/** A link as host and path, so http/https, "www.", a trailing slash, a query or a fragment do not matter. */
export function linkKey(raw: string): string | null {
  const value = raw.trim().replace(/[.,;:!?'"]+$/, '');
  if (/^mailto:/i.test(value)) { const addr = value.slice(7).split('?')[0].trim().toLowerCase(); return addr.includes('@') ? `mailto:${addr}` : null; }
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.hostname.toLowerCase().replace(/^www\./, '') + url.pathname.replace(/\/+$/, '');
  } catch { return null; }
}
/** Every link the words would put in front of a reader: marked links, buttons and bare addresses. */
export function linksIn(words: string): string[] {
  const out = new Set<string>();
  for (const m of words.matchAll(/https?:\/\/[^\s<>"'()[\]|]+|mailto:[^\s<>"'()[\]|]+/gi)) out.add(m[0]);
  return [...out];
}
/** Links the owner wrote, with or without "https://". */
function linksGivenIn(words: string): Set<string> {
  const keys = new Set<string>();
  for (const raw of linksIn(words)) { const k = linkKey(raw); if (k) keys.add(k); }
  for (const m of words.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/[^\s<>"'()[\]|]*)?/gi)) { const k = linkKey(m[0]); if (k) keys.add(k); }
  for (const m of words.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi)) keys.add(`mailto:${m[0].toLowerCase()}`);
  return keys;
}
/** Money the words state, in cents: "$497", "$1,997.50", "497 dollars", "300 USD". */
export function amountsIn(words: string): number[] {
  const out: number[] = [];
  const cents = (whole: string, frac?: string) => Number(whole.replace(/,/g, '')) * 100 + (frac ? Number(frac.padEnd(2, '0')) : 0);
  for (const m of words.matchAll(/[$£€]\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)) out.push(cents(m[1], m[2]));
  for (const m of words.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(?:usd|eur|gbp|dollars?|euros?|pounds?)\b/gi)) out.push(cents(m[1], m[2]));
  return out;
}
/** Amounts the owner gave: written as money ("$497", "300 dollars"), or a number near a price word ("the
 *  price is 1,997", "it costs 497"). A bare count ("3 emails over 2 weeks", "2026") is not a price. */
export function numbersGivenIn(words: string): Set<number> {
  const out = new Set<number>(amountsIn(words));
  const near = /\b(?:price[ds]?|pric(?:e|ing)|costs?|fee|fees|charges?|pay|pays|paid|invest(?:ment)?|rate|tuition|deposit|retainer)\b[^.\n\d]{0,24}(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/gi;
  for (const m of words.matchAll(near)) out.add(Number(m[1].replace(/,/g, '')) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0));
  return out;
}
/** Fill-in tokens a reader would see as written: [Your name], [ADD_DATE], {{first_name}}, {company}. Links
 *  and buttons are taken out first, so their own brackets are not mistaken for a fill-in. */
export function fillInsIn(words: string): string[] {
  const stripped = words.replace(/\[\[[^\]\n]*\]\]/g, ' ').replace(/\[[^\]\n]{1,200}\]\([^)\s]{1,2000}\)/g, ' ');
  const found = [...placeholderTokens(stripped)];
  for (const m of stripped.matchAll(/\{\{[^{}\n]{0,60}\}\}|\{[A-Za-z_][A-Za-z0-9_ ]{1,40}\}/g)) found.push(m[0]);
  return [...new Set(found)];
}
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

type Facts = { links: Set<string>; pathsOnPlatform: Set<string>; platformHosts: Set<string>; amounts: Set<number>; absoluteLinks: string[]; website: string | null; prices: number[] };
async function businessFacts(deps: EmailSeriesChatDeps, tenantId: string, publicSiteUrl: string): Promise<Facts | null> {
  const reply = await deps.caller.rpc('read_email_series_links', { p_expected_tenant_id: tenantId });
  const d = object(reply.data);
  if (reply.error || !d) return null;
  const site = publicSiteUrl.replace(/\/+$/, '');
  const paths = Array.isArray(d.paths) ? d.paths.filter((p): p is string => typeof p === 'string' && p.startsWith('/')) : [];
  const website = typeof d.website === 'string' && d.website.trim() ? d.website.trim() : null;
  const prices = Array.isArray(d.prices) ? d.prices.filter((p): p is number => Number.isSafeInteger(p) && p >= 0) : [];
  const links = new Set<string>();
  const websiteKey = website ? linkKey(website) : null;
  if (websiteKey) links.add(websiteKey);
  return {
    links, website, prices,
    pathsOnPlatform: new Set(paths.map((p) => p.replace(/\/+$/, ''))),
    platformHosts: new Set([hostOf(site), ...PLATFORM_HOSTS].filter((h): h is string => !!h)),
    amounts: new Set(prices),
    absoluteLinks: [...paths.map((p) => `${site}${p}`), ...(website ? [website] : [])],
  };
}
/** What the words say that nobody gave PAIGE: links, prices and fill-ins. Empty means grounded. */
function ungrounded(words: string, facts: Facts, given: { links: Set<string>; amounts: Set<number> }): string[] {
  const missing: string[] = [];
  for (const raw of linksIn(words)) {
    const key = linkKey(raw);
    if (!key) { missing.push(`a working address for the link "${raw.slice(0, 120)}"`); continue; }
    if (given.links.has(key) || facts.links.has(key)) continue;
    const host = key.startsWith('mailto:') ? null : key.split('/')[0];
    const path = key.startsWith('mailto:') ? null : key.slice(key.indexOf('/') === -1 ? key.length : key.indexOf('/'));
    if (host && path && facts.platformHosts.has(host) && facts.pathsOnPlatform.has(path)) continue;
    missing.push(`the real link for ${raw.slice(0, 120)}`);
  }
  for (const cents of amountsIn(words)) {
    if (!given.amounts.has(cents) && !facts.amounts.has(cents)) missing.push(`the actual price (${money(cents)} is not a recorded price and you did not give it)`);
  }
  for (const token of fillInsIn(words)) missing.push(`what goes in ${token}`);
  return [...new Set(missing)];
}

// ── Reading a series ──────────────────────────────────────────────────────────────────────────────────

// The words the series view uses, so PAIGE speaks to the owner in them rather than in field values.
const STATUS_WORDS: Record<string, string> = { draft: 'Draft, not started', pending_approval: 'Waiting for your approval', active: 'Running', paused: 'Paused', blocked: 'Needs attention', stopped: 'Stopped' };
const KIND_WORDS: Record<string, string> = { welcome: 'Welcome series', nurture: 'Nurture series', reengagement: 'Win-back series', custom: 'Series' };
const ENTRY_WORDS: Record<string, string> = { new_contacts: 'New contacts from now on', matching: 'Anyone who matches, now or later' };
const GOAL_WORDS: Record<string, string> = { form_submission: 'fills in a form', booking: 'books a meeting', deal_created: 'becomes a deal', invoice_paid: 'pays an invoice' };
const WORDS_NOTE = 'Speak to the owner in the in_words values and plain language, never in field names or raw values.';
const leavesInWords = (goal: unknown, unmatched: boolean) => {
  const parts = ['they unsubscribe, bounce or are marked do not contact'];
  if (typeof goal === 'string' && GOAL_WORDS[goal]) parts.push(`they ${GOAL_WORDS[goal]}`);
  if (unmatched) parts.push('they stop matching who enters');
  return `Someone leaves when ${parts.join(', or ')}.`;
};
const waitOf = (minutes: unknown) => { const m = count(minutes) ?? 0; return { days: Math.floor(m / 1440), hours: Math.floor((m % 1440) / 60), minutes: m % 60 }; };
function seriesView(data: Record<string, unknown>): Record<string, unknown> {
  const seq = object(data.sequence) ?? {};
  const version = object(data.version) ?? {};
  const live = object(data.live);
  const resolves = object(data.resolves) ?? {};
  const preview = object(data.entry_preview) ?? {};
  const people = object(data.people) ?? {};
  const sending = object(data.sending) ?? {};
  const choices = object(data.choices) ?? {};
  const steps = Array.isArray(version.steps) ? version.steps.map((s) => object(s)).filter(Boolean) as Record<string, unknown>[] : [];
  const keys = (v: unknown) => Array.isArray(v) ? v.map((x) => object(x)).filter(Boolean).map((x) => ({ key: text(x!.key, 120), contacts: count(x!.count) })) : [];
  const emails = steps.map((st) => {
    const html = typeof st.body_html === 'string' ? st.body_html : '';
    const source = sourceOf(html);
    return {
      email: count(st.position), wait: waitOf(st.delay_minutes), waits_from: count(st.position) === 1 ? 'entering the series' : 'the previous email being sent',
      subject: text(st.subject, 300), preview_text: text(st.preheader, 300),
      body: source ?? null, body_written_as_html: source === null ? html.slice(0, 6000) : undefined,
      body_note: source === null && html ? 'This email was written as HTML. Rewriting it replaces its formatting with plain marks, so ask the owner first.' : undefined,
    };
  });
  const cap = count(sending.daily_cap);
  const postal = typeof data.postal_address === 'string' && data.postal_address.trim() !== '';
  const blockers: string[] = [];
  if (version.state === 'draft') {
    if (!steps.length) blockers.push('The series has no emails.');
    const empty = steps.filter((st) => !String(st.subject ?? '').trim() || !String(st.body_html ?? '').trim()).map((st) => count(st.position));
    if (empty.length) blockers.push(`Email ${empty.join(', ')} still ${empty.length === 1 ? 'needs' : 'need'} a subject and words.`);
    if (!postal) blockers.push('The business postal address is not set (Settings › Connections › Registration).');
    if (resolves.ok !== true) blockers.push(REFUSALS[String(resolves.reason)] ?? 'The sender needs attention.');
    const eligibleNew = count(preview.eligible_new);
    if (version.entry_mode === 'matching' && cap !== null && eligibleNew !== null && eligibleNew > cap) blockers.push(`${eligibleNew} people match now; the daily limit is ${cap}.`);
  }
  return {
    series: { id: seq.id, name: text(seq.name, 200), kind: seq.kind, kind_in_words: KIND_WORDS[String(seq.kind)] ?? 'Series', status: seq.status,
      status_in_words: STATUS_WORDS[String(seq.status)] ?? null, needs_attention_because: text(seq.blocked_reason, 300),
      started_at: seq.activated_at ?? null, stopped_at: seq.stopped_at ?? null },
    version: { version_no: count(version.version_no), state: version.state, changing_a_running_series: !!live || (!!seq.live_version_id && version.state !== 'approved') },
    who_enters: { entry: version.entry_mode, entry_in_words: ENTRY_WORDS[String(version.entry_mode)] ?? null, audience: object(version.audience) ?? {}, segment_id: version.segment_id ?? null, segment_name: text(version.segment_name, 200) },
    leaves_when: { goal: version.exit_on_goal, stops_matching: version.exit_when_unmatched === true, in_words: leavesInWords(version.exit_on_goal, version.exit_when_unmatched === true) },
    emails,
    sender: resolves.ok === true ? { from: text(resolves.from_address, 320), from_name: text(resolves.from_name, 200), via: resolves.mode === 'managed' ? 'PAIGE\'s sending' : 'the business\'s connected email' }
      : { problem: REFUSALS[String(resolves.reason)] ?? 'The sender needs attention.' },
    postal_address_set: postal,
    who_would_enter_today: { matched: count(preview.matched), can_receive: count(preview.eligible), new_to_this_series: count(preview.eligible_new),
      left_out: { no_address: count(preview.no_address), opted_out: count(preview.opted_out), suppressed: count(preview.suppressed) } },
    waiting_to_enter: count(data.waiting_to_enter),
    approval: object(data.approval)?.status ?? null, last_declined_reason: text(object(data.last_declined)?.reason, 500),
    running_version: live ? { version_no: count(live.version_no), emails: (Array.isArray(live.steps) ? live.steps : []).map((s) => object(s)).filter(Boolean)
      .map((s) => ({ email: count(s!.position), wait: waitOf(s!.delay_minutes), subject: text(s!.subject, 300) })) } : null,
    people: { in_now: count(people.in_now), completed: count(people.completed), left: count(people.left), left_because: object(people.left_because) ?? {} },
    daily_limit: cap, remaining_today: count(sending.remaining_today),
    ready_to_file: version.state === 'draft' ? blockers.length === 0 : null, before_filing: version.state === 'draft' ? blockers : [],
    audience_choices: { stages: keys(choices.stages), sources: keys(choices.sources), tags: keys(choices.tags) },
    saved_segments: Array.isArray(data.segments) ? data.segments.map((s) => object(s)).filter(Boolean).map((s) => ({ id: s!.id, name: text(s!.name, 200) })) : [],
    words_note: WORDS_NOTE,
  };
}
const factsView = (facts: Facts | null) => facts
  ? { business_links: facts.absoluteLinks, recorded_prices: facts.prices.map(money),
      facts_note: 'These are the only links and prices you may use without asking; anything else must come from the owner.' }
  : { facts_note: 'The business\'s links and prices could not be read; ask the owner for any link or price.' };

async function readSeries(deps: EmailSeriesChatDeps, tenantId: string, id: string): Promise<{ data?: Record<string, unknown>; error?: unknown }> {
  const reply = await deps.caller.rpc('read_email_series', { p_expected_tenant_id: tenantId, p_sequence_id: id });
  if (reply.error) return { error: reply.error };
  const data = object(reply.data);
  return data ? { data } : { error: new Error('unreadable') };
}

// ── Dispatch ──────────────────────────────────────────────────────────────────────────────────────────

export async function dispatchEmailSeriesChat(ctx: EmailSeriesChatContext, deps: EmailSeriesChatDeps): Promise<EmailSeriesChatResult> {
  if (!ctx.tenantId || !UUID.test(ctx.tenantId)) return invalid('Email series are not available without an active business.');
  const allowed = ALLOWED[ctx.toolName];
  if (!allowed) return invalid('That email series action is not available.');
  const given = object(ctx.args);
  if (!given) return invalid('That request was not readable.');
  const { confirm: _compat, ...args } = given;
  if (Object.keys(args).some((k) => !allowed.includes(k))) return invalid('That request had fields this action does not take.');
  const givenId = args.series_id ?? null;
  if (givenId !== null && (typeof givenId !== 'string' || !UUID.test(givenId))) return invalid('series_id must be an id from read_email_series.');
  const seriesId = givenId as string | null;
  const tenantId = ctx.tenantId;

  if (ctx.toolName === 'read_email_series') {
    try {
      const facts = await businessFacts(deps, tenantId, ctx.publicSiteUrl).catch(() => null);
      if (seriesId) {
        const read = await readSeries(deps, tenantId, seriesId);
        if (read.error) { const code = refusalCode(read.error); return code && REFUSALS[code] ? refused(code) : { outcome: 'failed', content: { success: false, error: 'The series could not be read right now.' } }; }
        return { outcome: 'succeeded', content: { success: true, ...seriesView(read.data!), ...factsView(facts) } };
      }
      const reply = await deps.caller.rpc('read_email_series', { p_expected_tenant_id: tenantId, p_sequence_id: null });
      if (reply.error) { const code = refusalCode(reply.error); return code && REFUSALS[code] ? refused(code) : { outcome: 'failed', content: { success: false, error: 'The series could not be read right now.' } }; }
      const data = object(reply.data);
      if (!data) throw new Error('unreadable');
      const rows = Array.isArray(data.sequences) ? data.sequences.map((r) => object(r)).filter(Boolean).map((r) => ({
        id: r!.id, name: text(r!.name, 200), kind: r!.kind, kind_in_words: KIND_WORDS[String(r!.kind)] ?? 'Series', status: r!.status,
        status_in_words: STATUS_WORDS[String(r!.status)] ?? null, needs_attention_because: text(r!.blocked_reason, 300),
        emails: count(r!.emails), entry: r!.entry_mode, change_waiting: r!.change_state ?? null,
        in_now: count(r!.in_now), entered: count(r!.entered), sent_last_30_days: count(r!.sent_30d), next_send_at: r!.next_send_at ?? null,
      })) : [];
      return { outcome: 'succeeded', content: { success: true, series: rows, ...factsView(facts), words_note: WORDS_NOTE,
        note: rows.length ? 'Pass a series id to read one in full.' : 'This business has no email series yet.' } };
    } catch { return { outcome: 'failed', content: { success: false, error: 'The series could not be read right now.' } }; }
  }

  if (ctx.toolName === 'email_series_draft') {
    if (seriesId && args.kind !== undefined) return invalid('kind is chosen when a series is made; leave it out when changing one.');
    if (args.kind !== undefined && !KINDS.has(String(args.kind))) return invalid('kind must be welcome, nurture, reengagement or custom.');
    if (args.name !== undefined && (typeof args.name !== 'string' || args.name.length > 200)) return invalid('name must be text of at most 200 characters.');
    if (args.entry !== undefined && args.entry !== 'new_contacts' && args.entry !== 'matching') return invalid('entry must be "new_contacts" or "matching".');
    if (args.leave_on_goal !== undefined && !GOALS.has(String(args.leave_on_goal))) return invalid('leave_on_goal is not one of the goals.');
    if (args.leave_when_unmatched !== undefined && typeof args.leave_when_unmatched !== 'boolean') return invalid('leave_when_unmatched must be true or false.');
    const rule = audienceRule(args.audience);
    if (rule === 'invalid') return invalid('audience may only hold stages, sources and tags (lists of text) and inactive_days.');
    const segment = args.segment_id;
    if (segment !== undefined && segment !== null && (typeof segment !== 'string' || !UUID.test(segment))) return invalid('segment_id must be an id from read_email_series.');
    if (rule !== null && typeof segment === 'string') return invalid('Give either an audience rule or a saved segment_id, not both.');
    if (!seriesId && args.emails === undefined) return invalid('A new series needs its emails: give every email with its subject, words and wait.');
    let steps: { delay_minutes: number; subject: string; preheader: string; body_html: string; words: string }[] | null = null;
    if (args.emails !== undefined) {
      if (!Array.isArray(args.emails) || args.emails.length < 1 || args.emails.length > 10) return invalid('emails must list one to ten emails.');
      steps = [];
      for (const [i, raw] of args.emails.entries()) {
        const e = object(raw);
        const n = i + 1;
        if (!e || Object.keys(e).some((k) => !STEP_KEYS.has(k))) return invalid(`Email ${n} may only have wait_days, wait_hours, subject, preview_text and body.`);
        for (const [key, max] of [['subject', 300], ['preview_text', 300], ['body', 20000]] as const) {
          if (e[key] !== undefined && (typeof e[key] !== 'string' || (e[key] as string).length > max)) return invalid(`Email ${n}'s ${key} must be text of at most ${max} characters.`);
        }
        if (!String(e.subject ?? '').trim() || !String(e.body ?? '').trim()) return invalid(`Email ${n} needs a subject and a body.`);
        const days = e.wait_days ?? 0, hours = e.wait_hours ?? 0;
        if (!Number.isInteger(days) || Number(days) < 0 || Number(days) > 90 || !Number.isInteger(hours) || Number(hours) < 0 || Number(hours) > 23) return invalid(`Email ${n}'s wait must be whole days (0-90) and hours (0-23).`);
        if (n > 1 && e.wait_days === undefined && e.wait_hours === undefined) return invalid(`Say how long email ${n} waits after the previous email is sent (wait_days and/or wait_hours).`);
        const delay = Number(days) * 1440 + Number(hours) * 60;
        if (delay > 129600) return invalid(`Email ${n} can wait at most 90 days.`);
        const subject = String(e.subject), preheader = String(e.preview_text ?? ''), body = String(e.body);
        steps.push({ delay_minutes: delay, subject, preheader, body_html: markupToHtml(body), words: [subject, preheader, body].join('\n') });
      }
    }

    // What the series already says (the owner wrote it, or PAIGE did and it was kept) stays allowed.
    let existing: Record<string, unknown> | null = null;
    if (seriesId) {
      const read = await readSeries(deps, tenantId, seriesId).catch((error) => ({ error }));
      if ('error' in read && read.error) { const code = refusalCode(read.error); return code && REFUSALS[code] ? refused(code) : { outcome: 'failed', content: { success: false, error: 'The series could not be read right now.' } }; }
      existing = (read as { data: Record<string, unknown> }).data;
    }
    if (steps) {
      const facts = await businessFacts(deps, tenantId, ctx.publicSiteUrl).catch(() => null);
      if (!facts) return { outcome: 'failed', content: { success: false, error: 'The business\'s links and prices could not be checked right now, so nothing was written.' } };
      const already = [object(existing?.version), object(existing?.live)].flatMap((v) => Array.isArray(v?.steps) ? v!.steps as unknown[] : [])
        .map((s) => object(s)).filter(Boolean).map((s) => [s!.subject, s!.preheader, sourceOf(String(s!.body_html ?? '')) ?? String(s!.body_html ?? '')].join('\n')).join('\n');
      const givenLinks = linksGivenIn(ctx.ownerText);
      for (const raw of linksIn(already)) { const k = linkKey(raw); if (k) givenLinks.add(k); }
      for (const m of already.matchAll(/href="([^"]+)"/g)) { const k = linkKey(m[1]); if (k) givenLinks.add(k); }
      const givenAmounts = numbersGivenIn(ctx.ownerText);
      for (const c of amountsIn(already)) givenAmounts.add(c);
      const sender = text(object(existing?.resolves)?.from_address, 320);
      if (sender) givenLinks.add(`mailto:${sender.toLowerCase()}`);
      const needs = steps.flatMap((st, i) => ungrounded(st.words, facts, { links: givenLinks, amounts: givenAmounts }).map((m) => `Email ${i + 1}: ${m}`));
      if (needs.length) return { outcome: 'invalid', content: {
        success: false, outcome: 'needs_input', needs: needs.slice(0, 12),
        error: 'The series uses facts nobody gave me, so I did not save it.',
        fix: 'Ask the owner for each fact listed in needs (one short, grouped question), or rewrite those emails without it, then write the series again. Use only the business links and recorded prices read_email_series returns, or what the owner gives you.',
        note: 'Nothing was changed by this call. Do not mention internal field or tool names to the owner.',
      } };
    }

    if (args.request_key !== undefined && (typeof args.request_key !== 'string' || !UUID.test(args.request_key))) return invalid('That request could not be matched; ask again.');
    const { request_key: settledKey, ...content } = args;
    const requestKey = seriesId ? null : typeof settledKey === 'string' ? settledKey : await emailSeriesRequestKey(tenantId, ctx.userId, content, ctx.turn);
    let saved: Record<string, unknown> | null;
    try {
      const reply = await deps.caller.rpc('email_series_draft', {
        p_expected_tenant_id: tenantId, p_sequence_id: seriesId, p_request_key: requestKey,
        p_kind: args.kind ?? null, p_name: typeof args.name === 'string' && args.name.trim() ? args.name.trim() : null,
        p_entry_mode: args.entry ?? null, p_audience: rule,
        p_segment_id: typeof segment === 'string' ? segment : null, p_clear_segment: segment === null || rule !== null,
        p_exit_on_goal: args.leave_on_goal ?? null, p_exit_when_unmatched: args.leave_when_unmatched ?? null,
        p_steps: steps ? steps.map(({ words: _w, ...st }) => st) : null,
      });
      if (reply.error) {
        const code = refusalCode(reply.error);
        if (code && REFUSALS[code]) return refused(code);
        return unknown('Saving the series', seriesId ?? undefined);
      }
      saved = object(reply.data);
    } catch { return unknown('Saving the series', seriesId ?? undefined); }
    const savedId = saved?.sequence_id;
    if (typeof savedId !== 'string' || !UUID.test(savedId)) return unknown('Saving the series', seriesId ?? undefined);
    // Read it back. Only a draft that now holds what was written counts as saved.
    const back = await readSeries(deps, tenantId, savedId).catch(() => ({ data: undefined }));
    const data = back.data ?? null;
    const version = object(data?.version);
    const seq = object(data?.sequence);
    const replayed = saved!.replayed === true;
    const backSteps = Array.isArray(version?.steps) ? version!.steps.map((s) => object(s)) : [];
    const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
    const matches = !!version && !!seq && version.id === saved!.version_id && version.state === 'draft' && (replayed || (
      (!steps || (backSteps.length === steps.length && steps.every((st, i) => {
        const b = backSteps[i];
        return !!b && b.position === i + 1 && b.delay_minutes === st.delay_minutes && b.subject === st.subject && b.preheader === st.preheader && b.body_html === st.body_html;
      })))
      && (args.entry === undefined || version.entry_mode === args.entry)
      && (rule === null || (same(version.audience, rule) && version.segment_id == null))
      && (typeof segment !== 'string' || version.segment_id === segment)
      && (segment !== null || version.segment_id == null)
      && (args.leave_on_goal === undefined || version.exit_on_goal === args.leave_on_goal)
      && (args.leave_when_unmatched === undefined || version.exit_when_unmatched === args.leave_when_unmatched)
      && (typeof args.name !== 'string' || !args.name.trim() || seq.name === args.name.trim())
      && (seriesId !== null || args.kind === undefined || seq.kind === args.kind)));
    if (!matches) return { outcome: 'outcome_unknown', runId: savedId, content: { success: false, outcome: 'outcome_unknown', series_id: savedId,
      error: 'The series was written but could not be confirmed.', note: 'Read the series before saying it was saved.' } };
    const created = saved!.created === true && !replayed;
    const changing = saved!.changing_running === true;
    const view = seriesView(data!);
    return { outcome: 'succeeded', runId: requestKey ? `create:${requestKey}` : undefined, content: {
      success: true, series_id: savedId, created, replayed, ...view,
      note: `${replayed ? 'This series was already saved from the same request; nothing new was made' : created ? 'Saved as a new series draft' : changing ? 'Saved as a change to the running series. What is running keeps sending until the change is approved' : 'The series draft is updated'}. Nothing was sent. Show the owner the whole series — who enters, each email with its wait, when people leave, and the sender — and offer to file it for approval${view.ready_to_file === false ? ' once what is listed in before_filing is resolved' : ''}. It is in Marketing › Email › Automations.`,
    } };
  }

  // email_series_request_approval
  if (!seriesId) return invalid('series_id is required.');
  let filed: Record<string, unknown> | null;
  try {
    const reply = await deps.caller.rpc('email_series_submit_for_approval', { p_expected_tenant_id: tenantId, p_sequence_id: seriesId });
    if (reply.error) {
      const code = refusalCode(reply.error);
      if (code && REFUSALS[code]) return refused(code, object(reply.error)?.details);
      return unknown('Filing the series for approval', seriesId);
    }
    filed = object(reply.data);
  } catch { return unknown('Filing the series for approval', seriesId); }
  const back = await readSeries(deps, tenantId, seriesId).catch(() => ({ data: undefined }));
  const version = object(back.data?.version);
  const approval = object(back.data?.approval);
  if (!filed || !version || version.id !== filed.version_id || version.state !== 'locked' || approval?.status !== 'pending') {
    return { outcome: 'outcome_unknown', runId: seriesId, content: { success: false, outcome: 'outcome_unknown', series_id: seriesId,
      error: 'It was filed but could not be confirmed.', note: 'Read the series before saying it is waiting for approval.' } };
  }
  return { outcome: 'succeeded', runId: String(filed.approval_id), content: {
    success: true, series_id: seriesId, version_no: count(version.version_no), waiting_for_approval: true, replayed: filed.replayed === true,
    emails: count(filed.emails), matching_now: count(filed.matching_now), from: text(filed.from_address, 320),
    note: 'Filed for approval. Nothing is sent until the owner or an admin approves it in Marketing › Email or Approvals; you cannot approve it. Once approved, it sends by itself to everyone who enters this version, within the daily limit, until it is paused or stopped. Any later change is a new version that needs its own approval.',
  } };
}
