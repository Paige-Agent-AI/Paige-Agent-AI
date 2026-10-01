-- Commercial terms — the refusals reach the operator.
--
-- WHAT WAS WRONG, AND IT HAD NEVER WORKED. `tenant_client_agreements` has zero rows in production.
-- Not a regression: the commercial-terms feature has never once saved, since the day it shipped,
-- and the reason has been invisible the whole time.
--
-- These two functions refuse 38 times between them. Only 8 of those refusals carried a SQLSTATE.
-- The other 30 were bare `RAISE EXCEPTION`, which plpgsql defaults to `P0001` — a code the surface
-- does not map — so every one of them was rendered as "The save could not be confirmed. Refresh and
-- check your records before trying again."
--
-- That sentence is not just unhelpful. It is the wrong advice: it tells a person to retry something
-- that will refuse identically forever, and it says the same words whether the server refused or
-- returned nothing at all. Meanwhile the refusals themselves were written, by hand, for exactly the
-- person who could never read them:
--
--     an instalment arrangement needs to say how many instalments (two or more)
--     a one-off does not repeat, so it cannot carry a cadence or an instalment count
--     this client already has a live arrangement for that offer; end that one first
--     say what this client agreed to pay, or record it as still to be quoted
--
-- WHY A RESERVED SQLSTATE CLASS RATHER THAN ECHOING THE MESSAGE. The surface rule — public copy is
-- chosen from stable error codes, never database or provider messages — is correct and is NOT
-- relaxed here. A person must never be shown raw Postgres text. The problem was that the surface
-- had no way to tell a sentence written for them from a constraint name, so it safely discarded
-- both. `PA###` is that signal: it means a human wrote this sentence for another human. Everything
-- uncoded still gets safe generic copy, which is what keeps the rule intact.
--
--   PA002  a validation refusal — the values given cannot be recorded together (26 of them)
--   42501  authorization or scope — the surface already renders its own accurate copy (4 of them)
--   40001  concurrency — untouched; the surface keys `stale` off this exact constant and offers
--          RELOAD rather than retry, because a retry would overwrite the other writer
--
-- `PA001` is already taken, by the agreements provenance refusal in 20270413000000. The CLASS is
-- the signal, not the number.
--
-- THE INTERPOLATED VALUES ARE NOW BOUNDED, and this is the one change here that is not cosmetic.
-- Four refusals echo the caller's own rejected value back — `...this workspace records: %` — and
-- they echo it precisely BECAUSE it failed an allow-list, so it is arbitrary text of any length.
-- That was inert while no server message could reach the browser. The moment one can, it becomes a
-- way to render caller-supplied text inside a trusted error surface. The realistic vector is not an
-- operator attacking themselves: it is a §10 seam caller — Paige — passing a model-authored value
-- that then renders to the operator as product copy. Clamped at the raise site with `left(…, 40)`,
-- and bounded again in the hook. Both ends, because either alone can be bypassed by the other.
--
-- ALSO FIXED: the recurring check tested that a cadence was given but never that an interval count
-- was, so `tca_recurring_needs_cadence_ck` caught it instead and spoke as a constraint rather than
-- as a sentence. That is the same defect wearing a different hat.
--
-- NOT FIXED HERE, AND DELIBERATELY. Two refusals do not exist at all and so still reach the
-- operator as raw constraint codes: `tca_committed_is_complete_ck`, and the partial unique index
-- `uq_tca_live_per_client_offer`, whose `23505` maps to nothing. Giving those spoken forms means
-- wrapping the write in a nested exception block, which is a structural change and does not belong
-- in a migration whose whole claim is "every existing refusal now carries a code." Filed, not
-- silently skipped. Neither can be the owner's reported failure: with zero rows in the table, a
-- unique collision was not reachable.
--
-- ROLLBACK (forward-only): additive to behaviour that already refused. Reverse by restoring the
-- prior bodies in a forward migration; no data is touched and no shape changes.

