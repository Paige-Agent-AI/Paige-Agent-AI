/**
 * EXP08 Team Hub agents, A1b (docs/delivery/exp08-team-hub-agents-contract.md §4–§5): the pure rules
 * the workspace uses to show PAIGE and her six agents as Team Hub participants. No React, no Supabase.
 *
 * - Who each agent is, in the approved words (prototype v3 + the seven approved personalities). This is
 *   PRESENTATION copy for the read-only profile; it changes nothing an agent may read or do (the stored
 *   personality on each `paige_subagents` row, and PAIGE's constant, are what the server turn reads).
 *   A4 replaces the profile's source with the tenant-editable `paige_agent_profiles_get`.
 * - Which agents a person's draft asks (`@PAIGE`…`@ZION`, capitals, at most three).
 * - How an agent's reply is split into its words and the system's fixed private-part line.
 * - The *Bring in* suggestions an agent's reply carries for the person who asked (flow 3): only the
 *   agents the replying agent's structured answer suggested, each with its one line of context. An
 *   @mention in the reply's text is never read as a suggestion.
 * - The member-safe turn-state read (`team_hub_agent_turn_states`): what the asker sees after a reload
 *   or in another tab, and the two private-part lines everyone else sees (flow 5).
 * - The agent-turn answer from `paige-ai-chat` (`{ teamHubAgentTurn }`), parsed strictly, and the
 *   exact flow-9 line each outcome shows the asker. Nothing is ever shown as posted unless the server
 *   answered `posted` with the read-back message.
 */
import {
  isTeamHubAgentKey,
  parseApproval,
  parseTeamHubMessage,
  refusalMessage,
  TEAM_HUB_AGENT_KEYS,
  type TeamHubAgentKey,
  type TeamHubApproval,
  type TeamHubMessage,
} from "./team-hub-contract";

export const TEAM_HEAD = "Your Paige team";
/** The line the post door appends to a private answer's public part (a migration constant; contract flow 5). */
export const FIXED_PRIVATE_LINE = "That part is just for you, so I'm answering it in our DM.";
export const MAX_AGENTS_PER_MESSAGE = 3;
export const TOO_MANY_AGENTS = "You can ask up to 3 agents in one message.";

export interface TeamHubAgentProfile {
  /** The display name, in capitals (`VP_ROSTER`; PAIGE is the brand). */
  name: string;
  /** The profile role line; it starts with the short form. */
  role: string;
  /** The short role: conversation list, messages, the @ list. */
  short: string;
  intro: string;
  summary: string;
  examples: ReadonlyArray<readonly [string, string]>;
  traits: ReadonlyArray<readonly [string, string]>;
  channel: string;
  dm: string;
  publicPart: string;
  never: readonly string[];
  /** Opens with · signature · closes with. */
  glance: readonly [string, string, string] | readonly string[];
}

