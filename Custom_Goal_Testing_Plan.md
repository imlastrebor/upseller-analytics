# Custom Goal Testing Plan

## Objective
Before committing fully to the Voiceflow analytics stack, we need to confirm that custom data points ("custom goals") can be collected successfully. This test ensures that we can track site interactions like `widget_seen` and `cta_clicked` outside the Voiceflow API, using our own event ingestion pipeline.

---

## Scope
- **Independent test:** The custom goal system is separate from the Voiceflow usage collector.
- **Limited tenants:** Only test tenants will emit custom goals.
- **Data ingestion pipeline:** Collects and stores the custom events for later visualization in Metabase.

---

## Preparation Steps

### 1. Define Event Contract
Create a simple and consistent event schema:

| Field | Type | Description |
|--------|------|-------------|
| `event_id` | string (UUID) | Unique identifier per event |
| `tenant_id` | string | Tenant or client ID |
| `project_id` | string | Optional Voiceflow project reference |
| `event_name` | string | Goal name, e.g. `widget_seen`, `cta_clicked` |
| `occurred_at` | timestamp | UTC timestamp |
| `user_id` | string | Anonymous or hashed ID |
| `session_id` | string | Optional session reference |
| `properties` | JSON | Optional metadata (page, referrer, etc.) |

---

### 2. Create Event Storage
- Create a table `events_raw` with the fields above.
- Enforce uniqueness with `UNIQUE(event_id)`.
- Optionally create an aggregated view `events_agg_daily` for dashboard use.

---

### 3. Ingestion Endpoint
- Create a `/events` endpoint that accepts batched JSON events.
- Validate structure (field types and required fields).
- Authenticate using a per-tenant write token.
- Store valid events; reject malformed or unauthorized submissions.
- Log accepted/rejected counts for monitoring.

---

### 4. Security and Privacy
- Add `tenant_id` to all records.
- Enable **RLS (Row Level Security)** to prevent cross-tenant data visibility.
- Use a read-only role for Metabase dashboards.
- Do not log PII; strip query strings and user data where possible.

---

### 5. Secrets Handling
- For testing, use secure environment variables for write tokens.
- Long term, plan to move secrets to a managed KMS or Vault service.

---

## Test Execution

### Step 1 — Setup
- Add a **test tenant** (e.g., `test_client_x`).
- Generate a write token and limit it to this tenant.
- Add two custom goals to the widget installation script (outside this project):
  - `widget_seen`
  - `cta_clicked`

### Step 2 — Emit Events
- Trigger events from the widget:
  - When the widget loads → `widget_seen`
  - When a CTA button is clicked → `cta_clicked`
- Batch and send events every few seconds or before page unload.

### Step 3 — Validate Results
Query the database to verify correct counts:

```sql
SELECT event_name, COUNT(*)
FROM events_raw
WHERE tenant_id = 'test_client_x'
GROUP BY event_name;
```

Confirm that:
- Counts match expected interactions.
- No duplicate events appear (idempotency works).
- No personal data is included in `properties`.

---

## Observability
- Log `tenant_id`, `accepted`, `rejected`, and errors in each ingestion run.
- Create Metabase tiles:
  - **Events/min (last hour)**
  - **Events by name (today)**

---

## Go/No-Go Criteria
| Condition | Expectation |
|------------|--------------|
| Events received correctly | ✅ |
| No duplicates on retry | ✅ |
| No PII leakage | ✅ |
| Dashboard visualizes counts | ✅ |

If all pass → proceed with full project.  
If not → stop and adjust collection method before scaling.

---

## After a Successful Test
1. Integrate managed secrets (KMS/Vault).
2. Add more goals using the same schema.
3. Extend retention to 13 months.
4. Automate daily aggregation views.
5. Consider light sampling or client throttling for high-volume sites.

---

## Notes for Codex
- Treat the custom goals ingestion as **a separate service** from the Voiceflow analytics collector.
- No direct integration with Voiceflow API is required at this stage.
- Focus on schema, ingestion validation, idempotency, and privacy.
- The widget-side event emitters are part of the **installation script**, not this backend project.
