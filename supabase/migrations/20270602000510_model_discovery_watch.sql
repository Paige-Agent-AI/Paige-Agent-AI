-- ANT-37 Model Discovery Watch — the observation and event store. Append-only by design:
-- observations are what sources SAID (with the date they said it); events are what the diff
-- engine concluded, deduplicated by signature so an unchanged re-announcement never re-alerts.
-- Nothing here grants routing authority: model-fabric.ts never reads these tables (pinned in
-- scripts/model-discovery/discovery-check.mjs).

create table if not exists public.model_discovery_observations (
  id bigint generated always as identity primary key,
  observed_at date not null,                 -- the date the SOURCE said it, never the insert date
  source_url text not null,
  provider text not null,
  model text not null,
  availability text,                          -- ga|preview|deprecated|retired|unknown (null = not stated)
  input_per_1k numeric,
  output_per_1k numeric,
  context_tokens integer,
  tools boolean,
  structured_output boolean,
  streaming boolean,
  raw jsonb not null default '{}'::jsonb,     -- the provider record as observed (evidence, capped by the writer)
  created_at timestamptz not null default now()
);
create index if not exists model_discovery_observations_model_idx
  on public.model_discovery_observations (model, observed_at desc);

create table if not exists public.model_discovery_events (
  id bigint generated always as identity primary key,
  signature text not null unique,             -- basis|value|observed_at — same-day double-beat idempotency
  kind text not null check (kind in ('family_new','family_retired','price_changed','capability_changed','context_changed','stale_source','contradictory_data')),
  model text not null,
  field text,
  before_value text,
  after_value text,
  delta_pct numeric,
  source_url text not null,
  observed_at date not null,
  created_at timestamptz not null default now()
);
create index if not exists model_discovery_events_kind_idx on public.model_discovery_events (kind, created_at desc);

-- The delisting signal needs each model's LAST observation date, wherever it is — a fixed-row
-- window would cover fewer days than STALE_AFTER_DAYS at large catalogs and silently never fire.
-- One exact group-by RPC, service context only.
create or replace function public.model_discovery_last_seen()
returns table(model text, last_seen date, source_url text)
language sql stable security definer set search_path = 'public'
as $$
  select model, max(observed_at), (array_agg(source_url order by observed_at desc))[1]
  from public.model_discovery_observations
  group by model
$$;
revoke all on function public.model_discovery_last_seen() from public, anon, authenticated;
grant execute on function public.model_discovery_last_seen() to service_role;  -- declared intent (house pattern)

-- Service context only: the watch runs from the scheduled function; operators read.
-- RLS is the backstop beneath the grants (no policy on observations = service-role only).
alter table public.model_discovery_observations enable row level security;
alter table public.model_discovery_events enable row level security;
create policy model_discovery_events_operator_read on public.model_discovery_events
  for select to authenticated using (true);
revoke all on public.model_discovery_observations from anon, authenticated;
revoke all on public.model_discovery_events from anon, authenticated;
grant select on public.model_discovery_events to authenticated;  -- operator read surface (no writes)
