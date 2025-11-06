# Voiceflow Analytics Data Collection – Vercel Serverless Setup

## 📘 Context

We operate multiple Voiceflow chat assistants for clients and want to collect and analyze their usage data.

Voiceflow provides an **Analytics API** that exposes standardized usage metrics such as:
- Total interactions
- Unique users
- Top intents
- Credit usage
- API calls
- Function usage
- Knowledge base documents
- Integrations

This project sets up a **GDPR-compliant, multi-tenant analytics pipeline** that collects Voiceflow usage data into our own API for analysis and dashboarding.

We use **Vercel** for serverless collection and will later add **Supabase (EU)** for storage and **Metabase** for dashboards.

---

## 🧩 Stack Overview

| Component | Role |
|------------|------|
| **Voiceflow Analytics API v2** | Source of usage data per project |
| **Vercel Serverless API** | Collects data from Voiceflow and exposes endpoints for manual and scheduled pulls |
| **Environment Variables** | Securely store Voiceflow credentials and project IDs |
| *(Later)* **Supabase (EU)** | Stores collected data |
| *(Later)* **Metabase** | Visualizes metrics and dashboards |

### Data Flow

```
[Voiceflow Analytics API]
       ↑ (HTTP POST, server-to-server)
[Vercel: /api/vf/usage] → returns JSON
       ↑
[Vercel: /api/cron/vf-usage] → scheduled collector
```

---

## 🗺️ High-Level Roadmap

1. **Phase 1 – Voiceflow Data Collection (current goal)**
   - Build a secure Vercel API that queries the Voiceflow Analytics API.
   - Support multiple project IDs via environment variables.
   - Implement cron job for automated collection.

2. **Phase 2 – Data Storage**
   - Store collected results in Supabase (EU region).
   - Apply Row Level Security for client isolation.

3. **Phase 3 – Dashboarding**
   - Connect Metabase to Supabase.
   - Build metrics and reports (sessions, intents, engagement).

4. **Phase 4 – Custom Events (later)**
   - Extend collector to receive custom goals like “user clicked link” or “chat bubble opened”.

---

## ⚙️ Step-by-Step – Collect Voiceflow API Data to Vercel Serverless API

### 1. Project Setup
- Create a new Vercel project (`npm init` or `pnpm init`).
- Enable TypeScript or keep it in ESM JavaScript mode (`"type": "module"`).
- Create an `/api` folder for serverless functions.

Folder structure:
```
/api
  /vf
    usage.ts          # manual endpoint that calls Voiceflow API
  /cron
    vf-usage.ts       # scheduled job that calls the above
vercel.json
README.md
```

---

### 2. Environment Variables

Set the following in your Vercel project settings:

| Variable | Example | Description |
|-----------|----------|-------------|
| `VF_API_KEY` | `VF.DM.xxxxxx.yyyyy` | Your Voiceflow API key |
| `VF_PROJECT_IDS` | `projectA,projectB` | Comma-separated list of Voiceflow project IDs |
| `VF_ENVIRONMENT_ID` | `68c10791f2d91b29c174a194` | The environment to query (Production/Development) |
| `TZ` | `Europe/Helsinki` | Timezone for scheduling |

Keep all sensitive values in environment variables — never in code.

---

### 3. Voiceflow Analytics API Overview (for Codex reference)

**Endpoint:**  
`POST https://analytics-api.voiceflow.com/v2/query/usage`

**Headers:**
```
accept: application/json
authorization: <VF_API_KEY>
content-type: application/json
```

**Body:**
```json
{
  "data": {
    "name": "interactions",
    "filter": {
      "projectID": "<project_id>",
      "startTime": "2025-11-01T00:00:00.000Z",
      "endTime": "2025-11-02T00:00:00.000Z",
      "limit": 100
    }
  }
}
```

**Pagination (optional):**
- Use `cursor` from the previous response to request the next page of data.

**Response (example):**
```json
{
  "result": {
    "cursor": 127369839,
    "items": [
      {
        "period": "2025-09-10T05:00:00.000Z",
        "projectID": "68c10791f2d91b29c174a193",
        "environmentID": "68c10791f2d91b29c174a194",
        "count": 85,
        "type": "dialog-management"
      }
    ]
  }
}
```

---

### 4. `/api/vf/usage` – Manual Endpoint

**Purpose:**  
Expose a GET or POST endpoint that queries the Voiceflow API and returns normalized JSON.

**Implementation outline (no full code):**
1. Read query parameters or defaults:
   - `projectID`, `startTime`, `endTime`, `limit`.
2. Construct the POST request to Voiceflow:
   - URL: `https://analytics-api.voiceflow.com/v2/query/usage`
   - Headers: `Authorization` with `VF_API_KEY`.
   - Body matches the official Voiceflow API format exactly.
3. Await the response and return it in JSON with metadata:
   - Include timestamp of query (`queriedAt`) and request parameters.
4. Handle and forward any Voiceflow API errors gracefully.

---

### 5. `/api/cron/vf-usage` – Scheduled Collector

**Purpose:**  
Automatically query the Voiceflow API for multiple projects on a schedule.

**Implementation outline:**
1. Parse `VF_PROJECT_IDS` from environment variables.
2. Define the time window to query:
   - For daily data: `startTime = yesterday 00:00`, `endTime = today 00:00`.
3. Loop through project IDs:
   - Call `/api/vf/usage` internally or directly call Voiceflow API.
   - Collect results into an array.
4. Return JSON with `ranAt`, `projectCount`, and the aggregated results.

**Example response shape:**
```json
{
  "ranAt": "2025-11-05T21:00:00Z",
  "projectCount": 2,
  "results": [
    {
      "projectID": "68c10791f2d91b29c174a193",
      "result": { "cursor": 127369839, "items": [...] }
    }
  ]
}
```

---

### 6. Schedule the Cron Job

In `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/vf-usage", "schedule": "0 3 * * *" }
  ]
}
```
This example runs the collector every day at 03:00 Helsinki time.

---

### 7. Testing

- **Manual test:**  
  Call `/api/vf/usage` with your projectID and date range.  
  Confirm it returns valid Voiceflow data (`result.items` array).
- **Cron test:**  
  Deploy and check logs after the first scheduled run.  
  The function should fetch and return aggregated usage data.

---

### 8. Next Steps (for later)

After confirming the data collection works:
- Store results in Supabase (EU).
- Connect Metabase for visualization.
- Add custom goal events (link clicks, widget opens) via your own collector.

---

## ✅ Summary

You now have a clear foundation for a scalable, multi-tenant Voiceflow analytics stack:

| Layer | Responsibility |
|--------|----------------|
| Vercel API | Collects Voiceflow usage data securely |
| Supabase (later) | Stores and aggregates results |
| Metabase (later) | Visualizes dashboards |
| Codex | Generates the implementation logic for serverless functions |

Follow Voiceflow’s exact API schema to ensure compatibility and data accuracy.
