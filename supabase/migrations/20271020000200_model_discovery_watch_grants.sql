-- ANT-37: the watch writes its two tables from the scheduled function under the service role;
-- the creating migration revoked anon/authenticated but never GRANTED service_role (the live
-- beat found it: "permission denied for table model_discovery_observations"). Grants only —
-- RLS stays enabled (service_role bypasses RLS; anon still has nothing; authenticated still
-- read-only on events via the operator policy).
grant all on public.model_discovery_observations to service_role;
grant all on public.model_discovery_events to service_role;