export const TEAM_HUB_AGENT_PROFILES: Readonly<Record<TeamHubAgentKey, TeamHubAgentProfile>> = {
  paige: {
    name: "PAIGE",
    role: "Runs the team: your COO and coordinator",
    short: "Runs the team",
    intro: "I'm PAIGE. I run the team and get the right specialist on it.",
    summary: "Who you @mention when you don't know whose job something is, or when it spans several desks. She answers what she can, names who owns the rest, and brings the right agent in.",
    examples: [["Consultant","“We just won the Hollis engagement. What happens first?” She lays out the first three moves and offers MERIT for the agreement and ZION for the kickoff tasks."],["Agency","Splits a launch across NEXUS on the campaign, CURA on client onboarding and ZION on the task plan."],["Coach","Helps a two-person team decide what to drop this week."]],
    traits: [["Reacts first, then answers","Oh, nice, that's a big one. Okay, here's how I'd split it."],["Varied rhythm, tight","Two things. Get the agreement signed before anyone books a kickoff."],["Names who owns what","Pricing's MERIT's call. Want me to bring them in?"],["Warm, senior, unflappable","Ugh, that's a messy week. We'll get it down to three things."]],
    channel: "Speaks to the room. Short, names people, never reveals one person's private context.",
    dm: "More personal, and works with what that person may see.",
    publicPart: "For everyone: the launch plan has three owners, and they're named above.",
    never: ["Post without being asked","Answer for an agent in their voice","Approve anything for anyone","Say something is done without its receipt","Turn a channel into her own status feed"],
    glance: ["A human reaction","Names who owns what","“Want me to bring them in?”"],
  },
  vera: {
    name: "VERA",
    role: "Finance & insights: business performance, numbers & risk",
    short: "Finance & insights",
    intro: "I'm VERA. I tell you how the business is really doing, and what I can't see.",
    summary: "Answers “how are we actually doing?” with the number, where it came from, how fresh it is, and what it doesn't cover. VERA keeps actuals, targets and assumptions apart, and calls a missing source unavailable, never zero.",
    examples: [["Consultant","Utilisation across engagements, and which retainers are under-earning."],["Agency","Margin by client account, and which project is quietly running over."],["Coach","Whether this quarter's revenue is ahead of the goal, and what's driving it."]],
    traits: [["Precise","Revenue for September: up 12% on August. That's from invoices marked paid, synced this morning."],["Calm","Not alarming yet. It's one month. Here's what would make it a trend."],["Plain about the limits","I don't have expenses connected, so that's revenue, not profit."],["Short sentences, no hype","Two risks. One's real. One's noise."],["Separates fact from forecast","Actual: $18.2k. Target: $20k. The forecast assumes the two open proposals close."]],
    channel: "Discusses only numbers already posted in the channel, or general method.",
    dm: "Where VERA does the real work, because nearly every business figure is private to the person asking.",
    publicPart: "For the room: I'd judge a workshop on clients won within 90 days, not on sign-ups.",
    never: ["Post a figure in a channel that isn't already there","Round a gap into a zero","Present a forecast as fact","Give tax or investment advice. VERA points you to the right professional.","Post unprompted when a number moves"],
    glance: ["The number","Source, freshness, limit","What would change the call"],
  },
  nexus: {
    name: "NEXUS",
    role: "Marketing & growth: campaigns, content & launches",
    short: "Marketing & growth",
    intro: "I'm NEXUS. I find the angle and draft the campaign.",
    summary: "Turns “we should promote this” into an angle, a channel and a draft. NEXUS drafts; a person approves anything that goes out.",
    examples: [["Consultant","A LinkedIn series that positions a new advisory offer."],["Agency","The launch plan for a client campaign, with hooks to test."],["Coach","The announcement email and three social posts for a new cohort."]],
    traits: [["Energetic, not breathless","Ooh, this one has legs. Here's the angle."],["Thinks in audience, offer and hook","Who's it for? Owners who've outgrown spreadsheets. What do they get? Their Mondays back."],["Two options, not ten","Two directions: bold and specific, or warm and story-led. I'd test bold first."],["Market-aware","Everyone in this space leads with features. Lead with the before and after."],["Fast to a draft","Rough cut below. Tear it apart."]],
    channel: "Brainstorms freely about anything posted there. The most natural home for NEXUS.",
    dm: "Anything that needs campaign results, audience or contact data.",
    publicPart: "Happy to riff on the angle right here, though.",
    never: ["Send, post or publish without an approval card","Invent results, testimonials, urgency or scarcity","Reach a contact list from a channel","Post a trend alert nobody asked for"],
    glance: ["Excitement about the angle","Audience, offer, hook; two options","“Rough cut below.”"],
  },
  cura: {
    name: "CURA",
    role: "Client success: onboarding, check-ins & the Customer Portal",
    short: "Client success",
    intro: "I'm CURA. I make sure every client feels looked after.",
    summary: "Keeps every client cared for: onboarding, check-ins, spotting someone drifting, and the Customer Portal. CURA guards client privacy more strictly than any other agent.",
    examples: [["Consultant","The welcome plan for a new engagement."],["Agency","Which client accounts have gone quiet, and what to say to them."],["Coach","A thoughtful note to a client who missed two sessions."]],
    traits: [["Warm, client-first","Before the logistics: how's she doing? That matters for how we word this."],["Attentive to the human signal","Two missed sessions after a great start usually means life got loud."],["Protective","Let's keep the details on this one between us."],["Gentle but relentless","Nobody drifts. Let's get a note out today, not next week."],["Never transactional","Less “just following up”, more “thinking of you after our last call”."]],
    channel: "Talks about client care in general and anything the channel already discussed. Never names a client's private situation.",
    dm: "Anything about a specific client's records, health or history.",
    publicPart: "In general: a short, personal note lands better than a check-in form.",
    never: ["Discuss a client's records, health or payments in a channel","Message a client without an approval card","Label a client “at risk” in front of the team","Guess how a client feels and present it as fact"],
    glance: ["The client as a person","Protects privacy first","A warm next touch"],
  },
  mentor: {
    name: "MENTOR",
    role: "Discovery & strategy: learning, new directions & the next move",
    short: "Discovery & strategy",
    intro: "I'm MENTOR. Ask me anything, one idea at a time.",
    summary: "Helps people think: runs discovery on a new direction, explains a concept, gets a new teammate up to speed, and points at the next useful move.",
    examples: [["Consultant","Deciding between packaging an offer as a retainer or a project."],["Agency","Walking a new hire through how the agency scopes work."],["Coach","Pressure-testing whether a group program fits the business they want."]],
    traits: [["Teacherly, one idea at a time","One thing worth knowing first: retainers sell access, projects sell outcomes."],["Asks the one question that matters","Which do you want more of: predictable months or bigger wins?"],["Patient, never a lecture","No such thing as a basic question here. Let's take it from the top."],["Frames the why","Whoever owns the kickoff owns the client's first impression."],["Ends on a next step","Try it on one client this month and see what breaks."]],
    channel: "The natural home. Concepts, frameworks and discovery questions are safe to share, so MENTOR teaches the room.",
    dm: "Anything that draws on the asker's own records or plans.",
    publicPart: "The general idea, for everyone: decide what you want more of before you price it.",
    never: ["Lecture, or stack five ideas at once","Give legal, tax or investment advice as if licensed","Make a strategic call for the owner. MENTOR recommends; the owner decides.","Claim to save anything from Team Hub to the knowledge base"],
    glance: ["“One thing worth knowing”","One idea plus one question","A small experiment"],
  },
  merit: {
    name: "MERIT",
    role: "Sales & getting paid: deals, proposals & agreements",
    short: "Sales & getting paid",
    intro: "I'm MERIT. I turn interest into signed work and make sure it gets paid.",
    summary: "Turns interest into signed work and makes sure the work gets paid for: the next step on a deal, the proposal, the agreement, and the friendly nudge on an unpaid invoice. Persuasive with respect; never pushes.",
    examples: [["Consultant","The proposal after a discovery call that went well."],["Agency","The renewal conversation with a client whose contract ends next month."],["Coach","Turning three warm leads into booked consults."]],
    traits: [["Commercial, crisp","Warm lead, clear pain, no next step yet. Let's fix the last part."],["Always names the next step","Next step: proposal to Hollis by Oct 30, call booked the week after."],["Relational, not pushy","Ask what success looks like for them in 90 days. Then price to that."],["Confident about terms","Half upfront is normal for this kind of work. Don't apologise for it."],["Closes the loop","Signed? Great. Next step's the kickoff. Want a task for it?"]],
    channel: "Deal strategy, proposal structure, and anything the channel already discussed about a deal.",
    dm: "Pipeline values, contact records, invoices and payment status.",
    publicPart: "The general play holds for everyone: name the next step and put a date on it.",
    never: ["Send a proposal, agreement or payment reminder without an approval card","Invent pricing, discounts or deadlines","Use pressure tactics or fake urgency","Post deal values, or who owes what, in a channel","Handle a client's money. Your own payment processor does that."],
    glance: ["The state of the deal","“Next step:” with a date","A handoff or a close"],
  },
  zion: {
    name: "ZION",
    role: "Operations & tasks: owners, due dates & automation",
    short: "Operations & tasks",
    intro: "I'm ZION. I keep the work moving and tell you exactly where it stands.",
    summary: "Keeps the work moving: who owns what, what's due, what's blocked, what can be automated, and what to recover when something didn't run. ZION calls something done only from the original record and its receipt.",
    examples: [["Consultant","The kickoff checklist for a new engagement."],["Agency","Rebalancing tasks when someone's out for a week."],["Coach","Turning a messy week into three priorities with owners and dates."]],
    traits: [["Practical, list-tight","Three things. Owner, task, due. Here they are."],["Precise about state","Drafted, not saved. Saved, not sent. I'll say which."],["Dry and steady","Nothing's on fire. Two things are smoking."],["Clears the path","Blocked on Lee's sign-off. Everything else can move."],["Honest about unknowns","I can't see capacity for next week, so I won't promise it."]],
    channel: "Plans with what's in the channel, and reports on assignments by title, owner and status.",
    dm: "Task details, calendars, and anything only the asker can see.",
    publicPart: "For the room: the launch plan holds.",
    never: ["Say “done” without the receipt","Assign or move work without an approval card","Post a status nobody asked for, beyond reports on its own assignments","Fill an unknown with a guess","Start an automation from a read-only review"],
    glance: ["“Three things.”","Owner, task, due","The exact state: drafted, saved, done"],
  },
};

