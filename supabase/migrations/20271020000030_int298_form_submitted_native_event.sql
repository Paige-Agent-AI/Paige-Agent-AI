-- INT-298 / INT-342 MBC slice 4a — `form.submitted`, a native event and a §67 process trigger.
--
-- Until now no form submission ever reached the native event bus: the only producer was
-- contact.created (20270119000000), and a §67 process could not start "when someone fills in my form"
-- (plan docs/product/int342-marketing-convergence.md §I/§J; harness-completion-map step "promote the
-- forms on-submit spine onto the paige_native_events bus as a form_submitted producer").
--
-- Contract: docs/delivery/form-submitted-event-contract.md.
--   * The event fires once per submission, when the submission is matched to a contact — on insert
--     with a contact, or when the submission processor pins one (contact_upsert, or a form's own
--     "create contact" intake). A submission that never names a person (no email or phone, or a form
--     that creates no contact) has nobody a process could act on, so it fires nothing; the catalogue
--     label says so.
--   * Subject: the contact (`clients`), like contact.created, so the existing dispatcher, tenant
--     check and act engine run unchanged.
--   * Payload: ids and the link's source and campaign tags only (already trimmed to 200 characters at
--     intake), never the form's answers. A subscriber reads more by id, inside the tenant.
--   * Transactional outbox, as contact.created: the event row is written in the same statement as the
--     contact pin and a failure is not swallowed; only the dispatch HTTP fire is best-effort, with the
--     sweeper as its backstop. ON CONFLICT on the per-submission dedup key absorbs a repeat.
--   * Nothing is sent by this migration. With no live process on the trigger the dispatcher records
--     the event as having no subscriber.
--   * FOR EACH ROW, like contact.created: every writer of a submission's contact today is single-row
--     (the public intake, external intake, and the processor's pin). A bulk backfill that sets contact_id
--     on many submissions at once would fire one event per row; such a path must suppress firing first.

INSERT INTO public.paige_automation_triggers (key, label, category, description, is_live, dark_reason)
VALUES
  ('form.submitted', 'Someone fills in a form', 'forms',
   'A form submission is matched to a contact (the form creates or finds the person). Submissions that name nobody do not start a process.', true, NULL)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trg_growth_submission_emit_form_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _event_id uuid;
BEGIN
  IF NEW.contact_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.contact_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  -- The contact must be this tenant's; a mismatched pin is a bug upstream, never an event to deliver.
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.contact_id AND c.tenant_id = NEW.tenant_id) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.paige_native_events
    (event_key, tenant_id, subject_table, subject_id, dedup_key, payload)
  VALUES (
    'form.submitted', NEW.tenant_id, 'clients', NEW.contact_id,
    'form.submitted:' || NEW.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'submission_id',     NEW.id,
      'form_id',           NEW.form_id,
      'contact_id',        NEW.contact_id,
      'source',            NEW.source,
      'utm_source',        NEW.utm_json->>'utm_source',
      'utm_campaign',      NEW.utm_json->>'utm_campaign',
      'funnel_session_id', NEW.funnel_session_id,
      'submitted_at',      NEW.created_at
    ))
  )
  ON CONFLICT (dedup_key) DO NOTHING
  RETURNING id INTO _event_id;

  IF _event_id IS NOT NULL THEN
    PERFORM public.paige_fire_event_processor(_event_id, NEW.tenant_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_growth_submission_emit_form_submitted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_growth_submission_emit_form_submitted ON public.growth_form_submissions;
CREATE TRIGGER trg_growth_submission_emit_form_submitted
  AFTER INSERT OR UPDATE OF contact_id ON public.growth_form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.trg_growth_submission_emit_form_submitted();
