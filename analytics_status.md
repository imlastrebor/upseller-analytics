# Analytics Status and Implementation Notes

This document summarizes the current analytics-related behavior in the project, what’s wired, and what remains manual/mock.

## Scope and Current State
- The landing page (`index.html`) contains a lightweight analytics snippet (`sendWidgetEvent`) that posts events to `https://upseller-analytics.vercel.app/api/events` with token `test_sandbox_write_token_123` and `project_id` `68f9dca7b9abe8c36ec96e77`.
- Only one event is sent today: `widget_seen` (once per page load when the Voiceflow widget appears).
- Feedback thumbs are mocked: they are rendered client-side, disable after selection, and log to console. No feedback is persisted or sent to analytics yet.
- No database integration is present in this repo; feedback and analytics beyond `widget_seen` are not stored.

## Implemented Analytics Logic
### Widget visibility tracking
- File: `index.html`
- Functions:
  - `sendWidgetEvent(eventName, props)`: POSTs to `UPS_ANALYTICS_URL` with bearer token and event payload.
  - `trackWidgetSeenOnce()`: guards against duplicate `widget_seen` events.
  - `findVoiceflowWidget()`: locates the widget in `#voiceflow-chat` or its shadow DOM.
- Behavior:
  - On `window.load`, checks if the Voiceflow widget is present. If yes, emits `widget_seen`.
  - If not present yet, a `MutationObserver` watches `document.body` for additions; once the widget appears, emits `widget_seen` and disconnects.

### Mock feedback UI and logging
- Files: `index.html` (inline module) and `Example-project/mock-feedback.js` (module version).
- Behavior:
  - Listens for `voiceflow:interact` messages from the Voiceflow widget.
  - After each bot response, injects thumbs up/down buttons just after the latest `.vfrc-message`.
  - On click: disables both buttons, highlights selection (green tint for up, red tint for down).
  - Logs to console with prefix `[Upseller Analytics]: feedback submitted` and payload `{ feedback: "up"|"down", message: "<full bot message text>" }`.
  - No network/API calls for feedback; purely client-side logging.

## Not Implemented / Gaps
- No backend or DB schema for storing feedback (`BotTurn`, `Feedback`) or associating feedback with Voiceflow traces.
- No analytics events for feedback clicks, message interactions, or conversation metadata.
- No session/user identity mapping for analytics payloads.
- No error/health logging around Voiceflow interactions.

## Recommendations for the Analytics Agent
1) **Instrument feedback events**: Replace console log with a real `sendWidgetEvent("feedback_submitted", { feedback, message, turnId? })` or equivalent endpoint once schema is defined.
2) **Define schema**: Add tables for `bot_turns` (stores Voiceflow traces and rendered message) and `feedback` (turn_id FK, rating, comment, timestamps). Expose APIs to receive feedback from the widget.
3) **Session identity**: Establish a non-PII `vf_user_id` / session ID to include in analytics and feedback records.
4) **Event taxonomy**: Enumerate key events (widget_seen, conversation_started, user_message, bot_message, feedback_submitted) and standardize properties.
5) **Error handling**: Add logging/metrics for Voiceflow API failures (401/404/timeout) if/when backend integration is added.

## Quick References
- Analytics endpoint: `UPS_ANALYTICS_URL = https://upseller-analytics.vercel.app/api/events`
- Auth token: `UPS_EVENT_TOKEN = test_sandbox_write_token_123`
- Voiceflow project ID: `68f9dca7b9abe8c36ec96e77`
- Widget host element: `#voiceflow-chat`

## Files to Inspect
- `index.html`: contains widget loader, analytics emitter (`sendWidgetEvent`), and inline mock feedback UI.
- `Example-project/mock-feedback.js`: standalone module version of the mock feedback UI (same logic as inline).
