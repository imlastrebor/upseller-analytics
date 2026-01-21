# Upseller Analytics – Quick Context for ChatGPT

Use this brief to understand what is built, how the repo is structured, and the current gaps.

## Current State
- Vercel serverless (TypeScript / NodeNext). `vercel dev` for local, cron scheduled 03:00 UTC.
- Voiceflow analytics proxy `/api/vf/usage` works and reads tenant/project config from Supabase.
- Cron collector `/api/cron/vf-usage` iterates active tenants/projects from Supabase; returns Voiceflow payloads only (no persistence yet).
- Custom events endpoint `/api/events` validates bearer tokens per tenant and stores events in `events_raw` (Supabase).
- Environment vars: `DEFAULT_TENANT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional `VF_METRICS`, `VF_TIMEZONE`.
- Gaps: no storage of Voiceflow metrics (`vf_usage`, `vf_pulls` unused); crypto helper is a placeholder (strips `encrypted:`); RLS is service-role only; no automated tests beyond `npm run typecheck`.

## Repository Map
```
api/
  vf/usage.ts         # Manual Voiceflow proxy
  cron/vf-usage.ts    # Daily collector across tenants/projects
  events.ts           # Custom event ingestion with token + CORS
lib/
  env.ts              # Env helper
  voiceflow.ts        # Voiceflow client + metrics list + errors
  supabase.ts         # Service-role Supabase client
  tenants.ts          # Tenant config + active tenant/project lookup
  events.ts           # Event token lookup + inserts to events_raw
  crypto.ts           # Temporary decrypt (strips 'encrypted:')
supabase/
  schema.sql          # Tables/indexes/policies
  functions/load_tenant_config.sql  # RPC: tenant + credentials + projects by slug
README.md             # Setup and testing instructions
PROJECT_STATUS.md     # Detailed status
PROJECT_STATUS_PHASE2.md # Phase 2 prep notes
analytics_status.md   # Widget-side analytics state
```

## Supabase Structure (schema.sql)
- `tenants` – client records.
- `vf_credentials` – encrypted Voiceflow API keys (one active per tenant).
- `vf_projects` – Voiceflow project IDs per tenant.
- `vf_usage` – intended store for Voiceflow metric items (not yet populated).
- `vf_pulls` – log of collection runs/cursors (not yet populated).
- `event_write_tokens` – bearer tokens per tenant for `/api/events`.
- `events_raw` – stored custom events.
- RLS enabled with placeholder service-role-only policies; tighten later.

## Data Flows
1) `/api/vf/usage`: require `tenant` (or `DEFAULT_TENANT`), fetch config via `load_tenant_config`, pick project, call Voiceflow metric, return raw response.
2) `/api/cron/vf-usage`: list active tenant/project pairs; for each metric/project, call Voiceflow for a window (default previous day); returns summary only.
3) `/api/events`: validate bearer token (from `event_write_tokens`), apply tenant CORS, insert events into `events_raw`.

## Next Steps (high level)
- Persist Voiceflow results into `vf_usage` and log pulls in `vf_pulls`.
- Replace placeholder decryptor with real KMS/Vault and add credential rotation tooling.
- Add RLS for tenant-facing reads and start integration tests.
