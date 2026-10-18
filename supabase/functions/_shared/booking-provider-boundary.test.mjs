import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseAnswered } from './approval-outcome.ts';
const base = new URL('../', import.meta.url);
function source(name) { return (process.env.BOUNDARY_TEST_BASELINE ? execFileSync('git',['show',`${process.env.BOUNDARY_TEST_BASELINE}:supabase/functions/${name}/index.ts`],{encoding:'utf8'}) : readFileSync(new URL(`${name}/index.ts`, base),'utf8')).replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''); }
function harness(name, allowed, {providerOk=true,remindChannel='email',calendarTenant='tenant',fixtures,env}={}) {
 const writes=[], effects=[], scopes=[]; let planFired=false;
 const booking={id:'booking',tenant_id:'tenant',calendar_id:'calendar',host_user_id:'host',guest_email:'guest@example.test',guest_name:'Guest',status:'scheduled',start_at:new Date(Date.now()-120*60000).toISOString(),end_at:new Date(Date.now()-90*60000).toISOString(),timezone:'UTC',manage_token_version:0};
 const calendar={id:'calendar',tenant_id:calendarTenant,title:'Session',notify_config:{followup_guest:true,followup_offset_min:1}};
 const reminder={id:'reminder',tenant_id:'tenant',title:'Title',summary:'Summary',assigned_to_user_id:'host',remind_channel:remindChannel,metadata:{keep:true},updated_at:'2026-01-01T00:00:00Z'};
 // Provider-floor cases start from a legitimate owner and current recipient.
 // Authentication/recipient refusal is tested by the dedicated actual sender
 // suite; these controls must still reach and exercise the real provider floor.
 const data={internal_bookings:[booking],calendars:[calendar],tenants:[{id:'tenant',name:'Brand'}],plan_items:[reminder],tenant_invite_tokens:[{id:'invite',tenant_id:'tenant',contact_id:'contact',expires_at:'2099-01-01',email:'guest@example.test',kind:'consumer',revoked_at:null,uses:0,max_uses:1,last_used_at:null}],clients:[{id:'contact',tenant_id:'tenant',status:'active',merged_into_contact_id:null,do_not_contact:false,linked_user_id:null}],client_contact_methods:[{client_id:'contact',tenant_id:'tenant',kind:'email',is_primary:true,value:'guest@example.test'}]};
 fixtures?.({booking,calendar,data});
 const admin={rpc:async(rpc,args)=>{ if(rpc==='comms_provider_execution_allowed'){scopes.push(args);if(allowed==='throw')throw Error('database unavailable');return allowed==='error'?{data:true,error:{message:'unavailable'}}:{data:allowed,error:null};}return {data:rpc==='verify_cron_token'||(name==='send-portal-invite'&&rpc==='is_tenant_admin')?true:null,error:null};}, auth:{...(name==='send-portal-invite'?{getUser:async()=>({data:{user:{id:'controlled-owner'}},error:null})}:{}),admin:{getUserById:async()=>({data:{user:{email:'host@example.test'}}})}},from(table){let mutation=null,payload=null,write=null;const query=new Proxy({}, {get(_,prop){if(prop==='then')return resolve=>resolve({data:mutation?null:(table==='plan_items'&&planFired?[]:(data[table]||[])),error:null});if(prop==='maybeSingle'||prop==='single')return async()=>{if(table==='plan_items'&&mutation){if(payload?.reminded_at){if(planFired)return {data:null,error:null};planFired=true;reminder.updated_at='2026-01-02T00:00:00Z';}return {data:{id:'reminder',updated_at:reminder.updated_at},error:null};}return {data:mutation?{id:'reminder'}:(data[table]?.[0]??null),error:null};};return (...args)=>{if(['insert','update','delete'].includes(prop)){mutation=prop;payload=args[0];write={table,kind:prop,payload};writes.push(write);}else if(write&&['eq','is'].includes(prop))(write.filters??=[]).push([prop,...args]);return query;};}});return query;}};
 const ctx=vm.createContext({console,Response,Request,Headers,URL,TextEncoder,TextDecoder,crypto:webcrypto,btoa,atob,Date,databaseAnswered,createClient:()=>admin,clientIp:()=> 'test',overRateLimit:async()=>false,parseLifecycle:()=>[],channelsOf:()=>[],targetsOf:()=>[],primaryPhonesForUsers:async()=>new Map(),renderTemplate:(x)=>x,sendSms:async(...args)=>{effects.push({sms:args});return true;},Deno:{env:{get:(k)=>(env&&Object.prototype.hasOwnProperty.call(env,k)?env[k]:'configured')},serve:fn=>ctx.handler=fn},fetch:async(url,options)=>{effects.push({url,payload:JSON.parse(options.body)});return new Response(JSON.stringify({id:'controlled-message'}),{status:providerOk?200:503});}});
 const helper=readFileSync(new URL('_shared/comms-provider-boundary.ts',base),'utf8').replace(/\bexport /g,'');
 vm.runInContext(stripTypeScriptTypes(helper),ctx);
 // The real shared send gates the handlers import (E09 Slice 6): runPreSend and the contact opt-out
 // reader, each evaluated in its own scope so their module-level names cannot collide with a handler's.
 for(const [file,names] of [['_shared/pre-send-pipeline.ts',['normalizeAddress','runPreSend']],['_shared/contact-opt-outs.ts',['contactOptOuts','emailOptOut','isCustomerHeld']]]){
  const shared=stripTypeScriptTypes(readFileSync(new URL(file,base),'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'').replace(/\bexport /g,''));
  Object.assign(ctx,vm.runInContext(`(()=>{${shared}\nreturn {${names.join(',')}};})()`,ctx));
 }
 vm.runInContext(stripTypeScriptTypes(source(name)),ctx);
 if(name==='process-booking-notifications')vm.runInContext('manageUrl=async()=>"https://unit.test/manage";',ctx);
 if(name==='public-booking')vm.runInContext('loadCalendar=async()=>({tenant_id:"tenant",user_id:"host",appointmentTypes:[],horizonDays:60});',ctx);
 if(name==='booking-manage')vm.runInContext('verifyToken=async()=>({ok:true,bookingId:"booking",ver:0});syncZoom=async()=>effects.push({zoom:true});notifyChange=async()=>effects.push({notification:true});',Object.assign(ctx,{effects}));
 return {ctx,writes,effects,scopes,run:async(body)=>ctx.handler(new Request('https://unit.test',{method:'POST',headers:{'Content-Type':'application/json',...(name==='send-portal-invite'?{Authorization:'Bearer controlled-owner'}:{})},body:JSON.stringify(body??{})}))};
}
for(const mode of [false,'error','throw'])for(const name of ['public-booking','booking-manage','process-booking-notifications','plan-reminder-cron','send-portal-invite'])test(`${name}: ${mode} refuses all provider/queue effects`,async()=>{
 const h=harness(name,mode);const body=name==='public-booking'?{action:'create',slug:'synthetic',guest:{email:'guest@example.test'}}:name==='booking-manage'?{action:'cancel',token:'valid'}:name==='send-portal-invite'?{token:'valid',email:'guest@example.test'}:{};
 const res=await h.run(body);const output=await res.json();assert.equal(h.effects.length,0);assert.equal(h.scopes[0]._tenant_id,'tenant');assert.equal(h.writes.some(w=>['booking_notifications_sent','email_send_log'].includes(w.table)),false);
 if(name!=='plan-reminder-cron')assert.equal(h.writes.some(w=>w.table==='notifications'),false);
 if(name==='process-booking-notifications'){assert.equal(output.blocked,1);assert.equal(h.writes[0].payload.reminder_state.provider_execution,'blocked');}
 else if(name==='plan-reminder-cron'){assert.equal(output.emailed,0);assert.equal(output.in_app,1);assert.equal(output.email_blocked,1);assert.equal(h.writes[1].table,'notifications');assert.equal(h.writes[2].payload.metadata.provider_execution,'blocked');assert.equal(h.writes[2].payload.metadata.keep,true);assert.equal(h.writes.some(w=>w.payload?.status==='cancelled'),false);}
 else{assert.equal(res.status,403);assert.equal(output.code,'COMMS_PROVIDER_EXECUTION_DISABLED');assert.equal(h.writes.length,0);}
});
for(const name of ['send-portal-invite','plan-reminder-cron','process-booking-notifications'])for(const providerOk of [true,false])test(`${name}: ordinary tenant keeps delivery payload and provider failure truthful (${providerOk})`,async()=>{
 const h=harness(name,true,{providerOk});const res=await h.run(name==='send-portal-invite'?{token:'valid',email:'guest@example.test'}:{});const out=await res.json();assert.equal(h.effects.length,1);assert.equal(h.effects[0].url,'https://api.resend.com/emails');assert.deepEqual(Array.from(h.effects[0].payload.to),[name==='plan-reminder-cron'?'host@example.test':'guest@example.test']);assert.ok(h.effects[0].payload.html);assert.ok(h.effects[0].payload.subject);
 if(name==='send-portal-invite')assert.equal(out.emailed,providerOk);else if(name==='plan-reminder-cron')assert.equal(out.emailed,providerOk?1:0);else assert.equal(out.followups,providerOk?1:0);
});
test('public-booking ordinary validation remains unchanged',async()=>{const h=harness('public-booking',true);const res=await h.run({action:'create',slug:'normal'});assert.equal(res.status,400);assert.equal((await res.json()).error,'Invalid time.');});
test('booking-manage ordinary cancel retains exact domain patch and dispatch',async()=>{const h=harness('booking-manage',true);const res=await h.run({action:'cancel',token:'valid'});assert.equal(res.status,200);assert.equal((await res.json()).status,'cancelled');assert.equal(h.effects.length,2);assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0].payload)),{status:'cancelled',manage_token_version:1});});

