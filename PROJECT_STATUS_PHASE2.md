# Upseller Analytics – Project Status (Phase 2 Prep)

> Quick brief for collaborating agents on the state of the Voiceflow analytics collector and the upcoming tasks.

---

## 1. Current State
- ✅ Vercel serverless project (TypeScript / NodeNext ESM) fully scaffolded.
- ✅ Manual Voiceflow proxy (`/api/vf/usage`) now loads tenant configs from Supabase and supports all Voiceflow metrics (`interactions`, `top_intents`, `unique_users`, `credit_usage`, `function_usage`, `api_calls`, `kb_documents`, `integrations`).
- ✅ Daily cron collector (`/api/cron/vf-usage`) iterates over active tenants/projects stored in Supabase, supports filtering, and returns tenant/environment metadata.
- ✅ Supabase project (EU) provisioned with schema + RPC:
  - `supabase/schema.sql` – tables `tenants`, `vf_credentials`, `vf_projects`, `vf_usage`, `vf_pulls` with placeholder service-role RLS policies.
  - `supabase/functions/load_tenant_config.sql` – RPC returning active credential + project bundle per tenant.
- ✅ First tenant (`pks`) seeded with an encrypted Voiceflow API key (currently using `encrypted:` prefix) and project ID `68c10791f2d91b29c174a193`.
- ✅ Environment variables consolidated: `DEFAULT_TENANT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `VF_METRICS` and `VF_TIMEZONE`. Legacy `VF_API_KEY`/`VF_PROJECT_IDS` removed.
- ✅ Documentation updated (`README.md`, `PROJECT_STATUS.md`) with bootstrap steps, env expectations, and testing URLs.
- 🚫 Usage data is not yet persisted in Supabase (`vf_usage`, `vf_pulls`); cron currently responds with Voiceflow payload only.
- 🚫 Encryption helper is a temporary placeholder (`lib/crypto.ts` strips `encrypted:` prefix); needs real KMS/Vault integration.
- 🚫 RLS policies currently allow service role access only; tenant-facing access still TODO.
- 🚫 No automated tests beyond `npm run typecheck`.

---

## 2. Codebase Tour (Nov 2025)
```
api/
  vf/usage.ts         # Manual Voiceflow endpoint, Supabase-backed tenant lookup
  cron/vf-usage.ts    # Cron collector across all tenants/projects
lib/
  env.ts              # Env accessor with optional required flag
  voiceflow.ts        # Shared Voiceflow client + typed error + metrics list
  supabase.ts         # Service-role Supabase client factory
  tenants.ts          # Tenant/credential/project loaders (RPC + aggregation helper)
  crypto.ts           # Temporary decrypt helper (strip 'encrypted:' prefix)
supabase/
  schema.sql          # Tables + indexes + placeholder policies
  functions/
    load_tenant_config.sql  # RPC returning tenant+credential+project bundle
.env.local            # Sample env with Supabase secrets & DEFAULT_TENANT
README.md             # Setup + testing instructions
PROJECT_STATUS.md     # Primary status brief (Phase 1 wrap-up)
PROJECT_STATUS_PHASE2.md # This phase-specific overview
vercel.json           # Cron config (03:00 UTC daily)
```

Key flows:
- **Manual endpoint** (`api/vf/usage.ts`):
  1. Require `tenant` query (fallback `DEFAULT_TENANT`).
  2. Fetch tenant config via `load_tenant_config`.
  3. Pick project ID from query or tenant default.
  4. Call Voiceflow with selected metric (defaults `interactions`).
  5. Return raw Voiceflow response + metadata.
- **Cron endpoint** (`api/cron/vf-usage.ts`):
  1. Gather all active tenant/project combos via `listActiveTenantProjects` (Supabase RPC per tenant).
  2. Filter by `tenant`, `tenants`, `projectID`, `projectIDs` if supplied.
  3. Calculate previous-day window (override via query).
  4. Iterate metrics (override via `VF_METRICS` or query) and call Voiceflow per tenant/project/metric.
  5. Return array of results with tenant + environment info; no persistence yet.
- **Voiceflow client** (`lib/voiceflow.ts`):
  - Defines metric enum.
  - Handles Voiceflow POST request, throws `VoiceflowApiError` on non-2xx.
- **Supabase utilities**:
  - `lib/supabase.ts` caches a service-role client.
  - `lib/tenants.ts` exposes `fetchTenantConfig` (RPC) and `listActiveTenantProjects`.
  - `lib/crypto.ts` currently strips `encrypted:` prefix (placeholder).

---

## 3. Environment Variables (Vercel + `.env.local`)
| Name | Required | Description |
| ---- | -------- | ----------- |
| `DEFAULT_TENANT` | ✅ | Fallback tenant slug when `tenant` query param absent. |
| `SUPABASE_URL` | ✅ | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key (server side only). |
| `VF_METRICS` | ➖ | Optional list to restrict cron metrics; defaults to all. |
| `VF_TIMEZONE` | ➖ | Optional timezone string echoed in cron response. |
| `VERCEL_OIDC_TOKEN` | auto | Present after `vercel env pull`; not used explicitly. |

Local `.env.local` example:
```
DEFAULT_TENANT="pks"
SUPABASE_URL="https://lbkhsxdndeoozrvxyvhf.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
VF_TIMEZONE="Europe/Helsinki"
# VF_METRICS="interactions,unique_users"  # optional
```

---

## 4. Testing & Deployment
- Typecheck: `npm run typecheck`
- Local dev: `vercel dev`
  - Manual sample: `http://localhost:3000/api/vf/usage?tenant=pks&projectID=68c10791f2d91b29c174a193&metric=interactions`
  - Cron sample: `http://localhost:3000/api/cron/vf-usage?tenant=pks`
- Deployment: Push to GitHub (auto) or `vercel --prod`
- After deploying, confirm production endpoints:
  - `https://<vercel-domain>/api/vf/usage?tenant=pks&projectID=...`
  - `https://<vercel-domain>/api/cron/vf-usage`

---

## 5. Next Steps (Phase 2 Objectives)
1. **Secure secret handling**
   - Replace `decryptSecret` with real encryption (KMS, Supabase Vault) and add rotation tooling.
   - Update credential storage to ensure only encrypted values ever persist.
2. **Persist results to Supabase**
   - Upsert Voiceflow `items` into `vf_usage` with tenant/project/metric metadata.
   - Log each cron execution in `vf_pulls` (status, cursor, window, errors) for observability/retries.
   - Consider deduplication strategy (unique constraints already defined).
3. **Backfill & retry tooling**
   - Build scripts/functions to re-run missed windows or resume from stored cursors.
4. **RLS policies**
   - Draft tenant-facing policies so product dashboards (Metabase) can read scoped data via anon key.
   - Keep service-role policy for ingestion functions.
5. **Monitoring & DX**
   - Add structured logging for cron runs (Vercel log drains / external monitoring).
   - Create CLI or admin UI to manage tenants/credentials (add/update/rotate).
   - Begin adding integration tests (fetch Voiceflow data, persist, assert Supabase rows).
6. **Future roadmap alignment**
   - Plan Supabase views/aggregations for dashboarding.
   - Sketch custom-event ingestion endpoint (Phase 4) to capture marketing events.

---

## 6. Useful Commands
```bash
npm install                      # install dependencies
npm run typecheck                # TypeScript diagnostics
vercel env pull .env.local       # sync secrets locally
vercel dev                       # local serverless environment
vercel --prod                    # manual deployment (optional)
```

**Last updated:** 2025-11-06  
Maintainer reminder: Update both status files whenever major functionality, env vars, or Supabase schema change.***
