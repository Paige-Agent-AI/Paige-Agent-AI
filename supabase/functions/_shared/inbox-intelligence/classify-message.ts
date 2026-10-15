// #1140 — the ONE classification call site every inbound path shares:
// the Gmail sync engine, its backfill sweep, and the Resend inbound handler.
// Rides the model router's `classify` job kind (the Model Intelligence Fabric's
// cheap band — never a direct provider selection). Best-effort by contract: a
// classifier failure returns false and leaves the message landed and unclassified;
// the sync tick's backfill sweep retries it on a later run.
import { routedChatCompletion } from "../model-router.ts";
import { autoLabelsFor, buildClassifyPrompt, parseClassificationReply } from "./classify.ts";

/** The minimal admin-client surface the helper needs (kept structural for tests). */
export interface ClassifyAdmin {
  rpc(name: "apply_message_classification", args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export interface ClassifyMessageInput {
  admin: ClassifyAdmin;
  messageId: string;
  mailboxClass: "personal" | "shared_support";
  subject: string | null;
  fromAddress: string | null;
  snippet: string;
}

export async function classifyAndRecordMessage(input: ClassifyMessageInput): Promise<boolean> {
  try {
    const prompt = buildClassifyPrompt({
      mailboxClass: input.mailboxClass,
      subject: input.subject,
      fromAddress: input.fromAddress,
      snippet: input.snippet,
    });
    const reply = await routedChatCompletion("classify", {
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
    const text = (reply as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
    const outcome = parseClassificationReply(text);
    if (!outcome) return false;
    const { error } = await input.admin.rpc("apply_message_classification", {
      _message_id: input.messageId,
      _intent: outcome.intent,
      _confidence: outcome.confidence,
      _summary: outcome.summary,
      _model_route: { job_kind: "classify" },
      _labels: JSON.stringify(autoLabelsFor(outcome.intent, input.fromAddress)),
    });
    return !error;
  } catch {
    return false;
  }
}
