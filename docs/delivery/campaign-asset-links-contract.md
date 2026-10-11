# INT-298 / INT-342 MBC 3a — Campaign ↔ asset links

SHELL: SOLO. Coordinator command "Marketing Backend Completion & Analytics Ownership" (owner-authorized
2026-10-11; INT-298, INT-342, Linear ANT-15), slice 3 of 6. Plan: `docs/product/int342-marketing-convergence.md`
§I ("Campaign management: a campaign ↔ asset link and a roll-up metric") and §L.3.

## Why a link table

Before this slice a brief said what content it *needs* (`content_needs`, free text) and nothing could say what content
it *has*. Searched `campaign_brief_id`, `brief_id`, `campaign_id`, `campaign_tag` and `utm_campaign` across every
migration: the only brief link on an asset was `paige_social_posts.campaign_brief_id` (20270122000000). The UTM
match in the metric producer (2a) is evidence a link was shared, not composition.

One Marketing-owned table, `campaign_brief_asset_links`, instead of a brief column on six tables owned by Growth
(pages, forms, funnels), Mail (email campaigns and series) and Content (the library), so no other lane's table or
writer changes. Social posts keep their own column and are read alongside, never copied here.

## Write seam

`configure_campaign_brief_assets(_tenant_id, _command, _idempotency_key, _actor_kind)`, SECURITY DEFINER, empty search
path, modelled on `configure_campaign_brief`:

- **Authority:** the tenant is re-resolved from auth, and a tenant argument naming another workspace is refused
  (42501). Writes need an owner/admin seat or the platform owner (§53). `_actor_kind` is `human` or `paige`.
- **Commands:**
  - `{type:'attach_asset'|'detach_asset', briefId, assetKind, assetId}`.
  - Kinds: `page`, `form`, `funnel`, `email_campaign`, `email_series`, `content`. Ad copy is library content with
    channel `ad_copy`.
- **Outcomes:**
  - `attached`, `already_attached`, `detached` and `not_attached`; repeats are reported, never duplicated.
  - Refusals (22023): `CAMPAIGN_BRIEF_NOT_FOUND` (another workspace's or archived), `CAMPAIGN_ASSET_NOT_FOUND`
    (another workspace's, archived/cancelled/stopped, or the wrong kind), `CAMPAIGN_ASSET_KIND_INVALID`,
    `CAMPAIGN_ASSET_ARGUMENTS_INVALID`, and the ledger's idempotency errors.
- **Idempotency:** the brief's own ledger `campaign_brief_command_results`, with the hash namespaced to this writer.
  A replayed key returns its recorded answer; a key reused for another command is refused.
- **Evidence:** every new command writes `audit_logs` (`campaign_brief.assets`). A link never changes the brief's
  version, so an open brief editor never conflicts with an attach.
- **Integrity for every writer:** a trigger checks on each insert that the brief and the asset belong to the link's
  tenant and are live, and refuses updates (links are immutable). Authenticated users have no direct write grant.

## Read seam

`get_campaign_brief_assets(_tenant_id, _brief_id default null)` returns `{can_manage, links, available}`:

- **`links`:** every live link on the workspace's non-archived briefs (or on one brief), plus social posts that name
  the brief. Each has its kind, id, name, status, slug (pages, forms, funnels), channel (content), how it was
  linked and when, and whether this caller may detach it (never a social post; that is Social's link).
- **Member visibility (§9):** members cannot read email campaigns, email series or library rows, so those links reach
  a member as their kind only (no name, status or channel). Pages, forms, funnels and social posts are readable by
  members, so their names show.
- **Deleted assets:** an asset deleted later has no row, and its link is left out of the read.
- **`available`:** for an owner/admin, up to 200 live assets of each kind, newest first, so a picker and Paige choose
  from one list. A member gets none.

## What a link is not

A planning fact, "this page is part of that campaign." It is not proof of a send, a publish, a visit, reach or
attribution; no count is derived from it here. The roll-up metric (leads per linked form, sends per linked email)
is later work and reads these links.

## Not in this slice

- The Campaigns composition UI (3b).
- A Spine capability key and Chat tool (slice 6, with Platform Reach). The RPC is the callable seam (§10) both use.
- A Rail receipt: the brief writer records receipts only on the Chat path, and this follows the same rule.

## Account retirement

The table is registered `delete` in `operator_retirement_disposition`, with the links leaving alongside their briefs.
The guard is the Finance projection pattern: anchor present, briefs registered, table not yet listed.

## Proof

`supabase/tests/campaign_brief_asset_links.sql`, in the `database-contract` job on the production-schema clone, through
the real writer and read. It covers:

- attaching each kind, a repeat, a replayed key and a conflicting key;
- refusals for another workspace's page and brief, an archived brief, an archived page, a form named as a page, an
  unknown kind, a malformed id and a missing key;
- a spoofed tenant argument and direct insert/delete;
- the admin read (names, the social post, `available` scoped to live assets in this workspace);
- the member read (email and library by kind only, no names, nothing detachable) and a member's write refused;
- detach and repeat, with the form untouched;
- audit and ledger counts;
- trigger integrity for the server role, and immutability;
- a deleted funnel dropping out;
- retirement registration.

Run locally against a stub schema with each guard mutated in turn: removing the asset tenant check, the deleted-asset
filter, the member redaction or the retirement registration each fails the proof. Removing the writer's
archived-brief check does not, because the trigger refuses the same insert.
