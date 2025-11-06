import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getEnv } from '../../lib/env.js';
import {
  queryVoiceflowUsage,
  VoiceflowApiError,
  type VoiceflowUsageQuery,
} from '../../lib/voiceflow.js';

type AggregatedResult =
  | {
      status: 'fulfilled';
      projectID: string;
      result: Record<string, unknown>;
    }
  | {
      status: 'rejected';
      projectID: string;
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

  const sourceWindow = computeDefaultWindow();
  const startTime =
    (typeof req.query.startTime === 'string' && req.query.startTime) || sourceWindow.startTime;
  const endTime =
    (typeof req.query.endTime === 'string' && req.query.endTime) || sourceWindow.endTime;
  const limit = parseLimit(req, 100);

  const timezone = getEnv('VF_TIMEZONE');

  const queryBase: Omit<VoiceflowUsageQuery, 'projectID'> = {
    startTime,
    endTime,
    limit,
    ...(environmentID ? { environmentID } : {}),
  };

  const results = await Promise.allSettled(
    projects.map(async (projectID) => {
      const voiceflowResponse = await queryVoiceflowUsage({ ...queryBase, projectID }, apiKey);
      return { projectID, voiceflowResponse };
    }),
  );

  const aggregated: AggregatedResult[] = results.map((entry, index) => {
    const projectID = projects[index];

    if (entry.status === 'fulfilled') {
      return {
        status: 'fulfilled',
        projectID,
        result: entry.value.voiceflowResponse as Record<string, unknown>,
      };
    }

    const reason = entry.reason;
    if (reason instanceof VoiceflowApiError) {
      return {
        status: 'rejected',
        projectID,
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
    results: aggregated,
  });
}
