# Upseller Analytics – End-to-End Runbook

This document explains what the project does, the infrastructure pieces (Vercel, Supabase, Hetzner/Metabase), and the exact steps to reproduce the setup and verify data collection. It is meant for anyone in the company to follow.

## 1) What the project does
- Collects Voiceflow usage metrics via Vercel serverless endpoints.
- Stores Voiceflow metrics in Supabase (`vf_usage`, `vf_pulls`).
- Ingests widget events (e.g., `widget_seen`, `feedback_submitted`) into Supabase (`events_raw`).
- Exposes read-only analytics views and a least-privilege DB user for Metabase dashboards.
- Hosts Metabase (Docker) on Hetzner with TLS via Caddy; connects Metabase to Supabase with the read-only role.

## 2) Components and hosts
- **Vercel (serverless API + cron)**: `https://upseller-analytics.vercel.app`
  - Endpoints:
    - `/api/vf/usage` – manual Voiceflow proxy (per-tenant/project).
    - `/api/cron/vf-usage` – scheduled collector (03:00 UTC via `vercel.json`).
    - `/api/events` – widget/custom event ingestion with per-tenant tokens + CORS.
- **Supabase (Postgres + RPC + RLS)**:
  - Tables: `tenants`, `vf_credentials`, `vf_projects`, `vf_usage`, `vf_pulls`, `event_write_tokens`, `events_raw`, `tenant_domains`.
  - Views (schema `analytics`): `events`, `vf_usage`, `vf_usage_with_tenant`, `vf_pulls`.
  - Read-only role: `metabase_readonly` (search_path `analytics, public`), granted select on analytics views and base tables needed for view resolution; blocked from secrets (`vf_credentials`, `event_write_tokens`).
- **Hetzner host (Metabase stack)**: `analytics.upseller.fi`
  - Docker Compose at `/opt/metabase`.
  - Containers: `metabase`, `metabase-postgres` (Metabase app DB), `caddy` (TLS reverse proxy).
  - Metabase connects to Supabase using the read-only user via the Supabase pooler.

## 3) Required configuration
### Vercel environment variables
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DEFAULT_TENANT`
- Optional: `VF_METRICS`, `VF_TIMEZONE`, `VF_ENVIRONMENT_ID`

### Supabase data setup per tenant (e.g., PKS)
- `tenants`: row with `slug` (e.g., `pks`), `name`.
- `vf_credentials`: active row with encrypted Voiceflow API key (`encrypted:<key>`).
- `vf_projects`: active project IDs per tenant.
- `event_write_tokens`: per-tenant ingestion tokens for `/api/events`.
- `tenant_domains`: allowed origins for `/api/events` CORS (e.g., `https://www.pks.fi`, `https://pks.fi`).

### Metabase connection (read-only)
- Host (pooler): `aws-1-eu-north-1.pooler.supabase.com`
- Port: `6543`
- Database: `postgres`
- User: `metabase_readonly.<projectref>` (example: `metabase_readonly.lbkhsxdndeoozrvxyvhf`)
- Password: set via `alter role metabase_readonly with password '<strong>'`
- SSL: required
- If pooler auth is problematic, use direct host: `db.<projectref>.supabase.co`, port `5432`, user `metabase_readonly`.

## 4) Data flows
### Voiceflow metrics
- `/api/vf/usage`: loads tenant config, calls Voiceflow, upserts rows into `vf_usage`, logs run in `vf_pulls`.
- `/api/cron/vf-usage`: runs for all active tenant/projects/metrics (or filtered), upserts into `vf_usage`, logs each run in `vf_pulls`. Scheduled daily at 03:00 UTC by Vercel.

### Widget/custom events
- `/api/events`: validates bearer token against `event_write_tokens`, enforces origin against `tenant_domains`, upserts into `events_raw`. Views surface rows via `analytics.events` and `analytics.events_with_tenant`.
- PKS production token example: `pks_prod_write_token_6B76F0B9-0D06-4A20-A3C6-41C4B1BD83A2` (replace if rotated).

### Feedback (conversation-level)
- Frontend injects feedback UI into the Voiceflow widget shadow DOM; emits `feedback_submitted` with `{ rating: "up"|"down", comment?: string }` via `sendWidgetEvent`.
- Multiple submissions per session are allowed (form resets after thank-you overlay).

## 5) How to deploy
### Vercel (API + cron)
1. Ensure env vars are set (see §3).
2. From repo root: `vercel --prod` (select existing project). Cron schedule from `vercel.json` will be applied.

### Supabase (schema + views + read-only role)
1. Apply `supabase/schema.sql` (base tables/RLS) and `supabase/analytics_schema.sql` (analytics views + readonly grants).
2. Set/rotate `metabase_readonly` password:
   ```sql
   alter role metabase_readonly with password '<strong-random>';
   ```
3. Validate as readonly:
   ```sql
   show search_path; -- analytics, public
   select * from analytics.vf_usage_with_tenant limit 1; -- should work
   select * from public.vf_credentials limit 1; -- should fail
   ```

### Hetzner/Metabase
1. SSH: `ssh analytics@analytics.upseller.fi`, `cd /opt/metabase`.
2. Ensure Metabase DB connection uses the Supabase readonly creds (host/port/user/password above) and SSL.
3. Trigger “Sync database schema now” in Metabase; confirm `analytics.*` views appear.

## 6) Instrumentation: PKS widget (prod)
- Constants:
  - `UPS_ANALYTICS_URL = https://upseller-analytics.vercel.app/api/events`
  - `UPS_EVENT_TOKEN = pks_prod_write_token_6B76F0B9-0D06-4A20-A3C6-41C4B1BD83A2` (update on rotation)
  - `VF_PROJECT_ID = 68c10791f2d91b29c174a193`
- Allowed origins: `https://www.pks.fi`, `https://pks.fi` in `tenant_domains`.
- Embed the feedback + analytics script (from `index.html`):
  - `sendWidgetEvent(...)` helper with token/project/session/page.
  - `widget_seen` tracking (MutationObserver on `#voiceflow-chat` and shadow DOM).
  - Feedback panel injection; emits `feedback_submitted` with rating/comment.
- Verify:
  ```sql
  select * from analytics.events_with_tenant
  where tenant_slug='pks' and event_name in ('widget_seen','feedback_submitted')
  order by occurred_at desc
  limit 10;
  ```

## 7) Backfill and validation
- Manual backfill (per day window):
  ```bash
  curl "https://upseller-analytics.vercel.app/api/cron/vf-usage?tenant=pks&startTime=2025-11-01T00:00:00Z&endTime=2025-11-02T00:00:00Z"
  ```
  Loop dates as needed; upsert is safe to repeat.
- Check latest pulls:
  ```sql
  select tenant_id, vf_project_id, metric, status, window_start, window_end, ran_at
  from public.vf_pulls
  order by ran_at desc
  limit 10;
  ```
- Daily cron confirmation: expect a new `vf_pulls` row after 03:00 UTC.

## 8) Dashboards (Metabase ideas)
- Usage KPIs: interactions/unique_users per day (local time), top intents, kb_document hits, credit_usage by model.
- Widget KPIs: `widget_seen` by page/day, feedback rating counts, recent comments.
- Reliability: `vf_pulls` status per day, last successful pull.

## 9) Security and rotation
- Do not expose service-role keys or API keys; keep tokens per tenant in `event_write_tokens`.
- Rotate `metabase_readonly` password periodically and update Metabase connection.
- If rotating event tokens, update the widget config and Supabase row; keep origins in `tenant_domains` in sync with live domains.
