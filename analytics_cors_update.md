# Custom Event CORS Update – Implementation Notes

## Summary
- The Landing site now sends `widget_seen` via `window.sendCustomEvent`, but browser requests fail because `https://upseller-analytics.vercel.app/api/events` doesn’t allow CORS.
- Preflight (`OPTIONS`) requests return `405 Method Not Allowed` without any `Access-Control-Allow-*` headers, so the browser never issues the actual `POST` even though the endpoint works when called via `curl`.
- Until the API adds CORS support or we proxy the request, custom goals cannot be emitted from any browser (test site or client site).

## Immediate Fix (recommended)
Add first-class CORS handling inside the `upseller-analytics` project’s `/api/events` handler.

### Requirements
1. **Allowed origins**  
   - `https://upseller-demo-7ocboibor-robert-upsellers-projects.vercel.app`
   - `https://upseller-demo.vercel.app` (production once aliased)  
   - `http://localhost:3000` (local static server)  
   - `http://localhost:8888` (optional fallback)  
   Update as new client domains go live.

2. **Allowed methods**: `OPTIONS, POST`

3. **Allowed headers**: `Authorization, Content-Type, X-Event-Token`

4. **Preflight handling**  
   - If `req.method === 'OPTIONS'`, respond with `status 200`, the CORS headers, and `return` before any other logic.

5. **Response headers**  
   - For every POST response (success or error), include the same `Access-Control-Allow-Origin` value used for the request origin so browsers accept it.

6. **Security**  
   - Still enforce the bearer token check; CORS only tells the browser it may send the request. Server-side auth remains mandatory.

### Suggested Snippet (Node/Edge example)
```js
const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:8888',
  'https://upseller-demo-7ocboibor-robert-upsellers-projects.vercel.app',
  'https://upseller-demo.vercel.app',
]);

function corsHeaders(origin) {
  return allowedOrigins.has(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'OPTIONS, POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Event-Token',
      }
    : {};
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return res.status(200).set(headers).end();
  }

  // ... existing token validation + event ingestion ...

  return res.status(200).set(headers).json({ accepted: 1, rejected: 0 });
}
```

### Testing Checklist
1. `curl -i -X OPTIONS` with `Origin: http://localhost:3000` → expect `200` + CORS headers.
2. `curl -i -X POST` with `Origin` header → expect `200` + `{"accepted":1}`.
3. Load the landing site (localhost + Vercel) → verify Network tab shows the POST and gets `accepted`.
4. Confirm Supabase `events_raw` table receives new rows.

## Alternative (if CORS update not feasible)
Create a small proxy API route within the landing site project (e.g., `api/send-event.js`) that forwards requests server-side to `upseller-analytics`. Since the browser calls the proxy on the same origin, no CORS issues arise. This adds maintenance overhead per site, so the direct CORS fix above is preferred.
