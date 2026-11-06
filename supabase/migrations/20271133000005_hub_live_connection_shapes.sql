-- Widen the Social door's committed shapes to what the shipped code already promises.
--
-- WHAT (owner 2026-11-06: "My connections are not live… I want to start reconnecting
-- all of my live connections"): three constraints written for the Solo-only,
-- social-only door now block the Platform Operator's shipped flows —
--   1. attempts.return_path refused '/operator/settings/integrations', so every
--      operator OAuth connect died at the attempt insert (surfaced mis-mapped as
--      provider_request_failed; the provider was never asked);
--   2. connections.requested_platform (and the attempts twin) refused the connection
--      apps the door already validates (google, discord, telegram);
--   3. connections.provider_profile_shape refused the 'hub:<tenant>:<profile>:<platform>'
--      keys the adopt RPC writes, so no adoption could ever commit.
-- WHY A MIGRATION, NOT A REPAIR: the door, callback, adapter and UI all widened in
-- their own PRs; these CHECKs are the last holdouts. Each new shape below matches its
-- code counterpart exactly (edge RETURN_PATH regex; SOCIAL_CONNECTION_PLATFORMS;
-- social_adopt_platform_channels' key format) — no new surface is invented here.

begin;

-- 1. The attempt's return destination accepts exactly what the door and callback accept.
alter table public.paige_social_connection_attempts
  drop constraint if exists paige_social_connection_attempts_return_path_check;
alter table public.paige_social_connection_attempts
  add constraint paige_social_connection_attempts_return_path_check check (
    return_path ~ '^/(solo/[A-Za-z0-9_-]+|operator)/settings/integrations/?$'
  );

-- 2. Connecting widens to the provider's apps beyond Social (the door's
--    SOCIAL_CONNECTION_PLATFORMS set); publishing stays gated in code, not here.
alter table public.paige_social_connections
  drop constraint if exists paige_social_connections_requested_platform_shape;
alter table public.paige_social_connections
  add constraint paige_social_connections_requested_platform_shape check (
    requested_platform is null or requested_platform in (
      'tiktok','instagram','facebook','linkedin','youtube','x','threads',
      'pinterest','google_business','snapchat',
      'google','discord','telegram'
    )
  );

alter table public.paige_social_connection_attempts
  drop constraint if exists paige_social_connection_attempts_platform_shape;
alter table public.paige_social_connection_attempts
  add constraint paige_social_connection_attempts_platform_shape check (
    requested_platform is null or requested_platform in (
      'tiktok','instagram','facebook','linkedin','youtube','x','threads',
      'pinterest','google_business','snapchat',
      'google','discord','telegram'
    )
  );

-- 3. Adopted channels carry their own key shape ('hub:<tenant uuid>:<hub profile
--    id>:<platform>', minted by social_adopt_platform_channels) beside the per-
--    connection OAuth keys; the (provider_key, provider_profile_key) uniqueness
--    that keeps two workspaces' adoptions distinct is unchanged.
alter table public.paige_social_connections
  drop constraint if exists paige_social_connections_profile_shape;
alter table public.paige_social_connections
  add constraint paige_social_connections_profile_shape check (
    provider_profile_key ~ '^ps_[0-9a-f]{40}$'
    or provider_profile_key ~ '^hub:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9_-]{6,64}:[a-z][a-z0-9_]{0,31}$'
  );

-- 4. The adopt RPC's only caller is the door's service-role client; the creating
--    migration revoked all and granted no one, so even unblocked CHECKs would die
--    one step later with permission denied. Same grant its sibling writers carry.
grant execute on function public.social_adopt_platform_channels(uuid, uuid, uuid, text, jsonb, timestamptz) to service_role;

commit;
