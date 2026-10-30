import type {ClientPortalPersonaInput} from "./client-portal-persona.ts";
import {researchSourceUrl} from "./research-source-policy.ts";
import {contextAvailable, contextDegraded, contextUnavailable, type ContextSourceResult} from "./paige-context/mod.ts";

type Caller = {rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: unknown}>};
export type CustomerPublicLinkSnapshot = Readonly<{
  version: 1; kind: "customer_public_link"; actor_id: string; tenant_id: string; contact_id: string;
  thread_id: string; intent_id: string; url: string;
}>;
export type CustomerPublicLinkContext = Readonly<{
  threadId: string; intentId: string; mode: "fresh" | "bound" | "legacy";
  snapshot: CustomerPublicLinkSnapshot | null;
}>;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const closed = (value: unknown, keys: readonly string[]) => {
  const row = object(value);
  return row && Object.keys(row).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(row, key)) ? row : null;
};
const inputId = (value: unknown): string | null => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
const snapshotKeys = ["version", "kind", "actor_id", "tenant_id", "contact_id", "thread_id", "intent_id", "url"];
// Preserve the original ToolDef's required purpose without admitting private
// question/history/Knowledge as public-request arguments. The executor sends
// only the exact selected URL to its original SSRF service.
export const CUSTOMER_PUBLIC_LINK_PURPOSE = "Read the public page explicitly selected by this customer.";

/** Syntax/identity narrowing only. The original Research normalizer owns URL
 * identity; fetch-url-content's canonical SSRF guard MUST still validate DNS,
 * addresses, redirects, transport and byte limits. A normalized URL is not proof
 * of publicness, customer permission, fetched content or provider readiness.
 * Query-bearing/private share links are outside this bounded public-page input.
 * Never discover input from private context, uploads or model-generated guesses.
 */
export function customerPublicLinkUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const selected = value.trim();
  // 500 is the existing canonical web_fetch provenance URL bound, not a new
  // transport limit. Refuse rather than silently truncate the approved identity.
  if (!selected || selected.length > 500 || /[\s\\?#]/u.test(selected)
    || Array.from(selected).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null;
  const normalized = researchSourceUrl(selected, {});
  return normalized && normalized.startsWith("https://") && normalized.length <= 500 ? normalized : null;
}

/** Decode the original caller-JWT native accepted-link binding. No network fetch,
 * generic owner context, service-role substitute or publication occurs here.
 * A decoder is not an admission grant: the native source and original protected
 * turn lifetime must be rechecked before dispatch and before release.
 */
export async function readCustomerPublicLinkContext(caller: Caller, actorInput: string, threadInput: unknown,
  intentInput: unknown, expectedPersona: ClientPortalPersonaInput, selection: unknown = null,
  timeoutMs = 5000): Promise<ContextSourceResult<CustomerPublicLinkContext | null>> {
  const actor = inputId(actorInput), threadId = inputId(threadInput), intentId = inputId(intentInput);
  const binding = expectedPersona?.binding;
  const tenant = inputId(binding?.tenantId), contact = inputId(binding?.clientId);
  const selected = selection === null ? null : customerPublicLinkUrl(selection);
  if (!actor || !threadId || !intentId || !tenant || !contact || binding?.actorId !== actor
    || expectedPersona.enabled !== true || (selection !== null && selected === null)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    return contextDegraded("customer_link_scope_invalid");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    const {data, error} = await Promise.race([
      Promise.resolve(caller.rpc("client_portal_assistant_link_context", {p_thread: threadId, p_intent: intentId, p_url: selected})),
      new Promise<never>((_, reject) => {timer = setTimeout(() => {expired = true; reject(new Error("timeout"));}, timeoutMs);}),
    ]);
    if (error) return object(error)?.code === "42501" ? contextUnavailable("customer_link_withdrawn") : contextDegraded("customer_link_read_failed");
    const row = closed(data, ["thread_id", "intent_id", "mode", "snapshot"]);
    if (!row || row.thread_id !== threadId || row.intent_id !== intentId) return contextDegraded("customer_link_invalid");
    if (row.mode === "legacy") return selected === null && row.snapshot === null
      ? contextAvailable({threadId, intentId, mode: "legacy", snapshot: null}) : contextDegraded("customer_link_invalid");
    const snapshot = closed(row.snapshot, snapshotKeys);
    if ((row.mode !== "fresh" && row.mode !== "bound") || (row.mode === "fresh" && selected === null)
      || !snapshot || snapshot.version !== 1 || snapshot.kind !== "customer_public_link" || snapshot.actor_id !== actor
      || snapshot.tenant_id !== tenant || snapshot.contact_id !== contact || snapshot.thread_id !== threadId || snapshot.intent_id !== intentId
      || typeof snapshot.url !== "string" || customerPublicLinkUrl(snapshot.url) !== snapshot.url
      || (selected !== null && snapshot.url !== selected)) return contextDegraded("customer_link_invalid");
    return contextAvailable({threadId, intentId, mode: row.mode, snapshot: {
      version: 1, kind: "customer_public_link", actor_id: actor, tenant_id: tenant, contact_id: contact,
      thread_id: threadId, intent_id: intentId, url: snapshot.url,
    }});
  } catch {return contextDegraded(expired ? "customer_link_timed_out" : "customer_link_read_failed");}
  finally {if (timer !== undefined) clearTimeout(timer);}
}

/** A closed selection for ONE controller-issued call to the EXISTING web_fetch
 * executor. This never admits a provider-authored customer tool call, adds a tool
 * or substitutes for native currentness. The caller latches attempted before I/O
 * so uncertain/late outcomes cannot cause another automatic public request.
 */
export function admitCustomerPublicLinkCall(source: CustomerPublicLinkContext | null, issuedDispatchId: string,
  proposedCall: unknown, attempted: boolean): boolean {
  if (attempted !== false || source?.mode !== "bound" || !source.snapshot || !inputId(issuedDispatchId)) return false;
  const call = closed(proposedCall, ["id", "type", "function"]);
  const fn = closed(call?.function, ["name", "arguments"]);
  if (!call || call.id !== issuedDispatchId || call.type !== "function" || fn?.name !== "web_fetch" || typeof fn.arguments !== "string") return false;
  try {
    const args = closed(JSON.parse(fn.arguments), ["url", "purpose"]);
    return !!args && args.url === source.snapshot.url && args.purpose === CUSTOMER_PUBLIC_LINK_PURPOSE;
  } catch {return false;}
}

/** Add only the original native manifest to the existing terminal record. A
 * bound URL is not a fetched-page/success receipt. The existing executor's actual
 * result owns that claim; withheld cleanup remains empty and source-free.
 */
export function customerPublicLinkTerminalSource(snapshot: CustomerPublicLinkSnapshot | null, content: unknown,
  bundle: Record<string, unknown>): {content: unknown; metadata: Record<string, unknown>} {
  if (snapshot && ["WITHHELD", "INTERRUPTED", "REFUSED"].includes(String(object(bundle.turn_state)?.state)))
    return {content: "", metadata: {}};
  return {content, metadata: snapshot ? {customer_public_link: snapshot} : {}};
}
