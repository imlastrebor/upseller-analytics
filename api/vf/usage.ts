import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getEnv } from '../../lib/env.js';
import {
  queryVoiceflowUsage,
  VoiceflowApiError,
  VOICEFLOW_METRICS,
  type VoiceflowMetric,
  type VoiceflowUsageQuery,
} from '../../lib/voiceflow.js';
import { fetchTenantConfig } from '../../lib/tenants.js';
import { decryptSecret } from '../../lib/crypto.js';

type UsageRequestParams = VoiceflowUsageQuery;

const DEFAULT_METRIC: VoiceflowMetric = 'interactions';

function parseMetric(value: unknown): VoiceflowMetric {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_METRIC;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (VOICEFLOW_METRICS.includes(normalized as VoiceflowMetric)) {
      return normalized as VoiceflowMetric;
    }
  }

  throw new Error(
    `Invalid metric. Supported metrics: ${VOICEFLOW_METRICS.join(', ')}`,
  );
}

function parseRequestParams(req: VercelRequest, defaultProjectID?: string): UsageRequestParams {
  const method = req.method?.toUpperCase();

  const source: Record<string, unknown> =
    method === 'POST' && typeof req.body === 'object' && req.body !== null
      ? (req.body as Record<string, unknown>)
      : (req.query as Record<string, unknown>);

  const projectID =
    (typeof source.projectID === 'string' && source.projectID.trim()) ||
    defaultProjectID;

  if (!projectID) {
    throw new Error('Missing projectID parameter and tenant default project fallback.');
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

  const metric = parseMetric(source.metric);

  return { projectID, startTime, endTime, limit, cursor, environmentID, metric };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({
      error: 'Method Not Allowed',
      allowedMethods: ['GET', 'POST'],
    });
  }

  const tenantSlug =
    (typeof req.query.tenant === 'string' && req.query.tenant.trim()) || getEnv('DEFAULT_TENANT');

  if (!tenantSlug) {
    return res.status(400).json({
      error: 'Missing tenant parameter or DEFAULT_TENANT fallback.',
    });
  }

  const tenantConfig = await fetchTenantConfig(tenantSlug);

  if (!tenantConfig) {
    return res.status(404).json({
      error: `Tenant not found or missing active credentials/projects for slug: ${tenantSlug}`,
    });
  }

  let params: UsageRequestParams;
  try {
    const defaultProjectID =
      tenantConfig.projects.length > 0 ? tenantConfig.projects[0].vf_project_id : undefined;
    params = parseRequestParams(req, defaultProjectID);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request parameters';
    return res.status(400).json({ error: message });
  }

  const environmentID = params.environmentID;
  const apiKey = decryptSecret(tenantConfig.credentials.api_key_encrypted);

  try {
    const result = await queryVoiceflowUsage(params, apiKey);
    return res.status(200).json({
      queriedAt: new Date().toISOString(),
      parameters: {
        tenant: tenantSlug,
        projectID: params.projectID,
        startTime: params.startTime,
        endTime: params.endTime,
        limit: params.limit,
        metric: params.metric,
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
