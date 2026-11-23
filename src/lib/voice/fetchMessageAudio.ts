import { supabase } from "@/integrations/supabase/client";
import type { TtsFetchError } from "./messageTts";
import { classifyTtsFailure } from "./messageTtsFailure";

/** Use a direct authenticated fetch so the output controller can consume the streaming MP3. */
export async function fetchMessageAudio(content: string, requestId: string, signal: AbortSignal): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw { needsConfig: false, message: "Please sign in." } as TtsFetchError;

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-tts`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      "Idempotency-Key": requestId,
    },
    body: JSON.stringify({ text: content }),
  });
  if (response.ok) return response;

  let code: string | null = null;
  let resetAt: string | null = null;
  try {
    const body = await response.json() as Record<string, unknown>;
    code = typeof body.error === "string" ? body.error : null;
    const suppliedReset = body.reset_at ?? body.resets_at ?? body.resetAt;
    resetAt = typeof suppliedReset === "string" ? suppliedReset : null;
  } catch { /* Non-JSON responses use the HTTP status. */ }
  const feedback = classifyTtsFailure(code, response.status, resetAt);
  throw {
    needsConfig: feedback.kind === "not_configured",
    code,
    status: response.status,
    resetAt,
    message: feedback.message,
  } as TtsFetchError;
}
