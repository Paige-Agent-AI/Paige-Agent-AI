-- Knowledge canonical publication: generation schema, dormant atomic promotion RPCs,
-- retrieval filters, legacy-writer guards. No provider worker, no UI cutover, no submit
-- activation for authenticated callers (creation stays unavailable until native worker
-- adoption proves fake-provider and real authorization).
--
-- Canonical invariants (frozen packet):
--  * tenant_knowledge_docs.active_generation_id nullable; NULL preserves every legacy
--    publication untouched.
--  * tenant_knowledge_chunks.generation_id nullable; unique (doc_id, generation_id,
--    chunk_index) for non-NULL generations; legacy NULL rows unchanged.
--  * A native intent freezes document/review/source identity, expected revision, manifest
--    hash/count/model/version. Repeated exact intent returns the same work; a different
--    payload refuses; only one unresolved publication per document.
--  * Staged chunks are invisible until atomic promotion; a retired generation stays stored
--    but invisible; no cleanup in this migration.
--  * Any failure before commit preserves prior content, metadata, chunks, generation.
--  * Receipt failure after a verified publication yields capability_completed_unrecorded;
--    a committed publication is never rolled back for its receipt.

-- ─── Schema layer ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_knowledge_docs
 ADD COLUMN IF NOT EXISTS active_generation_id uuid,
 ADD COLUMN IF NOT EXISTS publication_manifest jsonb,
 ADD COLUMN IF NOT EXISTS publication_intent_hash text;
ALTER TABLE public.tenant_knowledge_chunks
 ADD COLUMN IF NOT EXISTS generation_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunk_generation_uidx
 ON public.tenant_knowledge_chunks(doc_id, generation_id, chunk_index)
 WHERE generation_id IS NOT NULL;

-- Manifest shape: exact ordered hashes + counts + versions. Nothing else may ride in it.
CREATE OR REPLACE FUNCTION public.knowledge_publication_manifest_valid(v jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF v IS NULL THEN RETURN false; END IF;
 IF jsonb_typeof(v)<>'object'
  OR NOT v ?& ARRAY['version','model','dimensions','chunk_count','chunk_hashes']
  OR v - ARRAY['version','model','dimensions','chunk_count','chunk_hashes'] <>'{}'::jsonb
  OR jsonb_typeof(v->'version')<>'string' OR (v->>'version')<>'unicode-1000-150-v1'
  OR jsonb_typeof(v->'model')<>'string' OR length(v->>'model') NOT BETWEEN 1 AND 100
  OR jsonb_typeof(v->'dimensions')<>'number' OR (v->>'dimensions')<>'1024'
  OR jsonb_typeof(v->'chunk_count')<>'number' OR (v->>'chunk_count') !~ '^[0-9]+$'
  OR (v->>'chunk_count')::int < 1 OR (v->>'chunk_count')::int > 565
  OR jsonb_typeof(v->'chunk_hashes')<>'array'
  OR jsonb_array_length(v->'chunk_hashes') <> (v->>'chunk_count')::int THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'chunk_hashes') h
  WHERE jsonb_typeof(h)<>'string' OR h#>>'{}' !~ '^[0-9a-f]{64}$');
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.knowledge_publication_manifest_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_publication_manifest_valid(jsonb) TO authenticated,service_role;

ALTER TABLE public.tenant_knowledge_docs DROP CONSTRAINT IF EXISTS knowledge_publication_shape;
ALTER TABLE public.tenant_knowledge_docs ADD CONSTRAINT knowledge_publication_shape CHECK (
 (publication_manifest IS NULL OR public.knowledge_publication_manifest_valid(publication_manifest))
 AND (active_generation_id IS NULL OR publication_manifest IS NOT NULL)
 AND (publication_intent_hash IS NULL OR length(publication_intent_hash)=64));
-- Legacy rows carry NULL in all three publication fields, so the constraint holds without
-- a rewrite; the validator itself rejects NULL manifests because only published documents
-- (which always carry one) may set them.

-- ─── Canonical chunker: unicode-1000-150-v1 ──────────────────────────────────────────────
-- Precisely specified: collapse each whitespace run to one space, trim; if the cleaned text
-- fits 1000 code points emit one chunk; else emit 1000-char substrings stepping back 150
-- from each boundary (the final chunk is the remainder). PostgreSQL substring counts Unicode
-- code points; this is DELIBERATELY not the JS UTF-16 slicer (packet decision), and the
-- version string pins the semantics for every manifest it stamps.
CREATE OR REPLACE FUNCTION public.knowledge_publication_chunks(v text)
RETURNS TABLE(chunk_index integer, chunk_text text, chunk_sha256 text)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
DECLARE clean text; n integer; i integer := 0; idx integer := 0; piece text;
BEGIN
 clean:=btrim(regexp_replace(v,'\s+',' ','g'));
 IF clean IS NULL OR clean='' THEN RETURN; END IF;
 n:=length(clean);
 IF n<=1000 THEN
  idx:=0; piece:=clean;
  chunk_index:=idx; chunk_text:=piece; chunk_sha256:=encode(sha256(convert_to(piece,'UTF8')),'hex'); RETURN NEXT; RETURN;
 END IF;
 WHILE i<n LOOP
  piece:=substr(clean,i+1,least(1000,n-i));
  chunk_index:=idx; chunk_text:=piece; chunk_sha256:=encode(sha256(convert_to(piece,'UTF8')),'hex');
  RETURN NEXT;
  idx:=idx+1;
  EXIT WHEN i+1000>=n;
  i:=i+1000-150;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.knowledge_publication_chunks(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_publication_chunks(text) TO service_role;

-- Manifest for a review text: version, model, dims, ordered hashes.
CREATE OR REPLACE FUNCTION public.knowledge_publication_manifest(v text, _model text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
DECLARE hashes jsonb:='[]'::jsonb; c record; n integer:=0;
BEGIN
 FOR c IN SELECT * FROM public.knowledge_publication_chunks(v) LOOP
  hashes:=hashes||to_jsonb(c.chunk_sha256); n:=n+1;
 END LOOP;
 IF n=0 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version','unicode-1000-150-v1','model',_model,'dimensions',1024,'chunk_count',n,'chunk_hashes',hashes);
END $$;
REVOKE ALL ON FUNCTION public.knowledge_publication_manifest(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_publication_manifest(text,text) TO service_role;