for(const name of ['send-portal-invite','plan-reminder-cron','process-booking-notifications'])test(`${name}: normal provider request is byte-equivalent to pre-repair payload`,async()=>{
 const current=harness(name,true);
 const old=process.env.BOUNDARY_TEST_BASELINE;
 process.env.BOUNDARY_TEST_BASELINE='e82b93943d5807225387e21b3cc437c1e7fc6142';
 const baseline=harness(name,true);
 if(old)process.env.BOUNDARY_TEST_BASELINE=old;else delete process.env.BOUNDARY_TEST_BASELINE;
 const body=name==='send-portal-invite'?{token:'valid',email:'guest@example.test'}:{};
 await current.run(body);await baseline.run(body);
 assert.equal(JSON.stringify(current.effects),JSON.stringify(baseline.effects));
});

// E09 Slice 6 (§37, D5): a guest whose email is suppressed (here: they turned it off in their portal)
// gets no reminder or follow-up; the host's notification still goes; nothing is claimed for the guest.
const optedOut=({data})=>{data.paige_suppressions=[{tenant_id:'tenant',contact_id:'contact',channel:'email',reason:'customer_request',source:'customer_portal'}];};
test('process-booking-notifications: an opted-out guest gets no follow-up, and nothing is claimed for them',async()=>{
 const h=harness('process-booking-notifications',true,{fixtures:optedOut});
 const out=await (await h.run({})).json();
 assert.equal(out.followups,0);assert.equal(out.guest_email_opted_out,1);assert.equal(h.effects.length,0);
 assert.equal(h.writes.some(w=>w.table==='booking_notifications_sent'),false);
});
test('process-booking-notifications: a reminder to both still reaches the host when the guest opted out',async()=>{
 const h=harness('process-booking-notifications',true,{fixtures:(f)=>{optedOut(f);f.booking.start_at=new Date(Date.now()+30*60000).toISOString();f.booking.end_at=new Date(Date.now()+60*60000).toISOString();f.calendar.notify_config={reminders:[{channel:'email',offset_min:60,to:'both'}]};}});
 const out=await (await h.run({})).json();
 assert.equal(out.reminders,1);assert.equal(h.effects.length,1);assert.deepEqual(Array.from(h.effects[0].payload.to),['host@example.test']);
});

for(const mode of [false,'error','throw'])test(`plan-reminder: restricted in_app remains internal-only (${mode})`,async()=>{
 const h=harness('plan-reminder-cron',mode,{remindChannel:'in_app'});
 const out=await (await h.run({})).json();
 assert.equal(out.in_app,1);assert.equal(out.emailed,0);assert.equal(out.email_blocked,0);assert.equal(h.effects.length,0);assert.equal(h.scopes.length,0);
 assert.equal(h.writes.length,2);assert.equal(h.writes[1].table,'notifications');assert.equal(h.writes[0].payload.reminded_at!==null,true);
});

for(const channel of ['email','in_app'])test(`plan-reminder ${channel}: a claimed restricted reminder neither duplicates internal delivery nor retries external delivery`,async()=>{
 const h=harness('plan-reminder-cron',false,{remindChannel:channel});
 const first=await (await h.run({})).json();
 const second=await (await h.run({})).json();
 assert.equal(first.in_app,1);assert.equal(second.in_app,0);assert.equal(second.scanned,0);assert.equal(h.effects.length,0);
 assert.equal(h.writes.filter(w=>w.table==='notifications').length,1);assert.equal(h.scopes.length,channel==='email'?1:0);
});

for(const calendarTenant of [null,42,{},[]])test(`scheduled booking malformed tenant (${JSON.stringify(calendarTenant)}) fails closed`,async()=>{
 const h=harness('process-booking-notifications',false,{calendarTenant});
 const out=await (await h.run({})).json();
 assert.equal(h.scopes.length,0);assert.equal(out.blocked,1);assert.equal(h.effects.length,0);
 assert.equal(h.writes.some(w=>w.table==='booking_notifications_sent'),false);
});

