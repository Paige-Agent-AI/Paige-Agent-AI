/** Chat consumer of original Work/Research. No writer, provider or authority store lives here. */
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export interface ResearchWorkBinding {
  actorId: string; tenantId: string; threadId: string; intentId: string; workId: string;
}
type Reply = { data: unknown; error: unknown };
type TurnQuery = { eq(field: string, value: string): TurnQuery; maybeSingle(): PromiseLike<Reply> };
export interface ResearchCaller {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args?: ObjectValue): PromiseLike<Reply>;
  from(name: string): { select(fields: string): TurnQuery };
}

/** Identity and active-workspace checks bracket every awaited original-store read. */
export async function researchCallerCurrent(binding: Pick<ResearchWorkBinding, 'actorId' | 'tenantId'>,
  caller: ResearchCaller, current: () => boolean): Promise<boolean> {
  if (!current() || !uuid(binding.actorId) || !uuid(binding.tenantId)) return false;
  try {
    const identity = await caller.auth.getUser();
    if (!current() || identity.error || identity.data.user?.id !== binding.actorId) return false;
    const workspace = await caller.rpc('current_user_tenant_id');
    if (!current() || workspace.error || workspace.data !== binding.tenantId) return false;
    const after = await caller.auth.getUser();
    return current() && !after.error && after.data.user?.id === binding.actorId;
  } catch { return false; }
}

export type AcceptedResearchTurn = { id: string; content: string; bundle: ObjectValue };

export function originalResearchResumeRequest(raw: unknown): boolean {
  if (!object(raw) || Object.keys(raw).some(k => !['threadId', 'requestIntentId', 'messages', 'interactive', 'researchResume'].includes(k)) ||
    !uuid(raw.threadId) || !uuid(raw.requestIntentId) || !object(raw.researchResume) ||
    Object.keys(raw.researchResume).length !== 1 || !uuid(raw.researchResume.workId) ||
    !object(raw.interactive) || Object.keys(raw.interactive).length !== 1 || raw.interactive.kind !== 'message' ||
    !Array.isArray(raw.messages) || raw.messages.length !== 1 || !object(raw.messages[0])) return false;
  const message = raw.messages[0];
  return Object.keys(message).every(k => ['role', 'content'].includes(k)) &&
    message.role === 'user' && message.content === 'Resume original research';
}
/** An issued WAIT_WORK remains immutable. Never report an attempted FINAL as its saved receipt. */
export async function readAcceptedResearchTurn(binding: ResearchWorkBinding, caller: ResearchCaller,
  current: () => boolean): Promise<AcceptedResearchTurn | null> {
  if (![binding.threadId, binding.intentId, binding.workId].every(uuid) ||
    !await researchCallerCurrent(binding, caller, current)) return null;
  try {
    const response = await caller.from('paige_chat_turns')
      .select('id,role,content,bundle_ref,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state')
      .eq('thread_id', binding.threadId).eq('interactive_intent_id', binding.intentId)
      .eq('interactive_actor_id', binding.actorId).eq('interactive_tenant_id', binding.tenantId)
      .eq('interactive_terminal_state', 'WAIT_WORK').maybeSingle();
    if (!current() || response.error || !object(response.data)) return null;
    const row = response.data;
    if (!uuid(row.id) || row.role !== 'assistant' || typeof row.content !== 'string' ||
      row.interactive_intent_id !== binding.intentId || row.interactive_actor_id !== binding.actorId ||
      row.interactive_tenant_id !== binding.tenantId || row.interactive_terminal_state !== 'WAIT_WORK' ||
      !object(row.bundle_ref) || !object(row.bundle_ref.turn_state) || row.bundle_ref.turn_state.v !== 1 ||
      row.bundle_ref.turn_state.state !== 'WAIT_WORK' || !object(row.bundle_ref.interactive) ||
      row.bundle_ref.interactive.request_intent_id !== binding.intentId) return null;
    const effects = row.bundle_ref.interactive.effects;
    if (!Array.isArray(effects) || effects.length !== 1 || !object(effects[0]) ||
      effects[0].tool !== 'deep_research' || effects[0].outcome !== 'durable_accepted' ||
      effects[0].work_id !== binding.workId) return null;
    if (!await researchCallerCurrent(binding, caller, current)) return null;
    return { id: row.id, content: row.content, bundle: row.bundle_ref };
  } catch { return null; }
}

/** This contract is accepted only by the incumbent v1 native preparation and worker. */
export function originalResearchPayload(args: unknown): ObjectValue | null {
  if (!object(args) || typeof args.question !== 'string' || args.question.trim().length < 3 ||
    args.question.length > 6000 || Object.keys(args).some(k => !['question', 'domain', 'max_hops'].includes(k))) return null;
  const payload: ObjectValue = { version: 1, question: args.question, caller: 'chat' };
  if (args.domain !== undefined) {
    if (typeof args.domain !== 'string' || !args.domain.trim() || args.domain.length > 100) return null;
    payload.domain = args.domain;
  }
  if (args.max_hops !== undefined) {
    if (!Number.isInteger(args.max_hops) || Number(args.max_hops) < 1 || Number(args.max_hops) > 3) return null;
    payload.max_hops = args.max_hops;
  }
  return payload;
}

/** Mutation is explicit and separate from status. UNKNOWN always returns to same-ID inspection. */
export async function resumeOriginalResearch(binding: ResearchWorkBinding, ports: {
  caller: ResearchCaller; current(): boolean;
  invoke(body: ObjectValue): Promise<{ ok: boolean }>;
}): Promise<'inspect_original' | 'unavailable'> {
  if (!await readAcceptedResearchTurn(binding, ports.caller, ports.current)) return 'unavailable';
  if (!await researchCallerCurrent(binding, ports.caller, ports.current)) return 'unavailable';
  try {
    await ports.invoke({ user_id: binding.actorId, expected_tenant_id: binding.tenantId,
      caller: 'chat', persist: true, durable_work: { work_id: binding.workId,
        thread_id: binding.threadId, intent_id: binding.intentId, resume_only: true } });
    // A response is not completion. The original status/report/receipt readers decide that.
  } catch { /* Lost response: inspect the same original job; never invoke again here. */ }
  return await researchCallerCurrent(binding, ports.caller, ports.current) ? 'inspect_original' : 'unavailable';
}
