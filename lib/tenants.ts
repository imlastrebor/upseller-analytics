import { getSupabaseServiceClient } from './supabase.js';

export type TenantRecord = {
  id: string;
  slug: string;
  name: string;
};

export type VoiceflowCredentialRecord = {
  id: string;
  tenant_id: string;
  api_key_encrypted: string;
  environment_id: string | null;
  active: boolean;
  rotated_at: string | null;
};

export type VoiceflowProjectRecord = {
  id: string;
  tenant_id: string;
  vf_project_id: string;
  display_name: string | null;
  active: boolean;
};

export type TenantConfig = {
  tenant: TenantRecord;
  credentials: VoiceflowCredentialRecord;
  projects: VoiceflowProjectRecord[];
};

type LoadTenantConfigResponse = {
  tenant: TenantRecord;
  credentials: VoiceflowCredentialRecord | null;
  projects: VoiceflowProjectRecord[] | null;
} | null;

/**
 * Fetch a tenant configuration bundle including active credentials and projects.
 * The API key is stored encrypted; decryption must be implemented before use.
 */
export async function fetchTenantConfig(slug: string): Promise<TenantConfig | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase.rpc('load_tenant_config', {
    p_slug: slug,
  });

  if (error) {
    throw new Error(`Failed to load tenant configuration: ${error.message}`);
  }

  const result = data as LoadTenantConfigResponse;

  if (!result || !result.credentials || !result.projects || result.projects.length === 0) {
    return null;
  }

  return {
    tenant: result.tenant,
    credentials: result.credentials,
    projects: result.projects,
  };
}

export async function listActiveTenantProjects(): Promise<
  Array<{
    tenant: TenantRecord;
    credentials: VoiceflowCredentialRecord;
    project: VoiceflowProjectRecord;
  }>
> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from('tenants')
    .select('id, slug, name')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to list tenants: ${error.message}`);
  }

  const tenants = (data ?? []) as TenantRecord[];

  const configs = await Promise.all(
    tenants.map(async (tenant) => {
      try {
        const config = await fetchTenantConfig(tenant.slug);
        return config;
      } catch (err) {
        console.error(`Failed to load tenant config for ${tenant.slug}:`, err);
        return null;
      }
    }),
  );

  const results: Array<{
    tenant: TenantRecord;
    credentials: VoiceflowCredentialRecord;
    project: VoiceflowProjectRecord;
  }> = [];

  configs.forEach((config) => {
    if (!config) {
      return;
    }

    config.projects.forEach((project) => {
      results.push({
        tenant: config.tenant,
        credentials: config.credentials,
        project,
      });
    });
  });

  return results;
}