// --- Signed-in customer mode (Customer Portal Sessions) ----------------------
// The customer path reuses the guest engine's rules and writes. Identity comes
// from the caller's own session (a user-scoped client), admission from
// client_portal_session_change_admit; these drive the real handler with a
// controlled admission verdict and assert what reached the database and the
// provider stubs. Fixtures are synthetic (Northwind Studio / Jordan Rivera).
const slotRulesSource = stripTypeScriptTypes(readFileSync(new URL('_shared/slotRules.ts', base), 'utf8').replace(/\bexport /g, ''));
const MIN = 60000;
const BOOKING_ID = 'b0000000-0000-4000-8000-000000000001';
const ADMITTED = { ok: true, booking_id: BOOKING_ID, tenant_id: 'tenant', client_id: 'contact', deadline: null };
// The customer path's writes are conditional (status, current start), so its bookings table is
// filter-aware: eq/neq select and update the rows they match, an update changes them in place, and
// `.select()` after an update returns the rows it changed. `applied` records each update that
// changed at least one row. `concurrent: n` holds every booking load until n requests have loaded,
// so n requests all read the same pre-write state, exactly as two racing requests can.
function customerHarness({ admit = ADMITTED, user = { id: 'customer-user' }, allowed = true, startInMin = 180, minNotice = 60, availability = null, bookingExtra = {}, calendarExtra = {}, extraBookings = [], concurrent = 0, updateError = null, env } = {}) {
 let store;
 const h = harness('booking-manage', allowed, { env, fixtures: ({ booking, calendar, data }) => {
  store = data;
  const start = Date.now() + startInMin * MIN;
  Object.assign(booking, { id: BOOKING_ID, contact_id: 'contact', guest_name: 'Jordan Rivera', start_at: new Date(start).toISOString(), end_at: new Date(start + 30 * MIN).toISOString(), booking_kind: 'single' }, bookingExtra);
  Object.assign(calendar, { title: 'Northwind Studio consult', min_notice_min: minNotice, duration_min: 30, enabled: true, ...(availability ? { availability_json: availability } : {}) }, calendarExtra);
  data.tenants[0].name = 'Northwind Studio';
  for (const extra of extraBookings) data.internal_bookings.push({ ...booking, ...extra });
 } });
 const admin = h.ctx.createClient();
 const applied = [];
 let loads = 0; const waiting = [];
 const loaded = async () => { loads += 1; if (!concurrent || loads >= concurrent) { waiting.splice(0).forEach((go) => go()); return; } await new Promise((go) => waiting.push(go)); };
 const baseFrom = admin.from;
 admin.from = (table) => {
  if (table !== 'internal_bookings') return baseFrom.call(admin, table);
  const filters = []; let mutation = null, payload = null, returning = false;
  const matches = (r) => filters.every(([op, k, v]) => (op === 'eq' ? String(r[k]) === String(v) : String(r[k]) !== String(v)));
  const exec = async () => {
   await Promise.resolve();
   if (mutation === 'update' && updateError) return { data: null, error: updateError };
   const hit = store.internal_bookings.filter(matches);
   if (mutation === 'update') {
    for (const r of hit) Object.assign(r, JSON.parse(JSON.stringify(payload)));
    if (hit.length) applied.push({ kind: 'update', ids: hit.map((r) => r.id) });
    return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
   }
   return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const q = {
   eq: (k, v) => { filters.push(['eq', k, v]); return q; }, neq: (k, v) => { filters.push(['neq', k, v]); return q; },
   gte: () => q, lte: () => q, in: () => q,
   select: () => { if (mutation) returning = true; return q; },
   update: (p) => { mutation = 'update'; payload = p; h.writes.push({ table: 'internal_bookings', kind: 'update', payload: p }); return q; },
   maybeSingle: async () => { const r = await exec(); await loaded(); return { data: r.data?.[0] ?? null, error: null }; },
   then: (ok, ko) => exec().then(ok, ko),
  };
  return q;
 };
 const baseRpc = admin.rpc;
 admin.rpc = async (fn, args) => {
  if (fn !== '_portal_session_move_class_seat') return baseRpc(fn, args);
  await Promise.resolve();
  const seat = store.internal_bookings.find((r) => r.id === args.p_seat_id && r.booking_kind === 'class_seat' && r.status === 'scheduled' && r.start_at === args.p_expected_start);
  if (!seat) return { data: { moved: false }, error: null };
  Object.assign(seat, { start_at: args.p_new_start_at, end_at: args.p_new_end_at });
  applied.push({ kind: 'class_move', ids: [seat.id] });
  return { data: { moved: true, start_at: seat.start_at }, error: null };
 };
 const calls = [];
 const userClient = {
  auth: { getUser: async (jwt) => { calls.push({ getUser: jwt }); return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }; } },
  rpc: async (fn, args) => { calls.push({ rpc: fn, args }); return typeof admit === 'function' ? admit(args) : { data: admit, error: null }; },
 };
 h.ctx.createClient = (url, key, opts) => { if (opts?.global?.headers?.Authorization) { calls.push({ client: opts.global.headers.Authorization }); return userClient; } return admin; };
 vm.runInContext(slotRulesSource, h.ctx);
 const run = async (body, jwt = 'customer-jwt') => h.ctx.handler(new Request('https://unit.test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
 const plain = (x) => JSON.parse(JSON.stringify(x));
 return { ...h, calls, run, plain, applied, rows: () => store.internal_bookings, bookingWrites: () => h.writes.filter((w) => w.table === 'internal_bookings'), auditWrites: () => h.writes.filter((w) => w.table === 'audit_logs') };
}
const cancelBody = { mode: 'customer', action: 'cancel', booking_id: BOOKING_ID, request_id: 'req-cancel-1', tenant_id: 'tenant' };

test('booking-manage customer mode: no session is refused 401 before admission, with no write or effect', async () => {
 const h = customerHarness();
 const res = await h.run(cancelBody, null);
 assert.equal(res.status, 401);
 assert.equal((await res.json()).code, 'AUTH_REQUIRED');
 assert.equal(h.calls.some((c) => c.rpc), false);
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: a JWT that resolves no user is refused 401 before admission', async () => {
 const h = customerHarness({ user: null });
 const res = await h.run(cancelBody);
 assert.equal(res.status, 401);
 assert.equal((await res.json()).code, 'AUTH_REQUIRED');
 assert.deepEqual(h.plain(h.calls.filter((c) => c.getUser)), [{ getUser: 'customer-jwt' }]);
 assert.equal(h.calls.some((c) => c.rpc), false);
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: a request carrying a link token is refused 400 and never reaches either proof', async () => {
 const h = customerHarness();
 const res = await h.run({ ...cancelBody, token: 'valid' });
 assert.equal(res.status, 400);
 assert.equal((await res.json()).code, 'BAD_REQUEST');
 assert.equal(h.calls.length, 0);
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: admission runs as the caller, with the request as sent', async () => {
 const h = customerHarness({ admit: { ok: false, error: 'SESSION_NOT_FOUND' } });
 await h.run({ ...cancelBody });
 assert.deepEqual(h.plain(h.calls.filter((c) => c.client)), [{ client: 'Bearer customer-jwt' }]);
 assert.deepEqual(h.plain(h.calls.filter((c) => c.rpc)), [{ rpc: 'client_portal_session_change_admit', args: { p_booking_id: BOOKING_ID, p_action: 'cancel', p_request_id: 'req-cancel-1', p_new_start: null, p_tenant_id: 'tenant' } }]);
});

for (const [refusal, status] of [['SESSION_NOT_FOUND', 403], ['SESSION_CHANGE_WINDOW_CLOSED', 409], ['SESSION_NOT_CHANGEABLE', 409], ['REQUEST_ID_CONFLICT', 409], ['REQUEST_ID_REQUIRED', 409]]) test(`booking-manage customer mode: admission refusal ${refusal} is ${status}, with no write and no notification`, async () => {
 const deadline = '2026-01-01T10:00:00.000Z';
 const h = customerHarness({ admit: { ok: false, error: refusal, ...(refusal === 'SESSION_CHANGE_WINDOW_CLOSED' ? { deadline } : {}) } });
 const res = await h.run(cancelBody);
 const out = await res.json();
 assert.equal(res.status, status); assert.equal(out.ok, false); assert.equal(out.code, refusal);
 if (refusal === 'SESSION_CHANGE_WINDOW_CLOSED') assert.equal(out.deadline, deadline);
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0); assert.equal(h.scopes.length, 0);
});

for (const [error, status, code] of [[{ code: '42501', message: 'select an authorized customer relationship' }, 409, 'MULTIPLE_RELATIONSHIPS'], [{ code: '42501', message: 'customer authentication required' }, 401, 'AUTH_REQUIRED'], [{ code: '22P02', message: 'invalid input syntax for type uuid' }, 400, 'BAD_REQUEST'], [{ code: 'PGRST202', message: 'function not found' }, 500, 'ADMISSION_FAILED']]) test(`booking-manage customer mode: admission error ${error.code} (${code}) writes nothing`, async () => {
 const h = customerHarness({ admit: () => ({ data: null, error }) });
 const res = await h.run(cancelBody);
 assert.equal(res.status, status); assert.equal((await res.json()).code, code);
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: a replay is 200 with zero writes and zero effects', async () => {
 const h = customerHarness({ admit: { ok: true, replay: true, status: 'cancelled' } });
 const res = await h.run(cancelBody);
 assert.equal(res.status, 200);
 assert.deepEqual(await res.json(), { ok: true, replay: true });
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0); assert.equal(h.scopes.length, 0);
});

