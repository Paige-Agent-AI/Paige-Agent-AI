-- INT-163 / #1395 — the manual link path refuses a document it cannot prove is the uploaded one.
--
-- WHAT WAS WRONG. `agreement-send` used to render the agreement's TEXT body to a PDF regardless of
-- where the body actually came from. An agreement whose body is an uploaded FILE has no text, so it
-- rendered and froze a BLANK page and then emailed that. PR #1398 fixed the send path: it downloads
-- the uploaded object, inspects it, and freezes those real bytes under a storage key carrying the
-- marker `presented-source-`, while a rendered text body keeps the older `presented-`.
--
-- WHY THAT FIX WAS NOT ENOUGH, AND WHY THIS MIGRATION EXISTS. Sending is not the only way a person
-- is shown a document. The owner's surface also offers "Or copy a link", and that control goes
-- nowhere near the edge function — it calls this RPC, which mints a signing token directly. The
-- function already refused to FREEZE an uploaded file itself, correctly: the database cannot read
-- storage, so it cannot hash one. But it had nothing at all to say about a row that was ALREADY
-- frozen, and every agreement frozen by the pre-fix send path is exactly that — frozen, around a
-- blank page. So after #1398 the send door refused those rows while this door went on handing out
-- links to them, and the signer opened the link to a blank document. One defect, two doors; #1398
-- closed the first one. A fix that closes one path and not its twin is not a fix.
--
-- WHY THE AFFECTED ROW CANNOT SIMPLY BE REPAIRED. `content_sha256` is write-once, enforced by
-- `enforce_agreement_seal_immutable` (20270401000000_agreements_engine_records.sql:522), and that is
-- deliberate: the column is the record of what a human being was shown. Re-freezing it would be
-- rewriting that record to cover a defect, which is the opposite of what it is for. So the only
-- honest outcome for an affected row is to refuse, say why in words the owner can act on, and name
-- the one action that does work — a new agreement built from the same file.
--
-- THE TEST IS PROVENANCE, NOT CONTENT. An earlier attempt at this re-hashed the uploaded object and
-- compared it against the frozen digest. That is a different question, and it gives the wrong answer:
-- it also refuses an intact agreement whose source file was later renamed or tidied, which is not
-- this defect and not a reason to stop a legitimate signing. What is actually being asked is "was
-- this row frozen by the fixed code", and the storage key answers it directly — the fixed path is
-- the only thing that has ever written `presented-source-`.
--
-- THE SAME RULE IS ENFORCED AT BOTH DOORS. `supabase/functions/agreement-send/index.ts:316` applies
-- this identical substring test before it will send. There is no shared home for the rule — one door
-- is plpgsql running inside the database, the other is TypeScript running in an edge function, and
-- they share no code — so it is written twice and each copy names the other. Change one, change both.

