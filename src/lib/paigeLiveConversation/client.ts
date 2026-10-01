import type { TruthfulAvailability } from "./contract";

export type PaigeLiveEntryMode = "embedded" | "existing-popout" | "requested-popout";

export type PaigeLiveStartResult = Readonly<{
  ok: boolean;
  sessionId: string | null;
  availability: TruthfulAvailability;
  code: string;
  explanation: string;
  ticket?: string;
  ticketExpiresAt?: number;
  profile?: Readonly<{ name: string; revision: string }>;
}>;

export type PaigeLiveTransition = "hold" | "resume" | "minimize" | "restore" | "retry" | "end";

async function authToken(): Promise<string> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("session_expired");
  return token;
}

async function callControlPlane(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = await authToken();
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-live-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.code === "string" ? payload.code : "control_plane_unavailable");
  return payload;
}

export type PaigeLiveTermsResult = Readonly<{
  accepted: boolean;
  /** True when an acceptance was already on file, so nothing was written. */
  unchanged: boolean;
  code: string | null;
}>;

/**
 * The person accepts Live's terms FOR THEMSELVES.
 *
 * The RPC takes no arguments on purpose: the subject is `auth.uid()` and the workspace is the
 * canonical resolver's answer, so no account identifier is ever supplied by a caller, typed by an
 * operator, or stored anywhere a mistake could point it at someone else. An operator calling this
 * accepts for themselves and nobody else, and the database has a CHECK that makes inherited consent
 * unrepresentable rather than merely discouraged.
 *
 * It refuses while the rollout does not cover the caller, so this is safe to offer before knowing
 * whether Live is open — the refusal is the honest answer, not an error, and nothing is written.
 */
export async function acceptPaigeLiveTerms(): Promise<PaigeLiveTermsResult> {
  const { supabase } = await import("@/integrations/supabase/client");
  // The generated types are produced from the live schema, and this function's migration has not
  // been applied yet, so the RPC name is not in their union. Same shim the repo already uses for a
  // function that ships alongside its migration (useProviderAttribution, usePortalConfig).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new RPC, not yet in generated types
  const { data, error } = await supabase.rpc("paige_live_accept_terms" as any);
  if (error) {
    // Report the refusal, never a hoped-for acceptance (§13). The caller shows the same honest
    // unavailable state it shows for every other reason Live is not open.
    return { accepted: false, unchanged: false, code: "live_audio_not_enabled" };
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    accepted: payload.accepted === true,
    unchanged: payload.unchanged === true,
    code: typeof payload.code === "string" ? payload.code : null,
  };
}

export async function startPaigeLiveConversation(input: Readonly<{
  threadId: string;
  contextEpoch: string;
  entryMode: PaigeLiveEntryMode;
}>): Promise<PaigeLiveStartResult> {
  const payload = await callControlPlane({ action: "relay", thread_id: input.threadId, context_epoch: input.contextEpoch, entry_mode: input.entryMode });
  return {
    ok: payload.ok === true,
    sessionId: typeof payload.session_id === "string" ? payload.session_id : null,
    availability: (payload.availability as TruthfulAvailability | undefined) ?? "UNAVAILABLE",
    code: typeof payload.code === "string" ? payload.code : "provider_unavailable",
    ...(typeof payload.ticket === "string" ? { ticket: payload.ticket } : {}),
    ...(typeof payload.ticket_expires_at === "number" ? { ticketExpiresAt: payload.ticket_expires_at } : {}),
    explanation: typeof payload.explanation === "string"
      ? payload.explanation
      : "Live audio is not available yet. You can keep working with Paige in this conversation.",
    ...(payload.profile && typeof payload.profile === "object" ? { profile: payload.profile as { name: string; revision: string } } : {}),
  };
}

export async function renewPaigeLiveRelayTicket(input: Readonly<{ sessionId: string; threadId: string; contextEpoch: string; entryMode: PaigeLiveEntryMode }>): Promise<PaigeLiveStartResult> {
  const payload = await callControlPlane({
    action: "relay", session_id: input.sessionId, thread_id: input.threadId,
    context_epoch: input.contextEpoch, entry_mode: input.entryMode,
  });
  return {
    ok: payload.ok === true,
    sessionId: typeof payload.session_id === "string" ? payload.session_id : null,
    availability: (payload.availability as TruthfulAvailability | undefined) ?? "UNAVAILABLE",
    code: typeof payload.code === "string" ? payload.code : "relay_ticket_unavailable",
    explanation: typeof payload.explanation === "string" ? payload.explanation : "Paige could not reconnect live audio. You can continue in chat.",
    ...(typeof payload.ticket === "string" ? { ticket: payload.ticket } : {}),
    ...(typeof payload.ticket_expires_at === "number" ? { ticketExpiresAt: payload.ticket_expires_at } : {}),
  };
}

export async function transitionPaigeLiveConversation(sessionId: string, transition: PaigeLiveTransition, scope: Readonly<{ threadId: string; contextEpoch: string }>): Promise<void> {
  await callControlPlane({ action: "transition", session_id: sessionId, transition, thread_id: scope.threadId, context_epoch: scope.contextEpoch });
}