test('booking-manage customer mode: a successful cancel writes the attributed patch, one audit row, and dispatches once', async () => {
 const h = customerHarness({ startInMin: 180, minNotice: 60 });
 const before = Date.now();
 const res = await h.run(cancelBody);
 assert.equal(res.status, 200);
 assert.deepEqual(await res.json(), { ok: true, status: 'cancelled' });
 const bw = h.bookingWrites();
 assert.equal(bw.length, 1); assert.equal(bw[0].kind, 'update');
 const patch = h.plain(bw[0].payload);
 assert.ok(Date.parse(patch.cancelled_at) >= before - 1000 && Date.parse(patch.cancelled_at) <= Date.now() + 1000);
 assert.deepEqual({ ...patch, cancelled_at: 'stamp' }, { status: 'cancelled', manage_token_version: 1, cancelled_at: 'stamp', cancelled_by: 'customer-user', cancellation_reason: 'customer_portal' });
 const aw = h.auditWrites();
 assert.equal(aw.length, 1); assert.equal(aw[0].kind, 'insert');
 const audit = h.plain(aw[0].payload);
 assert.deepEqual({ ...audit, data: { ...audit.data, from_start: typeof audit.data.from_start } }, { user_id: 'customer-user', action: 'client_portal_cancel', entity: 'internal_booking', entity_id: BOOKING_ID, data: { tenant_id: 'tenant', client_id: 'contact', portal_request_id: 'req-cancel-1', from_start: 'string', to_start: null } });
 assert.equal(h.writes.indexOf(bw[0]) < h.writes.indexOf(aw[0]), true);
 assert.deepEqual(h.plain(h.effects), [{ zoom: true }, { notification: true }]);
 assert.equal(h.scopes[0]._tenant_id, 'tenant');
});

test('booking-manage customer mode: the notice window is re-checked on the ORIGINAL start before the write, even after admission passed', async () => {
 // Admission said yes, but by the time the writer runs the booking is 30 min out on a 60 min window.
 const h = customerHarness({ startInMin: 30, minNotice: 60 });
 const res = await h.run(cancelBody);
 const out = await res.json();
 assert.equal(res.status, 409); assert.equal(out.code, 'SESSION_CHANGE_WINDOW_CLOSED');
 assert.equal(Date.parse(out.deadline) < Date.now(), true);
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: a booking that is not the admitted customer\'s is SESSION_NOT_FOUND, never written', async () => {
 const h = customerHarness({ bookingExtra: { contact_id: 'another-contact' } });
 const res = await h.run(cancelBody);
 assert.equal(res.status, 403); assert.equal((await res.json()).code, 'SESSION_NOT_FOUND');
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: comms boundary off refuses with its machine code and no write', async () => {
 const h = customerHarness({ allowed: false });
 const res = await h.run(cancelBody);
 assert.equal(res.status, 403); assert.equal((await res.json()).code, 'COMMS_PROVIDER_EXECUTION_DISABLED');
 assert.equal(h.calls.filter((c) => c.rpc === 'client_portal_session_change_admit').length, 1);
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: rate limiting carries RATE_LIMITED; the guest 429 body is unchanged', async () => {
 const h = customerHarness();
 h.ctx.overRateLimit = async () => true;
 const res = await h.run(cancelBody);
 assert.equal(res.status, 429); assert.equal((await res.json()).code, 'RATE_LIMITED');
 const g = harness('booking-manage', true);
 g.ctx.overRateLimit = async () => true;
 const gres = await g.run({ action: 'cancel', token: 'valid' });
 assert.equal(gres.status, 429);
 assert.deepEqual(await gres.json(), { error: 'Too many requests — please try again shortly.' });
 assert.equal(h.writes.length + g.writes.length, 0);
});

test('booking-manage customer mode: the per-booking throttle also carries RATE_LIMITED and writes nothing', async () => {
 const h = customerHarness();
 h.ctx.overRateLimit = async (_client, key) => key.startsWith('bm:tok:');
 const res = await h.run(cancelBody);
 assert.equal(res.status, 429); assert.equal((await res.json()).code, 'RATE_LIMITED');
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

// Every day open 00:00–23:30 UTC in 30-minute slots.
const OPEN_ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '00:00', end: '23:30' }));
function tomorrowAtUtc(h, m) { const d = new Date(Date.now() + 86_400_000); d.setUTCHours(h, m, 0, 0); return d.toISOString(); }

