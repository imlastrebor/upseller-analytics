import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getEnv } from '../../lib/env.js';
import {
  queryVoiceflowUsage,
  VoiceflowApiError,
  type VoiceflowUsageQuery,
} from '../../lib/voiceflow.js';

type UsageRequestParams = VoiceflowUsageQuery;

function parseRequestParams(req: VercelRequest): UsageRequestParams {
  const method = req.method?.toUpperCase();

  const source: Record<string, unknown> =
    method === 'POST' && typeof req.body === 'object' && req.body !== null
      ? (req.body as Record<string, unknown>)
      : (req.query as Record<string, unknown>);

  const projectID =
    (typeof source.projectID === 'string' && source.projectID.trim()) ||
    getEnv('VF_PROJECT_IDS')?.split(',')[0]?.trim();

  if (!projectID) {
    throw new Error('Missing projectID parameter and VF_PROJECT_IDS fallback.');
  }

  const now = new Date();
  const defaultEnd = now.toISOString();
  const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const startTime =
    (typeof source.startTime === 'string' && source.startTime) || defaultStart;
  const endTime =
    (typeof source.endTime === 'string' && source.endTime) || defaultEnd;

  const parsedLimit =
    typeof source.limit === 'string'
      ? Number.parseInt(source.limit, 10)
      : typeof source.limit === 'number'
        ? source.limit
        : undefined;
  const limit = Number.isFinite(parsedLimit) && parsedLimit! > 0 ? parsedLimit! : 100;

  const cursor =
    typeof source.cursor === 'string'
      ? source.cursor
      : typeof source.cursor === 'number'
        ? source.cursor
        : undefined;

  const environmentID =
    (typeof source.environmentID === 'string' && source.environmentID) ||
    getEnv('VF_ENVIRONMENT_ID');

  return { projectID, startTime, endTime, limit, cursor, environmentID };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({
      error: 'Method Not Allowed',
      allowedMethods: ['GET', 'POST'],
    });
  }

  const apiKey = getEnv('VF_API_KEY');
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing VF_API_KEY environment variable.' });
  }

  let params: UsageRequestParams;
  try {
    params = parseRequestParams(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request parameters';
    return res.status(400).json({ error: message });
  }

  const environmentID = params.environmentID;

  try {
    const result = await queryVoiceflowUsage(params, apiKey);
    return res.status(200).json({
      queriedAt: new Date().toISOString(),
      parameters: {
        projectID: params.projectID,
        startTime: params.startTime,
        endTime: params.endTime,
        limit: params.limit,
        ...(environmentID ? { environmentID } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {}),
      },
      result,
    });
  } catch (error) {
    if (error instanceof VoiceflowApiError) {
      return res.status(error.status).json({
        error: error.message,
        detail: error.detail,
        status: error.status,
      });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(502).json({
      error: 'Failed to reach Voiceflow API',
      detail: message,
    });
  }
}
