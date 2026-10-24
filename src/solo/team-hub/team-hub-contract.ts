/**
 * EXP08 Team Hub, increment 1 — the response contract the workspace trusts.
 *
 * Every `team_hub_*` function answers `{ ok: true, … }` or `{ ok: false, code }`
 * (docs/delivery/exp08-team-hub-collaboration-contract.md §4). Anything else — a
 * transport error, a missing field, a value of the wrong type, another workspace's
 * id — is `unavailable`. The UI renders only what one of these parsers returned, so
 * a malformed row can never be shown as a person, a message or a count.
 *
 * Pure functions only: no React, no Supabase. The hook owns the calls.
 */

export const TEAM_HUB_REFUSALS = [
  "not_member",
  // Not a canonical SOLO workspace (amendment A1). Agency and Sub-account are held.
  "unavailable",
  "scope_changed",
  "not_found",
  "invalid",
  "name_taken",
  "not_allowed",
  "too_long",
] as const;
export type TeamHubRefusal = typeof TEAM_HUB_REFUSALS[number];

/**
 * `refused` carries a documented code — including the server's own `unavailable` (A1). The
 * `unavailable` KIND is different: no usable answer arrived (transport error, malformed row).
 */
export type TeamHubResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "refused"; code: TeamHubRefusal }
  | { kind: "unavailable" };

export type TeamHubPermission = "owner" | "admin" | "member";

export interface TeamHubPerson {
  user_id: string;
  display_name: string;
  title: string | null;
  permission: TeamHubPermission;
}

export interface TeamHubConversation {
  id: string;
  kind: "channel" | "dm";
  name: string | null;
  visibility: "team" | "private";
  joined: boolean;
  /** Private channels and DMs only: the members still active in the workspace (A4). */
  member_count: number | null;
  member_ids: string[] | null;
  dm_user_id: string | null;
  unread: number;
  last_message_at: string | null;
}

export interface TeamHubOverview {
  tenant_id: string;
  me: { user_id: string };
  people: TeamHubPerson[];
  conversations: TeamHubConversation[];
}

export interface TeamHubMessage {
  id: string;
  author_user_id: string;
  body: string;
  created_at: string;
  parent_message_id: string | null;
  reply_count: number;
  last_reply_at: string | null;
  mentions: string[];
}

export interface TeamHubChannelSummary {
  id: string;
  kind: "channel" | "dm";
  name: string | null;
  visibility: "team" | "private";
  joined: boolean;
}

export interface TeamHubMessagePage {
  channel: TeamHubChannelSummary;
  messages: TeamHubMessage[];
  has_more: boolean;
}

/** Thread mode (A7): the root, and its replies newest-first under the same compound cursor. */
export interface TeamHubThreadPage {
  channel: TeamHubChannelSummary;
  root: TeamHubMessage;
  replies: TeamHubMessage[];
  has_more: boolean;
}

export interface TeamHubPosted {
  message: TeamHubMessage;
  duplicate: boolean;
}

export const TEAM_HUB_UNAVAILABLE_TITLE = "Team Hub isn't available for this account type yet.";

