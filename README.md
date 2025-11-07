# Upseller Voiceflow Analytics Collector

Serverless TypeScript project that queries the Voiceflow Analytics API on-demand and via scheduled cron jobs. Deployable to Vercel.

## Project Structure
- `api/vf/usage.ts` — Manual endpoint that proxies analytics requests to Voiceflow.
- `api/cron/vf-usage.ts` — Scheduled collector that iterates over configured projects.
- `lib/` — Shared helpers for environment variables and Voiceflow API calls.
- `vercel.json` — Defines the daily cron schedule.

## Getting Started
1. Install dependencies:
   ```bash
   npm install
   ```
2. (Optional) Run a type check before deploying:
   ```bash
   npm run typecheck
   ```
3. Run the SQL bootstrap files inside Supabase:
   - `supabase/schema.sql`
   - `supabase/functions/load_tenant_config.sql`
   These create the tables, policies, and helper RPC for tenant lookups.
4. Seed your first tenant, credentials, and projects via the Supabase SQL editor.
5. Use `vercel dev` for local testing once your Vercel project is linked.

## Required Environment Variables
Set these in Vercel (Project Settings → Environment Variables) and in your local `.env` if you are using `vercel dev`:

| Variable | Description |
| -------- | ----------- |
| `VF_ENVIRONMENT_ID` | Environment ID to query (optional if you fetch across all environments). |
| `VF_TIMEZONE` | Timezone identifier such as `Europe/Helsinki` (optional, used for metadata/logging). |
| `VF_METRICS` | Optional comma-separated list of metrics to collect in cron runs. Defaults to all supported metrics. |
| `DEFAULT_TENANT` | Tenant slug used by manual endpoint when `tenant` query param is omitted. |
| `SUPABASE_URL` | Supabase project URL (e.g. `https://...supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key used server-side for database access. Keep this secret; never expose it client-side. |

## Endpoints
- `GET /api/vf/usage`  
  Query a single project for a tenant. Query params:  
  `tenant` (defaults to `DEFAULT_TENANT`), `projectID`, `startTime`, `endTime`, `limit`, `cursor`, `environmentID`, `metric` (defaults to `interactions`).
- `GET /api/cron/vf-usage`  
  Fetches usage for every active tenant/project stored in Supabase and metrics specified via `VF_METRICS` (or all supported metrics by default). Optional overrides: `tenant`, `tenants`, `projectID`, `projectIDs`, `startTime`, `endTime`, `limit`, `metric`/`metrics`.
- `POST /api/events`  
  Custom goal ingestion. Requires an event write token (`Authorization: Bearer <token>` or `x-event-token`). Body accepts either `{ "events": [...] }` or a raw array of events. Each event must include `event_id` (UUID) and `event_name`; optional fields: `occurred_at`, `project_id`, `user_id`, `session_id`, `properties`.

Both endpoints return the raw Voiceflow response alongside metadata about the run.

## Scheduling
`vercel.json` schedules `/api/cron/vf-usage` daily at 03:00 UTC. Each run iterates over every configured project and Voiceflow metric. Adjust the cron expression (and optionally `VF_METRICS`) if you need a different cadence or narrower scope, and use `VF_TIMEZONE` for clarity in responses/logging.

## Local Testing
- Start the dev server: `vercel dev`
- Manual usage pull:  
  `http://localhost:3000/api/vf/usage?tenant=pks&projectID=68c10791f2d91b29c174a193`
- Custom window:  
  `http://localhost:3000/api/vf/usage?tenant=pks&projectID=68c10791f2d91b29c174a193&metric=top_intents&startTime=2025-11-05T00:00:00.000Z&endTime=2025-11-06T00:00:00.000Z`
- Cron run (all tenants/projects):  
  `http://localhost:3000/api/cron/vf-usage`
- Cron filtered to a tenant/project:  
  `http://localhost:3000/api/cron/vf-usage?tenant=pks&projectID=68c10791f2d91b29c174a193`
- Custom events (replace token + payload):  
  ```bash
  curl -X POST http://localhost:3000/api/events \
    -H "Authorization: Bearer test_sandbox_write_token_123" \
    -H "Content-Type: application/json" \
    -d '{
      "events": [
        {
          "event_id": "1d4c0c6e-3b6c-4f3a-b90e-0b824c3b7d91",
          "event_name": "widget_seen",
          "occurred_at": "2025-11-06T12:00:00Z",
          "properties": { "page": "/pricing" }
        },
        {
          "event_id": "9fb9df46-5d89-4d2d-9b4b-4d8d901bca14",
          "event_name": "cta_clicked",
          "properties": { "cta": "Book demo" }
        }
      ]
    }'
  ```

## Next Steps
- Add persistence (e.g., Supabase) and call it from the cron handler.
- Run the SQL in `supabase/schema.sql` and `supabase/functions/load_tenant_config.sql`, then seed tenants/credentials/projects.
- Extend analytics payload normalization if you require additional metrics.
- Write automated integration tests once storage is in place.