CREATE OR REPLACE FUNCTION public.save_client_agreement(
  _expected_tenant_id  uuid,
  _agreement_id        uuid,                     -- null creates
  _contact_id          uuid,
  _offer_id            uuid,
  _term_kind           text,
  _price_basis         text,
  _catalog_price_id    uuid        DEFAULT NULL, -- an ID only. Never an amount.
  _agreed_amount_minor bigint      DEFAULT NULL, -- MINOR units
  _agreed_currency     text        DEFAULT NULL,
  _billing_interval    text        DEFAULT NULL,
  _interval_count      integer     DEFAULT NULL,
  _installments_total  integer     DEFAULT NULL,
  _payment_schedule    text        DEFAULT NULL,
  _starts_on           date        DEFAULT NULL,
  _renews_on           date        DEFAULT NULL,
  _ends_on             date        DEFAULT NULL,
  _title               text        DEFAULT NULL,
  _notes               text        DEFAULT NULL,
  _expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor  uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _row    public.tenant_client_agreements;
  _price  public.tenant_prices;
  _snap_minor    bigint;
  _snap_currency text;
  _snap_interval text;
  _snap_kind     text;
  _snap_at       timestamptz;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;

  -- Refusal-only. `current_user_tenant_id()` reads `profiles.active_tenant_id`, which a workspace
  -- switch writes BEFORE the browser catches up, so an agreement drafted against one workspace
  -- must never land in another the same person also belongs to. Disagreement aborts; never
  -- redirects. The caller must send the tenant the FORM WAS OPENED AGAINST, not the current one —
  -- sending the current one makes the guard unable to fire, because the caller keeps agreeing
  -- with itself. That exact mistake shipped once on `save_solo_offer` and is recorded there.
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could save; nothing was written'
      USING ERRCODE = '42501';
  END IF;

  -- Settled BEFORE the ids are resolved. Answering "no such client" to a caller who was never
  -- entitled to ask turns a refusal into a client-directory oracle for another workspace.
  IF NOT public.is_tenant_admin(_tenant) THEN
    RAISE EXCEPTION 'only an owner or admin may record an agreement with a client'
      USING ERRCODE = '42501';
  END IF;

  -- ── THE IDOR SURFACE. Both ids came from the browser. ─────────────────────────────────────
  -- SECURITY DEFINER bypasses RLS on `clients`, so `AND c.tenant_id = _tenant` is the ONLY thing
  -- standing between this and a foreign client. It is not decorative.
  PERFORM 1 FROM public.clients c WHERE c.id = _contact_id AND c.tenant_id = _tenant;
  IF NOT FOUND THEN
    -- One sentence for "absent" and "not yours" alike. Telling them apart is the oracle.
    RAISE EXCEPTION 'that client is not in this workspace' USING ERRCODE = 'PA002';
  END IF;

  PERFORM 1 FROM public.tenant_products p WHERE p.id = _offer_id AND p.tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that offer is not in this catalog' USING ERRCODE = 'PA002';
  END IF;

  -- ── VALIDATION ────────────────────────────────────────────────────────────────────────────
  _term_kind        := nullif(btrim(coalesce(_term_kind, '')), '');
  _price_basis      := nullif(btrim(coalesce(_price_basis, '')), '');
  _billing_interval := nullif(btrim(coalesce(_billing_interval, '')), '');
  _payment_schedule := nullif(btrim(coalesce(_payment_schedule, '')), '');
  _agreed_currency  := lower(nullif(btrim(coalesce(_agreed_currency, '')), ''));
  _title            := nullif(btrim(coalesce(_title, '')), '');
  _notes            := nullif(btrim(coalesce(_notes, '')), '');

  IF _term_kind IS NULL OR _term_kind NOT IN
     ('one_time','recurring','installment','deposit','custom_quote') THEN
    RAISE EXCEPTION 'that is not a kind of arrangement this workspace records: %',
      left(coalesce(_term_kind, 'nothing'), 40) USING ERRCODE = 'PA002';
  END IF;
  IF _price_basis IS NULL OR _price_basis NOT IN ('catalog','negotiated','quote_pending') THEN
    RAISE EXCEPTION 'say whether this is the catalog price, a negotiated price, or a quote still to come' USING ERRCODE = 'PA002';
  END IF;
  IF _billing_interval IS NOT NULL
     AND _billing_interval NOT IN ('one_time','day','week','month','year') THEN
    RAISE EXCEPTION 'that is not a billing interval this workspace records: %', left(_billing_interval, 40) USING ERRCODE = 'PA002';
  END IF;
  IF _payment_schedule IS NOT NULL AND _payment_schedule NOT IN
     ('on_signing','on_start','in_advance','in_arrears','on_milestone','custom') THEN
    RAISE EXCEPTION 'that is not a payment schedule this workspace records: %', left(_payment_schedule, 40) USING ERRCODE = 'PA002';
  END IF;
  IF _agreed_currency IS NOT NULL AND _agreed_currency !~ '^[a-z]{3}$' THEN
    RAISE EXCEPTION 'a currency is a three-letter code, not %', left(_agreed_currency, 40) USING ERRCODE = 'PA002';
  END IF;
  IF _agreed_amount_minor IS NOT NULL AND _agreed_amount_minor < 0 THEN
    RAISE EXCEPTION 'an agreed amount cannot be negative' USING ERRCODE = 'PA002';
  END IF;

  -- ── CROSS-FIELD VALIDATION, SO NO CONSTRAINT NAME EVER REACHES A PERSON ───────────────────
  -- The allow-lists above cover single fields. These cover the combinations, and each one exists
  -- because the CHECK behind it would otherwise surface as
  -- `violates check constraint "tca_..."` — a table name and a constraint name in visible copy.
  -- The first of them was reachable in TWO CLICKS from the empty state.
  IF _price_basis = 'quote_pending' THEN
    IF _term_kind <> 'custom_quote' THEN
      RAISE EXCEPTION 'a price still to be quoted only makes sense on a custom arrangement; choose Custom, or say what they agreed to pay' USING ERRCODE = 'PA002';
    END IF;
    IF _agreed_amount_minor IS NOT NULL THEN
      RAISE EXCEPTION 'this is recorded as still to be quoted, so it cannot also carry an amount' USING ERRCODE = 'PA002';
    END IF;
  END IF;

  IF _price_basis = 'negotiated' AND _agreed_amount_minor IS NULL THEN
    RAISE EXCEPTION 'say what this client agreed to pay, or record it as still to be quoted' USING ERRCODE = 'PA002';
  END IF;

  IF (_agreed_amount_minor IS NULL) <> (_agreed_currency IS NULL) THEN
    -- The minor-unit exponent is a property of the currency, so an amount without one cannot be
    -- read back at all: 500 is ¥500 in JPY and $5.00 in USD.
    RAISE EXCEPTION 'an amount needs its currency, and a currency needs its amount' USING ERRCODE = 'PA002';
  END IF;

  IF _term_kind = 'recurring' AND ((_billing_interval IS NULL OR _interval_count IS NULL) OR _billing_interval = 'one_time') THEN
    RAISE EXCEPTION 'a recurring arrangement needs to say how often it repeats — weekly, monthly or yearly' USING ERRCODE = 'PA002';
  END IF;
  IF _term_kind = 'installment' AND _installments_total IS NULL THEN
    RAISE EXCEPTION 'an instalment arrangement needs to say how many instalments (two or more)' USING ERRCODE = 'PA002';
  END IF;
  IF _installments_total IS NOT NULL AND _installments_total < 2 THEN
    RAISE EXCEPTION 'instalments come in twos or more; one payment is a one-off' USING ERRCODE = 'PA002';
  END IF;
  IF _term_kind = 'one_time'
     AND (_installments_total IS NOT NULL
          OR (_billing_interval IS NOT NULL AND _billing_interval <> 'one_time')) THEN
    RAISE EXCEPTION 'a one-off does not repeat, so it cannot carry a cadence or an instalment count' USING ERRCODE = 'PA002';
  END IF;

  IF _renews_on IS NOT NULL AND _term_kind <> 'recurring' THEN
    RAISE EXCEPTION 'only a recurring arrangement renews' USING ERRCODE = 'PA002';
  END IF;
  IF _renews_on IS NOT NULL AND _starts_on IS NOT NULL AND _renews_on < _starts_on THEN
    RAISE EXCEPTION 'a renewal date cannot fall before the start date' USING ERRCODE = 'PA002';
  END IF;
  IF _ends_on IS NOT NULL AND _starts_on IS NOT NULL AND _ends_on < _starts_on THEN
    RAISE EXCEPTION 'an end date cannot fall before the start date' USING ERRCODE = 'PA002';
  END IF;

  -- ── THE SNAPSHOT, READ SERVER-SIDE ────────────────────────────────────────────────────────
  -- The browser sends an ID and never an amount, so it cannot forge what the catalog said. The
  -- price row must belong to this tenant AND to the offer being agreed — a price row from a
  -- different offer is a real row this caller may legitimately see, and still a lie here.
  IF _catalog_price_id IS NOT NULL THEN
    SELECT * INTO _price FROM public.tenant_prices
     WHERE id = _catalog_price_id AND tenant_id = _tenant AND product_id = _offer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'that price is not a plan on this offer in this workspace' USING ERRCODE = 'PA002';
    END IF;
    _snap_minor    := _price.unit_amount;
    _snap_currency := lower(_price.currency);
    _snap_interval := _price.billing_interval;
    _snap_kind     := _price.kind;
    _snap_at       := now();
  END IF;

  -- 'catalog' means "this client pays list", which is only sayable when a list price was read.
  -- On CREATE, 'catalog' means the agreed figure IS the list price, so it is taken from the
  -- snapshot rather than from the caller — who does not get to disagree with itself. On EDIT it is
  -- deliberately NOT re-derived: the list price may have moved since, and re-reading it would
  -- silently rewrite what this client agreed to pay.
  IF _price_basis = 'catalog' AND _agreement_id IS NULL THEN
    IF _snap_minor IS NULL THEN
      RAISE EXCEPTION 'choose which catalog plan this agreement follows before recording it as the catalog price' USING ERRCODE = 'PA002';
    END IF;
    _agreed_amount_minor := _snap_minor;
    _agreed_currency     := _snap_currency;
  END IF;

  IF _agreement_id IS NULL THEN
    INSERT INTO public.tenant_client_agreements
      (tenant_id, contact_id, offer_id, title, notes, term_kind, billing_interval, interval_count,
       installments_total, payment_schedule, price_basis, agreed_amount_minor, agreed_currency,
       catalog_price_id, catalog_price_snapshot_minor, catalog_price_snapshot_currency,
       catalog_price_snapshot_interval, catalog_price_snapshot_kind, catalog_price_snapshot_at,
       starts_on, renews_on, ends_on, status, created_by)
    VALUES
      (_tenant, _contact_id, _offer_id, _title, _notes, _term_kind, _billing_interval,
       _interval_count, _installments_total, _payment_schedule, _price_basis,
       _agreed_amount_minor, _agreed_currency, _catalog_price_id, _snap_minor, _snap_currency,
       _snap_interval, _snap_kind, _snap_at, _starts_on, _renews_on, _ends_on, 'draft', _actor)
    RETURNING * INTO _row;
  ELSE
    -- Optimistic concurrency. The field at risk is money a client owes, and a multi-field
    -- negotiated record is exactly the shape where two editors produce a silently merged wrong
    -- number. 40001 is the code `useCatalogOffers.runWrite` already maps to `stale`, and the
    -- surface already offers RELOAD rather than retry — a retry would overwrite the other writer.
    UPDATE public.tenant_client_agreements
       SET contact_id = _contact_id,
           offer_id = _offer_id,
           title = _title,
           notes = _notes,
           term_kind = _term_kind,
           billing_interval = _billing_interval,
           interval_count = _interval_count,
           installments_total = _installments_total,
           payment_schedule = _payment_schedule,
           price_basis = _price_basis,
           agreed_amount_minor = _agreed_amount_minor,
           agreed_currency = _agreed_currency,
           -- The snapshot is only ever SET, never re-set: coalesce keeps the original dated
           -- reading, and the immutability trigger refuses any attempt to move it.
           catalog_price_id = coalesce(catalog_price_id, _catalog_price_id),
           catalog_price_snapshot_minor = coalesce(catalog_price_snapshot_minor, _snap_minor),
           catalog_price_snapshot_currency = coalesce(catalog_price_snapshot_currency, _snap_currency),
           catalog_price_snapshot_interval = coalesce(catalog_price_snapshot_interval, _snap_interval),
           catalog_price_snapshot_kind = coalesce(catalog_price_snapshot_kind, _snap_kind),
           catalog_price_snapshot_at = coalesce(catalog_price_snapshot_at, _snap_at),
           starts_on = _starts_on,
           renews_on = _renews_on,
           ends_on = _ends_on
     WHERE id = _agreement_id
       AND tenant_id = _tenant
       AND (_expected_updated_at IS NULL OR updated_at = _expected_updated_at)
    RETURNING * INTO _row;

    -- SAFE ONLY BECAUSE `_row` IS NEVER ASSIGNED ABOVE THIS POINT. Add any `SELECT * INTO _row`
    -- earlier in this function and this reads the STALE row: both refusals below stop firing and
    -- the pre-update row is returned as though the write had landed — a silent false success on a
    -- money field. The sibling function needs explicit `_row := NULL` resets for the same reason.
    IF _row.id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.tenant_client_agreements
                  WHERE id = _agreement_id AND tenant_id = _tenant) THEN
        RAISE EXCEPTION 'someone else changed this agreement while you were editing it'
          USING ERRCODE = '40001';
      END IF;
      RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Reports what was ACTUALLY written, read back off the row (§13), so a value the database
  -- normalised or refused can never be shown back as though it had been stored.
  RETURN to_jsonb(_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_client_agreement_status(
  _expected_tenant_id  uuid,
  _agreement_id        uuid,
  _status              text,
  _expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor  uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _row    public.tenant_client_agreements;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could save; nothing was written'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_tenant_admin(_tenant) THEN
    RAISE EXCEPTION 'only an owner or admin may change an agreement''s state'
      USING ERRCODE = '42501';
  END IF;

  _status := nullif(btrim(coalesce(_status, '')), '');
  IF _status IS NULL OR _status NOT IN ('draft','active','paused','completed','cancelled') THEN
    RAISE EXCEPTION 'that is not a state an agreement can be in: %', coalesce(_status, 'nothing') USING ERRCODE = 'PA002';
  END IF;

  -- A cancelled or completed agreement is HISTORY. Reopening it would rewrite what a client owed
  -- and when, so a new arrangement is a new record rather than a resurrected one.
  SELECT * INTO _row FROM public.tenant_client_agreements
   WHERE id = _agreement_id AND tenant_id = _tenant;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
  END IF;
  IF _row.status IN ('completed', 'cancelled') AND _status <> _row.status THEN
    RAISE EXCEPTION 'this agreement is already %; record a new one rather than reopening it', _row.status USING ERRCODE = 'PA002';
  END IF;
  -- One LIVE arrangement per client per offer. Without this the partial unique index answers with
  -- its own name, which is a database object in visible copy.
  IF _status IN ('active','paused') AND _row.status NOT IN ('active','paused')
     AND EXISTS (SELECT 1 FROM public.tenant_client_agreements other
                  WHERE other.tenant_id = _tenant
                    AND other.contact_id = _row.contact_id
                    AND other.offer_id = _row.offer_id
                    AND other.id <> _row.id
                    AND other.status IN ('active','paused')) THEN
    RAISE EXCEPTION 'this client already has a live arrangement for that offer; end that one first' USING ERRCODE = 'PA002';
  END IF;
  _row := NULL;

  -- The same completeness rule the table carries, said in words BEFORE the constraint can fire.
  -- `cancelled` is exempt for the reason the CHECK is: cancelling is abandonment, and requiring a
  -- start date before someone may walk away made a half-finished draft uncancellable.
  IF _status NOT IN ('draft', 'cancelled') THEN
    SELECT * INTO _row FROM public.tenant_client_agreements
     WHERE id = _agreement_id AND tenant_id = _tenant;
    IF _row.id IS NULL THEN
      RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
    END IF;
    IF _row.starts_on IS NULL THEN
      RAISE EXCEPTION 'give this a start date before making it %', _status USING ERRCODE = 'PA002';
    END IF;
    IF _row.price_basis = 'quote_pending' THEN
      RAISE EXCEPTION 'this is still awaiting its quote, so it cannot be made % yet', _status USING ERRCODE = 'PA002';
    END IF;
    _row := NULL;
  END IF;

  UPDATE public.tenant_client_agreements
     SET status = _status
   WHERE id = _agreement_id
     AND tenant_id = _tenant
     AND (_expected_updated_at IS NULL OR updated_at = _expected_updated_at)
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.tenant_client_agreements
                WHERE id = _agreement_id AND tenant_id = _tenant) THEN
      RAISE EXCEPTION 'someone else changed this agreement while you were editing it'
        USING ERRCODE = '40001';
    END IF;
    RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
  END IF;

  RETURN to_jsonb(_row);
END;
$function$;

-- Re-asserted rather than assumed. CREATE OR REPLACE preserves privileges, and stating them keeps
-- the grant visible in the migration that last touched the function.
REVOKE ALL ON FUNCTION public.save_client_agreement(uuid, uuid, uuid, uuid, text, text, uuid, bigint, text, text, integer, integer, text, date, date, date, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_client_agreement(uuid, uuid, uuid, uuid, text, text, uuid, bigint, text, text, integer, integer, text, date, date, date, text, text, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.set_client_agreement_status(uuid, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_client_agreement_status(uuid, uuid, text, timestamptz) TO authenticated;