test('booking-manage customer mode: a successful reschedule moves the booking through the slot rules and audits from/to', async () => {
 const h = customerHarness({ startInMin: 2 * 24 * 60, minNotice: 60, availability: OPEN_ALL_DAY });
 const to = tomorrowAtUtc(12, 0);
 const res = await h.run({ mode: 'customer', action: 'reschedule', booking_id: BOOKING_ID, request_id: 'req-move-1', start: to });
 assert.equal(res.status, 200);
 assert.deepEqual(await res.json(), { ok: true, status: 'scheduled', start_at: to });
 assert.deepEqual(h.plain(h.calls.find((c) => c.rpc).args), { p_booking_id: BOOKING_ID, p_action: 'reschedule', p_request_id: 'req-move-1', p_new_start: to, p_tenant_id: null });
 const bw = h.bookingWrites();
 assert.equal(bw.length, 1);
 assert.deepEqual(h.plain(bw[0].payload), { start_at: to, end_at: new Date(Date.parse(to) + 30 * MIN).toISOString() });
 const aw = h.auditWrites();
 assert.equal(aw.length, 1);
 const audit = h.plain(aw[0].payload);
 assert.equal(audit.action, 'client_portal_reschedule'); assert.equal(audit.entity, 'internal_booking'); assert.equal(audit.user_id, 'customer-user');
 assert.deepEqual(Object.keys(audit.data).sort(), ['client_id', 'from_start', 'portal_request_id', 'tenant_id', 'to_start']);
 assert.equal(audit.data.to_start, to); assert.equal(audit.data.portal_request_id, 'req-move-1');
 assert.equal(Date.parse(audit.data.from_start) > Date.parse(to), true);
 assert.deepEqual(h.plain(h.effects), [{ zoom: true }, { notification: true }]);
});

test('booking-manage customer mode: a reschedule to a time that is not a slot is SLOT_UNAVAILABLE, with no write', async () => {
 const h = customerHarness({ startInMin: 2 * 24 * 60, availability: OPEN_ALL_DAY });
 const res = await h.run({ mode: 'customer', action: 'reschedule', booking_id: BOOKING_ID, request_id: 'req-move-2', start: tomorrowAtUtc(12, 7) });
 assert.equal(res.status, 409); assert.equal((await res.json()).code, 'SLOT_UNAVAILABLE');
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: a valid new slot is still refused when the ORIGINAL start is inside the window', async () => {
 const h = customerHarness({ startInMin: 30, minNotice: 60, availability: OPEN_ALL_DAY });
 const res = await h.run({ mode: 'customer', action: 'reschedule', booking_id: BOOKING_ID, request_id: 'req-move-3', start: tomorrowAtUtc(12, 0) });
 assert.equal(res.status, 409); assert.equal((await res.json()).code, 'SESSION_CHANGE_WINDOW_CLOSED');
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: an action other than cancel/reschedule is refused before admission', async () => {
 const h = customerHarness();
 const res = await h.run({ ...cancelBody, action: 'manage' });
 assert.equal(res.status, 400); assert.equal((await res.json()).code, 'BAD_ACTION');
 assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
});

// The guest link path is the anti-regression floor (CLAUDE.md §58): for every
// guest request shape, the handler with customer mode must answer, write and
// dispatch exactly as booking-manage did before customer mode existed.
const GUEST_BASELINE = 'e0f8e40add39d76a739328c6275d00bc0702dbb8';
function guestHarness(atBaseline) {
 const old = process.env.BOUNDARY_TEST_BASELINE;
 if (atBaseline) process.env.BOUNDARY_TEST_BASELINE = GUEST_BASELINE;
 try {
  const h = harness('booking-manage', true, { fixtures: ({ booking, calendar }) => {
   const start = Date.UTC(2099, 0, 5, 10, 0);
   Object.assign(booking, { start_at: new Date(start).toISOString(), end_at: new Date(start + 30 * MIN).toISOString(), booking_kind: 'single' });
   Object.assign(calendar, { availability_json: OPEN_ALL_DAY, duration_min: 30, min_notice_min: 60, booking_horizon_days: 400000 });
  } });
  vm.runInContext(slotRulesSource, h.ctx);
  return h;
 } finally { if (old) process.env.BOUNDARY_TEST_BASELINE = old; else delete process.env.BOUNDARY_TEST_BASELINE; }
}
for (const [label, body, limited] of [
 ['cancel', { action: 'cancel', token: 'valid' }],
 ['manage', { action: 'manage', token: 'valid' }],
 ['reschedule to a slot', { action: 'reschedule', token: 'valid', start: tomorrowAtUtc(12, 0) }],
 ['reschedule off-slot', { action: 'reschedule', token: 'valid', start: tomorrowAtUtc(12, 7) }],
 ['reschedule without a time', { action: 'reschedule', token: 'valid' }],
 ['unknown action', { action: 'bogus', token: 'valid' }],
 ['throttled', { action: 'cancel', token: 'valid' }, true],
]) test(`booking-manage guest link (${label}) is byte-equivalent to the pre-customer-mode engine`, async () => {
 const observe = async (h) => {
  if (limited) h.ctx.overRateLimit = async () => true;
  const res = await h.run(body);
  const out = JSON.parse(JSON.stringify(await res.json()));
  return JSON.stringify({ status: res.status, out, writes: h.writes.map((w) => ({ table: w.table, kind: w.kind, payload: w.payload })), effects: h.effects });
 };
 const current = await observe(guestHarness(false));
 if (label === 'reschedule to a slot' || label === 'cancel') assert.equal(JSON.parse(current).status, 200);
 assert.equal(current, await observe(guestHarness(true)));
});

