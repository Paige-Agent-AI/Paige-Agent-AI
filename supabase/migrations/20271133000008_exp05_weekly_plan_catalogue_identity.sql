-- Same original system skill, whose canonical UNIQUE slug survives seeded UUID variation.
-- Prior Preview-applied50009 is immutable. No tools, classification or activation change.
begin;
-- Existing catalogue only: Limited native manual review, never Skills-runner
-- activation or a Live claim. Preserve customized/noncanonical descriptions.
update public.paige_skills s
 set description='Review permitted Tasks and Planning work with PAIGE or ZION, then confirm your goal, net available hours, effort and prerequisites in Operations. An eligible SOLO owner or administrator can explicitly save the reviewed weekly Plan and reopen its original receipt. This does not execute work, reserve Calendar time, enable automations or activate the separate Skills runner.',
 metadata=s.metadata||jsonb_build_object('catalogue_coverage',jsonb_build_object('version',1,'state','limited'))
 where s.slug='weekly_priorities_plan' and s.name='Weekly Priorities Plan'
 and s.category='operations_process' and s.scoping='platform' and s.created_by='system' and s.risk_level='draft' and s.status='active'
 and s.description=$weekly_copy$Drafts the week's operational priorities and focus plan for the business — the handful of highest-leverage outcomes for the week, sequenced with owners and mid-week checkpoints — and files it as a draft for approval. Reads open commitments and deadlines from the context layer and reuses the business's recurring weekly cadence; it plans the week, it does not execute or send anything. Internal operational planning, distinct from a per-client delivery status or a sales-pipeline view.$weekly_copy$
 and jsonb_typeof(s.metadata)='object' and not s.metadata ? 'catalogue_coverage';
commit;
