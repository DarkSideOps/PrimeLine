-- UNTESTED DRAFT. DO NOT APPLY TO PRODUCTION WITHOUT REVIEW/BACKUP.
begin;

alter table public.sportsbooks add column if not exists provider text;
alter table public.sportsbooks add column if not exists is_trusted boolean not null default false;
create unique index if not exists sportsbooks_provider_provider_id_uq on public.sportsbooks(provider,provider_sportsbook_id) where provider_sportsbook_id is not null;

create table if not exists public.market_observations (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 provider text not null,
 entitlement text not null check(entitlement in ('production','replay','trial')),
 provider_event_id text not null,
 provider_market_id text not null,
 provider_outcome_id text not null,
 sportsbook_id uuid not null references public.sportsbooks(id),
 raw_snapshot_id bigint references public.odds_snapshots(id),
 market_type text not null check(market_type in ('moneyline','spread','total')),
 is_alternate boolean not null,
 period text not null,
 side text not null,
 line numeric,
 american_odds integer,
 decimal_odds numeric,
 is_live boolean not null,
 is_available boolean not null,
 provider_updated_at timestamptz not null,
 observed_at timestamptz not null,
 ingested_at timestamptz not null default now(),
 validation_status text not null check(validation_status in ('valid','invalid','quarantined')),
 validation_errors text[] not null default '{}',
 check(american_odds is null or abs(american_odds)>=100),
 check(line is null or abs(line)<=1000)
);
create index if not exists market_observations_lookup_idx on public.market_observations(game_id,sportsbook_id,market_type,period,is_alternate,is_live,provider_updated_at desc);

-- Existing schema currently has UNIQUE(provider,provider_game_id), which is too broad for separate NFL/CFB namespaces.
alter table public.games drop constraint if exists games_provider_provider_game_id_key;
alter table public.games add constraint games_provider_sport_provider_game_id_key unique(provider,sport,provider_game_id);

alter table public.prime_recommendations add column if not exists market_observation_id uuid references public.market_observations(id);
alter table public.prime_recommendations add column if not exists provider_outcome_id text;

create or replace view public.current_valid_markets as
with eligible as (
 select mo.*,s.name sportsbook_name,s.key sportsbook_key,
 row_number() over(partition by mo.game_id,mo.sportsbook_id,mo.market_type,mo.period,mo.side order by mo.provider_updated_at desc,mo.observed_at desc,mo.ingested_at desc,mo.id desc) rn
 from public.market_observations mo
 join public.sportsbooks s on s.id=mo.sportsbook_id
 where mo.entitlement='production' and mo.validation_status='valid' and s.is_trusted
   and lower(s.name)<>'scrambled' and mo.is_live=false and mo.is_available=true and mo.is_alternate=false
   and mo.provider_updated_at >= now()-interval '15 minutes'
)
select * from eligible where rn=1;

create or replace view public.eligible_prime_recommendations as
select r.*
from public.prime_recommendations r
join public.current_valid_markets m on m.id=r.market_observation_id and m.provider_outcome_id=r.provider_outcome_id
where r.status='active';

revoke all on public.market_observations from anon;
revoke select on public.game_markets from anon;
revoke select on public.odds_snapshots from anon;
grant select on public.current_valid_markets to anon;
grant select on public.eligible_prime_recommendations to anon;

alter table public.market_observations enable row level security;
-- No anon/authenticated write policy is intentionally created. Service-role ingestion bypasses RLS.

commit;

-- NOTE: completeness (both ML/spread sides, over+under at same sportsbook/market observation)
-- should be enforced by a second canonical view or ingestion transaction after provider semantics are confirmed.
-- Range checks above are defense-in-depth only; entitlement/provenance is authoritative.
