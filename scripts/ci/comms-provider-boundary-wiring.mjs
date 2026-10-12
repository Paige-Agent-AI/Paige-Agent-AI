// Structural regression alarm only. Actual loaded-handler and SQL tests supply behavioral proof.
// Newly introduced mailbox executors must consume the same floor before their owner may merge.
import {existsSync,readFileSync} from 'node:fs';
const required=['send-message','comms-email-command','send-transactional-email','gmail-oauth-start','gmail-oauth-callback','manage-tenant-domain','send-portal-invite','public-booking','booking-manage','process-booking-notifications','plan-reminder-cron','skill-runner','paige-mcp','tenant-signup','send-sms','send-sms-verification','send-sms-reminder','comms-purchase-number','voice-access-token','voice-twiml','smtp-connect','gmail-disconnect','comms-a2p-register'];
const future=['gmail-mailbox-sync','comms-mailbox-command'];
for(const name of [...required,...future]) {
 const file=`supabase/functions/${name}/index.ts`;
 if(!existsSync(file)&&future.includes(name))continue;
 const src=readFileSync(file,'utf8');
 if(!src.includes('comms-provider-boundary.ts')||!src.includes('await commsProviderExecutionAllowed('))throw Error(`${name}: canonical server provider floor missing; no independent mailbox bypass is permitted`);
}
const provision=readFileSync('supabase/functions/_shared/twilio-provision.ts','utf8');
if(!provision.includes('await commsProviderExecutionAllowed('))throw Error('shared Twilio provisioning floor missing');
console.log('Communications executor floor wiring PASS (structural only)');
