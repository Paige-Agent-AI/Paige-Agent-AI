// The same pure message-body projection is used by the original governed draft door.
export { readableMessageBody, type ReadableMessage } from "../../../../supabase/functions/_shared/comms-email/message-reading.ts";

export function shouldFoldEmail(channel: string, body: string): boolean {
  return channel === "email" && (body.length > 900 || body.split("\n").length > 10);
}