export const agentName = (key: TeamHubAgentKey): string => TEAM_HUB_AGENT_PROFILES[key].name;

const BY_NAME: ReadonlyMap<string, TeamHubAgentKey> = new Map(TEAM_HUB_AGENT_KEYS.map((key) => [TEAM_HUB_AGENT_PROFILES[key].name, key]));
const NAMES = TEAM_HUB_AGENT_KEYS.map((key) => TEAM_HUB_AGENT_PROFILES[key].name).join("|");
/** `@VERA`, in capitals, as a whole word, not inside an email address or another word. */
const agentToken = () => new RegExp(`(^|[^\\p{L}\\p{N}_@.])@(${NAMES})(?![\\p{L}\\p{N}_])`, "gu");

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The agents a draft asks, in the order first written. A person's `@label` picked from the @ list is
 * taken out first, so a teammate's name never reads as an agent's.
 */
export function agentMentionsIn(body: string, personLabels: readonly string[] = []): TeamHubAgentKey[] {
  let text = body;
  for (const label of [...personLabels].sort((a, b) => b.length - a.length)) text = text.split(`@${label}`).join(" ");
  const found: TeamHubAgentKey[] = [];
  for (const match of text.matchAll(agentToken())) {
    const key = BY_NAME.get(match[2]);
    if (key && !found.includes(key)) found.push(key);
  }
  return found;
}

