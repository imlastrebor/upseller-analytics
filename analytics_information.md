# Voiceflow & Custom Events Analytics – Integration Brief

> Give this file to any engineer working on the test site so they understand how to send data into the Upseller analytics pipeline end-to-end.

---

## 1. Overview
We operate two parallel data flows:

1. **Voiceflow usage collector** – Serverless endpoints deployed on Vercel (project: `upseller-analytics`) call the Voiceflow Analytics API for each tenant’s project IDs.
2. **Custom goals ingestion** – The same Vercel project exposes `/api/events`, which accepts goal events (e.g., `widget_seen`, `cta_clicked`) from client sites and stores them directly in Supabase.

For the test site, you only need to emit custom events. Voiceflow usage data is collected separately via cron jobs.

---

## 2. Components & URLs
- **Vercel API**: `https://upseller-analytics.vercel.app`
  - `POST /api/events` – custom goal ingestion
  - `GET /api/vf/usage` – manual Voiceflow pull (internal use)
  - `GET /api/cron/vf-usage` – scheduled Voiceflow collector (internal)
- **Supabase**: `https://lbkhsxdndeoozrvxyvhf.supabase.co`
  - Tables: `tenants`, `vf_credentials`, `vf_projects`, `vf_usage`, `vf_pulls`, `event_write_tokens`, `events_raw`
- **Tenant IDs**
  - PKS: `68c10791f2d91b29c174a193` (existing client)
  - Test Sandbox: `tenant_id = 4be50059-2b05-409f-b217-1c04fb970729`, Voiceflow project ID `68f9dca7b9abe8c36ec96e77`
- **Event write token (test tenant)**: `test_sandbox_write_token_123`

Keep the token secret; only client-side code on trusted domains should embed it.

---

## 3. Sending Custom Events From the Site

### 3.1 Payload Contract
Each request can contain one or more events:

```json
{
  "events": [
    {
      "event_id": "UUID",              // required, unique per event
      "event_name": "widget_seen",     // required
      "occurred_at": "ISO timestamp",  // optional (defaults to now)
      "project_id": "68f9dca7b9...",   // optional Voiceflow project reference
      "user_id": "anon-123",           // optional
      "session_id": "session-xyz",     // optional
      "properties": { "page": "/pricing" } // optional JSON metadata
    }
  ]
}
```

### 3.2 Authentication
- Send `Authorization: Bearer test_sandbox_write_token_123`
  - Alternative: `x-event-token: test_sandbox_write_token_123`
- Token resolves to the `test_sandbox` tenant in Supabase.

### 3.3 Example Script (browser)
```html
<script>
  async function sendEvent(eventName, props = {}) {
    try {
      await fetch('https://upseller-analytics.vercel.app/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_sandbox_write_token_123',
        },
        body: JSON.stringify({
          events: [
            {
              event_id: crypto.randomUUID(),
              event_name: eventName,
              occurred_at: new Date().toISOString(),
              project_id: '68f9dca7b9abe8c36ec96e77',
              properties: props,
            },
          ],
        }),
      });
    } catch (error) {
      console.error('Failed to send event', eventName, error);
    }
  }

  // Example triggers:
  window.addEventListener('load', () => sendEvent('widget_seen', { page: location.pathname }));
  document.getElementById('demo-cta')?.addEventListener('click', () =>
    sendEvent('cta_clicked', { cta: 'Book demo', page: location.pathname }),
  );
</script>
```

### 3.4 Idempotency
- The API upserts on `event_id`; resending the same UUID won’t create duplicates.
- Always use `crypto.randomUUID()` (or equivalent) per event.

---

## 4. Voiceflow Widget Integration (Test Site)
1. **Embed Voiceflow widget** (from Voiceflow project `68f9dca7b9abe8c36ec96e77`).
2. **Add event hooks** in the widget loader or site script to send custom events at the moments you care about (widget load, CTA click, etc.).
3. **Optional:** add correlation IDs (e.g., `session_id`) so you can align Voiceflow usage metrics with custom goals later.

---

## 5. Supabase Verification
- Run this query to validate ingestion:
  ```sql
  select event_name, count(*), min(occurred_at), max(occurred_at)
  from events_raw
  where tenant_id = '4be50059-2b05-409f-b217-1c04fb970729'
  group by event_name;
  ```
- Voiceflow usage data (from cron/usage endpoints) will be stored later in `vf_usage` and `vf_pulls` once Phase 2 persistence is implemented.

---

## 6. Operational Notes
- **Environment variables** (already configured in `upseller-analytics` Vercel project):
  - `DEFAULT_TENANT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VF_TIMEZONE`, optional `VF_METRICS`.
- **Logging:** `console.log` output from `/api/events` appears in Vercel function logs. Use `vercel logs upseller-analytics --since 1h`.
- **Security:** write tokens are stored in `event_write_tokens` with `active=true`. Rotate by inserting a new token and disabling the old one.
- **RLS:** currently only service-role writes are allowed. Tenant-facing reads for dashboards (Metabase) will be configured later; until then, only server-side access should read `events_raw`.

---

## 7. Test Checklist
1. Verify widget loads on the test site (Vercel).
2. Trigger `widget_seen` and `cta_clicked` by loading the page and clicking CTA.
3. Confirm `/api/events` returns `{ accepted: 1, rejected: 0 }`.
4. Check Supabase `events_raw` for new rows.
5. (Optional) Check Voiceflow dashboard for usage metrics tied to project `68f9dca7b9abe8c36ec96e77`.

Once all pass, the custom-goal pipeline from site → Vercel API → Supabase is validated.
