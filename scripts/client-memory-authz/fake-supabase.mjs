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
 *   • `tableErrors: { <table>: {message,code} }` injects a READ FAILURE. Without it the
 *     `if (error)` branches in the handler are unreachable by this harness, so a fail-closed
 *     path that only fires on a read error cannot be witnessed at all.
 *   • Unconfigured reads resolve to `{ data: [], error: null }` — an empty result, never
 *     an invented row. The handler's own try/catch then degrades exactly as in production.
 *   • `rpc()` results are configured PER SCENARIO, including error results, so a check can
 *     drive the real `KB_FORBIDDEN` rejection path instead of describing it.
 *
 * It is a test double for the module boundary only. No production code imports it.
 */

/** One recorded call, in order. */
function mkRecorder() {
  return { rpc: [], from: [], inserts: [], clients: [], uploads: [], functions: [] };
}

class QueryBuilder {
  constructor(table, liveRef, kind, authorization = null) {
    this._table = table;
    // WHICH CLIENT asked. Without this the recorder captured table/op/filters only, so a check
    // could assert the SHAPE of an authorization query but never its AUTHORITY — and swapping
    // the JWT client for the service-role one (the single token that reinstates the original
    // vulnerability) left the whole suite green. Recording the caller is what makes the one
    // property this fix depends on witnessable at all.
    this._kind = kind;
    this._authorization = authorization;
    this._live = liveRef;
    this._filters = [];
    this._insertError = null;
    this._ordered = false;
    this._limit = null;
    this._op = "select";
  }

  // Every filter/shape method records itself and chains. Recording the SHAPE (not just
  // the table) is what lets a check prove an unordered LIMIT 1 pick is gone.
  select(...a) { this._filters.push(["select", a[0]]); return this; }
  insert(row) {
    this._op = "insert";
    if (this._table === 'paige_pending_confirmations' && this._kind !== 'service') { this._insertError = {code:'42501',message:'canonical proposals are server writable only'}; return this; }
    const injected = this._injected();
    if (injected) { this._insertError = injected; return this; }
    this._live().recorder.inserts.push({ table: this._table, row });
    // LIVE hook, called synchronously as the write happens. A scenario that mirrors inserts only
    // AFTER the drive returns cannot model a row being written and then read back WITHIN the same
    // request — which is precisely the case a self-approval check has to exercise.
    // A CONSTRAINT VIOLATION IS A RESOLVED ERROR, NOT A THROW (postgrest-js defaults
    // `shouldThrowOnError` to false). `onInsert` may therefore RETURN an error to model one —
    // which is how a scenario reproduces the live-proposal unique index rejecting a duplicate.
    // Without this a fixture can only model a clash by silently dropping the row, and the handler
    // then sees a clean success: the two states it must tell apart become indistinguishable, and
    // a check that the distinction is load-bearing passes for the wrong reason.
    this._insertError = this._live().scenario.onInsert?.(this._table, row) ?? null;
    return this;
  }
  update(row) { this._op = "update"; this._filters.push(["update", row]); this._live().recorder.inserts.push({ table: this._table, row, update: true }); return this; }
  upsert(row) { this._op = "upsert"; this._live().recorder.inserts.push({ table: this._table, row, upsert: true }); return this; }
  delete() { this._op = "delete"; return this; }
  eq(c, v) { this._filters.push(["eq", c, v]); return this; }
  filter(c, op, v) { this._filters.push(["filter", c, op, v]); return this; }
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
  // Real postgrest-js has this. Without it, `traceLLMCall`'s `.insert(record).abortSignal(sig)`
  // throws a TypeError into its own swallowing catch — the row still lands in the recorder (insert
  // records synchronously), so an assertion about the row PASSES while the write path it is
  // supposed to be exercising actually died. A fixture that makes a broken path look healthy is
  // the failure mode this harness exists to avoid.
  abortSignal(sig) { void sig; this._filters.push(["abortSignal"]); return this; }

  _rows() {
    const svc = this._live().scenario.serviceTables?.[this._table];
    if (this._kind === "service" && svc !== undefined) {
      return (typeof svc === "function" ? svc(this._filters) : svc) ?? [];
    }
    const fn = this._live().scenario.tables?.[this._table];
    if (typeof fn === "function") return fn(this._filters) ?? [];
    if (Array.isArray(fn)) return fn;
    return [];
  }

  _record(single) {
    this._live().recorder.from.push({
      client: this._kind,
      authorization: this._authorization,
      table: this._table,
      op: this._op,
      filters: this._filters,
      ordered: this._ordered,
      limit: this._limit,
      single,
    });
  }

