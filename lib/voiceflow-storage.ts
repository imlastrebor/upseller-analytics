import { getSupabaseServiceClient } from './supabase.js';
import type { VoiceflowMetric, VoiceflowUsageApiResponse } from './voiceflow.js';

type UsageInsertRow = {
  tenant_id: string;
  vf_project_id: string;
  metric: VoiceflowMetric;
  period: string | null;
  data: Record<string, unknown>;
};

type PullInsertRow = {
  tenant_id: string;
  vf_project_id: string;
  metric: VoiceflowMetric;
  window_start: string;
  window_end: string;
  cursor: unknown | null;
  status: 'succeeded' | 'failed';
  error_json?: Record<string, unknown> | null;
};

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeData(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { value };
}

function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  if (error && typeof error === 'object') {
    return error as Record<string, unknown>;
  }

  return { message: String(error) };
}

function extractCursor(result: VoiceflowUsageApiResponse): unknown | null {
  const maybeCursor = (result as any)?.result?.cursor;
  return maybeCursor === undefined ? null : maybeCursor;
}

function buildUsageRows(
  tenantId: string,
  projectId: string,
  metric: VoiceflowMetric,
  result: VoiceflowUsageApiResponse,
): UsageInsertRow[] {
  const payload = (result as any)?.result;

  if (payload && Array.isArray(payload.items)) {
    return payload.items.map((item: any) => ({
      tenant_id: tenantId,
      vf_project_id: projectId,
      metric,
      period: toIsoOrNull(item?.period),
      data: normalizeData(item),
    }));
  }

  if (payload && Array.isArray(payload.intents)) {
    return payload.intents.map((intent: any) => ({
      tenant_id: tenantId,
      vf_project_id: projectId,
      metric,
      period: null,
      data: normalizeData(intent),
    }));
  }

  // Fallback: store the raw payload (or result) as a single row.
  return [
    {
      tenant_id: tenantId,
      vf_project_id: projectId,
      metric,
      period: null,
      data: normalizeData(payload ?? result),
    },
  ];
}

export async function persistVoiceflowUsage(params: {
  tenantId: string;
  projectId: string;
  metric: VoiceflowMetric;
  windowStart: string;
  windowEnd: string;
  result: VoiceflowUsageApiResponse;
}): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const rows = buildUsageRows(params.tenantId, params.projectId, params.metric, params.result);

  if (rows.length > 0) {
    const { error: usageError } = await supabase.from('vf_usage').upsert(rows, {
      onConflict: 'tenant_id,vf_project_id,metric,period,data',
      ignoreDuplicates: true,
    });

    if (usageError) {
      throw new Error(`Failed to upsert vf_usage rows: ${usageError.message}`);
    }
  }

  const cursor = extractCursor(params.result);
  const pullRow: PullInsertRow = {
    tenant_id: params.tenantId,
    vf_project_id: params.projectId,
    metric: params.metric,
    window_start: params.windowStart,
    window_end: params.windowEnd,
    cursor,
    status: 'succeeded',
    error_json: null,
  };

  const { error: pullError } = await supabase.from('vf_pulls').insert([pullRow]);
  if (pullError) {
    throw new Error(`Failed to log pull: ${pullError.message}`);
  }
}

export async function recordVoiceflowPullFailure(params: {
  tenantId: string;
  projectId: string;
  metric: VoiceflowMetric;
  windowStart: string;
  windowEnd: string;
  error: unknown;
}): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const pullRow: PullInsertRow = {
    tenant_id: params.tenantId,
    vf_project_id: params.projectId,
    metric: params.metric,
    window_start: params.windowStart,
    window_end: params.windowEnd,
    cursor: null,
    status: 'failed',
    error_json: normalizeError(params.error),
  };

  const { error: pullError } = await supabase.from('vf_pulls').insert([pullRow]);
  if (pullError) {
    throw new Error(`Failed to log failed pull: ${pullError.message}`);
  }
}
