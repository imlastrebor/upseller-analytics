# Analytics Handoff – Voiceflow Widget Feedback & Session Tracking

## What was implemented
- Client-side analytics wiring in `index.html`:
  - Persistent session ID (`UPS_SESSION_ID`) stored in `localStorage` and attached to every event at the top level.
  - `sendWidgetEvent(eventName, props)` posts to `https://upseller-analytics.vercel.app/api/events` with:
    - Headers: `Authorization: Bearer test_sandbox_write_token_123`, `Content-Type: application/json`.
    - Body: `events` array containing `event_id` (UUID), `event_name`, `session_id`, `occurred_at` (client timestamp), `project_id` (`68f9dca7b9abe8c36ec96e77`), and `properties` (includes `page` plus event-specific fields).
  - `widget_seen` event: fired once when the Voiceflow widget is detected via MutationObserver/shadow DOM check; includes `page` and `session_id`.
  - Feedback UI on each bot response with thumbs up/down buttons:
    - Clicking emits `feedback_submitted` via `sendWidgetEvent` with `properties`: `{ page, rating: "up"|"down", prompt: "<full bot message text>" }`.
    - Buttons disable after click; selected state shows color/scale; no snackbar; no backend storage beyond analytics endpoint.
- Legacy duplication fixed: `session_id` is no longer included inside `properties` for feedback; only at top level.

## Relevant files
- `index.html`: Inline analytics setup, widget loader, session ID generator, event sender, feedback UI and handler.
- `Example-project/mock-feedback.js`: Module version of the feedback UI (now superseded by inline code but same logic).
- `analytics_status.md`: Prior status summary.
- `widget_analytics_handoff.md`: Original requirements/guidance for analytics payloads.

## Current event shape (as sent)
```json
{
  "events": [
    {
      "event_id": "<uuid>",
      "event_name": "feedback_submitted",
      "session_id": "<ups_session_id>",
      "occurred_at": "<client ISO timestamp>",
      "project_id": "68f9dca7b9abe8c36ec96e77",
      "properties": {
        "page": "/",
        "rating": "up" | "down",
        "prompt": "<full bot message text>"
      }
    }
  ]
}
```
`widget_seen` uses the same shape but properties only contain `page`.

## How to verify
- In browser DevTools → Network: check `/api/events` requests for `widget_seen` and `feedback_submitted`; ensure `session_id` is present (top-level), properties have `page` and `rating`/`prompt` for feedback.
- DB check (Supabase): query `events_raw` for `event_name in ('widget_seen','feedback_submitted')` and confirm `session_id` populated; for feedback, `properties->>rating` and `properties->>prompt` present; no `session_id` inside `properties` for new rows.

## Known legacy rows
- Older events (previous session IDs) may have `session_id` duplicated inside `properties` and some `widget_seen` with `session_id = null`. Current code no longer produces that duplication.

## Not implemented
- Custom goal tracking and any backend/database persistence beyond sending to `/api/events`.
- No server-side storage of feedback; only analytics events are sent.

## Next steps (if needed)
- Optionally remove `occurred_at` from client payloads to let the server timestamp events.
- Add custom goal tracking later if required (listening to VF traces/custom events and emitting `chat_goal`).
