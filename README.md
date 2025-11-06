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
3. Use `vercel dev` for local testing once your Vercel project is linked.

## Required Environment Variables
Set these in Vercel (Project Settings → Environment Variables) and in your local `.env` if you are using `vercel dev`:

| Variable | Description |
| -------- | ----------- |
| `VF_API_KEY` | Voiceflow analytics API token. |
| `VF_PROJECT_IDS` | Comma-separated Voiceflow project IDs. |
| `VF_ENVIRONMENT_ID` | Environment ID to query (optional if you fetch across all environments). |
| `VF_TIMEZONE` | Timezone identifier such as `Europe/Helsinki` (optional, used for metadata/logging). |

## Endpoints
- `GET /api/vf/usage`  
  Query a single project. Optional query params: `projectID`, `startTime`, `endTime`, `limit`, `cursor`, `environmentID`.
- `GET /api/cron/vf-usage`  
  Fetches usage for all projects in `VF_PROJECT_IDS`. Optional overrides: `projectID`, `projectIDs`, `startTime`, `endTime`, `limit`.

Both endpoints return the raw Voiceflow response alongside metadata about the run.

## Scheduling
`vercel.json` schedules `/api/cron/vf-usage` daily at 03:00 UTC. If you need a different cadence for your local timezone, adjust the cron expression accordingly and optionally set `VF_TIMEZONE` for clarity in responses/logging.

## Next Steps
- Add persistence (e.g., Supabase) and call it from the cron handler.
- Extend analytics payload normalization if you require additional metrics.
- Write automated integration tests once storage is in place.
