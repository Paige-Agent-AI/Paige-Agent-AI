import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateInvitationBindings} from './c0b-invitation-binding.mjs';
const chat=readFileSync(new URL('../../supabase/functions/paige-ai-chat/index.ts',import.meta.url),'utf8');
const edge=readFileSync(new URL('../../supabase/functions/solo-team-invitations/index.ts',import.meta.url),'utf8');
test('actual invitation Chat and protected wrapper bindings',()=>{const p=validateInvitationBindings(chat,edge);assert.deepEqual(p.findings,[]);assert.equal(p.tools.size,3);});
for(const [label,mutate] of [
 ['caller key replaced',s=>s.replace('createClient(supabaseUrl, supabaseKey, {','createClient(supabaseUrl, supabaseServiceKey, {')],
 ['invoke uses service client',s=>s.replace('supabaseClient.functions.invoke(\n                "solo-team-invitations"','supabase.functions.invoke(\n                "solo-team-invitations"')],
 ['explicit JWT removed',s=>s.replace('headers: { Authorization: authHeader },\n                  body: invokeBody','headers: { Authorization: "service" },\n                  body: invokeBody')],
 ['body uses model tenant',s=>s.replaceAll('expectedTenantId: personaCtx?.tenant_id ?? null','expectedTenantId: args.tenant_id')],
 ['resend route swapped',s=>s.replace('tc.function.name === "team_invite_resend" ? "resend" : "revoke"','tc.function.name === "team_invite_resend" ? "create" : "revoke"')],
 ['tenant mismatch guard removed',s=>s.replace('const wrongTenant = await teamSeamTenantMismatch();\n              if (wrongTenant) throw new Error(wrongTenant);\n              // The three invitation','const wrongTenant = null;\n              // The three invitation')],
])test(`fails closed Chat: ${label}`,()=>{const changed=mutate(chat);assert.notEqual(changed,chat);assert.ok(validateInvitationBindings(changed,edge).findings.length);});
for(const [label,mutate] of [
 ['fresh auth refusal removed',s=>s.replace('if (userError || !user)','if (false)')],
 ['actor supplied by JSON',s=>s.replaceAll('_actor: user.id','_actor: body.actorId')],
 ['workspace sent to SQL changed',s=>s.replaceAll('_expected_tenant_id: expectedTenantId','_expected_tenant_id: body.tenantId')],
 ['resend RPC swapped',s=>s.replace('"resend_solo_team_invite"','"create_solo_team_invite"')],
 ['revoke selector swapped',s=>s.replace('body.action === "revoke"','body.action === "create"')],
 ['auth client uses service key',s=>s.replace('createClient(url, anonKey, {','createClient(url, serviceKey, {')],
 ['authentication result forged',s=>s.replace('await authed.auth.getUser()','{data:{user:{id:body.actorId}},error:null}')],
])test(`fails closed wrapper: ${label}`,()=>{const changed=mutate(edge);assert.notEqual(changed,edge);assert.ok(validateInvitationBindings(chat,changed).findings.length);});

const sql=readFileSync(new URL('../../supabase/migrations/20261047000000_an_invitation_is_sent_to_the_workspace_the_owner_named.sql',import.meta.url),'utf8');
const {validateInvitationAuthoritySql}=await import('./c0b-invitation-binding.mjs');
test('canonical SQL authority is exact active owner/admin and service-only',()=>assert.deepEqual(validateInvitationAuthoritySql(sql),[]));
for(const [label,mutate] of [
 ['actor guard substituted',s=>s.replace('AND tm.user_id = _actor','AND tm.user_id = tm.user_id')],
 ['workspace predicate substituted',s=>s.replace('WHERE tm.tenant_id = _expected_tenant_id','WHERE tm.tenant_id = tm.tenant_id')],
 ['inactive member admitted',s=>s.replace("AND tm.status = 'active'","AND tm.status IN ('active','suspended')")],
 ['member allowed to invite',s=>s.replace("'admin'::public.tenant_role));","'member'::public.tenant_role));")],
 ['authenticated direct execute grant',s=>s.replace('TO service_role;','TO service_role, authenticated;')],
 ['canonical authority removed',s=>s.replace('_tenant := public.solo_team_invite_authority(_actor, _expected_tenant_id);','_tenant := _expected_tenant_id;')],
])test(`fails closed SQL contract: ${label}`,()=>{const changed=mutate(sql);assert.notEqual(changed,sql);assert.ok(validateInvitationAuthoritySql(changed).length);});

test('noncanonical wrapper factory is rejected',()=>assert.ok(validateInvitationBindings(chat,edge.replace('npm:@supabase/supabase-js@2','./untrusted-client.ts')).findings.length));
test('local actor shadow cannot satisfy protected binding',()=>{const changed=edge.replace('if (body.action === "create") {','if (body.action === "create") { const user={id:body.actorId};');assert.notEqual(changed,edge);assert.ok(validateInvitationBindings(chat,changed).findings.length);});
test('malformed source fails closed rather than throwing',()=>assert.ok(validateInvitationBindings('(',edge).findings.length));
test('verified user cannot be discarded for another actor binding',()=>{const changed=edge.replace('const { data: { user }, error: userError }','const { data: { ignoredUser }, error: userError }');assert.notEqual(changed,edge);assert.ok(validateInvitationBindings(chat,changed).findings.length);});
