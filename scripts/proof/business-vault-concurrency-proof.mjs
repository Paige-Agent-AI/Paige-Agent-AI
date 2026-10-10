// Disposable-loopback proof: two real PostgreSQL sessions confirm the same quarantined digest concurrently.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { retireSyntheticTenantSQL } from "./operator-postgres-fixture.mjs";

const runFile = promisify(execFile);
const [psql, port, user, database = "business_vault_test"] = process.argv.slice(2);
if (!psql || !/^\d+$/.test(port ?? "") || !/^[A-Za-z0-9_.-]+$/.test(user ?? "")
  || database !== "business_vault_test") {
  throw new Error("Explicit disposable local psql, port, user, and business_vault_test database required");
}
const args = ["-h", "127.0.0.1", "-p", port, "-U", user, "-d", database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"];
const query = async (sql) => (await runFile(psql, [...args, "-c", sql], { windowsHide: true })).stdout.trim();
const invoke = (sql) => new Promise((resolve, reject) => {
  const child = spawn(psql, args, { windowsHide: true });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.resume();
  child.on("error", () => reject(new Error("concurrency process unavailable")));
  child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error("concurrency query failed")));
  child.stdin.end(sql);
});

const tenant = randomUUID();
const actor = randomUUID();
const quarantineA = randomUUID();
const quarantineB = randomUUID();
const digest = "d".repeat(64);
const pathA = `${tenant}/${quarantineA}/${randomUUID()}`;
const pathB = `${tenant}/${quarantineB}/${randomUUID()}`;
try {
  await query(`
    INSERT INTO auth.users(id,aud,role,email) VALUES('${actor}','authenticated','authenticated','vault-race-${actor}@tests.invalid');
    INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features)
      VALUES('${tenant}','vault-race-${tenant}','Vault race','active','standalone','VRC',9799001,'{}');
    INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
      VALUES('${tenant}','${actor}','owner','active',true,now());
    INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${actor}','${tenant}')
      ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=excluded.active_tenant_id;
    INSERT INTO public.business_vault_inspection_configuration(id,adapter_key,enabled,pdf_ocr,image_ocr,
      secret_inspection,financial_sensitive_inspection) VALUES('vault','race-inspector',true,true,true,true,true);
    INSERT INTO public.business_vault_quarantine_uploads(id,tenant_id,requested_by,title,section,record_type,
      handling_mode,visibility,storage_path,original_filename,declared_mime,declared_size,adapter_key) VALUES
      ('${quarantineA}','${tenant}','${actor}','Race A','library','Evidence','store_only','owner_admin','${pathA}','a.pdf','application/pdf',100,'race-inspector'),
      ('${quarantineB}','${tenant}','${actor}','Race B','library','Evidence','store_only','owner_admin','${pathB}','b.pdf','application/pdf',100,'race-inspector');
    INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES
      ('business-vault-quarantine','${pathA}','${actor}','{"size":100}'),
      ('business-vault-quarantine','${pathB}','${actor}','{"size":100}');
  `);
  const call = (quarantine) => `
    BEGIN; SET LOCAL ROLE service_role;
    SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
    SELECT public.business_vault_mark_quarantine_stored('${actor}','${tenant}','${quarantine}',
      'application/pdf',100,'${digest}');
    COMMIT;`;
  const outputs = await Promise.all([invoke(call(quarantineA)), invoke(call(quarantineB))]);
  assert.equal(outputs.filter((value) => /"duplicate"\s*:\s*false/.test(value)).length, 1);
  assert.equal(outputs.filter((value) => /"duplicate"\s*:\s*true/.test(value)).length, 1);
  assert.equal(await query(`SELECT count(*) FROM public.business_vault_quarantine_uploads WHERE tenant_id='${tenant}' AND sha256='${digest}' AND inspection_state='stored';`), "1");
  assert.equal(await query(`SELECT count(*) FROM public.business_vault_quarantine_uploads WHERE tenant_id='${tenant}' AND inspection_state='cleanup_pending';`), "1");
  console.log("PASS: two concurrent quarantine confirmations produced one inspection candidate and one cleanup duplicate.");
} finally {
  await query(`
    DELETE FROM public.business_vault_inspection_events WHERE tenant_id='${tenant}';
    DELETE FROM public.business_vault_quarantine_uploads WHERE tenant_id='${tenant}';
    DELETE FROM storage.objects WHERE bucket_id='business-vault-quarantine' AND name IN('${pathA}','${pathB}');
    DELETE FROM public.business_vault_inspection_configuration WHERE id='vault';
    DELETE FROM public.tenant_members WHERE tenant_id='${tenant}';
    DELETE FROM public.profiles WHERE user_id='${actor}';
    ${retireSyntheticTenantSQL(tenant)}
    DELETE FROM auth.users WHERE id='${actor}';
  `);
}
