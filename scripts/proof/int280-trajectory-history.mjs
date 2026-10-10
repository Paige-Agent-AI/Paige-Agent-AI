import { readFile } from 'node:fs/promises';
import { trajectoryFixture } from './int280-trajectory-fixture.mjs';
if(process.argv[2]!=='--postgres') throw new Error('Use --postgres with isolated CI or dedicated loopback fixture port.');
const db=await trajectoryFixture(Number(process.argv[3]??5432));
try {
  await db.exec(await readFile('supabase/tests/int280_trajectory_seed.sql','utf8'));
  const migration=await readFile('supabase/migrations/20270602000400_int280_durable_trajectory_history.sql','utf8');
  await db.exec(migration); await db.exec(migration);
  const proof=db.run(await readFile('supabase/tests/int280_trajectory_history.sql','utf8'));
  if(!proof.includes('PASS: canonical work history, replay, resume, privacy, boundedness and tamper refusal')) throw new Error('History proof completion missing');
  console.log(proof);
} finally { await db.close(); }