-- Re-declared in full rather than patched, because `CREATE OR REPLACE FUNCTION` has no other form.
-- The ONLY behavioural addition is the provenance refusal marked below. One incidental simplification
-- rides with it: the original read the row twice — once for `status` with a tenant filter, then again
-- for `body_source`/`body_markdown`/`content_sha256` with NO tenant filter. The second read was safe
-- only because the first had already raised on a foreign row, which is a guarantee held at a distance.
-- The two reads are now one tenant-filtered read, so the provenance columns inherit the scope
-- directly instead of depending on an earlier statement having run.
CREATE OR REPLACE FUNCTION public.issue_agreement_signing_link(
  _expected_tenant_id uuid,
  _signing_id uuid,
  _ttl_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _token text;
  _expires timestamptz;
  _signer uuid;
  _status text;
  _src text;
  _body text;
  _frozen text;
  _key text;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could run; nothing was written'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_tenant_admin(_tenant) THEN
    RAISE EXCEPTION 'only an owner or admin may issue a signing link' USING ERRCODE = '42501';
  END IF;
  IF _ttl_days IS NULL OR _ttl_days < 1 OR _ttl_days > 365 THEN
    RAISE EXCEPTION 'a signing link lasts between 1 and 365 days' USING ERRCODE = '23514';
  END IF;

  SELECT status, body_source, body_markdown, content_sha256, content_storage_key
    INTO _status, _src, _body, _frozen, _key
    FROM public.paige_agreements
   WHERE id = _signing_id AND tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
  END IF;
  IF _status IN ('completed','declined','voided','expired') THEN
    RAISE EXCEPTION 'this agreement is already %; a new link cannot be issued for it', _status
      USING ERRCODE = '23514';
  END IF;

  -- ── THE NEW REFUSAL ─────────────────────────────────────────────────────────────────────────
  -- Read it as: this row says its body is an uploaded file, something has already frozen a document
  -- for it, and that frozen document did not come from the code that knows how to read an uploaded
  -- file. Whatever is on file, it is not provably the thing the owner uploaded, so nobody is going
  -- to be sent a link to it. A NULL key fails the same way and for the same reason — an unlocatable
  -- frozen document is not evidence of anything.
  --
  -- THE MESSAGE DOES NOT NAME A CAUSE, and that is deliberate. The obvious sentence — "this was
  -- prepared before a defect was fixed" — is false for a row that can be built entirely AFTER the
  -- fix: a text agreement whose send froze `presented-<uuid>.pdf` and then failed every delivery
  -- stays a draft (`agreement-send/index.ts:428`), and a draft's `body_source` is still editable
  -- (`enforce_agreement_seal_immutable`, 20270401000000:544), so switching it to an upload lands
  -- exactly here. Refusing it is right — the frozen bytes are a render of the discarded text, not
  -- the new file — but blaming a historical defect for it would be a guess presented as a fact.
  -- What the predicate actually establishes is the stored document's provenance, so that is all
  -- the sentence claims.
  --
  -- This sits ahead of the signer check on purpose. A missing signer is a step on the way to
  -- sending; this is a dead end. Telling an owner to add a signer to an agreement that can never be
  -- sent walks them further down a path that ends here anyway.
  IF _src = 'tenant_upload' AND _frozen IS NOT NULL
     AND position('/presented-source-' IN coalesce(_key, '')) = 0 THEN
    -- 'PA001' rather than the 23514 every other refusal here raises, and the reason is the whole
    -- point of the refusal. The surface maps a SQLSTATE to public copy and deliberately never
    -- echoes a database message (`useSoloAgreementSignings.ts:252`), so on 23514 an owner would be
    -- shown "Check the client, the document and the wording, then try again." — an instruction to
    -- retry something that can never succeed, because the content columns are write-once
    -- (`enforce_agreement_seal_immutable`, 20270401000000:522). A refusal that sends a person round
    -- a loop forever is a worse outcome than the defect it replaces. A distinct code lets the
    -- surface say the one true thing instead, without weakening that no-echo rule. The only
    -- property relied on is that PostgREST reports the raised SQLSTATE as the error's `code`.
    RAISE EXCEPTION 'the document stored for this agreement is not the file that was uploaded'
      USING ERRCODE = 'PA001';
  END IF;

  SELECT id INTO _signer FROM public.paige_agreement_signers
   WHERE agreement_id = _signing_id ORDER BY signing_order LIMIT 1;
  IF _signer IS NULL THEN
    RAISE EXCEPTION 'add a signer before issuing a link' USING ERRCODE = '23514';
  END IF;

  -- FREEZE BEFORE THE LINK EXISTS. The moment a token is issued somebody can be shown the document,
  -- so the digest of what they will be shown is recorded first. For a text body that is the body
  -- itself, which is exactly what the page renders. An uploaded FILE cannot be hashed from here —
  -- the database cannot read storage — so that path refuses and goes through the send function,
  -- which can read the object and hash its real bytes. Refusing is the point: a link issued against
  -- an unhashed document would make "the signer saw exactly this" unprovable from the first minute.
  IF _frozen IS NULL THEN
    IF _src = 'tenant_upload' THEN
      RAISE EXCEPTION 'an uploaded document is frozen when it is sent; use the send path so its real bytes are hashed'
        USING ERRCODE = '23514';
    END IF;
    _frozen := encode(digest(coalesce(_body,''), 'sha256'), 'hex');
  END IF;

  -- gen_random_bytes(32) is 256 bits from pgcrypto's CSPRNG. Only the digest is stored.
  _token := encode(gen_random_bytes(32), 'hex');
  _expires := now() + make_interval(days => _ttl_days);

  UPDATE public.paige_agreement_signers
     SET token_hash = encode(digest(_token, 'sha256'), 'hex'),
         token_expires_at = _expires,
         token_revoked_at = NULL,
         updated_at = now()
   WHERE id = _signer;

  UPDATE public.paige_agreements
     SET content_sha256 = coalesce(content_sha256, _frozen),
         status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
         sent_at = coalesce(sent_at, now()),
         expires_at = _expires,
         updated_at = now()
   WHERE id = _signing_id AND tenant_id = _tenant;

  INSERT INTO public.paige_agreement_events
    (agreement_id, tenant_id, signer_id, event_type, actor_kind, actor_user_id)
  VALUES (_signing_id, _tenant, _signer, 'sent', 'owner', _actor);

  RETURN jsonb_build_object('signing_id', _signing_id, 'token', _token, 'expires_at', _expires);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_agreement_signing_link(uuid,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_agreement_signing_link(uuid,uuid,integer) TO authenticated;