export type AgentRun = { text: string; agent?: TeamHubAgentKey };

/**
 * Split text into plain runs and agent chips. `allowed` is the agents this text may show as chips: a
 * person's message shows only the agents it stored as asked; an agent's own text may name any of the
 * seven (shown as chips, never stored as a mention, so nothing is asked by it).
 */
export function agentRuns(text: string, allowed: ReadonlySet<TeamHubAgentKey> | "all"): AgentRun[] {
  const runs: AgentRun[] = [];
  let last = 0;
  for (const match of text.matchAll(agentToken())) {
    const key = BY_NAME.get(match[2]);
    if (!key || (allowed !== "all" && !allowed.has(key))) continue;
    const start = (match.index ?? 0) + match[1].length;
    if (start > last) runs.push({ text: text.slice(last, start) });
    runs.push({ text: `@${match[2]}`, agent: key });
    last = start + match[2].length + 1;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text }];
}

/** An agent's body: its own words, and whether the post door appended the fixed private-part line. */
export function splitPrivateLine(body: string): { text: string; privatePart: boolean } {
  const trimmed = body.trimEnd();
  if (!trimmed.endsWith(FIXED_PRIVATE_LINE)) return { text: body, privatePart: false };
  return { text: trimmed.slice(0, trimmed.length - FIXED_PRIVATE_LINE.length).trimEnd(), privatePart: true };
}

export interface BringIn { agent: TeamHubAgentKey; prefill: string }
/** One stored suggestion. `context` is the line its button writes; only the person who asked receives it. */
export interface BringInSuggestion { agent: TeamHubAgentKey; context: string | null }

/**
 * Flow 3: the agents the replying agent suggested bringing in, for the person who asked. The server
 * stores them with the reply's turn (`bring_in`, from the agent's structured answer); the reply's text
 * is never searched for mentions. The replying agent itself and agents the question already asked are
 * left out. Each prefill is exactly the approved form: the mention, then the stored line
 * ("@NEXUS PAIGE suggested you take the workshop announcement."). Nothing is sent: the person sends it.
 */
export function bringInSuggestions(reply: Pick<TeamHubMessage, "agent_key">, stored: readonly BringInSuggestion[], alreadyAsked: readonly TeamHubAgentKey[] = []): BringIn[] {
  const author = reply.agent_key ?? null;
  const from = author ? agentName(author) : "PAIGE";
  const out: BringIn[] = [];
  for (const item of stored) {
    if (item.agent === author || alreadyAsked.includes(item.agent) || out.some((x) => x.agent === item.agent)) continue;
    out.push({ agent: item.agent, prefill: `@${agentName(item.agent)} ${item.context ?? `${from} suggested you take this.`}` });
  }
  return out;
}

/** A stored suggestion list, checked: at most three distinct agents of the seven; a context is one short line. */
export function parseBringIn(value: unknown, withContext: boolean): BringInSuggestion[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_AGENTS_PER_MESSAGE) return null;
  const out: BringInSuggestion[] = [];
  for (const item of value) {
    if (!isRow(item) || !isTeamHubAgentKey(item.agent) || out.some((x) => x.agent === item.agent)) return null;
    const context = item.context;
    if (withContext) {
      if (typeof context !== "string" || !context.trim() || context.length > 200 || /[\r\n]/.test(context)) return null;
      out.push({ agent: item.agent, context: context.trim() });
    } else {
      if (context !== undefined) return null;
      out.push({ agent: item.agent, context: null });
    }
  }
  return out;
}

