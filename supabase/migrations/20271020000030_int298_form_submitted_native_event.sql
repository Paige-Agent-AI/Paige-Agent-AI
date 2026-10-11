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
--     intake), never the form's answers or the funnel session token (a bearer key for the funnel's own
--     advance call). A subscriber reads more by id, inside the tenant.
--   * A paused or archived workspace gets no event: it runs no processes, and the outbox's own guard
--     (a01_archived_tenant_work) would otherwise refuse the write and roll back the submission itself.
--   * Transactional outbox, as contact.created: the event row is written in the same statement as the
--     contact pin and a failure is not swallowed; only the dispatch HTTP fire is best-effort, with the
--     sweeper as its backstop. ON CONFLICT on the per-submission dedup key absorbs a repeat.
--   * Nothing is sent by this migration. With no live process on the trigger the dispatcher records
--     the event as having no subscriber.
--   * Who sets a submission's contact (§37): external intake (growth-inbound, on insert) and the
--     processor's pin (growth-process-submission, while it is unset); the public intake inserts none. All
--     run as the service role. `authenticated` still holds UPDATE on the table and its policy lets any
--     member of the business update a row, so a browser could otherwise pin a contact of its choosing and
--     start the business's processes: a browser-role change of contact_id is refused here (42501), as
--     growth_forms_guard_notify_email does for the alert address.
--   * FOR EACH ROW, like contact.created: every writer above is single-row. A bulk backfill that sets
--     contact_id on many submissions at once would fire one event per row; it must suppress firing first.

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
  -- A paused or archived workspace runs nothing; keep the submission, start no process.
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id AND (t.archived_at IS NOT NULL OR t.lifecycle_execution_paused)) THEN
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

-- The contact on a submission is set by the intake and the processor, never by a browser.
CREATE OR REPLACE FUNCTION public.growth_submission_guard_contact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
    RAISE EXCEPTION 'GROWTH_FORBIDDEN: a submission''s contact is set when it is processed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.growth_submission_guard_contact() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS growth_submission_guard_contact ON public.growth_form_submissions;
CREATE TRIGGER growth_submission_guard_contact
  BEFORE UPDATE OF contact_id ON public.growth_form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.growth_submission_guard_contact();
