# Teach CURA: original-source inventory

Owner mandate: ANT-163, October 21 EXP09 takeover. This is an additive read prerequisite for Teach CURA, using the inherited K1 audience and Knowledge contracts. It is not the completed teaching interface or authenticated customer acceptance.

## Outcome and boundaries

`read_client_portal_business_knowledge(uuid,uuid,text,integer,integer)` lets the actual business publisher inspect existing source versions, publication readiness, customer kind, validity window, withdrawal, source drift and original receipt. Search and pagination are bounded. An exact document argument narrows the same authorized business, never selects another one.

Authority is the unchanged `_client_knowledge_business_publisher`: verified actor, current active workspace, authorized Knowledge actor and real owner/admin membership chain. A customer, ordinary member, bare platform Operator, another business owner or stale selected workspace receives the same refusal. The function has an empty search path and authenticated-only execution. The original share table stays RPC-only. No existing function, table, policy or grant is changed.

The projection contains no content, pending review text, source URLs, author identity, customer identity or conversation history. `source_state=prepared` describes an existing pinned canonical source, not a model execution. `share_state=shared` describes that business-audience grant's current source and window; every customer still needs their own active authorized relationship. It does not prove reach, delivery, retrieval, a visit or a human read. Missing shares are explicit nulls. Optional finance eligibility uses the incumbent entitlement, with no new entitlement or classification rule.

No source is saved, indexed, published, shared or retired by this read. No provider, queue, job, Memory or receipt is created. Existing `prepare_/set_client_portal_business_knowledge_share` remain the single business audience writers. Reviewed publication stays in the existing Knowledge extraction/review/publication worker. Later Chat and Portal controls will consume these same contracts.

## Verification and release

Migration `20271113060000_e09_cura_knowledge_inventory.sql` is above the observed production frontier `20271113040000` and independently allocated K2 `20271113050000`. The new reader does not depend on K2. Five unchanged dependency body/owner leases were read from production before preparation; there is no history rewrite, backfill or automatic publication.

`supabase/tests/e09_cura_knowledge_inventory.sql` uses the original K1 synthetic fixtures under rollback and actual database roles. Fifty assertions cover publisher and tenant negatives, closed metadata, literal search, pagination, source preparation, original writer/readback/receipt parity, source changes, dates, withdrawal and entitlement/membership loss. Full-schema execution, exact-head CI/Preview and final non-author review are pending at preparation. No source-only assertion is authenticated runtime proof.

After merge, verify the exact migration, new body/ACL, unchanged dependency bodies and unchanged source/share counts. Record actual identities in Master Reference section 4.0 closeout. No consumer Edge or visible interface changes in this prerequisite. Authenticated owner teaching and customer CURA use remain UNVERIFIED until the integrated workflow is driven.

Internal identity: exact PR head and later merge/deploy identities are recorded in its PR/closeout. Channel development at preparation; ordinary production prerequisite only after review/green. Internal-only, no customer version, release announcement or outside-customer launch. Recovery is a reviewed forward correction; source, grants, history and receipts remain original.

Algorithm support: deterministic state projection supplies source/window/entitlement evidence to future ALG-12/13 consumers. This is not a production anomaly or next-best-action algorithm. ALG-01/02/04 remain unchanged and unverified at the complete Experience level. The seven client-success Capabilities remain separate delivery obligations.
