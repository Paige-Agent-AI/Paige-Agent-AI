import assert from 'node:assert/strict';

// The ORIGINAL fenced Agreements database gains only the row types missing
// from its old fixture. Actual Communications bodies/grants and actual Rail
// already installed by the original program are used; no native writer mocks.
export function installOriginalAgreementComms({sql,read}){
 const base='supabase/migrations/20270597000000_comms_email_send.sql';
 const latest='supabase/migrations/20271110220000_followup_email_origin_admission.sql';
 const extract=(file,name)=>{const m=read(file).match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\bAS\\s+(\\$[A-Za-z_0-9]*\\$)[\\s\\S]*?\\1\\s*;','i'));assert(m,'Original native '+name);return m[0];};
 const grants=(file,name)=>[...read(file).matchAll(new RegExp('(?:REVOKE|GRANT)\\s+[^;]*?\\bFUNCTION\\s+public\\.'+name+'\\s*\\([^;]*;','gi'))].map(m=>m[0]).join('\n');
 const table=(file,name)=>{const m=read(file).match(new RegExp('CREATE TABLE public\\.'+name+'\\([\\s\\S]*?;'));assert(m&&m[0].trim().endsWith(');'),'Original fixture row type '+name);return m[0];};
 // Supabase's original pgcrypto lives in extensions; the older Agreements
 // fixture installed the SAME extension in public. Use its actual functions,
 // not a replacement hash implementation or a synthetic digest return.
 sql(`CREATE SCHEMA IF NOT EXISTS extensions;ALTER EXTENSION pgcrypto SET SCHEMA extensions;
  GRANT USAGE ON SCHEMA extensions TO anon,authenticated,service_role;`);
 sql(`ALTER TABLE public.channel_connectors ADD from_name text,ADD from_address text,ADD reply_to text,
   ADD mailbox_class text NOT NULL DEFAULT 'shared_support',ADD mailbox_owner_user_id uuid REFERENCES auth.users(id);`);
 sql(table('scripts/sql/comms-email-send-concurrency-schema.sql','messages'));
 const origin='scripts/sql/comms-email-origin-admission-schema.sql';
 for(const name of ['paige_pending_approvals','paige_action_kinds','paige_actions'])sql(table(origin,name));
 const domain=read(origin).match(/CREATE TABLE public\.tenant_email_domains\([^;]+;/);assert(domain);sql(domain[0]);
 for(const name of ['_comms_email_actor','_comms_email_governance','_comms_email_reconcilable','_comms_email_message_guard','finalize_comms_email_send','read_comms_email_send_result']){
  sql(extract(base,name));sql(grants(base,name));
 }
 for(const name of ['prepare_comms_email_send','read_comms_email_send_binding','claim_comms_email_send']){sql(extract(latest,name));sql(grants(base,name));}
 const sendgrid='supabase/migrations/20271031000100_paige_email_sendgrid_governed_door.sql';
 sql(extract(sendgrid,'_comms_email_sendgrid_sender_verified'));sql(grants(sendgrid,'_comms_email_sendgrid_sender_verified'));
 for(const name of ['messages_comms_email_operation','messages_comms_email_content']){
  const m=read(base).match(new RegExp('CREATE (?:UNIQUE )?INDEX IF NOT EXISTS '+name+'[\\s\\S]*?;'));assert(m);sql(m[0]);
 }
 sql(`CREATE OR REPLACE TRIGGER comms_email_message_guard BEFORE INSERT OR UPDATE ON public.messages
   FOR EACH ROW EXECUTE FUNCTION public._comms_email_message_guard();`);
}

// Non-agreement compatibility campaign in the ORIGINAL Comms runner. The full
// migration/private helpers are tested above in the Agreements database; here
// only the four exact changed public bodies replace their incumbent versions.
// No agreement helper is mocked or callable from this generic-only campaign.
export function installAgreementCommsCompatibility({sql,read}){
 const source=read('supabase/migrations/20271114190004_e04_agreement_message_origin.sql');
 for(const name of ['_comms_email_governance','prepare_comms_email_send','read_comms_email_send_binding','claim_comms_email_send']){
  const m=source.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\bAS\\s+(\\$[A-Za-z_0-9]*\\$)[\\s\\S]*?\\1\\s*;','i'));
  assert(m,'Actual candidate Communications function '+name);sql(m[0]);
 }
 console.log('Agreement extension: four exact candidate public bodies installed for original generic-only compatibility; private/full migration proof remains the separate Agreements campaign.');
}