/** Same rule the server enforces (`^[a-z0-9][a-z0-9-]{1,29}$`), applied after lower/trim. */
export const CHANNEL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,29}$/;
export const MESSAGE_MAX_LENGTH = 8000;

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isNullableText = (value: unknown): value is string | null => value === null || isText(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const isInstant = (value: unknown): value is string => isText(value) && !Number.isNaN(Date.parse(value));
const isNullableInstant = (value: unknown): value is string | null => value === null || isInstant(value);
const isKind = (value: unknown): value is "channel" | "dm" => value === "channel" || value === "dm";
const isVisibility = (value: unknown): value is "team" | "private" => value === "team" || value === "private";

function isRefusal(value: unknown): value is TeamHubRefusal {
  return typeof value === "string" && (TEAM_HUB_REFUSALS as readonly string[]).includes(value);
}

/**
 * Split an RPC answer into ok / refused / unavailable before any field is read.
 * `ok` must be literally `true`; a refusal must carry one of the documented codes.
 */
function envelope(data: unknown, error: unknown): TeamHubResult<Row> {
  if (error || !isRow(data)) return { kind: "unavailable" };
  if (data.ok === true) return { kind: "ok", value: data };
  if (data.ok === false && isRefusal(data.code)) return { kind: "refused", code: data.code };
  return { kind: "unavailable" };
}

function parsePerson(value: unknown): TeamHubPerson | null {
  if (!isRow(value) || !isText(value.user_id) || !isText(value.display_name)) return null;
  if (!(value.title === null || value.title === undefined || typeof value.title === "string")) return null;
  if (value.permission !== "owner" && value.permission !== "admin" && value.permission !== "member") return null;
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : null;
  return { user_id: value.user_id, display_name: value.display_name.trim() || value.display_name, title, permission: value.permission };
}

function parseConversation(value: unknown): TeamHubConversation | null {
  if (!isRow(value) || !isText(value.id) || !isKind(value.kind) || !isVisibility(value.visibility)) return null;
  if (typeof value.joined !== "boolean" || !isCount(value.unread) || !isNullableInstant(value.last_message_at)) return null;
  if (!isNullableText(value.name) || !isNullableText(value.dm_user_id)) return null;
  // The storage rules: a channel is named, a DM is private, unnamed and names its other person.
  if (value.kind === "channel" && !value.name) return null;
  if (value.kind === "dm" && (value.visibility !== "private" || !value.dm_user_id)) return null;
  // A private channel or DM always says who is in it; a team channel never does (A4).
  let memberIds: string[] | null = null;
  if (value.visibility === "private") {
    if (!isCount(value.member_count) || !Array.isArray(value.member_ids) || !value.member_ids.every(isText)) return null;
    memberIds = [...new Set(value.member_ids as string[])];
  } else if ((value.member_count ?? null) !== null || (value.member_ids ?? null) !== null) {
    return null;
  }
  return {
    id: value.id,
    kind: value.kind,
    name: value.kind === "channel" ? value.name : null,
    visibility: value.visibility,
    joined: value.joined,
    member_count: value.visibility === "private" ? value.member_count as number : null,
    member_ids: memberIds,
    dm_user_id: value.kind === "dm" ? value.dm_user_id : null,
    unread: value.unread,
    last_message_at: value.last_message_at,
  };
}

function parseMessage(value: unknown): TeamHubMessage | null {
  if (!isRow(value) || !isText(value.id) || !isText(value.author_user_id)) return null;
  if (typeof value.body !== "string" || !isInstant(value.created_at)) return null;
  if (!isNullableText(value.parent_message_id) || !isCount(value.reply_count)) return null;
  if (!isNullableInstant(value.last_reply_at)) return null;
  if (!Array.isArray(value.mentions) || !value.mentions.every(isText)) return null;
  return {
    id: value.id,
    author_user_id: value.author_user_id,
    body: value.body,
    created_at: value.created_at,
    parent_message_id: value.parent_message_id,
    reply_count: value.reply_count,
    last_reply_at: value.last_reply_at,
    mentions: [...new Set(value.mentions as string[])],
  };
}

function parseChannelSummary(value: unknown): TeamHubChannelSummary | null {
  if (!isRow(value) || !isText(value.id) || !isKind(value.kind) || !isVisibility(value.visibility)) return null;
  if (typeof value.joined !== "boolean" || !isNullableText(value.name)) return null;
  if (value.kind === "channel" && !value.name) return null;
  return { id: value.id, kind: value.kind, name: value.kind === "channel" ? value.name : null, visibility: value.visibility, joined: value.joined };
}

/** Every element must parse; one bad row makes the whole answer unavailable rather than partial. */
function parseAll<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: T[] = [];
  for (const item of value) {
    const next = parse(item);
    if (!next) return null;
    parsed.push(next);
  }
  return parsed;
}

