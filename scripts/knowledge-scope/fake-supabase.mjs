/**
 * A RECORDING fake `@supabase/supabase-js` client.
 *
 * It exists to answer exactly one question the real code cannot be asked any other
 * way without a live database: **which tenant id does `paige-ai-chat` pass to
 * `match_tenant_knowledge`, for a given caller shape?**
 *
 * Design rules (§13):
 *   • It RECORDS rather than asserts. The checks own every assertion, so a fake that
 *     drifts cannot quietly satisfy one.
 *   • Unconfigured reads resolve to `{ data: [], error: null }` — an empty result, never
 *     an invented row. The handler's own try/catch then degrades exactly as in production.
 *   • `rpc()` results are configured PER SCENARIO, including error results, so a check can
 *     drive the real `KB_FORBIDDEN` rejection path instead of describing it.
 *
 * It is a test double for the module boundary only. No production code imports it.
 */

/** One recorded call, in order. */
function mkRecorder() {
  return { rpc: [], from: [], inserts: [], functions: [] };
}

class QueryBuilder {
  constructor(table, live) {
    this._table = table;
    this._live = live;
    this._filters = [];
    this._ordered = false;
    this._limit = null;
    this._op = "select";
  }
  get _scenario() { return this._live.scenario; }
  get _recorder() { return this._live.recorder; }


  // Every filter/shape method records itself and chains. Recording the SHAPE (not just
  // the table) is what lets a check prove an unordered LIMIT 1 pick is gone.
  select(...a) { this._filters.push(["select", a[0]]); return this; }
  insert(row) { this._op = "insert"; this._recorder.inserts.push({ table: this._table, row }); return this; }
  // Real postgrest-js has this, and traceLLMCall calls `.insert(record).abortSignal(sig)`. Without it
  // the expression THROWS before the `{ error }` destructure, lands in that function's swallowing
  // catch, and every assertion here passes without the write path ever executing. Mirrors
  // scripts/client-memory-authz/fake-supabase.mjs:92.
  abortSignal(sig) { void sig; this._filters.push(["abortSignal"]); return this; }
  update(row) { this._op = "update"; this._recorder.inserts.push({ table: this._table, row, update: true }); return this; }
  upsert(row) { this._op = "upsert"; this._recorder.inserts.push({ table: this._table, row, upsert: true }); return this; }
  delete() { this._op = "delete"; return this; }
  eq(c, v) { this._filters.push(["eq", c, v]); return this; }
  neq(c, v) { this._filters.push(["neq", c, v]); return this; }
  in(c, v) { this._filters.push(["in", c, v]); return this; }
  is(c, v) { this._filters.push(["is", c, v]); return this; }
  not(...a) { this._filters.push(["not", ...a]); return this; }
  or(v) { this._filters.push(["or", v]); return this; }
  gte(c, v) { this._filters.push(["gte", c, v]); return this; }
  lte(c, v) { this._filters.push(["lte", c, v]); return this; }
  gt(c, v) { this._filters.push(["gt", c, v]); return this; }
  lt(c, v) { this._filters.push(["lt", c, v]); return this; }
  like(c, v) { this._filters.push(["like", c, v]); return this; }
  ilike(c, v) { this._filters.push(["ilike", c, v]); return this; }
  contains(c, v) { this._filters.push(["contains", c, v]); return this; }
  textSearch(c, v) { this._filters.push(["textSearch", c, v]); return this; }
  order(c, o) { this._ordered = true; this._filters.push(["order", c, o]); return this; }
  range(a, b) { this._filters.push(["range", a, b]); return this; }
  limit(n) { this._limit = n; this._filters.push(["limit", n]); return this; }

  _rows() {
    const fn = this._scenario.tables?.[this._table];
    if (typeof fn === "function") return fn(this._filters) ?? [];
    if (Array.isArray(fn)) return fn;
    return [];
  }

