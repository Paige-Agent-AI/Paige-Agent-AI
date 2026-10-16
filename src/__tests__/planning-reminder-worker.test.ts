import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { databaseAnswered } from '../../supabase/functions/_shared/approval-outcome';

// Execute the entire incumbent worker with protected data ports. No provider,
// production account, copied executor or replacement permission implementation.
const source = readFileSync('supabase/functions/plan-reminder-cron/index.ts', 'utf8');
const ast = ts.createSourceFile('reminder.ts', source, ts.ScriptTarget.Latest, true);
const body = ast.statements.filter(s => !ts.isImportDeclaration(s)).map(s => s.getText(ast)).join('\n');
const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, unknown>;
type QueryResult = { data: Row | Row[] | null; error: unknown };
type Query = PromiseLike<QueryResult> & {
  select(value: string): Query; eq(key: string, value: unknown): Query; is(key: string, value: unknown): Query;
  not(key: string, op: string, value: unknown): Query; lte(key: string, value: unknown): Query;
  order(): Query; limit(): Query; update(value: Row): Query; insert(value: Row[]): Query;
  maybeSingle(): Promise<QueryResult>;
};
type Options = { tenant?: string; authorized?: boolean; authError?: unknown;
  beforeClaim?: (row: Row) => void; beforeRelease?: (row: Row) => void;
  notificationError?: unknown; notificationThrows?: boolean; committedBeforeError?: boolean;
  teamError?: unknown; team?: boolean; providerThrows?: boolean; claimReply?: Row;
  teamEmpty?: boolean; email?: boolean; beforeMetadata?: (row: Row) => void };

function fixture(options: Options = {}) {
  const row: Row = { id: id(1), tenant_id: options.tenant ?? id(2), plan_id: null,
    title: 'Protected fixture reminder', summary: 'Fixture only', item_type: 'reminder',
    remind_at: '2000-01-01T00:00:00Z', reminded_at: null, remind_channel: options.email ? 'email' : 'in_app',
    remind_target: options.team ? 'team' : 'user', assigned_to_user_id: id(3), created_by: id(3),
    metadata: {}, status: 'open', updated_at: '2026-01-01T00:00:00.000000Z' };
  const notifications: Row[] = [], writes: Row[] = [];
  let version = 0, mutatedBeforeClaim = false, handler: (r: Request) => Promise<Response>;
  const stamp = () => `2026-02-01T00:00:00.${String(++version).padStart(6, '0')}Z`;
  const project = (value: Row, columns: string) => columns === '*' ? { ...value }
    : Object.fromEntries(columns.split(',').map(k => [k.trim(), value[k.trim()]]));
  const matches = (value: Row, filters: Array<[string, string, unknown]>) => filters.every(([key, op, expected]) => {
    if (op === 'not') return !String(expected).replace(/[()]/g, '').split(',').includes(String(value[key]));
    if (op === 'lte') return Date.parse(String(value[key])) <= Date.parse(String(expected));
    return value[key] === expected;
  });
  const admin = { rpc: async (name: string, args: Row) => {
    expect(name).toBe('verify_cron_token'); expect(args).toEqual({ _token: 'fixture-only' });
    return { data: options.authorized !== false, error: options.authError ?? null };
  }, from(table: string) {
    let values: Row | null = null, inserts: Row[] | null = null, columns = '*';
    const filters: Array<[string, string, unknown]> = [];
    const execute = async (): Promise<QueryResult> => {
      if (table === 'notifications') {
        if (options.notificationThrows) throw new Error('Fixture transport interruption');
        if (inserts && (!options.notificationError || options.committedBeforeError)) notifications.push(...structuredClone(inserts));
        return { data: null, error: options.notificationError ?? null };
      }
      if (table === 'tenant_members') return { data: options.teamError ? null : options.teamEmpty ? [] : [{ user_id: id(3) }], error: options.teamError ?? null };
      expect(table).toBe('plan_items');
      if (values) {
        if (values.reminded_at && !mutatedBeforeClaim) { mutatedBeforeClaim = true; options.beforeClaim?.(row); }
        if (values.reminded_at === null) options.beforeRelease?.(row);
        if ('metadata' in values) options.beforeMetadata?.(row);
        const found = matches(row, filters);
        writes.push({ values, filters: structuredClone(filters), matched: found });
        if (!found) return { data: null, error: null };
        Object.assign(row, values, { updated_at: stamp() });
        return { data: values.reminded_at && options.claimReply ? options.claimReply : project(row, columns), error: null };
      }
      return { data: matches(row, filters) ? [structuredClone(project(row, columns))] : [], error: null };
    };
    const query: Query = { select(value: string) { columns = value; return query; },
      eq(key: string, value: unknown) { filters.push([key, 'eq', value]); return query; },
      is(key: string, value: unknown) { filters.push([key, 'is', value]); return query; },
      not(key: string, _op: string, value: unknown) { filters.push([key, 'not', value]); return query; },
      lte(key: string, value: unknown) { filters.push([key, 'lte', value]); return query; },
      order() { return query; }, limit() { return query; },
      update(value: Row) { values = value; return query; },
      insert(value: Row[]) { inserts = value; return query; },
      maybeSingle: execute,
      then(resolve, reject) { return execute().then(resolve, reject); } };
    return query;
  } };
  new Function('Deno', 'createClient', 'commsProviderExecutionAllowed', 'databaseAnswered', 'fetch', compiled)(
    { env: { get: () => '' }, serve: (callback: typeof handler) => { handler = callback; } },
    () => admin, async () => { if (options.providerThrows) throw new Error('Fixture provider readiness unavailable'); return false; },
    databaseAnswered, () => { throw new Error('No external request permitted'); });
  const run = async () => {
    const response = await handler(new Request('https://fixture.invalid', { method: 'POST', headers: { 'x-cron-token': 'fixture-only' } }));
    return { status: response.status, result: await response.json() };
  };
  return { row, notifications, writes, run };
}