export function parseConversationList(data: unknown, error: unknown, expectedTenant: string): TeamHubResult<TeamHubOverview> {
  const answer = envelope(data, error);
  if (answer.kind !== "ok") return answer;
  const row = answer.value;
  // A list for any workspace other than the one asked for is never shown.
  if (row.tenant_id !== expectedTenant || !isRow(row.me) || !isText(row.me.user_id)) return { kind: "unavailable" };
  const people = parseAll(row.people, parsePerson);
  const conversations = parseAll(row.conversations, parseConversation);
  if (!people || !conversations) return { kind: "unavailable" };
  return { kind: "ok", value: { tenant_id: expectedTenant, me: { user_id: row.me.user_id }, people, conversations } };
}

export function parseChannelId(data: unknown, error: unknown): TeamHubResult<string> {
  const answer = envelope(data, error);
  if (answer.kind !== "ok") return answer;
  return isText(answer.value.channel_id) ? { kind: "ok", value: answer.value.channel_id } : { kind: "unavailable" };
}

export function parseAdded(data: unknown, error: unknown): TeamHubResult<number> {
  const answer = envelope(data, error);
  if (answer.kind !== "ok") return answer;
  return isCount(answer.value.added) ? { kind: "ok", value: answer.value.added } : { kind: "unavailable" };
}

/** Join, leave and mark-read answer a bare `{ ok: true }`. */
export function parseAcknowledged(data: unknown, error: unknown): TeamHubResult<true> {
  const answer = envelope(data, error);
  return answer.kind === "ok" ? { kind: "ok", value: true } : answer;
}

export function parseMessagePage(data: unknown, error: unknown, channelId: string): TeamHubResult<TeamHubMessagePage> {
  const answer = envelope(data, error);
  if (answer.kind !== "ok") return answer;
  const channel = parseChannelSummary(answer.value.channel);
  const messages = parseAll(answer.value.messages, parseMessage);
  if (!channel || channel.id !== channelId || !messages || typeof answer.value.has_more !== "boolean") return { kind: "unavailable" };
  return { kind: "ok", value: { channel, messages, has_more: answer.value.has_more } };
}

export function parseThreadPage(data: unknown, error: unknown, channelId: string, rootId: string): TeamHubResult<TeamHubThreadPage> {
  const answer = envelope(data, error);
  if (answer.kind !== "ok") return answer;
  const channel = parseChannelSummary(answer.value.channel);
  const root = parseMessage(answer.value.root);
  const replies = parseAll(answer.value.messages, parseMessage);
  if (!channel || channel.id !== channelId || !root || root.id !== rootId || root.parent_message_id !== null) return { kind: "unavailable" };
  // Every reply must belong to the root that was asked for; one stray row rejects the page.
  if (!replies || replies.some((reply) => reply.parent_message_id !== rootId) || typeof answer.value.has_more !== "boolean") return { kind: "unavailable" };
  return { kind: "ok", value: { channel, root, replies, has_more: answer.value.has_more } };
}

export function parsePosted(data: unknown, error: unknown): TeamHubResult<TeamHubPosted> {
  const answer = envelope(data, error);
  if (answer.kind !== "ok") return answer;
  const message = parseMessage(answer.value.message);
  if (!message) return { kind: "unavailable" };
  return { kind: "ok", value: { message, duplicate: answer.value.duplicate === true } };
}

/** The server lower-cases and trims; the form also turns typed spaces into dashes as you type. */
export function normalizeChannelName(input: string): string {
  return input.toLowerCase().replace(/\s+/g, "-").trim();
}

export function channelNameProblem(name: string): string | null {
  if (!name) return null;
  return CHANNEL_NAME_PATTERN.test(name)
    ? null
    : "Use 2–30 lowercase letters, numbers or dashes, starting with a letter or number.";
}

