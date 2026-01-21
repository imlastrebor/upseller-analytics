# Voiceflow Widget Conversation Feedback Integration

This document explains how to add the conversation-level feedback UI (thumbs + comment) to another Voiceflow Web Chat widget, and how the analytics payloads flow so downstream tooling (Vercel/Supabase/Metabase) can process them.

## Overview
- A small CTA link in the footer (`.vfrc-footer__links`) opens a floating panel anchored to the footer (`.vfrc-footer__content`).
- Panel collects a binary rating (👍/👎) and an optional free-text comment.
- On submit, we emit a single `feedback_submitted` event via `sendWidgetEvent` and show a thank-you overlay for ~3s; the form then resets so multiple submissions are possible.
- All DOM is injected into the widget’s shadow root, so no edits to the core widget bundle are required.

## Files / Snippets to Copy
- `index.html`: the `<script type="module">` block at the bottom contains the feedback logic and styles. Port that block to the target page that loads the Voiceflow widget.
- No external dependencies are required beyond `sendWidgetEvent` (already present in this repo); if missing, copy the helper and constants (`UPS_ANALYTICS_URL`, `UPS_EVENT_TOKEN`, etc.) as well.

## How It Attaches to the Widget
1) Wait for `#voiceflow-chat` and its `shadowRoot`.
2) Inject feedback styles into the shadow root (guarded by `STYLES_ID`).
3) Locate:
   - CTA target: `.vfrc-footer__links` (fallback: after `.vfrc-input-container`).
   - Panel anchor: `.vfrc-footer__content` (fallback: after `.vfrc-input-container`).
4) Append:
   - CTA button (`vf-convo-cta`) into the footer links.
   - Feedback wrapper (`#vf-convo-feedback`) into footer content, containing:
     - `.vf-convo-panel` (form)
     - `.vf-convo-body` with two rating buttons and a textarea
     - `.vf-convo-thanks-layer` overlay with close “✕”.
5) Opening the CTA adds `open` on the wrapper, animating the panel in; submit animates the panel out and the thanks overlay in; after 3s (or manual close), the form resets for another submission.

## Event Payload (Analytics)
- Event name: `feedback_submitted`
- Payload shape:
  ```json
  {
    "rating": "up" | "down",
    "comment": "string | undefined"
  }
  ```
- Emitted via `sendWidgetEvent` (POST to `UPS_ANALYTICS_URL` with `UPS_EVENT_TOKEN`, `session_id`, `project_id`, etc., already wired in `index.html`).
- There is no per-message context; this is conversation-level feedback. If you need session/transcript context, enrich `payload` in `submitBtn` handler before calling `sendWidgetEvent`.

## Styling / UX Notes
- CTA: text link, small, underlined; sits in footer links.
- Panel: full footer width, absolute-positioned overlay, light theme; subtle slide/fade in/out.
- Thanks: separate overlay layer; stays for ~3s and can be dismissed with “✕”; form resets afterward to allow multiple submissions.
- Responsive: panel width is 100% of footer content; no manual width calculations required.

## Porting Steps to Another Project
1) Ensure the page loads the Voiceflow widget (`#voiceflow-chat`) and you can access its shadow root.
2) Copy the feedback `<script type="module">` block and the `sendWidgetEvent` helper/constants if absent.
3) Verify the widget uses `.vfrc-footer__links`, `.vfrc-footer__content`, and `.vfrc-input-container`; adjust selectors in `mountFeedback()` if your widget variant differs.
4) Deploy locally, open the widget, click “Miten onnistuimme?”, submit thumbs + comment, and confirm:
   - `feedback_submitted` logs in the console network tab and reaches your analytics endpoint.
   - Panel/thanks animations behave (open, submit, thank-you, reset).
5) Wire your analytics pipeline: ingest `feedback_submitted` events, parse `rating` and `comment`, and join on `session_id`/`project_id` for reporting in Supabase/Metabase.

## Notes for Analytics Teams
- Single event per submission; multiple submissions per session are allowed (form resets).
- Ratings are categorical, not numeric (`"up"`/`"down"`). Map to binary or sentiment as needed.
- Comments are optional free text; handle empty/undefined.
- Session correlation: use `session_id` and `project_id` from the existing payload. Page path is included via `sendWidgetEvent` helper (`properties: { page }`).

## PKS-Specific Instructions (Production)
Use these values when wiring the feedback widget on `https://www.pks.fi` / `https://pks.fi`:

- `UPS_ANALYTICS_URL`: `https://upseller-analytics.vercel.app/api/events`
- `UPS_EVENT_TOKEN`: `pks_prod_write_token_6B76F0B9-0D06-4A20-A3C6-41C4B1BD83A2`
- `VF_PROJECT_ID`: `68c10791f2d91b29c174a193`
- Allowed origins in Supabase `tenant_domains`: `https://www.pks.fi` and `https://pks.fi` (already added).

### What to copy into the PKS site
- The feedback `<script type="module">` block from this repo’s `index.html` (bottom). Ensure the constants above are set.
- If `sendWidgetEvent` is not present in the target page, copy it and the constants, then call `sendWidgetEvent('feedback_submitted', { rating, comment })` on submit (the snippet already does this).

### Quick embed-ready snippet (PKS values prefilled)
```js
const UPS_ANALYTICS_URL = 'https://upseller-analytics.vercel.app/api/events';
const UPS_EVENT_TOKEN = 'pks_prod_write_token_6B76F0B9-0D06-4A20-A3C6-41C4B1BD83A2';
const VF_PROJECT_ID = '68c10791f2d91b29c174a193';
const VF_WIDGET_HOST_SELECTOR = '#voiceflow-chat';

const UPS_SESSION_ID =
  localStorage.getItem('ups_session_id') ||
  (() => {
    const id = crypto.randomUUID();
    localStorage.setItem('ups_session_id', id);
    return id;
  })();

async function sendWidgetEvent(eventName, props = {}) {
  await fetch(UPS_ANALYTICS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${UPS_EVENT_TOKEN}`,
    },
    body: JSON.stringify({
      events: [
        {
          event_id: crypto.randomUUID(),
          event_name: eventName,
          session_id: UPS_SESSION_ID,
          occurred_at: new Date().toISOString(),
          project_id: VF_PROJECT_ID,
          properties: { page: window.location.pathname, ...props },
        },
      ],
    }),
  });
}
// Mount feedback UI using the selectors described above (copy from index.html).
```

### How to verify end-to-end
- Browser DevTools → Network: submit feedback and confirm a `feedback_submitted` POST to `/api/events` returns 200/207.
- Supabase query (SQL editor):
  ```sql
  select *
  from analytics.events_with_tenant
  where tenant_slug = 'pks' and event_name = 'feedback_submitted'
  order by occurred_at desc
  limit 5;
  ```
- Metabase: create a question on `analytics.events_with_tenant` filtered to `tenant_slug='pks'` and `event_name='feedback_submitted'`; show rating counts and recent comments.

### Testing tips
- Each submit emits one `feedback_submitted`. The form resets after the thank-you overlay so you can submit multiple times.
- If CORS blocks requests, ensure the page origin is exactly `https://www.pks.fi` or `https://pks.fi` (must match `tenant_domains`).
- For one-off tests without opening the widget, run in the browser console:
  ```js
  sendWidgetEvent('feedback_submitted', { rating: 'up', comment: 'Test' });
  ```
