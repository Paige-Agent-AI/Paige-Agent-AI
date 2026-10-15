-- Contain only unintended destructive whole-table authority. Existing records,
-- ordinary DML grants, RLS and checked domain writers remain unchanged.
REVOKE TRUNCATE ON TABLE public.paige_client_intake_submissions
FROM PUBLIC, anon, authenticated;
