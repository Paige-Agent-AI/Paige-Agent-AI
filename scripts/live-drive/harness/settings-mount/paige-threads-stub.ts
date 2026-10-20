/**
 * Local rendered-flow double for PAIGE history. It supplies stable, visibly
 * synthetic thread and turn records while leaving the shipped PaigeAIChat state,
 * reconciliation, history transitions, and scroll controller under test.
 */
export interface PaigeThread {
  id: string;
  title: string | null;
  last_message_at: string | null;
  message_count: number;
  is_archived: boolean;
  updated_at: string | null;
}

export interface PaigeTurn {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  bundle_ref: Record<string, unknown> | null;
  surfaces_used: string[] | null;
  seq: number;
  created_at: string | null;
}

const makeTurns = (thread: "a" | "b", count: number): PaigeTurn[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `harness-${thread}-turn-${index + 1}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `HARNESS ONLY — ${thread.toUpperCase()} conversation item ${index + 1}. Stable reading anchor evidence with enough text to wrap naturally at compact widths.`,
    bundle_ref: null,
    surfaces_used: null,
    seq: index + 1,
    created_at: new Date(Date.UTC(2026, 8, 7, 12, index)).toISOString(),
  }));

const turnsByThread: Record<string, PaigeTurn[]> = {
  "harness-thread-a": makeTurns("a", 40),
  "harness-thread-b": makeTurns("b", 28),
};

const persistedHarnessTurns = (threadId: string): PaigeTurn[] => {
  if (threadId !== "harness-thread-a" || typeof sessionStorage === "undefined") return [];
  const completed = Number(sessionStorage.getItem("paige-harness-completed-turns") ?? 0);
  return Array.from({ length: completed * 2 }, (_, index) => ({
    id: `harness-a-persisted-turn-${index + 1}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: index % 2 === 0
      ? `HARNESS ONLY persisted user turn ${Math.floor(index / 2) + 1}.`
      : "HARNESS ONLY streamed response completed.",
    bundle_ref: null,
    surfaces_used: null,
    seq: turnsByThread["harness-thread-a"].length + index + 1,
    created_at: new Date(Date.UTC(2026, 8, 7, 13, index)).toISOString(),
  }));
};

const threads: PaigeThread[] = [
  {
    id: "harness-thread-a",
    title: "Harness long conversation A",
    last_message_at: "2026-09-07T12:40:00.000Z",
    message_count: turnsByThread["harness-thread-a"].length,
    is_archived: false,
    updated_at: "2026-09-07T12:40:00.000Z",
  },
  {
    id: "harness-thread-b",
    title: "Harness long conversation B",
    last_message_at: "2026-09-07T11:28:00.000Z",
    message_count: turnsByThread["harness-thread-b"].length,
    is_archived: false,
    updated_at: "2026-09-07T11:28:00.000Z",
  },
];

/**
 * Gated exactly like the real hook (src/hooks/usePaigeThreads.ts:56,176): nothing is "fetched" until
 * the caller's user id (and tenant, outside platform mode) is known. A constant `isFetched: true`
 * reported a settled list before the user id resolved, which latched PAIGE Chat on "Loading your
 * conversations…" in this harness only (E4-S2 diagnosis, 2026-10-13).
 */
export function usePaigeThreads(opts: { callerUserId?: string | null; tenantId?: string | null; platform?: boolean } = {}) {
  const enabled = !!opts.callerUserId && (!!opts.platform || !!opts.tenantId);
  return {
    threads: enabled ? threads : [],
    isLoading: false,
    isFetched: enabled,
    loadTurns: async (threadId: string) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return [...(turnsByThread[threadId] ?? []), ...persistedHarnessTurns(threadId)];
    },
    ensureThread: async () => "harness-new-thread",
    renameThread: () => undefined,
    archiveThread: () => undefined,
    deleteThread: async () => undefined,
    onTurnPersisted: () => undefined,
  };
}

export type UsePaigeThreads = ReturnType<typeof usePaigeThreads>;