  /** An injected error, optionally scoped to ONE operation.
   *
   *  `tableErrors: { client_memory: e }` fails every op on the table; `{ "client_memory:insert": e }`
   *  fails only the insert. The distinction is load-bearing: failing the READ makes the handler
   *  refuse for unknown authority and never reach the write, so a table-wide error can never
   *  witness a rejected WRITE — which is exactly the class of bug the write checks exist to catch. */
  _injected() {
    if (this._table === 'paige_pending_confirmations' && this._op !== 'select' && this._kind !== 'service') return {code:'42501',message:'canonical proposals are server writable only'};
    if (this._insertError) return this._insertError;
    const t = this._live().scenario.tableErrors ?? {};
    const error = t[`${this._table}:${this._op}`] ?? t[this._table];
    return typeof error === 'function' ? error({op:this._op,filters:this._filters,client:this._kind}) : error;
  }

  async maybeSingle() {
    this._record(true);
    const injected = this._injected();
    if (injected) return Promise.resolve({ data: null, error: injected });
    const rows = await this._rows();
    if (this._table === "paige_pending_confirmations" && rows.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  single() { return this.maybeSingle(); }

  then(res, rej) {
    this._record(false);
    const injectedThen = this._injected();
    if (injectedThen) return Promise.resolve({ data: null, error: injectedThen, count: 0 }).then(res, rej);
    return Promise.resolve(this._rows()).then((rows) => ({ data: rows, error: null, count: rows.length })).then(res, rej);
  }
}

class FakeClient {
  constructor(kind, liveRef, authorization = null) {
    this._kind = kind; // "jwt" | "service"
    this._live = liveRef;
    this._authorization = authorization;
    this.auth = {
      getUser: async () => this._live().scenario.authUser
        ? { data: { user: this._live().scenario.authUser }, error: null }
        : { data: { user: null }, error: { message: "no user" } },
      getClaims: async () => ({ data: { claims: { sub: this._live().scenario.authUser?.id ?? null } }, error: null }),
    };
    // Record the upload PATH. A document is written to `${targetUserId}/…`, so the target is a
    // cross-tenant WRITE surface, not merely a read. Without recording it, reverting the upload
    // target to the raw body id left the whole suite green — the write went to another client's
    // folder and nothing observed it.
    this.storage = {
      from: (bucket) => ({
        upload: async (path, body, opts) => {
          this._live().recorder.uploads.push({ bucket, path, client: this._kind });
          void body; void opts;
          return { data: { path }, error: null };
        },
        createSignedUrl: async () => ({ data: null, error: null }),
        download: async () => ({ data: null, error: null }),
      }),
    };
    this.functions = { invoke: async (name, options) => {
      this._live().recorder.functions.push({ name, ...options, client: this._kind });
      // A scenario may answer for a function, as the full `{ data, error }` supabase-js returns
      // (or a function of the invoke options returning one) — needed to drive what the caller
      // does with each kind of answer, including the ones that never came back.
      const configured = this._live().scenario.functions?.[name];
      const result = typeof configured === "function" ? configured(options) : configured;
      return result ?? { data: null, error: null };
    } };
    this.channel = () => ({ send: async () => {}, subscribe: () => ({}), on: function () { return this; } });
    this.removeChannel = () => {};
  }

  from(table) { return new QueryBuilder(table, this._live, this._kind, this._authorization); }

  async rpc(name, args) {
    this._live().recorder.rpc.push({ client: this._kind, name, args, authorization: this._authorization });
    const configured = this._live().scenario.rpcs?.[name];
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

/**
 * Resolved LIVE, never captured at construction. Production code memoizes clients — the LLM
 * trace admin is built once and reused for the whole process — so a client captured with the
 * FIRST scenario's recorder keeps writing into it for every later scenario. That silently made
 * every "this turn wrote nothing" assertion blind to memoized-client writes (including the
 * trace row, which carries the prompt), and made the suite order-dependent: move a scenario and
 * a later turn's rows land in an earlier turn's recorder.
 */
function live() { return ACTIVE; }

export function createClient(_url, key, _opts) {
  // The handler builds the JWT client with the ANON key and the service client with the
  // SERVICE_ROLE key. Distinguishing them lets a check prove which client asked what.
  const kind = String(key ?? "").includes("service") ? "service" : "jwt";
  // KEY CHOICE IS NOT CALLER AUTHORITY. The anon key alone carries no user: without the
  // caller's JWT forwarded as an Authorization header, `auth.uid()` is NULL in Postgres, RLS
  // and every SECURITY DEFINER caller-guard are exempt, and a "JWT client" is really an anon
  // client. Record the header so a check can assert the authorization read was made with a
  // real caller identity, not merely with the right key.
  const authorization = _opts?.global?.headers?.Authorization ?? _opts?.global?.headers?.authorization ?? null;
  ACTIVE.recorder.clients.push({ kind, authorization });
  return new FakeClient(kind, live, authorization);
}

export default { createClient };
