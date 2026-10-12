-- ANT-47 timeout repair, part 2: tenant-column indexes for the relations the retirement
-- plan and tenant-scoped reads probe without a leading-column index (audited read-only in
-- production 2026-10-11): each missing index turned every plan probe into a sequential scan.
-- IF NOT EXISTS keeps the file replayable; every target is a small-to-26MB relation, so
-- plain CREATE INDEX builds in well under a second inside the normal deploy queue.
CREATE INDEX IF NOT EXISTS idx_paige_llm_trace_working_context_tenant ON public.paige_llm_trace (working_context_tenant_id);
CREATE INDEX IF NOT EXISTS idx_paige_llm_trace_retired_tenant ON public.paige_llm_trace (retired_tenant_id);
CREATE INDEX IF NOT EXISTS idx_paige_llm_trace_retired_working_context_tenant ON public.paige_llm_trace (retired_working_context_tenant_id);
CREATE INDEX IF NOT EXISTS idx_paige_chat_turns_interactive_tenant ON public.paige_chat_turns (interactive_tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_evidence_reference_tenant ON public.analytics_evidence_reference (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_parent ON public.tenants (parent_tenant_id);
CREATE INDEX IF NOT EXISTS idx_paige_pending_confirmations_tenant ON public.paige_pending_confirmations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_items_publisher_tenant ON public.marketplace_items (publisher_tenant_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_items_visible_to_tenant ON public.marketplace_items (visible_to_tenant_id);
CREATE INDEX IF NOT EXISTS idx_studio_artifact_versions_tenant ON public.studio_artifact_versions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON public.invitations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mcp_connection_oauth_state_tenant ON public.mcp_connection_oauth_state (tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_active_tenant ON public.profiles (active_tenant_id);
CREATE INDEX IF NOT EXISTS idx_paige_voice_cost_reservations_tenant ON public.paige_voice_cost_reservations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_paige_voice_cost_reservations_retired_tenant ON public.paige_voice_cost_reservations (retired_tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_subscriptions_retired_tenant ON public.platform_subscriptions (retired_tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_usage_events_retired_tenant ON public.platform_usage_events (retired_tenant_id);
CREATE INDEX IF NOT EXISTS idx_client_notes_tenant ON public.client_notes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_calendar_settings_tenant ON public.staff_calendar_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_tenant ON public.pipeline_stages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_paige_subagent_factory_quota_tenant ON public.paige_subagent_factory_quota (tenant_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_vendors_owner_tenant ON public.marketplace_vendors (owner_tenant_id);
CREATE INDEX IF NOT EXISTS idx_browser_use_sessions_legacy_quarantine_tenant ON public.browser_use_sessions_legacy_quarantine (tenant_id);
CREATE INDEX IF NOT EXISTS idx_paige_action_kinds_tenant ON public.paige_action_kinds (tenant_id);
CREATE INDEX IF NOT EXISTS idx_client_files_tenant ON public.client_files (tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_campaign_versions_tenant ON public.email_campaign_versions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_paige_voice_readiness_pilot_tenant ON public.paige_voice_readiness (pilot_tenant_id);
CREATE INDEX IF NOT EXISTS idx_paige_event_kinds_tenant ON public.paige_event_kinds (tenant_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_install_ledger_tenant ON public.marketplace_install_ledger (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_archive_confirmations_tenant ON public.pipeline_archive_confirmations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_classifications_tenant ON public.message_classifications (tenant_id);