// --- Customer mode: concurrency, generic failures, edge validation ------------
// Two identical customer requests that both pass admission before either has written must
// change the booking ONCE: one audit row, one Zoom call, one notification; the other answers
// as a replay. The store applies each write's own conditions, and both requests are held until
// both have loaded the booking, so each is deciding from the same pre-write state.
const LEG_2 = 'b0000000-0000-4000-8000-000000000002';
const raceCases = [
 ['single cancel', {}, () => ({ ...cancelBody }), { status: 'cancelled' }],
 ['single reschedule', { startInMin: 2 * 24 * 60, availability: OPEN_ALL_DAY }, () => ({ mode: 'customer', action: 'reschedule', booking_id: BOOKING_ID, request_id: 'req-race-move', start: tomorrowAtUtc(12, 0) })],
 ['collective cancel', { bookingExtra: { booking_kind: 'collective', collective_group_id: 'meeting-1' }, extraBookings: [{ id: LEG_2, host_user_id: 'host-2' }] }, () => ({ ...cancelBody })],
 ['collective reschedule', { startInMin: 2 * 24 * 60, availability: OPEN_ALL_DAY, bookingExtra: { booking_kind: 'collective', collective_group_id: 'meeting-1' }, extraBookings: [{ id: LEG_2, host_user_id: 'host-2' }] }, () => ({ mode: 'customer', action: 'reschedule', booking_id: BOOKING_ID, request_id: 'req-race-move', start: tomorrowAtUtc(12, 0) })],
 ['class-seat reschedule', { startInMin: 2 * 24 * 60, availability: OPEN_ALL_DAY, bookingExtra: { booking_kind: 'class_seat' } }, () => ({ mode: 'customer', action: 'reschedule', booking_id: BOOKING_ID, request_id: 'req-race-move', start: tomorrowAtUtc(12, 0) })],
];
for (const [label, opts, body] of raceCases) test(`booking-manage customer mode: two identical ${label} requests at once change the booking once; the second is a replay`, async () => {
 const h = customerHarness({ ...opts, concurrent: 2 });
 const [a, b] = await Promise.all([h.run(body()), h.run(body())]);
 const outs = [await a.json(), await b.json()];
 assert.deepEqual([a.status, b.status], [200, 200]);
 assert.equal(outs.filter((o) => o.replay === true).length, 1, JSON.stringify(outs));
 assert.deepEqual(h.plain(outs.find((o) => o.replay)), { ok: true, replay: true });
 assert.equal(outs.find((o) => !o.replay).ok, true);
 assert.equal(h.applied.length, 1, JSON.stringify(h.applied));
 if (label.startsWith('collective')) assert.deepEqual(h.plain(h.applied[0].ids).sort(), [BOOKING_ID, LEG_2]);
 assert.equal(h.auditWrites().length, 1);
 assert.deepEqual(h.plain(h.effects), [{ zoom: true }, { notification: true }]);
});

test('booking-manage customer mode: a request that finds the booking already changed by another writes nothing more', async () => {
 // Sequential form of the race: another request committed between this one's load and its write.
 const loadedThenChanged = customerHarness();
 const admin = loadedThenChanged.ctx.createClient();
 const baseFrom = admin.from;
 let n = 0;
 admin.from = (table) => {
  const q = baseFrom(table);
  if (table === 'internal_bookings' && (n += 1) === 1) {
   const ms = q.maybeSingle;
   q.maybeSingle = async () => { const r = await ms(); loadedThenChanged.rows()[0].status = 'cancelled'; return r; };
  }
  return q;
 };
 const res = await loadedThenChanged.run(cancelBody);
 assert.equal(res.status, 200);
 assert.deepEqual(await res.json(), { ok: true, replay: true });
 assert.equal(loadedThenChanged.applied.length, 0);
 assert.equal(loadedThenChanged.auditWrites().length, 0);
 assert.equal(loadedThenChanged.effects.length, 0);
});

const RAW_REREAD_TEXT = 'reread-secret relation detail';
/** A harness whose first booking load returns as loaded, then lets `afterLoad` change the stored row;
 *  `reread` (optional) replaces the result of every later single-row read — the re-read after a no-op write. */
function rereadAfterNoop(afterLoad, reread) {
 const h = customerHarness();
 const admin = h.ctx.createClient();
 const baseFrom = admin.from;
 let loads = 0;
 admin.from = (table) => {
  const q = baseFrom(table);
  if (table === 'internal_bookings') {
   const ms = q.maybeSingle;
   q.maybeSingle = async () => {
    loads += 1;
    if (loads > 1 && reread) return reread;
    const r = await ms();
    if (loads === 1) afterLoad(h.rows()[0]);
    return r;
   };
  }
  return q;
 };
 return h;
}

test('booking-manage customer mode: a no-op write whose re-read finds the booking now belongs to someone else is SESSION_NOT_FOUND, never replay', async () => {
 const h = rereadAfterNoop((row) => { row.status = 'cancelled'; row.contact_id = 'another-contact'; });
 const res = await h.run(cancelBody);
 assert.equal(res.status, 403);
 assert.equal((await res.json()).code, 'SESSION_NOT_FOUND');
 assert.equal(h.applied.length, 0); assert.equal(h.auditWrites().length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: a no-op write whose re-read fails is CHANGE_FAILED, never replay', async () => {
 const h = rereadAfterNoop((row) => { row.status = 'cancelled'; }, { data: null, error: { code: 'XX000', message: RAW_REREAD_TEXT } });
 const err = console.error; console.error = () => {};
 let res; try { res = await h.run(cancelBody); } finally { console.error = err; }
 const text = await res.text();
 assert.equal(res.status, 500);
 assert.deepEqual(JSON.parse(text), { ok: false, code: 'CHANGE_FAILED', error: 'This change could not be completed.' });
 assert.equal(text.includes('reread-secret'), false);
 assert.equal(h.auditWrites().length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: a reschedule is refused when the calendar was paused after admission', async () => {
 const h = customerHarness({ startInMin: 2 * 24 * 60, availability: OPEN_ALL_DAY, calendarExtra: { enabled: false } });
 const res = await h.run({ mode: 'customer', action: 'reschedule', booking_id: BOOKING_ID, request_id: 'req-paused', start: tomorrowAtUtc(12, 0) });
 assert.equal(res.status, 409); assert.equal((await res.json()).code, 'SESSION_CHANGE_UNAVAILABLE');
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: a paused calendar still lets the customer cancel', async () => {
 const h = customerHarness({ calendarExtra: { enabled: false } });
 const res = await h.run(cancelBody);
 assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true, status: 'cancelled' });
 assert.equal(h.applied.length, 1);
});

test('booking-manage customer mode: a booking id that is not a UUID is BAD_REQUEST before admission runs', async () => {
 const h = customerHarness();
 for (const bad of ['booking', '', 42, null, "b0000000-0000-4000-8000-000000000001' OR 1=1"]) {
  const res = await h.run({ ...cancelBody, booking_id: bad });
  assert.equal(res.status, 400, String(bad)); assert.equal((await res.json()).code, 'BAD_REQUEST');
 }
 assert.equal(h.calls.some((c) => c.rpc), false);
 assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
});

