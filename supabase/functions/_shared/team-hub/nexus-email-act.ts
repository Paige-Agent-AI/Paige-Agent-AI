// Browser-only explicit handoff of a native private NEXUS preparation. No model
// tool can enter this route. Uses ORIGINAL email sender read, Save adapter,
// native operation and audit receipt. Check never retries a domain save.
import { emailProvidersFor, listCommsEmailSenders, resolveCommsEmailParties, type CommsEmailAdmin } from "../comms-email/readiness.ts";
import type { CommsEmailChatDependencies } from "../comms-email/chat.ts";
import { UUID } from "../comms-email/contract.ts";
import { createNexusEmailDraftSaver, nexusEmailDraftOperationId, type NexusEmailDraftScope, type NexusEmailDraftSelection } from "./nexus-email-draft.ts";
import { parseNexusEmailDraft, parseNexusEmailDraftRequest, parseNexusEmailSavedReference,
  type NexusEmailDraft, type NexusEmailDraftAnswer, type NexusEmailSavedReference } from "./nexus-email-contract.ts";
export type { NexusEmailDraftAnswer } from "./nexus-email-contract.ts";

type RpcPort = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export type NexusEmailDraftHostDeps = Readonly<{
  caller: RpcPort;
  service: RpcPort & CommsEmailAdmin & CommsEmailChatDependencies["admin"];
  userId: string;
  invokeAs: (name: string, body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  signal?: AbortSignal;
  controlHint?: string | null;
}>;
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const answer = (outcome: NexusEmailDraftAnswer["outcome"]): NexusEmailDraftAnswer =>
  ({ ok: outcome === "saved" || outcome === "available", outcome });
// Recognize the ORIGINAL email door's provider family for unsent drafts even
// when sending is not configured. This projection never asserts send readiness
// or reads a credential; ORIGINAL domain readiness still governs any later send.
const unsentSenderProviders = emailProvidersFor({ sendgridConfigured: false });

export async function runNexusEmailDraft(deps: NexusEmailDraftHostDeps, raw: unknown): Promise<NexusEmailDraftAnswer> {
  const req = parseNexusEmailDraftRequest(raw);
  if (!req || !UUID.test(deps.userId) || deps.controlHint !== undefined && deps.controlHint !== null || deps.signal?.aborted) return answer("refused");
  const caller = deps.caller, service = deps.service, actor = deps.userId, signal = deps.signal;
  let withdrawn = false, attempted = false;
  const live = () => !withdrawn && signal?.aborted !== true;
  const rpc = async (port: RpcPort, name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (!live()) return null;
    try { const r = await port.rpc(name, args); return live() && !r.error ? r.data : null; }
    catch { return null; }
  };
  const tenant = async (): Promise<string | null> => {
    const value = await rpc(caller, "get_paige_persona_context", {});
    const p = object(Array.isArray(value) ? value[0] : value);
    return typeof p?.tenant_id === "string" && UUID.test(p.tenant_id) ? p.tenant_id.toLowerCase() : null;
  };
  const tenantId = await tenant();
  if (!tenantId) return answer("unavailable");
  const read = async (choose = false): Promise<NexusEmailDraft | null> => {
    if (!live() || await tenant() !== tenantId) { withdrawn = true; return null; }
    const value = await rpc(caller, "team_hub_email_draft", { p_expected_tenant: tenantId, p_message_id: req.messageId,
      p_contact_id: choose ? req.contactId : null, p_connector_id: choose ? req.connectorId : null });
    return parseNexusEmailDraft(value, { tenantId, actorId: actor, messageIds: [req.messageId] });
  };
  let original: NexusEmailDraft | null;
  try { original = await read(); }
  catch { return answer("unavailable"); }
  if (!original) return answer("refused");
  if (req.intent === "save") {
    if (original.contactId) {
      if (original.contactId !== req.contactId || original.connectorId !== req.connectorId) return answer("refused");
    } else {
      // A missing email/contact/sender must remain editable input, not bind an
      // unusable selection. Reuse the ORIGINAL party resolver before binding;
      // the original domain writer independently repeats its checks at Save.
      try {
        const parties = await resolveCommsEmailParties(service, { tenantId, actorUserId: actor,
          contactId: req.contactId!, connectorId: req.connectorId! }, unsentSenderProviders);
        if (!live() || parties.kind !== "resolved") return answer("refused");
        const chosen = await read(true);
        if (!chosen || chosen.turnId !== original.turnId || chosen.conversationId !== original.conversationId
          || chosen.sourceMessageId !== original.sourceMessageId || chosen.preparation.subject !== original.preparation.subject
          || chosen.preparation.body !== original.preparation.body || chosen.contactId !== req.contactId
          || chosen.connectorId !== req.connectorId) return answer("refused");
        original = chosen;
      } catch { return answer("unavailable"); }
    }
  }
  const preparation = original;
  const same = (v: NexusEmailDraft): boolean =>
    v.turnId === preparation.turnId && v.conversationId === preparation.conversationId
    && v.sourceMessageId === preparation.sourceMessageId && v.messageId === preparation.messageId
    && v.preparation.subject === preparation.preparation.subject && v.preparation.body === preparation.preparation.body
    && v.contactId === preparation.contactId && v.connectorId === preparation.connectorId;
  const current = async (): Promise<boolean> => {
    const v = await read();
    if (!v || !same(v)) { withdrawn = true; return false; }
    return live();
  };
  try {
    if (req.intent === "inspect") {
      // ORIGINAL actor-filtered mailbox/provider projection; no new connection
      // policy, credential access, provider request or model disclosure.
      const senders = await listCommsEmailSenders(service, { tenantId, actorUserId: actor }, unsentSenderProviders);
      if (!await current()) return answer("refused");
      return { ok: true, outcome: "available", message_id: req.messageId, senders };
    }
    if (!preparation.contactId || !preparation.connectorId) return answer("refused");
    const scope: NexusEmailDraftScope = {
      agent: "nexus", where: "agent_dm", tenantId, actorId: actor, conversationId: preparation.conversationId,
      sourceMessageId: preparation.sourceMessageId,
      // These native reads re-prove the ORIGINAL stored scope before every
      // continuation. This one-element projection grants no unlisted capability.
      storedTools: ["comms_send_email"], contactIds: [preparation.contactId], connectorId: preparation.connectorId,
    };
    const selection: NexusEmailDraftSelection = Object.freeze({ contact_id: preparation.contactId,
      connector_id: preparation.connectorId, subject: preparation.preparation.subject, body: preparation.preparation.body, save_draft: true });
    const operation = await nexusEmailDraftOperationId(scope, selection);
    const reconcile = async (): Promise<{ status: "saved"; ref: NexusEmailSavedReference } | { status: "absent" | "unavailable" }> => {
      if (!await current()) return { status: "unavailable" };
      const value = object(await rpc(service, "team_hub_record_email_draft", {
        p_expected_tenant: tenantId, p_actor: actor, p_message_id: req.messageId, p_operation_id: operation,
      }));
      if (!await current() || value?.ok !== true) return { status: "unavailable" };
      if (value.status === "unknown") return { status: "absent" };
      if (value.status !== "saved") return { status: "unavailable" };
      const ref = parseNexusEmailSavedReference(value.result);
      return ref?.operation_id === operation ? { status: "saved", ref } : { status: "unavailable" };
    };
    // Reconcile the SAME original operation before any effect, including a
    // reconstructed HTTP request after a lost acknowledgement.
    const prior = await reconcile();
    if (prior.status === "saved") return { ok: true, outcome: "saved", message_id: req.messageId, result: prior.ref };
    if (prior.status === "unavailable") return answer("unavailable");
    if (!live()) return answer("refused");
    if (req.intent === "check") return { ...answer("unknown"), message_id: req.messageId };
    if (!await current()) return answer("refused");
    const save = createNexusEmailDraftSaver(scope, {
      admin: service, invokeAs: deps.invokeAs, signal,
      isCurrent: current,
      // Only the explicit browser Save selected these exact native-stored
      // recipient/sender/content values. No model/body/approval token supplies it.
      permitSelection: async chosen => req.intent === "save" && chosen.contact_id === req.contactId
        && chosen.connector_id === req.connectorId && chosen.subject === preparation.preparation.subject
        && chosen.body === preparation.preparation.body && await current(),
    });
    attempted = true;
    const saved = await save(selection);
    if (saved.status === "refused") return answer("refused");
    const verified = await reconcile();
    return verified.status === "saved" ? { ok: true, outcome: "saved", message_id: req.messageId, result: verified.ref }
      : { ...answer("unknown"), message_id: req.messageId };
  } catch {
    return answer(attempted ? "unknown" : "unavailable");
  }
}