describe('native reminder claim and interrupted-delivery boundaries', () => {
  it('preserves the deployed Vault-only cron authentication in the release configuration', () => {
    const config = readFileSync('supabase/config.toml', 'utf8');
    const section = /\[functions\.plan-reminder-cron\]([\s\S]*?)(?=\n\[|$)/.exec(config)?.[1];
    expect(section, 'CLI release must preserve incumbent worker68 JWTfalse plus handler Vault verification').toBeTruthy();
    expect(section).toMatch(/^verify_jwt\s*=\s*false\s*(?:#.*)?$/m);
  });
  it.each([id(2), id(20)])('preserves the normal due-reminder path for neutral tenant %s', async tenant => {
    const f = fixture({ tenant }); const result = await f.run();
    expect(result.result).toMatchObject({ in_app: 1, claimed: 1, failed: 0 });
    expect(f.notifications).toHaveLength(1); expect(f.row.reminded_at).not.toBeNull();
  });
  it.each(['cancelled', 'done'])('does not dispatch a reminder changed to %s after the due scan', async status => {
    const f = fixture({ beforeClaim: row => { row.status = status; } });
    expect((await f.run()).result.in_app).toBe(0); expect(f.notifications).toHaveLength(0);
  });
  it('does not dispatch an old snapshot after a record-version change', async () => {
    const f = fixture({ beforeClaim: row => { row.updated_at = '2026-01-02T00:00:00Z'; row.title = 'Revised fixture'; } });
    expect((await f.run()).result.in_app).toBe(0); expect(f.notifications).toHaveLength(0);
  });
  it('does not dispatch a postponed reminder, even if the returned snapshot version is defective', async () => {
    const f = fixture({ beforeClaim: row => { row.remind_at = '2999-01-01T00:00:00Z'; } });
    expect((await f.run()).result.in_app).toBe(0); expect(f.notifications).toHaveLength(0);
  });
  it.each([{ tenant_id: id(30) }, { item_type: 'task' }])('cannot claim a mismatched resource %j', async change => {
    const f = fixture({ beforeClaim: row => Object.assign(row, change) });
    expect((await f.run()).result.in_app).toBe(0); expect(f.notifications).toHaveLength(0);
  });
  it('does not dispatch without the Vault verification result', async () => {
    for (const options of [{ authorized: false }, { authError: { code: 'fixture_error' } }]) {
      const f = fixture(options); expect((await f.run()).status).toBe(401);
      expect(f.writes).toHaveLength(0); expect(f.notifications).toHaveLength(0);
    }
  });
  it('keeps an ambiguous committed notification held across the next cron run', async () => {
    const f = fixture({ notificationError: { message: 'Fixture gateway interruption' }, committedBeforeError: true });
    await f.run(); expect(f.row.reminded_at).not.toBeNull();
    await f.run(); expect(f.notifications).toHaveLength(1);
  });
  it('does not reset a claim when notification dispatch throws', async () => {
    const f = fixture({ notificationThrows: true }); await f.run();
    expect(f.row.reminded_at).not.toBeNull();
  });
  it('permits the existing retry only after a single-statement database refusal', async () => {
    const f = fixture({ notificationError: { code: '23514', message: 'Fixture database refusal' } });
    await f.run(); expect(f.notifications).toHaveLength(0); expect(f.row.reminded_at).toBeNull();
  });
  it('does not cancel a team reminder on a membership-reader outage', async () => {
    const f = fixture({ team: true, teamError: { message: 'Fixture membership read outage' } });
    await f.run(); expect(f.row.status).toBe('open'); expect(f.row.reminded_at).toBeNull();
    expect(f.notifications).toHaveLength(0);
  });
  it('cannot clear a newer claim during pre-dispatch cleanup', async () => {
    const f = fixture({ notificationError: { code: '23514', message: 'Fixture database refusal' },
      beforeRelease: row => { row.reminded_at = '2026-03-01T00:00:00Z'; row.updated_at = '2026-03-01T00:00:00Z'; } });
    await f.run(); expect(f.row.reminded_at).toBe('2026-03-01T00:00:00Z');
  });
  it.each([{}, { id: id(99), updated_at: '2026-01-01T00:00:00Z' }, { id: id(1) }])('does not dispatch from an unverified claim reply %j', async claimReply => {
    const f = fixture({ claimReply }); await f.run(); expect(f.notifications).toHaveLength(0);
    expect(f.row.reminded_at).not.toBeNull();
  });
  it('marks a confirmed empty team undeliverable through its own claim', async () => {
    const f = fixture({ team: true, teamEmpty: true }); await f.run();
    expect(f.row.status).toBe('cancelled'); expect(f.notifications).toHaveLength(0);
  });
  it.each([{ team: true, teamEmpty: true }, { email: true }])('cannot overwrite a revised reminder from old metadata persistence %j', async options => {
    const f = fixture({ ...options, beforeMetadata: row => {
      row.updated_at = '2026-04-01T00:00:00Z'; row.metadata = { retained: 'Revised fixture' };
    } }); await f.run();
    expect(f.row.status).toBe('open'); expect(f.row.metadata).toEqual({ retained: 'Revised fixture' });
  });
  it('retains the tenant provider gate after confirmed internal delivery', async () => {
    const f = fixture({ email: true }); const result = await f.run();
    expect(result.result).toMatchObject({ in_app: 1, emailed: 0, email_blocked: 1 });
    expect(f.row.reminded_at).not.toBeNull();
  });
});