const RAW_DB_TEXT = 'duplicate key value violates unique constraint "internal_bookings_secret_idx"';
for (const [label, opts, body] of [
 ['cancel', {}, () => cancelBody],
 ['reschedule', { startInMin: 2 * 24 * 60, availability: OPEN_ALL_DAY }, () => ({ mode: 'customer', action: 'reschedule', booking_id: BOOKING_ID, request_id: 'req-fail', start: tomorrowAtUtc(12, 0) })],
 ['collective reschedule', { startInMin: 2 * 24 * 60, availability: OPEN_ALL_DAY, bookingExtra: { booking_kind: 'collective', collective_group_id: 'meeting-1' } }, () => ({ mode: 'customer', action: 'reschedule', booking_id: BOOKING_ID, request_id: 'req-fail', start: tomorrowAtUtc(12, 0) })],
]) test(`booking-manage customer mode: a failed ${label} write is a coded generic 500 with no database text`, async () => {
 const h = customerHarness({ ...opts, updateError: { code: 'XX000', message: RAW_DB_TEXT } });
 const logged = []; const err = console.error; console.error = (...a) => logged.push(a.join(' '));
 let res; try { res = await h.run(body()); } finally { console.error = err; }
 const text = await res.text();
 assert.equal(res.status, 500);
 assert.deepEqual(JSON.parse(text), { ok: false, code: 'CHANGE_FAILED', error: 'This change could not be completed.' });
 assert.equal(text.includes('duplicate key'), false);
 assert.equal(logged.some((l) => l.includes(RAW_DB_TEXT)), true, 'the detail is logged loudly');
 assert.equal(h.auditWrites().length, 0); assert.equal(h.effects.length, 0);
});

test('booking-manage customer mode: an admission database error is a coded generic 500 with no database text', async () => {
 const h = customerHarness({ admit: () => ({ data: null, error: { code: 'XX000', message: RAW_DB_TEXT } }) });
 const err = console.error; console.error = () => {};
 let res; try { res = await h.run(cancelBody); } finally { console.error = err; }
 const text = await res.text();
 assert.equal(res.status, 500);
 assert.deepEqual(JSON.parse(text), { ok: false, code: 'ADMISSION_FAILED', error: 'This change could not be completed.' });
});

test('booking-manage customer mode: an unexpected throw is a coded generic 500; the guest link keeps its old body', async () => {
 const boom = new Error(RAW_DB_TEXT);
 const h = customerHarness();
 h.ctx.overRateLimit = async (_c, key) => { if (key.startsWith('bm:tok:')) throw boom; return false; };
 const err = console.error; console.error = () => {};
 let res; try { res = await h.run(cancelBody); } finally { console.error = err; }
 assert.equal(res.status, 500);
 assert.deepEqual(await res.json(), { ok: false, code: 'CHANGE_FAILED', error: 'This change could not be completed.' });
 const g = harness('booking-manage', true);
 g.ctx.overRateLimit = async (_c, key) => { if (key.startsWith('bm:tok:')) throw boom; return false; };
 const gres = await g.run({ action: 'cancel', token: 'valid' });
 assert.equal(gres.status, 500); assert.deepEqual(await gres.json(), { error: RAW_DB_TEXT });
});

// --- Customer mode: a write that changed nothing is "done" only if it IS done -------------
// Between this request loading the booking and writing it, someone else changes it. The
// conditional write then changes zero rows; the answer must follow the booking's state NOW:
// a replay only when it already is what this request asked for, otherwise a 409 — never a
// "Moved"/"Cancelled" for a change that did not happen.
function changedAfterLoad(h, mutate) {
 const admin = h.ctx.createClient();
 const baseFrom = admin.from;
 let n = 0;
 admin.from = (table) => {
  const q = baseFrom(table);
  if (table === 'internal_bookings' && (n += 1) === 1) {
   const ms = q.maybeSingle;
   q.maybeSingle = async () => { const r = await ms(); for (const row of h.rows()) mutate(row); return r; };
  }
  return q;
 };
 return h;
}
const T2 = () => tomorrowAtUtc(12, 0);
const T3 = () => tomorrowAtUtc(15, 0);
const branchOpts = {
 single: { startInMin: 2 * 24 * 60, availability: OPEN_ALL_DAY },
 collective: { startInMin: 2 * 24 * 60, availability: OPEN_ALL_DAY, bookingExtra: { booking_kind: 'collective', collective_group_id: 'meeting-1' }, extraBookings: [{ id: LEG_2, host_user_id: 'host-2' }] },
 'class-seat': { startInMin: 2 * 24 * 60, availability: OPEN_ALL_DAY, bookingExtra: { booking_kind: 'class_seat' } },
};
const moveBody = (id) => ({ mode: 'customer', action: 'reschedule', booking_id: BOOKING_ID, request_id: id, start: T2() });
const nothingHappened = (h) => {
 assert.equal(h.applied.length, 0, JSON.stringify(h.applied));
 assert.equal(h.auditWrites().length, 0);
 assert.equal(h.effects.length, 0);
};
for (const branch of Object.keys(branchOpts)) {
 test(`booking-manage customer mode (${branch}): staff cancelled it in between, so the reschedule is 409, not a replay`, async () => {
  const h = changedAfterLoad(customerHarness(branchOpts[branch]), (r) => { r.status = 'cancelled'; });
  const res = await h.run(moveBody('req-cancelled-between'));
  const out = await res.json();
  assert.equal(res.status, 409, JSON.stringify(out)); assert.equal(out.ok, false); assert.equal(out.code, 'SESSION_NOT_CHANGEABLE');
  nothingHappened(h);
 });
 test(`booking-manage customer mode (${branch}): another tab moved it to T3, so a reschedule to T2 is 409 naming where it is now`, async () => {
  const t3 = T3();
  const h = changedAfterLoad(customerHarness(branchOpts[branch]), (r) => { r.start_at = t3; r.end_at = new Date(Date.parse(t3) + 30 * MIN).toISOString(); });
  const res = await h.run(moveBody('req-moved-between'));
  const out = await res.json();
  assert.equal(res.status, 409, JSON.stringify(out)); assert.equal(out.ok, false); assert.equal(out.code, 'SLOT_UNAVAILABLE');
  assert.equal(out.current_start, t3);
  assert.equal(h.rows().every((r) => r.start_at === t3), true, 'the other tab\'s move stands');
  nothingHappened(h);
 });
 test(`booking-manage customer mode (${branch}): a true duplicate (already at T2) is still a replay`, async () => {
  const t2 = T2();
  const h = changedAfterLoad(customerHarness(branchOpts[branch]), (r) => { r.start_at = t2; r.end_at = new Date(Date.parse(t2) + 30 * MIN).toISOString(); });
  const res = await h.run(moveBody('req-dup'));
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true, replay: true });
  nothingHappened(h);
 });
}
for (const branch of ['class-seat', 'collective']) test(`booking-manage customer mode (${branch}): a reschedule is refused when the calendar was paused after admission`, async () => {
 const h = customerHarness({ ...branchOpts[branch], calendarExtra: { enabled: false } });
 const res = await h.run(moveBody('req-paused-' + branch));
 assert.equal(res.status, 409); assert.equal((await res.json()).code, 'SESSION_CHANGE_UNAVAILABLE');
 nothingHappened(h);
 assert.equal(h.bookingWrites().length, 0);
});

