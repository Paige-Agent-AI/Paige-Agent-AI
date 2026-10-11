-- ANT-47 timeout repair, round 2 part 2: foreign-key columns the plan's closure joins
-- sequential-scan because no index leads with the FK column (audited read-only in production
-- 2026-10-11; children over ~500KB). Indexing the join side makes each closure probe an
-- index probe. IF NOT EXISTS keeps the file replayable; every target is small-to-15MB.
CREATE INDEX IF NOT EXISTS idx_paige_systems_check_finding_department ON public.paige_systems_check_finding (department_id);
CREATE INDEX IF NOT EXISTS idx_paige_systems_check_finding_check ON public.paige_systems_check_finding (check_id);
CREATE INDEX IF NOT EXISTS idx_rag_documents_client ON public.rag_documents (client_id);
CREATE INDEX IF NOT EXISTS idx_paige_prompt_memory_template ON public.paige_prompt_memory (template_id);
CREATE INDEX IF NOT EXISTS idx_platform_usage_events_reconciled_invoice ON public.platform_usage_events (reconciled_invoice_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_embeddings_message ON public.chat_message_embeddings (message_id);
CREATE INDEX IF NOT EXISTS idx_paige_actions_action_kind ON public.paige_actions (action_kind);
CREATE INDEX IF NOT EXISTS idx_paige_actions_to_department ON public.paige_actions (to_department);
CREATE INDEX IF NOT EXISTS idx_paige_actions_assigned_to_user ON public.paige_actions (assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_paige_actions_created_by ON public.paige_actions (created_by);
CREATE INDEX IF NOT EXISTS idx_paige_actions_conversation ON public.paige_actions (conversation_id);
CREATE INDEX IF NOT EXISTS idx_paige_actions_invocation ON public.paige_actions (invocation_id);
CREATE INDEX IF NOT EXISTS idx_paige_actions_from_department ON public.paige_actions (from_department);
CREATE INDEX IF NOT EXISTS idx_paige_pending_approvals_reviewed_by ON public.paige_pending_approvals (reviewed_by_user_id);
