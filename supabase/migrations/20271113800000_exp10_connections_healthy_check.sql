-- EXP10 PR7 — ALG-12 completion: the connections_healthy Systems Check (catalog row #11).
--
-- WHY A CATALOG ROW AND NOT A NEW SCHEDULER: the scheduled Systems Check engine already runs on
-- cron (20260816150000), batches tenants, files DELTA-ONLY remediation actions for NEW failures,
-- and reports any registered-key miss loudly. The runner module (connections_healthy.ts) ships in
-- the same commit; this row is the ONLY database object it needs. No new cron, no new table, no
-- new action path — the exception surfaces exactly where every other check's does (§18 one home).
--
-- SEMANTIC: the runner counts the live MCP registry (tenant_mcp_connections, the live write path
-- v2 dual-reads) in three aggregate classes — erroring, stale (connected-claiming with a probe
-- older than 7 days or absent; the SAME interval list_integration_surface derives), configured
-- total. Fail = any erroring or stale. It does NOT probe providers (a cron poking every tenant's
-- external servers unbidden would be its own incident); it detects RECORDED state.
--
-- PRIORITY 11: after the L1 ten (their 1–10 ordering is owner-locked); connections_healthy is
-- monitoring, not an onboarding unlock, so it sits after them. enabled_by_default so the fleet
-- gets exception detection without an operator opt-in step. mvp_locked=false — this is an EXP10
-- catalog addition, not part of the owner-locked L1 ten.

insert into public.paige_systems_check_registry
  (check_id, check_name, domain, severity, department, data_source, runner_key, nl_prompt,
   remediation_prompt, priority, mvp_locked, enabled_by_default)
values
  ('connections_healthy',
   'Connected apps healthy and recently verified',
   'payments_ops', 'medium', 'technology_automation', 'native_seam', 'connections_healthy',
   null,
   'A connected app stopped verifying or recorded an error. Open Settings → Integrations with {{tenant.business_name}}, re-run the connection check on the flagged tool, and reconnect it if the credential expired or was revoked at the provider. Say plainly what the tool last reported — never guess at provider state.',
   11, false, true)
on conflict (check_id) do nothing;