// ── The agent turn (`paige-ai-chat`, `{ teamHubAgentTurn }`; HANDOFF and contract flow 9) ──

export const AGENT_TURN_OUTCOMES = ["posted", "in_flight", "conversations_off", "not_visible", "rate_limited",
  "could_not_start", "no_reply", "cannot_post_here", "unconfirmed"] as const;
export type AgentTurnOutcome = typeof AGENT_TURN_OUTCOMES[number];

export interface AgentTurnRequest {
  conversationId: string;
  sourceMessageId: string;
  threadRootId: string | null;
  agent: TeamHubAgentKey;
  /** Flow 5's DM turn only. */
  privateFollowUp?: true;
}

export type AgentTurnAnswer =
  | { outcome: "posted"; message: TeamHubMessage; conversationId: string; duplicate: boolean;
    /** The agents this reply suggests bringing in (flow 3), with the lines their buttons write. */
    bringIn: BringInSuggestion[];
    /** The reply has a private part: its DM turn must start now. `dmId` is null until that turn opens the DM. */
    privateFollowUp: { dmId: string | null } | null }
  | { outcome: Exclude<AgentTurnOutcome, "posted"> };

const isRow = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/**
 * The server's answer, checked before anything is shown. A transport error or a non-2xx answer (401,
 * 429, 500, 503 from the chat itself, or a 400) did not start a turn: `could_not_start`. A 200 that is
 * not one of the documented shapes is `unconfirmed` — a reply may have posted, so the screen offers
 * Check again (the same request reads it back) and never claims it posted.
 */
export function parseAgentTurn(data: unknown, error: unknown, request: AgentTurnRequest): AgentTurnAnswer {
  if (error) return { outcome: "could_not_start" };
  if (!isRow(data) || typeof data.outcome !== "string" || !(AGENT_TURN_OUTCOMES as readonly string[]).includes(data.outcome)) return { outcome: "unconfirmed" };
  if (data.agent !== undefined && data.agent !== null && data.agent !== request.agent) return { outcome: "unconfirmed" };
  const outcome = data.outcome as AgentTurnOutcome;
  if (outcome !== "posted") return data.ok === false ? { outcome } : { outcome: "unconfirmed" };
  const message = parseTeamHubMessage(data.message);
  if (data.ok !== true || !message || message.author_kind !== "agent" || message.agent_key !== request.agent || !isText(data.conversation_id)) {
    return { outcome: "unconfirmed" };
  }
  let privateFollowUp: { dmId: string | null } | null = null;
  if (data.private_followup !== undefined && data.private_followup !== null) {
    const follow = data.private_followup;
    // Only a reply turn in a shared conversation has a private part, and it names this same question.
    if (!isRow(follow) || request.privateFollowUp || follow.sourceMessageId !== request.sourceMessageId || follow.agent !== request.agent
      || !(follow.dm_conversation_id === null || isText(follow.dm_conversation_id))) return { outcome: "unconfirmed" };
    privateFollowUp = { dmId: typeof follow.dm_conversation_id === "string" ? follow.dm_conversation_id : null };
  }
  const bringIn = parseBringIn(data.bring_in, true);
  if (!bringIn) return { outcome: "unconfirmed" };
  // A2b: the answer may say `card: { message_id } | null`. It is not read here, and never makes a reply
  // unconfirmed: the reply was read back, so it posted. The card itself, and who may act on it, come only
  // from `team_hub_card_states`, which the screen reads as soon as the reply is in place.
  return { outcome: "posted", message, conversationId: data.conversation_id, duplicate: data.duplicate === true, privateFollowUp, bringIn };
}

/** The exact request body: the five keys and nothing else (the server answers 400 to anything more). */
export function agentTurnBody(request: AgentTurnRequest): { teamHubAgentTurn: AgentTurnRequest } {
  return { teamHubAgentTurn: {
    conversationId: request.conversationId,
    sourceMessageId: request.sourceMessageId,
    threadRootId: request.threadRootId,
    agent: request.agent,
    ...(request.privateFollowUp ? { privateFollowUp: true as const } : {}),
  } };
}

/**
 * Outcomes the screen adds to the server's: `unknown` (after a reload the turn's state could not be
 * read, so it may still be running) and `other_workspace` (the person is working in another workspace
 * now, so the turn ran against a conversation that is not in it).
 */
export type AgentLineOutcome = Exclude<AgentTurnOutcome, "posted" | "in_flight"> | "unknown" | "other_workspace";

/**
 * What the asker is told when a turn ends without a reply (flow 9), and the one recovery it offers.
 * The recovery is said once, by its button: the line never repeats "Ask again" or "Check again".
 */
