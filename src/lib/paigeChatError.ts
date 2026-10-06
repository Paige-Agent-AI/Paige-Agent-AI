// #587 — Parse a paige-ai-chat error Response into a user-facing { title, description }.
//
// The edge function returns a STRUCTURED { code, reason, recommendation } body on a size/page/outage
// failure (see supabase/functions/paige-ai-chat/index.ts — structuredChatError / preflight). This
// reads that body so the dedicated chat surfaces (PaigeAIChat, PaigeChat) show the
// SPECIFIC message — a 15 MB size limit reads differently from a general outage — instead of the old
// generic "Failed to send message" toast that swallowed the server's real reason.
//
// Degrades gracefully: a missing / non-JSON / legacy body falls back to the generic message, so this
// never throws and never blocks the surface's own error handling.

export interface PaigeChatErrorDisplay {
  title: string;
  description: string;
}

const TITLE_BY_CODE: Record<string, string> = {
  pdf_too_large: "File too large",
  pdf_too_many_pages: "PDF too long",
  document_unreadable: "Couldn't read that document",
  rate_limited: "Rate limit reached",
  insufficient_credits: "Service needs credits",
  chat_unavailable: "Something went wrong",
  // C4c — an answer to PAIGE's question that was not carried forward (paige-ai-chat, refuseAnswer).
  ASK_NOT_OPEN: "That question is closed",
  ASK_ALREADY_ANSWERED: "PAIGE already has your answer",
  ASK_ANSWER_IN_PROGRESS: "PAIGE already has your answer",
  ASK_REOPENED: "PAIGE asked again",
};

/**
 * Read a (non-ok) paige-ai-chat Response and produce a user-facing title + description. Reads the
 * body via `response.clone()` so the caller's own body handling is never disturbed. Pass a Response
 * whose body has not yet been consumed.
 */
export async function parsePaigeChatError(response: Response): Promise<PaigeChatErrorDisplay> {
  let code: string | undefined;
  let reason: string | undefined;
  let recommendation: string | undefined;

  try {
    const data = await response.clone().json();
    if (data && typeof data === "object") {
      if (typeof (data as Record<string, unknown>).code === "string") code = (data as Record<string, string>).code;
      if (typeof (data as Record<string, unknown>).reason === "string") reason = (data as Record<string, string>).reason;
      else if (typeof (data as Record<string, unknown>).error === "string") reason = (data as Record<string, string>).error;
      if (typeof (data as Record<string, unknown>).recommendation === "string") recommendation = (data as Record<string, string>).recommendation;
    }
  } catch {
    /* non-JSON / empty body — fall through to the generic message */
  }

  if (reason && reason !== "An error occurred") {
    return {
      title: (code && TITLE_BY_CODE[code]) || "Something went wrong",
      description: recommendation ? `${reason} ${recommendation}` : reason,
    };
  }

  return {
    title: "Error",
    description: "Failed to send message. Please try again.",
  };
}
