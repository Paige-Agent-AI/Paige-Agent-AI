// Test-only fakes for the EXP08 A2b Team Hub tests (agent-turn.test.ts, card-tools.test.ts,
// card-act.test.ts, card-binding.test.ts). Not imported by any edge function.
//
// A PostgREST-shaped query builder that records exactly what each query asked for (table, operation,
// columns, values and every filter), and answers from a resolver the test supplies. Every builder is
// thenable at any point, as supabase-js's is, so `await q.eq(...)` and `await q.limit(n)` both resolve.

export type Filter = [op: string, key: string, value: unknown];
export type Query = { table: string; op: "select" | "update" | "insert"; columns?: string; values?: unknown; filters: Filter[]; single: boolean };
export type Answer = { data: unknown; error: unknown };
export type Resolver = (q: Query) => Answer | Promise<Answer>;

export function fakeDb(resolve: Resolver, log: Query[]) {
  return {
    from(table: string) {
      const q: Query = { table, op: "select", filters: [], single: false };
      const add = (op: string) => (key: string, value?: unknown, extra?: unknown) => {
        q.filters.push([op, key, extra === undefined ? value : [value, extra]]);
        return chain;
      };
      // deno-lint-ignore no-explicit-any
      const chain: any = {
        select(columns?: string) { if (q.op === "select") q.columns = columns; return chain; },
        update(values: unknown) { q.op = "update"; q.values = values; return chain; },
        insert(values: unknown) { q.op = "insert"; q.values = values; return chain; },
        eq: add("eq"), neq: add("neq"), is: add("is"), in: add("in"), gt: add("gt"), gte: add("gte"), lt: add("lt"), lte: add("lte"),
        not: add("not"), contains: add("contains"),
        order() { return chain; }, limit() { return chain; }, abortSignal() { return chain; },
        maybeSingle() { q.single = true; log.push(q); return Promise.resolve().then(() => resolve(q)); },
        then(onOk: (v: Answer) => unknown, onErr?: (e: unknown) => unknown) {
          log.push(q);
          return Promise.resolve().then(() => resolve(q)).then(onOk, onErr);
        },
      };
      return chain;
    },
  };
}

/** The value of an `eq` filter on `key`, or undefined. */
export const eqOf = (q: Query, key: string): unknown => q.filters.find(([op, k]) => op === "eq" && k === key)?.[2];
export const hasFilter = (q: Query, op: string, key: string): boolean => q.filters.some(([o, k]) => o === op && k === key);

/**
 * The three read definitions paige-ai-chat owns (GROWTH_LIST_TOOL_DEF, CRM_LIST_TEAM_TOOL_DEF,
 * CRM_LIST_TASKS_TOOL_DEF), evaluated from its source as the chat hands them to the agent turn. Each
 * holds only literals, so evaluating the literal is exactly the object the chat passes.
 */
export function chatReadToolDefs(chatSource: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, constName] of [["growth_list", "GROWTH_LIST_TOOL_DEF"], ["crm_list_team", "CRM_LIST_TEAM_TOOL_DEF"], ["crm_list_tasks", "CRM_LIST_TASKS_TOOL_DEF"]]) {
    const head = `const ${constName} = `;
    const at = chatSource.indexOf(head);
    if (at < 0 || chatSource.indexOf(head, at + 1) >= 0) throw new Error(`the chat defines ${constName} exactly once`);
    const start = at + head.length;
    let depth = 0, i = start, quote: string | null = null;
    for (; i < chatSource.length; i++) {
      const ch = chatSource[i];
      if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = null; continue; }
      if (ch === "\"" || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) break;
    }
    out[name] = new Function(`return (${chatSource.slice(start, i + 1)});`)();
  }
  return out;
}