export function bodyProblem(body: string): "empty" | "too_long" | null {
  const trimmed = body.trim();
  if (!trimmed) return "empty";
  return trimmed.length > MESSAGE_MAX_LENGTH ? "too_long" : null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

export function permissionLabel(permission: TeamHubPermission): string | null {
  return permission === "owner" ? "Owner" : permission === "admin" ? "Admin" : null;
}

/**
 * The words a person is mentioned by. A display name shared by two active people is told
 * apart by title (then by permission when titles are missing or equal), as the contract asks.
 */
export function mentionLabel(person: TeamHubPerson, people: TeamHubPerson[]): string {
  const namesakes = people.filter((other) => other.display_name === person.display_name);
  if (namesakes.length < 2) return person.display_name;
  const titleIsDistinct = person.title
    && namesakes.filter((other) => other.title === person.title).length === 1;
  if (titleIsDistinct) return `${person.display_name} (${person.title})`;
  const permission = permissionLabel(person.permission) ?? "Member";
  return person.title ? `${person.display_name} (${person.title}, ${permission})` : `${person.display_name} (${permission})`;
}

export function conversationLabel(conversation: TeamHubConversation, people: TeamHubPerson[]): string {
  if (conversation.kind === "channel") return conversation.name ?? "";
  const other = people.find((person) => person.user_id === conversation.dm_user_id);
  return other?.display_name ?? "Former teammate";
}

export type MentionScope = { kind: "everyone" } | { kind: "people"; ids: string[] };

/**
 * Who may be mentioned in a conversation, from what the contract actually returns.
 * A team channel is visible to every active person. A private channel or DM is visible to
 * its members, which `member_ids` lists (A4) — the server refuses anyone else (`invalid`).
 */
export function mentionScope(conversation: TeamHubConversation): MentionScope {
  return conversation.visibility === "team" ? { kind: "everyone" } : { kind: "people", ids: conversation.member_ids ?? [] };
}

export function mentionCandidates(scope: MentionScope, people: TeamHubPerson[], meId: string, query: string): TeamHubPerson[] {
  const needle = query.trim().toLowerCase();
  return people
    .filter((person) => person.user_id !== meId)
    .filter((person) => scope.kind === "everyone" || scope.ids.includes(person.user_id))
    .filter((person) => !needle || mentionLabel(person, people).toLowerCase().includes(needle))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export interface PickedMention { user_id: string; label: string }

/**
 * Turn a draft into the explicit mention ids it carries, or refuse it.
 * Only people picked from the @ list are mentioned, and only while their `@label` is still
 * in the text. A typed `@Name` that matches several active people and was not picked is
 * refused, so a message never reaches the wrong Sam.
 */
export function resolveMentions(
  body: string,
  picked: PickedMention[],
  people: TeamHubPerson[],
): { ok: true; ids: string[]; problem?: undefined } | { ok: false; problem: string; ids?: undefined } {
  const kept = picked.filter((mention) => body.includes(`@${mention.label}`));
  let remainder = body;
  for (const mention of [...kept].sort((a, b) => b.label.length - a.label.length)) {
    remainder = remainder.split(`@${mention.label}`).join(" ");
  }
  const ambiguous = [...new Set(people.map((person) => person.display_name))]
    .filter((name) => people.filter((person) => person.display_name === name).length > 1);
  for (const name of ambiguous) {
    if (new RegExp(`@${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "u").test(remainder)) {
      return { ok: false, problem: `More than one person is named ${name}. Pick the right one from the @ list.` };
    }
  }
  return { ok: true, ids: [...new Set(kept.map((mention) => mention.user_id))] };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split a body into plain text and highlighted mention runs, by the ids the server stored. */
export function mentionRuns(body: string, mentionIds: string[], people: TeamHubPerson[]): Array<{ text: string; mention: boolean }> {
  const labels = mentionIds
    .map((id) => people.find((person) => person.user_id === id))
    .filter((person): person is TeamHubPerson => Boolean(person))
    .flatMap((person) => [`@${mentionLabel(person, people)}`, `@${person.display_name}`])
    .sort((a, b) => b.length - a.length);
  if (!labels.length) return [{ text: body, mention: false }];
  const pattern = new RegExp(`(${[...new Set(labels)].map(escapeRegExp).join("|")})`, "g");
  return body.split(pattern).filter(Boolean).map((text) => ({ text, mention: labels.includes(text) }));
}

/**
 * Where the "new" divider goes: before the oldest of the `unread` most recent top-level
 * messages written by someone else — the same messages the server counted.
 */
export function newDividerBefore(messages: TeamHubMessage[], unread: number, meId: string): string | null {
  if (unread <= 0) return null;
  let seen = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].author_user_id === meId) continue;
    seen += 1;
    if (seen === unread) return messages[index].id;
  }
  return messages.find((message) => message.author_user_id !== meId)?.id ?? null;
}

export function dayKey(instant: string): string {
  const date = new Date(instant);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dayLabel(instant: string, now: Date = new Date()): string {
  const date = new Date(instant);
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function timeLabel(instant: string): string {
  return new Date(instant).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** The stream's order, the server's compound key (A6): `created_at`, then `id`. */
export function compareMessages(a: Pick<TeamHubMessage, "created_at" | "id">, b: Pick<TeamHubMessage, "created_at" | "id">): number {
  return Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);
}

/** Merge pages by id and keep the stream oldest → newest. */
export function mergeMessages(current: TeamHubMessage[], incoming: TeamHubMessage[]): TeamHubMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compareMessages);
}

/**
 * A refresh reads only the newest page. When that page says more exist (`has_more`) and even its
 * oldest message is newer than the newest one held, the messages in between were never read: the
 * held list can't be joined to the page without a silent hole, so the page replaces it.
 */
export function refreshLeavesGap(held: TeamHubMessage[], newestPage: TeamHubMessage[], pageHasMore: boolean): boolean {
  if (!pageHasMore || !newestPage.length) return false;
  const newestHeld = held[held.length - 1];
  if (!newestHeld) return true;
  const oldestOnPage = newestPage.reduce((oldest, message) => compareMessages(message, oldest) < 0 ? message : oldest);
  return compareMessages(oldestOnPage, newestHeld) > 0;
}

/**
 * How a refresh's newly arrived messages are announced: a count, never the text. After a gap the
 * page's count is a floor (older unread messages may sit above it), so it says "or more".
 */
export function incomingAnnouncement(messages: number, replies: number, messagesOrMore = false): string | null {
  const parts = [
    messages ? (messagesOrMore ? `${messages} or more new messages` : messages === 1 ? "1 new message" : `${messages} new messages`) : null,
    replies ? (replies === 1 ? "1 new reply in the thread" : `${replies} new replies in the thread`) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Plain words for a refusal, without saying why a conversation is hidden. `no_answer` is the
 * transport case (no usable answer arrived), kept apart from the server's own `unavailable`.
 */
export function refusalMessage(code: TeamHubRefusal | "no_answer", action: "send" | "create" | "dm" | "join" | "leave" | "add" | "read"): string {
  switch (code) {
    case "too_long":
      return `Messages can be up to ${MESSAGE_MAX_LENGTH.toLocaleString()} characters.`;
    case "name_taken":
      return "A channel already has that name. Pick another.";
    case "invalid":
      if (action === "send") return "Not sent. Everyone you mention must be on the team and able to see this conversation.";
      if (action === "create") return "Check the name and the people you added. Each must be an active teammate.";
      if (action === "add") return "Only active teammates can be added.";
      if (action === "dm") return "That person isn't an active teammate.";
      return "That request wasn't accepted.";
    case "not_allowed":
      return action === "leave" ? "Direct messages can't be left." : "That isn't allowed here.";
    case "not_found":
      return "This conversation isn't available to you.";
    case "not_member":
      return "You're no longer on this team.";
    case "scope_changed":
      return "Your workspace changed. Team Hub is reloading for the workspace you're in now.";
    case "unavailable":
      return TEAM_HUB_UNAVAILABLE_TITLE;
    default:
      return action === "send" ? "Not sent. Your message is kept here." : "Team Hub couldn't complete that. Try again.";
  }
}
