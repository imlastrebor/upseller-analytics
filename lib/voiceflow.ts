const VOICEFLOW_USAGE_ENDPOINT = 'https://analytics-api.voiceflow.com/v2/query/usage';

export type VoiceflowUsageQuery = {
  projectID: string;
  startTime: string;
  endTime: string;
  limit: number;
  environmentID?: string;
  cursor?: number | string;
};

export type VoiceflowUsageApiResponse = Record<string, unknown>;

export class VoiceflowApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'VoiceflowApiError';
  }
}

export async function queryVoiceflowUsage(
  params: VoiceflowUsageQuery,
  apiKey: string,
): Promise<VoiceflowUsageApiResponse> {
  const payload = {
    data: {
      name: 'interactions',
      filter: {
        projectID: params.projectID,
        startTime: params.startTime,
        endTime: params.endTime,
        limit: params.limit,
        ...(params.environmentID ? { environmentID: params.environmentID } : {}),
      },
      ...(params.cursor ? { cursor: params.cursor } : {}),
    },
  };

  const response = await fetch(VOICEFLOW_USAGE_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = (await response.json()) as VoiceflowUsageApiResponse;

  if (!response.ok) {
    const detail =
      typeof result?.error === 'string'
        ? result.error
        : typeof result?.message === 'string'
          ? result.message
          : result;
    throw new VoiceflowApiError('Voiceflow API request failed', response.status, detail);
  }

  return result;
}
