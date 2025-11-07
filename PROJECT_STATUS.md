# Upseller Analytics – Project Snapshot

> Reference brief for language models (ChatGPT / Codex) to understand the current state of the Voiceflow analytics collector.

---

## 1. Current Status
- ✅ Project scaffolding complete (TypeScript, Vercel serverless).
- ✅ Manual Voiceflow analytics proxy (`/api/vf/usage`) working locally and on Vercel.
- ✅ Cron collector (`/api/cron/vf-usage`) tested locally with real Voiceflow credentials.
- ✅ Environment variables configured on Vercel for the first client (PKS).
- ✅ Supabase project created; schema SQL and client scaffolding committed (ingestion pending).
- ⚠️ Multi-client credential strategy still open (see §6).
- 🚫 No persistence layer yet (Supabase planned for Phase 2).
- 🚫 No automated tests beyond `tsc --noEmit`.

## 2. Repository Structure (Oct 2025)
```
api/
  cron/
    vf-usage.ts        # Aggregated scheduled collector
  vf/
    usage.ts           # Manual Voiceflow usage proxy endpoint
lib/
  env.ts               # Environment variable helper
  voiceflow.ts         # Voiceflow API client + typed error
  supabase.ts          # Supabase service client factory
  tenants.ts           # Tenant/project credential loaders (requires decryption logic)
  crypto.ts            # Temporary decrypt helper (strip 'encrypted:' prefix)
README.md              # Setup & usage instructions
PROJECT_STATUS.md      # This status brief
vercel.json            # Cron schedule config (03:00 UTC)
tsconfig.json          # NodeNext ESM configuration
.env.local             # Local secrets (ignored by git)
.gitignore
supabase/
  schema.sql           # Bootstrap SQL for tenants, credentials, usage, pulls
  functions/
    load_tenant_config.sql # RPC helper to fetch tenant + active credentials/projects
  tables automatically include event_write_tokens, tenant_domains, events_raw
```

## 3. Runtime Flow
1. **Manual endpoint (`/api/vf/usage`)**
   - Accepts GET/POST.
   - Requires a tenant slug (`tenant` query param or `DEFAULT_TENANT` env) to load config from Supabase via `load_tenant_config`.
   - Resolves `projectID` from query/body or first active project for the tenant.
   - Accepts `metric` parameter (defaults to `interactions`) covering `interactions`, `top_intents`, `unique_users`, `credit_usage`, `function_usage`, `api_calls`, `kb_documents`, `integrations`.
   - Builds Voiceflow request with optional `startTime`, `endTime`, `limit`, `cursor`, `environmentID`.
   - Uses `queryVoiceflowUsage` (lib/voiceflow.ts) to call `https://analytics-api.voiceflow.com/v2/query/usage`.
   - Returns Voiceflow response plus metadata (`queriedAt`, request parameters).
   - Error handling: 4xx on missing params, passes through API errors with status and detail, 502 on network failures.

2. **Cron endpoint (`/api/cron/vf-usage`)**
   - Accepts GET/POST.
   - Loads active tenant/project pairs from Supabase (optional filters: `tenant`, `tenants`, `projectID`, `projectIDs`).
   - Determines metrics from query (`metric`/`metrics`), `VF_METRICS`, or defaults to the full supported set.
   - Default window: previous full day (00:00–00:00 UTC). `VF_TIMEZONE` is returned for contextual logging only.
   - For each project/metric pair, calls Voiceflow via the shared helper.
   - Returns structured summary: `ranAt`, counts, window, timezone, limit, metrics list, and per-project/metric results (`fulfilled` with raw payload or `rejected` with error info).
   - `vercel.json` schedules the cron to hit this endpoint daily at 03:00 UTC.

3. **Shared utilities**
   - `lib/env.ts` provides `getEnv(name, { required })` returning `undefined` or throwing if required.
   - `lib/voiceflow.ts` constructs the POST payload, performs fetch with passed API key, and throws `VoiceflowApiError` on non-2xx responses.
   - `lib/tenants.ts` loads tenant configs (RPC) and enumerates active tenant/project pairs.
   - `lib/events.ts` validates write tokens and writes custom goal events (`events_raw`).
   - `lib/crypto.ts` (placeholder) strips the `encrypted:` prefix until real KMS/Vault integration ships.

## 4. Environment Variables
| Name | Required | Purpose |
| ---- | -------- | ------- |
| `VF_ENVIRONMENT_ID` | ➖ | Optional Voiceflow environment filter (per project). |
| `VF_TIMEZONE` | ➖ | Informational timezone string, echoed in cron responses. |
| `VF_METRICS` | ➖ | Optional comma-separated list of metrics the cron collector should request. Defaults to all supported metrics. |
| `DEFAULT_TENANT` | ✅ | Fallback tenant slug when manual endpoint `tenant` parameter is omitted. |
| `SUPABASE_URL` | ✅ | Supabase project base URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-side key for authenticated inserts/updates (never exposed to clients). |
| `tenant_domains` table | ✅ | Manage allowed origins per tenant to power `/api/events` CORS logic. |
| *(Vercel internal)* `VERCEL_OIDC_TOKEN` | auto | Populated during `vercel env pull`; not used explicitly. |

