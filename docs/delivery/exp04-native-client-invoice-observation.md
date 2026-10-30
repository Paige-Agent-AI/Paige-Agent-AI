# EXP04 O11 — original native invoice source observation

Status: source implemented locally; full-schema financial behavior, final review, exact-head CI, release and customer acceptance remain owed. Same original ANT-51 O1–O12 assignment and ANT-163 producer contract; not a new capability lane. No Portal or Chat mount in this increment.

## One query and one business calendar

The existing private four-argument invoice core becomes an exact compatible delegate to the same query with an explicit fifth internal date argument. The financial query is transformed from its guarded native body, not copied into another permanent query. Full inverses must reproduce the original private body d86613d312960b0d507898210e7e5197 and earlier public body28df84d29fcde1e64bb09153f4d3e77b. Original caller-JWT resolver7785, scoped wrappera13e, public wrapper91f0, defaults and grants stay unchanged.

The old four-argument/public paths retain their original UTC date and entire public JSON. Only the native path uses the configured business date. It factors the SAME read_business_time_zone logic into a private invoker helper; the original owner/admin reader retains its OID, authority, owner-only can_set meaning, response and no-receipt behavior. The whole calendar/authority inverse must reproduce4fc91b47874d78ccac6728dcd95eb126. No second calendar setting, date engine, ledger, payment allocation or receipt store.

The CLI-created, UNAPPLIED forward is20271126010004, above the observed production frontier26000000. Earlier proposed80006 was never built or applied. Applied80004/80005 and their historical Preview files remain unchanged.

## Private source ABI

- _client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date): the ONE original query. Original balances/counts/ordering/validation/provider/manual/test facts remain; internal output adds each original issued snapshot version and a SHA256 identity over ALL original facts, including rows outside the returned page.
- _business_time_zone_for_tenant(uuid,timestamptz): original configured zone and conversion, at an explicit finite observation time. Missing and invalid settings stay explicit; neither becomes UTC. No caller preference or invented date.
- _client_portal_invoice_observation_for_client(uuid,uuid): private resolved business/client inputs, actual client-in-business check, fixed limit5/cursorNULL. Returns schema_version1, tenant_id, client_id, query, calendar, facts, observation_identity and read_at. The identity binds the original records/query/calendar/facts, excluding only volatile read timestamps.

All three are volatile invoker functions, postgres-owned, empty search_path, explicit inputs/no defaults, no PUBLIC/anon/authenticated/service_role execution grant. They confer NO requester authority. The existing four-argument core remains private with its original ABI and ACL.

An unknown calendar does not erase balances or invent an overdue answer. A positive outstanding dated invoice has past_due:null without an as-of date; paid, voided or undated records keep their original non-overdue meaning. All-page totals, counts, has_more and next_cursor remain canonical. A limited page never establishes the globally next payment.

## Authorization and orchestration boundary

The eventual entry is an authorized customer's original private Portal/CURA context. No new public Spine registration or model tool is exposed here. The new customer path remains UNAVAILABLE until the paired native consumer is integrated; existing Billing remains the original legitimate governed path.

The original E09 accepted-requester/current-business/client relationship, begin/context/terminal/private-history and final-publication chain is the only intended consumer. It must prove current authority, original source identity, writer/relationship lock ordering, revocation, interruption, unknown-outcome and reload behavior before admitting these facts to a new model answer. A versioned read alone is NOT safe final publication or an executed commercial action.

This is an ordinary stored-source read: no Layer C action, human approval, durable job or scheduler is needed. No Stripe call, charge, signing, external send or provider activation occurs. Original invoices/payments are the durable business records; original conversation/turn/Rail contracts own any later result. No new execution architecture or competing receipt.

## Verification and release boundary

Initial exact test-only head0a91d5cef718fd3debdb742374a5d8fd5c581f44 genuinely failed the new missing-five-argument assertion AFTER original EXP04 status assertions passed: native job123522160285/run40895164670. The failing result is retained; no source check was weakened.

Bounded local PostgreSQL16 catalogue proof passes: actual migration compilation, exact four-argument/public metadata, whole original financial/calendar inverses, all eight function records across replay, and six hostile source/permission controls. The existing five incumbent source bodies were hash-verified against production and loaded into a DISPOSABLE metadata-only database with body validation off only during incumbent bootstrap; validation was on for ALL new source. No Auth/domain tables or real financial behavior were available there. Thus this proves source/catalogue compatibility, NOT full-schema money, customer authorization or acceptance. An initial missing client-side terminator was an excluded fixture setup failure; its database was dropped. Every final disposable database was dropped.

The original full-schema rollback fixture retains every incumbent assertion and adds real native date/DST/missing-invalid/version/balance/cursor/API-denial controls, a temporary frozen original-query oracle, and an off-page identity counterfactual. The metadata extension retains the entire original query hash and authority pins. Replay reuses the actual migration only AFTER the synthetic fixture has rolled back.

Implementation4f716faa reached the new full-schema controls: private metadata, whole original query inverse, complete legacy JSON at sizes1/5/40 and cursor PASS. Required native job123552990137/run40903814569 then FAILED at the new off-page fixture's set_config(session_replication_role) inside a DO block. The later date/identity/role/replay controls were NOT_RUN; this is not a complete financial pass. Repair ONLY that test setup to use the SAME standalone SET LOCAL convention as the incumbent fixture, retaining all three causal change/restoration assertions and restoring triggers before every source read. No parameter grant, checker/CI weakening or product/migration edit. The already-applied native26010004 stays byte-exact. Renewed exact-head full-schema checks remain required.

Managed Previeweuowxrtjupbpbgllyhaw at4f716faa is genuinely SUCCESS: native26010004 ONCE/frontier26010004, all8 expected source bodies/owners/settings/ACLs/defaults read back, Auth0/Clients0. New3 helpers remain private invokers; no API/service grant. Healthy Preview metadata is separate from the failed financial test and is never substituted for customer proof.

Native1d4 job123565771267/run40907392432 confirms the protected-setting repair: standalone SET/UPDATE1/SET all succeed. The off-page comparison then FAILED because its before/after are now separate statements and the ORIGINAL read_at uses statement_timestamp. Correct that test expectation only: financial/page/cursor comparison excludes precisely read_at and the deliberately changed native identity; restoration excludes only read_at and still requires the entire original source identity. Legacy complete-JSON oracle comparisons remain exact inside their original single statement. No amount, record, cursor, version, calendar or source-identity predicate is removed. This is a fixture timestamp correction, not a product function repair or complete financial pass; renewed exact-head proof is required.

Full-schema Preview, exact final-head review and required checks, normal production deployment and native readback remain mandatory. No edit of an applied Preview migration is allowed; a later functional correction requires a reviewed forward.

Functional: local source and bounded catalogue proof only. Visual/experiential: no changed mounted UI; public Billing contract remains compatible, original Portal integration and both-chat/reload proof owed. ALG01/12 source identity/refusal support only, ALG02 incomplete, ALG13 unverified; no maturity/catalogue promotion. Founder acceptance NOT_READY; all twelve original outcomes remain required.
