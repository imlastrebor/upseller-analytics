-- Analytics schema and read-only role for Metabase access.
-- Apply in Supabase (SQL editor or psql).

-- 1) Schema and views (safe projections only)
create schema if not exists analytics;

create or replace view analytics.events as
select
  event_id,
  tenant_id,
  project_id,
  event_name,
  occurred_at,
  user_id,
  session_id,
  properties,
  received_at
from public.events_raw;

create or replace view analytics.vf_usage as
select
  tenant_id,
  vf_project_id as project_id,
  metric,
  period,
  data,
  created_at
from public.vf_usage;

create or replace view analytics.vf_usage_with_tenant as
select
  u.tenant_id,
  t.slug as tenant_slug,
  t.name as tenant_name,
  u.vf_project_id as project_id,
  u.metric,
  u.period,
  u.data,
  u.created_at
from public.vf_usage u
join public.tenants t on t.id = u.tenant_id;

create or replace view analytics.vf_pulls as
select
  tenant_id,
  vf_project_id as project_id,
  metric,
  window_start,
  window_end,
  status,
  ran_at,
  created_at,
  cursor,
  error_json ->> 'message' as error_message,
  error_json as error_details
from public.vf_pulls;

-- 2) Read-only role (replace password before running)
do
$$
begin
  if not exists (select 1 from pg_roles where rolname = 'metabase_readonly') then
    create role metabase_readonly login password 'hAZ4tRkUq58SgjF';
  end if;
end
$$;

alter role metabase_readonly set search_path = analytics, public;

-- 3) Grants for the read-only role
grant connect on database postgres to metabase_readonly;

-- Limit schema access
revoke all on schema public from metabase_readonly;
grant usage on schema public to metabase_readonly; -- needed for view resolution
grant usage on schema analytics to metabase_readonly;

-- Base tables needed for views (RLS policies below govern row access)
grant select on public.events_raw to metabase_readonly;
grant select on public.vf_usage to metabase_readonly;
grant select on public.vf_pulls to metabase_readonly;

-- Views
grant select on all tables in schema analytics to metabase_readonly;

-- Default privileges for future views in analytics
alter default privileges in schema analytics grant select on tables to metabase_readonly;
alter default privileges in schema analytics grant select on sequences to metabase_readonly;

-- 4) RLS policies to permit read-only role
drop policy if exists events_raw_read_analytics on public.events_raw;
create policy events_raw_read_analytics
  on public.events_raw
  for select
  to metabase_readonly
  using (true);

drop policy if exists vf_usage_read_analytics on public.vf_usage;
create policy vf_usage_read_analytics
  on public.vf_usage
  for select
  to metabase_readonly
  using (true);

drop policy if exists vf_pulls_read_analytics on public.vf_pulls;
create policy vf_pulls_read_analytics
  on public.vf_pulls
  for select
  to metabase_readonly
  using (true);

-- 5) Validation steps (manual)
-- As a superuser/service role:
--   select nspname from pg_namespace where nspname = 'analytics';
--   \dv analytics.*
--
-- As metabase_readonly (psql -U metabase_readonly -h <supabase_host> -d postgres):
--   show search_path;
--   select * from analytics.events limit 5;
--   select * from analytics.vf_usage limit 5;
--   select * from analytics.vf_pulls limit 5;
--   select * from public.vf_credentials limit 1; -- should fail