export function agentOutcomeLine(outcome: AgentLineOutcome, agent: TeamHubAgentKey, privatePart = false): { text: string; action: "ask_again" | "check_again" | null } {
  const name = agentName(agent);
  switch (outcome) {
    case "conversations_off": return { text: refusalMessage("conversations_off", "send"), action: null };
    case "not_visible": return { text: `${name} couldn't reply: you can't see this conversation any more.`, action: null };
    case "other_workspace": return { text: `${name} couldn't reply: you're working in another workspace now.`, action: null };
    case "rate_limited": return { text: "You've reached 30 agent replies this hour. Try again later.", action: null };
    case "could_not_start": return { text: privatePart ? `${name} couldn't finish your private answer.` : `${name} couldn't start just now.`, action: "ask_again" };
    case "no_reply": return { text: privatePart ? `${name} couldn't finish your private answer.` : `${name} didn't reply.`, action: "ask_again" };
    case "cannot_post_here": return { text: `${name} can't post here.`, action: null };
    case "unconfirmed": return { text: `${name}'s reply may not have posted.`, action: "check_again" };
    case "unknown": return { text: privatePart ? `${name} may still be writing your private answer.` : `${name} may still be replying.`, action: "check_again" };
  }
}

// ── The member-safe turn-state read (`team_hub_agent_turn_states`, 20271119010008) ──

export const TURN_STATES = ["answering", "replied", "replied_privately", "failed", "none"] as const;
export type TurnStateValue = typeof TURN_STATES[number];
/**
 * What the server says about one (question, agent). The person who asked reads every state of their own
 * question; everyone else reads only the private part's two lines (`answering` / `replied_privately`
 * with `privatePart`) and who a reply suggested bringing in (no context).
 */
export interface ServerTurnState { state: TurnStateValue; privatePart: boolean; askerName: string; bringIn: BringInSuggestion[] }

/** The read's answer, checked; a malformed row is dropped, never guessed. `null` when the read failed. */
export function parseTurnStates(data: unknown, error: unknown): Record<string, ServerTurnState> | null {
  if (error || !isRow(data) || data.ok !== true || !Array.isArray(data.states)) return null;
  const out: Record<string, ServerTurnState> = {};
  for (const row of data.states) {
    if (!isRow(row) || !isText(row.message_id) || !isTeamHubAgentKey(row.agent_key) || typeof row.state !== "string"
      || !(TURN_STATES as readonly string[]).includes(row.state) || typeof row.private_part !== "boolean" || typeof row.asker_name !== "string") continue;
    const bringIn = parseBringIn(row.bring_in, Array.isArray(row.bring_in) && row.bring_in.some((item) => isRow(item) && "context" in item));
    if (!bringIn) continue;
    out[`${row.message_id}:${row.agent_key}`] = { state: row.state as TurnStateValue, privatePart: row.private_part, askerName: row.asker_name, bringIn };
  }
  return out;
}

/** Questions to read the state of: a person's messages that ask agents (any message, in an agent DM). Newest 100. */
export function askingMessageIds(messages: readonly TeamHubMessage[], agentDm: boolean): string[] {
  return messages.filter((m) => m.author_kind !== "agent" && (agentDm || (m.agent_mentions?.length ?? 0) > 0))
    .map((m) => m.id).slice(-100);
}

/** Whether an agent message answers this person's question for this agent (top level or in its thread). */
export function answers(message: Pick<TeamHubMessage, "author_kind" | "agent_key" | "asked_in_message_id">, questionId: string, agent: TeamHubAgentKey): boolean {
  return message.author_kind === "agent" && message.agent_key === agent && message.asked_in_message_id === questionId;
}

// ── A2b: Team Hub cards (`team_hub_card_states`, and `{ teamHubCardAct }` through `paige-ai-chat`) ──

/**
 * The line an agent ends with when an act is asked of it in a shared conversation (a channel, or a DM
 * between people): the suggestion stays in the room, and the card is made in the asker's DM with that
 * agent. The server writes it (decision D7). The screen keys the asker's Open DM on it, so it survives a
 * reload with nothing stored for it.
 */
/**
 * A2b (owner ruling 2026-10-28): what "Open DM with ZION" puts in the DM's message box after a channel
 * redirect, so the asker doesn't type the request twice. The asker's own words, with that agent's
 * mention taken out (the DM is already with them); nothing is sent until they press Send. Null when
 * nothing would be left.
 */