test('booking-manage customer mode: a single cancel racing a move cancels nothing and names the moved time', async () => {
 const h0 = customerHarness();
 const loadedStart = h0.rows()[0].start_at;
 const t3 = new Date(Date.parse(loadedStart) + 3 * 60 * MIN).toISOString();
 const h = changedAfterLoad(h0, (r) => { r.start_at = t3; });
 const res = await h.run(cancelBody);
 const out = await res.json();
 assert.equal(res.status, 409, JSON.stringify(out)); assert.equal(out.code, 'SESSION_NOT_CHANGEABLE'); assert.equal(out.current_start, t3);
 assert.equal(h.rows()[0].status, 'scheduled', 'the moved session is not cancelled');
 nothingHappened(h);
});

test('booking-manage customer mode: a single cancel that finds staff already cancelled it is a replay with nothing sent', async () => {
 const h = changedAfterLoad(customerHarness(), (r) => { r.status = 'cancelled'; });
 const res = await h.run(cancelBody);
 assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true, replay: true });
 nothingHappened(h);
});

test('booking-manage: a missing server secret is a coded generic 500 for a customer; the guest link keeps its old body', async () => {
 const env = { SUPABASE_SERVICE_ROLE_KEY: undefined };
 const h = customerHarness({ env });
 const logged = []; const err = console.error; console.error = (...a) => logged.push(a.join(' '));
 let res; try { res = await h.run(cancelBody); } finally { console.error = err; }
 assert.equal(res.status, 500);
 assert.deepEqual(await res.json(), { ok: false, code: 'CHANGE_FAILED', error: 'This change could not be completed.' });
 assert.equal(logged.some((l) => l.includes('not configured')), true, 'the cause is logged');
 assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.effects.length, 0);
 const g = harness('booking-manage', true, { env });
 const gres = await g.run({ action: 'cancel', token: 'valid' });
 assert.equal(gres.status, 500); assert.deepEqual(await gres.json(), { error: 'server not configured' });
 assert.equal(g.writes.length, 0);
});
test('send-portal-invite: the legacy token path holds an invitation to a client who turned email off',async()=>{
 const h=harness('send-portal-invite',true,{fixtures:optedOut});
 const res=await h.run({token:'valid',email:'guest@example.test'});const out=await res.json();
 assert.equal(res.status,409);assert.equal(out.code,'INVITATION_POLICY_HELD');assert.equal(h.effects.length,0);
});

// E09 Slice 6 round 4 (verifier MEDIUM 1): a held legacy send must not leave the token it was handed live
// for 30 days, or staff see "Invite pending" / "Cancel pending invitation" for an email that never went.
// The revoke is the same lifecycle write the staff cancel path makes (PortalInvitationManager): stamp
// revoked_at on that exact, still-unused consumer row.
const revokeOf=(h)=>h.writes.filter(w=>w.table==='tenant_invite_tokens'&&w.kind==='update');
function assertExactRevoke(h){
 const revokes=revokeOf(h);assert.equal(revokes.length,1,'the minted token is revoked exactly once');
 assert.deepEqual(Object.keys(revokes[0].payload),['revoked_at']);assert.ok(Number.isFinite(Date.parse(revokes[0].payload.revoked_at)));
 const filters=JSON.stringify(revokes[0].filters);
 for(const f of [['eq','id','invite'],['eq','tenant_id','tenant'],['eq','contact_id','contact'],['eq','kind','consumer'],['is','revoked_at',null],['is','last_used_at',null],['eq','uses',0],['is','portal_operation_id',null]])
  assert.ok(filters.includes(JSON.stringify(f)),`revoke is scoped by ${JSON.stringify(f)}`);
}
const quietHours=({data})=>{const h=new Date().getUTCHours(),hm=(x)=>`${String((x+24)%24).padStart(2,'0')}:00:00`;
 data.tenant_comms_preferences=[{autosend_dnd_enabled:true,autosend_dnd_start:hm(h-1),autosend_dnd_end:hm(h+2),autosend_dnd_timezone:'UTC',autosend_dnd_channels:['email']}];};
test('send-portal-invite: a held send (first check) revokes the token it was handed and keeps the 409 shape',async()=>{
 const h=harness('send-portal-invite',true,{fixtures:optedOut});const errs=console.error;console.error=()=>{};
 let res;try{res=await h.run({token:'valid',email:'guest@example.test'});}finally{console.error=errs;}const out=await res.json();
 assert.equal(res.status,409);assert.deepEqual(out,{ok:false,emailed:false,status:'held',code:'INVITATION_POLICY_HELD',hold:'contact'});
 assert.equal(h.effects.length,0);assertExactRevoke(h);
});
test('send-portal-invite: a hold that appears at the final pre-provider check also revokes the token',async()=>{
 let reads=0;const lateOptOut=({data})=>{Object.defineProperty(data,'paige_suppressions',{enumerable:true,get:()=>++reads>1?[{tenant_id:'tenant',contact_id:'contact',channel:'email',reason:'customer_request'}]:[]});};
 const h=harness('send-portal-invite',true,{fixtures:lateOptOut});const errs=console.error;console.error=()=>{};
 let res;try{res=await h.run({token:'valid',email:'guest@example.test'});}finally{console.error=errs;}const out=await res.json();
 assert.equal(reads,2,'both pre-send checks ran');assert.equal(res.status,409);assert.equal(out.code,'INVITATION_POLICY_HELD');
 assert.equal(h.effects.length,0);assertExactRevoke(h);
});
test('send-portal-invite: the business\'s own email quiet hours are named as the cause, not the client',async()=>{
 const h=harness('send-portal-invite',true,{fixtures:quietHours});const errs=console.error;console.error=()=>{};
 let res;try{res=await h.run({token:'valid',email:'guest@example.test'});}finally{console.error=errs;}const out=await res.json();
 assert.equal(res.status,409);assert.equal(out.code,'INVITATION_POLICY_HELD');assert.equal(out.hold,'business_quiet_hours');
 assert.equal(h.effects.length,0);assertExactRevoke(h);
});
test('send-portal-invite (verifier MINOR 2): a pre-send check that fails is not reported as a client hold, and nothing is sent',async()=>{
 const broken=({data})=>{Object.defineProperty(data,'paige_suppressions',{enumerable:true,get:()=>{throw Error('suppression read unavailable');}});};
 const h=harness('send-portal-invite',true,{fixtures:broken});const errs=console.error;console.error=()=>{};
 let res;try{res=await h.run({token:'valid',email:'guest@example.test'});}finally{console.error=errs;}const out=await res.json();
 assert.equal(res.status,503);assert.deepEqual(out,{ok:false,emailed:false,status:'unavailable',code:'INVITATION_POLICY_UNAVAILABLE'});
 assert.equal(h.effects.length,0);assertExactRevoke(h);
});
test('send-portal-invite: an ordinary send revokes nothing',async()=>{
 const h=harness('send-portal-invite',true);const res=await h.run({token:'valid',email:'guest@example.test'});
 assert.equal(res.status,200);assert.equal(h.effects.length,1);assert.equal(revokeOf(h).length,0);
});
