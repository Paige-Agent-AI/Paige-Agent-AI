import argparse,pathlib,subprocess,uuid
p=argparse.ArgumentParser(); p.add_argument('--psql',default='psql'); a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]; db='knowledge_publish_test_'+uuid.uuid4().hex
base=[a.psql,'-X','-h','127.0.0.1','-p','55439','-U','knowledge_test','-v','ON_ERROR_STOP=1']
def run(args):
 r=subprocess.run(base+args,cwd=root,text=True,capture_output=True); print(r.stdout); print(r.stderr)
 if r.returncode: raise RuntimeError('SQL failed')
run(['-d','postgres','-c','CREATE DATABASE '+db])
try:
 files=['scripts/knowledge-service/fixture.sql','scripts/knowledge-service/delete-fixture.sql','scripts/knowledge-service/review-fixture.sql','scripts/knowledge-service/durable-fixture.sql','supabase/migrations/20270417000000_paige_durable_work_envelope.sql','supabase/migrations/20270418000000_paige_durable_document_work.sql','supabase/migrations/20270531100000_knowledge_canonical_metadata.sql','supabase/migrations/20270531200000_knowledge_canonical_delete.sql','supabase/migrations/20270531400000_knowledge_review_foundation.sql','supabase/migrations/20270531600000_knowledge_durable_authority.sql','supabase/migrations/20270532000000_knowledge_extraction_work.sql','supabase/migrations/20270532010000_knowledge_review_management.sql']
 files+=['supabase/migrations/20270533000000_knowledge_publication.sql']*2
 files+=['scripts/knowledge-service/extraction-behavior.sql','scripts/knowledge-service/publication-behavior.sql']
 for f in files: run(['-d',db,'-f',f])
 print('PASS: native Knowledge publication SQL')
finally: run(['-d','postgres','-c','DROP DATABASE '+db])
