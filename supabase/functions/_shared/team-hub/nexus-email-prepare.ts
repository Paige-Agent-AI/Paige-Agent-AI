// Preparation stays on the ORIGINAL accepted private turn. It is proposed text,
// never a Messages save, approval, send or permission to export private history.
import { UUID } from "../comms-email/contract.ts";
import { parseNexusEmailPreparation, type NexusEmailPreparation } from "./nexus-email-contract.ts";
import { createWeeklyDraftDeadline } from "../paige-orchestration/weekly-draft-deadline.ts";

type Scope = Readonly<{ agent: string; where: string; turnId: string; tokenHash: string; storedTools: readonly string[] | null }>;
type Deps = Readonly<{
  service: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
  signal?: AbortSignal;
  timeoutMs?: number;
}>;
const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

export const NEXUS_EMAIL_PREPARATION_PROMPT = [
  "UNSENT EMAIL PREPARATION: When the person asks for a one-recipient business email, you can PREPARE its subject and plain-text body here.",
  'Add "email_draft":{"subject":"...","body":"..."} to your one answer JSON only when you have enough details to prepare the email. Otherwise ask one useful question and omit email_draft.',
  "This prepares text only. You have NOT saved an email in Messages, sent, scheduled or approved anything. Never claim those outcomes.",
  "The person sees the prepared text, chooses the existing recipient and permitted email address, then can explicitly Save unsent email. That step uses the original email writer and receipt; it grants no send approval.",
  "Include only email content the person has asked to prepare. Never paste private transcripts, unrelated messages or hidden business context into an email. Do not invent recipients, commitments, facts or completed work.",
  "Use at most 200 characters in subject (one line) and 10000 in body, both plain text. email_draft has ONLY those two fields: no navigation, source, address, attachment, approval, result or status fields. Sender/recipient selection belongs to the person in the workspace.",
  "Marketing, campaigns, invoices, agreements and booking keep their original domain tools. Do not use this generic preparation to bypass them.",
].join("\n");

/** Optional extra JSON field. Parsing it cannot activate a tool or writer. */
export function nexusEmailPreparationFromAnswer(answer: string): NexusEmailPreparation | null | "invalid" {
  try {
    const v = object(JSON.parse(answer));
    if (!v || !Object.hasOwn(v, "email_draft")) return null;
    return parseNexusEmailPreparation(v.email_draft) ?? "invalid";
  } catch { return null; }
}

/** Captures one original turn/token. All offers, provider continuations and staging
 * use the native original actor/DM/role/roster check. Failure is sticky for this
 * invocation; a later reentry needs a newly accepted turn, never borrowed scope. */
export function createNexusEmailPreparation(scope: Scope, deps: Deps) {
  const turnId = scope.turnId, tokenHash = scope.tokenHash, signal = deps.signal;
  const eligible = scope.agent === "nexus" && scope.where === "agent_dm" && UUID.test(turnId)
    && /^[0-9a-f]{64}$/.test(tokenHash) && scope.storedTools?.includes("comms_send_email") === true;
  const rpc: Deps["service"]["rpc"] = deps.service.rpc.bind(deps.service);
  let withdrawn = false;
  const live = () => eligible && !withdrawn && signal?.aborted !== true;
  const current = async (): Promise<boolean> => {
    if (!live()) return false;
    try {
      const r = await createWeeklyDraftDeadline(deps.timeoutMs ?? 5000, live)(() =>
        rpc("team_hub_email_draft_scope", { p_turn_id: turnId, p_token_hash: tokenHash }));
      if (r.error || object(r.data)?.ok !== true || !live()) { withdrawn = true; return false; }
      return true;
    } catch { withdrawn = true; return false; }
  };
  const stage = async (candidate: NexusEmailPreparation): Promise<boolean> => {
    const selected = parseNexusEmailPreparation(candidate);
    if (!selected || !await current()) return false;
    try {
      const r = await createWeeklyDraftDeadline(deps.timeoutMs ?? 5000, live)(() =>
        rpc("team_hub_stage_email_draft", { p_turn_id: turnId, p_token_hash: tokenHash,
          p_subject: selected.subject, p_body: selected.body }));
      if (r.error || object(r.data)?.ok !== true || !live()) { withdrawn = true; return false; }
      return true;
    } catch { withdrawn = true; return false; }
  };
  return Object.freeze({ current, stage });
}
