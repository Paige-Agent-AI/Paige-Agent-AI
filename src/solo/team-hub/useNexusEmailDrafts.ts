import { useCallback, useEffect, useMemo, useState } from "react";
import type { TeamHub } from "./useTeamHub";
import type { NexusEmailDraft, NexusEmailDraftAnswer, NexusEmailDraftRequest } from "../../../supabase/functions/_shared/team-hub/nexus-email-contract";

export function useNexusEmailDrafts(hub: TeamHub, tenantId: string) {
  const actorId = hub.overview?.me.user_id ?? null;
  const permission = hub.overview?.people.find(p => p.user_id === actorId)?.permission;
  const conversationId = hub.activeAgentDm?.agent_key === "nexus" ? hub.activeAgentDm.id : null;
  const eligible = hub.status === "ready" && !!actorId && !!conversationId && (permission === "owner" || permission === "admin");
  const key = JSON.stringify([tenantId, actorId, conversationId, permission, eligible]);
  const ids = useMemo(() => [...new Set([
    ...(hub.stream?.channelId === conversationId ? hub.stream.messages : []),
    ...(hub.thread?.channelId === conversationId ? [hub.thread.root, ...hub.thread.replies] : []),
  ].filter(m => m?.author_kind === "agent" && m.agent_key === "nexus" && m.author_user_id === actorId).map(m => m!.id))],
  [hub.stream, hub.thread, conversationId, actorId]);
  const idsKey = ids.join(",");
  const [revision, setRevision] = useState(0);
  const [read, setRead] = useState<{ key: string; state: "idle" | "ready" | "unavailable"; drafts: Readonly<Record<string, NexusEmailDraft>> }>({ key: "", state: "idle", drafts: {} });
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const readEmailDrafts = hub.readEmailDrafts;
  useEffect(() => {
    let current = true;
    if (!eligible || !conversationId || !idsKey) {
      setRead({ key, state: "ready", drafts: {} }); return;
    }
    const messageIds = idsKey.split(",");
    void (async () => {
      const records: NexusEmailDraft[] = [];
      for (let start = 0; start < messageIds.length; start += 50) {
        const batch = await readEmailDrafts(conversationId, messageIds.slice(start, start + 50));
        if (!current) return;
        if (!batch) { setRead({ key, state: "unavailable", drafts: {} }); return; }
        records.push(...batch);
      }
      if (current) setRead({ key, state: "ready", drafts: Object.fromEntries(records.map(d => [d.messageId, d])) });
    })();
    return () => { current = false; };
    // Original Hub focus/reconnect/refresh cadence revalidates this projection;
    // no new poller, job or persistent result store is created.
  }, [eligible, conversationId, idsKey, key, revision, hub.overview, readEmailDrafts]);
  const invoke = hub.actOnEmailDraft;
  const act = useCallback(async (request: NexusEmailDraftRequest, signal?: AbortSignal): Promise<NexusEmailDraftAnswer> => {
    const result = await invoke(request, signal);
    refresh(); return result;
  }, [invoke, refresh]);
  return { eligible, drafts: eligible && read.key === key ? read.drafts : {},
    state: !eligible ? "idle" as const : read.key === key ? read.state : "loading" as const, refresh, act };
}
export type NexusEmailDraftView = ReturnType<typeof useNexusEmailDrafts>;
