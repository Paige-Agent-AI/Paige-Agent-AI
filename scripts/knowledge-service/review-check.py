"""Local foundation SQL proof; dependencies model Supabase identity and vector distance."""
import pathlib, subprocess, uuid, argparse
p=argparse.ArgumentParser(); p.add_argument('--psql',default='psql'); p.add_argument('--baseline',action='store_true'); p.add_argument('--suite',choices=['review','metadata','delete'],default='review'); a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]
base=[a.psql,'-X','-h','127.0.0.1','-p','55439','-U','knowledge_test','-v','ON_ERROR_STOP=1']
db='knowledge_review_test_'+uuid.uuid4().hex
def run(args):
 r=subprocess.run(base+args,cwd=root,text=True,capture_output=True); print(r.stdout); print(r.stderr)
 if r.returncode: raise RuntimeError('SQL check failed')
run(['-d','postgres','-c','CREATE DATABASE '+db])
try:
 files=['scripts/knowledge-service/fixture.sql','scripts/knowledge-service/delete-fixture.sql','scripts/knowledge-service/review-fixture.sql','supabase/migrations/20270530100000_knowledge_canonical_metadata.sql','supabase/migrations/20270530200000_knowledge_canonical_delete.sql']
 if not a.baseline: files+=['supabase/migrations/20270530400000_knowledge_review_foundation.sql']*2
 files+=['scripts/knowledge-service/'+{'review':'review-behavior.sql','metadata':'behavior.sql','delete':'delete-behavior.sql'}[a.suite]]
 for file in files: run(['-d',db,'-f',file])
 print('PASS: review foundation real SQL behavior and migration replay')
finally: run(['-d','postgres','-c','DROP DATABASE '+db])
