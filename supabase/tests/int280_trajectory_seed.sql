-- Synthetic isolated fixtures. No real account, production login, provider or customer action.
INSERT INTO auth.users VALUES('20000000-0000-4000-8000-000000000001');
INSERT INTO public.tenants VALUES('10000000-0000-4000-8000-000000000001','active');
INSERT INTO public.tenant_members(tenant_id,user_id,status) VALUES('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','active');
INSERT INTO public.paige_chat_threads(id,tenant_id,caller_user_id) VALUES('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
-- Legacy work predates instrumentation: it must never acquire a fabricated initiation history.
SELECT * FROM public.create_paige_durable_work('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','document_generate','document_authoring','{"tenant_id":"10000000-0000-4000-8000-000000000001","actor_user_id":"20000000-0000-4000-8000-000000000001"}','test-scope');
