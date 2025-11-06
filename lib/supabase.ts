import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from './env.js';

type Json = Record<string, unknown> | null | string | number | boolean | Json[];

export type ServiceSupabaseClient = SupabaseClient<Json, 'public', any>;

let cachedClient: ServiceSupabaseClient | undefined;

export function getSupabaseServiceClient(): ServiceSupabaseClient {
  if (!cachedClient) {
    const url = getEnv('SUPABASE_URL');
    const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !key) {
      throw new Error('Supabase service credentials are not configured.');
    }

    cachedClient = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return cachedClient;
}
