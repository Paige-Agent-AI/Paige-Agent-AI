-- E09 Customer Portal identity: the customer's consent sentences stop naming PAIGE.
--
-- Owner ruling (Antonio, 2026-10-19): "CURA is supposed to be one of our agents that is assigned under
-- PAIGE ... PAIGE should not be inside of the Customer Portal. She's a COO not a customer specialist."
--
-- Four sentences the customer reads at the moment of a choice still said "through Paige" or
-- "{business}'s Paige" (20271110215000). Each is pinned by its hash in the evidence the portal writes
-- ('portal:<uid>:<id>:<first 12 of md5(text)>'), so a sentence is never edited: it gets a new id, the
-- old id stays because evidence already written names it, and every writer records the new id.
--
--   email-pref:v2      -> email-pref:v3      (drops "through Paige")
--   updates-optin:v2   -> updates-optin:v3   (drops "sent through Paige")
--   sms-pref:v2        -> sms-pref:v3        (drops "through Paige")
--   data-sharing:v1    -> data-sharing:v2    ("{business}'s Paige" becomes what the switch actually does)
--
-- data-sharing:v2 says only what the switch governs. The flag the customer sets
-- (clients.paige_shared_context_consent) gates two business-side paths. admin_propose_paige_actions is the one
-- writer of paige_customer_actions, which the portal lists as "Action items". Two callers reach it: staff typing in
-- ContactPaigePanel (mounted only in the unrouted admin/ContactDetail.tsx), and the owner's PAIGE chat, whose
-- action_file/action_advance tools file an action with a title and draft the AI wrote, which advance_action
-- (20271110220000) hands to admin_propose_paige_actions for every surface_to_client kind. load_contact_context is
-- the fuller summary of a contact a team-side assistant may load. The switch does not gate messages, shared work,
-- agreements or invoices; it does not change what the customer's own portal assistant (Cura, or the business's
-- renamed agent) uses to answer them, because client_portal_assistant_context never reads the flag; and it does not
-- change what the business, or its owner-side chat, can already read in its own records (crm_get_contact_summary,
-- crm_search_contacts and client_memory read the same fields on or off). The sentence says each of those.
-- Today no action item reaches a customer by either route. The chat's route fails: advance_action passes the action
-- kind (client.portal_recommendation, owner.onboarding_nudge, ...) as action_type, which
-- paige_customer_actions_action_type_check refuses (task/message/recommendation/nudge only), so the action ends
-- blocked. The staff panel is not mounted. So the switch has no practical effect yet. The mapping defect, and
-- the AI-drafted action text not being filtered for PAIGE (which must be fixed first), are tracked follow-ups in
-- the master reference §5. v1's "It has no effect yet" was dropped because both server checks exist. Apostrophes in
-- this sentence are curly, matching the heading, row and line around it on the page. (CURA-D1, integrator default,
-- owner may overrule, 2026-10-19; round 4 named staff as the only source of action items, which was wrong, and
-- round 5 corrected it in place: this id was never recorded in any consent record.)
-- The sentence has no agent placeholder, so the stored hash fully names the wording apart from {business}.
--
-- THE WRITERS ARE REWRITTEN IN PLACE, NOT RE-DECLARED. client_portal_set_communication_preference and
-- client_portal_set_shared_context_consent are read from the catalog and only their disclosure-id
-- literals are swapped, so whichever body is current (20271110215000, or a later slice that re-gates
-- them) keeps everything else byte for byte. Each swap is counted: a body that has drifted, already
-- names a new id, or still names an old one afterwards stops the migration (the 20271108241000 pattern).
-- Refusal codes, response shapes, grants and comments are unchanged; CREATE OR REPLACE keeps the ACL.
-- Renumbered 20271110250000 -> 20271111020000 (round 6) so it runs after Slice 7 (20271111010000, production's
-- newest, applied 2026-10-19 06:29Z, after the mentor remap 20271111000000), which re-gates both writers on the customer's portal access. Read from the
-- catalog, Slice 7's gate is carried forward unchanged; only the id literals move (proved in a rolled-back
-- transaction: each body with the ids swapped back is byte-identical to Slice 7's).

