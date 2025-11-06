import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getEnv } from '../../lib/env.js';
import {
  queryVoiceflowUsage,
  VoiceflowApiError,
  VOICEFLOW_METRICS,
  type VoiceflowMetric,
  type VoiceflowUsageQuery,
} from '../../lib/voiceflow.js';
import {
  listActiveTenantProjects,
  type TenantRecord,
  type VoiceflowCredentialRecord,
  type VoiceflowProjectRecord,
} from '../../lib/tenants.js';
import { decryptSecret } from '../../lib/crypto.js';

type AggregatedResult =
  | {
      status: 'fulfilled';
      tenant: Pick<TenantRecord, 'id' | 'slug' | 'name'>;
      projectID: string;
      metric: VoiceflowMetric;
      environmentID: string | null;
      result: Record<string, unknown>;
    }
  | {
      status: 'rejected';
      tenant: Pick<TenantRecord, 'id' | 'slug' | 'name'>;
      projectID: string;
      metric: VoiceflowMetric;
      environmentID: string | null;
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

  let tenantProjects;
  try {
    tenantProjects = await listActiveTenantProjects();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: `Failed to load tenant projects: ${message}` });
  }

  if (tenantProjects.length === 0) {
    return res.status(500).json({
      error: 'No active tenant projects configured in Supabase.',
    });
  }

  let tenantFilters: string[] | undefined;
  if (typeof req.query.tenant === 'string' && req.query.tenant.trim().length > 0) {
    tenantFilters = [req.query.tenant.trim()];
  } else if (typeof req.query.tenants === 'string' && req.query.tenants.trim().length > 0) {
    tenantFilters = parseCommaSeparated(req.query.tenants);
  }

  if (tenantFilters) {
    tenantProjects = tenantProjects.filter((entry) =>
      tenantFilters!.includes(entry.tenant.slug),
    );
  }

  let projectFilters: string[] | undefined;
  if (typeof req.query.projectID === 'string' && req.query.projectID.trim().length > 0) {
    projectFilters = [req.query.projectID.trim()];
  } else if (typeof req.query.projectIDs === 'string' && req.query.projectIDs.trim().length > 0) {
    projectFilters = parseCommaSeparated(req.query.projectIDs);
  }

  if (projectFilters) {
    tenantProjects = tenantProjects.filter((entry) =>
      projectFilters!.includes(entry.project.vf_project_id),
    );
  }

  if (tenantProjects.length === 0) {
    return res.status(404).json({
      error: 'No matching tenant projects found for the provided filters.',
      filters: {
        tenants: tenantFilters,
        projects: projectFilters,
      },
    });
  }

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

  const environmentOverride =
    (typeof req.query.environmentID === 'string' && req.query.environmentID.trim()) ||
    getEnv('VF_ENVIRONMENT_ID');

  type CollectionTask = {
    tenant: TenantRecord;
    credentials: VoiceflowCredentialRecord;
    project: VoiceflowProjectRecord;
    metric: VoiceflowMetric;
    environmentID: string | null;
  };

  const tasks: CollectionTask[] = tenantProjects.flatMap((entry) =>
    metrics.map((metric) => ({
      tenant: entry.tenant,
      credentials: entry.credentials,
      project: entry.project,
      metric,
      environmentID: environmentOverride ?? entry.credentials.environment_id ?? null,
    })),
  );

  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      const apiKey = decryptSecret(task.credentials.api_key_encrypted);

      const usageQuery: VoiceflowUsageQuery = {
        projectID: task.project.vf_project_id,
        startTime,
        endTime,
        limit,
        metric: task.metric,
        ...(task.environmentID ? { environmentID: task.environmentID } : {}),
      };

      const voiceflowResponse = await queryVoiceflowUsage(usageQuery, apiKey);
      return { task, voiceflowResponse };
    }),
  );

  const aggregated: AggregatedResult[] = results.map((entry, index) => {
    const task = tasks[index];
    const tenantInfo = {
      id: task.tenant.id,
      slug: task.tenant.slug,
      name: task.tenant.name,
    };
    const environment = task.environmentID ?? null;

    if (entry.status === 'fulfilled') {
      return {
        status: 'fulfilled',
        tenant: tenantInfo,
        projectID: task.project.vf_project_id,
        metric: task.metric,
        environmentID: environment,
        result: entry.value.voiceflowResponse as Record<string, unknown>,
      };
    }

    const reason = entry.reason;
    if (reason instanceof VoiceflowApiError) {
      return {
        status: 'rejected',
        tenant: tenantInfo,
        projectID: task.project.vf_project_id,
        metric: task.metric,
        environmentID: environment,
        error: {
          message: reason.message,
          detail: reason.detail,
          status: reason.status,
        },
      };
    }

    return {
      status: 'rejected',
      tenant: tenantInfo,
      projectID: task.project.vf_project_id,
      metric: task.metric,
      environmentID: environment,
      error: {
        message: reason instanceof Error ? reason.message : 'Unknown error',
      },
    };
  });

  const succeeded = aggregated.filter((item) => item.status === 'fulfilled').length;
  const tenantCount = new Set(tasks.map((task) => task.tenant.id)).size;
  const projectCount = new Set(
    tasks.map((task) => `${task.tenant.id}:${task.project.vf_project_id}`),
  ).size;

  return res.status(200).json({
    ranAt: new Date().toISOString(),
    tenantCount,
    projectCount,
    succeededCount: succeeded,
    window: {
      startTime,
      endTime,
    },
    timezone,
    limit,
    metrics,
    environment: environmentOverride ?? null,
    results: aggregated,
  });
}
