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

/**
 * Fetch a tenant configuration bundle including active credentials and projects.
 * The API key is stored encrypted; decryption must be implemented before use.
 */
export async function fetchTenantConfig(slug: string): Promise<TenantConfig | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from('tenants')
    .select(
      `
      id,
      slug,
      name,
      vf_credentials!inner (
        id,
        tenant_id,
        api_key_encrypted,
        environment_id,
        active,
        rotated_at
      ),
      vf_projects!inner (
        id,
        tenant_id,
        vf_project_id,
        display_name,
        active
      )
    `,
    )
    .eq('slug', slug)
    .eq('vf_credentials.active', true)
    .eq('vf_projects.active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load tenant configuration: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const tenant: TenantRecord = {
    id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
  };

  const credentials = (data.vf_credentials as VoiceflowCredentialRecord[])?.[0];
  if (!credentials) {
    return null;
  }

  const projects = (data.vf_projects ?? []) as VoiceflowProjectRecord[];

  return { tenant, credentials, projects };
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
    .from('vf_projects')
    .select(
      `
      id,
      tenant_id,
      vf_project_id,
      display_name,
      active,
      tenants (
        id,
        slug,
        name
      ),
      vf_credentials (
        id,
        tenant_id,
        api_key_encrypted,
        environment_id,
        active,
        rotated_at
      )
    `,
    )
    .eq('active', true)
    .order('tenant_id', { ascending: true });

  if (error) {
    throw new Error(`Failed to list tenant projects: ${error.message}`);
  }

  return (data ?? [])
    .filter((row) => row.vf_credentials?.active)
    .map((row) => ({
      tenant: {
        id: row.tenants.id as string,
        slug: row.tenants.slug as string,
        name: row.tenants.name as string,
      },
      credentials: {
        id: row.vf_credentials.id as string,
        tenant_id: row.vf_credentials.tenant_id as string,
        api_key_encrypted: row.vf_credentials.api_key_encrypted as string,
        environment_id: (row.vf_credentials.environment_id as string) ?? null,
        active: Boolean(row.vf_credentials.active),
        rotated_at: row.vf_credentials.rotated_at as string | null,
      },
      project: {
        id: row.id as string,
        tenant_id: row.tenant_id as string,
        vf_project_id: row.vf_project_id as string,
        display_name: (row.display_name as string) ?? null,
        active: Boolean(row.active),
      },
    }));
}