export function dmRequestPrefill(body: string, agent: TeamHubAgentKey): string | null {
  const name = TEAM_HUB_AGENT_PROFILES[agent].name;
  const text = body.replace(agentToken(), (match, lead: string, found: string) => found === name ? lead : match)
    .replace(/[ \t]{2,}/g, " ").replace(/^[\s,:;–—-]+/, "").trim();
  if (!text) return null;
  // The mention opened the sentence, so what follows it now does: capitalise it.
  const led = body.trimStart().startsWith(`@${name}`);
  return led ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

export const REDIRECT_LINE = "I can do that with you in our DM.";
export function endsWithRedirect(body: string): boolean {
  return body.trimEnd().endsWith(REDIRECT_LINE);
}

/** The kind line on a card's strip, from the server's kind key (A2b's three, hand-listed). */
export const CARD_KIND_LABEL: Readonly<Record<string, string>> = {
  task_handover: "Task hand-over",
  task_cancel: "Task cancel",
  page_publish: "Page publish",
};

/** What the act produced, by reference only (never its contents): where it lives, and its id. */
export interface CardRecord { destination: string; recordId: string }

/** One card as the member-safe read says it stands, in the shape the approved card draws. */
export interface CardRead {
  approval: TeamHubApproval;
  /** The agent's outcome message in the card's thread, once it is posted. */
  outcomeMessageId: string | null;
  record: CardRecord | null;
  /** When the proposal stops being approvable. Each door sets its own (decision D12). */
  expiresAt: string | null;
}

/** The states the A2b read derives. `standing` is A2c's, so a read that says it is not one this build knows. */
const CARD_STATES = ["waiting", "working", "done", "failed", "unconfirmed", "declined", "expired"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isInstant = (value: unknown): value is string => isText(value) && !Number.isNaN(Date.parse(value));

/** The expiry, said as a time on the card's one action while it waits (to everyone). Never a duration. */
export function cardExpiryNote(expiresAt: string): string {
  const at = new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `Expires at ${at}.`;
}

/**
 * The failed card's reason, said as the sentence the approved card draws (A2b review fix 1). The server
 * keeps its reason as a clause so its outcome line can read "That didn't run: <reason>. Nothing was
 * changed."; on the card it stands alone, so it starts with a capital and ends with a full stop. A
 * reason that is already a sentence is left as it is.
 */
export function cardReasonSentence(reason: string): string {
  const text = reason.trim();
  if (!text) return text;
  const first = text.charAt(0).toLocaleUpperCase() + text.slice(1);
  return /[.!?\u2026]["\u201d\u2019]?$/.test(first) ? first : `${first}.`;
}

function parseCardRecord(value: unknown): CardRecord | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRow(value) || Object.keys(value).some((key) => key !== "destination" && key !== "record_id")) return undefined;
  if (typeof value.destination !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value.destination)
    || typeof value.record_id !== "string" || !UUID.test(value.record_id)) return undefined;
  return { destination: value.destination, recordId: value.record_id };
}

/**
 * One server card (`{ state, kind, actions, asker_user_id, decided_by_name, decided_at, expires_at }`)
 * mapped into the approval the card draws, or null when it is not whole. The binding is kept only where
 * the read may give it (the asker, while the card waits); a state or kind this build does not know is
 * dropped, never guessed at.
 */
function parseServerCard(card: unknown, outcomeMessageId: unknown, record: unknown): CardRead | null {
  if (!isRow(card) || typeof card.state !== "string" || !(CARD_STATES as readonly string[]).includes(card.state)) return null;
  const kind = typeof card.kind === "string" ? CARD_KIND_LABEL[card.kind] : undefined;
  if (!kind || !Array.isArray(card.actions)) return null;
  const expiresAt = card.expires_at === undefined || card.expires_at === null ? null : isInstant(card.expires_at) ? card.expires_at : undefined;
  if (expiresAt === undefined) return null;
  if (!(outcomeMessageId === undefined || outcomeMessageId === null || isText(outcomeMessageId))) return null;
  const parsedRecord = parseCardRecord(record);
  if (parsedRecord === undefined) return null;
  const waiting = card.state === "waiting";
  // A done or failed card carries the server's outcome note (what now exists, or why it didn't run); the
  // approved card puts it in the summary's place on done and as the reason on failed. Never on another state.
  const settled = card.state === "done" || card.state === "failed";
  const actions = card.actions.map((item) => isRow(item) ? {
    summary: item.summary,
    ...(waiting && isText(item.fingerprint) ? { fingerprint: item.fingerprint } : {}),
    ...(waiting && expiresAt ? { note: cardExpiryNote(expiresAt) }
      : settled && isText(item.note) ? { note: card.state === "failed" ? cardReasonSentence(item.note) : item.note } : {}),
  } : item);
  const approval = parseApproval({ state: card.state, kind, actions, asker_user_id: card.asker_user_id,
    decided_by_name: card.decided_by_name, decided_at: card.decided_at });
  if (!approval) return null;
  return { approval, outcomeMessageId: isText(outcomeMessageId) ? outcomeMessageId : null, record: parsedRecord, expiresAt };
}

