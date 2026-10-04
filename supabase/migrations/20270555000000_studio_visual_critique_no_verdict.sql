-- 20270555000000_studio_visual_critique_no_verdict.sql
--
-- WHY THIS EXISTS (CLAUDE.md §13/§33): studio-visual-critique wrote a log row only when a verdict
-- came back. An attempt that produced NO verdict — the page renderer unconfigured, a render that
-- failed, an image that could not be fetched, the vision model unconfigured — left no trace, so the
-- audit showed successes and hid every failed attempt. The function now records those attempts as
-- verdict 'NO_VERDICT' with the cause in findings.status. The original CHECK allowed only
-- SHIP/ITERATE/BLOCK, so this widens it by exactly one value.
--
-- ADDITIVE ONLY: every existing row still satisfies the new constraint; no row is rewritten; the
-- verdict column stays NOT NULL. RLS, grants and the tenant-read policy are untouched (§9).
-- Reverse with (only once no NO_VERDICT rows exist):
--   ALTER TABLE public.studio_visual_critique_log DROP CONSTRAINT studio_visual_critique_verdict_chk;
--   ALTER TABLE public.studio_visual_critique_log ADD CONSTRAINT studio_visual_critique_verdict_chk
--     CHECK (verdict IN ('SHIP', 'ITERATE', 'BLOCK'));

ALTER TABLE public.studio_visual_critique_log
  DROP CONSTRAINT IF EXISTS studio_visual_critique_verdict_chk;

ALTER TABLE public.studio_visual_critique_log
  ADD CONSTRAINT studio_visual_critique_verdict_chk
  CHECK (verdict IN ('SHIP', 'ITERATE', 'BLOCK', 'NO_VERDICT'));

COMMENT ON COLUMN public.studio_visual_critique_log.verdict IS
  'SHIP | ITERATE | BLOCK — a critique that ran; NO_VERDICT — an attempt that produced no screenshot or no model call (cause in findings.status). Never a fabricated verdict.';
COMMENT ON COLUMN public.studio_visual_critique_log.image_source IS
  '''image_url'' (an existing raster) or ''render'' (paige-browser /render — the one browser host).';
COMMENT ON COLUMN public.studio_visual_critique_log.cost_estimate_usd IS
  'A clearly-labelled ESTIMATE of this call''s model cost in USD from the router — never a billed figure.';
