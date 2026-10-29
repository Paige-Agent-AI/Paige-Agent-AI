import { supabase as original } from "../../../exp08-team-hub-agents-a1c/harness/src/mock-supabase";
// Supporting ORIGINAL component render, not Auth/database/model/provider or persistence proof.
const dm = "c-dm-merit";
const record = "12345678-1234-4234-8234-123456789012";
const answer = {
  id: "m-original-source", author_user_id: "u-me", author_kind: "agent", agent_key: "merit",
  body: "The consulting agreement is a draft. One signature is still needed. Nothing was sent or changed.",
  created_at: "2026-10-29T03:00:00.000Z", parent_message_id: null, reply_count: 0, last_reply_at: null,
  mentions: [], files: [], work_ref: null, asked_in_message_id: null, agent_mentions: [],
  source_backed_read: true, paige_record_links: [{ destination: "sales_agreements", record_id: record }],
};
export const supabase = { ...original, rpc: async (name: string, p: Record<string, unknown>) => {
  if (name === "team_hub_open_agent_dm" && p.p_agent_key === "merit") return { data: { ok: true, channel_id: dm }, error: null };
  if (name === "team_hub_list_messages" && p.p_channel_id === dm)
    return { data: { ok: true, channel: { id: dm, name: null, kind: "agent_dm", visibility: "private", joined: true }, messages: [answer], has_more: false }, error: null };
  const result = await original.rpc(name, p);
  if (name === "team_hub_list_conversations" && result.data?.ok === true) {
    return { ...result, data: { ...result.data, conversations: [...result.data.conversations.filter((c: Record<string, unknown>) => c.id !== dm),
      { id: dm, kind: "agent_dm", agent_key: "merit", visibility: "private", joined: true,
        name: null, member_count: 1, member_ids: ["u-me"], unread: 0, last_message_at: answer.created_at }] } };
  }
  return result;
} };
