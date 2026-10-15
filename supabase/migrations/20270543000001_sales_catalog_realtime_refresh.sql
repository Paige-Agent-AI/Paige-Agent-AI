-- Canonical Catalog readers listen only to invalidation and refetch scoped facts.
-- Existing RLS/ACL remain unchanged. No REPLICA IDENTITY FULL/old-row payload exposure.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='tenant_products') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_products;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='tenant_prices') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_prices;
    END IF;
  END IF;
END $$;
