import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";

/**
 * Command-center comms rollups for the coach's inbox (Comms C-1.5).
 *
 * Four tenant-scoped HEAD count queries (count:"exact", head:true — the row
 * bodies are never fetched, only the count), surfaced as neutral StatTiles on
 * PracticeOverview so a coach sees what's waiting the instant they land (§36
 * proactive surfacing) without opening the inbox.
 *
 * §9: every count carries an EXPLICIT .eq("tenant_id", activeTenantId) filter.
 * RLS alone is NOT sufficient here: the `messages` and `threads` SELECT policies
 * (migrations 20260726190000 / 20260726210500) both begin with an
 * `is_platform_owner() OR ...` disjunct, so a platform owner's RLS spans EVERY
 * tenant and a bare HEAD count would bleed cross-tenant totals. The active tenant
 * is context-derived (useTenantContext), NEVER passed from a request body, and the
 * query is disabled entirely at the God tier (activeTenantId === null) so it shows
 * zeros rather than the owner's all-tenant counts. Mirrors CampaignsOverviewStats.
 *
 * §13: each count maps 1:1 to a hand-auditable SQL predicate (see the lane
 * report's verification block) — no derived/estimated numbers.
 *
 * The new C-1.5 tables/columns (threads, messages.scheduled_for) are not yet in
 * the generated Supabase types, so we use the established (supabase as any)
 * tsc-ratchet pattern already used across the inbox surface.
 */
export interface CommsSummary {
  /** Outbound messages Paige has teed up as drafts, waiting for one-click approval. */
  draftsAwaiting: number;
  /** Active threads where WE spoke last and the client hasn't replied in >3 days. */
  awaitingClientReply: number;
  /** Snoozed threads whose snooze wakes at some point today. */
  wakingToday: number;
  /** Outbound messages queued to release at a future scheduled instant. */
  scheduledSends: number;
}

const EMPTY: CommsSummary = {
  draftsAwaiting: 0,
  awaitingClientReply: 0,
  wakingToday: 0,
  scheduledSends: 0,
};

const POLL = { refetchInterval: 45_000, refetchOnWindowFocus: true } as const;

/** End of the caller's local day, as an absolute ISO instant. */
function endOfTodayISO(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/** now() - 3 days, as an absolute ISO instant (the "no reply in >3 days" cutoff). */
function threeDaysAgoISO(): string {
  return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
}

async function headCount(
  build: () => Promise<{ count: number | null; error: unknown }>,
): Promise<number> {
  const { count, error } = await build();
  if (error) throw error;
  return count ?? 0;
}

export function useCommsSummary() {
  const queryClient = useQueryClient();
  const { activeTenantId } = useTenantContext();

  const query = useQuery({
    queryKey: ["comms-summary", activeTenantId],
    // §9: only ever run once a workspace is resolved. At the God tier
    // (activeTenantId === null) the query is disabled → tiles read EMPTY zeros,
    // never the platform-owner's cross-tenant totals.
    enabled: !!activeTenantId,
    queryFn: async (): Promise<CommsSummary> => {
      const nowISO = new Date().toISOString();
      const dayEndISO = endOfTodayISO();
      const replyCutoffISO = threeDaysAgoISO();
      // messages/threads are not in the generated types (C-1.5 untyped tables) — one
      // `any` handle so the four head-count queries stay lint-clean (§13 note).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;

      const [draftsAwaiting, awaitingClientReply, wakingToday, scheduledSends] =
        await Promise.all([
          // (1) "N drafts awaiting you" — outbound messages Paige drafted, status='draft'.
          //     INT-328: a governed send (an approved email or invoice delivery) is written as a
          //     'draft' row before it leaves and stays one when its outcome is unconfirmed. It is
          //     not awaiting approval, so it is excluded — the same rule the inbox applies
          //     (pages/admin/conversations/governedSend.ts).
          headCount(() =>
            sb
              .from("messages")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", activeTenantId)
              .eq("direction", "outbound")
              .eq("status", "draft")
              .is("meta->comms_email_binding", null)
              .is("meta->sales_invoice_binding", null),
          ),
          // (2) "M threads waiting on client reply >3 days" — active threads where WE
          //     spoke last (last_direction='outbound') and the last message is older
          //     than 3 days, not archived. R9: exclude threads deliberately snoozed
          //     (snoozed into the future) so a parked thread doesn't nag — keeps this
          //     tile == the inbox `awaiting-reply` view predicate.
          headCount(() =>
            sb
              .from("threads")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", activeTenantId)
              .eq("last_direction", "outbound")
              .lt("last_message_at", replyCutoffISO)
              .is("archived_at", null)
              .or(`snoozed_until.is.null,snoozed_until.lte.${nowISO}`),
          ),
          // (3) "Waking today" (secondary) — snoozed threads waking between now and
          //     end of the local day, not archived.
          headCount(() =>
            sb
              .from("threads")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", activeTenantId)
              .not("snoozed_until", "is", null)
              .gte("snoozed_until", nowISO)
              .lte("snoozed_until", dayEndISO)
              .is("archived_at", null),
          ),
          // (4) "Scheduled to send" (secondary) — queued outbound with a future
          //     release instant (scheduled_for set).
          headCount(() =>
            sb
              .from("messages")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", activeTenantId)
              .eq("status", "queued")
              .not("scheduled_for", "is", null),
          ),
        ]);

      return { draftsAwaiting, awaitingClientReply, wakingToday, scheduledSends };
    },
    ...POLL,
  });

  // Realtime bridge: a new message (insert/update/delete) or a thread change
  // (snooze/archive/last_* rollup) refreshes the tiles the instant it happens,
  // not on the next 45s poll. Both tables are in the supabase_realtime
  // publication (foundation migration). §9: the subscription only receives the
  // caller's tenant rows under RLS, same as the counts.
  useEffect(() => {
    const channel = supabase
      .channel("comms-summary")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => queryClient.invalidateQueries({ queryKey: ["comms-summary"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "threads" },
        () => queryClient.invalidateQueries({ queryKey: ["comms-summary"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return {
    summary: query.data ?? EMPTY,
    loading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
