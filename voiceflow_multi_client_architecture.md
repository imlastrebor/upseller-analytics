# Voiceflow Multi-Client Architecture Decision

## Context
The current implementation assumes a single Voiceflow API key shared across all clients. Both API endpoints:
- `/api/vf/usage.ts`
- `/api/cron/vf-usage.ts`

read `VF_API_KEY` and `VF_PROJECT_IDS` from the environment variables and use them for every request.

As the number of clients grows (10+ expected), each with its own Voiceflow API credentials, we need a **multi-tenant** approach.

---

## Goal
Design a **future-proof and cost-efficient** architecture for collecting analytics data from multiple Voiceflow projects, each with unique credentials.

---

## Recommendation

### ✅ Architecture: Single Deployment (Multi-Tenant)
Keep one Vercel deployment and add multi-client support. This avoids multiple deployments per client and simplifies operations.

- One shared API endpoint and scheduled CRON job.
- Each tenant (client) has its own Voiceflow credentials.
- The scheduled job loops through tenants and their projects to fetch data.

This approach scales easily as new clients are added.

---

### ✅ Store Credentials in Supabase (Not Env Variables)
Instead of a JSON environment variable like `VF_CLIENTS`, store Voiceflow credentials in **Supabase**, encrypted and isolated per client.

**Tables:**
- `tenants (id, name, created_at)`  
- `vf_credentials (id, tenant_id, api_key_encrypted, environment_id, created_at, rotated_at)`  
- `vf_projects (id, tenant_id, vf_project_id, active)`  
- `vf_pulls (tenant_id, vf_project_id, window_start, window_end, status, cursor, ran_at, error_json)`  
- `vf_usage (tenant_id, vf_project_id, period, type, count, environment_id)`

Use **Row-Level Security (RLS)** so each tenant only accesses its own data.

---

### ✅ Serverless Logic Updates
- Remove global `VF_API_KEY` and `VF_PROJECT_IDS`.
- Add a loader function to fetch credentials from Supabase:
  ```ts
  const creds = await getVoiceflowCredentials(tenantId);
  ```
- Manual endpoint (`/api/vf/usage`): Accept `tenant` parameter and use tenant’s credentials.
- Cron endpoint (`/api/cron/vf-usage`): Loop over all tenants and their projects automatically.
- Centralize API logic in `lib/voiceflow.ts` (already exists).

---

### ✅ Scheduling and Pipeline
- Keep one Vercel CRON job (03:00 UTC).
- Loop tenants → projects → fetch Voiceflow usage → upsert into `vf_usage`.
- Track progress in `vf_pulls` for idempotency and backfills.

---

### ✅ Data Flow Summary
```
Voiceflow → Vercel Serverless → Supabase → Metabase Dashboard
```

- Vercel pulls analytics per tenant using stored credentials.
- Supabase stores raw + aggregated metrics.
- Metabase connects directly to Supabase with RLS filtering.

---

## Alternatives

### ❌ Option 1: Per-Client Deployments
Each client runs a separate Vercel project with its own `.env`:
- Pros: Simple early setup.
- Cons: Expensive and hard to manage (rotations, redeploys, scaling).

### ✅ Option 2: Single Deployment (Recommended)
- One codebase and CRON job.
- Store credentials securely in Supabase.
- Easier scaling and auditing.
- Fits Supabase + Metabase pipeline perfectly.

---

## Key Notes
- Never log or return API keys.
- Don’t use static JSON env vars for credentials.
- Add structured logs and error summaries per tenant.
- Integration tests for pagination, retries, and window management are recommended.

---

## Summary Decision
| Aspect | Multi-Deployment | Single Multi-Tenant (Recommended) |
|--------|------------------|----------------------------------|
| Setup | Easy | Medium |
| Scaling | Hard | Easy |
| Cost | High | Low |
| Rotation | Manual | Centralized |
| Observability | Split | Unified |
| Future Proof | ❌ | ✅ |

---

**Final Choice:**  
> Single deployment with multi-tenant support using Supabase-stored credentials and a single Vercel CRON job.
