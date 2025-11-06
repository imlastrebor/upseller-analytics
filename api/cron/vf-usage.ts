import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getEnv } from '../../lib/env.js';
import {
  queryVoiceflowUsage,
  VoiceflowApiError,
  VOICEFLOW_METRICS,
  type VoiceflowMetric,
  type VoiceflowUsageQuery,
} from '../../lib/voiceflow.js';

type AggregatedResult =
  | {
      status: 'fulfilled';
      projectID: string;
      metric: VoiceflowMetric;
      result: Record<string, unknown>;
    }
  | {
      status: 'rejected';
      projectID: string;
      metric: VoiceflowMetric;
      error: {
        message: string;
        detail?: unknown;
        status?: number;
      };
    };

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function parseMetricsInput(input: string[]): VoiceflowMetric[] {
  const normalized = input
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());

  if (normalized.length === 0) {
    return [];
  }

  const unique = Array.from(new Set(normalized));
  const invalid = unique.filter(
    (metric) => !VOICEFLOW_METRICS.includes(metric as VoiceflowMetric),
  );

  if (invalid.length > 0) {
    throw new Error(
      `Invalid metrics: ${invalid.join(', ')}. Supported metrics: ${VOICEFLOW_METRICS.join(', ')}`,
    );
  }

  return unique as VoiceflowMetric[];
}

function computeDefaultWindow() {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

function parseLimit(req: VercelRequest, fallback: number): number {
  const raw = req.query.limit;
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
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

  const projectIdsEnv = getEnv('VF_PROJECT_IDS');
  let projects = projectIdsEnv ? parseCommaSeparated(projectIdsEnv) : [];

  if (typeof req.query.projectID === 'string' && req.query.projectID.trim().length > 0) {
    projects = [req.query.projectID.trim()];
  } else {
    const multiParam =
      (typeof req.query.projectIDs === 'string' && req.query.projectIDs) ||
      (typeof req.query.projectIds === 'string' && req.query.projectIds);
    if (multiParam && multiParam.trim().length > 0) {
      projects = parseCommaSeparated(multiParam);
    }
  }

  if (projects.length === 0) {
    return res
      .status(500)
      .json({ error: 'VF_PROJECT_IDS is not configured or contains no project identifiers.' });
  }

  const environmentID = getEnv('VF_ENVIRONMENT_ID');

  let metrics: VoiceflowMetric[] = [...VOICEFLOW_METRICS];
  try {
    if (typeof req.query.metric === 'string') {
      metrics = parseMetricsInput([req.query.metric]);
    } else if (typeof req.query.metrics === 'string') {
      metrics = parseMetricsInput(parseCommaSeparated(req.query.metrics));
    } else if (typeof req.query.METRICS === 'string') {
      metrics = parseMetricsInput(parseCommaSeparated(req.query.METRICS));
    } else {
      const metricsEnv = getEnv('VF_METRICS');
      if (metricsEnv) {
        metrics = parseMetricsInput(parseCommaSeparated(metricsEnv));
        if (metrics.length === 0) {
          metrics = [...VOICEFLOW_METRICS];
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid metrics configuration';
    return res.status(400).json({ error: message });
  }

  const sourceWindow = computeDefaultWindow();
  const startTime =
    (typeof req.query.startTime === 'string' && req.query.startTime) || sourceWindow.startTime;
  const endTime =
    (typeof req.query.endTime === 'string' && req.query.endTime) || sourceWindow.endTime;
  const limit = parseLimit(req, 100);

  const timezone = getEnv('VF_TIMEZONE');

  const queryBase: Omit<VoiceflowUsageQuery, 'projectID' | 'metric'> = {
    startTime,
    endTime,
    limit,
    ...(environmentID ? { environmentID } : {}),
  };

  const tasks = projects.flatMap((projectID) =>
    metrics.map((metric) => ({ projectID, metric })),
  );

  const results = await Promise.allSettled(
    tasks.map(async ({ projectID, metric }) => {
      const voiceflowResponse = await queryVoiceflowUsage(
        { ...queryBase, projectID, metric },
        apiKey,
      );
      return { projectID, metric, voiceflowResponse };
    }),
  );

  const aggregated: AggregatedResult[] = results.map((entry, index) => {
    const { projectID, metric } = tasks[index];

    if (entry.status === 'fulfilled') {
      return {
        status: 'fulfilled',
        projectID,
        metric,
        result: entry.value.voiceflowResponse as Record<string, unknown>,
      };
    }

    const reason = entry.reason;
    if (reason instanceof VoiceflowApiError) {
      return {
        status: 'rejected',
        projectID,
        metric,
        error: {
          message: reason.message,
          detail: reason.detail,
          status: reason.status,
        },
      };
    }

    return {
      status: 'rejected',
      projectID,
      metric,
      error: {
        message: reason instanceof Error ? reason.message : 'Unknown error',
      },
    };
  });

  const succeeded = aggregated.filter((item) => item.status === 'fulfilled').length;

  return res.status(200).json({
    ranAt: new Date().toISOString(),
    projectCount: projects.length,
    succeededCount: succeeded,
    window: {
      startTime,
      endTime,
    },
    timezone,
    limit,
    metrics,
    results: aggregated,
  });
}
