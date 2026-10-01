-- Fixture dependencies only: same doc_id-only cascade FK as canonical schema.
CREATE TABLE public.tenant_knowledge_chunks (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
 doc_id uuid NOT NULL REFERENCES public.tenant_knowledge_docs(id) ON DELETE CASCADE,
 chunk_index integer NOT NULL, content text NOT NULL);
INSERT INTO public.tenant_knowledge_chunks VALUES
('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',0,'A chunk'),
('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',0,'B chunk');
CREATE SCHEMA storage;
CREATE TABLE storage.objects (id uuid PRIMARY KEY,bucket_id text,name text);
INSERT INTO storage.objects VALUES('40000000-0000-0000-0000-000000000001','tenant-knowledge','test-tenant-a/shared-source.pdf');
