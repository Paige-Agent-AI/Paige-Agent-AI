/**
 * A recording Supabase double for `paige-apply-extraction`.
 *
 * It records WHICH CLIENT made each call — caller (anon key + the caller's Authorization header)
 * versus service role — because that distinction is the whole §9 property of this function. A
 * fake that only recorded table and filters could not tell a correct authorization read from the
 * cross-tenant write primitive it would become on the service-role client.
 *
 * It also records ORDER, so "the row is claimed before anything is written" is checkable rather
 * than assumed.
 */
let ACTIVE = { scenario: {}, rec: null };
let seq = 0;

export function setScenario(scenario) {
  seq = 0;
  const rec = { reads: [], updates: [], inserts: [], errors: [], fetchSeq: undefined };
  ACTIVE = { scenario, rec };
  const origError = console.error;
  rec.restore = () => { console.error = origError; };
  console.error = (...a) => rec.errors.push(a.map(String).join(" "));
  return rec;
}

/** The outbound sync fetch is patched by the check; this records when it happened. */
const origFetch = globalThis.fetch;
globalThis.fetch = async (...a) => {
  if (ACTIVE.rec && ACTIVE.rec.fetchSeq === undefined) ACTIVE.rec.fetchSeq = ++seq;
  return origFetch(...a);
};

class Builder {
  constructor(kind, table) {
    this._kind = kind; this._table = table; this._filters = []; this._op = "select"; this._row = null;
  }
  select() { return this; }
  update(row) { this._op = "update"; this._row = row; return this; }
  insert(row) {
    this._op = "insert";
    ACTIVE.rec.inserts.push({ table: this._table, row, client: this._kind, seq: ++seq });
    return this;
  }
  eq(c, v) { this._filters.push(["eq", c, v]); return this; }

  _settle(single) {
    const sc = ACTIVE.scenario;
    if (this._op === "select") {
      ACTIVE.rec.reads.push({ table: this._table, client: this._kind, filters: this._filters, seq: ++seq });
      const row = sc.uploadRow ?? null;
      return { data: single ? row : (row ? [row] : []), error: null };
    }
    if (this._op === "update") {
      ACTIVE.rec.updates.push({ table: this._table, row: this._row, client: this._kind, filters: this._filters, seq: ++seq });
      // A release (back to awaiting_review) can be told to fail, so the "did it land?" path is
      // drivable — that is the half the review found unratcheted.
      if (this._row?.extraction_review_state === "awaiting_review" && sc.releaseError) {
        return { data: null, error: sc.releaseError };
      }
      // The claim returns the row only if IT made the transition; a scenario can say it lost.
      if (this._row?.extraction_review_state === "applied") {
        return { data: sc.claimReturns ?? [{ id: sc.uploadRow?.id }], error: null };
      }
      return { data: [{ id: sc.uploadRow?.id }], error: null };
    }
    return { data: null, error: null };
  }
  maybeSingle() { return Promise.resolve(this._settle(true)); }
  single() { return this.maybeSingle(); }
  then(res, rej) { return Promise.resolve(this._settle(false)).then(res, rej); }
}

class Client {
  constructor(kind) { this._kind = kind; }
  from(t) { return new Builder(this._kind, t); }
  // E09 F1b: the caller-tier check. Only the service client may ask (the function is service-only).
  rpc(fn, args) {
    const sc = ACTIVE.scenario;
    ACTIVE.rec.rpcs ??= [];
    ACTIVE.rec.rpcs.push({ fn, args, client: this._kind, seq: ++seq });
    if (fn === "_user_is_portal_customer_only" && this._kind === "service") {
      if (sc.tierError) return Promise.resolve({ data: null, error: { message: "tier read failed" } });
      return Promise.resolve({ data: (sc.portalCustomers ?? []).includes(args?._user), error: null });
    }
    return Promise.resolve({ data: null, error: { message: `fake-supabase: unstubbed rpc ${fn} on ${this._kind}` } });
  }
  get auth() {
    return {
      getUser: async () => {
        const u = ACTIVE.scenario.authUser;
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "no session" } };
      },
    };
  }
}

export function createClient(_url, key, opts) {
  // The caller's client is the one built with the anon key AND the caller's Authorization header.
  const isCaller = key === "anon-key" && !!opts?.global?.headers?.Authorization;
  return new Client(isCaller ? "caller" : "service");
}
