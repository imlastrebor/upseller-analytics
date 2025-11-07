-- Supabase schema for multi-tenant Voiceflow analytics ingestion.
-- Run via Supabase SQL editor or `supabase db push`.

-- Ensure UUID helpers are available.
create extension if not exists "pgcrypto";

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

comment on table public.tenants is 'Top-level tenant record for each client.';

create table if not exists public.vf_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  api_key_encrypted text not null,
  environment_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

comment on column public.vf_credentials.api_key_encrypted is 'Store encrypted Voiceflow API key (never plaintext).';

create table if not exists public.vf_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vf_project_id text not null,
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, vf_project_id)
);

comment on table public.vf_projects is 'Maps tenants to their Voiceflow project identifiers.';

create table if not exists public.vf_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vf_project_id text not null,
  metric text not null,
  period timestamptz,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, vf_project_id, metric, period, data)
);

comment on table public.vf_usage is 'Stores raw Voiceflow metric items per tenant/project/metric/period.';

create index if not exists vf_usage_lookup_idx
  on public.vf_usage (tenant_id, vf_project_id, metric, period);

create unique index if not exists vf_credentials_single_active_idx
  on public.vf_credentials (tenant_id)
  where active;

create table if not exists public.vf_pulls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vf_project_id text not null,
  metric text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  cursor jsonb,
  status text not null default 'pending',
  error_json jsonb,
  ran_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.vf_pulls is 'Log of Voiceflow collection runs for observability and retry logic.';

create index if not exists vf_pulls_lookup_idx
  on public.vf_pulls (tenant_id, vf_project_id, metric, ran_at desc);

create table if not exists public.event_write_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, token)
);

comment on table public.event_write_tokens is 'Per-tenant write tokens for custom event ingestion.';

create table if not exists public.events_raw (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id text,
  event_name text not null,
  occurred_at timestamptz not null default now(),
  user_id text,
  session_id text,
  properties jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique (event_id)
);

comment on table public.events_raw is 'Custom goal events emitted by widgets or integrations.';

create index if not exists events_raw_tenant_event_idx
  on public.events_raw (tenant_id, event_name, occurred_at);

-- RLS scaffolding: enable then tighten policies when auth is attached.
alter table public.tenants enable row level security;
alter table public.vf_credentials enable row level security;
alter table public.vf_projects enable row level security;
alter table public.vf_usage enable row level security;
alter table public.vf_pulls enable row level security;
alter table public.event_write_tokens enable row level security;
alter table public.events_raw enable row level security;

-- Placeholder policies allowing service_role access; replace with scoped policies once JWT auth is wired.
drop policy if exists tenants_service_role_full on public.tenants;
create policy tenants_service_role_full
  on public.tenants
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists vf_credentials_service_role_full on public.vf_credentials;
create policy vf_credentials_service_role_full
  on public.vf_credentials
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists vf_projects_service_role_full on public.vf_projects;
create policy vf_projects_service_role_full
  on public.vf_projects
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists vf_usage_service_role_full on public.vf_usage;
create policy vf_usage_service_role_full
  on public.vf_usage
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists vf_pulls_service_role_full on public.vf_pulls;
create policy vf_pulls_service_role_full
  on public.vf_pulls
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists event_write_tokens_service_role_full on public.event_write_tokens;
create policy event_write_tokens_service_role_full
  on public.event_write_tokens
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists events_raw_service_role_full on public.events_raw;
create policy events_raw_service_role_full
  on public.events_raw
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
