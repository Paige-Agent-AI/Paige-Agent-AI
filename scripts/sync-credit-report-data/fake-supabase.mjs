/**
 * A recording Supabase double for `sync-credit-report-data`.
 *
 * WHY THIS SHAPE. The function under test is the SHARED credit-profile writer with five
 * producers; the properties the checks assert are (a) which rows landed in which table,
 * (b) which writes were told to fail (so the RESPONSE's counting is checkable, not assumed),
 * and (c) the tenant/user scoping shape of every query. So the fake keeps a real per-table
 * row store, applies eq/is filters conjunctively like postgrest, applies updates to matched
 * rows only (zero-row updates are distinguishable via an optional .select() readback), and
 * can be told to fail a specific table+operation — the exact seam the #734 defects live on.
 *
 * Failure injection is `failures: [{ table, op, message, code }]` — first match wins, and a
 * failed write MUTATES NOTHING, the way a rejected postgrest request would not.
 */

let ACTIVE = { scenario: {}, rec: null };
let seq = 0;
let rowSeq = 0;

export function setScenario(scenario) {
  seq = 0;
  const rec = {
    calls: [],            // { table, op, client, filters, row, seq } in order
    rpc: [],              // { fn, args }
    invokes: [],          // { fn, body }
    errors: [],           // console.error captures
  };
  ACTIVE = {
    scenario: {
      db: {
        profiles: [],
        credit_negative_items: [],
        credit_inquiries: [],
        credit_accounts: [],
        credit_factor_scores: [],
        funding_readiness_scores: [],
        audit_logs: [],
        ...(scenario.db ?? {}),
      },
      user: scenario.user ?? null,
      isAdmin: scenario.isAdmin ?? false,
      failures: scenario.failures ?? [],
      alertInvokeError: scenario.alertInvokeError ?? null,
    },
    rec,
  };
  const origError = console.error;
  rec.restore = () => { console.error = origError; };
  console.error = (...a) => rec.errors.push(a.map(String).join(" "));
  return rec;
}

function matches(row, filters) {
  return filters.every(([op, col, val]) => {
    if (op === "eq") return row[col] === val;
    if (op === "is") return val === null ? row[col] == null : row[col] === val;
    throw new Error(`fake-supabase: unsupported filter ${op}`);
  });
}

class Builder {
  constructor(kind, table) {
    this._kind = kind; this._table = table; this._filters = []; this._op = "select";
    this._row = null; this._projection = null;
  }
  select(cols) { if (this._op === "update" || this._op === "insert") this._projection = cols; else this._op = "select"; return this; }
  update(row) { this._op = "update"; this._row = row; return this; }
  insert(row) { this._op = "insert"; this._row = row; return this; }
  eq(c, v) { this._filters.push(["eq", c, v]); return this; }
  is(c, v) { this._filters.push(["is", c, v]); return this; }

  _failure() {
    return ACTIVE.scenario.failures.find((f) => f.table === this._table && f.op === this._op) ?? null;
  }

  _settle(single) {
    const sc = ACTIVE.scenario;
    const store = sc.db[this._table] ?? [];
    const fail = this._failure();
    ACTIVE.rec.calls.push({ table: this._table, op: this._op, client: this._kind, filters: this._filters, row: this._row, seq: ++seq, failed: !!fail });

    if (this._op === "select") {
      const rows = store.filter((r) => matches(r, this._filters));
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    }
    if (fail) return { data: null, error: { message: fail.message ?? "injected failure", code: fail.code ?? "XX999" } };

    if (this._op === "update") {
      const matched = store.filter((r) => matches(r, this._filters));
      for (const r of matched) Object.assign(r, this._row);
      if (this._projection) {
        const cols = this._projection.split(",").map((c) => c.trim());
        return { data: matched.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), error: null };
      }
      return { data: null, error: null };
    }
    if (this._op === "insert") {
      const rows = Array.isArray(this._row) ? this._row : [this._row];
      for (const r of rows) {
        if (r.id == null) r.id = `gen-${++rowSeq}`;
        store.push(r);
      }
      return { data: null, error: null };
    }
    throw new Error(`fake-supabase: unsupported op ${this._op}`);
  }
  maybeSingle() { return Promise.resolve(this._settle(true)); }
  single() { return Promise.resolve(this._settle(true)); }
  then(res, rej) { return Promise.resolve(this._settle(false)).then(res, rej); }
}

class Client {
  constructor(kind) { this._kind = kind; }
  from(t) { return new Builder(this._kind, t); }
  get auth() {
    return {
      getUser: async () => {
        const u = ACTIVE.scenario.user;
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "no session" } };
      },
    };
  }
  rpc(fn, args) {
    ACTIVE.rec.rpc.push({ fn, args });
    if (fn === "has_role") return Promise.resolve({ data: ACTIVE.scenario.isAdmin, error: null });
    return Promise.resolve({ data: null, error: { message: `fake-supabase: unstubbed rpc ${fn}` } });
  }
  get functions() {
    return {
      invoke: async (fn, opts) => {
        ACTIVE.rec.invokes.push({ fn, body: opts?.body });
        const err = ACTIVE.scenario.alertInvokeError;
        return err ? { data: null, error: err } : { data: {}, error: null };
      },
    };
  }
}

export function createClient(_url, key, _opts) {
  return new Client(key === "service-role-key" ? "service" : "caller");
}

/** The live row stores, for assertions about what actually landed. */
export function db() { return ACTIVE.scenario.db; }
