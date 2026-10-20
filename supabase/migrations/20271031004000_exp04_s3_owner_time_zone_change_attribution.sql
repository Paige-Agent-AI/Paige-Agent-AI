-- Experience 04 E4-S3 "See it, then verify it" — PR alpha: the owner's own act reads as the owner's.
--
-- WHAT IS WRONG TODAY. Every capability receipt renders through public._workspace_event_display, whose
-- base body (20261212000000) credits every `capability_run` to PAIGE ("Completed a step for you" /
-- "Paige did this for you."). `set_business_time_zone` is written ONLY by the owner-only Setup save
-- (Settings → Setup → Business profile → Business time zone; chat cannot save it), so every time an
-- owner set their business time zone the Rail said PAIGE had done it. A person's act must read as the
-- person's (journey doc §15 F8c/F8d; cross-track contract §2.5).
--
-- WHAT THIS CHANGES. One more link in the established rename-and-delegate wrapper chain (the Exp05 and
-- K-3 pattern): the newest display is renamed to a uniquely named `_before_exp04_owner_attribution`
-- and a new display delegates to it, overlaying copy for EXACTLY ONE capability key:
--   set_business_time_zone → actor_type 'owner_staff' (renders "Person"), title "Business time zone
--   changed" (or "… not changed" for any other outcome, which the raising RPC cannot produce today;
--   written for honesty, never shown as a success).
-- Every other key, outcome and source family returns the inherited JSON byte for byte — including the
-- three read keys, whose PAIGE-chat wording waits for PR beta, where the SQL readers stop writing their
-- page-load receipts (until then a Setup page load still writes a `read_business_time_zone` receipt, so
-- calling it "PAIGE read this to answer you in chat" would be false; cross-track contract B2).
--
-- WHAT THIS DOES NOT CHANGE. No table, column, grant, policy or DEFINER function. The display stays
-- INVOKER, IMMUTABLE, with a pinned search_path and no EXECUTE for anon/authenticated (only the DEFINER
-- Rail reader and writer call it). The 2-arg delegate resolves the 3-arg display by name. Both readers —
-- get_solo_rail_activity (history) and _record_workspace_rail_event (live broadcast) — pick the wrapper
-- up by name; neither is rewritten. The ledger is append-only: no receipt row is touched.
DO $$ BEGIN
  IF to_regprocedure('public._workspace_event_display_before_exp04_owner_attribution(text,text,text)') IS NULL THEN
    ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_exp04_owner_attribution;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display_before_exp04_owner_attribution(text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE _result jsonb;
BEGIN
  _result:=public._workspace_event_display_before_exp04_owner_attribution(_source_kind,_outcome,_capability);
  IF _source_kind='capability_run' AND _capability='set_business_time_zone' THEN
    -- Only the owner can save the business time zone (public.set_business_time_zone is owner-only and
    -- PAIGE cannot save it from chat), so the act is the person's. 'owner_staff' is the canonical human
    -- actor value (paige_client_events), rendered as "Person".
    _result:=_result||jsonb_build_object('actor_type','owner_staff',
      'title',CASE WHEN _outcome='capability_succeeded' THEN 'Business time zone changed' ELSE 'Business time zone not changed' END,
      'summary',CASE WHEN _outcome='capability_succeeded'
        THEN 'The business owner changed the business time zone. Due and overdue payment dates follow the saved zone.'
        ELSE 'The change did not go through. The saved zone is unchanged.' END);
  END IF;
  RETURN _result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public._workspace_event_display(text,text,text) IS
  'Rail display for workspace events. E4-S3: delegates to _workspace_event_display_before_exp04_owner_attribution and renders the owner-only set_business_time_zone receipt as the owner''s act (owner_staff). Every other key is unchanged.';
