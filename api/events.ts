import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getTenantForWriteToken,
  insertEvents,
  type IncomingEventPayload,
  type EventInsertRow,
} from '../lib/events.js';

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

type ValidationError = {
  index: number;
  reason: string;
};

function extractToken(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const headerToken = req.headers['x-event-token'];
  if (typeof headerToken === 'string' && headerToken.trim().length > 0) {
    return headerToken.trim();
  }

  const queryToken =
    (typeof req.query.token === 'string' && req.query.token.trim()) ||
    (Array.isArray(req.query.token) ? req.query.token[0] : null);
  return queryToken && queryToken.length > 0 ? queryToken : null;
}

function parseBody(req: VercelRequest): unknown {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return req.body;
}

function normalizeEvents(payload: unknown): IncomingEventPayload[] | null {
  if (Array.isArray(payload)) {
    return payload as IncomingEventPayload[];
  }

  if (payload && typeof payload === 'object' && Array.isArray((payload as any).events)) {
    return (payload as { events: IncomingEventPayload[] }).events;
  }

  return null;
}

function coerceISODate(value?: string): string | null {
  if (!value) {
    return new Date().toISOString();
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function sanitizeProperties(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing event write token (Authorization or x-event-token).' });
  }

  let tenantWithToken;
  try {
    tenantWithToken = await getTenantForWriteToken(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to validate token';
    return res.status(500).json({ error: message });
  }

  if (!tenantWithToken) {
    return res.status(403).json({ error: 'Invalid or inactive event write token.' });
  }

  const body = parseBody(req);
  const events = normalizeEvents(body);

  if (!events || events.length === 0) {
    return res.status(400).json({ error: 'Body must include an "events" array with at least one event.' });
  }

  const acceptedRows: EventInsertRow[] = [];
  const errors: ValidationError[] = [];

  events.forEach((event, index) => {
    if (!event || typeof event !== 'object') {
      errors.push({ index, reason: 'Event must be an object.' });
      return;
    }

    if (typeof event.event_id !== 'string' || !UUID_REGEX.test(event.event_id)) {
      errors.push({ index, reason: 'event_id must be a valid UUID.' });
      return;
    }

    if (typeof event.event_name !== 'string' || event.event_name.trim().length === 0) {
      errors.push({ index, reason: 'event_name is required.' });
      return;
    }

    const occurredAt = coerceISODate(event.occurred_at);
    if (!occurredAt) {
      errors.push({ index, reason: 'occurred_at must be a valid ISO date string.' });
      return;
    }

    const row = {
      event_id: event.event_id,
      tenant_id: tenantWithToken.tenant.id,
      project_id:
        typeof event.project_id === 'string' && event.project_id.trim().length > 0
          ? event.project_id.trim()
          : null,
      event_name: event.event_name.trim(),
      occurred_at: occurredAt,
      user_id:
        typeof event.user_id === 'string' && event.user_id.trim().length > 0
          ? event.user_id.trim()
          : null,
      session_id:
        typeof event.session_id === 'string' && event.session_id.trim().length > 0
          ? event.session_id.trim()
          : null,
      properties: sanitizeProperties(event.properties),
    };

    acceptedRows.push(row);
  });

  try {
    await insertEvents(acceptedRows);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to store events';
    return res.status(500).json({ error: message });
  }

  return res.status(errors.length > 0 ? 207 : 200).json({
    tenant: {
      id: tenantWithToken.tenant.id,
      slug: tenantWithToken.tenant.slug,
    },
    accepted: acceptedRows.length,
    rejected: errors.length,
    errors,
  });
}
