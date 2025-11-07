import { getSupabaseServiceClient } from './supabase.js';
import type { TenantRecord } from './tenants.js';

export type IncomingEventPayload = {
  event_id: string;
  event_name: string;
  occurred_at?: string;
  project_id?: string;
  user_id?: string;
  session_id?: string;
  properties?: Record<string, unknown>;
};

export type EventWriteTokenRecord = {
  id: string;
  tenant_id: string;
  token: string;
  active: boolean;
  created_at: string;
};

export type TenantWithToken = {
  tenant: TenantRecord;
  token: EventWriteTokenRecord;
};

export type EventInsertRow = {
  event_id: string;
  tenant_id: string;
  project_id?: string | null;
  event_name: string;
  occurred_at: string;
  user_id?: string | null;
  session_id?: string | null;
  properties: Record<string, unknown>;
};

export async function getTenantForWriteToken(token: string): Promise<TenantWithToken | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from('event_write_tokens')
    .select(
      `
      id,
      tenant_id,
      token,
      active,
      created_at,
      tenants (
        id,
        slug,
        name
      )
    `,
    )
    .eq('token', token)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to validate event token: ${error.message}`);
  }

  if (!data || !data.tenants) {
    return null;
  }

  const tenantSource = Array.isArray(data.tenants) ? data.tenants[0] : data.tenants;
  if (!tenantSource) {
    return null;
  }
  const tenantRow = tenantSource as Record<string, unknown>;

  const tenant: TenantRecord = {
    id: tenantRow.id as string,
    slug: tenantRow.slug as string,
    name: tenantRow.name as string,
  };

  const tokenRecord: EventWriteTokenRecord = {
    id: data.id as string,
    tenant_id: data.tenant_id as string,
    token: data.token as string,
    active: Boolean(data.active),
    created_at: data.created_at as string,
  };

  return { tenant, token: tokenRecord };
}

export async function insertEvents(rows: EventInsertRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from('events_raw').upsert(rows, {
    onConflict: 'event_id',
    ignoreDuplicates: true,
  });

  if (error) {
    throw new Error(`Failed to store events: ${error.message}`);
  }
}

export async function getAllowedOriginsForTenant(tenantId: string): Promise<Set<string>> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from('tenant_domains')
    .select('origin, active')
    .eq('tenant_id', tenantId)
    .eq('active', true);

  if (error) {
    throw new Error(`Failed to load tenant origins: ${error.message}`);
  }

  const origins = new Set<string>();
  (data ?? []).forEach((row) => {
    if (typeof row.origin === 'string' && row.origin.trim().length > 0) {
      origins.add(row.origin.trim());
    }
  });

  return origins;
}

export async function isOriginGloballyAllowed(origin: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('tenant_domains')
    .select('origin')
    .eq('origin', origin)
    .eq('active', true)
    .limit(1);

  if (error) {
    throw new Error(`Failed to validate origin: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}