Local development uses `.env.local`. Vercel holds the same vars per environment; redeploy after changes.

## 5. Deployment & Testing
- **Local:** `vercel dev` (requires logged-in Vercel CLI). Endpoints accessible at `http://localhost:3000/api/...`.
- **Type checking:** `npm run typecheck`.
- **Deploy:** push to GitHub (auto redeploy) or `vercel --prod`.
- **Testing URLs (examples):**
  - Manual: `http://localhost:3000/api/vf/usage?tenant=pks&projectID=<id>`
  - Manual with window: `...?tenant=pks&startTime=2025-11-05T00:00:00.000Z&endTime=2025-11-06T00:00:00.000Z`
  - Cron: `http://localhost:3000/api/cron/vf-usage`
  - Cron with overrides: `...?tenant=pks&projectID=<id>&startTime=...&endTime=...`
  - Custom events: `POST /api/events` with `Authorization: Bearer <event_write_token>` and `{ "events": [ ... ] }` payload

## 6. Multi-Client Credential Strategy (In Progress)
- ✅ Tenants, credentials, and projects now live in Supabase with a placeholder decrypt helper (`lib/crypto.ts` strips `encrypted:`).
- ✅ Manual endpoint and cron job load active credentials/projects per tenant.
- 🔒 Action items:
  1. Replace placeholder decryptor with real encryption/KMS integration (e.g., Supabase Vault, AWS KMS).
  2. Support credential rotation history (already modeled via `rotated_at`; need tooling).
  3. Add per-tenant overrides for Voiceflow environment IDs if they differ by project.
  4. Expose tenant management tooling (CLI or admin UI) to add/update credentials safely.

## 7. Upcoming Work (Roadmap Alignment)
1. **Phase 1 wrap-up**
   - Persist Voiceflow usage responses into Supabase tables (`vf_usage`, `vf_pulls`).
   - Harden credential management (real decryption/KMS, rotation tooling, admin UI).
   - Add structured logging/monitoring for cron execution (e.g., Vercel log drains).
2. **Phase 2 – Data Storage**
   - Finalize and test Row Level Security policies for tenant-facing access.
   - Build backfill/retry tooling to re-run failed pulls and maintain historical completeness.
3. **Phase 3**
   - Connect Metabase to Supabase; define dashboards (usage, intents, KPIs).
4. **Phase 4**
   - Extend collector to receive custom events (webhook or client API).

## 8. Reference Responses (Sample Outputs)
### Manual Endpoint
```json
{
  "queriedAt": "2025-11-06T08:07:10.749Z",
  "parameters": {
    "tenant": "pks",
    "projectID": "68c10791f2d91b29c174a193",
    "startTime": "2025-11-05T08:07:10.448Z",
    "endTime": "2025-11-06T08:07:10.448Z",
    "limit": 100,
    "metric": "interactions"
  },
  "result": {
    "result": {
      "cursor": 151079880,
      "items": [
        {
          "period": "2025-11-05T09:00:00.000Z",
          "projectID": "68c10791f2d91b29c174a193",
          "environmentID": "68c10791f2d91b29c174a195",
          "count": 5,
          "type": "chat"
        }
      ]
    }
  }
}
```

### Cron Endpoint
```json
{
  "ranAt": "2025-11-06T08:08:40.006Z",
  "tenantCount": 1,
  "projectCount": 1,
  "succeededCount": 1,
  "window": {
    "startTime": "2025-11-04T22:00:00.000Z",
    "endTime": "2025-11-05T22:00:00.000Z"
  },
  "timezone": "Europe/Helsinki",
  "limit": 100,
  "environment": null,
  "metrics": [
    "interactions",
    "top_intents",
    "unique_users",
    "credit_usage",
    "function_usage",
    "api_calls",
    "kb_documents",
    "integrations"
  ],
  "results": [
    {
      "status": "fulfilled",
      "tenant": {
        "id": "93d8e4d7-6221-40e2-9eb1-b5403da84f38",
        "slug": "pks",
        "name": "PKS Client"
      },
      "projectID": "68c10791f2d91b29c174a193",
      "metric": "interactions",
      "environmentID": null,
      "result": {
        "result": {
          "cursor": 150946814,
          "items": [
            {
              "period": "2025-11-05T04:00:00.000Z",
              "projectID": "68c10791f2d91b29c174a193",
              "environmentID": "68c10791f2d91b29c174a195",
              "count": 2,
              "type": "chat"
            }
          ]
        }
      }
    }
  ]
}
```

## 9. Key Commands
```bash
npm install       # dependencies
npm run typecheck # TypeScript diagnostics
vercel whoami     # confirm CLI session
vercel dev        # local serverless runtime
vercel env pull .env.local  # sync secrets locally
vercel --prod     # manual production deploy
```

---

**Last updated:** 2025-11-06  
Maintainer note: Update this file whenever significant functionality, env config, or workflow changes.***
