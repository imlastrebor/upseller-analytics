
# Voiceflow Widget Tracking Overview for Codex

## Context

We are building a system that collects custom interaction data from Voiceflow’s Web Chat widget. The goal is to track meaningful user actions such as feedback button clicks and forward them to our own analytics API. While Voiceflow provides conversational logic and system-level events, it does not automatically expose structured analytics for granular UI interactions such as specific button clicks inside the widget.

The Voiceflow widget communicates with the parent browser window by sending `postMessage` events. These events contain the full session state, including recent system messages, user messages, and button actions. This enables the browser to observe user interactions in real time.

## Goal

Codex should create a solution that:

1. Detects when a user clicks specific buttons inside the Voiceflow Web Chat widget.
2. Filters these events so that only relevant interactions (e.g., feedback buttons) are captured.
3. Forwards the resulting structured event data to our analytics API.
4. Operates entirely in the browser so tracking does not impact Voiceflow runtime performance.
5. Maintains a clean separation between UI tracking (browser) and conversation logic (Voiceflow).

## Approach

### 1. Listen for Voiceflow Widget Events  
The browser receives messages emitted by the Voiceflow widget via the `postMessage` API. Codex should attach a listener to these events. The widget emits various event types, including ones containing full session state updates. Codex should parse these messages to extract only the information relevant for analytics.

### 2. Identify User Clicks Based on Session Turns  
Each Voiceflow event contains a sequence of "turns" representing the conversation. Codex should:

- Identify the last *user* turn.
- Identify the previous *system* turn that contained buttons (actions).
- Compare the user message to the button labels to determine which button was clicked.

This detection happens purely in the browser.

### 3. Filter Only the Feedback Buttons  
Codex should implement logic to detect only specific button events, such as the feedback question:

- “Palvelu toimi hyvin”
- “Palvelu ei toiminut”

Codex should not track other button clicks. The filtering happens by inspecting the system message text and button labels.

### 4. Construct a Clean Analytics Event  
Codex should transform the extracted data into a compact and structured analytics event containing fields such as:

- Event type (e.g., `chat_feedback`)
- Sentiment (`positive` / `negative`)
- Button label
- Voiceflow session/user identifiers
- Timestamp
- Any other relevant metadata

Codex should not forward the entire Voiceflow session payload.

### 5. Send the Event to the Analytics API  
Codex should send an HTTP request from the browser to the backend analytics endpoint, forwarding only the cleaned data. This API is separate from Voiceflow and belongs to our system.

### 6. Do Not Modify Voiceflow Flows for Basic Tracking  
Codex should keep the tracking logic outside Voiceflow. Voiceflow Functions may be used later for high‑level events (e.g., conversation outcomes), but not for low‑level button tracking. Browser handling is more robust, faster, and avoids adding latency inside the conversational flow.

## Summary

Codex must implement a browser‑based tracking system that:

- Observes Voiceflow widget `postMessage` events
- Detects specific button clicks
- Filters for only the events we care about
- Generates structured analytics events
- Sends them to our analytics backend

This approach ensures the tracking is reliable, scalable, GDPR‑safe, and does not interfere with the Voiceflow conversation logic.