  _record(single) {
    this._recorder.from.push({
      table: this._table,
      op: this._op,
      filters: this._filters,
      ordered: this._ordered,
      limit: this._limit,
      single,
    });
  }

  maybeSingle() {
    this._record(true);
    const rows = this._rows();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  single() { return this.maybeSingle(); }

  then(res, rej) {
    this._record(false);
    return Promise.resolve({ data: this._rows(), error: null, count: this._rows().length }).then(res, rej);
  }
}

class FakeClient {
  /** `live` exposes `scenario` and `recorder` as GETTERS so a memoized long-lived client keeps
   *  writing into whichever scenario is current — see the note in `createClient`. */
  constructor(kind, live) {
    this._kind = kind; // "jwt" | "service"
    this._live = live;
    this.auth = {
      getUser: async () => this._live.scenario.authUser
        ? { data: { user: this._live.scenario.authUser }, error: null }
        : { data: { user: null }, error: { message: "no user" } },
      getClaims: async () => ({ data: { claims: { sub: this._live.scenario.authUser?.id ?? null } }, error: null }),
    };
    this.storage = { from: () => ({ upload: async () => ({ data: null, error: null }), createSignedUrl: async () => ({ data: null, error: null }), download: async () => ({ data: null, error: null }) }) };
    this.functions = { invoke: async (name, options) => {
      this._live.recorder.functions.push({ client: this._kind, name, options });
      const configured = this._live.scenario.functions?.[name];
      const result = typeof configured === "function" ? configured(options) : configured;
      return result ?? { data: null, error: null };
    } };
    this.channel = () => ({ send: async () => {}, subscribe: () => ({}), on: function () { return this; } });
    this.removeChannel = () => {};
  }

  get _scenario() { return this._live.scenario; }
  get _recorder() { return this._live.recorder; }

  from(table) { return new QueryBuilder(table, this._live); }

  async rpc(name, args) {
    this._recorder.rpc.push({ client: this._kind, name, args });
    const configured = this._scenario.rpcs?.[name];
    // A scenario value is ALWAYS the full PostgREST result — `{ data, error }` — or a
    // function returning one. Never a bare payload that this fake then wraps: wrapping
    // silently produced `{ data: { data: … } }`, which the handler read as null and which
    // made a real assertion look like a code defect. Be strict rather than convenient (§13).
    const result = typeof configured === "function" ? configured(args) : configured;
    if (result === undefined) return { data: null, error: null };
    if (result === null || typeof result !== "object" || !("data" in result || "error" in result)) {
      throw new Error(
        `fake-supabase: scenario rpc "${name}" must return { data, error }; got ${JSON.stringify(result)}`,
      );
    }
    return result;
  }
}

/** Set before importing the module under test; consumed by `createClient`. */
let ACTIVE = { scenario: {}, recorder: mkRecorder() };

export function setScenario(scenario) {
  ACTIVE = { scenario, recorder: mkRecorder() };
  return ACTIVE.recorder;
}
export function recorder() { return ACTIVE.recorder; }

export function createClient(_url, key, _opts) {
  // The handler builds the JWT client with the ANON key and the service client with the
  // SERVICE_ROLE key. Distinguishing them lets a check prove which client asked what.
  const kind = String(key ?? "").includes("service") ? "service" : "jwt";
  // LIVE VIEWS OF `ACTIVE`, not the values it holds right now. Some production modules build a
  // client ONCE at module scope and memoize it — `_shared/llm-trace.ts` `traceAdmin()` is the one
  // that matters here — so a client created during the first drive was still writing into the
  // FIRST drive's recorder for the rest of the run. Every `paige_llm_trace` row was therefore
  // invisible to every check after the first, which is precisely why an attribution defect and
  // then its repair both went entirely unmeasured. Reading through a getter models the real
  // lifetime: one long-lived client, whichever scenario is current when it is USED.
  const live = {
    get scenario() { return ACTIVE.scenario; },
    get recorder() { return ACTIVE.recorder; },
  };
  return new FakeClient(kind, live, null);
}

export default { createClient };