CREATE OR REPLACE FUNCTION public.client_portal_consent_disclosure(p_id text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT CASE p_id
  WHEN 'email-pref:v1' THEN 'Email from {business}. When email is off, {business} won''t email you through Paige. Confirmations for times you book, and changes you make to them, still arrive.'
  WHEN 'email-pref:v2' THEN 'Email from {business}. When email is off, {business} won''t email you through Paige, except booking confirmations and agreements you''re asked to sign. Turning email off also unsubscribes you from updates and offers, and turning it back on doesn''t subscribe you again.'
  WHEN 'email-pref:v3' THEN 'Email from {business}. When email is off, {business} won''t email you, except booking confirmations and agreements you''re asked to sign. Turning email off also unsubscribes you from updates and offers, and turning it back on doesn''t subscribe you again.'
  WHEN 'updates-optin:v1' THEN 'Updates and offers: newsletters and automated marketing emails from {business}, sent through Paige. You can unsubscribe anytime.'
  WHEN 'updates-optin:v2' THEN 'Newsletters and automated marketing emails from {business}, sent through Paige. You can unsubscribe anytime.'
  WHEN 'updates-optin:v3' THEN 'Newsletters and automated marketing emails from {business}. You can unsubscribe anytime.'
  WHEN 'sms-pref:v1' THEN 'Texts from {business}. When texts are off, {business} can''t text you through Paige. To get texts again, reply START to a text from {business}.'
  WHEN 'sms-pref:v2' THEN 'Texts from {business}. When texts are off, {business} can''t text you through Paige. To get texts, reply START to a text from {business} if you have one, or ask them.'
  WHEN 'sms-pref:v3' THEN 'Texts from {business}. When texts are off, {business} can''t text you. To get texts, reply START to a text from {business} if you have one, or ask them.'
  WHEN 'data-sharing:v1' THEN 'Lets {business}''s Paige use your account details and portal activity when it prepares requests or suggestions for you. It has no effect yet, and you can turn it off anytime.'
  WHEN 'data-sharing:v2' THEN 'Lets {business}’s team send you action items in your portal, including ones its AI assistant drafts, and give that assistant a fuller summary of you. It doesn’t change messages, shared work, agreements or invoices, what your portal assistant uses to answer you, or what {business} can already see in its own records. You can turn it off anytime.'
  END $$;
REVOKE ALL ON FUNCTION public.client_portal_consent_disclosure(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_consent_disclosure(text) TO authenticated, service_role;

DO $migration$
DECLARE
  definition text;
  swap record;
  occurrences int;
BEGIN
  -- Communication preferences: email, Updates and texts.
  definition := pg_catalog.pg_get_functiondef('public.client_portal_set_communication_preference(text,text,boolean,uuid)'::regprocedure);
  IF position('CREATE OR REPLACE FUNCTION public.client_portal_set_communication_preference(' in definition) <> 1 THEN
    RAISE EXCEPTION 'CUSTOMER_IDENTITY_WRITER_SOURCE_DRIFT: communication preference writer';
  END IF;
  FOR swap IN SELECT * FROM (VALUES ('email-pref:v2','email-pref:v3'), ('updates-optin:v2','updates-optin:v3'), ('sms-pref:v2','sms-pref:v3')) v(old_id, new_id) LOOP
    occurrences := (length(definition) - length(replace(definition, quote_literal(swap.old_id), ''))) / length(quote_literal(swap.old_id));
    IF occurrences < 1 OR position(quote_literal(swap.new_id) in definition) <> 0 THEN
      RAISE EXCEPTION 'CUSTOMER_IDENTITY_WRITER_SOURCE_DRIFT: % appears % times', swap.old_id, occurrences;
    END IF;
    definition := replace(definition, quote_literal(swap.old_id), quote_literal(swap.new_id));
  END LOOP;
  IF definition ~ '''(email-pref|updates-optin|sms-pref):v[12]''' THEN
    RAISE EXCEPTION 'CUSTOMER_IDENTITY_WRITER_SOURCE_DRIFT: a superseded id survives in the communication writer';
  END IF;
  EXECUTE definition;

  -- Shared-context consent.
  definition := pg_catalog.pg_get_functiondef('public.client_portal_set_shared_context_consent(boolean,uuid)'::regprocedure);
  IF position('CREATE OR REPLACE FUNCTION public.client_portal_set_shared_context_consent(' in definition) <> 1 THEN
    RAISE EXCEPTION 'CUSTOMER_IDENTITY_WRITER_SOURCE_DRIFT: shared context writer';
  END IF;
  occurrences := (length(definition) - length(replace(definition, '''data-sharing:v1''', ''))) / length('''data-sharing:v1''');
  IF occurrences <> 2 OR position('''data-sharing:v2''' in definition) <> 0 THEN
    RAISE EXCEPTION 'CUSTOMER_IDENTITY_WRITER_SOURCE_DRIFT: data-sharing:v1 appears % times', occurrences;
  END IF;
  EXECUTE replace(definition, '''data-sharing:v1''', '''data-sharing:v2''');
END $migration$;
