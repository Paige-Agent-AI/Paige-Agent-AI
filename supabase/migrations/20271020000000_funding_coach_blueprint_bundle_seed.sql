-- ============================================================================
-- FCB-2a — the `funding_coach` Marketplace BUNDLE candidate (ANT-29, Linear
-- P-ANT-11). First-class Funding Coach Blueprint composition via the EXISTING
-- bundling layer: NO new install kind, NO framework change, NO code payload.
--
-- WHAT IT COMPOSES (bundle children, installed by the existing fan-out with
-- child ownership/refs/receipts and reversible teardown):
--   • `funding` skill v1.1.0 (published by 20260805120000 slice-3) — playbook
--     preset (persona, portal modules, values, refusal boundaries), the
--     five-stage client pipeline journey, skill_flag:funding, finance gate.
--   • `funding_preset` kb_pack v1.0.0 (20260804120000) — the Borrower-to-Banker
--     curriculum, embedded by the marketplace-install edge at install time
--     (deferred embedding, as designed).
-- The bundle's OWN manifest adds only a six-phase COACH journey ladder
-- (ACCEL→BUILD→FUND→REPORT→SHIELD→ACQUIRE — the curriculum's canonical
-- sequence) via the existing journey_stages kind. Slugs are namespaced
-- `funding_coach_*` so they never collide with the funding child's
-- `funding_*` client pipeline stages; teardown removes exactly the bundle's
-- six (source_install_id ownership).
--
-- VISIBILITY: status='unlisted'. The install node DENIES unlisted items to
-- every non-platform-owner (42501), and the tenant catalog requires listed —
-- so this candidate is invisible and uninstallable for tenants until the
-- owner publishes it (ANT-35, owner-reserved). is_finance=true keeps it off
-- new-tenant defaults per the §2 finance guard.
--
-- Idempotent: item INSERT is ON CONFLICT DO NOTHING; the version publish is
-- guarded by NOT EXISTS(version). The service_role claim override clears the
-- operator publish gate for the migration run (postgres); it auto-resets at
-- COMMIT and is cleared explicitly (the slice-3 idiom).
-- ============================================================================
BEGIN;

DO $do$
DECLARE _vendor uuid; _item uuid;
BEGIN
  SELECT id INTO _vendor FROM public.marketplace_vendors WHERE slug='paige';
  IF _vendor IS NULL THEN
    RAISE NOTICE 'marketplace vendor "paige" not found — skipping funding_coach bundle seed';
    RETURN;
  END IF;

  INSERT INTO public.marketplace_items
    (slug,item_type,vendor_id,origin,name,tagline,description,category,icon,scope,status,
     default_for_new_tenants,is_finance)
  VALUES
    ('funding_coach','bundle',_vendor,'first_party',
     'Funding Coach Blueprint',
     'One install: the funding vertical, its knowledge curriculum, and the six-phase coach journey.',
     'The Funding Coach Blueprint bundle (ANT-29/FCB-2a). Composes the existing funding skill v1.1.0 (playbook preset with portal modules, client pipeline journey, funding capability) and the funding_preset Borrower-to-Banker knowledge pack, and adds the six-phase coach journey ladder (ACCEL, BUILD, FUND, REPORT, SHIELD, ACQUIRE). Config-only: no new install kinds, no code, no provider effects. UNLISTED — installable only by the platform owner until separately published (ANT-35).',
     'verticals','GraduationCap','public','unlisted',false,true)
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO _item;

  IF _item IS NULL THEN
    SELECT id INTO _item FROM public.marketplace_items WHERE slug='funding_coach';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.marketplace_item_versions
                  WHERE item_id = _item AND semver = '1.0.0') THEN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM public.marketplace_publish_version(
      'funding_coach', '1.0.0', 'config_only',
      $manifest$
{
  "functions": [
    {
      "kind": "journey_stages",
      "stages": [
        { "slug": "funding_coach_accel",   "label": "ACCEL",  "description": "Credit file correction and compliance foundation — the profile is brought to a fundable baseline.", "display_order": 1, "color_hex": "#818cf8" },
        { "slug": "funding_coach_build",   "label": "BUILD",  "description": "Dual-track foundation — personal credit capacity and four-bureau business credit infrastructure grown together.", "display_order": 2, "color_hex": "#6366f1" },
        { "slug": "funding_coach_fund",    "label": "FUND",   "description": "Capital stacking — funding sources pursued in the correct sequence for the client's tier.", "display_order": 3, "color_hex": "#4f46e5" },
        { "slug": "funding_coach_report",  "label": "REPORT", "description": "Reporting footprint — tradelines furnishing correctly across the bureaus.", "display_order": 4, "color_hex": "#2563eb" },
        { "slug": "funding_coach_shield",  "label": "SHIELD", "description": "Asset protection — personal and business liability separated.", "display_order": 5, "color_hex": "#16a34a" },
        { "slug": "funding_coach_acquire", "label": "ACQUIRE", "description": "Acquisition — the profile positioned for the client's next business move.", "display_order": 6, "color_hex": "#059669" }
      ]
    }
  ],
  "bundle_items": ["funding", "funding_preset"]
}
$manifest$,
      'Funding Coach Blueprint bundle v1.0.0 (ANT-29/FCB-2a): composes funding skill v1.1.0 + funding_preset KB pack as bundle children and adds the six-phase coach journey ladder (journey_stages kind). Unlisted candidate — platform-owner installs only until the owner publishes (ANT-35). No new install kinds; config only.'
    );
    PERFORM set_config('request.jwt.claims', '', true);
  END IF;
END
$do$;

COMMIT;
