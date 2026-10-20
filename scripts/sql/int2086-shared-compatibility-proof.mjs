// Extend the existing Sales native-PG fixture; never connect to production or stop its cluster.
// Composed checkout: defaults to this repo. During unpublished collaboration, pass the Sales root.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const [binary, port, user, directory, salesRoot = fileURLToPath(new URL('../../', import.meta.url))] = process.argv.slice(2);
assert(binary && port && user && directory, 'Explicit isolated cluster required');
const root = fileURLToPath(new URL('../../', import.meta.url));
let source = readFileSync(`${salesRoot}/scripts/sql/sales-performance-proof.mjs`, 'utf8');
assert(source.includes("const forwardPath=option('--forward-migration');"), 'Composed Sales fixture required');
source = source.replace("'sales_performance_'+randomUUID()", "'analytics_calendar_'+randomUUID()");
source = source.replace("const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');", `const read=p=>readFileSync(${JSON.stringify(salesRoot)}+'/'+p,'utf8');`);
const sql = readFileSync(`${root}/supabase/migrations/20270601000006_int340_shared_metric_evidence.sql`, 'utf8');
const forward = readFileSync(`${root}/supabase/migrations/20271101110001_int2086_overdue_metric_compatibility.sql`, 'utf8');
const extra = `
run(\`CREATE TABLE analytics_evidence_reference(token_digest text PRIMARY KEY,issued_to uuid NOT NULL,tenant_id uuid NOT NULL,metric_id text NOT NULL CONSTRAINT analytics_evidence_reference_metric_id_check CHECK(metric_id<>'') ,range_key text NOT NULL CONSTRAINT analytics_evidence_reference_range_key_check CHECK(range_key<>'') ,range_start timestamptz,range_end timestamptz,source_revision_ref text,issued_at timestamptz,expires_at timestamptz,revoked_at timestamptz);
ALTER TABLE analytics_evidence_reference ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION resolve_analytics_evidence_reference(text) RETURNS jsonb LANGUAGE sql AS 'SELECT null::jsonb';\`);
run(${JSON.stringify(sql)});
const oldToken='aneb_v1_'+'a'.repeat(64);
run(\`INSERT INTO analytics_evidence_reference(token_digest,issued_to,tenant_id,metric_id,metric_version,dimensions,account_epoch,range_key,range_start,range_end,source_revision_ref,issued_at,expires_at)
 VALUES(encode(extensions.digest(convert_to('\${oldToken}','UTF8'),'sha256'),'hex'),'\${actor}','\${tenant}','sales.receivables.overdue_current','1.0.0','{}','\${tenant}','week',clock_timestamp()-interval '7 days',clock_timestamp()-interval '1 minute','old_source',clock_timestamp(),clock_timestamp()+interval '15 minutes');\`);
run(${JSON.stringify(forward)});
run(${JSON.stringify(forward)}); // replayable forward replacement, no applied-history rewrite
const issue=(key='sales.receivables.overdue_current',version='1.1.0',epoch=tenant)=>\`SELECT issue_analytics_evidence_bundle('\${key}','\${version}','{}','week',clock_timestamp()-interval '7 days',clock_timestamp()-interval '1 minute','\${epoch}');\`;
const resolved=ref=>\`SELECT resolve_analytics_evidence_reference('\${ref}');\`;
eq(run("SELECT count(*) FROM analytics_evidence_reference WHERE metric_id='sales.receivables.overdue_current' AND metric_version='1.0.0' AND revoked_at IS NOT NULL;"),'1');
denied(scope()+'SET ROLE authenticated;'+resolved(oldToken));
run(\`UPDATE tenant_business_time_zones SET time_zone='UTC',set_at=clock_timestamp()-interval '1 day' WHERE tenant_id='\${tenant}';\`);
const issued=json(scope()+'SET ROLE authenticated;'+issue());
eq(issued.metric_version,'1.1.0');eq(issued.business_time_zone.state,'configured');
eq(json(scope()+'SET ROLE authenticated;'+resolved(issued.evidence_ref)).evidence_ref,issued.evidence_ref);
denied(scope()+'SET ROLE authenticated;'+issue('sales.receivables.overdue_current','1.0.0'),'22023');
denied(scope()+'SET ROLE authenticated;'+issue('sales.cash.recorded_received','1.1.0'),'22023');
denied(scope()+'SET ROLE authenticated;'+issue('sales.receivables.overdue_current','1.1.0',foreign));
for(const role of ['anon','service_role'])denied(scope()+\`SET ROLE \${role};\`+issue());
denied(scope(otherActor,foreign)+'SET ROLE authenticated;'+resolved(issued.evidence_ref));
run(\`UPDATE tenant_members SET role='member' WHERE user_id='\${actor}';\`);denied(scope()+'SET ROLE authenticated;'+issue());
run(\`UPDATE tenant_members SET role='owner' WHERE user_id='\${actor}';\`);
run(\`UPDATE tenant_business_time_zones SET time_zone='America/New_York' WHERE tenant_id='\${tenant}';\`);
denied(scope()+'SET ROLE authenticated;'+resolved(issued.evidence_ref));
run(\`DELETE FROM tenant_business_time_zones WHERE tenant_id='\${tenant}';\`);
const missing=json(scope()+'SET ROLE authenticated;'+issue());eq(missing.values,null);eq(missing.truth_state,'UNAVAILABLE');eq(missing.coverage.reason,'business_time_zone_missing');
eq(missing.business_time_zone,{state:'missing',zone:null,set_at:null,as_of_date:null});
run(\`INSERT INTO tenant_business_time_zones(tenant_id,time_zone,set_by,set_at) VALUES('\${tenant}','Invalid/Zone','\${actor}',clock_timestamp()-interval '1 day');\`);
const invalid=json(scope()+'SET ROLE authenticated;'+issue());eq(invalid.values,null);eq(invalid.business_time_zone.zone,null);eq(invalid.coverage.reason,'business_time_zone_invalid');
run(\`UPDATE analytics_evidence_reference SET expires_at=clock_timestamp()-interval '1 second' WHERE token_digest=encode(extensions.digest(convert_to('\${invalid.evidence_ref}','UTF8'),'sha256'),'hex');\`);
denied(scope()+'SET ROLE authenticated;'+resolved(invalid.evidence_ref));
eq(json(scope()+'SET ROLE authenticated;'+issue('sales.cash.recorded_received','1.0.0')).metric_version,'1.0.0');
`;
assert(source.includes('const schema=run('), 'Missing Sales proof anchor');
source = source.replace('const schema=run(', () => '{\n' + extra + '\n}\nconst schema=run(');
source = source.replace("'synthetic isolated PostgreSQL; shared issuer/runtime not proven'", "'synthetic native PostgreSQL composed issuer/resolver; production authentication/runtime NOT proven'");
// The generated module is inside our root: its report and temporary files never touch Sales.
const temporary = new URL(`.int2086-${randomUUID()}.mjs`, import.meta.url);
try {
  writeFileSync(temporary, source);
  const result = spawnSync(process.execPath, [fileURLToPath(temporary), binary, port, user, directory, '--forward-migration', 'supabase/migrations/20271101110000_sales_overdue_business_calendar.sql'], {encoding:'utf8',windowsHide:true,maxBuffer:8e6});
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  process.exitCode = result.status ?? 1;
} finally { unlinkSync(temporary); }

