-- ANT-47 timeout repair, round 2 part 2: the closure's child-side joins sequential-scan
-- FK columns whose parent is a disposition-delete relation (the only FKs the closure ever
-- probes). Liveness was verified against the disposition array: these four are live; the
-- ten dead ones the raw unindexed-FK audit surfaced (parents blocked/preserved/auth.users)
-- are deliberately NOT added. IF NOT EXISTS keeps the file replayable.
CREATE INDEX IF NOT EXISTS idx_paige_prompt_memory_template ON public.paige_prompt_memory (template_id);
CREATE INDEX IF NOT EXISTS idx_paige_actions_action_kind ON public.paige_actions (action_kind);
CREATE INDEX IF NOT EXISTS idx_paige_actions_conversation ON public.paige_actions (conversation_id);
CREATE INDEX IF NOT EXISTS idx_paige_actions_invocation ON public.paige_actions (invocation_id);
