-- growth_hosted_deployments — ONE hosted copy per published page (EXP06 WEB-05, owner
-- direction 2026-10-28 88b2f756: build the hosting implementation within existing
-- authority, provider activation HELD).
--
-- Written ONLY by the growth-hosting-command door on its service-role client. RLS is
-- ENABLED with ZERO policies: nobody but the service role (and platform operators above
-- RLS) can read or write these rows — a hosted copy is platform infrastructure state, not
-- tenant-visible data; the customer-facing truth lives on the page's own record and the
-- door's responses. The unique (tenant_id, page_id) index enforces the one-deployment-per-
-- page contract the capability declares. `status` never says "live" on the door's word
-- alone: `live` is written only after the REAL HTTPS verification matched the exported
-- bytes; anything uncertain is verify_failed / removed_unconfirmed and stays a human's
-- next decision.

CREATE TABLE IF NOT EXISTS public.growth_hosted_deployments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  page_id         uuid NOT NULL REFERENCES public.growth_pages(id) ON DELETE CASCADE,
  deployment_name text NOT NULL,
  url             text,
  export_sha256   text NOT NULL,
  status          text NOT NULL CHECK (status IN ('deploying','live','verify_failed','removed','removed_unconfirmed','failed')),
  verified_at     timestamptz,
  last_error      text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS growth_hosted_deployments_tenant_page_key
  ON public.growth_hosted_deployments (tenant_id, page_id);

CREATE INDEX IF NOT EXISTS growth_hosted_deployments_tenant_idx
  ON public.growth_hosted_deployments (tenant_id);

ALTER TABLE public.growth_hosted_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_hosted_deployments FORCE ROW LEVEL SECURITY;
-- Deliberately NO policies: with FORCE RLS and no policies, every non-service role is
-- denied by default; only the door's service-role client writes.