/** The read's answer by message id, checked; a malformed row is dropped. `null` when the read failed. */
export function parseCardStates(data: unknown, error: unknown): Record<string, CardRead> | null {
  if (error || !isRow(data) || data.ok !== true || !Array.isArray(data.cards)) return null;
  const out: Record<string, CardRead> = {};
  for (const row of data.cards) {
    if (!isRow(row) || !isText(row.message_id)) continue;
    const card = parseServerCard(row.card, row.outcome_message_id, row.record);
    if (card) out[row.message_id] = card;
  }
  return out;
}

/** The agent messages whose cards to read: in an agent DM only (A2b makes cards nowhere else). Newest 100. */
export function cardMessageIds(messages: readonly TeamHubMessage[]): string[] {
  return messages.filter((m) => m.author_kind === "agent").map((m) => m.id).slice(-100);
}

export interface CardActRequest { conversationId: string; messageId: string; act: "approve" | "decline"; fingerprint: string }

/** The exact request body: the four keys and nothing else. */
export function cardActBody(request: CardActRequest): { teamHubCardAct: CardActRequest } {
  return { teamHubCardAct: { conversationId: request.conversationId, messageId: request.messageId, act: request.act, fingerprint: request.fingerprint } };
}

export const CARD_ACT_OUTCOMES = ["done", "failed", "unconfirmed", "declined", "expired", "already_decided", "not_yours",
  "not_visible", "conversations_off", "could_not_start"] as const;
export type CardActOutcome = typeof CARD_ACT_OUTCOMES[number];

/**
 * The card act's answer, checked. `no_answer` is a transport error, a non-2xx answer or a 200 that is
 * not the documented shape: the act may or may not have happened, so the screen re-reads the card and
 * never says it ran. `card` is the card as it now stands, when the server sent it.
 */
export type CardActAnswer =
  | { outcome: CardActOutcome; card: CardRead | null; outcomeMessage: TeamHubMessage | null }
  | { outcome: "no_answer" };

/**
 * What the hub announces after Approve or Not now, by outcome (verifier fix 5): the card shows the state, and
 * this says it in words through the hub's one live region, so a turned-down click is never silent. A closed
 * set, the screen's own; null where the card and its outcome message already say it (done, failed,
 * couldn't confirm, Not now), so the same thing is not said twice.
 */
export function cardActLine(outcome: CardActOutcome | "no_answer"): string | null {
  switch (outcome) {
    case "not_yours": return "Only the person who asked can approve this card.";
    case "not_visible": return "That card isn't available to you any more. Nothing was changed.";
    case "already_decided": return "That card was already decided. It shows what happened.";
    case "expired": return "That card ran out of time. Nothing was changed.";
    case "conversations_off": return "Team conversations are off for you, so this card can't be decided.";
    case "could_not_start": return "That didn't go through just now. Try again.";
    case "no_answer": return "I couldn't confirm that went through. The card shows what's known now.";
    default: return null;
  }
}

export function parseCardAct(data: unknown, error: unknown, request: CardActRequest): CardActAnswer {
  if (error || !isRow(data) || typeof data.ok !== "boolean" || typeof data.outcome !== "string"
    || !(CARD_ACT_OUTCOMES as readonly string[]).includes(data.outcome)) return { outcome: "no_answer" };
  const outcome = data.outcome as CardActOutcome;
  let card: CardRead | null = null;
  if (data.card !== undefined && data.card !== null) {
    // The card itself, or its whole state row; a row must name this card.
    const row = isRow(data.card) && "card" in data.card ? data.card : null;
    if (row && row.message_id !== request.messageId) return { outcome: "no_answer" };
    card = row ? parseServerCard(row.card, row.outcome_message_id, row.record) : parseServerCard(data.card, undefined, undefined);
    if (!card) return { outcome: "no_answer" };
  }
  let outcomeMessage: TeamHubMessage | null = null;
  if (data.outcome_message !== undefined && data.outcome_message !== null) {
    outcomeMessage = parseTeamHubMessage(data.outcome_message);
    if (!outcomeMessage || outcomeMessage.author_kind !== "agent") return { outcome: "no_answer" };
  }
  return { outcome, card, outcomeMessage };
}

export { isTeamHubAgentKey };
